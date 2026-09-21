import { describe, expect, it } from 'vitest'
import { normalizeUsFundamentals } from '../src/alphavantage.ts'

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
