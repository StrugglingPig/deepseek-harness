import { describe, expect, it } from 'vitest'
import {
  cryptoMetricsFromGlobal, cryptoMetricsForSymbol, cryptoMetricsFromCommunity, cryptoMetricsFromGithub,
  cryptoMetricsFromQuote,
  cryptoQuotesFromSources,
  equityMetricsFromFundamentals, equityMetricsFromValuation, usComparableMetrics, usMetricsFromFundamentals,
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
    const byKey = new Map<string, (typeof metrics)[number]>(metrics.map(metric => [metric.key, metric]))
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

  it('turns a global snapshot into market-wide metrics', () => {
    const metrics = cryptoMetricsFromGlobal({
      totalMarketCapUsd: 2.9e12,
      totalVolumeUsd: 1.4e11,
      btcDominance: 57.3,
      ethDominance: 12.1,
      activeCryptocurrencies: 21_358,
    })
    const byKey = new Map<string, (typeof metrics)[number]>(metrics.map(metric => [metric.key, metric]))
    expect(byKey.get('btcDominance')).toMatchObject({ group: 'market', value: 57.3, unit: '%', source: 'coingecko' })
    expect(byKey.get('ethDominance')).toMatchObject({ value: 12.1 })
    expect(byKey.get('activeCryptocurrencies')).toMatchObject({ value: 21_358 })
    // Figures outside the metric list, such as the totals, are not rendered.
    expect(byKey.has('totalMarketCapUsd')).toBe(false)
    expect(cryptoMetricsFromGlobal(undefined)).toEqual([])
    expect(cryptoMetricsFromGlobal({})).toEqual([])
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
      releases1y: 2, latestRelease: '2026-08-15',
    })).toEqual([
      { group: 'development', key: 'githubStars', value: 85_000, unit: '', asOf: '', source: 'github' },
      { group: 'development', key: 'githubForks', value: 36_000, unit: '', asOf: '', source: 'github' },
      { group: 'development', key: 'githubWatchers', value: 4_000, unit: '', asOf: '', source: 'github' },
      { group: 'development', key: 'githubOpenIssues', value: 600, unit: '', asOf: '', source: 'github' },
      { group: 'development', key: 'githubCommits4w', value: 140, unit: '', asOf: '', source: 'github' },
      { group: 'development', key: 'githubReleases1y', value: 2, unit: '', asOf: '', source: 'github' },
      { group: 'development', key: 'githubLatestRelease', value: 0, text: '2026-08-15', unit: '', asOf: '', source: 'github' },
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
    const byKey = new Map<string, (typeof metrics)[number]>(metrics.map(metric => [metric.key, metric]))
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

describe('comparable-company context', () => {
  it('builds one row per subject and skips figures a peer did not publish', () => {
    const metrics = usComparableMetrics(
      { symbol: 'AAPL', indicators: { peRatio: 32.5, roe: 137.2 } },
      [
        { symbol: 'MSFT', indicators: { peRatio: 28.1, roe: 35.0, revenueGrowth: 14.2 } },
        { symbol: 'DELL', indicators: {} },
      ],
    )
    expect(metrics.map(metric => [metric.subject, metric.key, metric.value])).toEqual([
      ['AAPL', 'peRatio', 32.5],
      ['AAPL', 'roe', 137.2],
      ['MSFT', 'peRatio', 28.1],
      ['MSFT', 'roe', 35],
      ['MSFT', 'revenueGrowth', 14.2],
    ])
    expect(metrics[1]).toMatchObject({ group: 'competition', unit: '%', source: 'finnhub' })
    expect(metrics[4]?.unit).toBe('%')
    // Without the instrument under review the table still reflects the peers.
    expect(usComparableMetrics(undefined, [{ symbol: 'MSFT', indicators: { peRatio: 28.1 } }]))
      .toHaveLength(1)
    expect(usComparableMetrics(undefined, [])).toEqual([])
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
    const byKey = new Map<string, (typeof metrics)[number]>(metrics.map(metric => [metric.key, metric]))
    expect(byKey.get('peRatio')).toMatchObject({ group: 'valuation', value: 32.5, source: 'finnhub' })
    expect(byKey.get('marketCap')).toMatchObject({ unit: 'USD' })
    expect(byKey.get('roe')).toMatchObject({ group: 'profitability', unit: '%' })
    expect(byKey.get('revenueGrowth')).toMatchObject({ group: 'growth', unit: '%' })
    expect(byKey.get('industry')).toMatchObject({ group: 'industry', text: 'Technology' })
    expect(byKey.get('peers')).toMatchObject({ group: 'competition', text: 'AAPL, MSFT' })
    expect(byKey.has('unknown')).toBe(false)
    const classification = usMetricsFromFundamentals({ symbol: 'AAPL', indicators: {}, industry: 'Technology' })
    expect(classification.map(metric => [metric.key, metric.text])).toEqual([['industry', 'Technology']])
    // An empty peer list contributes nothing rather than an empty line.
    expect(usMetricsFromFundamentals({ symbol: 'AAPL', indicators: {}, peers: [] })).toEqual([])
    expect(usMetricsFromFundamentals(undefined)).toEqual([])
  })

  it('carries the reported statement lines with the period the filing covers', () => {
    const metrics = usMetricsFromFundamentals({
      symbol: 'AAPL',
      reportedFinancials: 'FY2025 10-K',
      indicators: {
        revenue: 416_161_000_000,
        grossProfit: 195_201_000_000,
        operatingIncome: 133_050_000_000,
        netIncome: 112_010_000_000,
        totalAssets: 359_241_000_000,
        currentAssets: 147_957_000_000,
        liabilities: 285_508_000_000,
        equity: 73_733_000_000,
        totalDebt: 98_657_000_000,
        cash: 35_934_000_000,
        operatingCashFlow: 111_482_000_000,
        capex: 12_715_000_000,
        freeCashFlow: 98_767_000_000,
        depreciation: 11_698_000_000,
        stockBasedCompensation: 12_863_000_000,
        dividendsPaid: 15_421_000_000,
        buybacks: 90_711_000_000,
      },
    })
    const byKey = new Map<string, (typeof metrics)[number]>(metrics.map(metric => [metric.key, metric]))
    expect(metrics.filter(metric => metric.asOf === 'FY2025 10-K').map(metric => metric.key)).toEqual([
      'revenue', 'grossProfit', 'operatingIncome', 'netIncome', 'totalAssets', 'currentAssets',
      'liabilities', 'equity', 'totalDebt', 'cash', 'operatingCashFlow', 'capex', 'freeCashFlow',
      'depreciation', 'stockBasedCompensation', 'dividendsPaid', 'buybacks',
    ])
    expect(byKey.get('revenue')).toMatchObject({ group: 'growth', value: 416_161_000_000 })
    expect(byKey.get('grossProfit')).toMatchObject({ group: 'profitability', unit: 'USD' })
    expect(byKey.get('operatingIncome')).toMatchObject({ group: 'profitability' })
    expect(byKey.get('netIncome')).toMatchObject({ group: 'profitability', asOf: 'FY2025 10-K' })
    expect(byKey.get('totalAssets')).toMatchObject({ group: 'balance', unit: 'USD' })
    expect(byKey.get('totalDebt')).toMatchObject({ group: 'balance', value: 98_657_000_000 })
    expect(byKey.get('operatingCashFlow')).toMatchObject({ group: 'cash', unit: 'USD' })
    expect(byKey.get('freeCashFlow')).toMatchObject({ group: 'cash', asOf: 'FY2025 10-K' })
    // A payload without the filing label still reports the lines, without a period.
    expect(usMetricsFromFundamentals({ symbol: 'AAPL', indicators: { totalAssets: 1 } }))
      .toEqual([{ group: 'balance', key: 'totalAssets', value: 1, unit: 'USD', asOf: '', source: 'finnhub' }])
  })

  it('maps the free-tier extras into catalyst, growth, and insider metrics', () => {
    const metrics = usMetricsFromFundamentals({
      symbol: 'AAPL',
      indicators: {
        epsSurprise: 3.7, insiderNetShares: -1_200, insiderSentiment: 22.1,
        analystBuy: 34, analystHold: 15, analystSell: 4,
        insiderBoughtShares: 4_000, insiderSoldShares: 1_439,
      },
      headlines: ['Apple unveils the next iPhone', 'Apple raises its buyback'],
      nextEarnings: '2026-10-22',
      analystPeriod: '2026-09-01',
      latestFilingForm: '10-Q',
      latestFilingDate: '2026-08-01',
      reportedFinancials: 'FY2025 10-K',
    })
    const byKey = new Map<string, (typeof metrics)[number]>(metrics.map(metric => [metric.key, metric]))
    expect(byKey.get('epsSurprise')).toMatchObject({ group: 'growth', value: 3.7, unit: '%', source: 'finnhub' })
    expect(byKey.get('nextEarnings')).toMatchObject({ group: 'catalyst', text: '2026-10-22' })
    expect(byKey.get('newsHeadlines')).toMatchObject({
      group: 'catalyst', text: 'Apple unveils the next iPhone / Apple raises its buyback',
    })
    expect(byKey.get('insiderNetShares')).toMatchObject({ group: 'insider', value: -1_200 })
    expect(byKey.get('insiderSentiment')).toMatchObject({ group: 'insider', value: 22.1 })
    expect(byKey.get('insiderBoughtShares')).toMatchObject({ group: 'insider', value: 4_000 })
    expect(byKey.get('insiderSoldShares')).toMatchObject({ group: 'insider', value: 1_439 })
    // Analyst counts carry the period the ratings were published for.
    expect(byKey.get('analystBuy')).toMatchObject({ group: 'valuation', value: 34, asOf: '2026-09-01' })
    expect(byKey.get('analystHold')).toMatchObject({ group: 'valuation', value: 15 })
    expect(byKey.get('analystSell')).toMatchObject({ group: 'valuation', value: 4 })
    expect(byKey.get('latestFilingForm')).toMatchObject({ group: 'catalyst', text: '10-Q' })
    expect(byKey.get('latestFilingDate')).toMatchObject({ group: 'catalyst', text: '2026-08-01' })
    expect(byKey.get('reportedFinancials')).toMatchObject({ group: 'profitability', text: 'FY2025 10-K' })
    // An empty headline list contributes nothing rather than an empty line.
    expect(usMetricsFromFundamentals({ symbol: 'AAPL', indicators: {}, headlines: [] })).toEqual([])
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
