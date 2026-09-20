import { describe, expect, it, vi } from 'vitest'
import { FinanceDashboardController } from '../src/client/controller.ts'
import type { FinanceDashboardSettingsScope, FinanceDashboardSocket } from '../src/client/controller.ts'

class FakeSocket implements FinanceDashboardSocket {
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  readonly close = vi.fn()
  open(): void { this.onopen?.({} as Event) }
  message(value: unknown): void { this.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) } as MessageEvent) }
  error(): void { this.onerror?.({} as Event) }
  closed(): void { this.onclose?.({} as CloseEvent) }
}

function klines(close = 112): unknown {
  return [
    [1_700_000_000_000, '100', '110', '95', '102', '10'],
    [1_700_000_060_000, '102', '115', '101', String(close), '12'],
  ]
}

function bench(options: {
  readonly value?: { readonly binanceBaseUrl?: string; readonly binanceWebSocketBaseUrl?: string }
  readonly fetch?: typeof globalThis.fetch
  readonly reconnectMs?: number
} = {}) {
  const sockets: FakeSocket[] = []
  const listeners = new Set<() => void>()
  const scope: FinanceDashboardSettingsScope = {
    getSnapshot: () => ({ value: options.value }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  const controller = new FinanceDashboardController(scope, {
    fetch: options.fetch ?? (async () => new Response(JSON.stringify(klines()), { status: 200 })),
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    ...options.reconnectMs === undefined ? {} : { reconnectMs: options.reconnectMs },
  })
  return { controller, sockets, listeners }
}

describe('FinanceDashboardController', () => {
  it('loads history, updates the live bar, and exposes actions', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(klines()), { status: 200 }))
    const { controller, sockets, listeners } = bench({ fetch })
    const face = controller.inject()
    face.ensure()
    expect(typeof face.ensure).toBe('function')
    await vi.waitFor(() => { expect(face.hooks.dashboard.getSnapshot().status).toBe('ready') })
    expect(fetch).toHaveBeenCalledWith('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=120')
    expect(sockets).toHaveLength(1)
    expect(sockets[0]?.close).not.toHaveBeenCalled()

    sockets[0]!.open()
    expect(face.hooks.dashboard.getSnapshot().streamStatus).toBe('live')
    sockets[0]!.message({ k: { t: 1_700_000_120_000, o: 112, h: 120, l: 111, c: 118, v: 8 } })
    expect(face.hooks.dashboard.getSnapshot().bars).toHaveLength(3)
    sockets[0]!.message({ k: { t: 1_700_000_120_000, o: 118, h: 125, l: 117, c: 124, v: 9 } })
    expect(face.hooks.dashboard.getSnapshot().bars.at(-1)?.close).toBe(124)
    sockets[0]!.message({ k: { t: 'bad' } })
    sockets[0]!.message('not-json')
    expect(face.hooks.dashboard.getSnapshot().streamStatus).toBe('error')
    sockets[0]!.error()
    expect(face.hooks.dashboard.getSnapshot().streamStatus).toBe('error')

    face.setSymbol('eth')
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(2) })
    face.setInterval('1h')
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(3) })
    face.refresh()
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(4) })
    face.setSymbol('   ')
    expect(face.hooks.dashboard.getSnapshot().symbol).toBe('ETH')

    for (const listener of listeners) listener()
    expect(sockets.at(-1)?.close).toHaveBeenCalled()
    controller.dispose()
  })

  it('reports HTTP, empty-data, and non-Error failures', async () => {
    const http = bench({ fetch: async () => new Response('no', { status: 503 }) })
    http.controller.refresh()
    await vi.waitFor(() => { expect(http.controller.inject().hooks.dashboard.getSnapshot().status).toBe('error') })
    expect(http.controller.inject().hooks.dashboard.getSnapshot().error).toContain('HTTP 503')

    const empty = bench({ fetch: async () => new Response(JSON.stringify([]), { status: 200 }) })
    empty.controller.refresh()
    await vi.waitFor(() => { expect(empty.controller.inject().hooks.dashboard.getSnapshot().status).toBe('error') })
    expect(empty.controller.inject().hooks.dashboard.getSnapshot().error).toBe('no market data')

    const thrown = bench({ fetch: async () => { throw 'offline' } })
    thrown.controller.refresh()
    await vi.waitFor(() => { expect(thrown.controller.inject().hooks.dashboard.getSnapshot().status).toBe('error') })
    expect(thrown.controller.inject().hooks.dashboard.getSnapshot().error).toBe('offline')
  })

  it('ignores loads after disposal and reconnects a closed stream', async () => {
    vi.useFakeTimers()
    const { controller, sockets } = bench({ reconnectMs: 10, value: {} })
    const face = controller.inject()
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => { expect(sockets).toHaveLength(1) })
    sockets[0]!.closed()
    expect(face.hooks.dashboard.getSnapshot().streamStatus).toBe('disconnected')
    await vi.advanceTimersByTimeAsync(10)
    expect(sockets).toHaveLength(2)

    controller.dispose()
    face.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(face.hooks.dashboard.getSnapshot().status).toBe('ready')
    vi.useRealTimers()
  })

  it('keeps a closed stream offline when reconnection is disabled and ignores stale closes', async () => {
    const { controller, sockets } = bench({ reconnectMs: 0 })
    const face = controller.inject()
    await vi.waitFor(() => { expect(sockets).toHaveLength(1) })
    sockets[0]!.closed()
    expect(face.hooks.dashboard.getSnapshot().streamStatus).toBe('disconnected')
    face.refresh()
    await vi.waitFor(() => { expect(sockets).toHaveLength(2) })
    sockets[0]!.closed()
    expect(face.hooks.dashboard.getSnapshot().streamStatus).toBe('connecting')
    controller.dispose()
    sockets[1]!.closed()
    expect(face.hooks.dashboard.getSnapshot().streamStatus).toBe('connecting')
  })

  it('uses the browser WebSocket when no factory is supplied', async () => {
    class BrowserSocket extends FakeSocket {}
    vi.stubGlobal('WebSocket', BrowserSocket)
    const scope: FinanceDashboardSettingsScope = {
      getSnapshot: () => ({ value: undefined }),
      subscribe: () => () => {},
    }
    const controller = new FinanceDashboardController(scope, {
      fetch: async () => new Response(JSON.stringify(klines()), { status: 200 }),
    })
    const face = controller.inject()
    await vi.waitFor(() => { expect(face.hooks.dashboard.getSnapshot().status).toBe('ready') })
    controller.dispose()
    vi.unstubAllGlobals()
  })
})
