/** Deterministic technical indicators and multi-indicator synthesis. */

import type {
  IndicatorAnalysis,
  IndicatorDirection,
  IndicatorSignal,
  IndicatorValues,
  MarketBar,
  MarketSnapshot,
  TdSetup,
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
 * True range of one bar against the prior close.
 * @param bar - Current bar.
 * @param previousClose - Close of the bar before it.
 * @returns The larger of the bar span and its gaps from the prior close.
 */
function trueRange(bar: MarketBar, previousClose: number): number {
  return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose))
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
  const start = bars.length - period
  return average(bars.slice(start).map((bar, offset) => trueRange(bar, (bars[start + offset - 1] as MarketBar).close)))
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
 * Latest KDJ stochastic values, smoothed through the recursive K and D averages.
 * @param bars - Normalized OHLCV bars, oldest first.
 * @param period - Positive lookback for the raw stochastic value.
 * @param kSmooth - Positive smoothing length for K.
 * @param dSmooth - Positive smoothing length for D.
 * @returns The latest K, D, and J values, or undefined when the window is incomplete.
 */
export function latestKdj(
  bars: readonly MarketBar[],
  period = 9,
  kSmooth = 3,
  dSmooth = 3,
): { k: number; d: number; j: number } | undefined {
  assertPositive(period, 'period')
  assertPositive(kSmooth, 'kSmooth')
  assertPositive(dSmooth, 'dSmooth')
  if (bars.length < period) return undefined
  let k = 50
  let d = 50
  for (let index = period - 1; index < bars.length; index += 1) {
    const window = bars.slice(index + 1 - period, index + 1)
    const highest = Math.max(...window.map(bar => bar.high))
    const lowest = Math.min(...window.map(bar => bar.low))
    const range = highest - lowest
    const close = (bars[index] as MarketBar).close
    const rsv = range === 0 ? 50 : (close - lowest) / range * 100
    k += (rsv - k) / kSmooth
    d += (k - d) / dSmooth
  }
  return { k, d, j: 3 * k - 2 * d }
}

/**
 * Latest TD Sequential setup count. A buy count advances while a close sits below the close
 * `lookback` bars earlier; a sell count advances on the mirror comparison. Each bar belongs to
 * at most one side, and a count restarts whenever its comparison breaks.
 * @param bars - Normalized OHLCV bars, oldest first.
 * @param lookback - Positive comparison distance; four bars in the published setup.
 * @returns The running side and count, or undefined when no comparison chain is active.
 */
export function latestTdSequential(
  bars: readonly MarketBar[],
  lookback = 4,
): { side: 'buy' | 'sell'; count: number } | undefined {
  assertPositive(lookback, 'lookback')
  let buy = 0
  let sell = 0
  for (let index = lookback; index < bars.length; index += 1) {
    const close = (bars[index] as MarketBar).close
    const reference = (bars[index - lookback] as MarketBar).close
    if (close < reference) {
      buy += 1
      sell = 0
    } else if (close > reference) {
      sell += 1
      buy = 0
    } else {
      buy = 0
      sell = 0
    }
  }
  if (buy > 0) return { side: 'buy', count: buy }
  if (sell > 0) return { side: 'sell', count: sell }
  return undefined
}

/**
 * Latest volume-weighted average price, accumulated over the loaded window.
 * @param bars - Normalized OHLCV bars, oldest first.
 * @returns The latest volume-weighted average of typical prices, the latest typical price when
 * no bar traded volume, or undefined for an empty series.
 */
export function latestVwap(bars: readonly MarketBar[]): number | undefined {
  const last = bars.at(-1)
  if (last === undefined) return undefined
  let weighted = 0
  let volume = 0
  for (const bar of bars) {
    weighted += (bar.high + bar.low + bar.close) / 3 * bar.volume
    volume += bar.volume
  }
  return volume === 0 ? (last.high + last.low + last.close) / 3 : weighted / volume
}

/**
 * Latest commodity channel index.
 * @param bars - Normalized OHLCV bars, oldest first.
 * @param period - Positive lookback length.
 * @returns The latest CCI, zero when the window has no typical-price deviation, or undefined when the window is incomplete.
 */
export function latestCci(bars: readonly MarketBar[], period = 14): number | undefined {
  assertPositive(period, 'period')
  if (bars.length < period) return undefined
  const typical = bars.slice(-period).map(bar => (bar.high + bar.low + bar.close) / 3)
  const middle = average(typical)
  const deviation = average(typical.map(value => Math.abs(value - middle)))
  const latest = typical.at(-1) as number
  return deviation === 0 ? 0 : (latest - middle) / (0.015 * deviation)
}

/**
 * Latest Williams %R on the inverted 0-100 scale used by mainland charts.
 * @param bars - Normalized OHLCV bars, oldest first.
 * @param period - Positive lookback length.
 * @returns The latest reading, 50 when the window has no range, or undefined when the window is incomplete.
 */
export function latestWr(bars: readonly MarketBar[], period = 14): number | undefined {
  assertPositive(period, 'period')
  if (bars.length < period) return undefined
  const window = bars.slice(-period)
  const highest = Math.max(...window.map(bar => bar.high))
  const lowest = Math.min(...window.map(bar => bar.low))
  const range = highest - lowest
  if (range === 0) return 50
  return (highest - (bars.at(-1) as MarketBar).close) / range * 100
}

/**
 * Latest BIAS, the close's percentage deviation from its moving average.
 * @param bars - Normalized OHLCV bars, oldest first.
 * @param period - Positive moving-average length.
 * @returns The latest deviation percentage, zero when the average price is zero, or undefined when the window is incomplete.
 */
export function latestBias(bars: readonly MarketBar[], period = 6): number | undefined {
  assertPositive(period, 'period')
  if (bars.length < period) return undefined
  const middle = average(bars.slice(-period).map(bar => bar.close))
  const close = (bars.at(-1) as MarketBar).close
  return middle === 0 ? 0 : (close - middle) / middle * 100
}

/**
 * Latest parabolic stop-and-reverse value.
 * @param bars - Normalized OHLCV bars, oldest first.
 * @param step - Positive acceleration-factor increment.
 * @param maxStep - Positive acceleration-factor ceiling.
 * @returns The latest SAR, or undefined for an empty series.
 */
export function latestSar(bars: readonly MarketBar[], step = 0.02, maxStep = 0.2): number | undefined {
  assertPositive(step, 'step')
  assertPositive(maxStep, 'maxStep')
  const first = bars[0]
  if (first === undefined) return undefined
  let rising = true
  let extreme = first.high
  let acceleration = step
  let value = first.low
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index] as MarketBar
    const previous = bars[index - 1] as MarketBar
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
  }
  return value
}

/**
 * Wilder smoothing; the first value is the mean of the opening window.
 * @param values - Input series, oldest first; the series must cover at least `period` values.
 * @param period - Positive smoothing length.
 * @returns One smoothed value per input from index `period - 1` onwards.
 */
function wilderSeries(values: readonly number[], period: number): number[] {
  const smoothed = [average(values.slice(0, period))]
  for (let index = period; index < values.length; index += 1) {
    const previous = smoothed[smoothed.length - 1] as number
    smoothed.push((previous * (period - 1) + (values[index] as number)) / period)
  }
  return smoothed
}

/**
 * Latest directional movement index values.
 * @param bars - Normalized OHLCV bars, oldest first.
 * @param period - Positive Wilder smoothing length.
 * @returns The latest +DI, -DI, and ADX, or undefined when the bars cannot carry both the directional window and its average.
 */
export function latestDmi(
  bars: readonly MarketBar[],
  period = 14,
): { plusDi: number; minusDi: number; adx: number } | undefined {
  assertPositive(period, 'period')
  if (bars.length < period * 2) return undefined
  const plusMovement: number[] = []
  const minusMovement: number[] = []
  const ranges: number[] = []
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index] as MarketBar
    const previous = bars[index - 1] as MarketBar
    const up = bar.high - previous.high
    const down = previous.low - bar.low
    plusMovement.push(up > down && up > 0 ? up : 0)
    minusMovement.push(down > up && down > 0 ? down : 0)
    ranges.push(trueRange(bar, previous.close))
  }
  const smoothedRange = wilderSeries(ranges, period)
  const smoothedPlus = wilderSeries(plusMovement, period)
  const smoothedMinus = wilderSeries(minusMovement, period)
  const directional = smoothedRange.map((range, offset) => {
    const plus = range === 0 ? 0 : (smoothedPlus[offset] as number) / range * 100
    const minus = range === 0 ? 0 : (smoothedMinus[offset] as number) / range * 100
    return { plus, minus, dx: plus + minus === 0 ? 0 : Math.abs(plus - minus) / (plus + minus) * 100 }
  })
  const smoothedDx = wilderSeries(directional.map(item => item.dx), period)
  const latest = directional.at(-1) as { plus: number; minus: number; dx: number }
  return { plusDi: latest.plus, minusDi: latest.minus, adx: smoothedDx.at(-1) as number }
}

/**
 * Map a leading value against the level it is compared with to a signal direction.
 * @param leading - Value read as bullish while it stays above `lagging`.
 * @param lagging - Level the leading value is compared with.
 * @returns Bullish when `leading` is above `lagging`, bearish when below, and neutral when equal.
 */
export function trendDirection(leading: number, lagging: number): IndicatorDirection {
  if (leading > lagging) return 'bullish'
  if (leading < lagging) return 'bearish'
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
 * Map an active TD Sequential setup to a signal direction.
 * @param side - Counted setup side.
 * @returns Bullish for a buy setup and bearish for a sell setup.
 */
export function setupDirection(side: 'buy' | 'sell'): IndicatorDirection {
  return side === 'buy' ? 'bullish' : 'bearish'
}

/**
 * Map the commodity channel index to a breakout signal direction.
 * @param cci - Latest CCI value.
 * @returns Bullish above the +100 band, bearish below the -100 band, and neutral inside.
 */
export function cciDirection(cci: number): IndicatorDirection {
  if (cci >= 100) return 'bullish'
  if (cci <= -100) return 'bearish'
  return 'neutral'
}

/**
 * Map Williams %R on the inverted 0-100 scale to a mean-reversion signal direction.
 * @param wr - Latest Williams %R value.
 * @returns Bullish in the oversold band, bearish in the overbought band, and neutral between.
 */
export function wrDirection(wr: number): IndicatorDirection {
  if (wr >= 80) return 'bullish'
  if (wr <= 20) return 'bearish'
  return 'neutral'
}

/**
 * Map BIAS to a mean-reversion signal direction.
 * @param bias - Latest percentage deviation from the moving average.
 * @returns Bearish above the average, bullish below it, and neutral on the average.
 */
export function biasDirection(bias: number): IndicatorDirection {
  if (bias > 0) return 'bearish'
  if (bias < 0) return 'bullish'
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
  const bars = snapshot.bars
  const price = snapshot.quote.price
  const closes = bars.map(bar => bar.close)
  const macd = latestMacd(closes) as { macd: number; signal: number; histogram: number }
  const bollinger = latestBollinger(closes) as { middle: number; upper: number; lower: number }
  const kdj = latestKdj(bars) as { k: number; d: number; j: number }
  const dmi = latestDmi(bars) as { plusDi: number; minusDi: number; adx: number }
  const tdSetup: TdSetup = latestTdSequential(bars) ?? { side: 'none', count: 0 }
  const indicators: IndicatorValues = {
    sma20: latestSma(closes, 20) as number,
    sma50: latestSma(closes, 50) as number,
    ema12: latestEma(closes, 12) as number,
    ema26: latestEma(closes, 26) as number,
    rsi14: latestRsi(closes, 14) as number,
    macd: macd.macd,
    macdSignal: macd.signal,
    macdHistogram: macd.histogram,
    atr14: latestAtr(bars, 14) as number,
    bollingerMiddle: bollinger.middle,
    bollingerUpper: bollinger.upper,
    bollingerLower: bollinger.lower,
    obv: latestObv(bars),
    obvSma20: latestSma(obvSeries(bars), 20) as number,
    kdjK: kdj.k,
    kdjD: kdj.d,
    kdjJ: kdj.j,
    tdSetup,
    vwap: latestVwap(bars) as number,
    cci14: latestCci(bars) as number,
    dmiPlus: dmi.plusDi,
    dmiMinus: dmi.minusDi,
    dmiAdx: dmi.adx,
    sar: latestSar(bars) as number,
    wr14: latestWr(bars) as number,
    bias6: latestBias(bars) as number,
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
      direction: priceBandDirection(price, indicators.bollingerUpper, indicators.bollingerLower),
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
    {
      name: 'kdj',
      direction: trendDirection(indicators.kdjK, indicators.kdjD),
      weight: 0.08,
      value: indicators.kdjJ,
      rationale: 'KDJ K versus D with the J reading',
    },
    {
      name: 'td-sequential',
      direction: tdSetup.side === 'none' ? 'neutral' : setupDirection(tdSetup.side),
      weight: 0.06,
      value: tdSetup.count,
      rationale: `TD Sequential ${tdSetup.side} setup count`,
    },
    {
      name: 'vwap',
      direction: trendDirection(price, indicators.vwap),
      weight: 0.12,
      value: price - indicators.vwap,
      rationale: 'Latest close versus VWAP',
    },
    {
      name: 'cci',
      direction: cciDirection(indicators.cci14),
      weight: 0.08,
      value: indicators.cci14,
      rationale: 'CCI 14 breakout bands',
    },
    {
      name: 'dmi',
      direction: trendDirection(indicators.dmiPlus, indicators.dmiMinus),
      weight: 0.12,
      value: indicators.dmiPlus - indicators.dmiMinus,
      rationale: 'DMI +DI versus -DI with ADX strength',
    },
    {
      name: 'sar',
      direction: trendDirection(price, indicators.sar),
      weight: 0.12,
      value: price - indicators.sar,
      rationale: 'Close versus the parabolic stop',
    },
    {
      name: 'williams-r',
      direction: wrDirection(indicators.wr14),
      weight: 0.06,
      value: indicators.wr14,
      rationale: 'Williams %R 14 mean-reversion bands',
    },
    {
      name: 'bias',
      direction: biasDirection(indicators.bias6),
      weight: 0.06,
      value: indicators.bias6,
      rationale: 'BIAS 6 deviation from the moving average',
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
  const atrPercent = (indicators.atr14 / price) * 100
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
