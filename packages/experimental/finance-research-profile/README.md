---
description: "Experimental profile layer that installs the deterministic finance research tool package over dsh-base for use with Agent Teams or Workflow."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-finance-research-profile

English | [中文](README.zh.md)

## Summary

`dsh-experimental-finance-research-profile` is one static profile layer. It inserts `@deepseek-ai/dsh-experimental-finance-research` over `dsh-base`; it does not modify base rows, Agent Team rows, or preset-scoped delegation tools. Install it after `dsh-experimental-agent-team-profile` when the profile uses Agent Teams.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install the bundle into an initialized profile that already contains `dsh-base`:

```sh
dsh plugin --profile headless add @deepseek-ai/dsh-experimental-finance-research-profile
dsh --profile headless "Generate a BTC research report"
```

For Agent Teams, install it after the Team host layer:

```sh
dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-profile
dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-web-profile
dsh plugin --profile web add @deepseek-ai/dsh-experimental-finance-research-profile
```

The finance layer adds only the `finance-research` row. Apply the [live-provider patch](../../../apps/cli/config/examples/finance-research/live.patch.yml) after it to switch the row to `provider: http`. A Team-aware example preset and research skill live under [apps/cli/config/examples/finance-research](../../../apps/cli/config/examples/finance-research/README.md); copy that directory to `$DSH_HOME/.agent-presets/finance-research` to select it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package runtime content is `cordis.patch.yml`. It inserts one row with id `finance-research` naming `@deepseek-ai/dsh-experimental-finance-research`. The package holds no mutable state. No runtime invariant companion is published because this static patch owns no independent relationship to check.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Finance research tools](../finance-research/README.md) — the three tools and their provider extension point.
- [Agent Teams profile](../agent-team-profile/README.md) — the Team host layer this bundle can follow.

-----

<a id="model-experience"></a>
## Model Experience

### Inserted finance tools

#### What the model sees

This bundle contributes no model-visible prompt or tool schema directly; the inserted package contributes `finance_market_snapshot`, `finance_technical_analysis`, and `finance_research_report`.

#### Token effect

Zero direct token effect from the bundle; the inserted package owns the tool-schema cost.

#### KV Cache effect

The bundle adds no request content. The inserted package owns any cache-prefix change.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No live provider** — the installed package uses deterministic fixture data until a deployment supplies another `FinanceMarketDataProvider`.
- **No preset file installation** — the bundle inserts host configuration only; deployments that want a finance-specific Agent Preset must author and select it separately.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
