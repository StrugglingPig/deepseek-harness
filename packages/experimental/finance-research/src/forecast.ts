/**
 * Deterministic earnings path the report projects.
 *
 * The model is ours, not a consensus feed: it anchors on the reported annual revenue, net income,
 * and trailing EPS, fades the trailing growth rate toward the terminal rate the valuation
 * configures, and holds the reported margin. The value itself comes from the cash-flow model in
 * `valuation.ts`; this module only produces the path the report prints beside it.
 */

/** Years the model projects. */
export const FORECAST_YEARS = 3
/** Share of the gap to the terminal rate that survives each following year. */
const GROWTH_FADE = 0.6
/** Growth is clamped to this band so one spike cannot define a whole path. */
const MIN_GROWTH_PERCENT = -20
const MAX_GROWTH_PERCENT = 60

/** One projected fiscal year. */
export interface ForecastYear {
  /** Calendar year the period ends in. */
  readonly year: number
  /** Revenue growth applied in this year, in percent. */
  readonly revenueGrowth: number
  /** Projected revenue, when a reported base exists. */
  readonly revenue?: number
  /** Projected net income, when revenue and a margin exist. */
  readonly netIncome?: number
  /** Projected earnings per share. */
  readonly eps: number
  /** EPS growth applied in this year, in percent. */
  readonly epsGrowth: number
}

/** Inputs the earnings path reads; every rate is a percentage. */
export interface EarningsForecastInput {
  /** Trailing twelve-month earnings per share. */
  readonly eps: number
  /** Trailing revenue growth, in percent. */
  readonly revenueGrowth: number
  /** Terminal growth the path converges to, in percent. */
  readonly terminalGrowthPercent: number
  /** Latest reported annual revenue. */
  readonly revenue?: number
  /** Latest reported annual net income. */
  readonly netIncome?: number
  /** Trailing net margin, in percent. */
  readonly netMargin?: number
  /** Calendar year the first projection covers. */
  readonly fromYear: number
}

/** Projected years, the trailing growth they start from, and the margin they hold. */
export interface EarningsForecast {
  readonly years: readonly ForecastYear[]
  /** Trailing growth the path starts from, in percent. */
  readonly startingGrowth: number
  /** Net margin the projection holds, in percent. */
  readonly marginPercent?: number
}

/** Clamp one value into a closed band. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * Project revenue, net income, and EPS along the faded growth path.
 * @param input - Reported bases and the terminal rate the path converges to.
 * @returns The path, or undefined when the reported EPS cannot support one.
 */
export function buildEarningsForecast(input: EarningsForecastInput): EarningsForecast | undefined {
  if (!Number.isFinite(input.eps) || input.eps <= 0) return undefined
  const terminal = input.terminalGrowthPercent
  const startingGrowth = clamp(input.revenueGrowth, MIN_GROWTH_PERCENT, MAX_GROWTH_PERCENT)
  const marginPercent = input.revenue === undefined || input.netIncome === undefined || input.revenue <= 0
    ? undefined
    : input.netMargin ?? input.netIncome / input.revenue * 100
  const years: ForecastYear[] = []
  let revenue = input.revenue
  let eps = input.eps
  for (let index = 0; index < FORECAST_YEARS; index += 1) {
    const growth = terminal + (startingGrowth - terminal) * GROWTH_FADE ** index
    revenue = revenue === undefined ? undefined : revenue * (1 + growth / 100)
    eps *= 1 + growth / 100
    years.push({
      year: input.fromYear + index + 1,
      revenueGrowth: growth,
      ...revenue === undefined ? {} : { revenue },
      ...revenue === undefined || marginPercent === undefined ? {} : { netIncome: revenue * marginPercent / 100 },
      eps,
      epsGrowth: growth,
    })
  }
  return {
    years,
    startingGrowth,
    ...marginPercent === undefined ? {} : { marginPercent },
  }
}
