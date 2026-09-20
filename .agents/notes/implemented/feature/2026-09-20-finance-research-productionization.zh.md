# Agent Note: 金融研究生产化

Status: implemented

[English](2026-09-20-finance-research-productionization.md) | 中文

## Problem

最初的金融研究包已经验证了从确定性 fixture 到报告的路径，但可用产品还需要认证账户数据、实时行情、受控上游流量、持久化监控和 Web 展示面。把凭据放进设置、让模型收到 Secret，或另造一套调度器，都会与现有凭据和 Schedule seam 冲突。

## Decision

金融 Host 插件拥有设置命名空间，只通过 `ctx.credentials` 解析 Binance 凭据，并且只对显式 `auth: 'signed'` 请求应用 HMAC-SHA256 签名。签名请求仅允许 GET/query，且永不缓存。`finance_private_account` 标准化只读 Spot、USD-M 和 COIN-M 余额、持仓及可选未成交订单；不暴露下单或提现操作。

`FinanceHttpTransport` 负责按 origin 的令牌桶限流、成功 GET 缓存、有界指数重试、请求超时和稳定传输错误。缓存、重试、限流和超时值都是插件 `Config` 字段，并在金融设置中展示。HTTP Provider 的公开请求和签名请求都通过该 transport。

中国 A 股数据通过 `ctx.subprocess` 执行内置 Python 桥。AKShare 和两种 iFinD 接入方式保持在 npm 运行时之外；桥接层检测缺失依赖并返回稳定的结构化错误。iFinD HTTP refresh token 和本机 SDK 账号/密码通过 `ctx.credentials` 解析，只作为显式子进程环境变量传入。股票工具覆盖标准化历史行情、实时行情和确定性技术分析，不向模型暴露 Python traceback 或凭据。

CoinMarketCap 是独立配置的 Provider base，使用自己的 `X-CMC_PRO_API_KEY` 凭据引用。`finance_coinmarketcap_quotes` 和 `finance_coinmarketcap_ohlcv` 标准化 REST 响应；`finance_realtime_stream` 使用 `provider: coinmarketcap` 路由到 `CoinMarketCapWebSocketStreamProvider`，后者执行文档规定的握手、发送 `market@crypto_latest_price` 订阅并返回有界数据帧。Key 只在 Host 解析，不会进入设置、模型可见结果或浏览器。

`BinanceWebSocketStreamProvider` 从 Binance 组合行情流执行有界采集，支撑 `finance_realtime_stream`。它返回有限事件批次，而不是无界模型流；Web 仪表盘拥有自己的浏览器实时连接。

`finance_monitor_plan` 计算确定性的盘前、盘后和 BTC 24/7 `schedule_create` 参数。它不新增金融调度器或持久化格式。金融 Profile 插入现有 `@deepseek-ai/dsh-schedule`，由 Schedule 负责持久提醒的创建、投递和重启行为。盘前和盘后计划是一次性检查，其 prompt 会在报告后请求下一时段。

`@deepseek-ai/dsh-experimental-client-ui-finance-dashboard` 是独立浏览器包。只有 `finance-research` 设置命名空间被提供时，它才注册全局 `main` 面板和侧边栏入口。它读取公共 Binance Spot K 线，跟随 `kline` WebSocket 流，渲染 SVG 价格图和行情指标，并且不会收到凭据或私有账户数据。

## Alternatives considered

**把 API Key 存入设置。** 拒绝，因为设置文档是普通配置，不是凭据边界。设置界面只展示是否已配置。

**允许任意签名 POST body。** 拒绝，因为当前产品是只读研究；让模型编写签名变更请求会在缺少审查、风险限制和审批的情况下把数据 Provider 变成下单路径。

**缓存签名响应。** 拒绝，因为账户余额和持仓对时效敏感，而且请求结果因请求而异。

**新增金融专用定时服务。** 拒绝，因为仓库已经有持久 Schedule 语义和投递机制。第二套定时器会重复持久化和生命周期行为。

**把图表放进 Host 插件。** 拒绝，因为 Host 没有浏览器 slot；独立客户端包让模型可见工具和浏览器展示可以分别替换。

## Consequences

私有账户访问依赖凭据服务和显式签名请求开关。实时 Provider 仍受 Binance 权限、端点可用性、限流和条款约束。只有金融 Profile 或其他组合挂载 Schedule 时，监控才具备持久性。仪表盘仅提供公共 Spot 数据；私有账户视图和交易控制仍不在范围内。

## Testing

测试覆盖签名构造、凭据缺失和签名关闭、缓存过期与淘汰、令牌桶等待、重试与取消、跨账户族的私有数据标准化、有界 WebSocket 采集、设置委托、监控规划、工具注册与释放、浏览器面板注册、仪表盘解析与控制器生命周期，以及双语设置控件。

## Related

- [Finance research agent](2026-09-20-finance-research-agent.zh.md)
- [Credentials](../../../../docs/subsystems/credentials.zh.md)
- [Settings](../../../../docs/subsystems/settings.zh.md)
- [Schedule](../../../../docs/subsystems/schedule.zh.md)
- [Web client](../../../../docs/subsystems/web-client.zh.md)
- [Tool authoring](../../../../docs/cookbook/adding-a-tool.zh.md)
