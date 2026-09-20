# Agent Note: Finance research productionization

Status: implemented

English | [中文](2026-09-20-finance-research-productionization.zh.md)

## Problem

The initial finance research package proved a deterministic fixture-to-report path, but a usable research product also needs authenticated account facts, real-time market data, bounded upstream traffic, durable monitoring, and a Web presentation surface. Putting credentials in settings, letting the model receive secrets, or inventing a second scheduler would conflict with the existing credentials and Schedule seams.

## Decision

The finance Host plugin owns a settings namespace, resolves Binance credentials only through `ctx.credentials`, and applies HMAC-SHA256 signing only to explicit `auth: 'signed'` requests. Signed requests are GET/query-only and are never cached. `finance_private_account` normalizes read-only Spot, USD-M, and COIN-M balances, positions, and optional open orders; it exposes no order-placement or withdrawal operation.

`FinanceHttpTransport` owns per-origin token-bucket rate limiting, successful GET caching, bounded exponential retry, request timeouts, and stable transport errors. Cache, retry, rate-limit, and timeout values are plugin `Config` fields surfaced in Finance settings. The HTTP provider delegates public and signed requests through this transport.

CoinMarketCap is a separate configured provider base with its own `X-CMC_PRO_API_KEY` credential reference. `finance_coinmarketcap_quotes` and `finance_coinmarketcap_ohlcv` normalize the REST responses, while `finance_realtime_stream` routes `provider: coinmarketcap` to `CoinMarketCapWebSocketStreamProvider`, which performs the documented handshake, sends the `market@crypto_latest_price` subscription, and returns bounded data frames. The key is resolved only on the Host and never enters settings, model-visible results, or the browser.

`BinanceWebSocketStreamProvider` performs bounded collection from Binance's combined market-data stream and backs `finance_realtime_stream`. It returns a finite event batch rather than an unbounded model-facing stream; the Web dashboard owns its own browser-side live connection.

`finance_monitor_plan` computes deterministic pre-market, after-hours, and BTC 24/7 `schedule_create` arguments. It does not introduce a finance scheduler or persistence format. The finance profile inserts the existing `@deepseek-ai/dsh-schedule` package so Schedule owns durable reminder creation, delivery, and restart behavior. Pre-market and after-hours plans are one-shot checks whose prompt requests the next session after reporting.

`@deepseek-ai/dsh-experimental-client-ui-finance-dashboard` is a separate browser package. It registers a global `main` panel and sidebar entry only while the `finance-research` settings namespace is served. It reads public Binance Spot klines, follows a `kline` WebSocket stream, renders an SVG price chart and quote metrics, and never receives credentials or private account data.

## Alternatives considered

**Store API keys in settings.** Rejected because settings documents are ordinary configuration and are not the credential boundary. The settings surface shows only configured status.

**Expose arbitrary signed POST bodies.** Rejected because the current product is read-only research; allowing model-authored signed mutations would turn a data provider into an order path without review, risk limits, or approval.

**Cache signed responses.** Rejected because account balances and positions are freshness-sensitive and request-specific.

**Add a finance-specific timer service.** Rejected because the repository already owns durable Schedule semantics and delivery. A second timer would duplicate persistence and lifecycle behavior.

**Put the chart in the Host plugin.** Rejected because the Host has no browser slot; a separate client package keeps model-visible tools and browser presentation independently replaceable.

## Consequences

Private account access depends on the credential service and explicit signed-request enablement. The live provider remains subject to Binance permissions, endpoint availability, rate limits, and terms. Monitoring is durable only when the finance profile or another composition mounts Schedule. The dashboard is public Spot only; private account views and trading controls remain out of scope.

## Testing

Tests cover signature construction, credential absence and disabled signing, cache expiry and eviction, token-bucket waiting, retry and cancellation, private-account normalization across account families, bounded WebSocket collection, settings-backed delegation, monitor planning, tool registration and disposal, browser panel registration, dashboard parsing and controller lifecycle, and bilingual settings controls.

## Related

- [Finance research agent](2026-09-20-finance-research-agent.md)
- [Credentials](../../../../docs/subsystems/credentials.md)
- [Settings](../../../../docs/subsystems/settings.md)
- [Schedule](../../../../docs/subsystems/schedule.md)
- [Web client](../../../../docs/subsystems/web-client.md)
- [Tool authoring](../../../../docs/cookbook/adding-a-tool.md)
