import { describe, expect, it } from 'vitest'
import { buildEarningsForecast, FORECAST_YEARS, type EarningsForecastInput } from '../src/forecast.ts'

/** Inputs a typical reported set produces, so each case changes one thing. */
const BASE: EarningsForecastInput = {
  eps: 5,
  revenueGrowth: 12,
  terminalGrowthPercent: 3,
  revenue: 1_000,
  netIncome: 100,
  netMargin: 10,
  fromYear: 2026,
}

describe('earnings path', () => {
  it('fades growth toward the terminal rate and projects revenue, income, and EPS', () => {
    const forecast = buildEarningsForecast(BASE)
    expect(forecast?.years).toHaveLength(FORECAST_YEARS)
    expect(forecast?.startingGrowth).toBe(12)
    // 12% → 3% target with a 0.6 fade: 12, 8.4, 6.24.
    expect(forecast?.years.map(year => Number(year.revenueGrowth.toFixed(2)))).toEqual([12, 8.4, 6.24])
    expect(forecast?.years.map(year => year.year)).toEqual([2027, 2028, 2029])
    expect(forecast?.years.map(year => year.eps.toFixed(3))).toEqual(['5.600', '6.070', '6.449'])
    // Revenue compounds on the same path and keeps the reported margin.
    expect(((forecast?.years[0]?.revenue ?? 0) / 1_000 - 1) * 100).toBeCloseTo(12, 6)
    expect(forecast?.years[0]?.netIncome).toBeCloseTo(1_120 * 0.1, 6)
    expect(forecast?.marginPercent).toBe(10)
  })

  it('follows a negative terminal rate and derives the margin from the reported figures', () => {
    const forecast = buildEarningsForecast({
      eps: 4, revenueGrowth: 2, terminalGrowthPercent: -1, revenue: 1_000, netIncome: 50, fromYear: 2026,
    })
    expect(forecast?.years.map(year => Number(year.revenueGrowth.toFixed(3)))).toEqual([2, 0.8, 0.08])
    expect(forecast?.marginPercent).toBe(5)
  })

  it('clamps the growth path into the model band', () => {
    const hot = buildEarningsForecast({ ...BASE, revenueGrowth: 400 })
    expect(hot?.startingGrowth).toBe(60)
    const cold = buildEarningsForecast({ ...BASE, revenueGrowth: -90 })
    expect(cold?.startingGrowth).toBe(-20)
  })

  it('omits the revenue columns when no reported level exists', () => {
    const forecast = buildEarningsForecast({ eps: 5, revenueGrowth: 12, terminalGrowthPercent: 3, fromYear: 2026 })
    expect(forecast?.years.every(year => year.revenue === undefined && year.netIncome === undefined)).toBe(true)
    expect(forecast?.marginPercent).toBeUndefined()
  })

  it('declines to project without an earnings base', () => {
    expect(buildEarningsForecast({ ...BASE, eps: 0 })).toBeUndefined()
    expect(buildEarningsForecast({ ...BASE, eps: Number.NaN })).toBeUndefined()
  })
})
