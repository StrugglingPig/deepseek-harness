# 报告类型 E2E 结果(真实数据)

共 33 类报告;宏观上下文 28 条,美股指标 88 条,币圈指标 28 条,A股指标 21 条。

“完整数据”表示该章节全部内容来自上游数据；“部分数据”表示章节已渲染可用数据，并在正文标注仍缺哪些输入；“缺输入”表示该章节只能列出所需输入。

| 类型 | 分类 | 形态 | 章节数 | 完整数据 | 部分数据 | 缺输入 | 缺输入的章节 | 部分数据的章节 |
|---|---|---|---|---|---|---|---|---|
| macro-daily | macro | daily | 8 | 8 | 0 | 0 | — | — |
| macro-monthly | macro | monthly | 13 | 13 | 0 | 0 | — | — |
| macro-deep-dive | macro | deep-dive | 14 | 14 | 0 | 0 | — | — |
| macro-thematic | macro | thematic | 13 | 13 | 0 | 0 | — | — |
| macro-data | macro | data | 8 | 8 | 0 | 0 | — | — |
| industry-weekly | industry | weekly | 13 | 13 | 0 | 0 | — | — |
| industry-monthly | industry | monthly | 14 | 14 | 0 | 0 | — | — |
| industry-deep-dive | industry | deep-dive | 15 | 15 | 0 | 0 | — | — |
| industry-thematic | industry | thematic | 14 | 14 | 0 | 0 | — | — |
| equity-flash | equity | flash | 6 | 6 | 0 | 0 | — | — |
| equity-deep-dive | equity | deep-dive | 20 | 20 | 0 | 0 | — | — |
| equity-event | equity | event | 16 | 15 | 1 | 0 | — | 事件背景 |
| equity-earnings | equity | earnings | 15 | 15 | 0 | 0 | — | — |
| fund-weekly | fund | weekly | 13 | 13 | 0 | 0 | — | — |
| fund-monthly | fund | monthly | 14 | 14 | 0 | 0 | — | — |
| fund-deep-dive | fund | deep-dive | 15 | 15 | 0 | 0 | — | — |
| fixed-income-daily | fixed-income | daily | 8 | 8 | 0 | 0 | — | — |
| fixed-income-weekly | fixed-income | weekly | 12 | 12 | 0 | 0 | — | — |
| fixed-income-deep-dive | fixed-income | deep-dive | 14 | 14 | 0 | 0 | — | — |
| commodity-fx-daily | commodity-fx | daily | 8 | 8 | 0 | 0 | — | — |
| commodity-fx-weekly | commodity-fx | weekly | 13 | 12 | 1 | 0 | — | 供需平衡 |
| commodity-fx-deep-dive | commodity-fx | deep-dive | 15 | 14 | 1 | 0 | — | 供需平衡 |
| commodity-fx-data | commodity-fx | data | 8 | 8 | 0 | 0 | — | — |
| crypto-flash | crypto | flash | 6 | 6 | 0 | 0 | — | — |
| crypto-daily | crypto | daily | 8 | 8 | 0 | 0 | — | — |
| crypto-weekly | crypto | weekly | 14 | 14 | 0 | 0 | — | — |
| crypto-deep-dive | crypto | deep-dive | 16 | 16 | 0 | 0 | — | — |
| crypto-data | crypto | data | 8 | 8 | 0 | 0 | — | — |
| strategy-weekly | strategy | weekly | 13 | 12 | 1 | 0 | — | 配置与风险预算 |
| strategy-monthly | strategy | monthly | 14 | 13 | 1 | 0 | — | 配置与风险预算 |
| strategy-deep-dive | strategy | deep-dive | 15 | 14 | 1 | 0 | — | 配置与风险预算 |
| strategy-thematic | strategy | thematic | 14 | 13 | 1 | 0 | — | 配置与风险预算 |
| strategy-allocation | strategy | allocation | 14 | 13 | 1 | 0 | — | 配置与风险预算 |

## 仍缺输入的章节明细

| 报告类型 | 标的 | 章节 | 状态 | 报告内标注 |
|---|---|---|---|---|
| equity-event | AAPL | 事件背景 | 部分数据 | 本节仍缺以下输入：事件时间线与公告原文 |
| commodity-fx-weekly | GLD | 供需平衡 | 部分数据 | 本节仍缺以下输入：成本曲线与期限结构 |
| commodity-fx-deep-dive | GLD | 供需平衡 | 部分数据 | 本节仍缺以下输入：成本曲线与期限结构 |
| strategy-weekly | SPY | 配置与风险预算 | 部分数据 | 本节仍缺以下输入：指数估值与盈利, 资金流与仓位, 宏观状态序列 |
| strategy-monthly | SPY | 配置与风险预算 | 部分数据 | 本节仍缺以下输入：指数估值与盈利, 资金流与仓位, 宏观状态序列 |
| strategy-deep-dive | SPY | 配置与风险预算 | 部分数据 | 本节仍缺以下输入：指数估值与盈利, 资金流与仓位, 宏观状态序列 |
| strategy-thematic | SPY | 配置与风险预算 | 部分数据 | 本节仍缺以下输入：指数估值与盈利, 资金流与仓位, 宏观状态序列 |
| strategy-allocation | SPY | 配置与风险预算 | 部分数据 | 本节仍缺以下输入：指数估值与盈利, 资金流与仓位, 宏观状态序列 |

## 已接入的数据源

| 数据源 | 免费接口 | 用于哪些章节 |
|---|---|---|
| Finnhub | 概况、指标、同业、公司新闻、财报日历、EPS 超预期、内部人情绪与交易、分析师评级、SEC 公告、已披露财报 | 估值框架、财务质量、竞争格局、股权与内部人、催化剂、事件背景 |
| FRED | 宏观序列、商品基准（布伦特/天然气/铜）、汇率腿与中/日利率 | 宏观驱动、利率信用、供需平衡、汇率驱动 |
| EIA | 美国原油商业库存、地下储气库工作气量（需要 `FINANCE_EIA_API_KEY`） | 供需平衡 |
| CFTC | WTI、黄金、铜、美元指数、欧元、日元的周度非商业净持仓（无需密钥） | 供需平衡、汇率驱动 |
| CoinGecko | 社区与开发数据、距历史最高/最低点变化、全市场市值占比 | 资金与持仓、项目进展与社区 |
| CoinMarketCap | 行情与 OHLCV | 资金与持仓 |
| GitHub | 仓库计数、近 4 周提交、近一年发版记录 | 项目进展与社区 |

## 缺口与补齐建议

| 缺口 | 缺失输入 | 下一步 |
|---|---|---|
| 事件背景 | 事件时间线与公告原文 | 已接入 Finnhub 公司新闻与 SEC 公告列表与量价反应；公告原文可用 SEC EDGAR full-text（免费）与巨潮资讯（A股） |
| 供需平衡 | 能源库存、成本曲线与期限结构 | 能源库存已接入 EIA，配置 `FINANCE_EIA_API_KEY`（免费）并在设置中打开开关后即会出现；成本曲线与期限结构需要交易所库存/远期曲线数据源 |
| 配置与风险预算 | 指数估值与盈利、资金流、宏观状态序列 | 宏观状态序列已接入 FRED（可并入本节评分）；指数 PE/EPS 与 ETF 资金流需要新增数据源 |
