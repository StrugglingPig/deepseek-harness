import { describe, expect, it, vi } from 'vitest'
import { FinanceHttpTransport } from '../src/transport.ts'
import type { FinanceJsonValue } from '../src/types.ts'

interface Clock {
  now: number
}

function jsonResponse(value: FinanceJsonValue, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), { status, ...headers === undefined ? {} : { headers } })
}

function clockTransport(options: {
  readonly fetch: typeof globalThis.fetch
  readonly cacheTtlMs?: number
  readonly cacheMaxEntries?: number
  readonly maxRetries?: number
  readonly retryBaseDelayMs?: number
  readonly retryMaxDelayMs?: number
  readonly requestsPerMinute?: number
  readonly requestBurst?: number
}) {
  const clock: Clock = { now: 1_000 }
  const sleeps: number[] = []
  const transport = new FinanceHttpTransport({
    ...options,
    timeoutMs: 1_000,
    now: () => clock.now,
    sleep: async (delayMs) => {
      sleeps.push(delayMs)
      clock.now += delayMs
    },
  })
  return { clock, sleeps, transport }
}

describe('FinanceHttpTransport', () => {
  it('serves repeated GET requests from cache until the TTL expires', async () => {
    const fetch = vi.fn(async () => jsonResponse({ value: 1 }))
    const { clock, transport } = clockTransport({ fetch, cacheTtlMs: 100 })

    await expect(transport.request({ url: 'https://cache.test/data', method: 'GET' }))
      .resolves.toEqual({ status: 200, data: { value: 1 } })
    await expect(transport.request({ url: 'https://cache.test/data', method: 'GET' }))
      .resolves.toEqual({ status: 200, data: { value: 1 } })
    expect(fetch).toHaveBeenCalledTimes(1)

    clock.now += 100
    await transport.request({ url: 'https://cache.test/data', method: 'GET' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not cache requests that opt out', async () => {
    const fetch = vi.fn(async () => jsonResponse({ value: 1 }))
    const { transport } = clockTransport({ fetch, cacheTtlMs: 1_000 })

    await transport.request({ url: 'https://private.test/account', method: 'GET', cache: false })
    await transport.request({ url: 'https://private.test/account', method: 'GET', cache: false })

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('retries retryable responses with bounded exponential backoff', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 500))
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503))
      .mockResolvedValueOnce(jsonResponse({ value: 1 }))
    const { sleeps, transport } = clockTransport({
      fetch,
      maxRetries: 2,
      retryBaseDelayMs: 10,
      retryMaxDelayMs: 15,
    })

    await expect(transport.request({ url: 'https://retry.test/data', method: 'GET' }))
      .resolves.toEqual({ status: 200, data: { value: 1 } })
    expect(sleeps).toEqual([10, 15])
  })

  it('honors Retry-After for a rate-limited response', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'limit' }, 429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse({ value: 1 }))
    const { sleeps, transport } = clockTransport({ fetch, maxRetries: 1, retryBaseDelayMs: 10 })

    await transport.request({ url: 'https://retry-after.test/data', method: 'GET' })

    expect(sleeps).toEqual([2_000])
  })

  it('shares a token bucket per origin', async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }))
    const { sleeps, transport } = clockTransport({
      fetch,
      requestsPerMinute: 60,
      requestBurst: 1,
    })

    await transport.request({ url: 'https://bucket.test/a', method: 'GET', cache: false })
    await transport.request({ url: 'https://bucket.test/b', method: 'GET', cache: false })
    await transport.request({ url: 'https://other.test/a', method: 'GET', cache: false })

    expect(sleeps).toEqual([1_000])
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('uses ambient defaults and forwards headers and a serialized body', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual({ authorization: 'test' })
      expect(init?.body).toBe('{"ok":true}')
      return jsonResponse({ ok: true })
    })
    const transport = new FinanceHttpTransport({ fetch })
    await expect(transport.request({
      url: 'https://defaults.test/data',
      method: 'POST',
      headers: { authorization: 'test' },
      body: '{"ok":true}',
    })).resolves.toEqual({ status: 200, data: { ok: true } })
  })

  it('evicts the oldest cache entry and can disable caching entirely', async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }))
    const { transport } = clockTransport({ fetch, cacheTtlMs: 1_000, cacheMaxEntries: 1 })
    await transport.request({ url: 'https://cache.test/a', method: 'GET' })
    await transport.request({ url: 'https://cache.test/b', method: 'GET' })
    await transport.request({ url: 'https://cache.test/a', method: 'GET' })
    expect(fetch).toHaveBeenCalledTimes(3)

    const disabledFetch = vi.fn(async () => jsonResponse({ ok: true }))
    const { transport: disabled } = clockTransport({ fetch: disabledFetch })
    await disabled.request({ url: 'https://disabled.test/a', method: 'GET', cache: false })
    await disabled.request({ url: 'https://disabled.test/a', method: 'GET', cache: false })
    expect(disabledFetch).toHaveBeenCalledTimes(2)
  })

  it('falls back when Retry-After is invalid and tolerates a zero-second delay', async () => {
    const invalid = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'limit' }, 429, { 'retry-after': 'later' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const invalidClock = clockTransport({ fetch: invalid, maxRetries: 1, retryBaseDelayMs: 7 })
    await invalidClock.transport.request({ url: 'https://retry.test/invalid', method: 'GET' })
    expect(invalidClock.sleeps).toEqual([7])

    const zero = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'limit' }, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const zeroClock = clockTransport({ fetch: zero, maxRetries: 1, retryBaseDelayMs: 7 })
    await zeroClock.transport.request({ url: 'https://retry.test/zero', method: 'GET' })
    expect(zeroClock.sleeps).toEqual([])
  })

  it('returns an abort error when the caller cancels during rate limiting', async () => {
    const controller = new AbortController()
    const transport = new FinanceHttpTransport({
      fetch: async () => jsonResponse({ ok: true }),
      requestsPerMinute: 60_000,
      requestBurst: 1,
      sleep: async (_milliseconds, signal) => {
        controller.abort()
        throw signal?.reason ?? new Error('aborted')
      },
    })
    await transport.request({ url: 'https://abort.test/a', method: 'GET', cache: false })
    await expect(transport.request({ url: 'https://abort.test/b', method: 'GET', cache: false, signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('propagates a non-cancellation rate-limit sleep failure', async () => {
    const transport = new FinanceHttpTransport({
      fetch: async () => jsonResponse({ ok: true }),
      requestsPerMinute: 60_000,
      requestBurst: 1,
      sleep: async () => { throw new Error('sleep failed') },
    })
    await transport.request({ url: 'https://sleep.test/a', method: 'GET', cache: false })
    await expect(transport.request({ url: 'https://sleep.test/b', method: 'GET', cache: false }))
      .rejects.toThrow('sleep failed')
  })

  it('returns an abort error when cancellation is observed after retries', async () => {
    const controller = new AbortController()
    controller.abort()
    const transport = new FinanceHttpTransport({
      fetch: async () => { throw new Error('offline') },
      maxRetries: 0,
    })
    await expect(transport.request({ url: 'https://abort.test/retry', method: 'GET', signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('skips storage entirely when the cache entry limit is zero', async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }))
    const { transport } = clockTransport({ fetch, cacheTtlMs: 1_000, cacheMaxEntries: 0 })
    await transport.request({ url: 'https://nocache.test/a', method: 'GET' })
    await transport.request({ url: 'https://nocache.test/a', method: 'GET' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('converts non-Error request failures to a stable transport error', async () => {
    const transport = new FinanceHttpTransport({
      fetch: async () => { throw 'offline' },
      maxRetries: 0,
    })
    await expect(transport.request({ url: 'https://failed.test/data', method: 'GET' }))
      .rejects.toMatchObject({ code: 'REQUEST_FAILED' })
  })

  it('surfaces non-retryable HTTP failures with a stable code', async () => {
    const fetch = vi.fn(async () => jsonResponse({ error: 'bad request' }, 400))
    const { transport } = clockTransport({ fetch })

    await expect(transport.request({ url: 'https://bad.test/data', method: 'GET' }))
      .rejects.toMatchObject({ code: 'HTTP_ERROR' })
  })
})
