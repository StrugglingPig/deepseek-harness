import { describe, expect, it } from 'vitest'
import type { AssetMetric } from '../src/asset-context.ts'
import type { MacroSeries } from '../src/macro.ts'
import {
  VALUATION_PARAMETERS, buildCashFlowValue, buildCostOfCapital, buildEarningsQuality, buildRatios, buildValueBands,
  buildValuation, buildValuationInputs, buildVerdict,
  type CashFlowValue, type ValuationInputs, type ValuationParameters,
} from '../src/valuation.ts'

/** A reported set with clean signals, so each case changes one thing. */
const INPUT: ValuationInputs = {
  price: 100,
  reportedPeriod: 'FY2025 10-K',
  revenue: 1_000,
  grossProfit: 450,
  operatingIncome: 200,
  netIncome: 150,
  totalAssets: 1_000,
  currentAssets: 400,
  currentLiabilities: 200,
  liabilities: 600,
  equity: 400,
  totalDebt: 200,
  cash: 100,
  retainedEarnings: 250,
  operatingCashFlow: 180,
  capex: 30,
  freeCashFlow: 150,
  depreciation: 20,
  pretaxIncome: 200,
  taxExpense: 40,
  revenueGrowthPercent: 8,
  beta: 1.1,
  marketCap: 2_000,
  epsTtm: 7.5,
}

/** Metrics one US equity lookup publishes, keyed the way the report builder emits them. */
function metricsFor(values: Readonly<Record<string, number>>, text?: string): readonly AssetMetric[] {
  return [
    ...Object.entries(values).map(([key, value]) => ({
      group: 'profitability' as const, key: key as AssetMetric['key'], value, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub',
    })),
    ...text === undefined ? [] : [{
      group: 'profitability' as const, key: 'reportedFinancials' as const, value: 0, text, unit: '', asOf: '', source: 'finnhub',
    }],
  ]
}

/** A ten-year yield series the report reads as the risk-free rate. */
function yieldSeries(value: number): MacroSeries {
  return {
    indicator: 'us-10y-yield',
    name: 'US 10-year Treasury yield',
    nameZh: '美国 10 年期国债收益率',
    category: 'market',
    country: 'us',
    unit: '%',
    frequency: 'daily',
    timing: 'coincident',
    reading: 'The realised yield.',
    affectedAssets: [],
    source: 'fred',
    observations: [{ date: '2026-09-22', value }],
    latest: { date: '2026-09-22', value },
    previous: undefined,
    retrievedAt: '2026-09-23T00:00:00.000Z',
  }
}

/**
 * The reported set without the named fields, the way a filing that omits them arrives.
 * @param keys - Field names to drop.
 * @returns The input record without those fields.
 */
function without(...keys: readonly (keyof ValuationInputs)[]): ValuationInputs {
  return Object.fromEntries(
    Object.entries(INPUT).filter(([key]) => !keys.includes(key as keyof ValuationInputs)),
  ) as ValuationInputs
}

/** The cost of capital the default inputs produce, for the value tests. */
function costOf(inputs: ValuationInputs, parameters: ValuationParameters = VALUATION_PARAMETERS) {
  const cost = buildCostOfCapital(inputs, parameters)
  if (cost === undefined) throw new Error('test input must carry an equity value')
  return cost
}

describe('valuation inputs', () => {
  it('reads the statement lines, the market figures, and the ten-year yield', () => {
    const inputs = buildValuationInputs(
      metricsFor({
        revenue: 1_000, grossProfit: 450, operatingIncome: 200, netIncome: 150, marketCap: 2_000, interestExpense: 10,
      }, 'FY2025 10-K'),
      [yieldSeries(4.25)],
      100,
    )
    expect(inputs).toMatchObject({
      price: 100,
      reportedPeriod: 'FY2025 10-K',
      revenue: 1_000,
      grossProfit: 450,
      operatingIncome: 200,
      netIncome: 150,
      marketCap: 2_000,
      riskFreePercent: 4.25,
      riskFreeAsOf: '2026-09-22',
      riskFreeSource: 'fred',
    })
    // Statement lines the payload omitted stay absent rather than reading as zero.
    expect(inputs.interestExpense).toBe(10)
    expect(inputs.totalAssets).toBeUndefined()
    expect(inputs.currentLiabilities).toBeUndefined()
  })

  it('carries no figures when nothing loaded', () => {
    const inputs = buildValuationInputs([], [], 42)
    expect(inputs).toEqual({ price: 42, reportedPeriod: '' })
  })
})

describe('financial ratios', () => {
  it('computes every ratio the statements support', () => {
    const readings = new Map(buildRatios(INPUT, VALUATION_PARAMETERS).map(reading => [reading.id, reading]))
    expect(readings.get('grossMargin')?.value).toBeCloseTo(45, 6)
    expect(readings.get('operatingMargin')?.value).toBeCloseTo(20, 6)
    expect(readings.get('netMargin')?.value).toBeCloseTo(15, 6)
    expect(readings.get('fcfMargin')?.value).toBeCloseTo(15, 6)
    expect(readings.get('accrualsRatio')?.value).toBeCloseTo(-3, 6)
    expect(readings.get('cashConversion')?.value).toBeCloseTo(1.2, 6)
    expect(readings.get('debtToEquity')?.value).toBeCloseTo(50, 6)
    expect(readings.get('netDebtToEbitda')?.value).toBeCloseTo(100 / 220, 6)
    expect(readings.get('currentRatio')?.value).toBeCloseTo(2, 6)
    expect(readings.get('roic')?.value).toBeCloseTo(200 * 0.8 / 600 * 100, 6)
  })

  it('reports a ratio as not obtained when its inputs are missing', () => {
    const readings = buildRatios({ price: 10, reportedPeriod: '' }, VALUATION_PARAMETERS)
    expect(readings).toHaveLength(10)
    expect(readings.every(reading => reading.value === undefined)).toBe(true)
    // A zero denominator contributes no reading rather than an infinity.
    expect(buildRatios({ ...INPUT, equity: 0, retainedEarnings: 0 }, VALUATION_PARAMETERS)
      .find(reading => reading.id === 'debtToEquity')?.value).toBeUndefined()
  })
})

describe('cost of capital', () => {
  it('needs an equity value before it can weight the structure', () => {
    expect(buildCostOfCapital(without('marketCap'), VALUATION_PARAMETERS)).toBeUndefined()
    expect(buildCostOfCapital({ ...INPUT, marketCap: 0 }, VALUATION_PARAMETERS)).toBeUndefined()
  })

  it('prices the debt off the filing when interest expense is published', () => {
    const cost = costOf({ ...INPUT, interestExpense: 10 })
    const components = new Map(cost.components.map(component => [component.id, component]))
    expect(components.get('costOfDebt')).toMatchObject({ value: 5, source: 'finnhub' })
    expect(components.get('taxRate')).toMatchObject({ value: 20, source: 'finnhub' })
    expect(components.get('equityWeight')?.value).toBeCloseTo(2_000 / 2_200 * 100, 6)
    expect(components.get('debtWeight')?.value).toBeCloseTo(200 / 2_200 * 100, 6)
    expect(cost.waccPercent).toBeCloseTo(
      2_000 / 2_200 * (4 + 1.1 * 4.5) + 200 / 2_200 * 5 * 0.8,
      6,
    )
  })

  it('falls back to the configured spread and tax rate when the filing carries neither', () => {
    const cost = costOf(without('pretaxIncome', 'taxExpense'))
    const components = new Map(cost.components.map(component => [component.id, component]))
    expect(components.get('costOfDebt')).toMatchObject({ value: 4 + 1.2, source: 'assumption' })
    expect(components.get('taxRate')).toMatchObject({ value: 21, source: 'assumption' })
    expect(components.get('riskFree')).toMatchObject({ value: 4, source: 'assumption', asOf: '' })
  })

  it('clamps the published beta before it reaches the cost of equity', () => {
    const high = costOf({ ...INPUT, beta: 4 })
    const low = costOf({ ...INPUT, beta: 0.05 })
    const noBeta = costOf(without('beta'))
    expect(high.components.find(component => component.id === 'beta')?.value).toBe(2.5)
    expect(low.components.find(component => component.id === 'beta')?.value).toBe(0.4)
    expect(noBeta.components.find(component => component.id === 'beta')?.value).toBe(1)
  })

  it('caps an extreme effective tax rate and ignores a loss-making year', () => {
    const extreme = costOf({ ...INPUT, pretaxIncome: 100, taxExpense: 90 })
    expect(extreme.taxRatePercent).toBe(40)
    const loss = costOf({ ...INPUT, pretaxIncome: -100, taxExpense: 20 })
    expect(loss.taxRatePercent).toBe(21)
  })
})

describe('earnings quality', () => {
  it('grades A a clean reported set', () => {
    const quality = buildEarningsQuality(INPUT)
    expect(quality.grade).toBe('A')
    expect(quality.signals.map(signal => signal.id)).toEqual(['accrualsRatio', 'cashConversion', 'altmanZ'])
    expect(quality.signals.every(signal => signal.value !== undefined)).toBe(true)
  })

  it('grades B, C, and D as the signals deteriorate', () => {
    // Cash conversion below one but above the floor: credible, not complete.
    expect(buildEarningsQuality({ ...INPUT, operatingCashFlow: 140 }).grade).toBe('B')
    // Accruals above the caution line.
    expect(buildEarningsQuality({ ...INPUT, operatingCashFlow: 100 }).grade).toBe('C')
    // Cash conversion below the floor while the accruals ratio stays small.
    expect(buildEarningsQuality({ ...INPUT, totalAssets: 5_000, operatingCashFlow: 80 }).grade).toBe('C')
    // An Altman Z-score inside the grey zone.
    expect(buildEarningsQuality({ ...INPUT, marketCap: 200 }).grade).toBe('C')
    // Accruals above the distress line.
    expect(buildEarningsQuality({ ...INPUT, operatingCashFlow: 50 }).grade).toBe('D')
    // An Altman Z-score inside the distress zone.
    expect(buildEarningsQuality({ ...INPUT, retainedEarnings: -500, marketCap: 50 }).grade).toBe('D')
  })

  it('reports each signal as not obtained when its inputs are missing', () => {
    const quality = buildEarningsQuality({ price: 10, reportedPeriod: '' })
    expect(quality.grade).toBeUndefined()
    expect(quality.signals.every(signal => signal.value === undefined)).toBe(true)
  })

  it('drops the Altman term whenever one of its inputs is missing', () => {
    const required: readonly (keyof ValuationInputs)[] = [
      'totalAssets', 'currentAssets', 'currentLiabilities', 'retainedEarnings',
      'operatingIncome', 'marketCap', 'revenue', 'liabilities',
    ]
    for (const key of required) {
      const quality = buildEarningsQuality(without(key))
      expect(quality.signals.find(signal => signal.id === 'altmanZ')?.value).toBeUndefined()
    }
    expect(buildEarningsQuality({ ...INPUT, liabilities: 0 })
      .signals.find(signal => signal.id === 'altmanZ')?.value).toBeUndefined()
  })
})

describe('cash-flow value', () => {
  it('values the instrument across three scenarios with the cross-checks beside them', () => {
    const value = buildCashFlowValue(INPUT, VALUATION_PARAMETERS, costOf(INPUT)) as CashFlowValue
    expect(value.scenarios.map(scenario => scenario.id)).toEqual(['bear', 'base', 'bull'])
    const [bear, base, bull] = value.scenarios
    expect(bear?.valuePerShare).toBeLessThan(base?.valuePerShare as number)
    expect(base?.valuePerShare).toBeLessThan(bull?.valuePerShare as number)
    expect(value.lowValuePerShare).toBe(bear?.valuePerShare)
    expect(value.highValuePerShare).toBe(bull?.valuePerShare)
    // The probabilities printed beside the paths sum to one and weight the point value.
    expect(value.scenarios.reduce((sum, scenario) => sum + scenario.probability, 0)).toBeCloseTo(1, 6)
    expect(value.weightedValuePerShare).toBeCloseTo(
      value.scenarios.reduce((sum, scenario) => sum + scenario.valuePerShare * scenario.probability, 0),
      6,
    )
    expect(value.terminalValueSharePercent).toBeGreaterThan(0)
    expect(value.impliedExitMultiple).toBeGreaterThan(0)
    const wacc = costOf(INPUT).waccPercent / 100
    expect(value.earningsPowerValuePerShare).toBeCloseTo((200 * 0.8 / wacc - 100) / 20, 6)
    expect(value.impliedGrowthAtBound).toBe(false)
    expect(value.impliedGrowthPercent).toBeGreaterThan(-20)
    expect(value.impliedGrowthPercent).toBeLessThan(60)
    // A higher discount rate lowers the value, so the sensitivity grid runs high to low.
    expect(value.sensitivity).toHaveLength(3)
    expect(value.sensitivity[0]?.valuePerShare).toBeGreaterThan(value.sensitivity[2]?.valuePerShare as number)
    expect(value.terminalValueCeilingBreached).toBe(false)
  })

  it('starts the path from zero growth when no trailing growth loaded', () => {
    const inputs = without('revenueGrowthPercent')
    const value = buildCashFlowValue(inputs, VALUATION_PARAMETERS, costOf(inputs))
    expect(value?.scenarios.map(scenario => scenario.startingGrowthPercent)).toEqual([-5, 0, 5])
  })

  it('reads the value bands the football field draws', () => {
    const value = buildCashFlowValue(INPUT, VALUATION_PARAMETERS, costOf(INPUT)) as CashFlowValue
    const bands = new Map(buildValueBands(value).map(band => [band.id, band]))
    expect([...bands.keys()]).toEqual(['dcf', 'epv', 'sensitivity'])
    expect(bands.get('dcf')).toEqual({ id: 'dcf', low: value.lowValuePerShare, high: value.highValuePerShare })
    // The no-growth value is a point, and the discount-rate band spans the ±1 point grid.
    expect(bands.get('epv')?.low).toBe(value.earningsPowerValuePerShare)
    expect(bands.get('epv')?.high).toBe(value.earningsPowerValuePerShare)
    const sensitivity = value.sensitivity.flatMap(entry => entry.valuePerShare === undefined ? [] : [entry.valuePerShare])
    expect(bands.get('sensitivity')?.low).toBe(Math.min(...sensitivity))
    expect(bands.get('sensitivity')?.high).toBe(Math.max(...sensitivity))
  })

  it('flags a terminal-value share above the configured ceiling', () => {
    const value = buildCashFlowValue(INPUT, { ...VALUATION_PARAMETERS, terminalValueCeilingPercent: 20 }, costOf(INPUT))
    expect(value?.terminalValueCeilingBreached).toBe(true)
  })

  it('reports the growth the price implies, and the search bound when the price sits outside it', () => {
    const cheapInputs = { ...INPUT, price: 1, marketCap: 1 }
    const cheap = buildCashFlowValue(cheapInputs, VALUATION_PARAMETERS, costOf(cheapInputs))
    expect(cheap?.impliedGrowthAtBound).toBe(true)
    expect(cheap?.impliedGrowthPercent).toBe(-20)
    const rich = buildCashFlowValue(
      { ...INPUT, price: 1_000_000, marketCap: 1_000_000 },
      VALUATION_PARAMETERS,
      costOf({ ...INPUT, price: 1_000_000, marketCap: 1_000_000 }),
    )
    expect(rich?.impliedGrowthAtBound).toBe(true)
    expect(rich?.impliedGrowthPercent).toBe(60)
  })

  it('declines the value when the inputs or the path cannot support one', () => {
    const cost = costOf(INPUT)
    expect(buildCashFlowValue(without('capex'), VALUATION_PARAMETERS, cost)).toBeUndefined()
    expect(buildCashFlowValue(without('marketCap'), VALUATION_PARAMETERS, cost)).toBeUndefined()
    expect(buildCashFlowValue({ ...INPUT, price: 0 }, VALUATION_PARAMETERS, cost)).toBeUndefined()
    expect(buildCashFlowValue({ ...INPUT, operatingIncome: -50 }, VALUATION_PARAMETERS, cost)).toBeUndefined()
    expect(buildCashFlowValue({ ...INPUT, capex: 1_000, depreciation: 0 }, VALUATION_PARAMETERS, cost)).toBeUndefined()
    expect(buildCashFlowValue({ ...INPUT, totalDebt: 100_000 }, VALUATION_PARAMETERS, cost)).toBeUndefined()
    // A bear case whose margin turns negative has no cash flow to discount.
    const wideBear = { ...VALUATION_PARAMETERS, bearMarginShiftPercent: -20 }
    expect(buildCashFlowValue({ ...INPUT, operatingIncome: 30 }, wideBear, cost)).toBeUndefined()
    // A terminal growth rate at or above the discount rate cannot be terminal.
    const flat = { ...VALUATION_PARAMETERS, terminalGrowthPercent: 20 }
    expect(buildCashFlowValue({ ...INPUT, riskFreePercent: 20 }, flat, cost)).toBeUndefined()
  })

  it('leaves a sensitivity step out when that discount rate reaches the terminal growth', () => {
    // With no equity premium or credit spread the cost of capital sits just above the terminal rate,
    // so the −1 point step falls below it while the base step stays above.
    const parameters = {
      ...VALUATION_PARAMETERS, terminalGrowthPercent: 3.5, equityRiskPremiumPercent: 0, creditSpreadPercent: 0,
    }
    const inputs = { ...INPUT, riskFreePercent: 4 }
    const cost = costOf(inputs, parameters)
    const value = buildCashFlowValue(inputs, parameters, cost)
    expect(value?.sensitivity[0]?.valuePerShare).toBeUndefined()
    expect(value?.sensitivity[1]?.valuePerShare).toBeDefined()
  })
})

describe('verdict mapping', () => {
  const qualityA = { grade: 'A' as const, signals: [] }

  it('maps the weighted value and the grade onto one action', () => {
    // The map is pre-registered: +15% accumulates, −10% reduces, and the band between holds.
    expect(buildVerdict(INPUT, VALUATION_PARAMETERS, qualityA, { weightedValuePerShare: 200 } as CashFlowValue).action)
      .toBe('accumulate')
    expect(buildVerdict(INPUT, VALUATION_PARAMETERS, qualityA, { weightedValuePerShare: 105 } as CashFlowValue).action)
      .toBe('hold')
    expect(buildVerdict(INPUT, VALUATION_PARAMETERS, qualityA, { weightedValuePerShare: 80 } as CashFlowValue).action)
      .toBe('reduce')
  })

  it('caps the action at watch when the grade is C, absent, or the value did not run', () => {
    expect(buildVerdict(INPUT, VALUATION_PARAMETERS, { grade: 'C', signals: [] }, undefined).action).toBe('watch')
    expect(buildVerdict(INPUT, VALUATION_PARAMETERS, { signals: [] }, undefined).action).toBe('watch')
    expect(buildVerdict(INPUT, VALUATION_PARAMETERS, qualityA, undefined).action).toBe('watch')
  })

  it('suppresses the valuation at grade D', () => {
    const verdict = buildVerdict(INPUT, VALUATION_PARAMETERS, { grade: 'D', signals: [] }, undefined)
    expect(verdict).toEqual({ action: 'avoid', suppressed: true })
  })
})

describe('complete valuation read', () => {
  it('runs the ratios, the cost of capital, the grade, and the range together', () => {
    const analysis = buildValuation(INPUT, VALUATION_PARAMETERS)
    expect(analysis.parameters).toBe(VALUATION_PARAMETERS)
    expect(analysis.ratios).toHaveLength(10)
    expect(analysis.cost?.waccPercent).toBeCloseTo(costOf(INPUT).waccPercent, 6)
    expect(analysis.quality.grade).toBe('A')
    expect(analysis.value?.scenarios).toHaveLength(3)
    expect(analysis.verdict.suppressed).toBe(false)
  })

  it('suppresses the range when the grade is D, and reports no cost without an equity value', () => {
    const distressed = buildValuation({ ...INPUT, operatingCashFlow: 50 }, VALUATION_PARAMETERS)
    expect(distressed.quality.grade).toBe('D')
    expect(distressed.value).toBeUndefined()
    expect(distressed.verdict).toEqual({ action: 'avoid', suppressed: true })
    const noEquity = buildValuation(without('marketCap'), VALUATION_PARAMETERS)
    expect(noEquity.cost).toBeUndefined()
    expect(noEquity.value).toBeUndefined()
  })
})
