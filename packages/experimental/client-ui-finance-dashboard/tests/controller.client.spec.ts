import { describe, expect, it, vi } from 'vitest'
import { FinanceDashboardController } from '../src/client/controller.ts'
import type { FinanceDashboardSettingsScope } from '../src/client/controller.ts'
import { DEFAULT_INDICATOR_IDS } from '../src/client/indicators.ts'

function payload(overrides: Record<string, unknown> = {}): unknown {
  return {
    asset: 'crypto',
    symbol: 'BTCUSDT',
    name: 'BTCUSDT',
    interval: '1m',
    source: 'binance-spot',
    asOf: '2026-09-20T00:00:00.000Z',
    bars: [
      { time: 1_700_000_000_000, open: 100, high: 110, low: 95, close: 102, volume: 10 },
      { time: 1_700_000_060_000, open: 102, high: 115, low: 101, close: 112, volume: 12 },
    ],
    quote: { price: 112, changePercent: 9.8, volume: 12, currency: 'USDT' },
    ...overrides,
  }
}

function bench(options: {
  readonly value?: { readonly enableAkshare?: boolean; readonly enableIfind?: boolean }
  readonly fetch?: typeof globalThis.fetch
} = {}) {
  const listeners = new Set<() => void>()
  const scope: FinanceDashboardSettingsScope = {
    getSnapshot: () => ({ value: options.value }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  const controller = new FinanceDashboardController(scope, {
    fetch: options.fetch ?? (async () => new Response(JSON.stringify(payload()), { status: 200 })),
    pollMs: 0,
  })
  return { controller, listeners }
}

describe('FinanceDashboardController', () => {
  it('loads Host history and exposes actions', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(payload()), { status: 200 }))
    const { controller, listeners } = bench({ fetch })
    const face = controller.inject()
    face.ensure()
    await vi.waitFor(() => { expect(face.hooks.dashboard.getSnapshot().status).toBe('ready') })
    expect(fetch).toHaveBeenCalledWith('/api/finance-dashboard/market?asset=crypto&symbol=BTC&interval=1m&limit=240', {
      headers: { accept: 'application/json' },
    })
    expect(face.hooks.dashboard.getSnapshot()).toMatchObject({
      asset: 'crypto',
      symbol: 'BTCUSDT',
      streamStatus: 'live',
      quote: { price: 112 },
    })

    face.setAsset('stock')
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(2) })
    face.setAsset('stock')
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(3) })
    expect((fetch.mock.calls[1] as unknown as [string])[0]).toContain('asset=stock&symbol=600519&interval=1d')
    face.setInterval('1d')
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(4) })
    face.setSymbol('AAPL')
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(5) })
    face.refresh()
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(6) })

    for (const listener of listeners) listener()
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(7) })
    controller.dispose()
  })

  it('drops the loaded snapshot when the requested identity changes', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(payload()), { status: 200 }))
    const { controller } = bench({ fetch })
    const face = controller.inject()
    face.refresh()
    await vi.waitFor(() => { expect(face.hooks.dashboard.getSnapshot().status).toBe('ready') })

    face.setAsset('stock')
    // The next render must not draw the previous instrument's bars under the
    // newly selected symbol.
    expect(face.hooks.dashboard.getSnapshot().bars).toEqual([])
    expect(face.hooks.dashboard.getSnapshot().quote).toBeUndefined()
    await vi.waitFor(() => { expect(face.hooks.dashboard.getSnapshot().status).toBe('ready') })
    controller.dispose()
  })

  it('keeps the loaded snapshot while a background poll is in flight', async () => {
    vi.useFakeTimers()
    const listeners = new Set<() => void>()
    const scope: FinanceDashboardSettingsScope = {
      getSnapshot: () => ({ value: undefined }),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    let release: ((value: Response) => void) | undefined
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload()), { status: 200 }))
      .mockReturnValueOnce(pending)
    const controller = new FinanceDashboardController(scope, { fetch, pollMs: 1_000 })
    const face = controller.inject()
    face.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(face.hooks.dashboard.getSnapshot().status).toBe('ready')

    await vi.advanceTimersByTimeAsync(1_000)
    // The poll drops the request into `loading`; the snapshot stays mounted so
    // the panel keeps its chart and the reader's scroll position.
    expect(face.hooks.dashboard.getSnapshot().status).toBe('loading')
    expect(face.hooks.dashboard.getSnapshot().bars).toHaveLength(2)

    release?.(new Response(JSON.stringify(payload()), { status: 200 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(face.hooks.dashboard.getSnapshot().status).toBe('ready')
    controller.dispose()
    vi.useRealTimers()
  })

  it('exposes the indicator preferences through the browser face', () => {
    const { controller } = bench()
    const face = controller.inject()
    expect(face.hooks.indicators.getSnapshot().enabled).toEqual([...DEFAULT_INDICATOR_IDS])

    face.toggleIndicator('kdj')
    expect(face.hooks.indicators.getSnapshot().enabled).toContain('kdj')
    face.setIndicatorParameter('kdj', 'period', 12)
    expect(face.hooks.indicators.getSnapshot().parameters.kdj).toEqual({ period: 12 })

    face.resetIndicator('kdj')
    expect(face.hooks.indicators.getSnapshot().parameters.kdj).toBeUndefined()
    face.resetIndicators()
    expect(face.hooks.indicators.getSnapshot().enabled).toEqual([...DEFAULT_INDICATOR_IDS])
    controller.dispose()
  })

  it('calls fetch without rebinding the options object as this', async () => {
    const fetch = vi.fn(async function (this: unknown) {
      expect(this).toBeUndefined()
      return new Response(JSON.stringify(payload()), { status: 200 })
    })
    const { controller } = bench({ fetch: fetch as unknown as typeof globalThis.fetch })
    const face = controller.inject()
    face.refresh()
    await vi.waitFor(() => { expect(face.hooks.dashboard.getSnapshot().status).toBe('ready') })
    controller.dispose()
  })

  it('surfaces the Host failure message instead of only the status code', async () => {
    const hostMessage = 'request failed for https://query1.finance.yahoo.com/v8/finance/chart/AAPL: HTTP 403'
    const described = bench({
      fetch: async () => new Response(JSON.stringify({ error: { code: 'HTTP_ERROR', message: hostMessage } }), { status: 400 }),
    })
    described.controller.refresh()
    await vi.waitFor(() => { expect(described.controller.inject().hooks.dashboard.getSnapshot().error).toBe(hostMessage) })

    const named = bench({ fetch: async () => new Response(JSON.stringify({ error: 'provider disabled' }), { status: 400 }) })
    named.controller.refresh()
    await vi.waitFor(() => { expect(named.controller.inject().hooks.dashboard.getSnapshot().error).toBe('provider disabled') })

    const blank = bench({ fetch: async () => new Response(JSON.stringify({ error: {} }), { status: 400 }) })
    blank.controller.refresh()
    await vi.waitFor(() => { expect(blank.controller.inject().hooks.dashboard.getSnapshot().error).toBe('HTTP 400') })

    const empty = bench({ fetch: async () => new Response('null', { status: 400 }) })
    empty.controller.refresh()
    await vi.waitFor(() => { expect(empty.controller.inject().hooks.dashboard.getSnapshot().error).toBe('HTTP 400') })

    const unstructured = bench({ fetch: async () => new Response('nope', { status: 502 }) })
    unstructured.controller.refresh()
    await vi.waitFor(() => { expect(unstructured.controller.inject().hooks.dashboard.getSnapshot().error).toBe('HTTP 502') })
  })

  it('reports HTTP, invalid-data, and non-Error failures', async () => {
    const http = bench({ fetch: async () => new Response('no', { status: 503 }) })
    http.controller.refresh()
    await vi.waitFor(() => { expect(http.controller.inject().hooks.dashboard.getSnapshot().status).toBe('error') })
    expect(http.controller.inject().hooks.dashboard.getSnapshot().error).toContain('HTTP 503')

    const invalid = bench({ fetch: async () => new Response(JSON.stringify({ bad: true }), { status: 200 }) })
    invalid.controller.refresh()
    await vi.waitFor(() => { expect(invalid.controller.inject().hooks.dashboard.getSnapshot().error).toContain('invalid') })

    const thrown = bench({ fetch: async () => { throw 'offline' } })
    thrown.controller.refresh()
    await vi.waitFor(() => { expect(thrown.controller.inject().hooks.dashboard.getSnapshot().error).toBe('offline') })
  })
  it('covers defaults, polling, disposal, and in-flight races', async () => {
    vi.useFakeTimers()
    const listeners = new Set<() => void>()
    const scope: FinanceDashboardSettingsScope = {
      getSnapshot: () => ({ value: undefined }),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    const defaulted = new FinanceDashboardController(scope)
    defaulted.dispose()

    const fetch = vi.fn(async () => new Response(JSON.stringify(payload()), { status: 200 }))
    const controller = new FinanceDashboardController(scope, { fetch, pollMs: 1_000 })
    const face = controller.inject()
    face.refresh()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(2)
    controller.dispose()

    let release: ((value: Response) => void) | undefined
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const raced = new FinanceDashboardController(scope, { fetch: async () => pending, pollMs: 0 })
    const racedFace = raced.inject()
    racedFace.refresh()
    raced.dispose()
    release?.(new Response(JSON.stringify(payload()), { status: 200 }))
    await Promise.resolve()
    expect(racedFace.hooks.dashboard.getSnapshot().status).not.toBe('ready')
    racedFace.setSymbol('   ')
    racedFace.ensure()
    vi.useRealTimers()
  })

  it('ignores a stale failed request after a newer refresh', async () => {
    let rejectFirst: ((error: Error) => void) | undefined
    const first = new Promise<Response>((_resolve, reject) => { rejectFirst = reject })
    const fetch = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue(new Response(JSON.stringify(payload()), { status: 200 }))
    const { controller } = bench({ fetch: fetch as unknown as typeof globalThis.fetch })
    const face = controller.inject()
    face.refresh()
    face.refresh()
    rejectFirst?.(new Error('stale failure'))
    await vi.waitFor(() => { expect(face.hooks.dashboard.getSnapshot().status).toBe('ready') })
    controller.dispose()
  })

})
