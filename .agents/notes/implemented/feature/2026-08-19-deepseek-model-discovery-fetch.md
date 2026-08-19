# Agent Note: DeepSeek model discovery fetch

Status: implemented

English | [中文](2026-08-19-deepseek-model-discovery-fetch.zh.md)

## Problem

The Models settings page offered "fetch available models" only to pi-ai profiles. The DeepSeek card's custom-settings fold listed its advisory catalog for manual editing and nothing else: a deployment pointing `llm-deepseek.baseURL` at a gateway or proxy had to transcribe that endpoint's model list by hand, while the pi-ai card one click away listed its endpoint's models through OpenAI's `GET /models` shape. Two roots: `llm-deepseek` never registered `ctx.llm.registerModelDiscovery`, and the client rendered the DeepSeek family through a manual-only editor twin of the pi-ai one.

## Decision

**One shared wire interrogation in `@deepseek-ai/dsh-llm`.** The OpenAI-compatible `GET /models` reader (prefix-joined listing path, bearer auth, attribution headers, four-megabyte received-byte ceiling, id-less entries skipped, `DISCOVERY_FAILED`/`INVALID_CREDENTIAL`/`ABORTED` taxonomy) moved from `llm-pi-ai/src/discovery.ts` to `dsh-llm` as `fetchOpenAiCompatibleModels`. A second copy in `llm-deepseek` would trip the repository's jscpd gate (minTokens 60 / minLines 6) and drift; pi-ai keeps only what is pi-ai's: the installed-catalog short-circuit and the `LISTABLE_PROTOCOLS` gate.

**`llm-deepseek` registers discovery with two paths.** A probe naming the owned route without a base URL answers from the live advisory catalog (`options().models`), read per ask so a settings edit lands without re-registration and costs no network call. A probe carrying a base URL — including one for the owned route, because that is the gateway being tested — interrogates the endpoint through the shared reader. The stored-key resolver is soft: a section with no key probes unauthenticated instead of throwing the request path's `MISSING_CREDENTIAL`, mirroring pi-ai's posture; the adapter's request path still throws from the same resolver, so one body serves both semantics and the file keeps no near-duplicate pair for the duplication gate to flag.

**The client unifies both families on `ModelListEditor`.** `DeepSeekModelsEditor` is deleted; its pure helpers (draft shape, K/M capacity vocabulary, adapter catalog validation) live in `model-drafts.ts`. The unified editor ports the deepseek-pinned behaviors — id trim on blur, capacity settle on blur, reset clearing the per-row buffers — and takes optional `defaultContextWindow`/`defaultMaxTokens` so the DeepSeek card shows its adapter fallbacks as capacity placeholders where pi-ai keeps the generic magnitudes. The localized placeholder keys are removed with their last reader.

**Adopted rows inherit adapter-known facts.** A bare `GET /models` reply usually discloses ids alone, which made adopted rows read poorer than shipped ones (empty display name, empty capacities). The deepseek discovery enriches the wire reply by id (`enrichDiscoveredModels` in `dsh-llm`, shared and jscpd-safe), the endpoint staying authoritative for whatever it disclosed; the client additionally defaults an adopted row's display name to its id. The knowledge source merges the live catalog with a per-id facts table: a built-in market-common default whose figures mirror the vendor catalog data bundled with the pi-ai twin, overridden id by id by the `modelFacts` settings field, so proxy-renamed models still auto-fill; the shipped advisory catalog also carries each V4 route's output cap now. pi-ai needs no enrichment: its catalog routes never reach the wire, and a non-catalog route has no known facts to inherit.

## Alternatives considered

**Duplicate the wire reader inside `llm-deepseek`.** Rejected: the duplication gate exists for exactly this, and two readers would diverge on gateway extensions (the `display_name`/`context_length` spellings) within weeks.

**Keep two editors and add the fetch button to the manual twin.** Rejected: the editors already differed only in extras; the fetch action, picker, and adoption merge would have been the second copy, and row behavior (blur settle, reset semantics) had already drifted once.

**Answer a base-URL probe for the owned route from the catalog.** Rejected: the typed base URL is the endpoint under test; describing the shipped endpoint instead would list the wrong server's models.

## Consequences

The DeepSeek card now offers the standard-protocol fetch: success opens the adoption picker (already-configured ids start unchecked), failure shows the adapter's message beside rows that stay hand-editable. Keyless e2e covers the button and picker through `models-settings.e2e.ts` (`deepseek-edit.expected.md`) because the route-named probe answers from the catalog with no network and no credential. `dsh-llm`'s public surface gains one helper; its README, both adapter READMEs, and the `ui-settings-models` README name the shared reader. Verification: focused vitest on the three llm packages and the client package, the per-file coverage gate, jscpd, and the web snapshot replay.
