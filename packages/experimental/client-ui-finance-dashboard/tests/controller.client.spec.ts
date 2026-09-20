import { describe, expect, it, vi } from 'vitest'
import { FinanceDashboardController } from '../src/client/controller.ts'
import type { FinanceDashboardSettingsScope } from '../src/client/controller.ts'

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
    const raced = new FinanceDashboardController(scope, { fetch: (async () => pending) as typeof globalThis.fetch, pollMs: 0 })
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
