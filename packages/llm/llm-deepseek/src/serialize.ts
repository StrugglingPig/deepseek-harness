/**
 * Serialize harness messages into DeepSeek chat completions. Text-only
 * requests retain string user content; the image path resolves durable
 * attachments into ordered data-URL parts. Tool-result images follow their
 * string-only tool messages in a separate user message. Assistant reasoning
 * replays as `reasoning_content` under the deployment's
 * {@link ReasoningPassback} policy; core image blocks are rejected explicitly
 * on the text-only route, and unknown declaration-merged block types retain
 * the adapter's documented extension fallback.
 * @module dsh-llm-deepseek/serialize
 */

import { assertNever, contentHasImage, LlmError, offloadRequestImages } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  WireImageContentPart,
  WireMessage,
  WireRequest,
  WireTool,
  WireUserContentPart,
} from './types.ts'

/**
 * Which assistant turns replay `reasoning_content` in history.
 *
 * `last-assistant` is what `api.deepseek.com` accepts: V4 (0813) thinking mode
 * rejects a request whose *earlier* assistant message carries the field — even
 * verbatim — with 400 "The `reasoning_content` in the thinking mode must be
 * passed back", and rejects one where no assistant carries it at all, so the
 * most recent assistant always sends the field — including the empty string
 * when that turn had no reasoning — and every earlier one omits it.
 *
 * `every-turn` serves a gateway that re-encodes the conversation for another
 * vendor and recovers each turn's upstream thinking signature by hashing the
 * replayed chain of thought, which a tool-call-free turn carries nowhere else.
 * The field is omitted on a reasoning-free turn. Selecting it against
 * `api.deepseek.com` produces the 400 above rather than degrading silently.
 */
export type ReasoningPassback = 'last-assistant' | 'every-turn'

/** Passback policy of the public DeepSeek endpoint, used when config names none. */
export const DEFAULT_REASONING_PASSBACK: ReasoningPassback = 'last-assistant'

/** Adapter-level request defaults (from plugin config). */
export interface RequestDefaults {
  thinking?: 'enabled' | 'disabled' | undefined
  reasoningEffort?: 'off' | 'low' | 'high' | 'max' | undefined
  reasoningPassback?: ReasoningPassback | undefined
}

interface ResolvedThinking {
  thinking?: 'enabled' | 'disabled'
  reasoningEffort?: 'low' | 'high' | 'max'
}

/** Dependencies required only when the request contains image input. */
export interface ImageSerializationOptions {
  /** Durable resolver for canonical image references. */
  attachments: AttachmentStore
  /** Positive bound on accumulated base64 image payload. */
  maxRequestImageBytes: number
  /** Cancellation shared with the provider request. */
  signal: AbortSignal
}

const TOOL_RESULT_IMAGE_TEXT = 'Attached image(s) from tool result:'

/** Validate the adapter-owned effort before resolving its DeepSeek wire fields. */
function reasoningEffort(effort: NonNullable<GenerateOptions['reasoningEffort']>): 'off' | 'low' | 'high' | 'max' {
  if (effort === 'off' || effort === 'low' || effort === 'high' || effort === 'max') {
    return effort as 'off' | 'low' | 'high' | 'max'
  }
  throw new LlmError(
    `DeepSeek does not support reasoning effort "${effort}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/** Resolve one legal thinking/effort pair without exposing `off` as a wire effort. */
function resolveThinking(options: GenerateOptions, defaults: RequestDefaults): ResolvedThinking {
  if (options.purpose === 'session-title') return { thinking: 'disabled' }
  const effort = options.reasoningEffort === undefined
    ? defaults.reasoningEffort
    : reasoningEffort(options.reasoningEffort)
  if (defaults.thinking === 'disabled' && effort !== undefined && effort !== 'off') {
    throw new LlmError(
      `DeepSeek deployment does not support reasoning effort "${effort}"`,
      'UNSUPPORTED_REASONING_EFFORT',
    )
  }
  if (effort === 'off') return { thinking: 'disabled' }
  if (effort === 'low' || effort === 'high' || effort === 'max') {
    return { thinking: 'enabled', reasoningEffort: effort }
  }
  return defaults.thinking === undefined ? {} : { thinking: defaults.thinking }
}

/** Join the text blocks of a message (used for user/tool-result content). */
function flattenText(blocks: ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Reject core image content before any text-flattening path can silently erase it. */
function assertTextOnly(blocks: readonly ContentBlock[]): void {
  if (contentHasImage(blocks)) {
    throw new LlmError('The DeepSeek chat-completions adapter does not support image content.', 'UNSUPPORTED_CONTENT')
  }
}

/**
 * Index of the most recent assistant message, or -1 when none. Holes are
 * absent from the Message type yet reach the callback at runtime, so the
 * optional chain is load-bearing against sparse arrays.
 */
function lastAssistantIndex(messages: readonly Message[]): number {
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  return messages.findLastIndex(m => m?.role === 'assistant')
}

/** Decide whether the given assistant turn replays `reasoning_content` under the deployment's passback policy. */
function replayReasoningUnder(
  passback: ReasoningPassback,
  isLastAssistant: boolean,
  hasReasoning: boolean,
): boolean {
  switch (passback) {
    case 'last-assistant':
      // `hasReasoning` is irrelevant: the field is sent on every newest turn
      // (including `""` when reasoning-free), per V4.
      return isLastAssistant
    case 'every-turn':
      // Under `every-turn`, the field is omitted on a reasoning-free turn.
      return hasReasoning
    default:
      return assertNever(passback, 'ReasoningPassback')
  }
}

/**
 * The gateway parses each replayed `tool_calls[].function.arguments` to pair the
 * call with the following `role:'tool'` messages, and drops a call whose
 * arguments are not a single JSON object — the paired tool message is then
 * rejected with "Messages with role 'tool' must be a response to a preceding
 * message with 'tool_calls'". Model output is not guaranteed well-formed (a turn
 * can paste two argument objects back-to-back), so replay the raw string only
 * when it is one JSON object and fall back to an empty object otherwise. The
 * repair is wire-only: the session log keeps the raw arguments, and the model
 * still receives the tool's own error result.
 * @param raw - the assembled tool-call arguments string.
 * @returns `raw` when it is one JSON object, else `'{}'`.
 */
function toolCallArguments(raw: string): string {
  let parsed: unknown
  try {
    // JSON.parse is the only throwing statement: SyntaxError when the string is
    // not JSON, RangeError on pathologically deep input. Both mean "not one
    // object", so both take the placeholder.
    parsed = JSON.parse(raw)
  } catch {
    return '{}'
  }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? raw : '{}'
}

/** Reject roles whose DeepSeek history format cannot carry image input. */
function assertSupportedImageRoles(messages: readonly Message[]): void {
  for (const message of messages) {
    if (message.role !== 'user' && contentHasImage(message.content)) {
      throw new LlmError(
        `The DeepSeek chat-completions adapter cannot represent image content in a ${message.role} message.`,
        'UNSUPPORTED_CONTENT',
      )
    }
  }
}

/** Resolve one durable image into its transient DeepSeek data-URL part. */
async function imagePart(
  block: Extract<ContentBlock, { type: 'image' }>,
  attachments: AttachmentStore,
  signal: AbortSignal,
): Promise<WireImageContentPart> {
  try {
    const stored = await attachments.readImage(block.attachment, signal)
    return {
      type: 'image_url',
      image_url: {
        url: `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`,
      },
    }
  } catch (error: unknown) {
    if (error instanceof AttachmentError) {
      throw new LlmError(error.message, error.code, { cause: error })
    }
    throw error
  }
}

/** Convert user or nested tool-result blocks into ordered wire parts. */
async function contentParts(
  blocks: readonly ContentBlock[],
  attachments: AttachmentStore,
  signal: AbortSignal,
): Promise<WireUserContentPart[]> {
  const parts: WireUserContentPart[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) parts.push({ type: 'text', text: block.text })
        break
      case 'image':
        parts.push(await imagePart(block, attachments, signal))
        break
      case 'tool-result':
        parts.push(...await contentParts(block.content, attachments, signal))
        break
      default:
        // Other merge-extensible blocks are not DeepSeek user-input vocabulary.
        break
    }
  }
  return parts
}

/** Keep text-only user messages on the compact string wire form. */
function userContent(parts: readonly WireUserContentPart[]): string | WireUserContentPart[] {
  const text: string[] = []
  for (const part of parts) {
    if (part.type === 'image_url') return [...parts]
    text.push(part.text)
  }
  return text.join('')
}

/**
 * Serialize one assistant message (text + reasoning + tool calls).
 * @param message - the assistant turn to convert.
 * @param passback - the deployment's reasoning replay policy.
 * @param isLastAssistant - whether this is the most recent assistant turn of the request.
 * @returns the assistant wire message.
 */
function serializeAssistant(
  message: Message,
  passback: ReasoningPassback,
  isLastAssistant: boolean,
): WireMessage {
  const text = flattenText(message.content)
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: toolCallArguments(block.arguments) },
    }))
  // The two policies differ on the empty case as well as on which turns carry
  // the field: `last-assistant` sends `""` on a reasoning-free newest assistant
  // because the endpoint rejects a thinking request that replays the field
  // nowhere, while `every-turn` omits it so a non-thinking turn stays untouched.
  const replayReasoning = replayReasoningUnder(passback, isLastAssistant, reasoning.length > 0)

  return {
    role: 'assistant',
    // Text-less turns send "" — NEVER null. Pure tool-call turns: the
    // official samples replay message.content verbatim (which is "") and
    // some gateways reject null outright. Reasoning-ONLY turns (the model
    // can answer entirely in the reasoning channel, e.g. a v4-flash
    // greeting): the live API rejects null-content/no-tool_calls assistant
    // messages with a 400 ("content or tool_calls must be set"), and since
    // the message sits durably in the session log, a null here bricks every
    // later turn of that session.
    content: text,
    ...replayReasoning ? { reasoning_content: reasoning } : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

/**
 * Serialize the conversation. `tool-result` blocks become standalone
 * `{role: 'tool'}` messages; the harness puts each tool result in its own
 * user-role message, so a mixed user message contributes its text first and
 * its tool results as separate wire messages after.
 * @param messages - the harness conversation, in order.
 * @param passback - reasoning replay policy; omitted uses {@link DEFAULT_REASONING_PASSBACK}.
 * @returns the wire messages; order preserved, each tool result expanded into its own entry.
 */
export function serializeMessages(
  messages: Message[],
  passback: ReasoningPassback = DEFAULT_REASONING_PASSBACK,
): WireMessage[] {
  const lastAssistant = lastAssistantIndex(messages)
  const wire: WireMessage[] = []
  for (let idx = 0; idx < messages.length; idx++) {
    const message = messages[idx]
    if (!message) continue
    assertTextOnly(message.content)
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message, passback, idx === lastAssistant))
      continue
    }
    // user role: tool results ride in user messages in the harness
    // vocabulary, but DeepSeek wants them as role:'tool' messages.
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    const text = flattenText(message.content)
    if (text.length > 0 || toolResults.length === 0) {
      wire.push({ role: 'user', content: text })
    }
    for (const result of toolResults) {
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        // Empty tool output still needs SOME content on the wire.
        content: flattenText(result.content) || '(no output)',
      })
    }
  }
  return wire
}

/**
 * Serialize image-capable history after resolving durable attachments.
 * Consecutive tool results keep string `tool` messages and share one following
 * user message containing their images.
 * @param messages - transient request history after request-size offloading.
 * @param attachments - durable image resolver.
 * @param signal - cancellation for attachment reads.
 * @param passback - reasoning replay policy; omitted uses {@link DEFAULT_REASONING_PASSBACK}.
 * @returns ordered DeepSeek wire messages.
 */
export async function serializeMessagesWithImages(
  messages: readonly Message[],
  attachments: AttachmentStore,
  signal: AbortSignal,
  passback: ReasoningPassback = DEFAULT_REASONING_PASSBACK,
): Promise<WireMessage[]> {
  assertSupportedImageRoles(messages)
  const lastAssistant = lastAssistantIndex(messages)
  const wire: WireMessage[] = []
  let pendingToolImages: WireImageContentPart[] = []
  const flushToolImages = (): void => {
    if (pendingToolImages.length === 0) return
    wire.push({
      role: 'user',
      content: [{ type: 'text', text: TOOL_RESULT_IMAGE_TEXT }, ...pendingToolImages],
    })
    pendingToolImages = []
  }

  for (let idx = 0; idx < messages.length; idx++) {
    const message = messages[idx]
    if (!message) continue
    if (message.role === 'system') {
      flushToolImages()
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      flushToolImages()
      wire.push(serializeAssistant(message, passback, idx === lastAssistant))
      continue
    }

    const regular = message.content.filter(block => block.type !== 'tool-result')
    const toolResults = message.content.filter((block): block is Extract<ContentBlock, { type: 'tool-result' }> => (
      block.type === 'tool-result'
    ))
    const content = userContent(await contentParts(regular, attachments, signal))
    if (content.length > 0 || toolResults.length === 0) {
      flushToolImages()
      wire.push({
        role: 'user',
        content,
      })
    }
    for (const result of toolResults) {
      const parts = await contentParts(result.content, attachments, signal)
      const images = parts.filter((part): part is WireImageContentPart => part.type === 'image_url')
      const text = parts.filter(part => part.type === 'text').map(part => part.text).join('')
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: text || (images.length > 0 ? '(see attached image)' : '(no output)'),
      })
      pendingToolImages.push(...images)
    }
  }
  flushToolImages()
  return wire
}

/** Assemble request fields shared by text-only and image-capable conversion. */
function requestWithMessages(
  options: GenerateOptions,
  messages: WireMessage[],
  defaults: RequestDefaults,
): WireRequest {
  const tools: WireTool[] | undefined = options.tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  const resolvedThinking = resolveThinking(options, defaults)
  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...resolvedThinking.thinking !== undefined ? { thinking: { type: resolvedThinking.thinking } } : {},
    ...resolvedThinking.reasoningEffort !== undefined
      ? { reasoning_effort: resolvedThinking.reasoningEffort }
      : {},
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop !== undefined ? { stop: options.stop } : {},
  }
}

/**
 * Build the full wire request. Always streaming (`stream: true`, usage
 * reporting on); optional fields are omitted rather than sent as null, so
 * provider defaults apply.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param defaults - adapter-level thinking defaults; undefined fields put nothing on the wire.
 * @returns the chat-completions request body.
 */
export function serializeRequest(
  options: GenerateOptions,
  defaults: RequestDefaults = {},
): WireRequest {
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...serializeMessages(
    options.messages,
    defaults.reasoningPassback ?? DEFAULT_REASONING_PASSBACK,
  ))

  return requestWithMessages(options, messages, defaults)
}

/**
 * Build one image-capable request while keeping durable bytes out of session
 * messages. Oversized oldest images become deterministic text before any
 * attachment read.
 * @param options - harness request containing image-capable user content.
 * @param images - attachment resolver, request bound, and cancellation.
 * @param defaults - adapter-level thinking defaults.
 * @returns the fully materialized DeepSeek request body.
 */
export async function serializeRequestWithImages(
  options: GenerateOptions,
  images: ImageSerializationOptions,
  defaults: RequestDefaults = {},
): Promise<WireRequest> {
  assertSupportedImageRoles(options.messages)
  const requestMessages = offloadRequestImages(options.messages, images.maxRequestImageBytes)
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...await serializeMessagesWithImages(
    requestMessages,
    images.attachments,
    images.signal,
    defaults.reasoningPassback ?? DEFAULT_REASONING_PASSBACK,
  ))
  return requestWithMessages(options, messages, defaults)
}
