# 600519 research report

## Summary

bearish bias for 600519. bearish composite with 5 aligned signals.

## Research Question

评估中期技术面与风险

Horizon: 1-3个月

## Market Snapshot

- As-of: 2026-09-18T00:00:00.000Z
- Price: 1257.12 CNY
- Change: -0.78%
- Bars: 97
- Source: akshare

## Technical Indicators

- SMA 20 / 50: 1291.7954999999997 / 1300.162
- EMA 12 / 26: 1279.2483132831942 / 1289.2093550452898
- RSI 14: 33.82173382173379
- MACD / signal / histogram: -9.961041762095647 / -4.760864452230846 / -5.2001773098648005
- ATR 14: 18.30857142857144
- Bollinger bands: 1254.7584280449976 / 1291.7954999999997 / 1328.8325719550019
- OBV / 20-bar average: -46927030 / -39461202.7

## Multi-Indicator Synthesis

- trend: bearish (weight 0.3, value -8.366500000000315)
- momentum: neutral (weight 0.2, value 33.82173382173379)
- macd: bearish (weight 0.25, value -5.2001773098648005)
- mean-reversion: neutral (weight 0.1, value 1291.7954999999997)
- participation: bearish (weight 0.15, value -7465827.299999997)

Composite score: -0.7
Confidence: 70%
No directional conflicts across the weighted signals.

## Methodology Coverage

- Moving-average trend: bearish, 75% confidence, status available. EMA12 1279.2483132831942 vs EMA26 1289.2093550452898
- Donchian channel: neutral, 70% confidence, status available. 20-day range 1254–1338.86
- ADX trend: bearish, 27% confidence, status available. ADX 26.55
- SuperTrend: bearish, 65% confidence, status partial. ATR-band trend direction
- ROC: bearish, 70% confidence, status available. 20-bar rate of change
- MACD: bearish, 70% confidence, status available. MACD histogram direction
- RSI: bearish, 60% confidence, status available. RSI14 33.82173382173379
- RSI mean reversion: neutral, 55% confidence, status available. RSI extreme state
- Bollinger mean reversion: neutral, 55% confidence, status available. Bollinger z-score
- KDJ: bearish, 55% confidence, status available. K/D cross and level
- Volume-price relation: bearish, 55% confidence, status available. Volume 2489087 vs 20-period mean 2496415.05
- OBV: bearish, 60% confidence, status available. OBV vs 20-bar average
- VWAP: bearish, 45% confidence, status partial. Rolling 20-bar VWAP proxy
- Volume Profile: bearish, 45% confidence, status partial. OHLCV bucket profile, not intraday footprint
- Chan Theory: bearish, 35% confidence, status partial. Simplified structure proxy; full Chan segmentation requires dedicated analysis
- Dow Theory: neutral, 55% confidence, status partial. Confirmed swing structure
- Price Action: bearish, 45% confidence, status partial. SMA/price structure proxy
- Volatility Breakout: neutral, 55% confidence, status available. Latest range versus ATR
- Cycle analysis: bearish, 30% confidence, status partial. Autocorrelation cycle proxy
- Elliott Wave: insufficient-data, 10% confidence, status not-data-backed. Wave counts require validated labeling; no automatic count is claimed
- Wyckoff: insufficient-data, 10% confidence, status not-data-backed. Accumulation/distribution requires footprint and event context

## Investor Lenses

- Warren Buffett (Value and quality): insufficient-data.
  - Risk: Quality and valuation inputs are absent from the current snapshot.
- Benjamin Graham (Deep value): insufficient-data.
  - Risk: Fundamental and balance-sheet inputs are absent.
- Charlie Munger (Quality compounding): insufficient-data.
  - Risk: Business quality is not represented by price and volume alone.
- Peter Lynch (Growth at a reasonable price): insufficient-data.
  - Risk: Growth and earnings estimates are absent.
- George Soros (Reflexivity and macro): cautious.
  - Moving-average trend: bearish (75%)
  - MACD: bearish (70%)
  - Risk: Macro positioning and reflexivity inputs are absent.
- Ray Dalio (Macro and risk balance): cautious.
  - ADX trend: bearish (27%)
  - Volatility Breakout: neutral (55%)
  - Risk: Macro regime and portfolio data are absent.
- Jim Simons (Quantitative signals): cautious.
  - RSI: bearish (60%)
  - Bollinger mean reversion: neutral (55%)
  - Risk: No backtest, cost model, or out-of-sample validation is present.
- Jesse Livermore (Trend following): cautious.
  - Donchian channel: neutral (70%)
  - ADX trend: bearish (27%)
  - SuperTrend: bearish (65%)
  - Risk: Position sizing and execution assumptions are absent.
- Howard Marks (Cycle and risk): cautious.
  - Volatility Breakout: neutral (55%)
  - Cycle analysis: bearish (30%)
  - Risk: Cycle position cannot be established from one asset alone.
- Nassim Taleb (Tail risk and convexity): cautious.
  - Volatility Breakout: neutral (55%)
  - Cycle analysis: bearish (30%)
  - Risk: Tail distribution and option data are absent.

## Strategy Gaps

- Relative strength (momentum): requires-input; requires benchmark series, peer universe
- Grid (mean-reversion): requires-input; requires range bounds, grid step, capital budget
- Pairs trading (statistical-arbitrage): requires-input; requires paired asset history
- Wyckoff (market-structure): not-data-backed; requires volume footprint, event context
- Elliott Wave (wave-cycle): not-data-backed; requires validated wave labeling
- Opening Range Breakout (breakout): requires-input; requires intraday bars, session definition
- Market Neutral (statistical-arbitrage): requires-input; requires multi-asset universe, hedge ratio
- PCA arbitrage (statistical-arbitrage): requires-input; requires cross-sectional panel
- Value factor (factor): requires-input; requires fundamental data
- Momentum factor (factor): requires-input; requires asset universe
- Quality factor (factor): requires-input; requires financial statements
- Low-volatility factor (factor): requires-input; requires cross-sectional history
- Size factor (factor): requires-input; requires market-cap universe
- Multi-factor (factor): requires-input; requires fundamental and price panel
- DCF (fundamental): requires-input; requires cash-flow forecasts, discount rate
- Financial quality (fundamental): requires-input; requires financial statements
- Industry rotation (fundamental): requires-input; requires macro and industry data
- Earnings strategy (event-driven): requires-input; requires estimates, events
- Dividend and buyback (event-driven): requires-input; requires corporate actions
- Merger arbitrage (event-driven): requires-input; requires deal terms, probability
- Index rebalance (event-driven): requires-input; requires index events
- Random Forest (machine-learning): requires-input; requires features, labels, validation
- XGBoost / LightGBM (machine-learning): requires-input; requires features, labels, validation
- LSTM / Transformer (machine-learning): requires-input; requires long sequence history, validation
- Reinforcement learning (machine-learning): requires-input; requires simulator, reward design
- Market making (microstructure): requires-input; requires order book, queue data, latency
- Order Flow (microstructure): requires-input; requires tick and order-flow data
- VWAP / TWAP execution (microstructure): requires-input; requires order size, market impact model
- Order-book imbalance (microstructure): requires-input; requires level-2 order book

## Risk And Limitations

- ATR as percent of price: 1.4564%
- Snapshot source: akshare; upstream availability, latency, and data quality remain external.
- The report is research automation output, not investment advice.
