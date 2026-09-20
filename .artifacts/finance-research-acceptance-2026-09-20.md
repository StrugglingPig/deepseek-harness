# Finance Research Agent 验收报告

日期：2026-09-20（Asia/Shanghai）
分支：`codex/finance-research-agent`
验收起点：`9983a20692fb8c63cd10d3980b8c906fdb1aa5d0`
修复提交：`6736a17bd6`
验收结论：可验证链路通过；外部套餐/网络限制和未配置凭据已明确隔离，不计为代码失败。

## 验收范围

- 金融研究包、Web Dashboard、Profile/Preset 组合。
- `yw` 自定义提供方 + `deepseek-flash` 的 Web Agent 工具调用。
- AKShare 真实 A 股历史、实时行情、技术分析与 Markdown 报告。
- CoinMarketCap REST quotes、OHLCV、WebSocket。
- Yahoo Finance、Binance Spot REST/WebSocket、Polymarket Gamma。
- iFinD HTTP/local 的缺失依赖与缺失凭据错误路径。
- Agent Team 与 Workflow 的无 Key 端到端路径。

## 通过项

- Web 金融仪表盘成功加载，切换周期后显示 BTC 实时价格、涨跌幅、成交量、SVG 价格图与实时状态。
- `yw/deepseek-flash` 最小工具调用通过，Bash 返回 `TOOL_OK`。
- `yw/deepseek-flash` 金融 Agent 全链路通过：实际调用 `finance_stock_snapshot` 与 `finance_stock_technical_analysis`，生成贵州茅台 600519 完整 Markdown 技术分析报告。
- AKShare 快照：600519，97 根前复权日线，实际覆盖 2026-05-06 至 2026-09-18，末价 1257.12 CNY，当日 -0.7782%。
- AKShare 行情：600519 与 000001 均返回真实价格和涨跌幅。
- 技术分析：SMA20/50、EMA12/26、RSI14、MACD、ATR14、布林带、OBV、信号权重、综合评分与冲突列表均已进入模型可见结果。
- CoinMarketCap quotes：BTC id=1 与 ETH id=1027 返回真实价格和 24h 涨跌幅。
- Yahoo Finance AAPL：127 根日线快照成功。
- Binance BTC：80 根日线快照成功；公共 ticker HTTP 200；`btcusdt@kline_1m` WebSocket 收到事件。
- Polymarket Gamma：HTTP 200 且返回 1 条市场记录。
- 单元/行为测试：286 条金融相关测试通过；552 条扩展回归在选中源码文件上达到 100% statements/branches/functions/lines 覆盖率。
- E2E：Finance Workflow 与 Agent Team 各 1 条通过。
- `pnpm run typecheck`、`verify-tool-catalog`、`verify-config-catalog`、`pnpm run test:docs` 通过。

## 代码修复

- 将 `TOOL_RUNTIME_SCHEDULER` 改为 `Symbol.for`，修复 source/lib 混载时任意工具调用报 `Cannot read properties of undefined (reading 'prepare')`。
- AKShare 历史与行情增加 Eastmoney → Sina → Tencent 回退，避免单一数据源网络阻断导致整个股票模块不可用。
- 修复非 fixture 数据报告仍声称“deterministic fixture”的错误风险提示。
- 扩展股票工具结果：快照回传首末 K 线时间；技术分析回传完整指标、信号和 JSON 渲染，Agent 可据此生成可核验报告。

## 外部限制与待配置

- CoinMarketCap OHLCV：HTTP 403，当前 Key 套餐不支持该端点。
- CoinMarketCap WebSocket：当前主机直连 `ECONNRESET`，未能完成握手/订阅。
- iFinD HTTP：未配置 refresh token，返回 `IFIND_AUTH_REQUIRED`。
- iFinD local：未安装 `iFinDPy` 且未配置账号密码，返回 `IFIND_NOT_INSTALLED` 或 `IFIND_AUTH_REQUIRED`。
- 默认 DeepSeek official 路由仍为 disabled/invalid token；本轮模型验证使用用户已配置的 `yw` 提供方。
- 本机 Binance/Yahoo/Polymarket 依赖系统代理；本地 Web 实例已通过 `NODE_USE_ENV_PROXY=1` 与 `HTTP(S)_PROXY=http://127.0.0.1:7890` 启动。

## 环境处理

- 创建独立 Python 3.12 venv：`~/.dsh/venvs/finance-research`。
- 安装 `akshare==1.18.96`。
- Finance 设置 `pythonExecutable` 指向该 venv。
- 本地 Web 实例使用当前源码与 finance/dashboard overlays 启动，并继承代理环境。

## 产物

- `web-agent-600519-report.md`：`yw` Web Agent 生成的中文完整报告。
- `finance-agent-sample-report.md`：Host provider 通过 AKShare 数据生成的报告样本。
- `finance-agent-live-providers.json`：Yahoo、Binance、CMC、Polymarket、AKShare、iFinD 的真实结果摘要。

## 结论

股票模块核心研究链路已可端到端运行。剩余问题均属于外部套餐、网络出口或未配置凭据，当前代码路径均以结构化错误码显式失败。后续验收应优先配置 iFinD 凭据并验证 local/http transport，以及确认 CMC 套餐是否允许 OHLCV 和 WebSocket。
