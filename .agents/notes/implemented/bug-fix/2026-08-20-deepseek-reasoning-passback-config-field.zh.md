# Agent Note：DeepSeek 在 `Config.reasoningPassback` 下的 `reasoning_content` 回放

Status: implemented

[English](2026-08-20-deepseek-reasoning-passback-config-field.md) | 中文

## 问题

`dsh-llm-deepseek` 最初只在同时携带工具调用的 assistant 轮次上回放 `reasoning_content`。两种互不兼容的现实把一个可配置的策略推到台面上。

`api.deepseek.com` V4（0813）思考模式会以错误方式回放该字段，并因此拒绝该请求。2026-08-15 对 `deepseek-v4-flash` 的实盘二分显示：每个 assistant 都带 RC → 400；全部不带 → 400；no-think 变体 → 400；仅在最新的 assistant 上带 RC → 通过。该端点只接受最新一条 assistant 消息携带该字段，并在更早（中间）assistant 携带它（即便逐字）时报错。单一工具轮次的会话只有一条 assistant（即最新的），因此单工具会话能跑通，而两工具轮次的会话则必失败。

`Config.baseURL` 也允许将同一适配器指向任何 OpenAI 兼容端点，包括把 DeepSeek chat-completions 对话重新编码转发给另一个厂商的网关。这类网关在协议上没有承载上游思考签名的字段，只能对回放的思维链取哈希来恢复它。模型未调用工具就作答的轮次到达网关时完全不带推理文本，签名查找落空，重建出的对话与记录中的对话产生分叉。Agent 运行的大多数轮次都会调用工具，所以这个损失只在纯作答轮次上出现，表现为偶发。

两种端点各自要求不同的策略，而任一者被硬编码进序列化器都会破坏另一者。合并前那版「仅最新一条」的修复让多工具思考会话在 `api.deepseek.com` 上能正确回放，但剥掉了网关所需的签名恢复数据；「每轮都带」的修复则服务了网关，却把 `api.deepseek.com` 的基线从「单工具会话能跑通」改成「所有思考会话 400」。

## 决策

`Config.reasoningPassback?: 'last-assistant' | 'every-turn'`（默认 `last-assistant`）按部署选择策略。`serializeMessages` 与 `serializeMessagesWithImages` 都把策略穿到 `serializeAssistant`，后者把它与新增的 `isLastAssistant` 标记一起，决定本轮是否发出 `reasoning_content`。

- `last-assistant`（默认）：最新的 assistant 消息始终发出 `reasoning_content`——该轮若未携带推理，则发空串，因为端点会在思考请求某处都不回放该字段时报 400；更早的 assistant 一律省略。
- `every-turn`：内容携带推理的每一条 assistant 都发出 `reasoning_content`；无推理的轮次仍不发出。回放文本与提供方流式下发的内容逐字一致：`translate.ts` 把一次响应的整个 `reasoning_content` 通道累积进单个推理块，因此 `serializeAssistant` 中的拼接只连接一个成员，对回放取的哈希与对原始下发取的哈希相同。

`RequestDefaults.reasoningPassback` 把解析后的值带入文本路径（`serializeRequest`）与图片路径（`serializeRequestWithImages`）两个入口，未配置时由 `DEFAULT_REASONING_PASSBACK = 'last-assistant'` 兜底。

修复只发生在协议层：会话日志保留所有推理块与所有工具调用参数字符串；model-visible ⟺ logged 不变。

## 备选方案

- **硬编码 `every-turn`。** 在 `api.deepseek.com` 上等价于 V4 的 400——RC-on-all 已被实盘证伪。在重新编码的网关上等同于不带策略。两种部署类都是真实且 in-box 的（经 `Config.baseURL` 配置的 OpenAI 兼容端点是有据可查的部署形态，并非误用），不存在与部署无关的默认值。
- **只硬编码 `last-assistant`，不带 Config 开关。** 对称论证：网关部署将彻底失去支持。
- **根据 `baseURL` 判断。** 一个端点是否会转发给其他厂商，无法从主机名读出：内部端点可能直连代理 DeepSeek，公网端点也可能转发。适配器只能对自己看不透的部署方式做猜测。
- **改为持久化签名，如 `dsh-llm-pi-ai` 的做法。** 该适配器在 replay state 中按块持久化 `thinkingSignature`，因为它的提供方会把签名放在协议里。DeepSeek chat-completions 不暴露签名，所以这个适配器没有可持久化的东西，回放文本是唯一通道。Config 开关接受「网关耦合由部署知晓」这一前提，不把它编码进协议。
- **用不同名字的 Config 开关（只允许 opt-out `every-turn`）。** 在 `api.deepseek.com` 上仍然 400，而非静默降级；而 `every-turn` 在用不上的位置是惰性的，最便宜的形态——所以 opt-out 默认同样不对。当前默认遵从的是协议钉死的端点规范。

## 后果

在 `api.deepseek.com` 上，多工具轮次的思考会话默认就能成功回放；该字段只出现在最新的 assistant 上——更早的轮次不再把自己的推理回放到 API，这是网关协议规则可以接受的代价。需要签名恢复契约的网关部署用 `reasoningPassback: 'every-turn'` 显式开启；在 `api.deepseek.com` 上误选它会立刻收到 400，而非静默失败。工具调用参数（单 JSON 对象或 `'{}'`）的协议层修复独立于此，两种策略下都生效。

`WireAssistantMessage.reasoning_content` 记录了两种端点行为。包 README 的「Known Limitations and Deferred Work」列出新增的 Config 字段，`dsh-llm-deepseek/serialize` 模块文档在开头陈述策略。

## 测试

`tests/serialize.spec.ts` 在默认 `last-assistant` 策略下，钉住三种 assistant 形态：单条（即最新的）assistant 携带 RC；中间的 assistant 省略它而最后一条回放它；无推理的工具调用轮次携带 `reasoning_content: ''`；纯推理轮次携带推理文本且 `content: ''`。`every-turn` 变体钉住：每条带推理的 assistant（无论是否调用工具）都携带 RC；无推理轮次省略；中间不带推理的 assistant 仍然被跳过（长度门控）。`serializeRequest` 测试确认 `RequestDefaults.reasoningPassback` 流入协议输出；省略时的默认测试确认 `last-assistant` 是入口默认。一次真实的两工具步 `dsh --profile headless` 对实盘 `api.deepseek.com` V4（0813）API 的跑通，替代了原先 400 的结果。

已被取代的论证：
- `2026-08-15-deepseek-v4-reasoning-replay-last-assistant`——已归档；V4 规则以默认策略的形式保留。
- `2026-08-19-deepseek-reasoning-passback-every-turn`——已归档；网关契约以 `every-turn` 可选形态保留。