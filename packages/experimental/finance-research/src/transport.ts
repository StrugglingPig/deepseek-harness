/** Cache, rate-limit, retry, timeout, and JSON transport for finance HTTP providers. */

import { setTimeout as sleep } from 'node:timers/promises'
import { FinanceDataError } from './error.ts'
import type { FinanceHttpMethod, FinanceJsonValue } from './types.ts'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_CACHE_TTL_MS = 5_000
const DEFAULT_CACHE_MAX_ENTRIES = 256
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_BASE_DELAY_MS = 250
const DEFAULT_RETRY_MAX_DELAY_MS = 4_000
const DEFAULT_REQUESTS_PER_MINUTE = 120
const DEFAULT_REQUEST_BURST = 10

/** Options for the shared finance HTTP transport. */
export interface FinanceHttpTransportOptions {
  /** Fetch implementation. */
  readonly fetch: typeof globalThis.fetch
  /** Request timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Successful GET cache lifetime in milliseconds. */
  readonly cacheTtlMs?: number
  /** Maximum cached GET responses. */
  readonly cacheMaxEntries?: number
  /** Retries after the initial request attempt. */
  readonly maxRetries?: number
  /** First retry delay in milliseconds. */
  readonly retryBaseDelayMs?: number
  /** Maximum retry delay in milliseconds. */
  readonly retryMaxDelayMs?: number
  /** Per-origin request budget in requests per minute. */
  readonly requestsPerMinute?: number
  /** Per-origin token-bucket burst capacity. */
  readonly requestBurst?: number
  /** Injectable clock for deterministic cache and rate-limit behavior. */
  readonly now?: () => number
  /** Injectable delay for deterministic retry and rate-limit behavior. */
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

/** One cacheable transport request. */
export interface FinanceTransportRequest {
  /** Absolute upstream URL. */
  readonly url: string
  /** HTTP method. */
  readonly method: FinanceHttpMethod
  /** Request headers. */
  readonly headers?: Readonly<Record<string, string>>
  /** Serialized JSON request body. */
  readonly body?: string
  /** Caller cancellation. */
  readonly signal?: AbortSignal
  /** Whether a successful GET may be served from cache; defaults to true. */
  readonly cache?: boolean
}

/** One parsed upstream response. */
export interface FinanceTransportResponse {
  readonly status: number
  readonly data: FinanceJsonValue
}

interface CacheEntry {
  readonly expiresAt: number
  readonly response: FinanceTransportResponse
}

interface TokenBucket {
  tokens: number
  updatedAt: number
}

interface ResolvedTransportOptions {
  readonly fetch: typeof globalThis.fetch
  readonly timeoutMs: number
  readonly cacheTtlMs: number
  readonly cacheMaxEntries: number
  readonly maxRetries: number
  readonly retryBaseDelayMs: number
  readonly retryMaxDelayMs: number
  readonly requestsPerMinute: number
  readonly requestBurst: number
  readonly now: () => number
  readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Shared transport owning success caching, per-origin rate limits, and retries. */
export class FinanceHttpTransport {
  private readonly options: ResolvedTransportOptions
  private readonly cache = new Map<string, CacheEntry>()
  private readonly buckets = new Map<string, TokenBucket>()

  /**
   * @param options - Fetch implementation and resolved transport policy.
   */
  constructor(options: FinanceHttpTransportOptions) {
    this.options = {
      fetch: options.fetch,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      cacheTtlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      cacheMaxEntries: options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryBaseDelayMs: options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
      retryMaxDelayMs: options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS,
      requestsPerMinute: options.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE,
      requestBurst: options.requestBurst ?? DEFAULT_REQUEST_BURST,
      now: options.now ?? (() => Date.now()),
      sleep: options.sleep ?? ((milliseconds, signal) => sleep(milliseconds, undefined, { signal: signal ?? undefined })),
    }
  }

  /**
   * Send one JSON request through the configured cache, limiter, and retry policy.
   * @param request - URL, method, headers, body, cancellation, and cache choice.
   * @returns The parsed successful response.
   */
  async request(request: FinanceTransportRequest): Promise<FinanceTransportResponse> {
    const cacheKey = request.method === 'GET' && request.cache !== false
      ? `${request.method} ${request.url}`
      : undefined
    if (cacheKey !== undefined) {
      const cached = this.cache.get(cacheKey)
      if (cached !== undefined && cached.expiresAt > this.options.now()) return cached.response
      if (cached !== undefined) this.cache.delete(cacheKey)
    }

    let lastFailure: unknown
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      try {
        await this.waitForToken(request.url, request.signal)
      } catch (error: unknown) {
        if (request.signal?.aborted === true) {
          throw new FinanceDataError(`request aborted for ${request.url}`, 'ABORTED')
        }
        throw error
      }
      try {
        const response = await this.fetchOnce(request)
        if (!response.ok) {
          const failure = new FinanceDataError(
            `request failed for ${request.url}: HTTP ${response.status}`,
            'HTTP_ERROR',
          )
          if (attempt < this.options.maxRetries && isRetryableStatus(response.status)) {
            await this.delay(this.retryDelayMs(response, attempt), request.signal)
            continue
          }
          throw failure
        }
        let data: FinanceJsonValue
        try {
          data = await response.json() as FinanceJsonValue
        } catch (error: unknown) {
          throw new FinanceDataError(`invalid JSON from ${request.url}: ${errorMessage(error)}`, 'INVALID_JSON')
        }
        const result = { status: response.status, data }
        if (cacheKey !== undefined) this.store(cacheKey, result)
        return result
      } catch (error: unknown) {
        if (error instanceof FinanceDataError) throw error
        lastFailure = error
        if (attempt < this.options.maxRetries) {
          await this.delay(Math.min(
            this.options.retryMaxDelayMs,
            this.options.retryBaseDelayMs * 2 ** attempt,
          ), request.signal)
          continue
        }
      }
    }
    if (request.signal?.aborted === true) {
      throw new FinanceDataError(`request aborted for ${request.url}`, 'ABORTED')
    }
    throw new FinanceDataError(`request failed for ${request.url}: ${errorMessage(lastFailure)}`, 'REQUEST_FAILED')
  }

  private async fetchOnce(request: FinanceTransportRequest): Promise<Response> {
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs)
    const requestSignal = request.signal === undefined
      ? timeoutSignal
      : AbortSignal.any([request.signal, timeoutSignal])
    return await this.options.fetch(request.url, {
      method: request.method,
      ...request.headers === undefined ? {} : { headers: request.headers },
      ...request.body === undefined ? {} : { body: request.body },
      signal: requestSignal,
    })
  }

  private retryDelayMs(response: Response, attempt: number): number {
    const retryAfter = response.headers.get('retry-after')
    if (retryAfter !== null) {
      const seconds = Number(retryAfter)
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
    }
    return Math.min(this.options.retryMaxDelayMs, this.options.retryBaseDelayMs * 2 ** attempt)
  }

  private async delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (milliseconds > 0) await this.options.sleep(milliseconds, signal)
  }

  private store(key: string, response: FinanceTransportResponse): void {
    if (this.options.cacheMaxEntries <= 0) return
    while (this.cache.size >= this.options.cacheMaxEntries) {
      const oldest = this.cache.keys().next().value
      /* v8 ignore next -- the loop condition guarantees that at least one key exists. */
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
    this.cache.set(key, { expiresAt: this.options.now() + this.options.cacheTtlMs, response })
  }

  private async waitForToken(url: string, signal?: AbortSignal): Promise<void> {
    const origin = new URL(url).origin
    const now = this.options.now()
    const rate = this.options.requestsPerMinute / 60_000
    const existing = this.buckets.get(origin)
    const tokens = Math.min(
      this.options.requestBurst,
      (existing?.tokens ?? this.options.requestBurst) + (now - (existing?.updatedAt ?? now)) * rate,
    )
    if (tokens >= 1) {
      this.buckets.set(origin, { tokens: tokens - 1, updatedAt: now })
      return
    }
    const waitMs = Math.ceil((1 - tokens) / rate)
    await this.delay(waitMs, signal)
    await this.waitForToken(url, signal)
  }
}
