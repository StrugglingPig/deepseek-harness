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
