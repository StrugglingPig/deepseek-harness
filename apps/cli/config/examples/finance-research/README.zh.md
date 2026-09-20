# Finance research preset example

[English](README.md) | 中文

本目录是实验性金融研究 Bundle 的 Team-aware Agent Preset。

## Install

安装 Agent Teams host 和 Web 层，再安装金融 Bundle：

```sh
dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-profile
dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-web-profile
dsh plugin --profile web add @deepseek-ai/dsh-experimental-finance-research-profile
```

将此目录复制到 Harness 用户 preset root：

```sh
mkdir -p "$DSH_HOME/.agent-presets"
cp -R apps/cli/config/examples/finance-research "$DSH_HOME/.agent-presets/finance-research"
```

Preset 不挂载 `tool-subagent`、`tool-subagent-fork` 或全局 continuable-child controls。直接委派使用 host profile 提供的 Agent Team 工具；Workflow 仍可用于脚本化研究。

金融工具本身来自 `@deepseek-ai/dsh-experimental-finance-research-profile` 插入的 `finance-research` 行。同一 Bundle 还会插入 `@deepseek-ai/dsh-schedule`；`finance_monitor_plan` 会返回可直接传给 `schedule_create` 的盘前、盘后和 BTC 24/7 监控参数。

## Live data

当 Profile 应使用 Yahoo Finance、Binance 和 Polymarket 而不是确定性 fixture 时，应用 live provider patch：

```sh
dsh web --patch apps/cli/config/examples/finance-research/live.patch.yml
```

Patch 会把插入的 `finance-research` 行设置为 `provider: http`。它需要能够访问这些公共 Provider 端点。HTTP Provider 还会注册 `finance_provider_describe`、`finance_provider_request`、`finance_private_account`、`finance_coinmarketcap_quotes`、`finance_coinmarketcap_ohlcv` 和 `finance_realtime_stream`；可查询 Provider 原生路径、只读 Binance 账户数据、CoinMarketCap 行情/OHLCV，以及有界的 Binance 或 CoinMarketCap WebSocket 实时事件。CoinMarketCap API Key 请在金融设置中保存，并开启 CoinMarketCap API 请求。数据可用性取决于上游 API、凭据、限流、套餐和账户权限，而不是本地白名单。

## A 股数据

AKShare 股票数据需要 Python。请在配置的 Python 解释器中安装 `akshare`：

```sh
python3 -m pip install akshare
```

iFinD 在金融设置中提供两条明确的接入方式。`http` 使用同花顺 HTTP API，需要已授权账号的 refresh token；将 token 保存到金融设置即可，不需要安装本地 SDK。`local` 使用厂商 `iFinDPy` SDK，需要账号和密码。两种方式都通过 Host subprocess 服务运行；依赖、凭据、权限或数据额度缺失时会显式失败。

## Web 仪表盘

在金融 Profile 之后应用仪表盘 overlay：

```sh
dsh web --patch apps/cli/config/examples/finance-research/dashboard.patch.yml
```

侧边栏中的 **金融仪表盘** 会读取 `finance-research` 设置命名空间和 Host 行情路由，并通过 `lightweight-charts` 渲染加密货币、A 股和美股 K 线、成交量、均线、RSI、MACD、资产切换和快捷标的列表。它不会收到 API Key 或 Secret；私有账户数据仍由 Agent 通过 `finance_private_account` 查询。
