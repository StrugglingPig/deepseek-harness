# Agent Note: In-house valuation and forecast method for finance reports

Status: proposed

English | [中文](2026-09-22-finance-valuation-and-forecast-method.zh.md)

## Problem

The shipped earnings model prices one target by applying a single peer-median multiple to a faded growth path. That is one method with one answer, and both the sell-side convention it imitates and the open-source implementations of that convention disagree with it.

Two failures are measured, not hypothetical. First, the output is a point when the inputs dominate the answer: the same model returns 200 to 418 on one instrument when the starting growth moves between 4% and 25% and the multiple between 22x and 38x, yet the report prints 292 with two decimals. Second, the anchor is unreliable: the peer set Finnhub returns for a consumer-electronics company is storage and enterprise-hardware companies, and copying their median multiple is a known anti-pattern — a warranted multiple is a function of growth, incremental returns, and risk, not a number other companies happen to trade at.

The same gap exists on the forecasting side. Revenue and EPS fade toward a terminal rate from a single trailing growth figure, with no operating drivers, no capital intensity, no discount rate, and no reconciliation to the cash the business actually produces.

## Proposal

Adopt the methodology that sell-side notes and the stronger open-source implementations converge on, and implement it behind the existing finance capability seams.

### 1. Method routing

Every equity report runs at least three independent methods and prints their ranges side by side; disagreement is explained rather than averaged away.

| Situation | Primary | Cross-checks |
|---|---|---|
| Stable cash-generating business | FCFF DCF with explicit years, fade, and terminal | relative multiples, EPV, reverse DCF |
| Cyclical | mid-cycle earnings times a mid-cycle multiple | DCF, EPV, asset replacement value |
| Bank, insurer, capital markets | P/B–ROE, residual income | dividend discount, relative multiples |
| Conglomerate, holding | sum of the parts | DCF per segment, relative multiples |
| Pre-profit growth | EV/ARR or EV/gross profit, unit economics | cash runway, reverse DCF |
| Real estate, utilities, transport | NAV or regulated asset base plus yield | DCF, relative multiples |
| Commodity, FX, crypto, rates | not discounted cash flow | supply-demand balance, curve shape, positioning, on-chain and flow metrics |

### 2. Driver-based forecast

Revenue is built from the segment or industry drivers the report can source, with the outside view applied: each growth and margin assumption is tagged with its percentile in the historical distribution of comparable companies, and beating the base rate requires a stated structural reason. Margin paths stay inside the historical range and the peer distribution instead of a flat copy of last year. Capital expenditure, working capital, and cash taxes turn the forecast into free cash flow, which also makes the accrual check possible. Three explicit years plus a fade period, then a terminal value whose incremental return converges to the cost of capital unless a moat duration is argued explicitly.

### 3. One cost of capital per report

Constructed in one order for the whole report: the risk-free rate in the cash-flow currency, an equity risk premium, an unlevered industry beta re-levered to the target capital structure, the after-tax cost of debt, then market-value weights. Every component prints with its source and timestamp, and the same rate feeds the DCF, the EPV, and any residual-income method. Risk is penalized once: either in the discount rate or in the scenario probabilities, never both, and never by tuning the rate to reach a desired target. The construction and its outputs are pinned against the reference implementation on a fixed fixture.

### 4. Warranted multiple instead of a copied median

The fair multiple is derived from the fundamentals — growth, incremental return on invested capital, and the discount rate — and then compared with what the market pays. The difference is attributed either to a market mispricing or to a risk the model has not captured, and the report states which.

### 5. Reverse DCF and the expectations gap

For every priced instrument the report solves for the growth the current price implies and shows that figure beside our own forecast. The gap, not the target, becomes the spine of the report: what the market has priced in, what we assume instead, and what evidence would settle it.

### 6. Scenarios, probabilities, and a range

Bull, base, and bear cases carry explicit probabilities that sum to one, produce a weighted fair value, and are re-run with the probabilities pushed to their extremes to show how much the conclusion depends on them. The published number is a range with implied upside at both ends. A probability-weighted point may accompany the range, but never replaces it.

### 7. Earnings quality gates valuation

Accruals ratio and cash conversion run first, then the distress and manipulation battery the inputs support: Altman Z, Piotroski F, Beneish M, Ohlson O, Zmijewski, Springate, Grover, and Fulmer scores. Together they produce an A–D credibility grade. A C grade caps the action at watch; a D suppresses the valuation and the action entirely and says so in the first screen. Missing inputs print as not obtained rather than being scored by impression.

### 8. Presentation

The first screen carries a verdict box (intrinsic value view, one-to-three-month trading direction, action, confidence, credibility grade), a tearsheet of sourced figures, and the expectations-gap table. The valuation section carries a football-field range across methods, the assumption table with sources and timestamps, and the sensitivity grid. Every number prints the endpoint, field, and retrieval time it came from; every assumption is written into the report as the model's own output, never presented as consensus.

### 9. Validation before the label

The method earns the words target price and fair value only after an out-of-sample backtest reports its twelve-month realized error and hit rate against a control that assumes the price does not change, and a Diebold-Mariano test shows whether the difference in forecast accuracy is significant rather than noise. Until both pass, the report calls the output a model reference value. The backtest reconstructs inputs as of each historical date, so peer multiples and prices are as of then, not today.

### 10. Build in-house, validate against a reference implementation

The formulas are ours and run on our own providers. The maintained `JerBouma/FinanceToolkit` project (MIT) serves as a development-time oracle instead of a runtime dependency: a fixed fixture of reported statements is pushed through both implementations, and the reference's cost of capital, discounted cash flow, ratio, and forensic-score outputs are recorded as golden values that our unit tests must match. The library never enters the runtime, so the reports keep one set of endpoints, one source list beside every figure, and no new credential.

### 11. Data to close first

Reported income statement totals, balance sheet items, and cash-flow items from the same filings endpoint we already read; shares outstanding from market capitalisation and price; a historical multiple series per symbol built from price history and reported earnings; and the A-share absolute financials the bridge does not return today. This is the first implementation slice, because every method above needs either the cash-flow statement or the balance sheet.

## Alternatives considered

**Keep the single-multiple model and widen nothing.** It ships today, but it fails both measured problems: one anchor decides the answer, and the output hides its own sensitivity. Keeping it also blocks the expectations gap, which is the part of an institutional note readers actually act on.

**Buy consensus estimates and republish them.** This answers what other analysts think, which is a different question from our own view, and it removes the only part of the exercise we can defend: a reproducible chain from sourced inputs to a stated assumption.

**Discount cash flow only.** One method with a terminal value that often carries most of the value invites false precision, and the free data we can source does not support segment-level cash flows for every industry. Multi-method cross-checking is the discipline that catches a broken DCF.

**Borrow the maintained library at runtime.** `JerBouma/FinanceToolkit` already implements the cost of capital, discounted cash flow, residual income, EVA, PVGO, Graham number, DuPont, and the full manipulation-and-distress battery, all MIT-licensed. Taking it as a runtime dependency would delete owned code, which this repository otherwise prefers. It lost because it brings its own data layer: the toolkit fetches statements from Financial Modeling Prep and falls back to Yahoo Finance, so the report would carry two endpoint lists behind the same figure, a second credential to explain, and numbers sourced differently from the fundamentals the rest of the report quotes. Its full method set also wants an FMP key. Keeping it as a development-time oracle delivers the formula correctness without either cost.

**Machine-learning price forecasting.** Attractive for the appearance of sophistication, but a point estimate without an auditable story cannot be argued with, and training on free data risks look-ahead bias that inflates the backtest. Reconsider only with point-in-time data and an economic story the model can state.

**Monte Carlo as the primary output.** A distribution built on the same wrong assumptions is still wrong; scenarios with explicit probabilities keep each assumption visible. Keep Monte Carlo as an optional layer once the assumption set is stable.

## Acceptance criteria

- Every equity report prints at least three methods, their ranges, and an implied-upside range; the verdict box carries the range rather than a single number.
- No target price appears without its assumption table, source timestamps, and the reverse-DCF expectations gap.
- The earnings-quality grade gates the action and, at C or D, the valuation itself.
- Terminal-value share and the implied exit multiple print beside their ceilings, and the report says when a ceiling is breached.
- Growth and margin assumptions print their base-rate percentile, with the structural reason when one exceeds the distribution.
- WACC is printed with its components, one value per report, and a ±1 percentage point sensitivity table.
- A backtest over at least fifty historical symbol-dates reports twelve-month error and hit rate against the unchanged-price control, with a Diebold-Mariano test of the accuracy difference, and the report only uses the words target price or fair value after that backtest passes.
- Cost of capital, discounted cash flow, ratio, and forensic-score outputs match the reference implementation's golden values on a fixed statement fixture, so a formula drift fails a test rather than shipping.
- Every method is a deterministic pure function with per-file coverage, given an explicit input record that the report prints as an appendix.

## Risks

- Free data caps fidelity. Segments, share counts, and historical multiples are incomplete, so the report must print not obtained rather than a plausible-looking substitute.
- A multi-method range can read as indecision. The verdict box must still commit to a view through a pre-registered mapping from value range, credibility grade, and gap to action.
- Published betas and equity risk premiums are noisy inputs. The sensitivity table is the honest answer, and the model must never tune the discount rate toward a target.
- The backtest itself can lie: reconstructing peer multiples and prices as of each date is required, or the error statistics will be inflated by look-ahead.
- Reading load grows with methods and scenarios. The football-field range, the gap table, and the verdict box must carry the decision on the first screen, with the detail behind them.
- Golden values bind our formulas to one reference's conventions. Where we deliberately differ, the test records the difference and the reason rather than loosening the assertion.
- Scope is the main delivery risk: the package holds per-file coverage and documentation gates, so each method needs its own tests and docs before the next one lands.
