import { describe, expect, it } from 'vitest'
import {
  cryptoMetricsForSymbol, cryptoMetricsFromCommunity, cryptoMetricsFromGithub, cryptoMetricsFromQuote,
  cryptoQuotesFromSources,
  equityMetricsFromFundamentals, equityMetricsFromValuation, usMetricsFromFundamentals,
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

describe('crypto development context', () => {
  it('maps a GitHub repository snapshot into development metrics', () => {
    expect(cryptoMetricsFromGithub({
      repository: 'bitcoin/bitcoin', stars: 85_000, forks: 36_000, watchers: 4_000, openIssues: 600, commits4w: 140,
    })).toEqual([
      { group: 'development', key: 'githubStars', value: 85_000, unit: '', asOf: '', source: 'github' },
      { group: 'development', key: 'githubForks', value: 36_000, unit: '', asOf: '', source: 'github' },
      { group: 'development', key: 'githubWatchers', value: 4_000, unit: '', asOf: '', source: 'github' },
      { group: 'development', key: 'githubOpenIssues', value: 600, unit: '', asOf: '', source: 'github' },
      { group: 'development', key: 'githubCommits4w', value: 140, unit: '', asOf: '', source: 'github' },
    ])
    expect(cryptoMetricsFromGithub(undefined)).toEqual([])
  })

  it('adds GitHub metrics when the community snapshot links a repository', async () => {
    const quote = { id: 1, name: 'Bitcoin', symbol: 'BTC', currency: 'USD', slug: 'bitcoin', rank: 1 }
    const community = { id: 'bitcoin', name: 'Bitcoin', githubRepos: ['https://github.com/bitcoin/bitcoin'] }
    const metrics = await cryptoMetricsForSymbol(
      'BTC-USD',
      async () => [quote],
      async () => community,
      async (repository) => {
        expect(repository).toBe('bitcoin/bitcoin')
        return { repository, stars: 85_000 }
      },
    )
    expect(metrics.map(metric => metric.key)).toEqual(['rank', 'githubStars'])

    // A failing repository read keeps the market and community metrics.
    await expect(cryptoMetricsForSymbol(
      'BTC-USD', async () => [quote], async () => community, async () => { throw new Error('github down') },
    )).resolves.toHaveLength(1)

    // A community snapshot without a repository link stops at the community metrics.
    await expect(cryptoMetricsForSymbol(
      'BTC-USD', async () => [quote], async () => ({ id: 'bitcoin', name: 'Bitcoin' }), async () => undefined,
    )).resolves.toHaveLength(1)
  })
})

describe('equity valuation context', () => {
  it('maps multiples, market cap, and the industry baseline', () => {
    const metrics = equityMetricsFromValuation({
      symbol: '600519',
      name: '贵州茅台酒股份有限公司',
      industry: '酒、饮料和精制茶制造业',
      indicators: { peTtm: 19.23, peStatic: 18.39, pb: 6.23, unknown: 1 },
      marketCapYuan: 1_565_815_000_000,
      industryPe: { date: '2026-09-21', weighted: 18.94, median: 24.09, arithmetic: 107.56, companies: 39 },
    })
    const byKey = new Map(metrics.map(metric => [metric.key, metric]))
    expect(byKey.get('peTtm')).toMatchObject({ group: 'valuation', value: 19.23, unit: '' })
    expect(byKey.get('marketCap')).toMatchObject({ unit: 'CNY', value: 1_565_815_000_000 })
    expect(byKey.get('industryName')).toMatchObject({ group: 'industry', text: '酒、饮料和精制茶制造业' })
    expect(byKey.get('industryPe')).toMatchObject({ group: 'industry', value: 18.94 })
    expect(byKey.get('industryPeMedian')).toMatchObject({ value: 24.09 })
    expect(byKey.get('industryPeArithmetic')).toMatchObject({ value: 107.56 })
    expect(byKey.get('industryPeCompanies')).toMatchObject({ value: 39 })
    expect((byKey.get('peVsIndustryMedian')?.value ?? 0)).toBeCloseTo(-23.7, 1)
    // Static P/E against the industry weighted average, on the same basis.
    expect((byKey.get('peVsIndustry')?.value ?? 0)).toBeCloseTo(-2.9, 1)
    expect(byKey.has('unknown')).toBe(false)
  })

  it('omits the premium without a baseline or a P/E, and reports nothing without a snapshot', () => {
    const partial = equityMetricsFromValuation({ symbol: '600519', indicators: { peStatic: 18.39 } })
    expect(partial.map(metric => metric.key)).toEqual(['peStatic'])
    const noPe = equityMetricsFromValuation({
      symbol: '600519', indicators: {}, industryPe: { weighted: 18.94 },
    })
    expect(noPe.map(metric => metric.key)).toEqual(['industryPe'])
    expect(equityMetricsFromValuation(undefined)).toEqual([])
    const zeroBaseline = equityMetricsFromValuation({
      symbol: '600519', indicators: { peStatic: 18.39 }, industryPe: { weighted: 0 },
    })
    expect(zeroBaseline.map(metric => metric.key)).toEqual(['peStatic', 'industryPe'])
  })
})

describe('US equity context', () => {
  it('maps an overview into valuation, profitability, growth, and industry metrics', () => {
    const metrics = usMetricsFromFundamentals({
      symbol: 'AAPL',
      name: 'Apple Inc',
      industry: 'Technology',
      peers: ['AAPL', 'MSFT'],
      indicators: { marketCap: 3e12, peRatio: 32.5, roe: 1.5, revenueGrowth: 0.08, unknown: 1 },
    })
    const byKey = new Map(metrics.map(metric => [metric.key, metric]))
    expect(byKey.get('peRatio')).toMatchObject({ group: 'valuation', value: 32.5, source: 'finnhub' })
    expect(byKey.get('marketCap')).toMatchObject({ unit: 'USD' })
    expect(byKey.get('roe')).toMatchObject({ group: 'profitability' })
    expect(byKey.get('revenueGrowth')).toMatchObject({ group: 'growth' })
    expect(byKey.get('industry')).toMatchObject({ group: 'industry', text: 'Technology' })
    expect(byKey.get('peers')).toMatchObject({ group: 'competition', text: 'AAPL, MSFT' })
    expect(byKey.has('unknown')).toBe(false)
    const classification = usMetricsFromFundamentals({ symbol: 'AAPL', indicators: {}, industry: 'Technology' })
    expect(classification.map(metric => [metric.key, metric.text])).toEqual([['industry', 'Technology']])
    // An empty peer list contributes nothing rather than an empty line.
    expect(usMetricsFromFundamentals({ symbol: 'AAPL', indicators: {}, peers: [] })).toEqual([])
    expect(usMetricsFromFundamentals(undefined)).toEqual([])
  })
})

describe('crypto quote source fallback', () => {
  const primary = [{ id: 1, name: 'Bitcoin', symbol: 'BTC', currency: 'USD', price: 1 }]
  const fallback = [{ id: 2, name: 'Bitcoin', symbol: 'BTC', currency: 'USD', price: 2 }]

  it('keeps the primary answer when it publishes rows', async () => {
    await expect(cryptoQuotesFromSources(['BTC'], async () => primary, async () => fallback)).resolves.toEqual(primary)
  })

  it('falls back when the primary fails or returns nothing', async () => {
    await expect(cryptoQuotesFromSources(['BTC'], async () => { throw new Error('cmc down') }, async () => fallback))
      .resolves.toEqual(fallback)
    await expect(cryptoQuotesFromSources(['BTC'], async () => [], async () => fallback)).resolves.toEqual(fallback)
  })
})
