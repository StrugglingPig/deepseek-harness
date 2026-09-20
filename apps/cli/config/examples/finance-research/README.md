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

The finance tools themselves come from the `finance-research` row inserted by `@deepseek-ai/dsh-experimental-finance-research-profile`.

## Live data

Apply the live-provider patch when the profile should use Yahoo Finance, Binance, and Polymarket instead of the deterministic fixture:

```sh
dsh web --patch apps/cli/config/examples/finance-research/live.patch.yml
```

The patch sets `provider: http` on the inserted `finance-research` row. It requires outbound network access to the public provider endpoints. The HTTP provider also registers `finance_provider_query`; call `operation: "capabilities"` first to discover Binance Spot/USD-M/COIN-M/Options, Yahoo, Polymarket Gamma, and Polymarket CLOB operations. `raw_get` covers a public GET path the catalog does not yet name.
