/**
 * Out-of-sample scoring for the valuation model.
 *
 * A report may call its output a target price only after this module's decision rule passes on a
 * recorded backtest: the model has to beat the unchanged-price control on twelve-month absolute
 * error, across at least the sample floor, and the Diebold-Mariano test has to reject the null that
 * the two forecasts are equally accurate. Every input is reconstructed as of the as-of date by the
 * caller, so nothing here reads a figure the model could not have had at the time.
 */

/** Samples a backtest needs before its result may change the report's wording. */
const MIN_SAMPLES = 50
/** Significance level the Diebold-Mariano p-value has to clear. */
const SIGNIFICANCE = 0.05
/** One backtest observation: the model's value and the prices it is scored against. */
export interface BacktestObservation {
  /** Per-share value the model produced from the inputs available on the as-of date. */
  readonly valuePerShare: number
  /** Price on the as-of date, which is also the unchanged-price control's forecast. */
  readonly entryPrice: number
  /** Price one horizon later, the outcome both forecasts are scored against. */
  readonly exitPrice: number
}

/** Error and accuracy summary of one backtest. */
export interface BacktestSummary {
  readonly samples: number
  readonly horizonMonths: number
  /** Mean absolute error of the model's value, in percent of the realized price. */
  readonly modelMaePercent: number
  /** Mean absolute error of the unchanged-price control, in percent of the realized price. */
  readonly controlMaePercent: number
  /** Share of samples the model scored closer than the control. */
  readonly modelHitRate: number
  /** Mean signed error of the model, in percent; a negative figure means it undershot. */
  readonly modelBiasPercent: number
  /** Diebold-Mariano statistic on the squared-error loss differential, negative when the model wins. */
  readonly dmStatistic: number
  /** Two-sided p-value of that statistic under the standard normal approximation. */
  readonly dmPValue: number
}

/** Recorded evidence a report reads before it may call its output a target price. */
export interface ValuationValidation {
  /** Date the backtest ran, as `YYYY-MM-DD`. */
  readonly asOf: string
  /** Symbols the samples came from. */
  readonly symbols: number
  readonly horizonMonths: number
  readonly summary: BacktestSummary
}

/** Wording the report may use for the value it publishes. */
export type ValuationLabel = 'reference' | 'target'

/**
 * The no-evidence record a checkout carries before its first backtest run.
 * Zero samples cannot clear the floor, so the label stays a model reference value.
 */
export const NO_BACKTEST: ValuationValidation = {
  asOf: '',
  symbols: 0,
  horizonMonths: 12,
  summary: {
    samples: 0,
    horizonMonths: 12,
    modelMaePercent: 0,
    controlMaePercent: 0,
    modelHitRate: 0,
    modelBiasPercent: 0,
    dmStatistic: 0,
    dmPValue: 1,
  },
}

/** Standard normal cumulative distribution, through an error-function approximation. */
function normalCdf(value: number): number {
  return 0.5 * (1 + erf(Math.abs(value) / Math.SQRT2))
}

/** Error function of a non-negative argument, in the Abramowitz and Stegun 7.1.26 approximation. */
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * x)
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  return 1 - poly * Math.exp(-x * x)
}

/**
 * Score one backtest against the unchanged-price control.
 * @param observations - Reconstructed observations, one per symbol and as-of date.
 * @param horizonMonths - Forecast horizon the outcome prices are measured over.
 * @param overlapSteps - Sampling steps that overlapping horizons share, `1` for non-overlapping samples.
 * @returns The summary, or undefined when no observation was scored.
 */
export function summarizeBacktest(
  observations: readonly BacktestObservation[],
  horizonMonths: number,
  overlapSteps = 1,
): BacktestSummary | undefined {
  if (observations.length === 0) return undefined
  const modelErrors = observations.map(observation =>
    (observation.valuePerShare - observation.exitPrice) / observation.exitPrice * 100)
  const controlErrors = observations.map(observation =>
    (observation.entryPrice - observation.exitPrice) / observation.exitPrice * 100)
  const absolute = (series: readonly number[]): number =>
    series.reduce((sum, value) => sum + Math.abs(value), 0) / series.length
  const closer = modelErrors.filter((error, index) =>
    Math.abs(error) < Math.abs(controlErrors[index] as number)).length
  const differences = modelErrors.map((error, index) => error ** 2 - (controlErrors[index] as number) ** 2)
  const mean = differences.reduce((sum, value) => sum + value, 0) / differences.length
  const lags = Math.max(0, Math.min(overlapSteps - 1, differences.length - 1))
  let longRunVariance = differences.reduce((sum, value) => sum + (value - mean) ** 2, 0) / differences.length
  for (let lag = 1; lag <= lags; lag += 1) {
    let covariance = 0
    for (let index = lag; index < differences.length; index += 1) {
      covariance += ((differences[index] as number) - mean) * ((differences[index - lag] as number) - mean)
    }
    covariance /= differences.length
    longRunVariance += 2 * (1 - lag / overlapSteps) * covariance
  }
  const samples = differences.length
  const standardError = Math.sqrt(Math.max(longRunVariance, Number.EPSILON) / samples)
  // The Harvey-Leybourne-Newbold correction keeps the statistic usable at these sample sizes.
  const correction = Math.sqrt((samples + 1 - 2 * overlapSteps + overlapSteps * (overlapSteps - 1) / samples) / samples)
  const dmStatistic = mean / standardError * correction
  return {
    samples,
    horizonMonths,
    modelMaePercent: absolute(modelErrors),
    controlMaePercent: absolute(controlErrors),
    modelHitRate: closer / samples,
    modelBiasPercent: modelErrors.reduce((sum, value) => sum + value, 0) / samples,
    dmStatistic,
    dmPValue: Math.min(1, 2 * (1 - normalCdf(Math.abs(dmStatistic)))),
  }
}

/**
 * Decide which words the report may use for its value.
 * @param validation - Recorded backtest evidence, or the no-evidence record.
 * @returns `target` only when the sample floor, the error comparison, and the significance test all pass.
 */
export function validationLabel(validation: ValuationValidation): ValuationLabel {
  const { summary } = validation
  if (summary.samples === 0) return 'reference'
  if (summary.samples < MIN_SAMPLES) return 'reference'
  if (summary.modelMaePercent >= summary.controlMaePercent) return 'reference'
  if (summary.dmPValue >= SIGNIFICANCE) return 'reference'
  return 'target'
}
