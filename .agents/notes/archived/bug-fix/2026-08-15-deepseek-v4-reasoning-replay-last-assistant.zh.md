# Agent Note: DeepSeek V4 回放仅给最后一条 assistant 消息带 reasoning_content

Status: implemented
Archived: 2026-08-20

[English](2026-08-15-deepseek-v4-reasoning-replay-last-assistant.md) | 中文

## Problem

thinking 模式下，任何在多于一轮 assistant 消息上回放 `reasoning_content` 的 DeepSeek V4 多轮对话都会被拒：`INVALID_REQUEST: The reasoning_content in the thinking mode must be passed back to the API`——与字面意思相反。对真实 API 的线上二分（2026-08-15，`deepseek-v4-flash`）显示：每个 assistant 都带 RC → 400；都不带 → 400；关 thinking → 400；只给最近一条 assistant 带 → 通过。即网关只接受在**最新** assistant 消息上带 `reasoning_content`，而把它放在更早（中间）的 assistant 消息上——即使逐字——也报错。单工具轮会话只有一条 assistant（即最新），所以一步会话正常、两步会话必挂。

## Decision

`dsh-llm-deepseek/serialize.ts` 的 `serializeMessages` 先定位最近的 assistant 消息，仅对它传 `replayReasoning`；`serializeAssistant` 仅在该标志为真时输出 `reasoning_content`（拼接的 reasoning 文本，无则为 `""`），其余更早的 assistant 消息省略该字段。这只作用于线上：session 日志保留全部 reasoning 块，model-visible ⟺ logged 不变。

## Alternatives considered

- **每个 assistant 都回放 reasoning_content。** 文档字面读法与若干第三方客户端的修法；在此被线上证伪——V4（0813）对 RC-on-all 返回 400。
- **后续请求关闭 thinking。** 同样被证伪（no-think 变体仍 400），且会削弱后续轮推理。
- **全部丢弃 reasoning。** RC-on-none 返回 400；最新 assistant 必须带。

## Consequences

多工具轮 thinking 会话现在可成功回放。更早的 assistant 轮不再向 API 回显其 reasoning，模型在回放时看不到自己先前的推理——这是网关规则下接受的代价，无持久数据变更。

## Testing

`serialize.spec.ts` 固定：单条（即最近）assistant 带 RC；中间 assistant 省略而最后一条回放；仅 reasoning 与空内容的单条轮输出 `reasoning_content`（可为 `""`）且 `content: ""`。一次真实两步 `dsh --profile headless` 运行在原本 400 的场景下成功完成。
