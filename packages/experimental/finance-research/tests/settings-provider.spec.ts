import { EventEmitter } from 'node:events'
import { WebSocketServer } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsFinanceMarketDataProvider, SettingsFinanceMarketStreamProvider, type FinanceRuntimeSettings } from '../src/settings-provider.ts'
import type { FinanceWebSocketLike } from '../src/stream.ts'

const SETTINGS: FinanceRuntimeSettings = {
  provider: 'http',
  timeoutMs: 1_000,
  barLimit: 60,
  yahooBaseUrl: 'https://yahoo.test',
  binanceBaseUrl: 'https://spot.test',
  binanceUsdmBaseUrl: 'https://usdm.test',
  binanceCoinmBaseUrl: 'https://coinm.test',
  binanceOptionsBaseUrl: 'https://options.test',
  polymarketGammaBaseUrl: 'https://gamma.test',
  polymarketClobBaseUrl: 'https://clob.test',
  enableSignedRequests: true,
  requestCacheTtlMs: 100,
  requestCacheMaxEntries: 10,
  requestMaxRetries: 0,
  requestRetryBaseDelayMs: 1,
  requestRetryMaxDelayMs: 1,
  requestsPerMinute: 60,
  requestBurst: 1,
  binanceWebSocketBaseUrl: 'wss://stream.test',
  marketStreamTimeoutMs: 100,
  marketStreamMaxEvents: 2,
}

afterEach(() => { vi.unstubAllGlobals() })

function fixtureSettings(): FinanceRuntimeSettings {
  return { ...SETTINGS, provider: 'fixture' }
}

describe('settings-backed finance providers', () => {
  it('rejects requests, describes fixture data, and rejects private reads in fixture mode', async () => {
    const provider = new SettingsFinanceMarketDataProvider(() => fixtureSettings(), async () => undefined)
    await expect(provider.request({ base: 'binance-spot', path: '/api/v3/ping' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    })
    await expect(provider.loadPrivateAccount({ scope: 'spot' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    })
    expect(provider.describe()).toMatchObject({ id: 'fixture', bases: [] })
  })

  it('delegates HTTP generic and private requests through current settings', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/account')) {
        return new Response(JSON.stringify({ accountType: 'SPOT', canTrade: true, balances: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }))
    const provider = new SettingsFinanceMarketDataProvider(() => SETTINGS, async () => undefined)

    await expect(provider.request({ base: 'binance-spot', path: '/api/v3/ping' }))
      .resolves.toMatchObject({ status: 200, data: { ok: true } })
    await expect(provider.loadPrivateAccount({ scope: 'spot' }))
      .resolves.toMatchObject({ scope: 'spot', accountType: 'SPOT' })
  })

  it('uses the production WebSocket factory when no test carrier is supplied', async () => {
    const server = new WebSocketServer({ port: 0 })
    await new Promise<void>(resolve => server.once('listening', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server has no port')
    server.on('connection', (socket) => {
      socket.send(JSON.stringify({ stream: 'btcusdt@miniTicker', data: { c: '60000' } }))
    })
    const provider = new SettingsFinanceMarketStreamProvider(() => ({
      ...SETTINGS,
      binanceWebSocketBaseUrl: `ws://127.0.0.1:${String(address.port)}`,
      marketStreamMaxEvents: 1,
    }))
    await expect(provider.collect({ streams: ['btcusdt@miniTicker'] })).resolves.toHaveLength(1)
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  })

  it('delegates realtime collection through the settings namespace', async () => {
    const socket = Object.assign(new EventEmitter(), { close: vi.fn() }) as unknown as EventEmitter & FinanceWebSocketLike
    const provider = new SettingsFinanceMarketStreamProvider(() => SETTINGS, {
      createSocket: () => socket,
    })
    const pending = provider.collect({ streams: ['btcusdt@miniTicker'] })
    socket.emit('message', Buffer.from(JSON.stringify({ stream: 'btcusdt@miniTicker', data: { c: '60000' } })))
    await expect(pending).resolves.toHaveLength(1)
  })
})
