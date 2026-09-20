# Finance Research Phase 1 + Phase 2 验收报告

日期：2026-09-20（Asia/Shanghai）
分支：`codex/finance-research-agent`
结论：Phase 1A、Phase 1B、Phase 2A、Phase 2B、Phase 2C 的可执行范围已落地并通过本地端到端验证。

## Phase 1A：多资产行情看板

- 使用 `lightweight-charts@5.2.1` 原生渲染 TradingView Lightweight Charts，不依赖远程 iframe。
- 支持加密货币、A 股、美股三个市场。
- 加密货币：Binance Spot 行情。
- A 股：AKShare 通过 Host 路由加载，已实际显示 600519 的 1257.12 CNY、-0.78% 和 97 根日线。
- 美股：Yahoo Finance 通过 Host 路由加载，已实际显示 AAPL 与 Apple Inc.。
- 支持 K 线、成交量、SMA20、EMA12、RSI14、MACD、周期切换、快捷标的和自动刷新。
- Host 路由：`/api/finance-dashboard/market`，浏览器不再直接承担 Provider CORS 与凭据暴露。

## Phase 1B：Markdown 与交互式 HTML 报告

- `finance_research_report` 和 `finance_stock_research_report` 同时返回 Markdown 与 HTML。
- `finance_report_export` 和 `finance_stock_report_export` 可写入 `.md` 与 `.html`。
- HTML 为自包含文件，含交互式价格图、区间切换、章节导航和可点击打开。
- 最终验收产物：
  - `moutai-final.md`
  - `moutai-final.html`
- 报告标题已修正为 `600519 research report`，不再出现 `600519 (600519)` 重复。
- HTML 已在 Web 右侧栏实际打开并渲染，不是纯文本伪装。

## Phase 2A：投资方法论分析

- 新增 `finance_methodology_analysis` 和 `finance_stock_methodology_analysis`。
- 可确定计算的方法包括均线趋势、Donchian、ADX、SuperTrend、ROC、MACD、RSI、布林带、KDJ、量价、OBV、VWAP 代理、Volume Profile、道氏结构代理、波动率突破和周期代理。
- `elliott`、`wyckoff`、统计套利、因子、事件驱动、机器学习和微观结构方法明确标记为 `requires-input` 或 `not-data-backed`。
- 报告自动加入 Methodology Coverage、Investor Lenses 和 Strategy Gaps。

## Phase 2B：金融大师视角

- 新增 10 个投资大师透镜：Buffett、Graham、Munger、Lynch、Soros、Dalio、Simons、Livermore、Marks、Taleb。
- 每个透镜返回 stance、证据、关键问题、风险和缺失输入。
- 报告保留大师之间的分歧，不把单一大师结论作为最终答案。
- 已通过 official 模型实际调用并生成视角摘要。

## Phase 2C：策略目录

- 新增 `finance_strategy_catalog`。
- 覆盖趋势、动量、均值回归、价量、市场结构、波浪/周期、突破、统计套利、因子、基本面、事件驱动、机器学习和微观结构。
- 每个策略包含类别、核心逻辑、量化适配度、数据要求和执行状态。
- 当前目录共 50 条；趋势目录实际验证返回 ma-trend、adx、supertrend。

## 验证证据

- 31 个相关测试文件、175 条测试通过。
- 29 个相关测试文件、171 条测试在改动源码上达到 100% statements/branches/functions/lines。
- Finance Workflow E2E 与 Agent Team E2E 通过。
- `pnpm run build`、`pnpm run typecheck`、tool catalog、config catalog、`pnpm run test:docs` 通过。
- official 模型实际完成 `finance_stock_report_export`、`finance_stock_methodology_analysis`、`finance_strategy_catalog` 调用。
- Web 看板在加密货币、A 股、美股三种模式下均无前端错误。

## 当前限制

- Elliott Wave、Wyckoff、统计套利、PCA、ML、RL、订单簿和做市仍需要额外数据或模型，目录只声明能力和输入，不伪装成已执行结果。
- CoinMarketCap OHLCV 受当前套餐限制，WebSocket 受当前网络出口限制。
- iFinD 仍需要用户配置 refresh token 或本地 SDK 与账号。
- 投资大师视角是结构化研究框架，不是对真实人物观点的冒充，也不构成投资建议。
