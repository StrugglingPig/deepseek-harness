---
description: "Experimental finance research tools: multi-asset market data, deterministic technical and methodology analysis, investor lenses, and Markdown/HTML reports for Agent Team and Workflow research sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-finance-research

English | [中文](README.zh.md)

## Summary

`dsh-experimental-finance-research` gives a finance research session a data-to-report path over fixture or live market providers. It loads normalized equity, crypto, and prediction-market snapshots, computes technical and methodology analysis, evaluates investor lenses, builds Markdown and interactive HTML reports, exposes generic provider requests, reads Binance private accounts and CoinMarketCap quotes, loads A-share data through AKShare or iFinD, collects bounded WebSocket events, and plans pre-market, after-hours, and BTC 24/7 monitoring.

## Macro data

The package reads macro series from four upstreams and exposes them through `finance_macro_snapshot` and `finance_macro_catalog`:

| Upstream | Coverage | Credential |
|---|---|---|
| FRED | Long US history: policy rate, real yields, credit spreads, PCE, payrolls, the dollar, WTI | Free API key, plus the FRED switch in Finance settings |
| AKShare | China: GDP, PMI, CPI/PPI, M2, total social financing, new loans, property, trade, FX reserves | None; reuses the local Python bridge |
| World Bank | Annual cross-country and global panels (GDP growth, inflation, unemployment, debt, current account, trade) | None |
| IMF DataMapper | Annual global panel, including the `WEOWORLD` aggregate | None |

`finance_macro_catalog` returns the indicator id, unit, frequency, cycle timing, transmission reading, affected assets, and the upstreams bound to each series. `finance_macro_snapshot` resolves a request across those bindings: `source: auto` reads every bound upstream and keeps the one publishing the latest period, so the resolved source follows what each upstream currently holds rather than a fixed catalog order. A request that names a date range keeps the widest coverage instead, and an explicit `source` is honoured as given. An upstream that fails is recorded in a per-indicator `errors` list beside the series that did load. Observations stay upstream-as-published — quarterly and annual series are not resampled. A binding that reports a different measure than the catalog's primary one (for example an event table publishing a monthly change where FRED publishes an index level) declares its own unit, and IMF values for years beyond the current one carry `projection: true` so a forecast is never read as an outcome.

Every report carries the macro precondition for its instrument: `finance_research_report`, `finance_report_export`, and the A-share report tools load a fixed panel of policy-rate, yield-curve, credit-spread, inflation, employment, and China money-and-credit series and render them into the macro-drivers block, which every category plans in every form except the short flash and daily notes. A series an upstream cannot serve is skipped rather than failing the report.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package in a profile or agent composition that has `ctx.tools`. The package registers the normalized tools `finance_market_snapshot`, `finance_technical_analysis`, `finance_research_report`, `finance_report_types`, `finance_report_export`, `finance_methodology_analysis`, `finance_strategy_catalog`, `finance_private_account`, and `finance_monitor_plan`, plus `finance_provider_describe`, `finance_provider_request`, `finance_coinmarketcap_quotes`, `finance_coinmarketcap_ohlcv`, `finance_realtime_stream`, and the mainland stock tools when their provider seams are available. Use it in a Workflow report pipeline or an Agent Team research session; the tools do not depend on either orchestration mechanism.

```yaml
- name: '@deepseek-ai/dsh-experimental-finance-research'
```

The default application uses `FixtureFinanceMarketDataProvider`. Set `provider: http` to use Yahoo Finance, Binance, and Polymarket through `HttpFinanceMarketDataProvider`; a deployment can also call `registerFinanceTools(ctx, provider)` with another `FinanceMarketDataProvider`. The tool schemas and report remain unchanged.

```yaml
- name: '@deepseek-ai/dsh-experimental-finance-research'
  config:
    provider: http
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | `fixture` | `fixture` keeps deterministic local data; `http` uses Yahoo, Binance, and Polymarket |
| `reportLanguage` | `auto` | `auto` follows the language the browser publishes, then the stored preference and system locale; `en` or `zh` pins the report language |
| `uiLocale` | unset | Locale the browser plugin publishes for `auto`; set from the panel, not by hand |
| `timeoutMs` | `15000` | Per-request timeout |
| `barLimit` | `80` | Maximum live history bars requested |
| `yahooBaseUrl` | `https://query1.finance.yahoo.com` | Yahoo Finance origin |
| `binanceBaseUrl` | `https://api.binance.com` | Binance Spot REST origin |
| `binanceUsdmBaseUrl` | `https://fapi.binance.com` | Binance USD-M Futures REST origin |
| `binanceCoinmBaseUrl` | `https://dapi.binance.com` | Binance COIN-M Futures REST origin |
| `binanceOptionsBaseUrl` | `https://eapi.binance.com` | Binance Options REST origin |
| `polymarketGammaBaseUrl` | `https://gamma-api.polymarket.com` | Polymarket Gamma origin |
| `polymarketClobBaseUrl` | `https://clob.polymarket.com` | Polymarket CLOB origin |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-finance-research) is the exhaustive field reference.

### Report language

`reportLanguage` defaults to `auto`: the report follows the locale the finance panel publishes (the language the user currently sees), then the locale selected in Settings → General, then the host system locale (`LC_ALL`, `LC_MESSAGES`, `LANG`, then the ICU default), and finally English. Set `reportLanguage: en` or `zh` to pin one language for headless runs. Only the report artifact and its HTML chrome are localized; tool results stay canonical English so model-facing contracts, prompt caching, and recorded snapshots do not shift with the interface language.

### Provider-native requests

With `provider: http`, call `finance_provider_describe` to discover configured bases, authentication mode, and upstream documentation. Then call `finance_provider_request` with a base, an upstream path, a method, and provider-native query or body parameters.

Sources combine by field rather than by failover. Fields that different upstreams own — price and bars, reported fundamentals, market and supply, community and developer activity — are requested from every upstream that publishes them and merged, so a failing upstream removes only its own fields and every metric still names the source it came from. When several upstreams cover the same field, one whole series is selected by freshness and completeness instead of being stitched together, because conventions such as price adjustment and trading calendars differ. The A-share tools accept `provider: auto` to try every enabled upstream in order and keep the first that answers.

The provider does not enforce an endpoint whitelist. What can be obtained is limited by the upstream API, credentials, rate limits, account permissions, network policy, and applicable terms. Binance Spot, USD-M Futures, COIN-M Futures, Options, Yahoo Finance, Polymarket Gamma, Polymarket CLOB, CoinMarketCap Pro, CoinGecko, GitHub, and Finnhub are configured as separate bases. CoinMarketCap REST and WebSocket requests use the stored `FINANCE_COINMARKETCAP_API_KEY` credential, CoinGecko community reads use `FINANCE_COINGECKO_API_KEY`, GitHub reads use the optional `FINANCE_GITHUB_TOKEN`, and US equity fundamentals use `FINANCE_FINNHUB_API_KEY`; every key is sent only by the Host, the CoinGecko switch is off by default, and GitHub serves public repositories without a token.

Examples:

```json
{ "base": "binance-spot", "path": "/api/v3/exchangeInfo", "query": { "permissions": "SPOT" } }
{ "base": "binance-usdm", "path": "/fapi/v1/fundingRate", "query": { "symbol": "BTCUSDT" } }
{ "base": "yahoo", "path": "/v8/finance/chart/AAPL", "query": { "range": "1mo", "interval": "1d" } }
{ "base": "polymarket-clob", "path": "/book", "query": { "token_id": "<token-id>" } }
```

The tool returns the upstream status and JSON value unchanged. Normalized `load()` remains a convenience adapter for indicators and reports; it does not cap the generic provider surface.

### Report types and templates

Reports are composed from a two-dimensional taxonomy: a research **category** and a report **form**. Eight categories cover macro, industry, equity, fund and ETF, rates and credit, commodity and FX, crypto, and strategy; ten forms cover flash note, daily, weekly, monthly, deep dive, thematic, event review, earnings review, allocation, and data report. Thirty-three category/form pairs ship today, each with its own section plan, research focus, and data requirements; call `finance_report_types` to list them and pass the id as `report_type` on `finance_research_report`, `finance_report_export`, or their A-share counterparts. Omitting `report_type` selects the instrument family's deep dive.

Every plan is built from a head, the category's own blocks, a body, and a tail. The head opens with the investment view — the stance, the evidence behind it, what would change it, and the inputs still missing — then the macro backdrop; the category blocks carry fundamentals, and the body carries the technical read. Blocks that the current snapshot can answer render deterministic numbers; blocks that need inputs the snapshot lacks render the missing inputs and the questions they would answer instead of fabricated content. Customize a template by editing the category's block list in `src/report-types.ts` and its copy in `src/report-copy.ts`; the instrument-metric labels are typed against the keys the builders can emit, so a new metric without its label in both languages fails the build.


### What each tool returns

`finance_market_snapshot` returns the normalized instrument, quote, bar count, provider, synthetic flag, and prediction-market fields when present. `finance_technical_analysis` returns SMA, EMA, RSI, MACD, ATR, Bollinger Bands, OBV, five weighted signals, conflicts, and a composite score. `finance_methodology_analysis` returns data-backed methodology readings, execution status, investor lenses, and a synthesis prompt. `finance_strategy_catalog` returns category, logic, quant suitability, data requirements, and execution status for each tracked strategy. `finance_report_types` returns the report type catalog with category, form, section plan, focus, and data requirements. `finance_research_report` returns the resolved report type, structured sections, Markdown, and interactive HTML. `finance_report_export` writes the Markdown and HTML files when `ctx.fs` is available. The mainland stock report and export tools provide the same pair for A-share research.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package separates data, credentials, transport, analysis, report construction, scheduling, and tool registration. `FixtureFinanceMarketDataProvider` generates bars from a seeded integer sequence; `HttpFinanceMarketDataProvider` adds cache, per-origin rate limiting, bounded retry, signed requests, private-account normalization, and generic provider access; `BinanceWebSocketStreamProvider` collects bounded combined-stream events; `monitor.ts` computes scheduler plans; `indicators.ts` computes pure functions; `report.ts` builds sections; `index.ts` maps internal values to the model-facing schemas. No runtime invariant companion is published because the package owns no independent mutable relationship: the tools are pure over their provider input, and the registry owns registration disposal.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent Teams subsystem](../../../docs/subsystems/agent-team.md) — durable roster, mailbox, and shared task board.
- [Workflow subsystem](../../../docs/subsystems/workflow.md) — scripted subagent fan-out and structured output.
- [Tool authoring reference](../../../docs/cookbook/adding-a-tool.md) — tool schema and execution contracts.
- [Experimental group map](../README.md) — the surrounding experimental package set.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas and results

#### What the model sees

The model sees up to nineteen generated tool schemas; their canonical shape follows the [tool catalog package map](../../../docs/tool-catalog.md#tool-package-map), while this experimental package declares the exact schemas in `src/index.ts`. `finance_market_snapshot`, `finance_technical_analysis`, `finance_research_report`, `finance_methodology_analysis`, `finance_strategy_catalog`, and `finance_report_export` cover normalized research and delivery; `finance_provider_describe` and `finance_provider_request` expose configured provider bases and transport; `finance_private_account` returns normalized read-only Binance balances, positions, and optional open orders; `finance_coinmarketcap_quotes` and `finance_coinmarketcap_ohlcv` expose normalized CoinMarketCap market data; `finance_realtime_stream` returns a bounded Binance or CoinMarketCap WebSocket event batch; `finance_stock_snapshot`, `finance_stock_quote`, `finance_stock_technical_analysis`, `finance_stock_methodology_analysis`, `finance_stock_research_report`, and `finance_stock_report_export` cover AKShare and iFinD mainland stock data; `finance_monitor_plan` returns scheduler arguments. Results are compact canonical JSON renderings, except reports, which contain complete Markdown and interactive HTML.

#### Token effect

The schemas add a fixed request-prefix cost while mounted. Tool results grow with the bar count only in the report result; snapshot, analysis, private-account, stream, and monitor results are bounded summaries. The full report remains in the calling Session until ordinary compaction.

#### KV Cache effect

Prefix-stable while the tool definitions and their visibility are unchanged. Tool calls and results append after the reusable request prefix and do not invalidate earlier cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Default data is synthetic** — the default provider is deterministic synthetic data; live data requires `provider: http`.
- **Live provider depends on public endpoints** — Yahoo Finance, Binance, and Polymarket availability, rate limits, terms, and field changes are outside this package's control.
- **Normalized crypto snapshots are explicit** — the normalized `load()` path maps `BTC` and `ETH`; other Binance symbols are available through `finance_provider_request`.
- **Provider-native data is upstream JSON** — results follow provider field names, response shapes, rate limits, authentication, and endpoint availability rather than this package's normalized snapshot schema.
- **Private account data is read-only** — signed Binance requests are limited to GET/query endpoints; order placement, cancellation, and withdrawal operations are not provided.
- **Monitoring is planner-based** — `finance_monitor_plan` returns durable `schedule_create` arguments; pre-market and after-hours checks are one-shot and request the next session after reporting.
- **CoinMarketCap access is plan- and credit-bound** — the upstream API key must be enabled in Finance settings, and WebSocket access follows the account plan and credit limits.
- **CoinGecko community data needs a free API key** — enable it and store the key in Finance settings; without it the crypto report keeps its market section and reports the community inputs it still needs.
- **Repository activity needs GitHub headroom** — the community block reads the repository CoinGecko links, and unauthenticated GitHub requests share a 60-per-hour limit per address.
- **A-share multiples come from Baidu and the industry baseline from CNINFO** — the valuation block reads P/E, P/B, and market cap, and the industry block reads the published industry P/E, because the Eastmoney profile endpoint is not reachable from every network.
- **Fallback sources cover the single-source fields** — crypto market rows fall back to CoinGecko when CoinMarketCap fails, and A-share fundamentals fall back to the Tonghuashun table when the indicator table is unavailable.
- **US fundamentals need a Finnhub key** — enable it and store the key in Finance settings; the free tier allows 60 requests per minute and also lists peer companies, which fill the competitive-position block. Without it a US equity report keeps its price, macro, and technical sections.
- **Stock data depends on provider access** — AKShare requires the Python package `akshare`. iFinD HTTP uses an authorized account refresh token; iFinD local uses the vendor `iFinDPy` SDK and account credentials. Missing dependencies, credentials, permissions, or data quotas fail explicitly.
- **Report languages are `en` and `zh`** — `auto` resolves any other locale tag to English; a new language needs its own report dictionary before it can be selected.
- **The Web dashboard is a separate plugin** — the dashboard reads `/api/finance-dashboard/market` from Connection's authenticated exact-route registry and renders crypto, A-share, and US-equity charts through `lightweight-charts`; the route registers only when the composition provides Connection, and private account data remains Host-only.
- **Methodology coverage is explicit** — deterministic methods run only when their required data is present; wave counts, Wyckoff, cross-sectional factors, statistical arbitrage, machine learning, and microstructure methods remain catalog entries requiring additional inputs or models.
- **Shared tool surface** — every Agent Team member and Workflow child in the same composition sees the same finance tools; the package does not provide per-role tool isolation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
