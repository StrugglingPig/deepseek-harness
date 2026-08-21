import { describe, expect, it, vi } from 'vitest'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, CallId, ReasoningEffortId, createMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import {
  serializeMessages,
  serializeMessagesWithImages,
  serializeRequest,
  serializeRequestWithImages,
} from '../src/serialize.ts'

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: 'deepseek-official', model: 'deepseek-v4-flash', messages: [], ...overrides }
}

function imageRef(mediaType: ImageMediaType = 'image/png', bytes = 3): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
    mediaType,
    bytes,
    width: 1,
    height: 1,
  }
}

function attachmentStore(
  readImage = vi.fn((ref: ImageAttachmentRef, _signal?: AbortSignal) => Promise.resolve({
    ref,
    data: Uint8Array.of(1, 2, 3),
  })),
): AttachmentStore {
  return { readImage } as unknown as AttachmentStore
}

/** A reasoned text-only assistant message used by every-turn tests. */
function reasonedTextAssistant(reasoning: string, text: string): Message {
  return createMessage({
    role: 'assistant',
    content: [
      { type: 'reasoning', text: reasoning },
      { type: 'text', text },
    ],
    source: { kind: 'plugin', plugin: 'test' },
  })
}

describe('serializeMessages', () => {
  it('skips holes a sparse messages array may carry', () => {
    const block: ContentBlock = { type: 'text', text: 'present' }
    const sparse = new Array<Message>(2)
    sparse[0] = createUserMessage({ content: [block], source: { kind: 'plugin', plugin: 'test' } })

    const wire = serializeMessages(sparse)

    expect(wire).toHaveLength(1)
    expect(wire[0]).toMatchObject({ role: 'user' })
  })

  it('maps user text to string content', () => {
    const wire = serializeMessages([
      createUserMessage({
        content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'user', content: 'hello world' }])
  })

  it('maps system-role messages in history', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'system', content: [{ type: 'text', text: 'be brief' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'system', content: 'be brief' }])
  })

  it('passes reasoning_content back on a lone (hence most-recent) assistant turn', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking…' },
          { type: 'text', text: 'answer' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    // A single assistant message is the most recent one, so it carries RC.
    expect(wire).toEqual([{ role: 'assistant', content: 'answer', reasoning_content: 'thinking…' }])
  })

  it('sends empty reasoning_content on a tool-call turn that had no reasoning', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'tool-call', id: CallId('call-1'), name: 'get_weather', arguments: '{"city":"Paris"}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{
      role: 'assistant',
      content: '',
      reasoning_content: '',
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }],
    }])
  })

  it('passes reasoning_content back on tool-call turns (official passback rule)', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'I should check the weather.' },
          { type: 'tool-call', id: CallId('call-1'), name: 'get_weather', arguments: '{"city":"Paris"}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{
      role: 'assistant',
      // "" (not null) on tool-call turns — mirrors the official samples'
      // verbatim message replay; some gateways reject null.
      content: '',
      reasoning_content: 'I should check the weather.',
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }],
    }])
  })

  it('replays reasoning_content only on the most recent assistant message', () => {
    // DeepSeek V4 (0813) 400s when an intermediate assistant message carries
    // reasoning_content, so earlier turns omit it and only the last replays it.
    const assistant = (id: string, reasoning: string) => createMessage({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: reasoning },
        { type: 'tool-call', id: CallId(id), name: 'bash', arguments: '{"command":"pwd"}' },
      ],
      source: { kind: 'plugin', plugin: 'test' },
    })
    const wire = serializeMessages([
      assistant('call-1', 'first plan'),
      { role: 'user', content: [{ type: 'tool-result', toolCallId: CallId('call-1'), content: [{ type: 'text', text: 'out1' }] }], source: { kind: 'plugin', plugin: 'test' } } as Message,
      assistant('call-2', 'second plan'),
      { role: 'user', content: [{ type: 'tool-result', toolCallId: CallId('call-2'), content: [{ type: 'text', text: 'out2' }] }], source: { kind: 'plugin', plugin: 'test' } } as Message,
    ])
    const assistants = wire.filter(m => m.role === 'assistant') as { reasoning_content?: string }[]
    expect(assistants).toHaveLength(2)
    expect('reasoning_content' in assistants[0]!).toBe(false)
    expect(assistants[1]!.reasoning_content).toBe('second plan')
  })

  it('serializes parallel tool calls in order', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'tool-call', id: CallId('a'), name: 'one', arguments: '{}' },
          { type: 'tool-call', id: CallId('b'), name: 'two', arguments: '{}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    const assistant = wire[0] as { tool_calls: { id: string }[] }
    expect(assistant.tool_calls.map(call => call.id)).toEqual(['a', 'b'])
  })

  it('repairs non-object tool-call arguments so the paired tool result stays replayable', () => {
    // A v4 turn can paste two argument objects back-to-back; the serializer must
    // send `{}` so the paired role:'tool' message keeps its tool_call, while the
    // model still receives the tool's own error result.
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: '{"command":"a"}{"command":"b"}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      createUserMessage({
        content: [
          { type: 'tool-result', toolCallId: CallId('call-1'), content: [{ type: 'text', text: 'Error: invalid arguments' }] },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire[0]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'call-1', function: { name: 'bash', arguments: '{}' } }],
    })
    expect(wire[1]).toEqual({ role: 'tool', tool_call_id: 'call-1', content: 'Error: invalid arguments' })
  })

  it('keeps well-formed object tool-call arguments byte-verbatim', () => {
    // Whitespace + key order would be lost by a stringify(JSON.parse(x)) round
    // trip, so this pins the raw string is passed through untouched.
    const raw = '{"b":2,  "a": 1}'
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: raw },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire[0]).toMatchObject({ tool_calls: [{ function: { arguments: raw } }] })
  })

  it('replaces valid-JSON-but-non-object arguments with the placeholder', () => {
    for (const args of ['[]', '[1,2]', '42', '"x"', 'true', 'null']) {
      const wire = serializeMessages([
        createMessage({
          role: 'assistant',
          content: [
            { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: args },
          ],
          source: { kind: 'plugin', plugin: 'test' },
        }),
      ])
      expect(wire[0], args).toMatchObject({ tool_calls: [{ function: { arguments: '{}' } }] })
    }
  })

  it('turns tool results into role:tool messages', () => {
    const wire = serializeMessages([
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: CallId('call-1'),
          content: [{ type: 'text', text: 'Sunny 22C' }],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'tool', tool_call_id: 'call-1', content: 'Sunny 22C' }])
  })

  it('sends a sentinel for empty tool-result content', () => {
    const wire = serializeMessages([
      createUserMessage({
        content: [{ type: 'tool-result', toolCallId: CallId('call-1'), content: [] }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'tool', tool_call_id: 'call-1', content: '(no output)' }])
  })

  it('splits mixed user text + tool results into separate wire messages', () => {
    const wire = serializeMessages([
      createUserMessage({
        content: [
          { type: 'text', text: 'context note' },
          { type: 'tool-result', toolCallId: CallId('call-1'), content: [{ type: 'text', text: 'ok' }] },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([
      { role: 'user', content: 'context note' },
      { role: 'tool', tool_call_id: 'call-1', content: 'ok' },
    ])
  })

  it('skips plugin-added block types (merge-extensible ContentBlockMap)', () => {
    const wire = serializeMessages([
      createUserMessage({
        content: [
          { type: 'chart', data: 'x' } as unknown as ContentBlock,
          { type: 'text', text: 'see chart' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'user', content: 'see chart' }])
  })

  it('rejects image blocks instead of silently flattening them away', () => {
    expect(() => serializeMessages([createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
          mediaType: 'image/png', bytes: 68, width: 1, height: 1,
        },
      }],
      source: { kind: 'plugin', plugin: 'test' },
    })])).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }))
  })

  it('emits an empty user message rather than dropping block-less messages', () => {
    const wire = serializeMessages([createUserMessage({
      content: [],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire).toEqual([{ role: 'user', content: '' }])
  })

  it('replays reasoning_content on every reasoned assistant turn under every-turn', () => {
    // Every reasoned assistant turn carries `reasoning_content` so a gateway
    // re-encoding the conversation for another vendor can hash the replayed
    // chain of thought to recover that turn's upstream thinking signature.
    // Selecting this against `api.deepseek.com` V4 (0813) makes the request
    // fail with 400 — the field is not what the public endpoint accepts.
    const assistant = reasonedTextAssistant
    const wire = serializeMessages([
      assistant('first plan', 'answer-1'),
      { role: 'user', content: [{ type: 'text', text: 'continue' }], source: { kind: 'plugin', plugin: 'test' } } as Message,
      assistant('second plan', 'answer-2'),
    ], 'every-turn')
    const assistants = wire.filter(m => m.role === 'assistant') as { reasoning_content?: string }[]
    expect(assistants.map(a => a.reasoning_content)).toEqual(['first plan', 'second plan'])
  })

  it('omits reasoning_content on a non-reasoning assistant turn under every-turn', () => {
    // Mirrors the lone tool-call-free assistant test above, with an explicit
    // policy override; the default test omits a 'reasoning_content' field on a
    // turn whose assistant content carried no reasoning text.
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'plain answer' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ], 'every-turn')
    expect('reasoning_content' in (wire[0] as object)).toBe(false)
  })

  it('still drops an intermediate assistant\'s reasoning under every-turn when the turn itself had none', () => {
    // Under every-turn the gate is "did this turn carry reasoning text?", not
    // "is this turn the most recent assistant?". The lone no-reasoning tool
    // call passback rule (reasoning_content: '') is exclusive to last-assistant.
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: CallId('c'), name: 'f', arguments: '{}' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      { role: 'user', content: [{ type: 'text', text: 'go on' }], source: { kind: 'plugin', plugin: 'test' } } as Message,
      createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'plain answer' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ], 'every-turn')
    const assistants = wire.filter(m => m.role === 'assistant') as { reasoning_content?: string }[]
    expect('reasoning_content' in assistants[0]!).toBe(false)
    expect('reasoning_content' in assistants[1]!).toBe(false)
  })
})

describe('serializeRequest', () => {
  const history: Message[] = [createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'plugin', plugin: 'test' },
  })]

  it('always streams with usage and maps the basics', () => {
    const wire = serializeRequest(request({ messages: history }))
    expect(wire).toEqual({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      stream_options: { include_usage: true },
    })
  })

  it('prepends the system prompt', () => {
    const wire = serializeRequest(request({ messages: history, system: 'be helpful' }))
    expect(wire.messages[0]).toEqual({ role: 'system', content: 'be helpful' })
    expect(wire.messages[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('defaults reasoning replay to last-assistant when defaults omit reasoningPassback', () => {
    const history: Message[] = [
      createMessage({
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'first plan' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      { role: 'user', content: [{ type: 'text', text: 'go on' }], source: { kind: 'plugin', plugin: 'test' } } as Message,
      createMessage({
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'second plan' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ]
    const wire = serializeRequest(request({ messages: history }))
    const assistants = wire.messages.filter(m => m.role === 'assistant') as { reasoning_content?: string }[]
    expect('reasoning_content' in assistants[0]!).toBe(false)
    expect(assistants[1]!.reasoning_content).toBe('second plan')
  })

  it('honors defaults.reasoningPassback for the entry-point policy', () => {
    const history: Message[] = [
      createMessage({
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'first plan' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      { role: 'user', content: [{ type: 'text', text: 'go on' }], source: { kind: 'plugin', plugin: 'test' } } as Message,
      createMessage({
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'second plan' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ]
    const wire = serializeRequest(request({ messages: history }), { reasoningPassback: 'every-turn' })
    const assistants = wire.messages.filter(m => m.role === 'assistant') as { reasoning_content?: string }[]
    expect(assistants.map(a => a.reasoning_content)).toEqual(['first plan', 'second plan'])
  })

  it('maps sampling params and stop sequences', () => {
    const wire = serializeRequest(request({ messages: history, temperature: 0.2, maxTokens: 100, stop: ['END'] }))
    expect(wire.temperature).toBe(0.2)
    expect(wire.max_tokens).toBe(100)
    expect(wire.stop).toEqual(['END'])
  })

  it('maps tools to the wire function shape', () => {
    const wire = serializeRequest(request({
      messages: history,
      tools: [
        { name: 'a', description: 'A', parameters: { type: 'object', properties: {} } },
        { name: 'b', description: 'B', parameters: { type: 'object', properties: { x: { type: 'string' } } } },
      ],
    }))
    expect(wire.tools).toEqual([
      { type: 'function', function: { name: 'a', description: 'A', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'b', description: 'B', parameters: { type: 'object', properties: { x: { type: 'string' } } } } },
    ])
  })

  it('omits an empty tools array', () => {
    const wire = serializeRequest(request({ messages: history, tools: [] }))
    expect(wire.tools).toBeUndefined()
  })

  it.each(['low', 'high', 'max'] as const)('maps adapter-default thinking and request effort %s', (effort) => {
    const wire = serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId(effort) }),
      { thinking: 'enabled', reasoningEffort: 'high' },
    )
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBe(effort)
  })

  it('maps off to disabled thinking without a wire reasoning effort', () => {
    const wire = serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('off') }),
      { thinking: 'enabled', reasoningEffort: 'max' },
    )
    expect(wire.thinking).toEqual({ type: 'disabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('re-enables thinking when max overrides an off default', () => {
    const wire = serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('max') }),
      { reasoningEffort: 'off' },
    )
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBe('max')
  })

  it('rejects enabling thinking when the deployment is locked to disabled', () => {
    expect(() => serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('high') }),
      { thinking: 'disabled' },
    )).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_REASONING_EFFORT' }))
  })

  it('disables thinking for session-title requests without changing adapter defaults', () => {
    const wire = serializeRequest(
      request({
        messages: history,
        purpose: 'session-title',
        reasoningEffort: ReasoningEffortId('max'),
      }),
      { thinking: 'enabled', reasoningEffort: 'max' },
    )
    expect(wire.thinking).toEqual({ type: 'disabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('omits thinking fields when unset (provider default applies)', () => {
    const wire = serializeRequest(request({ messages: history }))
    expect(wire.thinking).toBeUndefined()
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('preserves an explicit enabled default without inventing a wire effort', () => {
    const wire = serializeRequest(request({ messages: history }), { thinking: 'enabled' })
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('rejects an effort outside the DeepSeek capability', () => {
    expect(() => serializeRequest(request({
      messages: history,
      reasoningEffort: ReasoningEffortId('medium'),
    }))).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_REASONING_EFFORT' }))
  })
})

describe('image serialization', () => {
  it.each([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
  ] as const)('preserves ordered text and %s image parts', async (mediaType) => {
    const signal = new AbortController().signal
    const readImage = vi.fn((ref: ImageAttachmentRef, received?: AbortSignal) => {
      expect(received).toBe(signal)
      return Promise.resolve({ ref, data: Uint8Array.of(1, 2, 3) })
    })
    const wire = await serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [
          { type: 'text', text: 'before' },
          { type: 'image', attachment: imageRef(mediaType) },
          { type: 'text', text: 'after' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), {
      attachments: attachmentStore(readImage),
      maxRequestImageBytes: 20 * 1024 * 1024,
      signal,
    })

    expect(wire.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'before' },
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,AQID` } },
        { type: 'text', text: 'after' },
      ],
    }])
  })

  it('serializes image-only user content without synthetic text', async () => {
    const wire = await serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: imageRef() }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), {
      attachments: attachmentStore(),
      maxRequestImageBytes: 20 * 1024 * 1024,
      signal: new AbortController().signal,
    })

    expect(wire.messages).toEqual([{
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }],
    }])
  })

  it('keeps tool content textual and groups consecutive tool-result images afterward', async () => {
    const messages = [
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: CallId('first'),
          content: [{ type: 'image', attachment: imageRef() }],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: CallId('second'),
          content: [
            { type: 'text', text: 'caption' },
            { type: 'image', attachment: imageRef('image/jpeg') },
          ],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ]

    await expect(serializeMessagesWithImages(
      messages,
      attachmentStore(),
      new AbortController().signal,
    )).resolves.toEqual([
      { role: 'tool', tool_call_id: 'first', content: '(see attached image)' },
      { role: 'tool', tool_call_id: 'second', content: 'caption' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Attached image(s) from tool result:' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQID' } },
        ],
      },
    ])
  })

  it('does not emit an empty user message for ignored content beside a tool result', async () => {
    const messages = [createUserMessage({
      content: [
        { type: 'text', text: '' },
        { type: 'chart', data: 'ignored' } as unknown as ContentBlock,
        {
          type: 'tool-result',
          toolCallId: CallId('result'),
          content: [{ type: 'text', text: 'ok' }],
        },
      ],
      source: { kind: 'plugin', plugin: 'test' },
    })]

    await expect(serializeMessagesWithImages(
      messages,
      attachmentStore(),
      new AbortController().signal,
    )).resolves.toEqual([
      { role: 'tool', tool_call_id: 'result', content: 'ok' },
    ])
  })

  it('recursively converts nested tool-result content and preserves the empty fallback', async () => {
    const messages = [createUserMessage({
      content: [
        {
          type: 'tool-result',
          toolCallId: CallId('nested'),
          content: [{
            type: 'tool-result',
            toolCallId: CallId('inner'),
            content: [{ type: 'text', text: 'inside' }],
          }],
        },
        { type: 'tool-result', toolCallId: CallId('empty'), content: [] },
      ],
      source: { kind: 'plugin', plugin: 'test' },
    })]

    await expect(serializeMessagesWithImages(
      messages,
      attachmentStore(),
      new AbortController().signal,
    )).resolves.toEqual([
      { role: 'tool', tool_call_id: 'nested', content: 'inside' },
      { role: 'tool', tool_call_id: 'empty', content: '(no output)' },
    ])
  })

  it('flushes tool-result images before system and assistant history', async () => {
    const imageResult = (id: string) => createUserMessage({
      content: [{
        type: 'tool-result',
        toolCallId: CallId(id),
        content: [{ type: 'image', attachment: imageRef() }],
      }],
      source: { kind: 'plugin' as const, plugin: 'test' },
    })
    const messages = [
      imageResult('before-system'),
      createMessage({
        role: 'system',
        content: [{ type: 'text', text: 'system history' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      imageResult('before-assistant'),
      createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'assistant history' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ]

    const wire = await serializeMessagesWithImages(
      messages,
      attachmentStore(),
      new AbortController().signal,
    )
    expect(wire).toEqual([
      { role: 'tool', tool_call_id: 'before-system', content: '(see attached image)' },
      expect.objectContaining({ role: 'user' }),
      { role: 'system', content: 'system history' },
      { role: 'tool', tool_call_id: 'before-assistant', content: '(see attached image)' },
      expect.objectContaining({ role: 'user' }),
      // Last assistant on the image path also follows the text-only default
      // (last-assistant) — the lone replay target carries `reasoning_content: ''`.
      { role: 'assistant', content: 'assistant history', reasoning_content: '' },
    ])
  })

  it('offloads oldest images before reads and keeps the newest image', async () => {
    const readImage = vi.fn((ref: ImageAttachmentRef) => Promise.resolve({
      ref,
      data: Uint8Array.of(1, 2, 3),
    }))
    const wire = await serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [
          { type: 'image', attachment: imageRef('image/png', 3) },
          { type: 'image', attachment: imageRef('image/jpeg', 3) },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), {
      attachments: attachmentStore(readImage),
      maxRequestImageBytes: 4,
      signal: new AbortController().signal,
    })

    expect(wire.messages[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: expect.stringContaining('older images are omitted first') as string },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQID' } },
      ],
    })
    expect(readImage).toHaveBeenCalledTimes(1)
    expect(readImage.mock.calls[0]?.[0]).toMatchObject({ mediaType: 'image/jpeg' })
  })

  it.each(['system', 'assistant'] as const)('rejects an image in %s history before reading attachments', async (role) => {
    const readImage = vi.fn()
    await expect(serializeMessagesWithImages([createMessage({
      role,
      content: [{ type: 'image', attachment: imageRef() }],
      source: { kind: 'plugin', plugin: 'test' },
    })], attachmentStore(readImage), new AbortController().signal))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(readImage).not.toHaveBeenCalled()
  })

  it('rejects unsupported image history before request offloading can replace it', async () => {
    const readImage = vi.fn()
    await expect(serializeRequestWithImages(request({
      messages: [createMessage({
        role: 'system',
        content: [{ type: 'image', attachment: imageRef('image/png', 300) }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), {
      attachments: attachmentStore(readImage),
      maxRequestImageBytes: 1,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(readImage).not.toHaveBeenCalled()
  })

  it('prepends the request system prompt on the image path', async () => {
    const wire = await serializeRequestWithImages(request({
      system: 'system prompt',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: imageRef() }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), {
      attachments: attachmentStore(),
      maxRequestImageBytes: 20 * 1024 * 1024,
      signal: new AbortController().signal,
    })
    expect(wire.messages[0]).toEqual({ role: 'system', content: 'system prompt' })
  })

  it('preserves stable attachment failure codes', async () => {
    const readImage = vi.fn(() => Promise.reject(new AttachmentError(
      'Stored attachment bytes are corrupt.',
      'ATTACHMENT_CORRUPT',
    )))
    await expect(serializeMessagesWithImages([createUserMessage({
      content: [{ type: 'image', attachment: imageRef() }],
      source: { kind: 'plugin', plugin: 'test' },
    })], attachmentStore(readImage), new AbortController().signal))
      .rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
  })

  it('preserves non-attachment resolver failures', async () => {
    const failure = new Error('resolver failed')
    const readImage = vi.fn(() => Promise.reject(failure))
    await expect(serializeMessagesWithImages([createUserMessage({
      content: [{ type: 'image', attachment: imageRef() }],
      source: { kind: 'plugin', plugin: 'test' },
    })], attachmentStore(readImage), new AbortController().signal)).rejects.toBe(failure)
  })

  it('threads reasoningPassback through the image path (every-turn on two reasoned assistants)', async () => {
    // Mirror the text-path "every-turn" assertion through the image-capable
    // serializer to prove the policy is not hardcoded to the default at any
    // image-path code site.
    const assistant = reasonedTextAssistant
    const wire = await serializeMessagesWithImages([
      assistant('first plan', 'answer-1'),
      createUserMessage({
        content: [{ type: 'text', text: 'continue' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      assistant('second plan', 'answer-2'),
    ], attachmentStore(), new AbortController().signal, 'every-turn')
    const assistants = wire.filter(m => m.role === 'assistant') as { reasoning_content?: string }[]
    expect(assistants.map(a => a.reasoning_content)).toEqual(['first plan', 'second plan'])
  })
})

describe('review fixes: assistant content shapes', () => {
  it('serializes a content-less, tool-call-less assistant message as "" content, never null', () => {
    // Aborted/empty assistant turns: no text, no calls → "". The earlier
    // null shape was live-falsified: the API 400s a null-content assistant
    // message without tool_calls ("content or tool_calls must be set").
    const wire = serializeMessages([createMessage({
      role: 'assistant', content: [],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    // A lone assistant is the most recent one, so it carries reasoning_content
    // (empty here) under the V4 last-assistant-only passback rule.
    expect(wire).toEqual([{ role: 'assistant', content: '', reasoning_content: '' }])
  })

  it('serializes a reasoning-ONLY assistant message as "" content with reasoning replayed', () => {
    // The model can answer entirely in the reasoning channel (a v4-flash
    // greeting did, live). As the most recent assistant message its reasoning
    // is passed back; content must still be SET — a null here poisoned the
    // session log and bricked every later turn of that session.
    const wire = serializeMessages([createMessage({
      role: 'assistant', content: [{ type: 'reasoning', text: '你好！有什么我可以帮你的吗？' }],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire).toEqual([{ role: 'assistant', content: '', reasoning_content: '你好！有什么我可以帮你的吗？' }])
  })

  it('serializes tool-call turns with empty string content, not null', () => {
    const wire = serializeMessages([createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: CallId('c'), name: 'f', arguments: '{}' }],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire[0]).toMatchObject({ content: '' })
  })
})
