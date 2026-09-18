# Glossary

English | [中文](glossary.zh.md)

Domain vocabulary for DeepSeek Harness uses one canonical term per concept. Terms link to their entries with standard Markdown anchors; implementation detail stays in package READMEs and Agent Notes.

## capability-seam

- **seam** — a *swappable capability* with three roles: a **Service Definition** (the Cordis `Service` that owns its `ctx.<key>` and vocabulary types — an abstract class such as `ShellExecutor`, or a concrete registry such as `WebRuntime`, never a TypeScript `interface`), one or more **Service Providers**, and one or more **Consumers** that inject the service. `packages/shell` is the canonical example: `dsh-shell` (Service Definition), `dsh-bash-local` / `dsh-bash-sandbox` (providers), and `dsh-tool-bash` (Consumer). Roles normally occupy separate packages when they evolve independently, but a package may own multiple roles when they are one concern (`dsh-user-approval` owns the approval seam's Service Definition and its concrete implementation in one package). The seam is the complete capability, never one role; reserve the term for that meaning and name a constituent by its role, class, service, contract, or extension point.

## plugin-kinds

Three kinds of code shape one feature, and a reader must be able to say which one they are looking at before changing it. The first two are the same mechanism — a Cordis plugin with `name` / `inject` / optional `Config` / `apply` — differing only in how the composition selects it; only the third is outside the plugin tree.

- **shipped plugin** — a Cordis plugin a bundle's `cordis.patch.yml` assembles, carrying its own `- id:` row. The official bundles are the assembly source, not a privilege tier: `agent-loop` is a shipped plugin too, and `dsh-bundle-*` patches select it like any other. A row may ship `disabled: true` — packaged and patchable, not enabled by default — so presence in the tree is a separate question from enablement. Change one by editing its package and its bundle row.
- **external plugin** — the same Cordis plugin, installed into a profile at runtime instead of named by a bundle: a dependency of `<dshHome>/profiles/<name>/package.json`, written by `dsh-plugin-manager`. A bare `cordis.yml` plugin must appear in its resolver manifest's `dependencies` (`verify-cordis-config` enforces it), and a Client plugin declares `dsh.client` with its `inject` list and `platform`. Nothing else distinguishes it from a shipped plugin.
- **host code** — code the composition does not select, because it is the position rather than an occupant. A slot's declaration belongs to the component that owns and renders that location (see [slots](subsystems/slots.md)); the declaring package is host code for that slot and every other package contributes through `ctx.slots.register()`. Event vocabulary in a contract package, and the concrete loop itself, are the same shape: a plugin may be replaced, but the position it occupies is not a contribution.

**Judgment.** A row with its own `- id:` in a bundle patch or a profile manifest is a plugin, shipped or external. Reaching a feature by editing package source that no row selects means it is host code. This distinction decides the edit: a plugin's behavior changes from its own package without touching its host, while a slot's position changes only in the owning component.

## agent-scope

- **scope** — the unit of per-agent registration: a contribution (tool, prompt section, variable, restriction, listener) is either *global* (visible to every agent) or *scoped* (owned by exactly one [scope key](#scope-key)). Two levels, flat: scoped registrations do not inherit down to subagents; subtree behavior is expressed with [lineage](#lineage) data, never scope structure.
- **scope key** — the opaque identity a scope is keyed by, compared by object identity. The harness convention: a live agent is the key of its own scope. <a id="scope-key"></a>
- **agent context (`agent.ctx`)** — the agent's scoped context; registrations through it are scope-visible AND scope-lifetime (one fact drives both), and listeners on it participate in that agent's scope-filtered dispatches. Registry-subject events may remain deliberately unfiltered under their own event contracts.
- **scope carrier** — the `thisArg` a scope-filtered dispatch carries (built by `scopeTarget`); its filter admits untagged listeners plus the subject's own. A *subject-less* carrier (no key) admits untagged listeners only.
- **scoped dispatch** — the rule: an event about one agent's activity dispatches with that agent's carrier. Events about a registry itself (a tool was added) are *registry-subject* and stay unfiltered.
- **shadowing** — most-specific-wins name resolution: a scoped tool/section/variable replaces its same-named global twin for that scope alone. The per-agent persona and per-agent tool-variant mechanism.
- **restriction / scope-local registration** — a restriction (`tools.restrict`) filters the GLOBAL tool set for one scope (compose by intersection); scope-local registrations are merged after that filter. A filtered-away global tool is absent from the prompt AND refuses execution, indistinguishably from a nonexistent one.
- **setup window** — the creation slot where a creator composes an agent's scoped world (`CreateAgentOptions.setup`): after the scope and agent object exist but before the agent or session is published, `agent/created` fires, or the first prompt is assembled. Setup registers; it never drives the agent.
- **lineage** — parent/child facts carried as data (`parentSession`, durable `delegationDepth`, runtime `subagentDepth`); never affects visibility. <a id="lineage"></a>

## goal

- **goal** — one durable completion objective attached to an existing session, with a revisioned `active` / `paused` / `blocked` / `complete` phase and a goal-round cap; `blocked` retains a policy code and explanation. A goal is state, not a scheduler or a separate conversation; the session log remains its source of truth.
- **goal round** — one continuation cycle admitted for the current goal. The same-session driver materializes a goal round as one goal-sourced [turn](#turn), which can contain zero or more steps; unrelated human turns in the same session do not consume the goal-round cap. <a id="goal-round"></a>
- **goal activation** — process-local permission for a continuation consumer to admit another goal round. Activation is either `armed` or `disarmed`; it is deliberately absent from durable replay, so resume and fork require a later human-authorized resume mutation through `/goal` or the model tool before automatic work.

## human command

- **human command** — a slash-prefixed instruction interpreted and executed by a human-facing adapter through `ctx.commands`, without becoming a model message. It is distinct from a model-facing tool and from shell command execution through `ctx.shell`.
- **command plane** — discovery, parsing, dispatch, cancellation, and result rendering owned by UI adapters and command plugins. Command output is UI state unless the handler separately mutates a durable domain.
- **goal command** — the `/goal` human command contributed by `dsh-command-goal`; it observes or mutates the current goal directly while the goal domain owns every durable, model-visible record.

## loop hierarchy

- **turn** — one drain of admitted input in a session, ending after the model and its tools stop or a terminal policy intervenes. <a id="turn"></a>
- **step** — one model request plus the tool executions caused by its response; a turn contains zero or more steps. <a id="step"></a>
- **round** — an outer policy iteration containing a turn, such as a [goal round](#goal-round) or one fresh-agent Ralph attempt. Round counters belong to that policy and do not count every turn in a session. <a id="round"></a>

## Ralph

- **Ralph loop** — one foreground fresh-agent workflow run toward an immutable objective. It is a model-facing tool policy composed from workflow and subagent primitives, not a same-session goal, agent-loop mode, scheduler, or generic workflow-script feature. <a id="ralph-loop"></a>
- **Ralph round** — one fresh child session in a [Ralph loop](#ralph-loop). The child receives no parent or prior-child conversation seed; the shared workspace and one bounded [Ralph handoff](#ralph-handoff) carry cross-round state. <a id="ralph-round"></a>
- **Ralph handoff** — the normalized bounded structured report passed from one continuing Ralph round to the next, containing status, summary, evidence, next steps, and blocker text. It supplements the shared workspace rather than replacing it as authority. <a id="ralph-handoff"></a>
