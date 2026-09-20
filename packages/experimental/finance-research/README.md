---
description: "Experimental finance research tools: multi-asset market data, deterministic technical and methodology analysis, investor lenses, and Markdown/HTML reports for Agent Team and Workflow research sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-finance-research

English | [中文](README.zh.md)

## Summary

`dsh-experimental-finance-research` gives a finance research session a data-to-report path over fixture or live market providers. It loads normalized equity, crypto, and prediction-market snapshots, computes technical and methodology analysis, evaluates investor lenses, builds Markdown and interactive HTML reports, exposes generic provider requests, reads Binance private accounts and CoinMarketCap quotes, loads A-share data through AKShare or iFinD, collects bounded WebSocket events, and plans pre-market, after-hours, and BTC 24/7 monitoring.

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

Mount this package in a profile or agent composition that has `ctx.tools`. The package registers the normalized tools `finance_market_snapshot`, `finance_technical_analysis`, `finance_research_report`, `finance_report_export`, `finance_methodology_analysis`, `finance_strategy_catalog`, `finance_private_account`, and `finance_monitor_plan`, plus `finance_provider_describe`, `finance_provider_request`, `finance_coinmarketcap_quotes`, `finance_coinmarketcap_ohlcv`, `finance_realtime_stream`, and the mainland stock tools when their provider seams are available. Use it in a Workflow report pipeline or an Agent Team research session; the tools do not depend on either orchestration mechanism.

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

### Provider-native requests

With `provider: http`, call `finance_provider_describe` to discover configured bases, authentication mode, and upstream documentation. Then call `finance_provider_request` with a base, an upstream path, a method, and provider-native query or body parameters.

The provider does not enforce an endpoint whitelist. What can be obtained is limited by the upstream API, credentials, rate limits, account permissions, network policy, and applicable terms. Binance Spot, USD-M Futures, COIN-M Futures, Options, Yahoo Finance, Polymarket Gamma, Polymarket CLOB, and CoinMarketCap Pro are configured as separate bases. CoinMarketCap REST and WebSocket requests use the stored `FINANCE_COINMARKETCAP_API_KEY` credential; the key is sent only by the Host.

Examples:

```json
{ "base": "binance-spot", "path": "/api/v3/exchangeInfo", "query": { "permissions": "SPOT" } }
{ "base": "binance-usdm", "path": "/fapi/v1/fundingRate", "query": { "symbol": "BTCUSDT" } }
{ "base": "yahoo", "path": "/v8/finance/chart/AAPL", "query": { "range": "1mo", "interval": "1d" } }
{ "base": "polymarket-clob", "path": "/book", "query": { "token_id": "<token-id>" } }
```

The tool returns the upstream status and JSON value unchanged. Normalized `load()` remains a convenience adapter for indicators and reports; it does not cap the generic provider surface.

### What each tool returns

`finance_market_snapshot` returns the normalized instrument, quote, bar count, provider, synthetic flag, and prediction-market fields when present. `finance_technical_analysis` returns SMA, EMA, RSI, MACD, ATR, Bollinger Bands, OBV, five weighted signals, conflicts, and a composite score. `finance_methodology_analysis` returns data-backed methodology readings, execution status, investor lenses, and a synthesis prompt. `finance_strategy_catalog` returns category, logic, quant suitability, data requirements, and execution status for each tracked strategy. `finance_research_report` returns structured sections plus Markdown and interactive HTML. `finance_report_export` writes the Markdown and HTML files when `ctx.fs` is available. The mainland stock report and export tools provide the same pair for A-share research.

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

The model sees up to eighteen generated tool schemas; their canonical shape follows the [tool catalog package map](../../../docs/tool-catalog.md#tool-package-map), while this experimental package declares the exact schemas in `src/index.ts`. `finance_market_snapshot`, `finance_technical_analysis`, `finance_research_report`, `finance_methodology_analysis`, `finance_strategy_catalog`, and `finance_report_export` cover normalized research and delivery; `finance_provider_describe` and `finance_provider_request` expose configured provider bases and transport; `finance_private_account` returns normalized read-only Binance balances, positions, and optional open orders; `finance_coinmarketcap_quotes` and `finance_coinmarketcap_ohlcv` expose normalized CoinMarketCap market data; `finance_realtime_stream` returns a bounded Binance or CoinMarketCap WebSocket event batch; `finance_stock_snapshot`, `finance_stock_quote`, `finance_stock_technical_analysis`, `finance_stock_methodology_analysis`, `finance_stock_research_report`, and `finance_stock_report_export` cover AKShare and iFinD mainland stock data; `finance_monitor_plan` returns scheduler arguments. Results are compact canonical JSON renderings, except reports, which contain complete Markdown and interactive HTML.

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
- **Stock data depends on provider access** — AKShare requires the Python package `akshare`. iFinD HTTP uses an authorized account refresh token; iFinD local uses the vendor `iFinDPy` SDK and account credentials. Missing dependencies, credentials, permissions, or data quotas fail explicitly.
- **The Web dashboard is a separate plugin** — the dashboard reads the Host market route and can render crypto, A-share, and US-equity charts through `lightweight-charts`; private account data remains Host-only.
- **Methodology coverage is explicit** — deterministic methods run only when their required data is present; wave counts, Wyckoff, cross-sectional factors, statistical arbitrage, machine learning, and microstructure methods remain catalog entries requiring additional inputs or models.
- **Shared tool surface** — every Agent Team member and Workflow child in the same composition sees the same finance tools; the package does not provide per-role tool isolation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
