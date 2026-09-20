import { describe, expect, it, vi } from 'vitest'
import { COINMARKETCAP_API_KEY_REF, createCoinMarketCapRequestAuthorizer } from '../src/auth.ts'
import { normalizeCoinMarketCapOhlcv, normalizeCoinMarketCapQuotes } from '../src/coinmarketcap.ts'
import { createHttpFinanceMarketDataProvider } from '../src/http.ts'

describe('CoinMarketCap normalization', () => {
  it('normalizes quote arrays and keyed quote maps', () => {
    const quotes = normalizeCoinMarketCapQuotes({
      data: [{
        id: 1,
        name: 'Bitcoin',
        symbol: 'BTC',
        slug: 'bitcoin',
        cmc_rank: 1,
        last_updated: '2026-09-20T10:00:00.000Z',
        quote: { USD: { price: 60_000, percent_change_24h: 2.5, market_cap: 1_200_000, volume_24h: 50_000 } },
      }],
    }, 'USD')
    expect(quotes).toEqual([{
      id: 1,
      name: 'Bitcoin',
      symbol: 'BTC',
      slug: 'bitcoin',
      rank: 1,
      currency: 'USD',
      price: 60_000,
      percentChange24h: 2.5,
      marketCap: 1_200_000,
      volume24h: 50_000,
      lastUpdated: '2026-09-20T10:00:00.000Z',
    }])

    expect(normalizeCoinMarketCapQuotes({
      data: {
        BTC: { id: 1, name: 'Bitcoin', symbol: 'BTC', quote: [{ symbol: 'USD', price: 60_000 }] },
      },
    }, 'USD')).toMatchObject([{ id: 1, symbol: 'BTC', price: 60_000 }])

    expect(normalizeCoinMarketCapQuotes({ data: 'invalid' }, 'USD')).toEqual([])
    expect(normalizeCoinMarketCapQuotes({ data: [1, {}, { id: 1, name: 'Bitcoin', symbol: 'BTC' }] }, 'USD'))
      .toEqual([{ id: 1, name: 'Bitcoin', symbol: 'BTC', currency: 'USD' }])
    expect(normalizeCoinMarketCapQuotes({ data: { BTC: { id: 1, name: 'Bitcoin', symbol: 'BTC', quote: { EUR: { price: 55_000 } } } } }, 'USD'))
      .toMatchObject([{ id: 1, symbol: 'BTC', price: 55_000 }])
    expect(normalizeCoinMarketCapQuotes({ data: { BTC: { id: 1, name: 'Bitcoin', symbol: 'BTC', quote: [] } } }, 'USD'))
      .toMatchObject([{ id: 1, symbol: 'BTC' }])
  })

  it('normalizes historical OHLCV series', () => {
    const series = normalizeCoinMarketCapOhlcv({
      data: {
        id: 1,
        name: 'Bitcoin',
        symbol: 'BTC',
        quotes: [
          {
            time_open: '2026-09-19T00:00:00.000Z',
            quote: { USD: { open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 } },
          },
          { time_open: 'bad', quote: { USD: { open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 } } },
        ],
      },
    }, 'USD')
    expect(series).toEqual([{
      id: 1,
      name: 'Bitcoin',
      symbol: 'BTC',
      currency: 'USD',
      bars: [{ timestamp: '2026-09-19T00:00:00.000Z', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }],
    }])
    expect(normalizeCoinMarketCapOhlcv({}, 'USD')).toEqual([])
    expect(normalizeCoinMarketCapOhlcv({ data: { bad: true } }, 'USD')).toEqual([])
    expect(normalizeCoinMarketCapOhlcv({ data: { id: 1, name: 'Bitcoin', symbol: 'BTC', quotes: 'bad' } }, 'USD')).toEqual([])
  })
})

describe('CoinMarketCap HTTP provider', () => {
  it('loads quotes and OHLCV through api-key authorization', async () => {
    const authorize = createCoinMarketCapRequestAuthorizer({
      resolveCredential: async ref => ref === COINMARKETCAP_API_KEY_REF ? 'cmc-key' : undefined,
      enabled: () => true,
    })
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      expect((init?.headers as Record<string, string>)['X-CMC_PRO_API_KEY']).toBe('cmc-key')
      if (url.includes('/ohlcv/historical')) {
        return new Response(JSON.stringify({ data: { id: 1, name: 'Bitcoin', symbol: 'BTC', quotes: [] } }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: [{ id: 1, name: 'Bitcoin', symbol: 'BTC', quote: { USD: { price: 60_000 } } }] }), { status: 200 })
    })
    const provider = createHttpFinanceMarketDataProvider({
      fetch,
      coinMarketCapBaseUrl: 'https://cmc.test',
      authorize,
    })

    await expect(provider.loadCoinMarketCapQuotes({ symbols: ['BTC'], convert: 'USD' }))
      .resolves.toMatchObject([{ symbol: 'BTC', price: 60_000 }])
    await expect(provider.loadCoinMarketCapOhlcv({ id: 1, count: 2, interval: '1d', convert: 'USD' }))
      .resolves.toMatchObject([{ symbol: 'BTC', bars: [] }])
    await expect(provider.loadCoinMarketCapQuotes({ ids: [1, 1027] })).resolves.toHaveLength(1)
    await expect(provider.loadCoinMarketCapQuotes({ id: 1 })).resolves.toHaveLength(1)
    await expect(provider.loadCoinMarketCapOhlcv({
      symbols: ['BTC'], timeStart: '2026-09-01T00:00:00.000Z', timeEnd: '2026-09-20T00:00:00.000Z',
    })).resolves.toHaveLength(1)

    const urls = fetch.mock.calls.map(([input]) => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    expect(urls.some(url => url.includes('/v3/cryptocurrency/quotes/latest?symbol=BTC&convert=USD'))).toBe(true)
    expect(urls.some(url => url.includes('/v2/cryptocurrency/ohlcv/historical?id=1&convert=USD&count=2&interval=1d'))).toBe(true)
  })
})
