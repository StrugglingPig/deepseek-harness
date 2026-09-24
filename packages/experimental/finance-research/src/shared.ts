import type { ValuationAction, ValuationRatioId } from './valuation.ts'
/** Wire contract shared by the Host dashboard route and the browser dashboard panel. */

/** Absolute path of the dashboard market route on the authenticated API channel. */
export const DASHBOARD_MARKET_PATH = '/api/finance-dashboard/market'

/** Asset families supported by the dashboard. */
export type DashboardAsset = 'crypto' | 'stock' | 'us'

/** Chart intervals supported by the dashboard. */
export type DashboardInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w' | '1M'

/** One normalized dashboard candlestick. */
export interface DashboardBar {
  readonly time: number
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number
}

/** One normalized quote displayed above the chart. */
export interface DashboardQuote {
  readonly price: number
  readonly changePercent: number
  readonly volume: number
  readonly currency: string
}

/** Compact research summary the dashboard shows beside the chart. */
export interface DashboardResearch {
  /** Upstream the figures came from. */
  readonly source: string
  /** Filing period the statement figures belong to. */
  readonly reportedPeriod: string
  /** Wording the recorded backtest allows for the value. */
  readonly label: 'reference' | 'target'
  /** Credibility grade, or undefined when the statements supported none. */
  readonly grade: 'A' | 'B' | 'C' | 'D' | undefined
  /** Action the pre-registered mapping states, or undefined when no value ran. */
  readonly action: ValuationAction | undefined
  /** Next scheduled earnings date, or undefined when the calendar published none. */
  readonly nextEarnings: string | undefined
  /** Model reference range, or undefined when the model could not value the instrument. */
  readonly range: { readonly low: number; readonly high: number; readonly weighted: number } | undefined
  /** One reading per ratio; a ratio without a value prints as not obtained. */
  readonly ratios: readonly { readonly id: ValuationRatioId; readonly value: number | undefined }[]
}

/** One macro reading the dashboard strip prints. */
export interface DashboardMacroEntry {
  /** Catalog indicator id, which the client maps to its own label. */
  readonly id: string
  readonly value: number
  readonly unit: string
  /** Period the value describes, as published upstream. */
  readonly date: string
  readonly source: string
}

/** One upcoming event the dashboard calendar prints. */
export interface DashboardEvent {
  readonly date: string
  readonly label: string
  readonly source: string
}

/** One normalized dashboard answer: the bars, the quote, and any research summary beside them. */
export interface DashboardMarketResponse {
  readonly asset: DashboardAsset
  readonly symbol: string
  readonly name: string
  readonly interval: DashboardInterval
  readonly source: string
  readonly asOf: string
  readonly bars: readonly DashboardBar[]
  readonly quote: DashboardQuote
  /** Research summary for instruments the hosted model can read, absent otherwise. */
  readonly research?: DashboardResearch
  /** Macro strip the panel prints above the chart. */
  readonly macro?: readonly DashboardMacroEntry[]
  /** Upcoming event calendar the panel prints beside the macro strip. */
  readonly events?: readonly DashboardEvent[]
}

/**
 * Map one six-field OHLCV row onto a dashboard bar.
 * @param row - Upstream row carrying time, open, high, low, close, and volume.
 * @returns The bar, or undefined when any field is missing or non-numeric.
 */
export function barFromRow(row: readonly unknown[]): DashboardBar | undefined {
  if (row.length < 6) return undefined
  const values = row.slice(0, 6).map(Number)
  if (values.some(value => !Number.isFinite(value))) return undefined
  return {
    time: values[0] as number,
    open: values[1] as number,
    high: values[2] as number,
    low: values[3] as number,
    close: values[4] as number,
    volume: values[5] as number,
  }
}
