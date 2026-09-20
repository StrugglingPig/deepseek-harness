/** Browser-side dashboard market data, indicators, and chart geometry. */

import type {
  DashboardAsset,
  DashboardBar,
  DashboardInterval,
  DashboardMarketResponse,
  DashboardQuote,
} from '@deepseek-ai/dsh-experimental-finance-research/shared'

export type {
  DashboardAsset,
  DashboardBar,
  DashboardInterval,
  DashboardMarketResponse,
  DashboardQuote,
}

/** One normalized value in an indicator series. */
export interface IndicatorPoint {
  readonly time: number
  readonly value: number
}

const ASSETS: readonly DashboardAsset[] = ['crypto', 'stock', 'us']
const INTERVALS: readonly DashboardInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M']

const DEFAULT_SYMBOLS: Record<DashboardAsset, string> = {
  crypto: 'BTC',
  stock: '600519',
  us: 'AAPL',
}

const WATCHLISTS: Record<DashboardAsset, readonly string[]> = {
  crypto: ['BTC', 'ETH', 'SOL', 'BNB'],
  stock: ['600519', '000001', '300750', '601318'],
  us: ['AAPL', 'MSFT', 'NVDA', 'TSLA'],
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function finite(value: unknown): number | undefined {
  const result = Number(value)
  return Number.isFinite(result) ? result : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Whether one value is a supported asset family.
 * @param value - Candidate value.
 * @returns True when the value names a supported asset family.
 */
export function isDashboardAsset(value: unknown): value is DashboardAsset {
  return typeof value === 'string' && ASSETS.includes(value as DashboardAsset)
}

/**
 * Whether one value is a supported dashboard interval.
 * @param value - Candidate value.
 * @returns True when the value names a supported interval.
 */
export function isDashboardInterval(value: unknown): value is DashboardInterval {
  return typeof value === 'string' && INTERVALS.includes(value as DashboardInterval)
}

/**
 * Return the default symbol for an asset family.
 * @param asset - Asset family.
 * @returns The default symbol.
 */
export function defaultSymbol(asset: DashboardAsset): string {
  return DEFAULT_SYMBOLS[asset]
}

/**
 * Return the quick-select symbols for an asset family.
 * @param asset - Asset family.
 * @returns The quick-select symbols.
 */
export function watchlist(asset: DashboardAsset): readonly string[] {
  return WATCHLISTS[asset]
}

/**
 * Return intervals that make sense for an asset family.
 * @param asset - Asset family.
 * @returns The intervals offered for that family.
 */
export function intervalsFor(asset: DashboardAsset): readonly DashboardInterval[] {
  return asset === 'stock' ? ['1d', '1w', '1M'] : INTERVALS
}

/**
 * Normalize a user symbol to a Binance Spot pair.
 * @param symbol - User-entered symbol.
 * @returns The Binance Spot pair.
 */
export function toBinanceSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase()
  return normalized.endsWith('USDT') ? normalized : `${normalized}USDT`
}

/**
 * Parse Binance kline rows and discard malformed values.
 * @param payload - Upstream kline payload.
 * @returns Complete bars in ascending time order.
 */
export function parseKlines(payload: unknown): DashboardBar[] {
  if (!Array.isArray(payload)) return []
  return payload.flatMap((row) => {
    if (!Array.isArray(row) || row.length < 6) return []
    const values = (row as unknown[]).slice(0, 6).map(finite)
    if (values.some(value => value === undefined)) return []
    return [{
      time: values[0] as number,
      open: values[1] as number,
      high: values[2] as number,
      low: values[3] as number,
      close: values[4] as number,
      volume: values[5] as number,
    }]
  })
}

/**
 * Parse one Host dashboard payload.
 * @param payload - Host route response body.
 * @returns The normalized response, or undefined when fields are missing.
 */
export function parseDashboardMarket(payload: unknown): DashboardMarketResponse | undefined {
  const value = record(payload)
  const asset = value?.asset
  const interval = value?.interval
  const symbol = stringValue(value?.symbol)
  const name = stringValue(value?.name)
  const source = stringValue(value?.source)
  const asOf = stringValue(value?.asOf)
  const bars = Array.isArray(value?.bars) ? value.bars.flatMap((item) => {
    const bar = record(item)
    const time = finite(bar?.time)
    const open = finite(bar?.open)
    const high = finite(bar?.high)
    const low = finite(bar?.low)
    const close = finite(bar?.close)
    const volume = finite(bar?.volume)
    if (time === undefined || open === undefined || high === undefined || low === undefined
      || close === undefined || volume === undefined) return []
    return [{ time, open, high, low, close, volume }]
  }) : []
  const quote = record(value?.quote)
  const price = finite(quote?.price)
  const changePercent = finite(quote?.changePercent)
  const volume = finite(quote?.volume)
  const currency = stringValue(quote?.currency)
  if (!isDashboardAsset(asset) || !isDashboardInterval(interval) || symbol === undefined || name === undefined
    || source === undefined || asOf === undefined || bars.length === 0 || price === undefined
    || changePercent === undefined || volume === undefined || currency === undefined) return undefined
  return { asset, symbol, name, interval, source, asOf, bars, quote: { price, changePercent, volume, currency } }
}

/**
 * Simple moving average values over close prices.
 * @param bars - Bars to average.
 * @param period - Lookback length.
 * @returns One point per completed window.
 */
export function sma(bars: readonly DashboardBar[], period: number): IndicatorPoint[] {
  if (period < 1) return []
  return bars.flatMap((bar, index) => {
    if (index + 1 < period) return []
    const window = bars.slice(index + 1 - period, index + 1)
    return [{ time: bar.time, value: window.reduce((sum, item) => sum + item.close, 0) / period }]
  })
}

/**
 * Exponential moving average values over close prices.
 * @param bars - Bars to average.
 * @param period - Lookback length.
 * @returns One point per bar.
 */
export function ema(bars: readonly DashboardBar[], period: number): IndicatorPoint[] {
  if (period < 1 || bars.length === 0) return []
  const multiplier = 2 / (period + 1)
  let value = (bars[0] as DashboardBar).close
  return bars.map((bar, index) => {
    value = index === 0 ? bar.close : (bar.close - value) * multiplier + value
    return { time: bar.time, value }
  })
}

/**
 * Relative strength index values.
 * @param bars - Bars to measure.
 * @param period - Lookback length.
 * @returns One point per bar after the first window.
 */
export function rsi(bars: readonly DashboardBar[], period = 14): IndicatorPoint[] {
  if (bars.length <= period) return []
  let gains = 0
  let losses = 0
  for (let index = 1; index <= period; index += 1) {
    const delta = (bars[index] as DashboardBar).close - (bars[index - 1] as DashboardBar).close
    gains += Math.max(0, delta)
    losses += Math.max(0, -delta)
  }
  let averageGain = gains / period
  let averageLoss = losses / period
  const values: IndicatorPoint[] = []
  for (let index = period + 1; index < bars.length; index += 1) {
    const delta = (bars[index] as DashboardBar).close - (bars[index - 1] as DashboardBar).close
    averageGain = (averageGain * (period - 1) + Math.max(0, delta)) / period
    averageLoss = (averageLoss * (period - 1) + Math.max(0, -delta)) / period
    const strength = averageLoss === 0 ? Number.POSITIVE_INFINITY : averageGain / averageLoss
    values.push({
      time: (bars[index] as DashboardBar).time,
      value: averageLoss === 0 ? 100 : 100 - 100 / (1 + strength),
    })
  }
  return values
}

/**
 * MACD and signal-line values.
 * @param bars - Bars to measure.
 * @param fast - Fast EMA period.
 * @param slow - Slow EMA period.
 * @param signal - Signal EMA period.
 * @returns The MACD and signal series.
 */
export function macd(
  bars: readonly DashboardBar[],
  fast = 12,
  slow = 26,
  signal = 9,
): { readonly macd: IndicatorPoint[]; readonly signal: IndicatorPoint[] } {
  const fastValues = ema(bars, fast)
  const slowValues = ema(bars, slow)
  const macdValues = fastValues.map((item, index) => ({
    time: item.time,
    value: item.value - (slowValues[index] as IndicatorPoint).value,
  }))
  if (macdValues.length === 0) return { macd: [], signal: [] }
  const multiplier = 2 / (signal + 1)
  let value = (macdValues[0] as IndicatorPoint).value
  const signalValues = macdValues.map((item, index) => {
    value = index === 0 ? item.value : (item.value - value) * multiplier + value
    return { time: item.time, value }
  })
  return { macd: macdValues, signal: signalValues }
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(4)).toString()
}

/**
 * Build a compact SVG polyline from bar closes.
 * @param bars - Bars to plot.
 * @param width - Chart width.
 * @param height - Chart height.
 * @returns SVG path data.
 */
export function chartPath(bars: readonly DashboardBar[], width: number, height: number): string {
  if (bars.length === 0) return ''
  const closes = bars.map(bar => bar.close)
  const minimum = Math.min(...closes)
  const maximum = Math.max(...closes)
  const range = maximum - minimum
  const points = closes.map((close, index) => {
    const x = bars.length === 1 ? 0 : index / (bars.length - 1) * width
    const y = range === 0 ? height / 2 : (maximum - close) / range * height
    return `${formatCoordinate(x)} ${formatCoordinate(y)}`
  })
  return `M ${points[0]}${points.slice(1).map(point => ` L ${point}`).join('')}`
}

/**
 * Percent change between the first and latest close.
 * @param bars - Bars to compare.
 * @returns Percent change, or undefined when unavailable.
 */
export function priceChangePercent(bars: readonly DashboardBar[]): number | undefined {
  const first = bars[0]?.close
  const last = bars.at(-1)?.close
  if (first === undefined || last === undefined || first === 0) return undefined
  return (last - first) / first * 100
}
