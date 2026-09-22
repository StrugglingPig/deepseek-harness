import { describe, expect, it } from 'vitest'
import { buildEarningsForecast, FORECAST_YEARS, type EarningsForecastInput } from '../src/forecast.ts'

/** Inputs a typical reported set produces, so each case changes one thing. */
const BASE: EarningsForecastInput = {
  price: 100,
  eps: 5,
  revenueGrowth: 12,
  revenue: 1_000,
  netIncome: 100,
  netMargin: 10,
  peRatio: 20,
  peerMedianPe: 25,
  fromYear: 2026,
}

/** The reported set with the peer multiple removed, so another multiple can win. */
function peersInput(): EarningsForecastInput {
  return {
    price: 100, eps: 5, revenueGrowth: 12, revenue: 1_000, netIncome: 100, netMargin: 10,
    peRatio: 20, fromYear: 2026,
  }
}

describe('earnings forecast', () => {
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

  it('prices the target off the peer median, the industry, or the own multiple', () => {
    const peers = buildEarningsForecast(BASE)
    expect(peers?.multipleSource).toBe('peers')
    expect(peers?.fairMultiple).toBe(25)
    expect(peers?.targetPrice).toBeCloseTo(5.6 * 25, 6)
    expect(peers?.upsidePercent).toBeCloseTo(40, 6)

    const industry = buildEarningsForecast({ ...peersInput(), industryPe: 18 })
    expect(industry?.multipleSource).toBe('industry')
    expect(industry?.fairMultiple).toBe(18)

    const own = buildEarningsForecast(peersInput())
    expect(own?.multipleSource).toBe('own')
    expect(own?.fairMultiple).toBe(20)
  })

  it('clamps the growth path and the applied multiple into the model band', () => {
    const hot = buildEarningsForecast({ ...BASE, revenueGrowth: 400, peerMedianPe: 500 })
    expect(hot?.startingGrowth).toBe(60)
    expect(hot?.fairMultiple).toBe(60)
    const cold = buildEarningsForecast({ ...BASE, revenueGrowth: -90, peerMedianPe: 1 })
    expect(cold?.startingGrowth).toBe(-20)
    expect(cold?.fairMultiple).toBe(5)
  })

  it('omits the revenue columns when no reported level exists', () => {
    const forecast = buildEarningsForecast({
      price: 100, eps: 5, revenueGrowth: 12, peRatio: 20, peerMedianPe: 25, fromYear: 2026,
    })
    expect(forecast?.years.map(year => year.revenue)).toEqual([undefined, undefined, undefined])
    expect(forecast?.years.map(year => year.netIncome)).toEqual([undefined, undefined, undefined])
    expect(forecast?.marginPercent).toBeUndefined()
    // A margin row without a revenue base cannot be derived either.
    expect(buildEarningsForecast({
      price: 100, eps: 5, revenueGrowth: 12, peRatio: 20, peerMedianPe: 25, fromYear: 2026,
    })?.years[0]?.eps).toBeCloseTo(5.6, 6)
    // Without a reported margin the model derives one from the two totals.
    const derived = buildEarningsForecast({
      price: 100, eps: 5, revenueGrowth: 12, peRatio: 20, peerMedianPe: 25, fromYear: 2026,
      revenue: 1_000, netIncome: 250,
    })
    expect(derived?.marginPercent).toBe(25)
    // A revenue base of zero cannot carry a margin.
    expect(buildEarningsForecast({ ...BASE, revenue: 0 })?.marginPercent).toBeUndefined()
  })

  it('declines to project without an earnings base, a price, or a multiple', () => {
    expect(buildEarningsForecast({ ...BASE, eps: 0 })).toBeUndefined()
    expect(buildEarningsForecast({ ...BASE, eps: Number.NaN })).toBeUndefined()
    expect(buildEarningsForecast({ ...BASE, price: 0 })).toBeUndefined()
    expect(buildEarningsForecast({ price: 100, eps: 5, revenueGrowth: 12, fromYear: 2026 })).toBeUndefined()
    expect(buildEarningsForecast({ ...BASE, peerMedianPe: 0 })).toBeUndefined()
  })
})
