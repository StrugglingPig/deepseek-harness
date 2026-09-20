# Agent Note: Experimental finance research agent

Status: implemented

English | [中文](2026-09-20-finance-research-agent.zh.md)

## Problem

The harness has a durable Agent Team domain, workflow orchestration, web access, jobs, and report delivery, but no financial domain package. A finance research session therefore has no normalized market-data vocabulary, no deterministic indicator computation, and no report builder. Reusing the Team tools directly would leave the numeric analysis to model reasoning, which is neither reproducible nor auditable.

## Decision

`@deepseek-ai/dsh-experimental-finance-research` provides a keyless research vertical slice: normalized market snapshots for equity, crypto, and prediction instruments; deterministic technical indicators and a multi-indicator summary; and a Markdown research report. It registers three model-facing tools:

- `finance_market_snapshot` returns the normalized instrument, quote, bars, source, and prediction-market fields.
- `finance_technical_analysis` computes SMA, EMA, RSI, MACD, ATR, Bollinger Bands, OBV, directional signals, conflicts, and a composite score.
- `finance_research_report` builds the report from the same snapshot and indicator results and returns structured sections plus Markdown.

The default provider is a deterministic fixture. The package also ships `HttpFinanceMarketDataProvider`, which implements the same interface over Yahoo Finance, Binance, and Polymarket and is enabled by `provider: http`. The HTTP provider additionally implements `describe()` and `request()`: the `finance_provider_describe` tool publishes configured origins and authentication mode, while `finance_provider_request` sends generic provider-native requests without an endpoint whitelist. Binance Spot, USD-M Futures, COIN-M Futures, Options, Yahoo Finance, Polymarket Gamma, and Polymarket CLOB are configured as separate bases. Data availability is owned by the upstream API, credentials, rate limits, network policy, and applicable terms. The bundle `@deepseek-ai/dsh-experimental-finance-research-profile` inserts the finance plugin over `dsh-base`. It is designed to be installed after `dsh-experimental-agent-team-profile`: the Team profile keeps `workflow` and replaces direct `subagent` tools with `spawn_teammate`; the finance plugin adds only new tool names and service-free computation. It does not re-enable or override any Team row.

The finance plugin is intentionally host-level in the bundle. An Agent Team teammate and a workflow child both see the same three tools; no finance tool depends on `ctx.agentTeams` or on a Team Session. The final report remains Lead-owned because only the Lead Session can deliver it with `present`. A Team-aware example preset and research skill live under `apps/cli/config/examples/finance-research`; they omit legacy subagent rows and are copied into the user preset root when a session needs the finance persona and method.

## Alternatives considered

**Modify `dsh-base` or the Agent Team profile.** Rejected because finance is an optional product layer. Changing either shared composition would add financial tool schemas to every session and couple the Team package to a domain.

**Put the finance packages in the stable product groups immediately.** Rejected because the first provider is deterministic fixture data and the Team composition is experimental. The packages use experimental names until a live provider and evaluation suite exist.

**Implement live providers before the research surface.** Rejected because network credentials and provider licensing are deployment-specific, and the repository cannot deterministically test live market data. The provider interface fixes the replacement point; the fixture provider makes the research path reproducible.

**Make Agent Team the only orchestrator.** Rejected because one-click reports need workflow fan-out and structured output, while interactive research needs durable teammates. Both modes consume the same finance tools.

**Compute indicators in model reasoning.** Rejected because RSI, MACD, ATR, Bollinger Bands, and composite weights must be deterministic, testable, and identical across replay.

## Consequences

The package proves the data-to-indicator-to-report path without claiming live market coverage. A deployment must add a provider adapter before using it for actual investment research. The report identifies fixture data as synthetic and does not present the output as investment advice.

The initial package does not provide per-role tool isolation. Agent Team members and workflow children share the finance tool set available in their composition. A deployment that needs different tools per analyst must add a provider or a scoped consumer rather than treating the Team roster as a tool-policy boundary.

## Testing

The package pins indicator edge cases, deterministic fixture generation, report output for equity, crypto, and prediction instruments, tool registration and disposal through the real Loader, and the complete tool-to-report path. The bundle is a static patch; its profile integration is verified by the package manifest and documentation gates.

## Related

- [Agent Teams](2026-08-05-agent-teams.md)
- [Workflow](../../../../docs/subsystems/workflow.md)
- [Agent presets](../../../../packages/preset/agent-presets/README.md)
- [Tool authoring](../../../../docs/cookbook/adding-a-tool.md)
