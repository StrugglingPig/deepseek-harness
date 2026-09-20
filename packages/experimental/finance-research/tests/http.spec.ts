import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createHttpFinanceMarketDataProvider,
  FinanceDataError,
} from '../src/http.ts'

const NOW = new Date('2026-09-20T00:00:00.000Z')
const BASE_OPTIONS = {
  now: () => NOW,
  barLimit: 60,
  timeoutMs: 1_000,
  yahooBaseUrl: 'https://yahoo.test',
  binanceBaseUrl: 'https://binance.test',
  polymarketGammaBaseUrl: 'https://gamma.test',
  polymarketClobBaseUrl: 'https://clob.test',
}

interface FetchRoutes {
  readonly yahoo?: unknown
  readonly yahooStatus?: number
  readonly yahooBody?: string
  readonly binance?: unknown
  readonly binanceStatus?: number
  readonly gamma?: unknown
  readonly gammaStatus?: number
  readonly clob?: unknown
  readonly onRequest?: (url: string) => void
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function fakeFetch(routes: FetchRoutes): typeof globalThis.fetch {
  return async (input) => {
    const url = urlOf(input)
    routes.onRequest?.(url)
    if (url.includes('/v8/finance/chart/')) {
      if (routes.yahooBody !== undefined) return new Response(routes.yahooBody, { status: routes.yahooStatus ?? 200 })
      return new Response(JSON.stringify(routes.yahoo), { status: routes.yahooStatus ?? 200 })
    }
    if (url.startsWith('https://binance.test') || url.startsWith('https://fapi.test')
      || url.startsWith('https://dapi.test') || url.startsWith('https://eapi.test')) {
      return new Response(JSON.stringify(routes.binance), { status: routes.binanceStatus ?? 200 })
    }
    if (url.startsWith('https://gamma.test')) {
      return new Response(JSON.stringify(routes.gamma), { status: routes.gammaStatus ?? 200 })
    }
    if (url.startsWith('https://clob.test')) {
      return new Response(JSON.stringify(routes.clob), { status: 200 })
    }
    throw new Error(`unexpected URL ${url}`)
  }
}

function yahooPayload(options: {
  readonly longName?: string
  readonly shortName?: string
  readonly nullIndex?: number
  readonly previousZero?: boolean
  readonly length?: number
} = {}): unknown {
  const length = options.length ?? 60
  const closes = Array.from({ length }, (_, index) => 100 + index)
  if (options.previousZero === true) {
    closes[length - 2] = 0
    closes[length - 1] = 0
  }
  return {
    chart: {
      result: [{
        meta: {
          symbol: 'AAPL',
          currency: 'USD',
          regularMarketPrice: options.previousZero === true ? 0 : 159,
          shortName: options.shortName ?? 'Apple',
          longName: options.longName ?? 'Apple Inc.',
        },
        timestamp: Array.from({ length }, (_, index) => 1_700_000_000 + index * 86_400),
        indicators: {
          quote: [{
            open: closes.map((close, index) => index === options.nullIndex ? null : close - 1),
            high: closes.map((close, index) => index === options.nullIndex ? null : close + 1),
            low: closes.map((close, index) => index === options.nullIndex ? null : close - 1),
            close: closes.map((close, index) => index === options.nullIndex ? null : close),
            volume: closes.map((_, index) => index === options.nullIndex ? null : 1_000 + index),
          }],
        },
      }],
    },
  }
}

function binancePayload(length = 60): unknown {
  return Array.from({ length }, (_, index) => [
    1_700_000_000_000 + index * 86_400_000,
    String(100 + index),
    String(101 + index),
    String(99 + index),
    String(100.5 + index),
    String(1_000 + index),
    1_700_000_000_000 + index * 86_400_000 + 86_399_999,
    '0',
    1,
    '0',
    '0',
    '0',
  ])
}

function gammaPayload(options: {
  readonly clobTokenIds?: string
  readonly outcomes?: string
  readonly outcomePrices?: string
  readonly question?: string
  readonly slug?: string
} = {}): unknown {
  return [{
    question: options.question ?? 'Will the Fed cut rates?',
    slug: options.slug ?? 'fed-cut',
    clobTokenIds: options.clobTokenIds ?? JSON.stringify(['token-1']),
    outcomes: options.outcomes ?? JSON.stringify(['Yes', 'No']),
    outcomePrices: options.outcomePrices ?? JSON.stringify(['0.65', '0.35']),
    bestBid: 0.64,
    bestAsk: 0.66,
    volumeNum: 1_000_000,
    liquidityNum: 250_000,
    endDate: '2026-12-31T23:59:59.000Z',
    description: 'Fixture rules',
  }]
}

function clobPayload(length = 60): unknown {
  return {
    history: Array.from({ length }, (_, index) => ({
      t: 1_700_000_000 + index * 86_400,
      p: 0.5 + index / 1_000,
    })),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HTTP finance market data provider', () => {
  it('loads Yahoo equity data and maps the full snapshot', async () => {
    const provider = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ yahoo: yahooPayload({ nullIndex: 0 }) }),
    })
    const snapshot = await provider.load('aapl')
    expect(provider.id).toBe('http')
    expect(snapshot.instrument).toEqual({
      symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'equity', currency: 'USD',
    })
    expect(snapshot.source).toEqual({
      provider: 'yahoo-finance', retrievedAt: NOW.toISOString(), synthetic: false,
    })
    expect(snapshot.bars).toHaveLength(59)
    expect(snapshot.quote.price).toBe(159)
  })

  it.each([
    { label: 'long name', longName: 'Apple Inc.', shortName: 'Apple', expected: 'Apple Inc.' },
    { label: 'short name', longName: '', shortName: 'Apple', expected: 'Apple' },
    { label: 'symbol fallback', longName: '', shortName: '', expected: 'AAPL' },
  ])('resolves the equity name from $label', async ({ longName, shortName, expected }) => {
    const provider = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ yahoo: yahooPayload({ longName, shortName }) }),
    })
    const snapshot = await provider.load('AAPL', new AbortController().signal)
    expect(snapshot.instrument.name).toBe(expected)
  })

  it('handles a zero previous close without producing infinity', async () => {
    const provider = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ yahoo: yahooPayload({ previousZero: true }) }),
    })
    const snapshot = await provider.load('AAPL')
    expect(snapshot.quote.changePercent).toBe(0)
  })

  it('loads Binance crypto data for supported symbols', async () => {
    const urls: string[] = []
    const provider = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ binance: binancePayload(), onRequest: url => urls.push(url) }),
    })
    await expect(provider.load('BTC')).resolves.toMatchObject({ instrument: { name: 'Bitcoin', assetClass: 'crypto' } })
    await expect(provider.load('ETH')).resolves.toMatchObject({ instrument: { name: 'Ether' } })
    expect(urls.some(url => url.includes('BTCUSDT'))).toBe(true)
    expect(urls.some(url => url.includes('ETHUSDT'))).toBe(true)
  })

  it.each([
    { label: 'question', question: 'Will the Fed cut rates?', slug: 'fed-cut', expected: 'Will the Fed cut rates?' },
    { label: 'slug', question: '', slug: 'fed-cut-market', expected: 'fed-cut-market' },
    { label: 'symbol slug', question: '', slug: '', expected: 'fed-cut' },
  ])('resolves the prediction name from $label', async ({ question, slug, expected }) => {
    const provider = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ gamma: gammaPayload({ question, slug }), clob: clobPayload() }),
    })
    const snapshot = await provider.load('PREDICTION:FED-CUT')
    expect(snapshot.instrument.name).toBe(expected)
  })

  it('loads Polymarket prediction data and CLOB history', async () => {
    const provider = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ gamma: gammaPayload(), clob: clobPayload() }),
    })
    const snapshot = await provider.load('PREDICTION:FED-CUT')
    expect(snapshot.instrument.assetClass).toBe('prediction')
    expect(snapshot.prediction).toEqual({
      impliedProbability: 0.65,
      bid: 0.64,
      ask: 0.66,
      volume: 1_000_000,
      openInterest: 250_000,
      resolution: '2026-12-31T23:59:59.000Z',
      rules: 'Fixture rules',
    })
    expect(snapshot.bars).toHaveLength(60)
  })

  it('describes bases and sends arbitrary provider-native requests', async () => {
    const urls: string[] = []
    const provider = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      binanceUsdmBaseUrl: 'https://fapi.test',
      binanceCoinmBaseUrl: 'https://dapi.test',
      binanceOptionsBaseUrl: 'https://eapi.test',
      fetch: fakeFetch({
        binance: { ok: true },
        yahoo: { ok: true },
        clob: { ok: true },
        onRequest: url => urls.push(url),
      }),
    })
    expect(provider.describe()).toMatchObject({
      id: 'http',
      displayName: 'Public HTTP finance providers',
    })
    expect(provider.describe().bases.map(base => base.name)).toEqual([
      'binance-spot', 'binance-usdm', 'binance-coinm', 'binance-options',
      'yahoo', 'polymarket-gamma', 'polymarket-clob',
    ])

    await provider.request({ base: 'binance-spot', path: '/api/v3/ping' })
    await provider.request({ base: 'binance-spot', path: '/api/v3/exchangeInfo', query: { permissions: 'SPOT' } })
    await provider.request({ base: 'binance-usdm', path: '/fapi/v1/fundingRate', query: { symbol: 'BTCUSDT' } })
    await provider.request({ base: 'yahoo', path: '/v8/finance/chart/AAPL', query: { range: '1mo', interval: '1d' } })
    await provider.request({ base: 'polymarket-clob', path: '/book', query: { token_id: 'token-1' } })
    await provider.request({ base: 'polymarket-clob', path: '/midpoints', query: { token_ids: ['a', 'b'] } })
    await provider.request({
      base: 'binance-spot',
      path: '/api/v3/ticker/24hr',
      query: {
        symbol: 'BTCUSDT',
        limit: 5,
        test: true,
        filter: { minVolume: 1 },
        nullable: null,
        tags: [1, 'x'],
      },
    })
    const posted = await provider.request({
      base: 'binance-spot',
      path: '/api/v3/order/test',
      method: 'POST',
      headers: { 'x-test': 'yes' },
      query: { symbol: 'BTCUSDT' },
      body: { side: 'BUY' },
    })
    expect(posted).toMatchObject({ provider: 'http', base: 'binance-spot', method: 'POST', status: 200 })

    expect(urls.some(url => url.includes('/api/v3/exchangeInfo?permissions=SPOT'))).toBe(true)
    expect(urls.some(url => url.includes('/fapi/v1/fundingRate?symbol=BTCUSDT'))).toBe(true)
    expect(urls.some(url => url.includes('/v8/finance/chart/AAPL?'))).toBe(true)
    expect(urls.some(url => url.includes('range=1mo'))).toBe(true)
    expect(urls.some(url => url.includes('/book?token_id=token-1'))).toBe(true)
    expect(urls.some(url => url.includes('/midpoints?token_ids=a&token_ids=b'))).toBe(true)
    expect(urls.some(url => url.includes('limit=5'))).toBe(true)
    expect(urls.some(url => url.includes('test=true'))).toBe(true)
    expect(urls.some(url => url.includes('filter=%7B%22minVolume%22%3A1%7D'))).toBe(true)
    expect(urls.some(url => url.includes('nullable=null'))).toBe(true)
    expect(urls.some(url => url.includes('tags=1&tags=x'))).toBe(true)
  })

  it('rejects invalid provider requests', async () => {
    const provider = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ yahoo: {} }),
    })
    await expect(provider.request({ base: 'unknown', path: '/api/v3/ping' })).rejects.toMatchObject({
      code: 'UNKNOWN_BASE',
    })
    await expect(provider.request({ base: 'binance-spot', path: 'api/v3/ping' })).rejects.toMatchObject({
      code: 'INVALID_PATH',
    })
    await expect(provider.request({
      base: 'binance-spot',
      path: '/api/v3/ping',
      body: { invalid: true },
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('uses ambient defaults when no options are supplied', async () => {
    vi.stubGlobal('fetch', fakeFetch({ yahoo: yahooPayload() }))
    const provider = createHttpFinanceMarketDataProvider()
    const snapshot = await provider.load('AAPL')
    expect(snapshot.instrument.symbol).toBe('AAPL')
    expect(snapshot.source.retrievedAt).toMatch(/T/)
  })

  it('rejects empty symbols and provider failures', async () => {
    const provider = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ yahoo: yahooPayload() }),
    })
    await expect(provider.load('   ')).rejects.toMatchObject({ code: 'INVALID_SYMBOL' })

    const requestFailed = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: async () => { throw new Error('offline') },
    })
    await expect(requestFailed.load('AAPL')).rejects.toMatchObject({ code: 'REQUEST_FAILED' })

    const httpFailed = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ yahoo: {}, yahooStatus: 503 }),
    })
    await expect(httpFailed.load('AAPL')).rejects.toMatchObject({ code: 'HTTP_ERROR' })

    const invalidJson = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ yahooBody: 'not json' }),
    })
    await expect(invalidJson.load('AAPL')).rejects.toMatchObject({ code: 'INVALID_JSON' })
  })

  it('rejects invalid schemas and insufficient histories', async () => {
    const invalidEquity = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ yahoo: {} }),
    })
    await expect(invalidEquity.load('AAPL')).rejects.toBeInstanceOf(Error)

    const shortEquity = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ yahoo: yahooPayload({ length: 10 }) }),
    })
    await expect(shortEquity.load('AAPL')).rejects.toMatchObject({ code: 'INSUFFICIENT_HISTORY' })

    const shortCrypto = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ binance: binancePayload(10) }),
    })
    await expect(shortCrypto.load('BTC')).rejects.toMatchObject({ code: 'INSUFFICIENT_HISTORY' })
  })

  it('rejects malformed or incomplete prediction markets', async () => {
    const notFound = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ gamma: [] }),
    })
    await expect(notFound.load('PREDICTION:MISSING')).rejects.toMatchObject({ code: 'MARKET_NOT_FOUND' })

    const noToken = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ gamma: gammaPayload({ clobTokenIds: 'not-json' }) }),
    })
    await expect(noToken.load('PREDICTION:FED-CUT')).rejects.toMatchObject({ code: 'MARKET_NOT_FOUND' })

    const nonArrayToken = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({ gamma: gammaPayload({ clobTokenIds: JSON.stringify({ token: 'x' }) }) }),
    })
    await expect(nonArrayToken.load('PREDICTION:FED-CUT')).rejects.toMatchObject({ code: 'MARKET_NOT_FOUND' })

    const shortHistory = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: fakeFetch({
        gamma: gammaPayload({ outcomes: 'not-json', outcomePrices: 'not-json' }),
        clob: clobPayload(10),
      }),
    })
    await expect(shortHistory.load('PREDICTION:FED-CUT')).rejects.toMatchObject({ code: 'INSUFFICIENT_HISTORY' })
  })

  it('caches repeated public provider requests', async () => {
    let calls = 0
    const provider = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      cacheTtlMs: 100,
      fetch: async () => {
        calls += 1
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
    })

    await provider.request({ base: 'binance-spot', path: '/api/v3/ping' })
    await provider.request({ base: 'binance-spot', path: '/api/v3/ping' })

    expect(calls).toBe(1)
  })

  it('does not cache signed provider requests', async () => {
    let calls = 0
    const provider = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      cacheTtlMs: 100,
      fetch: async () => {
        calls += 1
        return new Response(JSON.stringify({ balances: [] }), { status: 200 })
      },
    })

    await provider.request({ base: 'binance-spot', path: '/api/v3/account', auth: 'signed' })
    await provider.request({ base: 'binance-spot', path: '/api/v3/account', auth: 'signed' })

    expect(calls).toBe(2)
  })

  it('accepts an injected retry delay for provider requests', async () => {
    const sleep = vi.fn(async () => {})
    let calls = 0
    const provider = createHttpFinanceMarketDataProvider({
      ...BASE_OPTIONS,
      fetch: async () => {
        calls += 1
        return calls === 1
          ? new Response(JSON.stringify({ error: 'busy' }), { status: 500 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
      maxRetries: 1,
      retryBaseDelayMs: 1,
      sleep,
    })
    await provider.request({ base: 'binance-spot', path: '/api/v3/ping' })
    expect(sleep).toHaveBeenCalledWith(1, undefined)
  })

  it('exposes FinanceDataError for programmatic callers', () => {
    const error = new FinanceDataError('failure', 'TEST')
    expect(error.name).toBe('FinanceDataError')
    expect(error.code).toBe('TEST')
  })
})
