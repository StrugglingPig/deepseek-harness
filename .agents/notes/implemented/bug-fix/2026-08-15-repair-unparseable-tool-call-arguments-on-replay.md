# Agent Note: Unparseable tool-call arguments are repaired on DeepSeek replay

Status: implemented

English | [中文](2026-08-15-repair-unparseable-tool-call-arguments-on-replay.zh.md)

## Problem

A DeepSeek turn can emit one tool call whose `arguments` is not a single JSON object — observed live as two argument objects pasted back-to-back (`{"command":"a"}{"command":"b"}`). The harness handled the call correctly on the first pass: argument validation failed, the tool returned an error result, and the UI showed `invalid arguments: "arguments" must be an object`. But the *next* request then failed with `INVALID_REQUEST: Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`, ending the turn and making every later turn of that session fail.

The gateway parses each replayed assistant `tool_calls[].function.arguments` to pair the call with the following `role:'tool'` messages. A value that is not one JSON object makes it drop the call, so the paired tool message has no matching `tool_calls` and the whole request is rejected. Because the assistant message and the tool result both sit durably in the session log, the bad arguments replayed verbatim made every later turn of that session fail — the same "one bad durable field ruins every later turn" class as the null-content bug the serializer already guards.

## Decision

`serializeAssistant` in `dsh-llm-deepseek/serialize.ts` replays an assistant tool call's `arguments` verbatim only when the string parses to exactly one JSON object; otherwise it sends `{}`. The repair is wire-only: the session log keeps the raw arguments (replay fidelity and model-visible ⟺ logged are unchanged), and the model still receives the tool's own error result, so it can retry with correct arguments. Only the pairing structure on the wire is repaired.

## Alternatives considered

- **Repairing the durable assistant message's arguments.** Making `BlockAssembler` or the session log rewrite invalid arguments to `{}` would corrupt replay fidelity and break model-visible ⟺ logged reconstructability; the raw model output is exactly what the log must keep. Refused.
- **Repairing in the shared serializer used by both adapters.** The failure is a DeepSeek-gateway parsing strictness, and the pi-ai twin has its own wire translation; keeping the repair in the DeepSeek adapter matches the capability-seam rule that provider-specific wire behavior lives in the provider.
- **Dropping the tool result instead of repairing the call.** The model would never see the argument error and could not retry; losing the feedback degrades behavior more than a wire-only `{}` placeholder.

## Consequences

A malformed tool call no longer ends the turn or fails the session's later turns: the assistant tool call stays pairable and the model sees the tool's error result. The placeholder only appears on the wire for calls whose arguments are not one JSON object; every shipped tool declares object-rooted parameters, so those calls were already rejected client-side and no accepted call is altered.

## Testing

`serialize.spec.ts` pins the repair: a concatenated-arguments tool call serializes to a parseable `{}` while its paired `role:'tool'` error result still crosses the wire; valid-JSON-but-non-object arguments (array, scalar, `null`) also map to `{}`; and a well-formed object argument is passed through byte-verbatim. Related: [tool parameters always declare a required array](2026-08-15-tool-parameters-always-declare-required.md).
