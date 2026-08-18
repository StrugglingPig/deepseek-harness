# Agent Note: DeepSeek V4 replay puts reasoning_content on the last assistant message only

Status: implemented

English | [中文](2026-08-15-deepseek-v4-reasoning-replay-last-assistant.zh.md)

## Problem

With thinking mode on, any multi-turn DeepSeek V4 conversation that replayed `reasoning_content` on more than one assistant message was rejected with `INVALID_REQUEST: The reasoning_content in the thinking mode must be passed back to the API` — the opposite of what the message suggests. Live bisection against the real API (2026-08-15, `deepseek-v4-flash`) showed: RC on every assistant → 400; RC on none → 400; thinking disabled → 400; RC on the most recent assistant only → accepted. So the gateway accepts `reasoning_content` solely on the newest assistant message and treats its presence on an earlier (intermediate) assistant message — even verbatim — as an error. A single-tool-turn session has only one assistant (the newest), which is why one-tool sessions worked while two-tool sessions always failed.

## Decision

`serializeMessages` in `dsh-llm-deepseek/serialize.ts` locates the most recent assistant message and passes `replayReasoning` only for it; `serializeAssistant` emits `reasoning_content` (the joined reasoning text, or `""` when the turn had none) only when that flag is set, omitting the field on all earlier assistant messages. This is wire-only: the session log keeps every reasoning block, and model-visible ⟺ logged is unchanged.

## Alternatives considered

- **Replay reasoning_content on every assistant message.** The literal reading of "must be passed back" and the fix used by several third-party clients; live-falsified here — RC-on-all 400s on V4 (0813).
- **Disabling thinking for continuation requests.** Also live-falsified (no-think variant still 400) and would degrade reasoning on later turns.
- **Dropping reasoning everywhere.** RC-on-none 400s; the newest assistant must carry it.

## Consequences

Multi-tool-turn thinking sessions now replay successfully. Earlier assistant turns no longer echo their reasoning to the API, so the model does not see its own prior reasoning on replay — an accepted cost of the gateway's rule, with no durable-data change.

## Testing

`serialize.spec.ts` pins: a lone (hence most recent) assistant carries RC; an intermediate assistant omits it while the last replays it; reasoning-only and content-less lone turns emit `reasoning_content` (possibly `""`) with `content: ""`. A real two-tool-step `dsh --profile headless` run against the live API completes where it previously 400'd.
