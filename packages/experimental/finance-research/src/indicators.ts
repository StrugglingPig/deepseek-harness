/** Deterministic technical indicators and multi-indicator synthesis. */

import type {
  IndicatorAnalysis,
  IndicatorDirection,
  IndicatorSignal,
  IndicatorValues,
  MarketBar,
  MarketSnapshot,
} from './types.ts'

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Latest simple moving average, or undefined before the window is full.
 * @param values - Numeric series, oldest first.
 * @param period - Positive lookback length.
 * @returns The latest moving average, or undefined when the window is incomplete.
 */
export function latestSma(values: readonly number[], period: number): number | undefined {
  assertPositive(period, 'period')
  if (values.length < period) return undefined
  return average(values.slice(-period))
}

function emaSeries(values: readonly number[], period: number): (number | undefined)[] {
  assertPositive(period, 'period')
  const result: (number | undefined)[] = []
  let ema: number | undefined
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number
    if (ema === undefined) {
      if (index + 1 >= period) {
        ema = average(values.slice(0, period))
        result.push(ema)
      } else {
        result.push(undefined)
      }
    } else {
      const multiplier = 2 / (period + 1)
      ema = (value - ema) * multiplier + ema
      result.push(ema)
    }
  }
  return result
}

/**
 * Latest exponential moving average, or undefined before the window is full.
 * @param values - Numeric series, oldest first.
 * @param period - Positive lookback length.
 * @returns The latest exponential average, or undefined when the window is incomplete.
 */
export function latestEma(values: readonly number[], period: number): number | undefined {
  assertPositive(period, 'period')
  if (values.length < period) return undefined
  return emaSeries(values, period).at(-1)
}

/**
 * Latest RSI using the requested lookback.
 * @param values - Numeric series, oldest first.
 * @param period - Positive RSI lookback.
 * @returns The latest RSI value, or undefined when the window is incomplete.
 */
export function latestRsi(values: readonly number[], period: number): number | undefined {
  assertPositive(period, 'period')
  if (values.length < period + 1) return undefined
  let gain = 0
  let loss = 0
  for (let index = values.length - period; index < values.length; index += 1) {
    const current = values[index] as number
    const previous = values[index - 1] as number
    const change = current - previous
    if (change >= 0) gain += change
    else loss -= change
  }
  if (loss === 0) return gain === 0 ? 50 : 100
  if (gain === 0) return 0
  const relativeStrength = gain / loss
  return 100 - 100 / (1 + relativeStrength)
}

/**
 * Latest MACD line, signal line, and histogram.
 * @param values - Numeric series, oldest first.
 * @param fast - Positive fast EMA period.
 * @param slow - Positive slow EMA period, greater than `fast`.
 * @param signal - Positive signal EMA period.
 * @returns The latest MACD values, or undefined when the series is too short.
 */
export function latestMacd(
  values: readonly number[],
  fast = 12,
  slow = 26,
  signal = 9,
): { macd: number; signal: number; histogram: number } | undefined {
  assertPositive(fast, 'fast')
  assertPositive(slow, 'slow')
  assertPositive(signal, 'signal')
  if (fast >= slow) throw new Error('fast must be smaller than slow')
  const fastSeries = emaSeries(values, fast)
  const slowSeries = emaSeries(values, slow)
  const macdValues = values.flatMap((_, index) => {
    const fastValue = fastSeries[index]
    const slowValue = slowSeries[index]
    return fastValue === undefined || slowValue === undefined ? [] : [fastValue - slowValue]
  })
  if (macdValues.length < signal) return undefined
  const signalValue = latestEma(macdValues, signal) as number
  const macdValue = macdValues.at(-1) as number
  return { macd: macdValue, signal: signalValue, histogram: macdValue - signalValue }
}

/**
 * Latest average true range over normalized OHLCV bars.
 * @param bars - Normalized OHLCV bars, oldest first.
 * @param period - Positive ATR lookback.
 * @returns The latest ATR, or undefined when the bar window is incomplete.
 */
export function latestAtr(bars: readonly MarketBar[], period: number): number | undefined {
  assertPositive(period, 'period')
  if (bars.length < period + 1) return undefined
  const ranges: number[] = []
  for (let index = bars.length - period; index < bars.length; index += 1) {
    const current = bars[index] as MarketBar
    const previous = bars[index - 1] as MarketBar
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    ))
  }
  return average(ranges)
}

/**
 * Latest Bollinger middle, upper, and lower bands.
 * @param values - Numeric series, oldest first.
 * @param period - Positive lookback length.
 * @param multiplier - Positive standard-deviation multiplier.
 * @returns The latest bands, or undefined when the window is incomplete.
 */
export function latestBollinger(
  values: readonly number[],
  period = 20,
  multiplier = 2,
): { middle: number; upper: number; lower: number } | undefined {
  assertPositive(period, 'period')
  assertPositive(multiplier, 'multiplier')
  if (values.length < period) return undefined
  const window = values.slice(-period)
  const middle = average(window)
  const variance = average(window.map(value => (value - middle) ** 2))
  const deviation = Math.sqrt(variance)
  return {
    middle,
    upper: middle + multiplier * deviation,
    lower: middle - multiplier * deviation,
  }
}

/**
 * On-balance volume series aligned with the input bars.
 * @param bars - Normalized OHLCV bars, oldest first.
 * @returns The OBV value after each bar.
 */
export function obvSeries(bars: readonly MarketBar[]): number[] {
  const result: number[] = []
  let current = 0
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index] as MarketBar
    const previous = bars[index - 1]
    if (previous !== undefined) {
      if (bar.close > previous.close) current += bar.volume
      else if (bar.close < previous.close) current -= bar.volume
    }
    result.push(current)
  }
  return result
}

/**
 * Latest on-balance volume.
 * @param bars - Normalized OHLCV bars, oldest first.
 * @returns The latest OBV value, or zero for an empty series.
 */
export function latestObv(bars: readonly MarketBar[]): number {
  return obvSeries(bars).at(-1) ?? 0
}

/**
 * Map a faster-versus-slower comparison to a signal direction.
 * @param faster - Faster moving average.
 * @param slower - Slower moving average.
 * @returns Bullish, bearish, or neutral direction.
 */
export function trendDirection(faster: number, slower: number): IndicatorDirection {
  if (faster > slower) return 'bullish'
  if (faster < slower) return 'bearish'
  return 'neutral'
}

/**
 * Map RSI to a mean-reversion signal direction.
 * @param rsi - RSI value.
 * @returns Bullish, bearish, or neutral direction.
 */
export function rsiDirection(rsi: number): IndicatorDirection {
  if (rsi < 30) return 'bullish'
  if (rsi > 70) return 'bearish'
  return 'neutral'
}

/**
 * Map the MACD histogram to a signal direction.
 * @param histogram - MACD histogram value.
 * @returns Bullish, bearish, or neutral direction.
 */
export function macdDirection(histogram: number): IndicatorDirection {
  if (histogram > 0) return 'bullish'
  if (histogram < 0) return 'bearish'
  return 'neutral'
}

/**
 * Map a close outside the Bollinger bands to a mean-reversion signal direction.
 * @param close - Latest close.
 * @param upper - Upper Bollinger band.
 * @param lower - Lower Bollinger band.
 * @returns Bullish, bearish, or neutral direction.
 */
export function priceBandDirection(close: number, upper: number, lower: number): IndicatorDirection {
  if (close < lower) return 'bullish'
  if (close > upper) return 'bearish'
  return 'neutral'
}

/**
 * Map OBV versus its average to a participation signal direction.
 * @param obv - Latest OBV value.
 * @param obvAverage - Latest OBV moving average.
 * @returns Bullish, bearish, or neutral direction.
 */
export function volumeDirection(obv: number, obvAverage: number): IndicatorDirection {
  if (obv > obvAverage) return 'bullish'
  if (obv < obvAverage) return 'bearish'
  return 'neutral'
}

/**
 * Numeric contribution of one direction to the composite score.
 * @param direction - Indicator direction.
 * @returns `1` for bullish, `-1` for bearish, and `0` for neutral.
 */
export function directionValue(direction: IndicatorDirection): number {
  if (direction === 'bullish') return 1
  if (direction === 'bearish') return -1
  return 0
}

/**
 * Map a normalized composite score to a direction.
 * @param score - Weighted score in the range `-1..1`.
 * @returns Bullish, bearish, or neutral direction.
 */
export function compositeDirection(score: number): IndicatorDirection {
  if (score >= 0.2) return 'bullish'
  if (score <= -0.2) return 'bearish'
  return 'neutral'
}

/**
 * Compute one deterministic multi-indicator analysis from a market snapshot.
 * @param snapshot - Normalized market snapshot with at least 50 bars.
 * @returns Indicator values, signals, composite score, conflicts, and risk.
 */
export function buildIndicatorAnalysis(snapshot: MarketSnapshot): IndicatorAnalysis {
  if (snapshot.bars.length < 50) throw new Error('at least 50 bars are required')
  const closes = snapshot.bars.map(bar => bar.close)
  const macd = latestMacd(closes) as { macd: number; signal: number; histogram: number }
  const bollinger = latestBollinger(closes) as { middle: number; upper: number; lower: number }
  const indicators: IndicatorValues = {
    sma20: latestSma(closes, 20) as number,
    sma50: latestSma(closes, 50) as number,
    ema12: latestEma(closes, 12) as number,
    ema26: latestEma(closes, 26) as number,
    rsi14: latestRsi(closes, 14) as number,
    macd: macd.macd,
    macdSignal: macd.signal,
    macdHistogram: macd.histogram,
    atr14: latestAtr(snapshot.bars, 14) as number,
    bollingerMiddle: bollinger.middle,
    bollingerUpper: bollinger.upper,
    bollingerLower: bollinger.lower,
    obv: latestObv(snapshot.bars),
    obvSma20: latestSma(obvSeries(snapshot.bars), 20) as number,
  }
  const signals: IndicatorSignal[] = [
    {
      name: 'trend',
      direction: trendDirection(indicators.sma20, indicators.sma50),
      weight: 0.3,
      value: indicators.sma20 - indicators.sma50,
      rationale: 'SMA 20 versus SMA 50',
    },
    {
      name: 'momentum',
      direction: rsiDirection(indicators.rsi14),
      weight: 0.2,
      value: indicators.rsi14,
      rationale: 'RSI 14 mean-reversion bands',
    },
    {
      name: 'macd',
      direction: macdDirection(indicators.macdHistogram),
      weight: 0.25,
      value: indicators.macdHistogram,
      rationale: 'MACD histogram versus signal line',
    },
    {
      name: 'mean-reversion',
      direction: priceBandDirection(snapshot.quote.price, indicators.bollingerUpper, indicators.bollingerLower),
      weight: 0.1,
      value: indicators.sma20,
      rationale: 'SMA 20 versus Bollinger Bands',
    },
    {
      name: 'participation',
      direction: volumeDirection(indicators.obv, indicators.obvSma20),
      weight: 0.15,
      value: indicators.obv - indicators.obvSma20,
      rationale: 'OBV versus its 20-bar average',
    },
  ]
  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0)
  const score = signals.reduce(
    (sum, signal) => sum + directionValue(signal.direction) * signal.weight,
    0,
  ) / totalWeight
  const direction = compositeDirection(score)
  const conflicts = signals
    .filter(signal => signal.direction !== 'neutral' && signal.direction !== direction)
    .map(signal => signal.name)
  const confidence = Math.round(Math.min(100, Math.abs(score) * 100))
  const atrPercent = (indicators.atr14 / snapshot.quote.price) * 100
  return {
    symbol: snapshot.instrument.symbol,
    asOf: snapshot.asOf,
    indicators,
    signals,
    composite: {
      direction,
      score: Number(score.toFixed(4)),
      confidence,
      summary: `${direction} composite with ${signals.length - conflicts.length} aligned signals`,
    },
    conflicts,
    risk: { atrPercent: Number(atrPercent.toFixed(4)) },
  }
}
