---
description: "Experimental finance research tools: normalized fixture snapshots, deterministic technical indicators, multi-indicator synthesis, and Markdown reports for Agent Team and Workflow research sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-finance-research

English | [中文](README.zh.md)

## Summary

`dsh-experimental-finance-research` gives a finance research session a deterministic data-to-report path. It loads normalized equity, crypto, and prediction-market snapshots from a fixture provider, computes technical indicators and a weighted multi-indicator summary, and builds a structured Markdown report. The three tools are model-facing; the calculation and report code is ordinary TypeScript inside the plugin.

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

The default application uses `FixtureFinanceMarketDataProvider`. A deployment can call `registerFinanceTools(ctx, provider)` with another `FinanceMarketDataProvider`; the tool schemas and report remain unchanged.

### Supported instruments

The fixture provider understands equity symbols such as `AAPL`, crypto symbols `BTC` and `ETH`, and prediction symbols such as `PREDICTION:FED-CUT`. Unknown non-prediction symbols are treated as equities so the research path can be exercised with arbitrary tickers.

### What each tool returns

`finance_market_snapshot` returns the normalized instrument, quote, bar count, provider, synthetic flag, and prediction-market fields when present. `finance_technical_analysis` returns SMA, EMA, RSI, MACD, ATR, Bollinger Bands, OBV, five weighted signals, conflicts, and a composite score. `finance_research_report` returns structured sections plus a Markdown report whose first line is the report title.

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

- **Fixture data only** — the initial provider is deterministic synthetic data; it is not live market data and must not be treated as investment information.
- **No provider registry package yet** — `registerFinanceTools` accepts a replacement provider, but no live adapter ships in this slice.
- **Shared tool surface** — every Agent Team member and Workflow child in the same composition sees the same finance tools; the package does not provide per-role tool isolation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
