/**
 * Deterministic earnings forecast and target price.
 *
 * The model is ours, not a consensus feed: it anchors on the reported annual
 * revenue, net income, and trailing EPS, fades the trailing growth rate toward
 * a long-run rate, holds the reported margin, and applies a fair multiple taken
 * from the peer set (or the instrument's own multiple when no peer answered).
 * Every number it uses is one the report already quotes, and every assumption
 * it makes is stated beside the table.
 */

/** Years the model projects. */
export const FORECAST_YEARS = 3
/** Long-run growth every path fades toward, in percent. */
const TERMINAL_GROWTH_PERCENT = 3
/** Share of the gap to the terminal rate that survives each following year. */
const GROWTH_FADE = 0.6
/** Growth is clamped to this band so one spike cannot define a whole path. */
const MIN_GROWTH_PERCENT = -20
const MAX_GROWTH_PERCENT = 60
/** Fair multiples are clamped to this band. */
const MIN_FAIR_MULTIPLE = 5
const MAX_FAIR_MULTIPLE = 60

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

/** Inputs the earnings model reads; every rate and multiple is a percentage or a ratio. */
export interface EarningsForecastInput {
  /** Latest quoted price. */
  readonly price: number
  /** Trailing twelve-month earnings per share. */
  readonly eps: number
  /** Trailing revenue growth, in percent. */
  readonly revenueGrowth: number
  /** Latest reported annual revenue. */
  readonly revenue?: number
  /** Latest reported annual net income. */
  readonly netIncome?: number
  /** Trailing net margin, in percent. */
  readonly netMargin?: number
  /** Trailing price-to-earnings multiple. */
  readonly peRatio?: number
  /** Multiple the peer set trades at, when peers answered. */
  readonly peerMedianPe?: number
  /** Industry multiple, used when no peer set answered. */
  readonly industryPe?: number
  /** Calendar year the first projection covers. */
  readonly fromYear: number
}

/** Projected years, the fair multiple that produced the target, and the target itself. */
export interface EarningsForecast {
  readonly years: readonly ForecastYear[]
  readonly fairMultiple: number
  /** Which input set the fair multiple, so the report can name the method. */
  readonly multipleSource: 'peers' | 'industry' | 'own'
  /** Trailing growth the path starts from, in percent. */
  readonly startingGrowth: number
  readonly targetPrice: number
  readonly upsidePercent: number
  /** Net margin the projection holds, in percent. */
  readonly marginPercent?: number
}

/** Clamp one value into a closed band. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * Project revenue, net income, and EPS, then derive a target price.
 * @param input - Reported bases and multiples the model anchors on.
 * @returns The forecast, or undefined when the inputs cannot support one.
 */
export function buildEarningsForecast(input: EarningsForecastInput): EarningsForecast | undefined {
  if (!Number.isFinite(input.eps) || input.eps <= 0) return undefined
  if (!Number.isFinite(input.price) || input.price <= 0) return undefined
  const multiple = input.peerMedianPe ?? input.industryPe ?? input.peRatio
  if (multiple === undefined || !Number.isFinite(multiple) || multiple <= 0) return undefined
  const multipleSource = input.peerMedianPe !== undefined
    ? 'peers' as const
    : input.industryPe !== undefined ? 'industry' as const : 'own' as const
  const startingGrowth = clamp(input.revenueGrowth, MIN_GROWTH_PERCENT, MAX_GROWTH_PERCENT)
  const marginPercent = input.revenue === undefined || input.netIncome === undefined || input.revenue <= 0
    ? undefined
    : input.netMargin ?? input.netIncome / input.revenue * 100
  const years: ForecastYear[] = []
  let revenue = input.revenue
  let eps = input.eps
  for (let index = 0; index < FORECAST_YEARS; index += 1) {
    const growth = TERMINAL_GROWTH_PERCENT
      + (startingGrowth - TERMINAL_GROWTH_PERCENT) * GROWTH_FADE ** index
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
  const fairMultiple = clamp(multiple, MIN_FAIR_MULTIPLE, MAX_FAIR_MULTIPLE)
  // The target pairs a twelve-month forward EPS with the fair multiple.
  const targetPrice = (years[0] as ForecastYear).eps * fairMultiple
  return {
    years,
    fairMultiple,
    multipleSource,
    startingGrowth,
    targetPrice,
    upsidePercent: (targetPrice / input.price - 1) * 100,
    ...marginPercent === undefined ? {} : { marginPercent },
  }
}
