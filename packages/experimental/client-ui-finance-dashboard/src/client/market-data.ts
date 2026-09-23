/** Browser-side dashboard market data, indicators, and chart geometry. */

import { barFromRow } from '@deepseek-ai/dsh-experimental-finance-research/shared'
import type {
  DashboardAsset,
  DashboardBar,
  DashboardInterval,
  DashboardMarketResponse,
  DashboardQuote,
  DashboardResearch,
  DashboardMacroEntry,
  DashboardEvent,
} from '@deepseek-ai/dsh-experimental-finance-research/shared'

export type {
  DashboardAsset,
  DashboardBar,
  DashboardInterval,
  DashboardMarketResponse,
  DashboardQuote,
  DashboardResearch,
  DashboardMacroEntry,
  DashboardEvent,
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
    const bar = barFromRow(row as readonly unknown[])
    return bar === undefined ? [] : [bar]
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
  return {
    asset,
    symbol,
    name,
    interval,
    source,
    asOf,
    bars,
    quote: { price, changePercent, volume, currency },
    ...value?.research === undefined ? {} : { research: value.research as DashboardResearch },
    ...value?.macro === undefined ? {} : { macro: value.macro as readonly DashboardMacroEntry[] },
    ...value?.events === undefined ? {} : { events: value.events as readonly DashboardEvent[] },
  }
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

/**
 * Bollinger band values around a moving average.
 * @param bars - Bars to measure.
 * @param period - Moving-average length.
 * @param multiplier - Band width in standard deviations.
 * @returns Middle, upper, and lower series.
 */
export function bollinger(
  bars: readonly DashboardBar[],
  period = 20,
  multiplier = 2,
): { readonly middle: IndicatorPoint[]; readonly upper: IndicatorPoint[]; readonly lower: IndicatorPoint[] } {
  const middle: IndicatorPoint[] = []
  const upper: IndicatorPoint[] = []
  const lower: IndicatorPoint[] = []
  if (period < 1) return { middle, upper, lower }
  bars.forEach((bar, index) => {
    if (index + 1 < period) return
    const window = bars.slice(index + 1 - period, index + 1)
    const mean = window.reduce((sum, item) => sum + item.close, 0) / period
    const variance = window.reduce((sum, item) => sum + (item.close - mean) ** 2, 0) / period
    const deviation = Math.sqrt(variance) * multiplier
    middle.push({ time: bar.time, value: mean })
    upper.push({ time: bar.time, value: mean + deviation })
    lower.push({ time: bar.time, value: mean - deviation })
  })
  return { middle, upper, lower }
}

/**
 * KDJ stochastic values.
 * @param bars - Bars to measure.
 * @param period - Lookback for the raw stochastic value.
 * @param kSmooth - Smoothing length for K.
 * @param dSmooth - Smoothing length for D.
 * @returns K, D, and J series.
 */
export function kdj(
  bars: readonly DashboardBar[],
  period = 9,
  kSmooth = 3,
  dSmooth = 3,
): { readonly k: IndicatorPoint[]; readonly d: IndicatorPoint[]; readonly j: IndicatorPoint[] } {
  const k: IndicatorPoint[] = []
  const d: IndicatorPoint[] = []
  const j: IndicatorPoint[] = []
  if (period < 1 || bars.length < period) return { k, d, j }
  let previousK = 50
  let previousD = 50
  for (let index = period - 1; index < bars.length; index += 1) {
    const window = bars.slice(index + 1 - period, index + 1)
    const highest = Math.max(...window.map(bar => bar.high))
    const lowest = Math.min(...window.map(bar => bar.low))
    const range = highest - lowest
    const close = (bars[index] as DashboardBar).close
    const rsv = range === 0 ? 50 : (close - lowest) / range * 100
    const currentK = previousK + (rsv - previousK) / kSmooth
    const currentD = previousD + (currentK - previousD) / dSmooth
    const time = (bars[index] as DashboardBar).time
    k.push({ time, value: currentK })
    d.push({ time, value: currentD })
    j.push({ time, value: 3 * currentK - 2 * currentD })
    previousK = currentK
    previousD = currentD
  }
  return { k, d, j }
}

/** One TD Sequential bar count, drawn above or below its candle. */
export interface TdSequentialCount {
  readonly time: number
  readonly count: number
  readonly side: 'buy' | 'sell'
}

/** Arithmetic mean of a non-empty window. */
function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** True range at one index; the first bar uses its own high-low span. */
function trueRange(bars: readonly DashboardBar[], index: number): number {
  const bar = bars[index] as DashboardBar
  if (index === 0) return bar.high - bar.low
  const previousClose = (bars[index - 1] as DashboardBar).close
  return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose))
}

/**
 * Wilder smoothing.
 * @param values - Input series.
 * @param period - Smoothing length.
 * @returns Smoothed values starting at index `period - 1`.
 */
function wilder(values: readonly number[], period: number): number[] {
  if (period < 1 || values.length < period) return []
  const smoothed = [mean(values.slice(0, period))]
  for (let index = period; index < values.length; index += 1) {
    const previous = smoothed[smoothed.length - 1] as number
    smoothed.push((previous * (period - 1) + (values[index] as number)) / period)
  }
  return smoothed
}

/**
 * Points built from a per-index value reader.
 * @param bars - Bars supplying the timeline.
 * @param from - First index that produces a point.
 * @param read - Value reader.
 * @returns One point per index from `from`.
 */
function seriesFrom(
  bars: readonly DashboardBar[],
  from: number,
  read: (index: number) => number,
): IndicatorPoint[] {
  const points: IndicatorPoint[] = []
  for (let index = Math.max(0, from); index < bars.length; index += 1) {
    points.push({ time: (bars[index] as DashboardBar).time, value: read(index) })
  }
  return points
}

/**
 * Parabolic SAR.
 * @param bars - Bars to measure.
 * @param step - Acceleration factor increment.
 * @param maxStep - Acceleration factor ceiling.
 * @returns One point per bar.
 */
export function sar(bars: readonly DashboardBar[], step = 0.02, maxStep = 0.2): IndicatorPoint[] {
  const first = bars[0]
  if (first === undefined) return []
  let rising = true
  let extreme = first.high
  let acceleration = step
  let value = first.low
  const points: IndicatorPoint[] = [{ time: first.time, value }]
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index] as DashboardBar
    const previous = bars[index - 1] as DashboardBar
    const prior = bars[index - 2] ?? previous
    value += acceleration * (extreme - value)
    if (rising) {
      // The stop may not enter the prior two bars' range; the reversal test
      // compares the current low against that clamped stop.
      value = Math.min(value, previous.low, prior.low)
      if (bar.low < value) {
        rising = false
        value = extreme
        extreme = bar.low
        acceleration = step
      } else if (bar.high > extreme) {
        extreme = bar.high
        acceleration = Math.min(maxStep, acceleration + step)
      }
    } else {
      value = Math.max(value, previous.high, prior.high)
      if (bar.high > value) {
        rising = true
        value = extreme
        extreme = bar.high
        acceleration = step
      } else if (bar.low < extreme) {
        extreme = bar.low
        acceleration = Math.min(maxStep, acceleration + step)
      }
    }
    points.push({ time: bar.time, value })
  }
  return points
}

/**
 * Volume-weighted average price over the loaded window.
 * @param bars - Bars to measure.
 * @returns One point per bar.
 */
export function vwap(bars: readonly DashboardBar[]): IndicatorPoint[] {
  let weighted = 0
  let volume = 0
  return bars.map((bar) => {
    const typical = (bar.high + bar.low + bar.close) / 3
    weighted += typical * bar.volume
    volume += bar.volume
    return { time: bar.time, value: volume === 0 ? typical : weighted / volume }
  })
}

/**
 * Williams %R on the inverted 0-100 scale used by mainland charts.
 * @param bars - Bars to measure.
 * @param period - Lookback length.
 * @returns One point per completed window.
 */
export function wr(bars: readonly DashboardBar[], period = 14): IndicatorPoint[] {
  if (period < 1) return []
  return seriesFrom(bars, period - 1, (index) => {
    const window = bars.slice(index + 1 - period, index + 1)
    const highest = Math.max(...window.map(bar => bar.high))
    const lowest = Math.min(...window.map(bar => bar.low))
    const range = highest - lowest
    return range === 0 ? 0 : (highest - (bars[index] as DashboardBar).close) / range * 100
  })
}

/**
 * Commodity channel index.
 * @param bars - Bars to measure.
 * @param period - Lookback length.
 * @returns One point per completed window.
 */
export function cci(bars: readonly DashboardBar[], period = 14): IndicatorPoint[] {
  if (period < 1) return []
  const typical = bars.map(bar => (bar.high + bar.low + bar.close) / 3)
  return seriesFrom(bars, period - 1, (index) => {
    const window = typical.slice(index + 1 - period, index + 1)
    const average = mean(window)
    const deviation = mean(window.map(value => Math.abs(value - average)))
    return deviation === 0 ? 0 : (typical[index] as number - average) / (0.015 * deviation)
  })
}

/**
 * Close-to-average deviation (BIAS).
 * @param bars - Bars to measure.
 * @param period - Moving-average length.
 * @returns One point per completed window.
 */
export function bias(bars: readonly DashboardBar[], period = 6): IndicatorPoint[] {
  if (period < 1) return []
  return seriesFrom(bars, period - 1, (index) => {
    const average = mean(bars.slice(index + 1 - period, index + 1).map(bar => bar.close))
    return average === 0 ? 0 : ((bars[index] as DashboardBar).close - average) / average * 100
  })
}

/**
 * On-balance volume.
 * @param bars - Bars to measure.
 * @returns One point per bar.
 */
export function obv(bars: readonly DashboardBar[]): IndicatorPoint[] {
  let total = 0
  return seriesFrom(bars, 0, (index) => {
    const bar = bars[index] as DashboardBar
    const previous = bars[index - 1]
    if (previous !== undefined) {
      if (bar.close > previous.close) total += bar.volume
      else if (bar.close < previous.close) total -= bar.volume
    }
    return total
  })
}

/**
 * Average true range.
 * @param bars - Bars to measure.
 * @param period - Smoothing length.
 * @returns One point per smoothed bar.
 */
export function atr(bars: readonly DashboardBar[], period = 14): IndicatorPoint[] {
  if (period < 1) return []
  const ranges = bars.map((_bar, index) => trueRange(bars, index))
  const smoothed = wilder(ranges, period)
  return smoothed.map((value, offset) => ({
    time: (bars[period - 1 + offset] as DashboardBar).time,
    value,
  }))
}

/**
 * Directional movement: +DI, -DI, and ADX.
 * @param bars - Bars to measure.
 * @param period - Smoothing length.
 * @returns The three directional series.
 */
export function dmi(
  bars: readonly DashboardBar[],
  period = 14,
): { readonly plusDi: IndicatorPoint[]; readonly minusDi: IndicatorPoint[]; readonly adx: IndicatorPoint[] } {
  const plusDi: IndicatorPoint[] = []
  const minusDi: IndicatorPoint[] = []
  const adx: IndicatorPoint[] = []
  if (period < 1 || bars.length <= period) return { plusDi, minusDi, adx }
  const plusMovement: number[] = []
  const minusMovement: number[] = []
  const ranges: number[] = []
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index] as DashboardBar
    const previous = bars[index - 1] as DashboardBar
    const up = bar.high - previous.high
    const down = previous.low - bar.low
    plusMovement.push(up > down && up > 0 ? up : 0)
    minusMovement.push(down > up && down > 0 ? down : 0)
    ranges.push(trueRange(bars, index))
  }
  const smoothedRange = wilder(ranges, period)
  const smoothedPlus = wilder(plusMovement, period)
  const smoothedMinus = wilder(minusMovement, period)
  const dx: number[] = []
  smoothedRange.forEach((range, offset) => {
    const plus = range === 0 ? 0 : (smoothedPlus[offset] as number) / range * 100
    const minus = range === 0 ? 0 : (smoothedMinus[offset] as number) / range * 100
    const index = period + offset
    plusDi.push({ time: (bars[index] as DashboardBar).time, value: plus })
    minusDi.push({ time: (bars[index] as DashboardBar).time, value: minus })
    dx.push(plus + minus === 0 ? 0 : Math.abs(plus - minus) / (plus + minus) * 100)
  })
  wilder(dx, period).forEach((value, offset) => {
    const index = period + period - 1 + offset
    adx.push({ time: (bars[index] as DashboardBar).time, value })
  })
  return { plusDi, minusDi, adx }
}

/**
 * TD Sequential setup counts. A buy count advances while a close sits below the
 * close {@link lookback} bars earlier; a sell count advances on the mirror
 * comparison. Each bar joins at most one of the two counts, and the count keeps
 * running until its comparison breaks.
 * @param bars - Bars to measure.
 * @param lookback - Comparison distance, four bars in the published setup.
 * @returns One count per bar that belongs to an active setup.
 */
export function tdSequential(bars: readonly DashboardBar[], lookback = 4): TdSequentialCount[] {
  if (lookback < 1) return []
  const counts: TdSequentialCount[] = []
  let buy = 0
  let sell = 0
  for (let index = lookback; index < bars.length; index += 1) {
    const bar = bars[index] as DashboardBar
    const reference = (bars[index - lookback] as DashboardBar).close
    if (bar.close < reference) {
      buy += 1
      sell = 0
    } else if (bar.close > reference) {
      sell += 1
      buy = 0
    } else {
      buy = 0
      sell = 0
    }
    if (buy > 0) counts.push({ time: bar.time, count: buy, side: 'buy' })
    else if (sell > 0) counts.push({ time: bar.time, count: sell, side: 'sell' })
  }
  return counts
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
