# Agent Note: Tool parameter schemas always declare a `required` array

Status: implemented

English | [中文](2026-08-15-tool-parameters-always-declare-required.zh.md)

## Problem

A zero-parameter tool failed every live DeepSeek request with `INVALID_REQUEST: Invalid schema for function '<name>': null is not of type "array"`. The affected tools — `get_goal`, `job_list`, `list_agents`, `terminal_list`, `schedule_list`, `cordis_inspect_list`, `cordis_inspect_self`, and `session_trace` — all declare `parameters: {}`, and the schema compiler projected that to `{"type":"object","properties":{}}`, omitting `required` entirely. DeepSeek's chat-completions gateway validates each function `parameters` against a meta-schema whose `required` field is mandatory; a missing field is treated as `null`, which fails the array check.

The omission came from `parameterSchemaSpecToJsonSchema`, which emitted `required` only when at least one parameter carried `required: true`. The compiled property map keeps `required` optional internally (`CompiledPropertyMap.required?: string[]`), and that optionality leaked to the wire as a missing array on exactly the tools with no required parameters. Replay snapshots did not catch it because they record the assembled schema without a live gateway; the e2e tier that would have caught it self-skips without a key.

## Decision

`parameterSchemaSpecToJsonSchema` always emits `required`, defaulting to `[]` when no parameter is required. The projection is now:

```json
{ "type": "object", "properties": {}, "required": [] }
```

The internal `CompiledPropertyMap` stays as-is: it also feeds explicit object *value* schemas, whose `required` remains absent-when-empty (output schemas never reach the function-`parameters` wire position, so the fix belongs at the parameter projection, not the shared compiler).

## Alternatives considered

- **Patch only the DeepSeek adapter's `serializeRequest`.** Add `required: []` when the incoming `parameters` lacks it. This contains the quirk to the one provider that rejects it, but it hides a wire-format fact inside one adapter and leaves the schema layer producing a schema the rest of the world must normalize. Refused: the parameter projection is the one place every tool's function schema is born, so it is where the invariant "a function schema always has `required`" belongs.
- **Give each zero-parameter tool a dummy property.** Turns every `parameters: {}` into a synthetic field the model has to ignore, polluting the model contract and every catalog/snapshot for no schema benefit.
- **Leave it omitted and special-case the gateway.** There is no supported hook to relax the gateway's meta-schema, and an empty `required` is semantically identical to an absent one in JSON Schema, so emitting it costs nothing.

## Consequences

Every parameterless tool now sends `required: []` on the wire and renders it in the tool catalog. Tools that already declared `required` are unchanged. The model sees an explicit empty required list instead of an absent one; this is annotation-level and does not change which arguments a tool accepts. The `ParameterJsonSchema` type already allowed `required?: string[]`, so no public type widened.

## Testing

`schema.spec.ts` pins the empty-projection invariant (`parameterSchemaSpecToJsonSchema({})` → `required: []`), and the tools package tests that asserted the old absent-`required` output were updated. The ACP `tool-schemas` snapshots, the headless `session.jsonl` snapshots, and both tool-catalog files were regenerated. A real `dsh --profile headless` run against the live API accepted the corrected schema.
