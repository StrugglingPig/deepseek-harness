---
description: "实验性金融研究工具：统一 fixture 快照、确定性技术指标、多指标汇总和 Markdown 报告，供 Agent Team 与 Workflow 研究会话使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-finance-research

English | [中文](README.md)

## 概述

`dsh-experimental-finance-research` 为金融研究会话提供一条确定性的“数据到报告”路径。它从确定性 fixture Provider 或公共 HTTP Provider 加载股票、加密货币和预测市场的统一快照，计算技术指标和加权多指标汇总，并构建结构化 Markdown 报告。三个工具面向模型；计算和报告代码是插件内部的普通 TypeScript。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

在具备 `ctx.tools` 的 Profile 或 Agent 组合中挂载本包。包会注册 `finance_market_snapshot`、`finance_technical_analysis` 和 `finance_research_report`。可以在 Workflow 报告流水线或 Agent Team 研究会话中使用；工具不依赖任何一种编排机制。

```yaml
- name: '@deepseek-ai/dsh-experimental-finance-research'
```

默认 application 使用 `FixtureFinanceMarketDataProvider`。设置 `provider: http` 可通过 `HttpFinanceMarketDataProvider` 使用 Yahoo Finance、Binance 和 Polymarket；部署也可以调用 `registerFinanceTools(ctx, provider)` 替换为其他 `FinanceMarketDataProvider`。工具 Schema 和报告结构保持不变。

```yaml
- name: '@deepseek-ai/dsh-experimental-finance-research'
  config:
    provider: http
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | `fixture` | `fixture` 使用确定性本地数据；`http` 使用 Yahoo、Binance 和 Polymarket |
| `timeoutMs` | `15000` | 单次请求超时 |
| `barLimit` | `80` | 请求的最大实时历史 K 线数 |
| `yahooBaseUrl` | `https://query1.finance.yahoo.com` | Yahoo Finance origin |
| `binanceBaseUrl` | `https://api.binance.com` | Binance REST origin |
| `polymarketGammaBaseUrl` | `https://gamma-api.polymarket.com` | Polymarket Gamma origin |
| `polymarketClobBaseUrl` | `https://clob.polymarket.com` | Polymarket CLOB origin |

生成的 [configuration catalog](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-finance-research) 是完整字段参考。

### Supported instruments

fixture Provider 理解 `AAPL` 等股票符号、`BTC` 和 `ETH` 等加密货币符号，以及 `PREDICTION:FED-CUT` 等预测符号。HTTP Provider 将非预测、非 `BTC`/`ETH` 的符号视为 Yahoo 股票 ticker，使用 Binance 处理 `BTC` 和 `ETH`，并用 `PREDICTION:` 前缀后的 slug 解析 Polymarket 市场。

### What each tool returns

`finance_market_snapshot` 返回统一标的、报价、K 线数量、Provider、synthetic 标记，以及存在时的预测市场字段。`finance_technical_analysis` 返回 SMA、EMA、RSI、MACD、ATR、Bollinger Bands、OBV、五个加权信号、冲突和综合评分。`finance_research_report` 返回结构化章节以及 Markdown 报告，报告第一行是标题。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

包将数据、分析、报告构建和工具注册分离。`FixtureFinanceMarketDataProvider` 从种子整数序列生成 K 线；`indicators.ts` 计算纯函数；`report.ts` 从一个快照和一个分析构建章节；`index.ts` 注册三个工具并把内部值映射到模型可见 Schema。本包不发布 runtime invariant companion，因为不拥有独立可变关系：工具对 Provider 输入保持纯函数，注册释放由 Registry 负责。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent Teams subsystem](../../../docs/subsystems/agent-team.zh.md) — durable roster、mailbox 和共享 task board。
- [Workflow subsystem](../../../docs/subsystems/workflow.zh.md) — 脚本化 Subagent fan-out 和结构化输出。
- [Tool authoring reference](../../../docs/cookbook/adding-a-tool.zh.md) — 工具 Schema 和执行契约。
- [Experimental group map](../README.zh.md) — 周边实验性包集合。

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas and results

#### What the model sees

模型看到三个生成的工具 Schema；其规范形态遵循 [tool catalog package map](../../../docs/tool-catalog.zh.md#tool-package-map)，而本实验包在 `src/index.ts` 中声明精确 Schema。`finance_market_snapshot` 需要 `symbol`；`finance_technical_analysis` 需要 `symbol`；`finance_research_report` 需要 `symbol`，并接受可选 `question` 和 `horizon`。结果是 canonical JSON 值的紧凑文本渲染：快照渲染符号、价格、币种、K 线数量和 Provider；分析渲染符号、综合方向、置信度和冲突数量；报告渲染完整 Markdown 报告。

#### Token effect

三个 Schema 在挂载期间增加固定请求前缀成本。工具结果只在报告中随 K 线数量增长；快照和分析结果是受限摘要。完整报告在普通 compaction 前保留在调用 Session 中。

#### KV Cache effect

三个工具定义及其可见性不变时前缀稳定。工具调用和结果追加在可复用请求前缀之后，不使已有缓存条目失效。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Default data is synthetic** — 默认 Provider 是确定性合成数据；实时数据需要 `provider: http`。
- **Live provider depends on public endpoints** — Yahoo Finance、Binance 和 Polymarket 的可用性、限流、条款和字段变化不受本包控制。
- **Supported live crypto symbols are explicit** — HTTP Provider 映射 `BTC` 和 `ETH`；增加其他币种需要扩展 Provider 元数据。
- **Shared tool surface** — 同一组合中的每个 Agent Team 成员和 Workflow 子 Agent 都看到相同的金融工具；本包不提供按职责隔离工具。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
