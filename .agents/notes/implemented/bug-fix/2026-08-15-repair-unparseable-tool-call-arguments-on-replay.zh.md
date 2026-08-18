# Agent Note: 回放 DeepSeek 时修复无法解析的 tool-call arguments

Status: implemented

中文 | [English](2026-08-15-repair-unparseable-tool-call-arguments-on-replay.md)

## Problem

DeepSeek 的一轮可能发出一个 `arguments` 不是单个 JSON 对象的 tool call——线上实际观察到两个参数对象被直接拼接（`{"command":"a"}{"command":"b"}`）。harness 在第一遍正确处理了它：参数校验失败、工具返回错误结果、UI 显示 `invalid arguments: "arguments" must be an object`。但**下一次**请求随即失败，报 `INVALID_REQUEST: Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`，本轮终止，且该 session 之后的每一轮都会失败。

网关在回放时会解析每个 assistant `tool_calls[].function.arguments`，以便把该调用与随后的 `role:'tool'` 消息配对。一个不是单个 JSON 对象的值会让网关丢弃该调用，于是配对的 tool 消息找不到匹配的 `tool_calls`，整个请求被拒。由于 assistant 消息与 tool 结果都持久保存在 session 日志里，原样回放的坏 arguments 会使该 session 之后的每一轮都失败——这与序列化器已防范的 null-content 属同一类「一个坏的持久字段毁掉后续每一轮」问题。

## Decision

`dsh-llm-deepseek/serialize.ts` 的 `serializeAssistant` 仅当 arguments 字符串恰好解析为一个 JSON 对象时才原样回放；否则发送 `{}`。修复只作用于线上：session 日志保留原始 arguments（回放保真与 model-visible ⟺ logged 不变），模型仍会收到工具自身的错误结果，从而可以用正确参数重试。只有线上的配对结构被修复。

## Alternatives considered

- **修复持久 assistant 消息的 arguments。** 让 `BlockAssembler` 或 session 日志把非法 arguments 改写为 `{}` 会破坏回放保真与 model-visible ⟺ logged 的可重建性；日志必须保留模型原始输出。拒绝。
- **在两个适配器共用的序列化器里修复。** 该失败是 DeepSeek 网关的解析严格性，pi-ai 孪生适配器有自己的线上翻译；按 capability-seam 规则，provider 特有的线上行为应留在 provider 内。
- **丢弃 tool 结果而非修复调用。** 模型将看不到参数错误、无法重试；丢失反馈比一个仅线上的 `{}` 占位更损害行为。

## Consequences

畸形 tool call 不再终止本轮或使后续轮失败：assistant tool call 保持可配对，模型仍能看到工具的错误结果。占位符只出现在 arguments 不是单个 JSON 对象的调用的线上表示中；所有内置工具都声明对象根参数，这些调用在客户端已被拒绝，因此任何被接受的调用都不受影响。

## Testing

`serialize.spec.ts` 固定了该修复：拼接 arguments 的 tool call 序列化为可解析的 `{}`，且其配对的 `role:'tool'` 错误结果仍正常过线；合法 JSON 但非对象的参数（数组、标量、`null`）同样映射为 `{}`；合法对象参数则逐字节透传。相关：[工具参数 schema 始终声明 required 数组](2026-08-15-tool-parameters-always-declare-required.md)。
