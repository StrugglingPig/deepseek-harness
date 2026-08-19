/**
 * The shared OpenAI-compatible `GET /models` interrogation behind the
 * configuration surface's "fetch available models" action. Adapter packages
 * own their catalogs and protocol gates; the wire half lives here so one
 * implementation serves every adapter whose endpoint speaks OpenAI's listing
 * shape (`llm-pi-ai` gateways and self-hosted servers, `llm-deepseek` custom
 * base URLs).
 *
 * Neither caller stores what this returns: the request carries a draft the
 * user is still editing, and the reply is candidate metadata a surface offers
 * for adoption. `settings.yaml` remains the only thing that decides what a
 * route serves.
 *
 * @module @deepseek-ai/dsh-llm/model-listing
 */

import { normalizeApiKey } from './api-key.ts'
import { attributionHeaders } from './attribution.ts'
import { INVALID_CREDENTIAL_CODE } from './error.ts'
import { LlmError } from './error.ts'
import type { LlmDiscoveredModel, LlmModelDiscoveryRequest } from './types.ts'

/**
 * Endpoint replies larger than this are refused. The endpoint is whatever URL
 * the user typed, so the ceiling holds on the bytes actually read rather than
 * on the length the server claims — the same two-stage shape `dsh-web-fetch`
 * uses for its own caller-supplied URLs, except that a truncated model listing
 * is not parseable, so overflow rejects instead of truncating.
 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/** One entry of an OpenAI-compatible `GET /models` reply. */
interface ListingEntry {
  id?: unknown
  /** Common gateway extensions; absent from the official listings. */
  name?: unknown
  display_name?: unknown
  context_window?: unknown
  context_length?: unknown
  max_tokens?: unknown
  max_output_tokens?: unknown
}

/** A positive integer field of a listing entry, or `undefined` when absent or unusable. */
function capacity(...candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) return candidate
  }
  return undefined
}

/** A non-empty string field of a listing entry, or `undefined`. */
function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/**
 * Join the endpoint base with the listing path. The base is treated as a
 * prefix rather than a URL to resolve against, so a deployment path such as
 * `https://gateway.example/openai/v1` keeps its segments instead of losing
 * them to `URL` resolution.
 */
function listingUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/models`
}

/**
 * Read a reply body, refusing one that outgrows the ceiling. A declared length
 * is checked first so an honest server is turned away without transferring
 * anything; the accumulated total is what actually enforces the bound, because
 * a server that under-declares (or streams) tells us nothing up front.
 */
async function readBounded(response: Response, url: string): Promise<string> {
  const oversized = (): LlmError =>
    new LlmError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, 'DISCOVERY_FAILED')
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    try {
      await response.body?.cancel()
    } catch {
      // Best-effort cleanup of a body this function refuses to read; a
      // rejecting cancel must not mask the oversize refusal.
    }
    throw oversized()
  }
  /* v8 ignore next -- fetch always exposes a body stream on a 2xx Response; the null guard is defensive. */
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw oversized()
      chunks.push(value)
    }
  } finally {
    /* v8 ignore next 4 -- cancel() after a completed or abandoned read settles without rejecting; unobserved best-effort cleanup. */
    await reader.cancel().catch(() => {
      // Cancel after a drained read, or after this function walked away from
      // an oversized one, is cleanup; the reply is already decided either way.
    })
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/**
 * Read one OpenAI-compatible listing reply. Entries without a usable id are
 * skipped rather than failing the whole interrogation: a single malformed row
 * should not deny the user the rest of a working endpoint's catalog.
 */
function readListing(body: unknown): LlmDiscoveredModel[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    throw new LlmError(
      'the endpoint\'s model listing has no "data" array; enter this provider\'s models by hand',
      'DISCOVERY_FAILED',
    )
  }
  const models: LlmDiscoveredModel[] = []
  for (const raw of data) {
    const entry = raw as ListingEntry | null
    const id = label(entry?.id)
    if (id === undefined) continue
    const name = label(entry?.name, entry?.display_name)
    const contextWindow = capacity(entry?.context_window, entry?.context_length)
    const maxTokens = capacity(entry?.max_output_tokens, entry?.max_tokens)
    models.push({
      id,
      ...name === undefined ? {} : { name },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
    })
  }
  return models
}

/**
 * Accept one probe key, or refuse it before the header is built. Without this
 * the `fetch` below would throw a ByteString `TypeError` that this function's
 * catch reports as `could not reach <url>` — blaming the network for a local,
 * deterministic fault.
 * @param raw - the key the caller resolved for this probe, typed into the
 *   form or read from storage.
 * @returns the trimmed, usable key.
 */
function usableProbeKey(raw: string): string {
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  throw new LlmError(
    checked.reason === 'empty'
      ? 'this provider\'s API key is blank; enter it on the Models page, or clear it to probe unauthenticated'
      : 'this provider\'s API key contains characters no HTTP header can carry; paste the raw key only',
    INVALID_CREDENTIAL_CODE,
  )
}

/**
 * Adapter-known facts for one model id (the map key), used to fill what a
 * listing endpoint omitted: most `GET /models` replies disclose an id and
 * nothing else, while the adapter's own catalog carries the name and
 * capacities for the ids it ships. Values may carry extra catalog fields
 * (a `description`, the id itself); only these three are read.
 */
export interface LlmKnownModelFacts {
  /** Human-readable name from the adapter's catalog. */
  name?: string
  /** Maximum combined context the adapter advertises. */
  contextWindow?: number
  /** Maximum output tokens the adapter advertises. */
  maxTokens?: number
}

/**
 * Fill a wire listing's omissions from adapter-known facts, matched by id.
 * The endpoint stays authoritative for whatever it disclosed: a disclosed
 * name or capacity wins over the catalog's, and an id the catalog does not
 * ship passes through bare.
 * @param listed - models as the endpoint reported them.
 * @param known - adapter catalog facts keyed by model id.
 * @returns the listed models with omitted fields inherited from `known`.
 */
export function enrichDiscoveredModels(
  listed: readonly LlmDiscoveredModel[],
  known: ReadonlyMap<string, LlmKnownModelFacts>,
): readonly LlmDiscoveredModel[] {
  return listed.map((model) => {
    const hit = known.get(model.id)
    if (hit === undefined) return model
    return {
      ...model,
      ...model.name === undefined && hit.name !== undefined ? { name: hit.name } : {},
      ...model.contextWindow === undefined && hit.contextWindow !== undefined
        ? { contextWindow: hit.contextWindow }
        : {},
      ...model.maxTokens === undefined && hit.maxTokens !== undefined ? { maxTokens: hit.maxTokens } : {},
    }
  })
}

/**
 * Interrogate one OpenAI-compatible endpoint for the models it advertises
 * (`GET {baseURL}/models` with bearer auth and attribution headers).
 * @param request - the endpoint (`baseURL`), one-shot credential (`apiKey`),
 *   and caller cancellation (`signal`) to use. `provider` and `api` are the
 *   caller's catalog and protocol decisions; this reader honors neither.
 * @returns the advertised models in endpoint order, entries without a usable
 *   id skipped.
 * @throws LlmError `DISCOVERY_FAILED` when the request names no baseURL, the
 *   endpoint is unreachable, refuses the request, overruns the byte ceiling,
 *   or answers something that is not a model listing; `INVALID_CREDENTIAL`
 *   for a blank or header-illegal `apiKey`; `ABORTED` on caller cancellation.
 */
export async function fetchOpenAiCompatibleModels(
  request: Pick<LlmModelDiscoveryRequest, 'baseURL' | 'apiKey' | 'signal'>,
): Promise<readonly LlmDiscoveredModel[]> {
  const baseURL = request.baseURL
  if (baseURL === undefined || baseURL.length === 0) {
    throw new LlmError(
      'model discovery needs a baseURL; enter this provider\'s models by hand',
      'DISCOVERY_FAILED',
    )
  }
  const url = listingUrl(baseURL)
  // A blank key probes unauthenticated at the caller's choice; a typed key is
  // the one the user is testing, validated before the network is blamed for it.
  const apiKey = request.apiKey === undefined ? undefined : usableProbeKey(request.apiKey)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` },
        ...attributionHeaders(),
      },
      ...request.signal === undefined ? {} : { signal: request.signal },
    })
  } catch (error: unknown) {
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw new LlmError(`could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!response.ok) {
    throw new LlmError(
      `${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the API key' : ''}`,
      'DISCOVERY_FAILED',
    )
  }
  let text: string
  try {
    text = await readBounded(response, url)
  } catch (error: unknown) {
    // Cancellation during the body read rejects with the abort reason, which
    // may be any value; the caller gets the same coded failure it would have
    // for a cancellation before the request went out. The oversize refusal
    // already names the bound and keeps its own message.
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    if (error instanceof LlmError) throw error
    throw new LlmError(`could not read the model listing from ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error: unknown) {
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
  }
  return readListing(body)
}
