---
description: "实验性金融研究工具：多资产行情、确定性技术和方法论分析、投资大师透镜，以及 Markdown/HTML 报告，供 Agent Team 与 Workflow 研究会话使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-finance-research

English | [中文](README.md)

## 概述

`dsh-experimental-finance-research` 为金融研究会话提供一条从数据到报告的路径，可使用确定性 fixture、实时公共 HTTP 和 WebSocket Provider。它加载股票、加密货币和预测市场的统一快照，计算技术指标和加权多指标汇总，评估策略目录和投资大师透镜，构建结构化 Markdown 与交互式 HTML 报告，提供通用 Provider 请求、只读 Binance 私有账户读取、CoinMarketCap 行情与 OHLCV 数据，通过 AKShare、同花顺 iFinD HTTP API 或本机 iFinDPy SDK 加载中国 A 股历史行情和实时行情，以及有界 Binance 或 CoinMarketCap 实时 WebSocket 事件。确定性监控规划器会为盘前、盘后和 BTC 24/7 检查返回 `schedule_create` 参数。

## 宏观数据

本包从四个上游读取宏观序列，并通过 `finance_macro_snapshot` 与 `finance_macro_catalog` 暴露：

| 上游 | 覆盖 | 凭据 |
|---|---|---|
| FRED | 美国长序列：政策利率、实际利率、信用利差、PCE、非农、美元指数、WTI | 免费 API Key，并在金融设置中打开 FRED 开关 |
| AKShare | 中国：GDP、PMI、CPI/PPI、M2、社融、新增贷款、房地产、外贸、外储 | 无需凭据，复用本地 Python 桥 |
| World Bank | 年度跨国与全球面板（GDP 增速、通胀、失业、债务、经常账户、贸易） | 无需凭据 |
| IMF DataMapper | 年度全球面板，含 `WEOWORLD` 全球合计 | 无需凭据 |

`finance_macro_catalog` 返回指标 id、单位、频率、周期属性（领先/同步/滞后）、传导解读、影响资产，以及该序列可用的上游绑定。`finance_macro_snapshot` 按这些绑定解析请求：`source: auto` 会读取全部绑定上游，保留其中发布期次最新的一个，因此实际选用的源取决于各上游当前的数据，而不是写死的目录顺序。请求带上周期区间时改为保留覆盖最全的序列，显式指定 `source` 则按指定执行。失败的上游会记录在逐指标的 `errors` 中，与成功加载的序列一并返回。观测值保持上游原始口径——季度与年度序列不会被重采样。当某个绑定的口径与目录主口径不同时（例如事件表给出月度变化、FRED 给出指数水平），该绑定会声明自己的单位；IMF 中晚于当前年份的值会带 `projection: true`，避免把预测当成已发生的事实。

每份报告都会在标的之外带上宏观前提：`finance_research_report`、`finance_report_export` 与 A 股报告工具固定加载一组政策利率、收益率曲线、信用利差、通胀、就业与中国货币信贷序列，渲染到宏观驱动章节；除快评与日报两种短形态外，每个分类的其余形态都会规划该章节；某个上游取不到的序列会被跳过，而不是让报告失败。

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

在具备 `ctx.tools` 的 Profile 或 Agent 组合中挂载本包。包会注册标准化工具 `finance_market_snapshot`、`finance_technical_analysis`、`finance_research_report`、`finance_report_types`、`finance_report_export`、`finance_methodology_analysis`、`finance_strategy_catalog`、`finance_private_account` 和 `finance_monitor_plan`；当对应 Provider seam 可用时，还会注册 `finance_provider_describe`、`finance_provider_request`、`finance_coinmarketcap_quotes`、`finance_coinmarketcap_ohlcv`、`finance_realtime_stream` 和 A 股工具。可以在 Workflow 报告流水线或 Agent Team 研究会话中使用；工具不依赖任何一种编排机制。

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
| `reportLanguage` | `auto` | `auto` 先跟随浏览器上报的语言，其次用户语言设置与系统语言；`en` 或 `zh` 固定报告语言 |
| `uiLocale` | 未设置 | 浏览器插件为 `auto` 上报的当前语言，由面板写入，不需要手工设置 |
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

### 报告语言

`reportLanguage` 默认为 `auto`：报告先跟随金融面板上报的当前界面语言，其次跟随用户在“设置 → 通用”中选择的语言，再跟随 Host 系统语言（依次取 `LC_ALL`、`LC_MESSAGES`、`LANG`，再取 ICU 默认值），最后回退英文。无界面运行可用 `reportLanguage: en` 或 `zh` 固定语言。只有报告产物及其 HTML 界面文案会本地化；工具结果保持规范英文，避免模型可见契约、Prompt 缓存和录制快照随界面语言变化。

### Provider-native requests

使用 `provider: http` 时，先调用 `finance_provider_describe` 发现已配置 base、认证模式和上游文档；再调用 `finance_provider_request`，传入 base、上游 path、method 和 Provider 原生 query/body 参数。

数据源按字段组合，而不是按失败切换。不同上游各自负责的字段——价格与 K 线、已披露财务、行情与供给、社区与开发活跃度——会向所有发布该字段的上游请求并合并，因此某个上游故障只会丢掉它自己那部分字段，且每条指标仍然标注来源。当多个上游覆盖同一字段时，按新鲜度与完整度整体选取一条序列，而不是拼接，因为复权口径与交易日历等约定不同。A 股工具支持 `provider: auto`，按顺序尝试所有已启用的上游并保留第一个应答者。

Provider 不强制 endpoint whitelist。能获取哪些信息取决于上游 API、凭据、限流、账户权限、网络策略和适用条款。Binance Spot、USD-M Futures、COIN-M Futures、Options、Yahoo Finance、Polymarket Gamma、Polymarket CLOB、CoinMarketCap Pro、CoinGecko、GitHub 与 Finnhub 被配置为不同 base。CoinMarketCap 的 REST 与 WebSocket 请求使用存储的 `FINANCE_COINMARKETCAP_API_KEY`，CoinGecko 社区数据使用 `FINANCE_COINGECKO_API_KEY`，GitHub 读取使用可选的 `FINANCE_GITHUB_TOKEN`，美股基本面使用 `FINANCE_FINNHUB_API_KEY`；所有密钥都只由 Host 发送，CoinGecko 开关默认关闭，GitHub 无 token 也能读取公开仓库。

示例：

```json
{ "base": "binance-spot", "path": "/api/v3/exchangeInfo", "query": { "permissions": "SPOT" } }
{ "base": "binance-usdm", "path": "/fapi/v1/fundingRate", "query": { "symbol": "BTCUSDT" } }
{ "base": "yahoo", "path": "/v8/finance/chart/AAPL", "query": { "range": "1mo", "interval": "1d" } }
{ "base": "polymarket-clob", "path": "/book", "query": { "token_id": "<token-id>" } }
```

工具原样返回上游 status 和 JSON。标准化 `load()` 只是技术指标和报告的便捷适配层，不限制通用 Provider 能力。

### 报告类型与模板

报告由两个维度组合而成：研究**分类**与报告**形态**。八个分类覆盖宏观、行业、股票、基金与 ETF、债券与信用、商品与外汇、加密资产、策略与专题；十种形态覆盖快评、日报、周报、月报、深度报告、专题报告、事件点评、财报点评、配置报告和数据报告。当前提供 33 个分类/形态组合，每个组合有自己的章节计划、研究重点和数据需求；调用 `finance_report_types` 可以列出，并把 id 作为 `report_type` 传给 `finance_research_report`、`finance_report_export` 或对应的 A 股工具。省略 `report_type` 时选择该标的家族的深度报告。

每个计划由头部、分类区块、主体与尾部组成。头部先给投资结论——立场、支撑证据、推翻条件，以及仍然缺失的输入——再是宏观背景；分类区块承载基本面，主体承载技术面。当前快照能回答的区块输出确定性数字；缺少输入的区块改为列出所需输入和它会回答的问题，而不是编造内容。定制模板时修改 `src/report-types.ts` 中该分类的区块列表，以及 `src/report-copy.ts` 中的文案；指标文案按「构建器可能产出的 key」做了封闭类型，新增指标若缺中英文文案会直接构建失败。


### What each tool returns

`finance_market_snapshot` 返回统一标的、报价、K 线数量、Provider、synthetic 标记，以及存在时的预测市场字段。`finance_technical_analysis` 返回 SMA、EMA、RSI、MACD、ATR、Bollinger Bands、OBV、五个加权信号、冲突和综合评分。`finance_methodology_analysis` 返回有数据支撑的方法论读数、执行状态、投资大师透镜和综合提示。`finance_strategy_catalog` 返回每个策略的类别、逻辑、量化适配度、数据要求和执行状态。`finance_report_types` 返回报告类型目录，包含分类、形态、章节计划、研究重点和数据需求。`finance_research_report` 返回解析后的报告类型、结构化章节、Markdown 和交互式 HTML。`finance_report_export` 在 `ctx.fs` 可用时写入 Markdown 和 HTML 文件；A 股报告与导出工具提供同样的文件对。

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

模型最多看到十九个生成的工具 Schema；其规范形态遵循 [tool catalog package map](../../../docs/tool-catalog.zh.md#tool-package-map)，而本实验包在 `src/index.ts` 中声明精确 Schema。`finance_market_snapshot`、`finance_technical_analysis`、`finance_research_report`、`finance_methodology_analysis`、`finance_strategy_catalog` 和 `finance_report_export` 覆盖标准化研究与交付；`finance_provider_describe` 与 `finance_provider_request` 暴露 Provider base 和通用传输；`finance_private_account` 返回标准化只读 Binance 余额、持仓和可选未成交订单；`finance_coinmarketcap_quotes` 和 `finance_coinmarketcap_ohlcv` 暴露标准化 CoinMarketCap 行情数据；`finance_realtime_stream` 返回有界 Binance 或 CoinMarketCap WebSocket 事件；`finance_stock_snapshot`、`finance_stock_quote`、`finance_stock_technical_analysis`、`finance_stock_methodology_analysis`、`finance_stock_research_report` 和 `finance_stock_report_export` 覆盖 AKShare 与 iFinD A 股数据；`finance_monitor_plan` 返回调度参数。结果使用紧凑 canonical JSON 渲染，报告结果除外，它包含完整 Markdown 和交互式 HTML。

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
- **上游被拦截属于传输层问题，不是本包的配置项** — launcher 会在插件挂载前为整个进程安装唯一一套出站代理策略，因此被本网络拦截的 Yahoo、CoinGecko、CoinMarketCap 由该策略转发，而不是由本包控制；请在 `~/.dsh/.env` 中设置 `HTTPS_PROXY`，并注意 launcher 会拒绝仓库 `.env` 里的代理变量，避免某个 checkout 重定向出口流量。
- **监控采用规划器模式** — `finance_monitor_plan` 返回可持久化的 `schedule_create` 参数；盘前和盘后是一次性检查，报告后请求下一时段。
- **CoinMarketCap 受套餐和 Credits 限制** — API Key 必须在金融设置中启用，WebSocket 能力取决于账户套餐和 Credits。
- **CoinGecko 社区数据需要免费 API Key** — 在金融设置中打开开关并保存密钥；未配置时币圈报告保留市场章节，并列出仍缺少的社区输入。
- **仓库活跃度受 GitHub 限流影响** — 社区区块会读取 CoinGecko 关联的仓库，未认证的 GitHub 请求按来源地址共享每小时 60 次限额。
- **A 股估值取自百度股市通、行业基准取自巨潮** — 估值区块读取市盈率、市净率与市值，行业区块读取公开的行业市盈率，因为东财的公司概况接口并非所有网络都能访问。
- **单源字段各有备用源** — 币圈行情在 CoinMarketCap 失败时回退到 CoinGecko；A 股财务在指标表不可用时回退到同花顺表。
- **美股基本面需要 Finnhub Key** — 在金融设置中打开开关并保存密钥；免费档每分钟 60 次请求，并附带同业公司列表，用于填充竞争格局章节。未配置时美股报告保留价格、宏观与技术面章节。
- **股票数据依赖 Provider 访问权限** — AKShare 需要安装 Python 包 `akshare`。iFinD HTTP 使用已授权账号的 refresh token；iFinD local 使用厂商 `iFinDPy` SDK 和账号/密码。依赖、凭据、权限或数据额度缺失时会显式失败。
- **报告语言目前只有 `en` 和 `zh`** — `auto` 会把其他语言标签解析为英文；新增语言需要先提供对应报告词典。
- **Web 仪表盘是独立插件** — 仪表盘从 Connection 的认证精确路由注册表读取 `/api/finance-dashboard/market`，并通过 `lightweight-charts` 渲染加密货币、A 股和美股图表；只有组合提供 Connection 时该路由才注册，私有账户数据仍只保留在 Host。
- **方法论覆盖状态是显式的** — 只有所需数据存在时确定性方法才会运行；波浪计数、Wyckoff、横截面因子、统计套利、机器学习和微观结构方法仍作为需要额外输入或模型的目录项。
- **Shared tool surface** — 同一组合中的每个 Agent Team 成员和 Workflow 子 Agent 都看到相同的金融工具；本包不提供按职责隔离工具。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
