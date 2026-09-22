import { describe, expect, it } from 'vitest'
import { normalizeFinnhubFundamentals } from '../src/finnhub.ts'

describe('Finnhub normalization', () => {
  it('reads the profile, the metric set, and the peer list', () => {
    const snapshot = normalizeFinnhubFundamentals(
      {
        name: 'Apple Inc',
        ticker: 'AAPL',
        exchange: 'NASDAQ',
        finnhubIndustry: 'Technology',
        marketCapitalization: 3_000_000,
      },
      {
        metric: {
          peTTM: 32.5,
          pbAnnual: 45.2,
          psTTM: 8.1,
          dividendYieldIndicatedAnnual: 0.45,
          roeTTM: 150,
          roaTTM: 25,
          netProfitMarginTTM: 25.3,
          operatingMarginTTM: 31.5,
          revenueGrowthTTMYoy: 8,
          epsGrowthTTMYoy: 12,
          epsTTM: 6.1,
          beta: 1.2,
          ignoredMetric: 1,
        },
      },
      ['AAPL', 'MSFT', 'GOOGL'],
      'AAPL',
    )
    expect(snapshot).toMatchObject({
      symbol: 'AAPL',
      name: 'Apple Inc',
      industry: 'Technology',
      exchange: 'NASDAQ',
      peers: ['AAPL', 'MSFT', 'GOOGL'],
    })
    expect(snapshot?.indicators).toMatchObject({
      peRatio: 32.5, pbRatio: 45.2, psRatio: 8.1, dividendYield: 0.45, roe: 150, roa: 25,
      netMargin: 25.3, operatingMargin: 31.5, revenueGrowth: 8, epsGrowth: 12, epsTtm: 6.1,
      beta: 1.2, marketCap: 3_000_000_000_000,
    })
    expect(snapshot?.indicators.ignoredMetric).toBeUndefined()
  })

  it('keeps whatever the answered calls published', () => {
    const metricOnly = normalizeFinnhubFundamentals(undefined, { metric: { peTTM: 10 } }, undefined, 'AAPL')
    expect(metricOnly).toEqual({ symbol: 'AAPL', indicators: { peRatio: 10 } })

    const profileOnly = normalizeFinnhubFundamentals({ name: 'Apple Inc', ticker: 'AAPL' }, undefined, 'nope', 'AAPL')
    expect(profileOnly).toEqual({ symbol: 'AAPL', name: 'Apple Inc', indicators: {} })

    // A peer list with unusable entries keeps only the usable symbols.
    const mixedPeers = normalizeFinnhubFundamentals({ name: 'Apple Inc' }, undefined, ['AAPL', 7, ''], 'AAPL')
    expect(mixedPeers?.peers).toEqual(['AAPL'])
  })

  it('reports nothing when no call published a company', () => {
    expect(normalizeFinnhubFundamentals(undefined, undefined, undefined, 'AAPL')).toBeUndefined()
    expect(normalizeFinnhubFundamentals({}, {}, [], 'AAPL')).toBeUndefined()
    expect(normalizeFinnhubFundamentals({ name: '', ticker: 'AAPL' }, { metric: {} }, ['AAPL'], 'AAPL')).toBeUndefined()
  })
})
