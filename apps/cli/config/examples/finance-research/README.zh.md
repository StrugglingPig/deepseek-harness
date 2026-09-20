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

## Web 仪表盘

在金融 Profile 之后应用仪表盘 overlay：

```sh
dsh web --patch apps/cli/config/examples/finance-research/dashboard.patch.yml
```

侧边栏中的 **金融仪表盘** 会读取 `finance-research` 设置命名空间，加载 Binance Spot K 线，并跟随所选交易对的 `kline` WebSocket 流。它不会收到 API Key 或 Secret；私有账户数据仍由 Agent 通过 `finance_private_account` 查询。
