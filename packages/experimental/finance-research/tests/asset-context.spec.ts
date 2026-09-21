import { describe, expect, it } from 'vitest'
import {
  cryptoMetricsForSymbol, cryptoMetricsFromCommunity, cryptoMetricsFromQuote, equityMetricsFromFundamentals,
} from '../src/asset-context.ts'

describe('asset metric context', () => {
  it('maps the newest reported period into report metrics', () => {
    const metrics = equityMetricsFromFundamentals({
      symbol: '600519',
      periods: [
        { period: '2026-03-31', metrics: { roe: 9.5 } },
        { period: '2026-06-30', metrics: { eps: 36.82, roe: 17.72, revenueGrowth: 1.47, unknownRatio: 5 } },
      ],
    })
    expect(metrics.map(metric => metric.key)).toEqual(['eps', 'roe', 'revenueGrowth'])
    expect(metrics.map(metric => metric.group)).toEqual(['valuation', 'profitability', 'growth'])
    expect(metrics[0]).toMatchObject({ value: 36.82, unit: 'CNY', asOf: '2026-06-30', source: 'akshare' })
    expect(metrics[1]?.unit).toBe('%')
    expect(equityMetricsFromFundamentals({
      symbol: '600519',
      periods: [{ period: '2026-06-30', metrics: { cashConversion: 1.54, currentRatio: 5.5 } }],
    }).map(metric => metric.unit)).toEqual(['', ''])
  })

  it('reports nothing without a series or without a reported period', () => {
    expect(equityMetricsFromFundamentals(undefined)).toEqual([])
    expect(equityMetricsFromFundamentals({ symbol: '600519', periods: [] })).toEqual([])
  })
})

describe('crypto market context', () => {
  const quote = {
    id: 1,
    name: 'Bitcoin',
    symbol: 'BTC',
    currency: 'USD',
    rank: 1,
    marketCap: 1.7e12,
    volume24h: 3.8e10,
    percentChange24h: 5.7,
    percentChange90d: 36.3,
    circulatingSupply: 20_087_418,
    maxSupply: 21_000_000,
    lastUpdated: '2026-09-21T00:00:00.000Z',
  }

  it('turns a quote into market and supply metrics', () => {
    const metrics = cryptoMetricsFromQuote(quote)
    const byKey = new Map(metrics.map(metric => [metric.key, metric]))
    expect(byKey.get('rank')).toMatchObject({ group: 'market', value: 1, unit: '' })
    expect(byKey.get('marketCap')).toMatchObject({ unit: 'USD', source: 'coinmarketcap' })
    expect(byKey.get('change24h')).toMatchObject({ group: 'market', value: 5.7, unit: '%' })
    expect(byKey.get('circulatingSupply')).toMatchObject({ group: 'supply', value: 20_087_418 })
    // Fields the upstream omitted are skipped rather than rendered as null.
    expect(byKey.has('change7d')).toBe(false)
    expect(metrics).toHaveLength(7)
  })

  it('reports nothing without a quote, and an empty as-of when the upstream omits it', () => {
    expect(cryptoMetricsFromQuote(undefined)).toEqual([])
    const withoutTimestamp = cryptoMetricsFromQuote({ id: 1, name: 'Bitcoin', symbol: 'BTC', currency: 'USD', rank: 1 })
    expect(withoutTimestamp).toEqual([
      { group: 'market', key: 'rank', value: 1, unit: '', asOf: '', source: 'coinmarketcap' },
    ])
  })

  it('looks a quoted pair up by its base asset', async () => {
    await expect(cryptoMetricsForSymbol('BTC-USD', async (symbols) => {
      expect(symbols).toEqual(['BTC'])
      return [quote]
    })).resolves.toHaveLength(7)

    // A symbol without a quote currency is not a pair, so no lookup happens.
    const calls: string[][] = []
    await expect(cryptoMetricsForSymbol('AAPL', async (symbols) => {
      calls.push([...symbols])
      return []
    })).resolves.toEqual([])
    expect(calls).toEqual([])

    await expect(cryptoMetricsForSymbol('BTC-USD', async () => {
      throw new Error('cmc down')
    })).resolves.toEqual([])
  })
})

describe('crypto community context', () => {
  it('turns a community snapshot into community and development metrics', () => {
    const metrics = cryptoMetricsFromCommunity({
      id: 'bitcoin',
      name: 'Bitcoin',
      twitterFollowers: 7_100_000,
      sentimentUp: 78.5,
      githubCommits4w: 210,
    })
    expect(metrics).toEqual([
      { group: 'community', key: 'twitterFollowers', value: 7_100_000, unit: '', asOf: '', source: 'coingecko' },
      { group: 'community', key: 'sentimentUp', value: 78.5, unit: '%', asOf: '', source: 'coingecko' },
      { group: 'development', key: 'githubCommits4w', value: 210, unit: '', asOf: '', source: 'coingecko' },
    ])
    expect(cryptoMetricsFromCommunity(undefined)).toEqual([])
  })

  it('adds community metrics when the quote exposes a CoinGecko id', async () => {
    const community = { id: 'bitcoin', name: 'Bitcoin', githubStars: 85_000 }
    await expect(cryptoMetricsForSymbol('BTC-USD', async () => [{
      id: 1, name: 'Bitcoin', symbol: 'BTC', currency: 'USD', slug: 'bitcoin', rank: 1,
    }], async (id) => {
      expect(id).toBe('bitcoin')
      return community
    })).resolves.toEqual([
      { group: 'market', key: 'rank', value: 1, unit: '', asOf: '', source: 'coinmarketcap' },
      { group: 'development', key: 'githubStars', value: 85_000, unit: '', asOf: '', source: 'coingecko' },
    ])

    // Without a slug, or without a community loader, only the market metrics remain.
    await expect(cryptoMetricsForSymbol('BTC-USD', async () => [{
      id: 1, name: 'Bitcoin', symbol: 'BTC', currency: 'USD', rank: 1,
    }], async () => community)).resolves.toHaveLength(1)
    await expect(cryptoMetricsForSymbol('BTC-USD', async () => [{
      id: 1, name: 'Bitcoin', symbol: 'BTC', currency: 'USD', slug: 'bitcoin',
    }])).resolves.toEqual([])

    // A failing community read keeps the market metrics.
    await expect(cryptoMetricsForSymbol('BTC-USD', async () => [{
      id: 1, name: 'Bitcoin', symbol: 'BTC', currency: 'USD', slug: 'bitcoin', rank: 1,
    }], async () => { throw new Error('coingecko down') })).resolves.toHaveLength(1)
  })
})
