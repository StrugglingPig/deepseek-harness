---
description: "Experimental finance research tools: normalized fixture snapshots, deterministic technical indicators, multi-indicator synthesis, and Markdown reports for Agent Team and Workflow research sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-finance-research

English | [中文](README.zh.md)

## Summary

`dsh-experimental-finance-research` gives a finance research session a deterministic data-to-report path. It loads normalized equity, crypto, and prediction-market snapshots from either a deterministic fixture provider or public HTTP providers, computes technical indicators and a weighted multi-indicator summary, and builds a structured Markdown report. When the HTTP provider is active, `finance_provider_describe` and `finance_provider_request` expose a generic provider transport. Three tools are always registered; the provider tools are registered only for providers that implement `describe()` and `request()`.

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

Mount this package in a profile or agent composition that has `ctx.tools`. The package registers `finance_market_snapshot`, `finance_technical_analysis`, and `finance_research_report`. Use it in a Workflow report pipeline or an Agent Team research session; the tools do not depend on either orchestration mechanism.

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

The provider does not enforce an endpoint whitelist. What can be obtained is limited by the upstream API, credentials, rate limits, account permissions, network policy, and applicable terms. Binance Spot, USD-M Futures, COIN-M Futures, Options, Yahoo Finance, Polymarket Gamma, and Polymarket CLOB are configured as separate bases.

Examples:

```json
{ "base": "binance-spot", "path": "/api/v3/exchangeInfo", "query": { "permissions": "SPOT" } }
{ "base": "binance-usdm", "path": "/fapi/v1/fundingRate", "query": { "symbol": "BTCUSDT" } }
{ "base": "yahoo", "path": "/v8/finance/chart/AAPL", "query": { "range": "1mo", "interval": "1d" } }
{ "base": "polymarket-clob", "path": "/book", "query": { "token_id": "<token-id>" } }
```

The tool returns the upstream status and JSON value unchanged. Normalized `load()` remains a convenience adapter for indicators and reports; it does not cap the generic provider surface.

### What each tool returns

`finance_market_snapshot` returns the normalized instrument, quote, bar count, provider, synthetic flag, and prediction-market fields when present. `finance_technical_analysis` returns SMA, EMA, RSI, MACD, ATR, Bollinger Bands, OBV, five weighted signals, conflicts, and a composite score. `finance_research_report` returns structured sections plus a Markdown report whose first line is the report title. `finance_provider_describe` returns configured origins and auth mode. `finance_provider_request` returns the upstream status and JSON value.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package separates data, analysis, report construction, and tool registration. `FixtureFinanceMarketDataProvider` generates bars from a seeded integer sequence; `indicators.ts` computes pure functions; `report.ts` builds sections from one snapshot and one analysis; `index.ts` registers the three tools and maps internal values to the model-facing schemas. No runtime invariant companion is published because the package owns no independent mutable relationship: the tools are pure over their provider input, and the registry owns registration disposal.

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

The model sees three generated tool schemas; their canonical shape follows the [tool catalog package map](../../../docs/tool-catalog.md#tool-package-map), while this experimental package declares the exact schemas in `src/index.ts`. `finance_market_snapshot` requires `symbol`; `finance_technical_analysis` requires `symbol`; `finance_research_report` requires `symbol` and accepts optional `question` and `horizon`. Results are compact text renderings of the canonical JSON values: the snapshot render names the symbol, price, currency, bar count, and provider; the analysis render names the symbol, composite direction, confidence, and conflict count; the report render is the complete Markdown report.

#### Token effect

The three schemas add a fixed request-prefix cost while mounted. Tool results grow with the bar count only in the report result; the snapshot and analysis results are bounded summaries. The full report remains in the calling Session until ordinary compaction.

#### KV Cache effect

Prefix-stable while the three tool definitions and their visibility are unchanged. Tool calls and results append after the reusable request prefix and do not invalidate earlier cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Default data is synthetic** — the default provider is deterministic synthetic data; live data requires `provider: http`.
- **Live provider depends on public endpoints** — Yahoo Finance, Binance, and Polymarket availability, rate limits, terms, and field changes are outside this package's control.
- **Normalized crypto snapshots are explicit** — the normalized `load()` path maps `BTC` and `ETH`; other Binance symbols are available through `finance_provider_request`.
- **Provider-native data is upstream JSON** — results follow provider field names, response shapes, rate limits, authentication, and endpoint availability rather than this package's normalized snapshot schema.
- **Public transport only** — the current HTTP provider configures public bases; authenticated/private account endpoints require a credential and signing provider.
- **Shared tool surface** — every Agent Team member and Workflow child in the same composition sees the same finance tools; the package does not provide per-role tool isolation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
