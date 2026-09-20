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

/** One dashboard market response. */
export interface DashboardMarketResponse {
  readonly asset: DashboardAsset
  readonly symbol: string
  readonly name: string
  readonly interval: DashboardInterval
  readonly source: string
  readonly asOf: string
  readonly bars: readonly DashboardBar[]
  readonly quote: DashboardQuote
}
