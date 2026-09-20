# Agent Note: Experimental finance research agent

Status: implemented

[English](2026-09-20-finance-research-agent.md) | 中文

## Problem

Harness 已经具备持久 Agent Team、Workflow 编排、网页访问、后台任务和交付物能力，但没有金融领域包。金融研究会话因此缺少统一的市场数据词汇、确定性的指标计算和报告构建器。直接复用 Team 工具会让模型承担数值计算，既不可复现，也无法审计。

## Decision

`@deepseek-ai/dsh-experimental-finance-research` 提供一条无需密钥的研究垂直切片：面向股票、加密货币和预测市场的统一市场快照；确定性的技术指标和多指标汇总；以及 Markdown 研究报告。它注册三个模型可见工具：

- `finance_market_snapshot` 返回统一标的、报价、K 线、来源和预测市场字段。
- `finance_technical_analysis` 计算 SMA、EMA、RSI、MACD、ATR、Bollinger Bands、OBV、方向信号、冲突和综合评分。
- `finance_research_report` 基于同一快照和指标结果生成报告，并返回结构化章节与 Markdown。

默认 Provider 是确定性 fixture。包同时提供 `HttpFinanceMarketDataProvider`，通过 Yahoo Finance、Binance 和 Polymarket 实现同一接口，并通过 `provider: http` 启用。组合包 `@deepseek-ai/dsh-experimental-finance-research-profile` 在 `dsh-base` 之上插入金融插件。它设计为在 `dsh-experimental-agent-team-profile` 之后安装：Team profile 保留 `workflow`，并用 `spawn_teammate` 取代直接 `subagent` 工具；金融插件只新增工具名和无状态计算，不会重新启用或覆盖任何 Team 行。

金融插件在当前 Bundle 中刻意放在 host 层。Agent Team teammate 和 Workflow 子 Agent 都能看到同样的三个工具；金融工具不依赖 `ctx.agentTeams`，也不依赖 Team Session。最终报告仍由 Lead 持有，因为只有 Lead Session 能通过 `present` 交付。Team-aware 示例 preset 和研究 Skill 位于 `apps/cli/config/examples/finance-research`；它们不挂载 legacy subagent 行，需要金融 persona 和研究方法时复制到用户 preset root。

## Alternatives considered

**修改 `dsh-base` 或 Agent Team profile。** 拒绝，因为金融是可选产品层。修改共享组合会把金融工具 schema 加进每个会话，并让 Team 包耦合到金融领域。

**立刻把金融包放进稳定产品分组。** 拒绝，因为首个 Provider 是确定性 fixture，且 Team 组合仍是实验性的。在真实 Provider 和评测集出现前，包继续使用 experimental 命名。

**先实现真实数据 Provider。** 拒绝，因为网络凭证和数据许可因部署而异，仓库无法确定性测试真实市场数据。Provider 接口固定替换点；fixture Provider 让研究链路可复现。

**只使用 Agent Team 编排。** 拒绝，因为一键报告需要 Workflow 的并行和结构化输出，交互研究需要持久 teammate。两种模式共用同一套金融工具。

**让模型推理指标。** 拒绝，因为 RSI、MACD、ATR、Bollinger Bands 和综合权重必须确定性、可测试，并在 replay 中保持一致。

## Consequences

该包证明了从数据到指标再到报告的链路，但不宣称覆盖真实市场数据。部署必须增加 Provider 适配器后才能用于真实投资研究。报告会把 fixture 数据标记为 synthetic，并不把输出表述为投资建议。

初始包不提供按职责隔离工具的能力。Agent Team 成员和 Workflow 子 Agent 共享其组合中可用的金融工具。需要为不同分析师提供不同工具的部署，应增加 Provider 或独立消费者，而不能把 Team roster 当作工具策略边界。

## Testing

包测试覆盖指标边界、确定性 fixture 生成、股票/加密货币/预测市场报告、通过真实 Loader 注册和释放工具，以及从工具到报告的完整路径。Bundle 是静态 patch；其 profile 集成由包清单和文档门禁验证。

## Related

- [Agent Teams](2026-08-05-agent-teams.zh.md)
- [Workflow](../../../../docs/subsystems/workflow.zh.md)
- [Agent presets](../../../../packages/preset/agent-presets/README.zh.md)
- [Tool authoring](../../../../docs/cookbook/adding-a-tool.zh.md)
