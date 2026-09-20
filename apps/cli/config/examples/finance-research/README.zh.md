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
