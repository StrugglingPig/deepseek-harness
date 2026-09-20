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

金融工具本身来自 `@deepseek-ai/dsh-experimental-finance-research-profile` 插入的 `finance-research` 行。

## Live data

当 Profile 应使用 Yahoo Finance、Binance 和 Polymarket 而不是确定性 fixture 时，应用 live provider patch：

```sh
dsh web --patch apps/cli/config/examples/finance-research/live.patch.yml
```

Patch 会把插入的 `finance-research` 行设置为 `provider: http`。它需要能够访问这些公共 Provider 端点。
