import { EventEmitter } from 'node:events'
import { WebSocketServer } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsFinanceMarketDataProvider, SettingsFinanceMarketStreamProvider, type FinanceRuntimeSettings } from '../src/settings-provider.ts'
import type { FinanceWebSocketLike, FinanceWebSocketOptions } from '../src/stream.ts'
import { COINMARKETCAP_API_KEY_REF } from '../src/auth.ts'

const SETTINGS: FinanceRuntimeSettings = {
  provider: 'http',
  reportLanguage: 'auto',
  timeoutMs: 1_000,
  barLimit: 60,
  peerLimit: 6,
  yahooBaseUrl: 'https://yahoo.test',
  binanceBaseUrl: 'https://spot.test',
  binanceUsdmBaseUrl: 'https://usdm.test',
  binanceCoinmBaseUrl: 'https://coinm.test',
  binanceOptionsBaseUrl: 'https://options.test',
  polymarketGammaBaseUrl: 'https://gamma.test',
  polymarketClobBaseUrl: 'https://clob.test',
  enableSignedRequests: true,
  enableCoinMarketCapRequests: true,
  enableCoinGeckoRequests: true,
  enableFinnhubRequests: true,
  githubBaseUrl: 'https://api.github.test',
  finnhubBaseUrl: 'https://finnhub.test/api/v1',
  enableAkshare: true,
  enableIfind: false,
  ifindTransport: 'http',
  ifindBaseUrl: 'https://quantapi.test',
  pythonExecutable: 'python3',
  stockBridgeTimeoutMs: 60_000,
  stockBridgeMaxOutputBytes: 4 * 1024 * 1024,
  coinMarketCapBaseUrl: 'https://pro-api.test',
  coinGeckoBaseUrl: 'https://api.coingecko.test/v3',
  fredBaseUrl: 'https://fred.test',
  worldBankBaseUrl: 'https://worldbank.test',
  imfBaseUrl: 'https://imf.test',
  eiaBaseUrl: 'https://eia.test/v2',
  cftcBaseUrl: 'https://cftc.test',
  enableFredRequests: true,
  enableEiaRequests: false,
  requestCacheTtlMs: 100,
  requestCacheMaxEntries: 10,
  requestMaxRetries: 0,
  requestRetryBaseDelayMs: 1,
  requestRetryMaxDelayMs: 1,
  requestsPerMinute: 60,
  requestBurst: 10,
  binanceWebSocketBaseUrl: 'wss://stream.test',
  coinMarketCapWebSocketBaseUrl: 'wss://pro-stream.test/v1',
  marketStreamTimeoutMs: 100,
  marketStreamMaxEvents: 2,
  valuationExplicitYears: 3,
  valuationFadeYears: 4,
  valuationTerminalGrowthPercent: 2.5,
  valuationEquityRiskPremiumPercent: 4.5,
  valuationRiskFreeFallbackPercent: 4,
  valuationCreditSpreadPercent: 1.2,
  valuationTaxRateFallbackPercent: 21,
  valuationBearGrowthShiftPercent: -5,
  valuationBullGrowthShiftPercent: 5,
  valuationBearMarginShiftPercent: -2,
  valuationBullMarginShiftPercent: 2,
  valuationBearProbability: 0.25,
  valuationBullProbability: 0.25,
  valuationAccumulateUpsidePercent: 15,
  valuationReduceUpsidePercent: -10,
  valuationTerminalValueCeilingPercent: 75,
}

afterEach(() => { vi.unstubAllGlobals() })

function fixtureSettings(): FinanceRuntimeSettings {
  return { ...SETTINGS, provider: 'fixture' }
}

describe('settings-backed finance providers', () => {
  it('rejects requests, describes fixture data, and rejects private or CMC reads in fixture mode', async () => {
    const provider = new SettingsFinanceMarketDataProvider(() => fixtureSettings(), async () => undefined)
    await expect(provider.request({ base: 'binance-spot', path: '/api/v3/ping' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    })
    await expect(provider.loadPrivateAccount({ scope: 'spot' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    })
    await expect(provider.loadCoinMarketCapQuotes({ symbols: ['BTC'] })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    })
    await expect(provider.loadCoinMarketCapOhlcv({ id: 1 })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    })
    await expect(provider.loadCoinGeckoCommunity({ id: 'bitcoin' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    })
    await expect(provider.loadUsFundamentals({ symbol: 'AAPL' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    })
    await expect(provider.loadCoinGeckoMarkets(['BTC'])).resolves.toEqual([])
    await expect(provider.loadUsPeerMetrics(['AAPL'])).resolves.toEqual([])
    await expect(provider.loadGithubRepo({ repository: 'bitcoin/bitcoin' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    })
    expect(provider.describe()).toMatchObject({ id: 'fixture', bases: [] })
  })

  it('delegates HTTP generic, private, and CoinMarketCap requests through current settings', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/account')) {
        return new Response(JSON.stringify({ accountType: 'SPOT', canTrade: true, balances: [] }), { status: 200 })
      }
      if (url.includes('/ohlcv/historical')) {
        return new Response(JSON.stringify({ data: { id: 1, name: 'Bitcoin', symbol: 'BTC', quotes: [] } }), { status: 200 })
      }
      if (url.includes('/quotes/latest')) {
        return new Response(JSON.stringify({ data: [{ id: 1, name: 'Bitcoin', symbol: 'BTC', quote: { USD: { price: 60_000 } } }] }), { status: 200 })
      }
      if (url.includes('/stock/profile2') || url.includes('/stock/metric') || url.includes('/stock/peers')) {
        if (url.includes('/stock/peers')) return new Response(JSON.stringify(['AAPL', 'MSFT']), { status: 200 })
        if (url.includes('/stock/metric')) return new Response(JSON.stringify({ metric: { peTTM: 32.5 } }), { status: 200 })
        return new Response(JSON.stringify({ name: 'Apple Inc', ticker: 'AAPL', finnhubIndustry: 'Technology' }), { status: 200 })
      }
      if (url.includes('/repos/bitcoin/bitcoin')) {
        return new Response(JSON.stringify({ name: 'bitcoin', stargazers_count: 85_000 }), { status: 200 })
      }
      if (url.includes('/coins/bitcoin')) {
        return new Response(JSON.stringify({ id: 'bitcoin', name: 'Bitcoin', github_stars_placeholder: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }))
    const provider = new SettingsFinanceMarketDataProvider(() => SETTINGS, async () => undefined)

    await expect(provider.request({ base: 'binance-spot', path: '/api/v3/ping' }))
      .resolves.toMatchObject({ status: 200, data: { ok: true } })
    await expect(provider.loadPrivateAccount({ scope: 'spot' }))
      .resolves.toMatchObject({ scope: 'spot', accountType: 'SPOT' })
    await expect(provider.loadCoinMarketCapQuotes({ symbols: ['BTC'] }))
      .resolves.toMatchObject([{ symbol: 'BTC', price: 60_000 }])
    await expect(provider.loadCoinMarketCapOhlcv({ id: 1 }))
      .resolves.toMatchObject([{ symbol: 'BTC', bars: [] }])
    await expect(provider.loadCoinGeckoCommunity({ id: 'bitcoin' }))
      .resolves.toMatchObject({ id: 'bitcoin', name: 'Bitcoin' })
    await expect(provider.loadGithubRepo({ repository: 'bitcoin/bitcoin' }))
      .resolves.toMatchObject({ repository: 'bitcoin/bitcoin', stars: 85_000 })
    await expect(provider.loadUsFundamentals({ symbol: 'AAPL' }))
      .resolves.toMatchObject({ symbol: 'AAPL', name: 'Apple Inc', peers: ['AAPL', 'MSFT'], indicators: { peRatio: 32.5 } })
    await expect(provider.loadCoinGeckoMarkets(['BTC'])).resolves.toEqual([])
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
    }), async () => undefined)
    await expect(provider.collect({ streams: ['btcusdt@miniTicker'] })).resolves.toHaveLength(1)
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  })

  it('routes CoinMarketCap realtime collection through the API-key resolver', async () => {
    const socket = Object.assign(new EventEmitter(), { close: vi.fn(), send: vi.fn() }) as unknown as EventEmitter & FinanceWebSocketLike
    const provider = new SettingsFinanceMarketStreamProvider(
      () => SETTINGS,
      async ref => ref === COINMARKETCAP_API_KEY_REF ? 'cmc-key' : undefined,
      { createSocket: (_url: string, _options?: FinanceWebSocketOptions) => socket },
    )
    const pending = provider.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1] })
    await vi.waitFor(() => { expect(socket.listenerCount('open')).toBe(1) })
    socket.emit('open')
    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'data',
      channel: 'market@crypto_latest_price',
      data: { cid: 1, p: 60_000 },
    })))
    await expect(pending).resolves.toMatchObject([{ provider: 'coinmarketcap', stream: 'market@crypto_latest_price' }])
  })

  it('delegates realtime collection through the settings namespace', async () => {
    const socket = Object.assign(new EventEmitter(), { close: vi.fn(), send: vi.fn() }) as unknown as EventEmitter & FinanceWebSocketLike
    const provider = new SettingsFinanceMarketStreamProvider(
      () => SETTINGS,
      async ref => ref === COINMARKETCAP_API_KEY_REF ? 'cmc-key' : undefined,
      { createSocket: (_url: string, _options?: FinanceWebSocketOptions) => socket },
    )
    const pending = provider.collect({ streams: ['btcusdt@miniTicker'] })
    socket.emit('message', Buffer.from(JSON.stringify({ stream: 'btcusdt@miniTicker', data: { c: '60000' } })))
    await expect(pending).resolves.toHaveLength(1)
  })
})
