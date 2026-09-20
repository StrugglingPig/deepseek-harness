---
name: finance-research
description: Use for market research, equity research, BTC and crypto research, prediction-market analysis, technical indicators, multi-indicator synthesis, or complete research reports.
---

# Financial research

This skill governs a finance research session. The finance research tools own deterministic data, indicators, and report construction; the model owns planning, interpretation, and synthesis.

## Required evidence flow

1. Resolve the instrument, benchmark, horizon, question, and as-of time.
2. Call `finance_market_snapshot` for the normalized instrument and source facts.
3. Call `finance_technical_analysis` for SMA, EMA, RSI, MACD, ATR, Bollinger Bands, OBV, signals, conflicts, and the composite score.
4. Use `web_search` and `web_fetch` for current news, filings, macro data, or prediction-market rules when the snapshot does not carry them.
5. Call `finance_research_report` to build the structured Markdown report.
6. Re-check every claim against tool results and source metadata before synthesis.

Never calculate RSI, MACD, ATR, Bollinger Bands, or composite weights by reasoning. If a number is not present in a tool result, source document, or deterministic calculation, do not invent it.

## Analysis modes

- **Equity** — combine technical state, fundamentals, valuation, catalysts, earnings revisions, and benchmark-relative strength.
- **Crypto** — combine price structure, volatility, volume, funding, open interest, liquidity, and on-chain or exchange-flow evidence when available.
- **Prediction market** — separate market-implied probability from model probability; record bid/ask spread, depth, resolution rules, expiry, and cross-market consistency.
- **Market research** — identify the regime, demand drivers, competitive structure, policy or regulatory constraints, and scenario sensitivities.

## Private account and realtime data

Use `finance_private_account` only for read-only Spot, USD-M, or COIN-M account facts. Credentials remain in the Host; never ask the user to paste a key into the conversation. Use `finance_realtime_stream` for a bounded live WebSocket sample, then return to normalized history for indicators and reports.

## Scheduled monitoring

Use `finance_monitor_plan` to obtain `schedule_create` arguments:

- `pre-market` and `after-hours` return an absolute `at` value for the next US weekday session.
- `btc-24x7` returns `every_seconds` for a fixed-rate BTC check.
- Pass the returned `schedule` fields and `prompt` to `schedule_create`; do not invent schedule times.
- Pre-market and after-hours are one-shot checks. The returned prompt asks the model to create the next day's check after reporting.
- BTC 24/7 monitoring must report material changes only; it should not repeat unchanged price state.

## Multi-indicator discipline

Report each signal with its direction, weight, value, and rationale. Keep conflicting signals visible. A composite score is a summary, not a replacement for the underlying evidence. State whether the analysis is directional, range-bound, or high-uncertainty.

## Report structure

Use these sections unless the user requests another format:

1. Summary
2. Research question and horizon
3. Market snapshot
4. Technical indicators
5. Multi-indicator synthesis
6. Fundamental, crypto, macro, news, or prediction-market evidence
7. Bull, base, and bear scenarios
8. Catalysts, risks, and invalidation
9. Evidence and timestamp
10. Limitations and disclaimer

## Agent Team mode

When the user explicitly requests Agent Teams:

- Keep the Lead responsible for the final report and `present`.
- Create separate tasks for data, technical, fundamental, crypto, prediction, verification, and report synthesis.
- Use `blockedBy` for the verification and synthesis dependencies.
- Use separate `writeScopes` for each report section.
- Keep the verifier independent from the analyst who produced the section.
- Treat write scopes as advisory; the Lead must review and merge the final report.

Workflow remains the preferred one-click report path. Agent Team is for interactive, multi-turn research.
