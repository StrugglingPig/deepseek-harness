import { describe, expect, it } from 'vitest'
import { equityMetricsFromFundamentals } from '../src/asset-context.ts'

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
