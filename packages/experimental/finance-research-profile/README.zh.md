---
description: "实验性 Profile 层：在 dsh-base 上安装金融研究工具和定时监控，供 Agent Team 或 Workflow 使用。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-finance-research-profile

English | [中文](README.md)

## 概述

`dsh-experimental-finance-research-profile` 是一个静态 Profile 层。它在 `dsh-base` 上插入 `@deepseek-ai/dsh-experimental-finance-research` 和 `@deepseek-ai/dsh-schedule`；不会修改 base 行、Agent Team 行或 preset 作用域中的 delegation 工具。Schedule 行让 `finance_monitor_plan` 具备持久化投递路径。Profile 使用 Agent Teams 时，请在 `dsh-experimental-agent-team-profile` 之后安装。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

在已经包含 `dsh-base` 的初始 Profile 中安装：

```sh
dsh plugin --profile headless add @deepseek-ai/dsh-experimental-finance-research-profile
dsh --profile headless "Generate a BTC research report"
```

Agent Teams 场景请在 Team host 层之后安装：

```sh
dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-profile
dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-web-profile
dsh plugin --profile web add @deepseek-ai/dsh-experimental-finance-research-profile
```

金融层只新增金融自有行：`finance-research` 提供行情/研究工具，`finance-schedule` 提供持久化监控投递。在其后应用 [live-provider patch](../../../apps/cli/config/examples/finance-research/live.patch.yml)，即可把该行切换为 `provider: http`。Team-aware 示例 preset 和研究 Skill 位于 [apps/cli/config/examples/finance-research](../../../apps/cli/config/examples/finance-research/README.zh.md)；将该目录复制到 `$DSH_HOME/.agent-presets/finance-research` 后即可选择。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

包的运行时内容是 `cordis.patch.yml`。它插入 id 为 `finance-research`、name 为 `@deepseek-ai/dsh-experimental-finance-research` 的行，以及 id 为 `finance-schedule`、name 为 `@deepseek-ai/dsh-schedule` 的行。包不持有可变状态。No runtime invariant companion is published because this static patch owns no independent relationship to check.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Finance research tools](../finance-research/README.zh.md) — 标准化、Provider、私有账户、实时流和监控规划工具。
- [Finance dashboard](../client-ui-finance-dashboard/README.zh.md) — 可选的 Web 实时 Binance Spot 图表面板。
- [Agent Teams profile](../agent-team-profile/README.zh.md) — 本 Bundle 可以跟随的 Team host 层。

-----

<a id="model-experience"></a>
## Model Experience

### Inserted finance tools

#### What the model sees

本 Bundle 不直接贡献模型可见 prompt 或工具 Schema；插入的包贡献金融工具，以及 `finance_monitor_plan` 使用的持久化 `schedule_create` 路径。

#### Token effect

Bundle 的直接 token 影响为零；插入的包拥有工具 Schema 成本。

#### KV Cache effect

Bundle 不添加请求内容；插入的包拥有任何 cache-prefix 变化。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **默认非实时 Provider** — 安装后的包使用确定性 fixture 数据，直到 live patch 或其他组合提供 `provider: http`。
- **No preset file installation** — Bundle 只插入 host 配置；需要金融专用 Agent Preset 的部署必须单独编写并选择。
- **Web dashboard is a separate package** — 浏览器图表由 `@deepseek-ai/dsh-experimental-client-ui-finance-dashboard` 提供，而不是这个 host bundle。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
