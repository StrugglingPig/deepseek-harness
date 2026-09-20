---
description: "实验性金融研究工具：统一 fixture 快照、确定性技术指标、多指标汇总和 Markdown 报告，供 Agent Team 与 Workflow 研究会话使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-finance-research

English | [中文](README.md)

## 概述

`dsh-experimental-finance-research` 为金融研究会话提供一条从数据到报告的路径，可使用确定性 fixture、实时公共 HTTP 和 WebSocket Provider。它加载股票、加密货币和预测市场的统一快照，计算技术指标和加权多指标汇总，构建结构化 Markdown 报告，提供通用 Provider 请求、只读 Binance 私有账户读取和有界实时 WebSocket 事件。确定性监控规划器会为盘前、盘后和 BTC 24/7 检查返回 `schedule_create` 参数。

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

在具备 `ctx.tools` 的 Profile 或 Agent 组合中挂载本包。包会注册标准化工具 `finance_market_snapshot`、`finance_technical_analysis`、`finance_research_report`、`finance_private_account` 和 `finance_monitor_plan`；当对应 Provider seam 可用时，还会注册 `finance_provider_describe`、`finance_provider_request` 和 `finance_realtime_stream`。可以在 Workflow 报告流水线或 Agent Team 研究会话中使用；工具不依赖任何一种编排机制。

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
| `binanceBaseUrl` | `https://api.binance.com` | Binance Spot REST origin |
| `binanceUsdmBaseUrl` | `https://fapi.binance.com` | Binance USD-M Futures REST origin |
| `binanceCoinmBaseUrl` | `https://dapi.binance.com` | Binance COIN-M Futures REST origin |
| `binanceOptionsBaseUrl` | `https://eapi.binance.com` | Binance Options REST origin |
| `polymarketGammaBaseUrl` | `https://gamma-api.polymarket.com` | Polymarket Gamma origin |
| `polymarketClobBaseUrl` | `https://clob.polymarket.com` | Polymarket CLOB origin |

生成的 [configuration catalog](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-finance-research) 是完整字段参考。

### Provider-native requests

使用 `provider: http` 时，先调用 `finance_provider_describe` 发现已配置 base、认证模式和上游文档；再调用 `finance_provider_request`，传入 base、上游 path、method 和 Provider 原生 query/body 参数。

Provider 不强制 endpoint whitelist。能获取哪些信息取决于上游 API、凭据、限流、账户权限、网络策略和适用条款。Binance Spot、USD-M Futures、COIN-M Futures、Options、Yahoo Finance、Polymarket Gamma 和 Polymarket CLOB 被配置为不同 base。

示例：

```json
{ "base": "binance-spot", "path": "/api/v3/exchangeInfo", "query": { "permissions": "SPOT" } }
{ "base": "binance-usdm", "path": "/fapi/v1/fundingRate", "query": { "symbol": "BTCUSDT" } }
{ "base": "yahoo", "path": "/v8/finance/chart/AAPL", "query": { "range": "1mo", "interval": "1d" } }
{ "base": "polymarket-clob", "path": "/book", "query": { "token_id": "<token-id>" } }
```

工具原样返回上游 status 和 JSON。标准化 `load()` 只是技术指标和报告的便捷适配层，不限制通用 Provider 能力。

### What each tool returns

`finance_market_snapshot` 返回统一标的、报价、K 线数量、Provider、synthetic 标记，以及存在时的预测市场字段。`finance_technical_analysis` 返回 SMA、EMA、RSI、MACD、ATR、Bollinger Bands、OBV、五个加权信号、冲突和综合评分。`finance_research_report` 返回结构化章节以及 Markdown 报告，报告第一行是标题。`finance_provider_describe` 返回已配置 origin 和认证模式。`finance_provider_request` 返回上游 status 和 JSON 值。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

包将数据、凭据、传输、分析、报告构建、调度和工具注册分离。`FixtureFinanceMarketDataProvider` 从种子整数序列生成 K 线；`HttpFinanceMarketDataProvider` 增加缓存、按 origin 限流、有界重试、签名请求、私有账户标准化和通用 Provider 访问；`BinanceWebSocketStreamProvider` 采集有界组合流事件；`monitor.ts` 计算调度计划；`indicators.ts` 计算纯函数；`report.ts` 构建章节；`index.ts` 映射模型可见 Schema。本包不发布 runtime invariant companion，因为不拥有独立可变关系：工具对 Provider 输入保持纯函数，注册释放由 Registry 负责。

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

模型最多看到八个生成的工具 Schema；其规范形态遵循 [tool catalog package map](../../../docs/tool-catalog.zh.md#tool-package-map)，而本实验包在 `src/index.ts` 中声明精确 Schema。`finance_market_snapshot`、`finance_technical_analysis` 和 `finance_research_report` 覆盖标准化研究；`finance_provider_describe` 与 `finance_provider_request` 暴露 Provider base 和通用传输；`finance_private_account` 返回标准化只读 Binance 余额、持仓和可选未成交订单；`finance_realtime_stream` 返回有界 WebSocket 事件；`finance_monitor_plan` 返回调度参数。结果使用紧凑 canonical JSON 渲染，报告结果除外，它包含完整 Markdown 报告。

#### Token effect

这些 Schema 在挂载期间增加固定请求前缀成本。工具结果只在报告中随 K 线数量增长；快照、分析、私有账户、实时流和监控结果是受限摘要。完整报告在普通 compaction 前保留在调用 Session 中。

#### KV Cache effect

工具定义及其可见性不变时前缀稳定。工具调用和结果追加在可复用请求前缀之后，不使已有缓存条目失效。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Default data is synthetic** — 默认 Provider 是确定性合成数据；实时数据需要 `provider: http`。
- **Live provider depends on public endpoints** — Yahoo Finance、Binance 和 Polymarket 的可用性、限流、条款和字段变化不受本包控制。
- **Normalized crypto snapshots are explicit** — 归一化 `load()` 路径映射 `BTC` 和 `ETH`；其他 Binance 符号通过 `finance_provider_request` 查询。
- **Provider-native data is upstream JSON** — 结果遵循 Provider 字段名、响应结构、限流、认证和端点可用性，而不是本包的统一快照 Schema。
- **私有账户只读** — 签名 Binance 请求限制为 GET/query 端点；不提供下单、撤单或提现操作。
- **监控采用规划器模式** — `finance_monitor_plan` 返回可持久化的 `schedule_create` 参数；盘前和盘后是一次性检查，报告后请求下一时段。
- **Web 仪表盘是独立插件** — 实时图表在浏览器读取公共 Binance Spot 数据；私有账户数据仍只保留在 Host。
- **Shared tool surface** — 同一组合中的每个 Agent Team 成员和 Workflow 子 Agent 都看到相同的金融工具；本包不提供按职责隔离工具。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
