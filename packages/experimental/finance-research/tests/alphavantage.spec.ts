import { describe, expect, it } from 'vitest'
import { normalizeAlphaVantageBars, normalizeUsFundamentals } from '../src/alphavantage.ts'

describe('Alpha Vantage normalization', () => {
  it('reads the overview figures and the sector classification', () => {
    const snapshot = normalizeUsFundamentals({
      Symbol: 'AAPL',
      Name: 'Apple Inc',
      Sector: 'TECHNOLOGY',
      Industry: 'Electronic Computers',
      Exchange: 'NASDAQ',
      MarketCapitalization: '3000000000000',
      PERatio: '32.5',
      PEGRatio: '2.1',
      PriceToBookRatio: '45.2',
      DividendYield: '0.0045',
      EPS: '6.1',
      ProfitMargin: '0.25',
      ReturnOnEquityTTM: '1.5',
      QuarterlyRevenueGrowthYOY: '0.08',
      Beta: '1.2',
      AnalystTargetPrice: '250',
      NoneField: 'None',
    }, 'AAPL')
    expect(snapshot).toMatchObject({ symbol: 'AAPL', name: 'Apple Inc', sector: 'TECHNOLOGY', industry: 'Electronic Computers' })
    expect(snapshot?.indicators).toMatchObject({
      marketCap: 3_000_000_000_000, peRatio: 32.5, pegRatio: 2.1, pbRatio: 45.2,
      dividendYield: 0.0045, eps: 6.1, netMargin: 0.25, roe: 1.5, revenueGrowthQoq: 0.08,
      beta: 1.2, analystTargetPrice: 250,
    })
  })

  it('skips absent and non-numeric fields', () => {
    // Values the upstream does not publish as strings, placeholders, and blanks all drop out.
    const snapshot = normalizeUsFundamentals({
      Name: 'Apple Inc', PERatio: 'None', PriceToBookRatio: '-', MarketCapitalization: '', Beta: null, PEGRatio: 32.5,
    }, 'AAPL')
    expect(snapshot).toEqual({ symbol: 'AAPL', name: 'Apple Inc', indicators: {} })
  })

  it('falls back to the requested symbol when the payload omits it', () => {
    expect(normalizeUsFundamentals({ Name: 'Apple Inc' }, 'aapl')?.symbol).toBe('aapl')
  })

  it('rejects a payload without a company name', () => {
    expect(normalizeUsFundamentals(undefined, 'AAPL')).toBeUndefined()
    expect(normalizeUsFundamentals({ Note: 'rate limit reached' }, 'AAPL')).toBeUndefined()
    expect(normalizeUsFundamentals({ Name: '' }, 'AAPL')).toBeUndefined()
  })
})

describe('Alpha Vantage daily bars', () => {
  it('normalizes the daily series into ascending bars', () => {
    const bars = normalizeAlphaVantageBars({
      'Time Series (Daily)': {
        '2026-09-19': { '1. open': '140', '2. high': '142', '3. low': '139', '4. close': '141', '6. volume': '1000' },
        '2026-09-18': { '1. open': '138', '2. high': '141', '3. low': '137', '4. close': '140', '5. volume': '900' },
        '2026-09-17': { '1. open': 'bad', '4. close': '139' },
        '2026-09-16': { '1. open': '137', '2. high': '139', '3. low': '136', '4. close': '138' },
      },
    })
    expect(bars).toEqual([
      { timestamp: '2026-09-16T00:00:00.000Z', open: 137, high: 139, low: 136, close: 138, volume: 0 },
      { timestamp: '2026-09-18T00:00:00.000Z', open: 138, high: 141, low: 137, close: 140, volume: 900 },
      { timestamp: '2026-09-19T00:00:00.000Z', open: 140, high: 142, low: 139, close: 141, volume: 1000 },
    ])
  })

  it('reports nothing for a notice or an unusable series', () => {
    expect(normalizeAlphaVantageBars(undefined)).toEqual([])
    expect(normalizeAlphaVantageBars({ Note: 'rate limit reached' })).toEqual([])
    expect(normalizeAlphaVantageBars({ 'Time Series (Daily)': { '2026-09-19': 'nope' } })).toEqual([])
  })
})
