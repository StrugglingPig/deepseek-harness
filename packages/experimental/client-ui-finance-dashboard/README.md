---
description: "Use and maintain the experimental Web finance dashboard for live Binance Spot charts and stream health."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-finance-dashboard

English | [中文](README.zh.md)

## Summary

This browser plugin adds a **Finance dashboard** global panel to the Web Client. The panel reads the served `finance-research` settings namespace, loads Binance Spot klines through REST, follows the selected symbol and interval through the Binance combined WebSocket stream, and renders quote metrics plus a lightweight SVG price chart. The package registers no model-facing input and never receives Binance credentials; private account data remains available only through the Host-side `finance_private_account` tool.

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

### Configure endpoints

The dashboard reads `binanceBaseUrl` and `binanceWebSocketBaseUrl` from Finance settings. A settings change closes the current stream; reopening the panel reloads history with the new endpoint. The panel itself owns no settings namespace.

### Read the panel

The header selects the symbol and interval and exposes an explicit refresh. Metrics show the latest close, change from the first loaded bar, and latest bar volume. The chart is an inline SVG polyline over close values. The stream badge reports connecting, live, offline, or error state. The controller reconnects after an unexpected close and stops reconnecting when reconnection is configured to zero or the panel is disposed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package registers one `main` keyed panel and one matching `sidebar.panellist` entry through Cordis effects. A `FinanceDashboardController` owns one snapshot store, one REST request path, one WebSocket, and one reconnect timer. REST responses are parsed defensively at the browser boundary; malformed kline rows are dropped. WebSocket updates replace the current kline when its timestamp matches and append otherwise.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Finance namespace gating, panel registration, and locale registration |
| [`src/client/controller.ts`](src/client/controller.ts) | REST history, live stream, reconnect, and dashboard state |
| [`src/client/market-data.ts`](src/client/market-data.ts) | Binance symbol normalization, kline parsing, and SVG geometry |
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

- **Public Spot data only** — the panel reads public Binance Spot klines and combined streams; private balances, positions, and futures data are not shown.
- **One symbol at a time** — the chart does not overlay multiple symbols, render order-book depth, or persist chart annotations.
- **No trading controls** — the panel cannot place, cancel, or amend orders.
- **No offline history** — reloading the page discards the in-memory bar window and fetches a fresh snapshot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The panel owns one visible controller and disposes its stream and registrations with the plugin fiber.
