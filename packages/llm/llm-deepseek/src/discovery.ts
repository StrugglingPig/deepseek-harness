/**
 * Model discovery for the `llm-deepseek` settings namespace: the provider
 * route answers from its live advisory catalog (no network call, and a
 * settings-edited catalog is reflected without re-registration), while a
 * base URL the draft names is interrogated through the shared
 * OpenAI-compatible listing reader in `@deepseek-ai/dsh-llm`.
 *
 * Nothing here is stored: the request carries a draft the user is still
 * editing, and the reply is candidate metadata the surface offers for
 * adoption. `settings.yaml` remains the only thing that decides what the
 * route serves.
 *
 * @module dsh-llm-deepseek/discovery
 */

import { enrichDiscoveredModels, fetchOpenAiCompatibleModels, LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel, LlmKnownModelFacts, LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm'
import type { DeepSeekCatalogModel, DeepSeekModelFacts } from './adapter.ts'

/** What one interrogation of this namespace needs from the running plugin. */
export interface DeepSeekDiscoveryDeps {
  /** The single provider route this namespace owns. */
  provider: string
  /** Live advisory catalog; the catalog answer tracks settings edits. */
  models: () => readonly DeepSeekCatalogModel[]
  /** Configured per-id facts; they win over the live catalog, id by id. */
  modelFacts: () => readonly DeepSeekModelFacts[]
  /**
   * The credential the section currently resolves, or `undefined` to probe
   * unauthenticated — a missing key is a posture, not a failure, here.
   */
  storedApiKey: () => Promise<string | undefined>
}

/**
 * Interrogate one draft for the models this namespace can advertise.
 * @param request - the route being edited, or an endpoint to interrogate.
 * @param deps - the running plugin's route identity, live options, and stored
 *   credential.
 * @returns the advisory catalog for the owned route, or the endpoint's
 *   advertised models in endpoint order.
 * @throws LlmError `DISCOVERY_FAILED` when the draft names neither the owned
 *   route nor a baseURL, or when the endpoint refuses or fails; credential
 *   and abort failures carry through from the shared reader.
 */
export async function discoverModels(
  request: LlmModelDiscoveryRequest,
  deps: DeepSeekDiscoveryDeps,
): Promise<readonly LlmDiscoveredModel[]> {
  const baseURL = request.baseURL
  // A draft that sets a base URL interrogates that endpoint even for the
  // owned route: the user is testing a proxy or gateway, and answering from
  // the catalog would describe the wrong server.
  if (baseURL === undefined || baseURL.length === 0) {
    if (request.provider === deps.provider) {
      return deps.models().map(model => ({
        id: model.id,
        ...model.name === undefined ? {} : { name: model.name },
        ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
        ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      }))
    }
    throw new LlmError(
      `llm-deepseek owns provider "${deps.provider}", not "${request.provider ?? ''}"; set a baseURL,`
      + " or enter this provider's models by hand",
      'DISCOVERY_FAILED',
    )
  }
  // A key typed into the form wins over the stored one; a probe carrying no
  // key stays unauthenticated rather than failing the ask.
  const supplied = request.apiKey ?? await deps.storedApiKey()
  const listed = await fetchOpenAiCompatibleModels({
    baseURL,
    ...supplied === undefined ? {} : { apiKey: supplied },
    ...request.signal === undefined ? {} : { signal: request.signal },
  })
  // A listing usually discloses ids alone; the live catalog plus the
  // configured facts table supply the names and capacities the endpoint
  // omitted. Facts merge field-wise over the catalog, so a configured cap
  // wins without erasing the catalog's name.
  const known = new Map<string, LlmKnownModelFacts>()
  for (const model of deps.models()) known.set(model.id, model)
  for (const facts of deps.modelFacts()) {
    const prior = known.get(facts.id)
    known.set(facts.id, {
      ...prior,
      ...facts.name !== undefined ? { name: facts.name } : {},
      ...facts.contextWindow !== undefined ? { contextWindow: facts.contextWindow } : {},
      ...facts.maxTokens !== undefined ? { maxTokens: facts.maxTokens } : {},
    })
  }
  return enrichDiscoveredModels(listed, known)
}
