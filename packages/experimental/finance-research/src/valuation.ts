/**
 * Deterministic in-house valuation for equity reports.
 *
 * Every function here is a pure function of one explicit input record. The record is built
 * from the reported statement lines, the published metric set, and the macro series the report
 * already loaded, so a value can be traced back to the endpoint, the field, and the time it was
 * read. The report prints the model reference value as a range across scenarios, never as a
 * target price, until the out-of-sample backtest in the accepted design passes.
 */

import { NO_BACKTEST, validationLabel, type ValuationLabel, type ValuationValidation } from './backtest.ts'
import type { AssetMetric, ReportMetricKey } from './asset-context.ts'
import type { MacroSeries } from './macro.ts'

/** Growth a scenario path is clamped to, in percent, so one reading cannot define a whole path. */
const MIN_GROWTH_PERCENT = -20
const MAX_GROWTH_PERCENT = 60
/** Share of the gap to the terminal rate that survives each following year. */
const FADE_FACTOR = 0.6
/** Beta band the published figure is clamped to before it reaches the cost of equity. */
const MIN_BETA = 0.4
const MAX_BETA = 2.5
/** Effective tax rate ceiling, so one loss-making year cannot remove the tax shield entirely. */
const MAX_TAX_RATE_PERCENT = 40
/** Discount-rate step of the printed sensitivity table, in percentage points. */
const SENSITIVITY_STEP_PERCENT = 1
/** Accruals ratio and cash-conversion thresholds the credibility grade reads. */
const ACCRUALS_CAUTION_PERCENT = 3
const ACCRUALS_DISTRESS_PERCENT = 8
const CASH_CONVERSION_FLOOR = 0.6
const CASH_CONVERSION_TARGET = 1
/** Altman Z-score cutoffs: the published distress and safe zones. */
const ALTMAN_DISTRESS_Z = 1.81
const ALTMAN_SAFE_Z = 2.99

/** Analyst views and model structure the report reads; every one is a validated plugin config field. */
export interface ValuationParameters {
  /** Years projected at the faded growth rate before the fade period. */
  readonly explicitYears: number
  /** Years projected at the terminal rate before the terminal value. */
  readonly fadeYears: number
  /** Long-run growth the path converges to and the terminal value compounds at, in percent. */
  readonly terminalGrowthPercent: number
  /** Equity risk premium added to the risk-free rate, in percent. */
  readonly equityRiskPremiumPercent: number
  /** Risk-free rate used when no government yield loaded, in percent. */
  readonly riskFreeFallbackPercent: number
  /** Spread over the risk-free rate used when the filing carries no interest expense, in percent. */
  readonly creditSpreadPercent: number
  /** Tax rate used when the filing carries no usable pretax income, in percent. */
  readonly taxRateFallbackPercent: number
  /** Shift applied to the reported growth in the bear case, in percentage points. */
  readonly bearGrowthShiftPercent: number
  /** Shift applied to the reported growth in the bull case, in percentage points. */
  readonly bullGrowthShiftPercent: number
  /** Shift applied to the reported operating margin in the bear case, in percentage points. */
  readonly bearMarginShiftPercent: number
  /** Shift applied to the reported operating margin in the bull case, in percentage points. */
  readonly bullMarginShiftPercent: number
  /** Probability weight of the bear case. */
  readonly bearProbability: number
  /** Probability weight of the bull case. */
  readonly bullProbability: number
  /** Implied upside at or above which the pre-registered mapping accumulates. */
  readonly accumulateUpsidePercent: number
  /** Implied upside at or below which the pre-registered mapping reduces. */
  readonly reduceUpsidePercent: number
  /** Terminal-value share above which the report marks its own ceiling as breached, in percent. */
  readonly terminalValueCeilingPercent: number
}

/** Declared defaults; the plugin config schema carries the same values and overrides them from cordis.yml. */
export const VALUATION_PARAMETERS: ValuationParameters = {
  explicitYears: 3,
  fadeYears: 4,
  terminalGrowthPercent: 2.5,
  equityRiskPremiumPercent: 4.5,
  riskFreeFallbackPercent: 4,
  creditSpreadPercent: 1.2,
  taxRateFallbackPercent: 21,
  bearGrowthShiftPercent: -5,
  bullGrowthShiftPercent: 5,
  bearMarginShiftPercent: -2,
  bullMarginShiftPercent: 2,
  bearProbability: 0.25,
  bullProbability: 0.25,
  accumulateUpsidePercent: 15,
  reduceUpsidePercent: -10,
  terminalValueCeilingPercent: 75,
}

/** Every figure the model reads, as an explicit record the report prints beside its output. */
export interface ValuationInputs {
  /** Latest quoted price. */
  readonly price: number
  /** Filing period the statement figures belong to, such as `FY2025 10-K`. */
  readonly reportedPeriod: string
  readonly revenue?: number
  readonly grossProfit?: number
  readonly operatingIncome?: number
  readonly netIncome?: number
  readonly totalAssets?: number
  readonly currentAssets?: number
  readonly currentLiabilities?: number
  readonly liabilities?: number
  readonly equity?: number
  readonly totalDebt?: number
  readonly cash?: number
  readonly retainedEarnings?: number
  readonly operatingCashFlow?: number
  readonly capex?: number
  readonly freeCashFlow?: number
  readonly depreciation?: number
  readonly pretaxIncome?: number
  readonly taxExpense?: number
  readonly interestExpense?: number
  /** Trailing revenue growth the path starts from, in percent. */
  readonly revenueGrowthPercent?: number
  /** Published five-year beta. */
  readonly beta?: number
  /** Market capitalisation in the reporting currency. */
  readonly marketCap?: number
  /** Trailing twelve-month earnings per share. */
  readonly epsTtm?: number
  /** Newest risk-free rate, in percent. */
  readonly riskFreePercent?: number
  /** Date the risk-free rate was observed. */
  readonly riskFreeAsOf?: string
  /** Upstream that published the risk-free rate. */
  readonly riskFreeSource?: string
}

/** One ratio the financial-quality block quotes. */
export type ValuationRatioId =
  | 'grossMargin' | 'operatingMargin' | 'netMargin' | 'cashConversion' | 'fcfMargin'
  | 'accrualsRatio' | 'debtToEquity' | 'netDebtToEbitda' | 'currentRatio' | 'roic'

/** One computed ratio; `value` is absent when an input it needs was not obtained. */
export interface RatioReading {
  readonly id: ValuationRatioId
  readonly value?: number
  readonly unit: '%' | ''
}

/** Identifier of one cost-of-capital component. */
export type CostComponentId = 'riskFree' | 'equityRiskPremium' | 'beta' | 'costOfEquity' | 'costOfDebt'
  | 'taxRate' | 'afterTaxCostOfDebt' | 'equityWeight' | 'debtWeight' | 'wacc'

/** One cost-of-capital component with the source and time it came from. */
export interface CostComponent {
  readonly id: CostComponentId
  readonly value: number
  readonly unit: '%' | ''
  readonly source: string
  readonly asOf: string
}

/** One constructed cost of capital; the same rate feeds every method in the report. */
export interface CostOfCapital {
  readonly waccPercent: number
  readonly taxRatePercent: number
  readonly riskFreePercent: number
  readonly components: readonly CostComponent[]
}

/** Identifier of one earnings-quality signal. */
export type QualitySignalId = 'accrualsRatio' | 'cashConversion' | 'altmanZ'

/** One earnings-quality signal; `value` is absent when its inputs were not obtained. */
export interface QualitySignal {
  readonly id: QualitySignalId
  readonly value?: number
  readonly unit: '%' | ''
}

/** Credibility grade and the signals behind it. */
export interface EarningsQuality {
  /** Absent when no signal could be computed, which caps the action at watch. */
  readonly grade?: 'A' | 'B' | 'C' | 'D'
  readonly signals: readonly QualitySignal[]
}

/** One discounted cash-flow scenario. */
export interface ValuationScenario {
  readonly id: 'bear' | 'base' | 'bull'
  readonly probability: number
  readonly startingGrowthPercent: number
  readonly marginPercent: number
  readonly valuePerShare: number
}

/** Cash-flow value across scenarios, with the cross-checks the report prints beside it. */
export interface CashFlowValue {
  readonly scenarios: readonly ValuationScenario[]
  readonly weightedValuePerShare: number
  readonly lowValuePerShare: number
  readonly highValuePerShare: number
  /** No-growth value; it can sit below the net debt once the business cannot carry its debt. */
  readonly earningsPowerValuePerShare: number
  /** Growth the current price implies, solved through the same model. */
  readonly impliedGrowthPercent: number
  /** Set when the solved growth sits on the search bound. */
  readonly impliedGrowthAtBound: boolean
  /** Terminal-value share of enterprise value in the base scenario, in percent. */
  readonly terminalValueSharePercent: number
  /** Implied exit multiple in the base scenario. */
  readonly impliedExitMultiple: number
  readonly terminalValueCeilingBreached: boolean
  /** One discount-rate step; a step whose rate falls to the terminal growth carries no value. */
  readonly sensitivity: readonly { readonly waccPercent: number; readonly valuePerShare?: number }[]
}

/** Action the pre-registered mapping can state. */
export type ValuationAction = 'accumulate' | 'hold' | 'reduce' | 'watch' | 'avoid'

/** What the report tells a reader to do, produced by a pre-registered mapping. */
export interface ValuationVerdict {
  readonly action: ValuationAction
  /** Set when the credibility grade suppressed the valuation entirely. */
  readonly suppressed: boolean
}

/** One method's value band on the football-field range. */
export interface ValuationBand {
  readonly id: 'dcf' | 'epv' | 'sensitivity'
  readonly low: number
  readonly high: number
}

/**
 * Read the value bands the report renders side by side.
 * @param value - Scenario values the model produced.
 * @returns One band per method: the scenario range, the no-growth value, and the discount-rate range.
 */
export function buildValueBands(value: CashFlowValue): readonly ValuationBand[] {
  // The base scenario always prices, so the zero discount-rate step always carries a value.
  const sensitivities = value.sensitivity.flatMap(entry =>
    entry.valuePerShare === undefined ? [] : [entry.valuePerShare])
  return [
    { id: 'dcf', low: value.lowValuePerShare, high: value.highValuePerShare },
    { id: 'epv', low: value.earningsPowerValuePerShare, high: value.earningsPowerValuePerShare },
    { id: 'sensitivity', low: Math.min(...sensitivities), high: Math.max(...sensitivities) },
  ]
}

/** How one assumption reads in the report, and the default it is compared with. */
export interface ValuationAssumption {
  /** Config field that sets it, as it appears in cordis.yml and the settings panel. */
  readonly configField: string
  readonly value: number
  readonly defaultValue: number
  /** Unit the value is read in: a count of years, a percent, or a probability. */
  readonly unit: 'years' | 'percent' | 'probability'
}

/** Unit each parameter is read in, keyed by the parameter name. */
const ASSUMPTION_UNITS: Readonly<Record<keyof ValuationParameters, ValuationAssumption['unit']>> = {
  explicitYears: 'years',
  fadeYears: 'years',
  terminalGrowthPercent: 'percent',
  equityRiskPremiumPercent: 'percent',
  riskFreeFallbackPercent: 'percent',
  creditSpreadPercent: 'percent',
  taxRateFallbackPercent: 'percent',
  bearGrowthShiftPercent: 'percent',
  bullGrowthShiftPercent: 'percent',
  bearMarginShiftPercent: 'percent',
  bullMarginShiftPercent: 'percent',
  bearProbability: 'probability',
  bullProbability: 'probability',
  accumulateUpsidePercent: 'percent',
  reduceUpsidePercent: 'percent',
  terminalValueCeilingPercent: 'percent',
}

/**
 * Read every parameter the model ran with, beside the default it was compared against.
 * @param parameters - Parameters the report ran with.
 * @returns One row per parameter, naming the config field that sets it.
 */
export function buildAssumptions(parameters: ValuationParameters): readonly ValuationAssumption[] {
  return (Object.keys(ASSUMPTION_UNITS) as readonly (keyof ValuationParameters)[]).map(field => ({
    configField: `valuation${field.charAt(0).toUpperCase()}${field.slice(1)}`,
    value: parameters[field],
    defaultValue: VALUATION_PARAMETERS[field],
    unit: ASSUMPTION_UNITS[field],
  }))
}

/** One report's complete valuation read. */
export interface ValuationAnalysis {
  /** Parameters the model ran with, so the report can print every assumption it made. */
  readonly parameters: ValuationParameters
  readonly inputs: ValuationInputs
  readonly ratios: readonly RatioReading[]
  readonly cost?: CostOfCapital
  readonly quality: EarningsQuality
  readonly value?: CashFlowValue
  readonly verdict: ValuationVerdict
  /** Wording the recorded backtest evidence allows the report to use. */
  readonly label: ValuationLabel
  /** Recorded evidence behind that wording; the no-evidence record before a backtest runs. */
  readonly validation: ValuationValidation
}

/** Read one metric value by key, ignoring the comparable-table rows that carry a subject. */
function metricOf(metrics: readonly AssetMetric[], key: ReportMetricKey): number | undefined {
  return metrics.find(metric => metric.key === key && metric.subject === undefined)?.value
}

/** Clamp one value into a closed band. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** Guard a division so a zero denominator contributes no reading. */
function ratio(numerator: number | undefined, denominator: number | undefined): number | undefined {
  if (numerator === undefined || denominator === undefined || denominator === 0) return undefined
  return numerator / denominator
}

/**
 * Build the explicit input record from the loaded metrics and macro series.
 * @param metrics - Instrument metrics the report loaded.
 * @param macro - Macro series the report loaded; the ten-year yield supplies the risk-free rate.
 * @param price - Latest quoted price.
 * @returns The model inputs, carrying the filing period the statement figures belong to.
 */
export function buildValuationInputs(
  metrics: readonly AssetMetric[],
  macro: readonly MacroSeries[],
  price: number,
): ValuationInputs {
  const statement = (key: ReportMetricKey): number | undefined => metricOf(metrics, key)
  const reportedPeriod = metrics.find(metric => metric.key === 'reportedFinancials')?.text ?? ''
  const yieldSeries = macro.find(series => series.indicator === 'us-10y-yield')
  return {
    price,
    reportedPeriod,
    ...statement('revenue') === undefined ? {} : { revenue: statement('revenue') as number },
    ...statement('grossProfit') === undefined ? {} : { grossProfit: statement('grossProfit') as number },
    ...statement('operatingIncome') === undefined ? {} : { operatingIncome: statement('operatingIncome') as number },
    ...statement('netIncome') === undefined ? {} : { netIncome: statement('netIncome') as number },
    ...statement('totalAssets') === undefined ? {} : { totalAssets: statement('totalAssets') as number },
    ...statement('currentAssets') === undefined ? {} : { currentAssets: statement('currentAssets') as number },
    ...statement('currentLiabilities') === undefined ? {} : { currentLiabilities: statement('currentLiabilities') as number },
    ...statement('liabilities') === undefined ? {} : { liabilities: statement('liabilities') as number },
    ...statement('equity') === undefined ? {} : { equity: statement('equity') as number },
    ...statement('totalDebt') === undefined ? {} : { totalDebt: statement('totalDebt') as number },
    ...statement('cash') === undefined ? {} : { cash: statement('cash') as number },
    ...statement('retainedEarnings') === undefined ? {} : { retainedEarnings: statement('retainedEarnings') as number },
    ...statement('operatingCashFlow') === undefined ? {} : { operatingCashFlow: statement('operatingCashFlow') as number },
    ...statement('capex') === undefined ? {} : { capex: statement('capex') as number },
    ...statement('freeCashFlow') === undefined ? {} : { freeCashFlow: statement('freeCashFlow') as number },
    ...statement('depreciation') === undefined ? {} : { depreciation: statement('depreciation') as number },
    ...statement('pretaxIncome') === undefined ? {} : { pretaxIncome: statement('pretaxIncome') as number },
    ...statement('taxExpense') === undefined ? {} : { taxExpense: statement('taxExpense') as number },
    ...statement('interestExpense') === undefined ? {} : { interestExpense: statement('interestExpense') as number },
    ...metricOf(metrics, 'revenueGrowth') === undefined
      ? {}
      : { revenueGrowthPercent: metricOf(metrics, 'revenueGrowth') as number },
    ...metricOf(metrics, 'beta') === undefined ? {} : { beta: metricOf(metrics, 'beta') as number },
    ...metricOf(metrics, 'marketCap') === undefined ? {} : { marketCap: metricOf(metrics, 'marketCap') as number },
    ...metricOf(metrics, 'epsTtm') === undefined ? {} : { epsTtm: metricOf(metrics, 'epsTtm') as number },
    ...yieldSeries === undefined ? {} : {
      riskFreePercent: yieldSeries.latest.value,
      riskFreeAsOf: yieldSeries.latest.date,
      riskFreeSource: yieldSeries.source,
    },
  }
}

/**
 * Compute the ratio table the financial-quality block quotes.
 * @param inputs - Model inputs.
 * @param parameters - Resolved valuation parameters.
 * @returns One reading per ratio, each absent value carrying no number rather than a guess.
 */
export function buildRatios(inputs: ValuationInputs, parameters: ValuationParameters): readonly RatioReading[] {
  const ebitda = inputs.operatingIncome === undefined || inputs.depreciation === undefined
    ? undefined
    : inputs.operatingIncome + inputs.depreciation
  const netDebt = inputs.totalDebt === undefined || inputs.cash === undefined
    ? undefined
    : inputs.totalDebt - inputs.cash
  const investedCapital = inputs.totalDebt === undefined || inputs.equity === undefined
    ? undefined
    : inputs.totalDebt + inputs.equity
  const taxRate = effectiveTaxPercent(inputs, parameters.taxRateFallbackPercent)
  const readings: readonly (readonly [ValuationRatioId, number | undefined, '%' | ''])[] = [
    ['grossMargin', percentOf(inputs.grossProfit, inputs.revenue), '%'],
    ['operatingMargin', percentOf(inputs.operatingIncome, inputs.revenue), '%'],
    ['netMargin', percentOf(inputs.netIncome, inputs.revenue), '%'],
    ['fcfMargin', percentOf(inputs.freeCashFlow, inputs.revenue), '%'],
    ['accrualsRatio', percentOf(
      inputs.netIncome === undefined || inputs.operatingCashFlow === undefined
        ? undefined
        : inputs.netIncome - inputs.operatingCashFlow,
      inputs.totalAssets,
    ), '%'],
    ['cashConversion', ratio(inputs.operatingCashFlow, inputs.netIncome), ''],
    ['debtToEquity', percentOf(inputs.totalDebt, inputs.equity), '%'],
    ['netDebtToEbitda', ratio(netDebt, ebitda), ''],
    ['currentRatio', ratio(inputs.currentAssets, inputs.currentLiabilities), ''],
    ['roic', percentOf(
      inputs.operatingIncome === undefined ? undefined : inputs.operatingIncome * (1 - taxRate / 100),
      investedCapital,
    ), '%'],
  ]
  return readings.map(([id, value, unit]) => ({ id, ...value === undefined ? {} : { value }, unit }))
}

/** Percent of a denominator, or undefined when either figure is absent. */
function percentOf(numerator: number | undefined, denominator: number | undefined): number | undefined {
  const value = ratio(numerator, denominator)
  return value === undefined ? undefined : value * 100
}

/** Effective tax rate in percent, taken from the filing or the configured fallback. */
function effectiveTaxPercent(inputs: ValuationInputs, fallbackPercent: number): number {
  if (inputs.taxExpense === undefined || inputs.pretaxIncome === undefined || inputs.pretaxIncome <= 0) {
    return fallbackPercent
  }
  return clamp(inputs.taxExpense / inputs.pretaxIncome * 100, 0, MAX_TAX_RATE_PERCENT)
}

/**
 * Construct the one cost of capital the report uses.
 * @param inputs - Model inputs.
 * @param parameters - Resolved valuation parameters.
 * @returns The rate and its components, or undefined when no equity value was published.
 */
export function buildCostOfCapital(
  inputs: ValuationInputs,
  parameters: ValuationParameters,
): CostOfCapital | undefined {
  const marketCap = inputs.marketCap
  if (marketCap === undefined || marketCap <= 0) return undefined
  const riskFree = inputs.riskFreePercent ?? parameters.riskFreeFallbackPercent
  const riskFreeSource = inputs.riskFreeSource ?? 'assumption'
  const riskFreeAsOf = inputs.riskFreeAsOf ?? ''
  const beta = clamp(inputs.beta ?? 1, MIN_BETA, MAX_BETA)
  const costOfEquity = riskFree + beta * parameters.equityRiskPremiumPercent
  const taxRate = effectiveTaxPercent(inputs, parameters.taxRateFallbackPercent)
  const debt = inputs.totalDebt ?? 0
  const costOfDebt = inputs.interestExpense === undefined || debt <= 0
    ? riskFree + parameters.creditSpreadPercent
    : inputs.interestExpense / debt * 100
  const debtSource = inputs.interestExpense === undefined || debt <= 0 ? 'assumption' : 'finnhub'
  const afterTaxCostOfDebt = costOfDebt * (1 - taxRate / 100)
  const equityWeight = marketCap / (marketCap + debt)
  const debtWeight = 1 - equityWeight
  const waccPercent = equityWeight * costOfEquity + debtWeight * afterTaxCostOfDebt
  return {
    waccPercent,
    taxRatePercent: taxRate,
    riskFreePercent: riskFree,
    components: [
      { id: 'riskFree', value: riskFree, unit: '%', source: riskFreeSource, asOf: riskFreeAsOf },
      {
        id: 'equityRiskPremium',
        value: parameters.equityRiskPremiumPercent,
        unit: '%',
        source: 'assumption',
        asOf: '',
      },
      { id: 'beta', value: beta, unit: '', source: 'finnhub', asOf: '' },
      { id: 'costOfEquity', value: costOfEquity, unit: '%', source: 'model', asOf: '' },
      {
        id: 'costOfDebt',
        value: costOfDebt,
        unit: '%',
        source: debtSource,
        asOf: inputs.reportedPeriod,
      },
      {
        id: 'taxRate',
        value: taxRate,
        unit: '%',
        source: inputs.pretaxIncome === undefined ? 'assumption' : 'finnhub',
        asOf: inputs.reportedPeriod,
      },
      { id: 'afterTaxCostOfDebt', value: afterTaxCostOfDebt, unit: '%', source: 'model', asOf: '' },
      { id: 'equityWeight', value: equityWeight * 100, unit: '%', source: 'finnhub', asOf: '' },
      { id: 'debtWeight', value: debtWeight * 100, unit: '%', source: 'finnhub', asOf: inputs.reportedPeriod },
      { id: 'wacc', value: waccPercent, unit: '%', source: 'model', asOf: '' },
    ],
  }
}

/**
 * Score the earnings quality the loaded statements support.
 * @param inputs - Model inputs.
 * @returns The grade and every signal behind it; a signal without inputs carries no value.
 */
export function buildEarningsQuality(inputs: ValuationInputs): EarningsQuality {
  const accruals = percentOf(
    inputs.netIncome === undefined || inputs.operatingCashFlow === undefined
      ? undefined
      : inputs.netIncome - inputs.operatingCashFlow,
    inputs.totalAssets,
  )
  const cashConversion = ratio(inputs.operatingCashFlow, inputs.netIncome)
  const altmanZ = altmanScore(inputs)
  const signals: readonly QualitySignal[] = [
    { id: 'accrualsRatio', ...accruals === undefined ? {} : { value: accruals }, unit: '%' },
    { id: 'cashConversion', ...cashConversion === undefined ? {} : { value: cashConversion }, unit: '' },
    { id: 'altmanZ', ...altmanZ === undefined ? {} : { value: altmanZ }, unit: '' },
  ]
  const scored = signals.filter(signal => signal.value !== undefined)
  if (scored.length === 0) return { signals }
  if ((accruals !== undefined && accruals > ACCRUALS_DISTRESS_PERCENT)
    || (altmanZ !== undefined && altmanZ < ALTMAN_DISTRESS_Z)) {
    return { grade: 'D', signals }
  }
  if ((accruals !== undefined && accruals > ACCRUALS_CAUTION_PERCENT)
    || (cashConversion !== undefined && cashConversion < CASH_CONVERSION_FLOOR)
    || (altmanZ !== undefined && altmanZ < ALTMAN_SAFE_Z)) {
    return { grade: 'C', signals }
  }
  // Every signal already cleared the caution lines above; a set the statements fully support is the
  // only one graded A, and anything the filing left out stays B rather than reading as clean.
  if (accruals === undefined || altmanZ === undefined) return { grade: 'B', signals }
  return { grade: (cashConversion as number) >= CASH_CONVERSION_TARGET ? 'A' : 'B', signals }
}

/** Altman Z-score, computed when the balance sheet and income statement carry every term. */
function altmanScore(inputs: ValuationInputs): number | undefined {
  const { totalAssets, currentAssets, currentLiabilities, retainedEarnings, operatingIncome, marketCap, revenue } = inputs
  const liabilities = inputs.liabilities
  if (totalAssets === undefined || totalAssets <= 0) return undefined
  if (currentAssets === undefined || currentLiabilities === undefined
    || retainedEarnings === undefined || operatingIncome === undefined
    || marketCap === undefined || revenue === undefined
    || liabilities === undefined || liabilities <= 0) {
    return undefined
  }
  const workingCapital = currentAssets - currentLiabilities
  return 1.2 * (workingCapital / totalAssets)
    + 1.4 * (retainedEarnings / totalAssets)
    + 3.3 * (operatingIncome / totalAssets)
    + 0.6 * (marketCap / liabilities)
    + 1 * (revenue / totalAssets)
}

/** One scenario's discounted value and the terminal-value share behind it. */
interface ScenarioValue {
  readonly valuePerShare: number
  readonly terminalValueSharePercent: number
  readonly impliedExitMultiple: number
}

/** Every figure the projection needs, resolved once so the scenario math holds no hidden fallback. */
interface CashFlowBasis {
  readonly revenue: number
  readonly operatingIncome: number
  readonly marginPercent: number
  readonly afterTax: number
  readonly reinvestmentRate: number
  readonly shares: number
  readonly netDebt: number
  readonly terminalGrowthPercent: number
  readonly explicitYears: number
  readonly fadeYears: number
}

/**
 * Resolve the figures the projection reads, or report that the inputs cannot support one.
 * @param inputs - Model inputs.
 * @param parameters - Resolved valuation parameters.
 * @param cost - The one cost of capital the report uses.
 * @returns The resolved basis, or undefined when a required figure is missing or the path cannot work.
 */
function cashFlowBasis(
  inputs: ValuationInputs,
  parameters: ValuationParameters,
  cost: CostOfCapital,
): CashFlowBasis | undefined {
  const { revenue, operatingIncome, capex, depreciation, marketCap, price } = inputs
  if (revenue === undefined || revenue <= 0 || operatingIncome === undefined) return undefined
  if (capex === undefined || depreciation === undefined) return undefined
  if (marketCap === undefined || price <= 0) return undefined
  const marginPercent = operatingIncome / revenue * 100
  if (marginPercent <= 0) return undefined
  // The terminal value compounds forever, so the discount rate has to clear its growth rate.
  if (cost.waccPercent <= parameters.terminalGrowthPercent) return undefined
  const afterTax = 1 - cost.taxRatePercent / 100
  // The reported net investment is held against the profit it supported, so reinvestment scales with the path.
  const reinvestmentRate = (capex - depreciation) / (operatingIncome * afterTax)
  if (reinvestmentRate >= 1) return undefined
  return {
    revenue,
    operatingIncome,
    marginPercent,
    afterTax,
    reinvestmentRate,
    shares: marketCap / price,
    netDebt: (inputs.totalDebt ?? 0) - (inputs.cash ?? 0),
    // A terminal value cannot outgrow the risk-free rate the report already read.
    terminalGrowthPercent: Math.min(parameters.terminalGrowthPercent, inputs.riskFreePercent ?? parameters.terminalGrowthPercent),
    explicitYears: parameters.explicitYears,
    fadeYears: parameters.fadeYears,
  }
}

/**
 * Value one growth and margin path through an explicit forecast and a terminal value.
 * @param basis - Resolved projection basis.
 * @param waccPercent - Discount rate the report uses for every method.
 * @param startGrowthPercent - Growth the first explicit year applies, in percent.
 * @param marginPercent - Operating margin the path holds, in percent.
 * @returns The per-share value with its terminal-value share, or undefined when the path cannot be valued.
 */
function scenarioValue(
  basis: CashFlowBasis,
  waccPercent: number,
  startGrowthPercent: number,
  marginPercent: number,
): ScenarioValue | undefined {
  if (marginPercent <= 0) return undefined
  if (waccPercent <= basis.terminalGrowthPercent) return undefined
  const growth = clamp(startGrowthPercent, MIN_GROWTH_PERCENT, MAX_GROWTH_PERCENT)
  const totalYears = basis.explicitYears + basis.fadeYears
  let revenue = basis.revenue
  let lastCashFlow = 0
  let discounted = 0
  for (let year = 0; year < totalYears; year += 1) {
    const annualGrowth = year < basis.explicitYears
      ? basis.terminalGrowthPercent + (growth - basis.terminalGrowthPercent) * FADE_FACTOR ** year
      : basis.terminalGrowthPercent
    revenue *= 1 + annualGrowth / 100
    const profit = revenue * marginPercent / 100 * basis.afterTax
    lastCashFlow = profit * (1 - basis.reinvestmentRate)
    discounted += lastCashFlow / (1 + waccPercent / 100) ** (year + 1)
  }
  const terminalValue = lastCashFlow * (1 + basis.terminalGrowthPercent / 100)
    / ((waccPercent - basis.terminalGrowthPercent) / 100)
  const presentTerminal = terminalValue / (1 + waccPercent / 100) ** totalYears
  const enterprise = discounted + presentTerminal
  return {
    valuePerShare: (enterprise - basis.netDebt) / basis.shares,
    terminalValueSharePercent: presentTerminal / enterprise * 100,
    impliedExitMultiple: terminalValue / lastCashFlow,
  }
}

/**
 * Value the instrument across scenarios and print the cross-checks beside the range.
 * @param inputs - Model inputs.
 * @param parameters - Resolved valuation parameters.
 * @param cost - The one cost of capital the report uses.
 * @returns The scenario values, the reverse-DCF reading, and the discount-rate sensitivity grid.
 */
export function buildCashFlowValue(
  inputs: ValuationInputs,
  parameters: ValuationParameters,
  cost: CostOfCapital,
): CashFlowValue | undefined {
  const basis = cashFlowBasis(inputs, parameters, cost)
  if (basis === undefined) return undefined
  const reportedGrowth = inputs.revenueGrowthPercent ?? 0
  const paths: readonly (readonly ['bear' | 'base' | 'bull', number, number, number])[] = [
    ['bear', parameters.bearProbability, reportedGrowth + parameters.bearGrowthShiftPercent, parameters.bearMarginShiftPercent],
    ['base', 1 - parameters.bearProbability - parameters.bullProbability, reportedGrowth, 0],
    ['bull', parameters.bullProbability, reportedGrowth + parameters.bullGrowthShiftPercent, parameters.bullMarginShiftPercent],
  ]
  const computed: { readonly scenario: ValuationScenario; readonly terminal: ScenarioValue }[] = []
  for (const [id, probability, growth, marginShift] of paths) {
    const marginPercent = basis.marginPercent + marginShift
    const value = scenarioValue(basis, cost.waccPercent, growth, marginPercent)
    if (value === undefined) return undefined
    computed.push({
      scenario: { id, probability, startingGrowthPercent: growth, marginPercent, valuePerShare: value.valuePerShare },
      terminal: value,
    })
  }
  const scenarios = computed.map(entry => entry.scenario)
  const values = scenarios.map(scenario => scenario.valuePerShare)
  // A path whose value cannot cover its net debt carries nothing a reader could act on.
  if (values.some(value => value <= 0)) return undefined
  const base = computed.find(entry => entry.scenario.id === 'base') as { readonly terminal: ScenarioValue }
  const implied = solveImpliedGrowth(basis, cost.waccPercent, inputs.price)
  return {
    scenarios,
    weightedValuePerShare: scenarios.reduce(
      (sum, scenario) => sum + scenario.valuePerShare * scenario.probability,
      0,
    ),
    lowValuePerShare: Math.min(...values),
    highValuePerShare: Math.max(...values),
    earningsPowerValuePerShare: (basis.operatingIncome * basis.afterTax / (cost.waccPercent / 100) - basis.netDebt)
      / basis.shares,
    impliedGrowthPercent: implied.percent,
    impliedGrowthAtBound: implied.atBound,
    terminalValueSharePercent: base.terminal.terminalValueSharePercent,
    impliedExitMultiple: base.terminal.impliedExitMultiple,
    terminalValueCeilingBreached: base.terminal.terminalValueSharePercent > parameters.terminalValueCeilingPercent,
    sensitivity: [-SENSITIVITY_STEP_PERCENT, 0, SENSITIVITY_STEP_PERCENT].map((step) => {
      const value = scenarioValue(basis, cost.waccPercent + step, reportedGrowth, basis.marginPercent)
      return {
        waccPercent: cost.waccPercent + step,
        ...value === undefined ? {} : { valuePerShare: value.valuePerShare },
      }
    }),
  }
}

/**
 * Solve for the growth the current price implies, by bisecting the same model the scenarios run.
 * @param basis - Resolved projection basis.
 * @param waccPercent - Discount rate the report uses for every method.
 * @param price - Latest quoted price.
 * @returns The solved growth and whether it sits on the search bound.
 */
function solveImpliedGrowth(
  basis: CashFlowBasis,
  waccPercent: number,
  price: number,
): { readonly percent: number; readonly atBound: boolean } {
  const at = (growth: number): number =>
    (scenarioValue(basis, waccPercent, growth, basis.marginPercent) as ScenarioValue).valuePerShare
  const lowValue = at(MIN_GROWTH_PERCENT)
  const highValue = at(MAX_GROWTH_PERCENT)
  if (price <= lowValue) return { percent: MIN_GROWTH_PERCENT, atBound: true }
  if (price >= highValue) return { percent: MAX_GROWTH_PERCENT, atBound: true }
  let low = MIN_GROWTH_PERCENT
  let high = MAX_GROWTH_PERCENT
  for (let step = 0; step < 60; step += 1) {
    const middle = (low + high) / 2
    if (at(middle) < price) low = middle
    else high = middle
  }
  return { percent: (low + high) / 2, atBound: false }
}

/**
 * Map the range, the credibility grade, and the expectations gap onto one pre-registered action.
 * @param inputs - Model inputs.
 * @param parameters - Resolved valuation parameters.
 * @param quality - Credibility grade.
 * @param value - Scenario values, when a valuation ran.
 * @returns The action the report states; a D grade suppresses the valuation and an absent grade caps the action at watch.
 */
export function buildVerdict(
  inputs: ValuationInputs,
  parameters: ValuationParameters,
  quality: EarningsQuality,
  value: CashFlowValue | undefined,
): ValuationVerdict {
  if (quality.grade === 'D') return { action: 'avoid', suppressed: true }
  if (quality.grade === undefined || quality.grade === 'C') return { action: 'watch', suppressed: false }
  if (value === undefined) return { action: 'watch', suppressed: false }
  const upside = (value.weightedValuePerShare / inputs.price - 1) * 100
  if (upside >= parameters.accumulateUpsidePercent) return { action: 'accumulate', suppressed: false }
  if (upside <= parameters.reduceUpsidePercent) return { action: 'reduce', suppressed: false }
  return { action: 'hold', suppressed: false }
}

/**
 * Run the complete valuation read for one report.
 * @param inputs - Explicit input record built from the loaded metrics and macro series.
 * @param parameters - Resolved valuation parameters.
 * @param validation - Recorded backtest evidence, or the no-evidence record.
 * @returns Ratios, the cost of capital, the credibility grade, the scenario range, the action, and the wording.
 */
export function buildValuation(
  inputs: ValuationInputs,
  parameters: ValuationParameters,
  validation: ValuationValidation = NO_BACKTEST,
): ValuationAnalysis {
  const ratios = buildRatios(inputs, parameters)
  const cost = buildCostOfCapital(inputs, parameters)
  const quality = buildEarningsQuality(inputs)
  const value = cost === undefined || quality.grade === 'D'
    ? undefined
    : buildCashFlowValue(inputs, parameters, cost)
  return {
    parameters,
    inputs,
    ratios,
    ...cost === undefined ? {} : { cost },
    quality,
    ...value === undefined ? {} : { value },
    verdict: buildVerdict(inputs, parameters, quality, value),
    label: validationLabel(validation),
    validation,
  }
}
