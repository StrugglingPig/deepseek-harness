# Finance research preset example

English | [中文](README.zh.md)

This directory is a Team-aware Agent Preset for the experimental finance research bundle.

## Install

Install the Agent Teams host and Web layers, then the finance bundle:

```sh
dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-profile
dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-web-profile
dsh plugin --profile web add @deepseek-ai/dsh-experimental-finance-research-profile
```

Copy this directory to the harness user preset root:

```sh
mkdir -p "$DSH_HOME/.agent-presets"
cp -R apps/cli/config/examples/finance-research "$DSH_HOME/.agent-presets/finance-research"
```

The preset does not mount `tool-subagent`, `tool-subagent-fork`, or the global continuable-child controls. Direct delegation uses the Agent Team tools from the host profile; Workflow remains available for scripted research.

The finance tools themselves come from the `finance-research` row inserted by `@deepseek-ai/dsh-experimental-finance-research-profile`. The same bundle inserts `@deepseek-ai/dsh-schedule`; `finance_monitor_plan` returns ready-to-use `schedule_create` arguments for pre-market, after-hours, and BTC 24/7 monitoring.

## Live data

Apply the live-provider patch when the profile should use Yahoo Finance, Binance, and Polymarket instead of the deterministic fixture:

```sh
dsh web --patch apps/cli/config/examples/finance-research/live.patch.yml
```

The patch sets `provider: http` on the inserted `finance-research` row. It requires outbound network access to the public provider endpoints. The HTTP provider also registers `finance_provider_describe`, `finance_provider_request`, `finance_private_account`, `finance_coinmarketcap_quotes`, `finance_coinmarketcap_ohlcv`, and `finance_realtime_stream`; use them for provider-native paths, normalized read-only Binance account data, CoinMarketCap quotes/OHLCV, and bounded Binance or CoinMarketCap WebSocket events. Store the CoinMarketCap key in Finance settings and enable CoinMarketCap API requests there. Data availability follows the upstream API, credentials, rate limits, plan, and permissions, not a local whitelist.

## Mainland stock data

AKShare stock data requires Python. Install `akshare` in the configured interpreter:

```sh
python3 -m pip install akshare
```

iFinD supports two explicit transports in Finance settings. `http` uses the Tonghuashun HTTP API and requires an authorized account refresh token; save that token in Finance settings without installing a local SDK. `local` uses the vendor `iFinDPy` SDK and requires the account/password pair. Both transports run through the Host subprocess service, and missing dependencies, credentials, permissions, or data quotas fail explicitly.

## Web dashboard

Apply the dashboard overlay to the Web profile after the finance profile:

```sh
dsh web --patch apps/cli/config/examples/finance-research/dashboard.patch.yml
```

The **Finance dashboard** sidebar entry reads the `finance-research` settings namespace and the Connection-authenticated `/api/finance-dashboard/market` route, then renders crypto, A-share, and US-equity candlesticks, volume, moving averages, RSI, MACD, asset tabs, and quick-symbol lists through `lightweight-charts`. It never receives API keys or secret values; private account data remains available to the agent through `finance_private_account`.
