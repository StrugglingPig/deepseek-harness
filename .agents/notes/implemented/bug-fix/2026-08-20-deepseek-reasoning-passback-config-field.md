# Agent Note: DeepSeek `reasoning_content` replay under `Config.reasoningPassback`

Status: implemented

English | [中文](2026-08-20-deepseek-reasoning-passback-config-field.zh.md)

## Problem

`dsh-llm-deepseek` originally replayed `reasoning_content` in history only on assistant turns that also carried tool calls. Two incompatible realities forced a configurable policy.

`api.deepseek.com` V4 (0813) thinking mode rejects a history that replays the field the wrong way. Live bisection (2026-08-15, `deepseek-v4-flash`) showed: RC on every assistant → 400, RC on none → 400, no-think variant → 400, RC on the most recent assistant only → accepted. The endpoint accepts the field solely on the newest assistant message and treats its presence on an earlier (intermediate) assistant — even verbatim — as an error. A single-tool-turn session has only one assistant (the newest), which is why one-tool sessions worked while two-tool sessions always failed.

`Config.baseURL` also points the same adapter at any OpenAI-compatible endpoint, including a gateway that re-encodes a DeepSeek chat-completions conversation for another vendor. Such a gateway has no wire slot for the upstream thinking signature and recovers it by hashing the replayed chain of thought. A turn the model answered without calling a tool reached the gateway with no reasoning text at all, the signature lookup found nothing, and the reconstructed conversation diverged from the recorded one. Agent runs call tools on most turns, so the loss appeared only at plain-answer turns and looked intermittent.

The two endpoints demand different policies, and choosing either one hard-coded into the serializer broke the other. The pre-merge `last-assistant-only` fix made multi-tool thinking sessions replay correctly against `api.deepseek.com` but stripped the signature-recovery data the gateway needed; the pre-merge `every-turn` fix served the gateway but moved the `api.deepseek.com` baseline from "one-tool sessions work" to "all thinking sessions 400".

## Decision

`Config.reasoningPassback?: 'last-assistant' | 'every-turn'` (default `last-assistant`) selects the policy per deployment. `serializeMessages` and `serializeMessagesWithImages` thread it through to `serializeAssistant`, which uses it together with the new `isLastAssistant` flag to decide whether each turn emits `reasoning_content`.

- `last-assistant` (default): the most recent assistant message always emits `reasoning_content`, including an empty string when the turn carried no reasoning — the endpoint 400s on a thinking request that replays the field nowhere. Earlier assistants omit the field.
- `every-turn`: every assistant whose content carried reasoning emits `reasoning_content`; turns with no reasoning keep emitting nothing. The replayed text is byte-exact with what the provider streamed: `translate.ts` accumulates the whole `reasoning_content` channel of one response into a single reasoning block, so the join in `serializeAssistant` concatenates one member and a hash taken over the replay matches a hash taken over the original delivery.

`RequestDefaults.reasoningPassback` carries the resolved value into both text-only (`serializeRequest`) and image-capable (`serializeRequestWithImages`) entry points, with `DEFAULT_REASONING_PASSBACK = 'last-assistant'` resolving unset config.

The repair is wire-only: the session log keeps every reasoning block and every tool-call arguments string, and model-visible ⟺ logged is unchanged.

## Alternatives considered

- **Hard-coding `every-turn`.** Selecting `every-turn` against `api.deepseek.com` is the V4 400 — RC-on-all was live-falsified. Selecting `last-assistant` against a re-encoding gateway loses the thinking signature at every plain-answer turn. There is no deployment-agnostic default; both deployment classes are real and in-box (an OpenAI-compatible endpoint configured via `Config.baseURL` is a documented deployment shape, not a misuse).
- **Hard-coding `last-assistant` without a Config switch.** Symmetric argument: the gateway deployment is unsupported without an opt-in.
- **Deciding from `baseURL`.** Whether an endpoint forwards to another vendor is not readable from its host: an internal endpoint may proxy DeepSeek directly and a public one may forward. The adapter would be guessing at a deployment it cannot see through.
- **Carrying the signature durably instead, as `dsh-llm-pi-ai` does.** That adapter persists `thinkingSignature` per block in its replay state because its providers put the signature on the wire. DeepSeek chat-completions exposes none, so this adapter has nothing to persist and the replayed text is the only channel. The Config switch accepts the gateway coupling as deployment-known rather than encoded into the protocol.
- **A Config switch on a different name (an opt-out of `every-turn` only).** Selecting it against `api.deepseek.com` still produces the 400 rather than degrading silently — and `every-turn` is the wire-cheap option (the field is inert where unneeded), so an opt-out default is also wrong. The current default follows the protocol-anchored endpoint's spec.

## Consequences

Multi-tool-turn thinking sessions against `api.deepseek.com` now replay successfully by default, with the field present only on the newest assistant message — earlier turns no longer echo their reasoning to the API, which is an accepted cost of the gateway's wire rule. Gateway deployments that need the signature-recovery contract opt in with `reasoningPassback: 'every-turn'`; selecting it against `api.deepseek.com` raises a 400 immediately, not silently. The wire-only repair on tool-call arguments (single-JSON-object or `'{}'`) is independent and applies under both policies.

`WireAssistantMessage.reasoning_content` documents both endpoint behaviors. The package README's Known Limitations and Deferred Work lists the new Config field, and the `dsh-llm-deepseek/serialize` module doc states the policy at the top.

## Testing

`tests/serialize.spec.ts` pins all three assistant shapes for the default `last-assistant` policy: a lone (hence most recent) assistant carries RC; an intermediate assistant omits it while the last replays it; a tool-call turn with no reasoning carries `reasoning_content: ''`; a reasoning-only turn carries its text with `content: ''`. The every-turn variant pins: every reasoned assistant (tool-call or not) carries RC; reasoning-free turns omit it; an intermediate no-reasoning assistant is still skipped (the length gate). A `serializeRequest` test confirms `RequestDefaults.reasoningPassback` flows through to the wire output, and a default-omission test confirms `last-assistant` is the entry-point default. A real two-tool-step `dsh --profile headless` run against the live `api.deepseek.com` V4 (0813) API completed where it previously 400'd.

Superseded rationale:
- `2026-08-15-deepseek-v4-reasoning-replay-last-assistant` — archived; the V4 rule lives on as the default policy.
- `2026-08-19-deepseek-reasoning-passback-every-turn` — archived; the gateway contract lives on as the `every-turn` opt-in.