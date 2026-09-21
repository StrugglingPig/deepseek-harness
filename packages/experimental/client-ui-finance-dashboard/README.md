---
description: "Use and maintain the experimental Web finance dashboard for crypto, A-share, and US-equity charts on the Host market route."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-finance-dashboard

English | [中文](README.zh.md)

## Summary

This browser plugin adds a **Finance dashboard** global panel to the Web Client. The panel reads the served `finance-research` settings namespace and polls the Host market route on the authenticated `/api` channel, keeping provider calls, credentials, and cross-origin policy on the Host. It renders crypto, mainland A-share, and US-equity candlesticks through `lightweight-charts` with a configurable indicator set — moving averages, bands, SAR, VWAP, TD Sequential, volume, and oscillators — falling back to an inline SVG line when canvas is unavailable. The package registers no model-facing input and never receives provider credentials; private account data stays behind the Host `finance_private_account` tool.

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

Install the Host-side finance profile first, then add this package to a Web profile:

```sh
dsh plugin --profile web add @deepseek-ai/dsh-experimental-finance-research-profile
dsh plugin --profile web add @deepseek-ai/dsh-experimental-client-ui-finance-dashboard
```

The exact workspace example also ships [`dashboard.patch.yml`](../../../apps/cli/config/examples/finance-research/dashboard.patch.yml). The sidebar entry appears only while the `finance-research` settings namespace is served, so a deployment without the finance Host plugin does not show an inert panel.

### Configure data sources

The dashboard follows the served `finance-research` settings namespace: a namespace change reloads the current selection, and the A-share tab succeeds only while the Host has the selected provider enabled. The panel also publishes the browser's active locale into that namespace, so Host-side finance reports follow the language the user sees. Provider endpoints, credentials, and enable flags stay in Finance settings and never reach the browser; the panel itself owns no settings namespace.

### Read the panel

The header selects the asset family, symbol, and interval and exposes an explicit refresh. Tabs cover crypto pairs, mainland A-shares, and US equities, each with a quick-symbol list. Metrics show the latest price, the change against the previous bar, and the latest bar volume. The chart renders the selected indicators through `lightweight-charts`, with an inline SVG line when canvas is unavailable. The indicator settings module groups the overlays and the separate panes, toggles each indicator, edits its periods, and restores one indicator or all of them to the shipped defaults; the selection and parameters persist in browser storage under `dsh.finance.dashboard.indicators.v1`. TD Sequential marks its buy and sell setups with counts on the candles and highlights counts at the configured target. The request badge reports connecting, live, or error state; the controller re-polls every 15 seconds, stops polling when the panel is disposed, and drops responses that arrive after the selection changed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package registers one `main` keyed panel and one matching `sidebar.panellist` entry through Cordis effects. A `FinanceDashboardController` owns one snapshot store, one Host request path, and one polling timer. Host responses are parsed defensively at the browser boundary; malformed bars are dropped. The Host half of the market route lives in the finance research package and registers on Connection's authenticated exact-route registry.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Finance namespace gating, panel registration, and locale registration |
| [`src/client/controller.ts`](src/client/controller.ts) | Host market polling, refresh lifecycle, and dashboard state |
| [`src/client/market-data.ts`](src/client/market-data.ts) | Host response parsing, indicator series, and SVG chart geometry |
| [`src/client/indicators.ts`](src/client/indicators.ts) | Selectable indicator catalog, parameter ranges, and chart sizing |
| [`src/client/indicator-store.ts`](src/client/indicator-store.ts) | Persisted indicator selection, parameter overrides, and resets |
| [`src/client/IndicatorSettings.tsx`](src/client/IndicatorSettings.tsx) | Indicator settings dialog: grouping, parameters, and resets |
| [`src/client/TradingChart.tsx`](src/client/TradingChart.tsx) | `lightweight-charts` rendering with the SVG fallback |
| [`src/client/FinanceDashboard.tsx`](src/client/FinanceDashboard.tsx) | Dashboard controls, metrics, chart, and status presentation |
| [`src/client/locales.ts`](src/client/locales.ts) | English and Chinese panel copy |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Finance research tools](../finance-research/README.md) — Host-side private account, provider request, stream collection, and monitor planning tools.
- [Finance research example](../../../apps/cli/config/examples/finance-research/README.md) — Team-aware preset installation and dashboard overlay.
- [Web layout](../../client/ui-layout/README.md) — the global `main` panel and `sidebar.panellist` contracts.
- [Experimental packages](../README.md) — incubation status and publication policy.

-----

<a id="model-experience"></a>
## Model Experience

None, as this browser panel registers no model-facing schema or prompt content.

#### KV Cache effect

No direct effect; the Host-side finance tools own any later model-visible use.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Polling, not streaming** — the panel re-polls the Host route instead of following a live stream, so quotes lag the upstream feed by up to one poll interval.
- **Provider-bound market data** — crypto, A-share, and US-equity history comes from the providers configured on the Host; private balances, positions, and futures data are not shown.
- **One symbol at a time** — the chart does not overlay multiple symbols, render order-book depth, or persist chart annotations.
- **No trading controls** — the panel cannot place, cancel, or amend orders.
- **No offline history** — reloading the page discards the in-memory bar window and fetches a fresh snapshot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The panel owns one visible controller and disposes its polling timer and registrations with the plugin fiber.
