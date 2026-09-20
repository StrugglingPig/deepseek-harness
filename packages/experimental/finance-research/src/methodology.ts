/** Deterministic methodology coverage and investor-lens scaffolding. */

import { buildIndicatorAnalysis } from './indicators.ts'
import { REPORT_COPY, formatCopy, type LensCopy, type ReportCopy } from './report-copy.ts'
import type { ReportLanguage } from './report-language.ts'
import type { IndicatorAnalysis, MarketBar, MarketSnapshot } from './types.ts'

/** Strategy families exposed to research and reporting. */
export type MethodologyCategory =
  | 'trend'
  | 'momentum'
  | 'mean-reversion'
  | 'price-volume'
  | 'market-structure'
  | 'wave-cycle'
  | 'breakout'
  | 'statistical-arbitrage'
  | 'factor'
  | 'fundamental'
  | 'event-driven'
  | 'machine-learning'
  | 'microstructure'

/** Whether a methodology can run from the current snapshot. */
export type MethodologyStatus = 'available' | 'partial' | 'requires-input' | 'not-data-backed'

/** Direction produced by one methodology reading. */
export type MethodologyDirection = 'bullish' | 'bearish' | 'neutral' | 'insufficient-data'

/** One catalog entry from the investment methodology map. */
export interface MethodologyCatalogEntry {
  readonly id: string
  readonly name: string
  readonly category: MethodologyCategory
  readonly logic: string
  readonly quantRating: 1 | 2 | 3 | 4 | 5
  readonly status: MethodologyStatus
  readonly dataRequirements: readonly string[]
}

/** One deterministic reading for the current market snapshot. */
export interface MethodologyReading {
  readonly id: string
  readonly name: string
  readonly category: MethodologyCategory
  readonly status: MethodologyStatus
  readonly direction: MethodologyDirection
  readonly confidence: number
  readonly value?: number
  readonly note: string
}

/** One investor lens over the current evidence. */
export interface InvestorLens {
  readonly id: string
  readonly name: string
  readonly school: string
  readonly stance: MethodologyDirection | 'constructive' | 'cautious'
  readonly evidence: readonly string[]
  readonly questions: readonly string[]
  readonly risk: string
}

/** Complete methodology and investor-scaffold result. */
export interface MethodologyAnalysis {
  readonly readings: readonly MethodologyReading[]
  readonly catalog: readonly MethodologyCatalogEntry[]
  readonly investors: readonly InvestorLens[]
  readonly synthesisPrompt: string
}

const CATALOG: readonly MethodologyCatalogEntry[] = [
  { id: 'turtle', name: 'Turtle Trading', category: 'breakout', logic: 'Donchian breakout plus ATR stop and position sizing', quantRating: 5, status: 'partial', dataRequirements: ['daily OHLCV', 'account risk budget'] },
  { id: 'ma-trend', name: 'Moving-average trend', category: 'trend', logic: 'MA/EMA crossover and alignment', quantRating: 5, status: 'available', dataRequirements: ['daily OHLCV'] },
  { id: 'donchian', name: 'Donchian channel', category: 'breakout', logic: 'N-day high/low breakout', quantRating: 5, status: 'available', dataRequirements: ['daily OHLCV'] },
  { id: 'adx', name: 'ADX trend', category: 'trend', logic: 'Trend strength before directional follow-through', quantRating: 5, status: 'available', dataRequirements: ['OHLC'] },
  { id: 'supertrend', name: 'SuperTrend', category: 'trend', logic: 'ATR bands and trend direction', quantRating: 5, status: 'available', dataRequirements: ['OHLC'] },
  { id: 'momentum', name: 'Momentum', category: 'momentum', logic: 'Buy recent relative strength', quantRating: 5, status: 'available', dataRequirements: ['price history'] },
  { id: 'roc', name: 'ROC', category: 'momentum', logic: 'Rate of change over a lookback', quantRating: 5, status: 'available', dataRequirements: ['price history'] },
  { id: 'macd', name: 'MACD', category: 'momentum', logic: 'Trend and momentum via EMA differences', quantRating: 5, status: 'available', dataRequirements: ['price history'] },
  { id: 'rsi', name: 'RSI', category: 'momentum', logic: 'Relative strength and overbought/oversold state', quantRating: 5, status: 'available', dataRequirements: ['price history'] },
  { id: 'relative-strength', name: 'Relative strength', category: 'momentum', logic: 'Strength versus benchmark and peers', quantRating: 5, status: 'requires-input', dataRequirements: ['benchmark series', 'peer universe'] },
  { id: 'rsi-reversion', name: 'RSI mean reversion', category: 'mean-reversion', logic: 'Extreme RSI reversal', quantRating: 5, status: 'available', dataRequirements: ['price history'] },
  { id: 'bollinger', name: 'Bollinger mean reversion', category: 'mean-reversion', logic: 'Deviation from a moving mean', quantRating: 5, status: 'available', dataRequirements: ['price history'] },
  { id: 'kdj', name: 'KDJ', category: 'mean-reversion', logic: 'Stochastic overbought/oversold state', quantRating: 5, status: 'available', dataRequirements: ['OHLC'] },
  { id: 'grid', name: 'Grid', category: 'mean-reversion', logic: 'Trade a configured price range', quantRating: 5, status: 'requires-input', dataRequirements: ['range bounds', 'grid step', 'capital budget'] },
  { id: 'pairs', name: 'Pairs trading', category: 'statistical-arbitrage', logic: 'Cointegration and spread reversion', quantRating: 5, status: 'requires-input', dataRequirements: ['paired asset history'] },
  { id: 'volume-price', name: 'Volume-price relation', category: 'price-volume', logic: 'Volume confirms or rejects price behavior', quantRating: 4, status: 'available', dataRequirements: ['OHLCV'] },
  { id: 'obv', name: 'OBV', category: 'price-volume', logic: 'Cumulative volume trend', quantRating: 5, status: 'available', dataRequirements: ['OHLCV'] },
  { id: 'vwap', name: 'VWAP', category: 'price-volume', logic: 'Volume-weighted average price', quantRating: 5, status: 'partial', dataRequirements: ['intraday volume and price'] },
  { id: 'volume-profile', name: 'Volume Profile', category: 'price-volume', logic: 'Volume distribution and value area', quantRating: 4, status: 'partial', dataRequirements: ['OHLCV', 'intraday distribution'] },
  { id: 'chan', name: 'Chan Theory', category: 'market-structure', logic: 'Fractal, pen, segment, center, and divergence', quantRating: 3, status: 'partial', dataRequirements: ['OHLC', 'structural validation'] },
  { id: 'dow', name: 'Dow Theory', category: 'market-structure', logic: 'Higher highs, higher lows, and trend structure', quantRating: 4, status: 'partial', dataRequirements: ['OHLC', 'swing confirmation'] },
  { id: 'price-action', name: 'Price Action', category: 'market-structure', logic: 'Candles, structure, support, and resistance', quantRating: 4, status: 'partial', dataRequirements: ['OHLC', 'discretionary confirmation'] },
  { id: 'wyckoff', name: 'Wyckoff', category: 'market-structure', logic: 'Accumulation, distribution, supply, and demand', quantRating: 3, status: 'not-data-backed', dataRequirements: ['volume footprint', 'event context'] },
  { id: 'elliott', name: 'Elliott Wave', category: 'wave-cycle', logic: 'Wave counts and structure', quantRating: 2, status: 'not-data-backed', dataRequirements: ['validated wave labeling'] },
  { id: 'cycle', name: 'Cycle analysis', category: 'wave-cycle', logic: 'Time-cycle resonance', quantRating: 3, status: 'partial', dataRequirements: ['sufficient history', 'cycle validation'] },
  { id: 'opening-range', name: 'Opening Range Breakout', category: 'breakout', logic: 'Break of the opening range', quantRating: 5, status: 'requires-input', dataRequirements: ['intraday bars', 'session definition'] },
  { id: 'volatility-breakout', name: 'Volatility Breakout', category: 'breakout', logic: 'Range expansion relative to ATR', quantRating: 5, status: 'available', dataRequirements: ['OHLCV'] },
  { id: 'market-neutral', name: 'Market Neutral', category: 'statistical-arbitrage', logic: 'Long/short hedge construction', quantRating: 5, status: 'requires-input', dataRequirements: ['multi-asset universe', 'hedge ratio'] },
  { id: 'pca-arb', name: 'PCA arbitrage', category: 'statistical-arbitrage', logic: 'Factor and principal-component deviation', quantRating: 4, status: 'requires-input', dataRequirements: ['cross-sectional panel'] },
  { id: 'value', name: 'Value factor', category: 'factor', logic: 'PE, PB, FCF, and valuation spread', quantRating: 5, status: 'requires-input', dataRequirements: ['fundamental data'] },
  { id: 'factor-momentum', name: 'Momentum factor', category: 'factor', logic: 'Cross-sectional momentum', quantRating: 5, status: 'requires-input', dataRequirements: ['asset universe'] },
  { id: 'quality', name: 'Quality factor', category: 'factor', logic: 'ROE, earnings quality, and leverage', quantRating: 5, status: 'requires-input', dataRequirements: ['financial statements'] },
  { id: 'low-vol', name: 'Low-volatility factor', category: 'factor', logic: 'Low-volatility anomaly', quantRating: 5, status: 'requires-input', dataRequirements: ['cross-sectional history'] },
  { id: 'size', name: 'Size factor', category: 'factor', logic: 'Small-cap premium', quantRating: 5, status: 'requires-input', dataRequirements: ['market-cap universe'] },
  { id: 'multi-factor', name: 'Multi-factor', category: 'factor', logic: 'Value, momentum, and quality combination', quantRating: 5, status: 'requires-input', dataRequirements: ['fundamental and price panel'] },
  { id: 'dcf', name: 'DCF', category: 'fundamental', logic: 'Intrinsic value from projected cash flows', quantRating: 3, status: 'requires-input', dataRequirements: ['cash-flow forecasts', 'discount rate'] },
  { id: 'financial-quality', name: 'Financial quality', category: 'fundamental', logic: 'Profitability, cash flow, and leverage', quantRating: 4, status: 'requires-input', dataRequirements: ['financial statements'] },
  { id: 'industry-rotation', name: 'Industry rotation', category: 'fundamental', logic: 'Macro and industry-cycle allocation', quantRating: 4, status: 'requires-input', dataRequirements: ['macro and industry data'] },
  { id: 'earnings', name: 'Earnings strategy', category: 'event-driven', logic: 'Earnings surprise and revision', quantRating: 4, status: 'requires-input', dataRequirements: ['estimates', 'events'] },
  { id: 'dividend-buyback', name: 'Dividend and buyback', category: 'event-driven', logic: 'Corporate action return', quantRating: 4, status: 'requires-input', dataRequirements: ['corporate actions'] },
  { id: 'merger-arb', name: 'Merger arbitrage', category: 'event-driven', logic: 'M&A spread', quantRating: 4, status: 'requires-input', dataRequirements: ['deal terms', 'probability'] },
  { id: 'index-rebalance', name: 'Index rebalance', category: 'event-driven', logic: 'Constituent-change flow', quantRating: 4, status: 'requires-input', dataRequirements: ['index events'] },
  { id: 'forest', name: 'Random Forest', category: 'machine-learning', logic: 'Feature-based classification or regression', quantRating: 4, status: 'requires-input', dataRequirements: ['features', 'labels', 'validation'] },
  { id: 'boosted-trees', name: 'XGBoost / LightGBM', category: 'machine-learning', logic: 'Non-linear tabular prediction', quantRating: 5, status: 'requires-input', dataRequirements: ['features', 'labels', 'validation'] },
  { id: 'sequence-model', name: 'LSTM / Transformer', category: 'machine-learning', logic: 'Sequence prediction', quantRating: 3, status: 'requires-input', dataRequirements: ['long sequence history', 'validation'] },
  { id: 'reinforcement', name: 'Reinforcement learning', category: 'machine-learning', logic: 'Policy and position decisions', quantRating: 2, status: 'requires-input', dataRequirements: ['simulator', 'reward design'] },
  { id: 'market-making', name: 'Market making', category: 'microstructure', logic: 'Bid/ask spread capture', quantRating: 5, status: 'requires-input', dataRequirements: ['order book', 'queue data', 'latency'] },
  { id: 'order-flow', name: 'Order Flow', category: 'microstructure', logic: 'Aggressive buy/sell pressure', quantRating: 5, status: 'requires-input', dataRequirements: ['tick and order-flow data'] },
  { id: 'execution', name: 'VWAP / TWAP execution', category: 'microstructure', logic: 'Execution scheduling', quantRating: 5, status: 'requires-input', dataRequirements: ['order size', 'market impact model'] },
  { id: 'order-book', name: 'Order-book imbalance', category: 'microstructure', logic: 'Book pressure and depth', quantRating: 5, status: 'requires-input', dataRequirements: ['level-2 order book'] },
]

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

function standardDeviation(values: readonly number[]): number {
  const mean = average(values)
  return Math.sqrt(average(values.map(value => (value - mean) ** 2)))
}

function barDirection(first: number, last: number): MethodologyDirection {
  if (last > first) return 'bullish'
  if (last < first) return 'bearish'
  return 'neutral'
}

function swingPoints(bars: readonly MarketBar[], window = 2): { readonly highs: number[]; readonly lows: number[] } {
  const highs: number[] = []
  const lows: number[] = []
  for (let index = window; index < bars.length - window; index += 1) {
    const center = bars[index] as MarketBar
    const slice = bars.slice(index - window, index + window + 1)
    if (slice.every(bar => bar.high <= center.high)) highs.push(center.high)
    if (slice.every(bar => bar.low >= center.low)) lows.push(center.low)
  }
  return { highs, lows }
}

function adx(bars: readonly MarketBar[], period = 14): { readonly adx: number; readonly plus: number; readonly minus: number } {
  const plus: number[] = []
  const minus: number[] = []
  const ranges: number[] = []
  for (let index = 1; index < bars.length; index += 1) {
    const current = bars[index] as MarketBar
    const previous = bars[index - 1] as MarketBar
    const up = current.high - previous.high
    const down = previous.low - current.low
    plus.push(up > down && up > 0 ? up : 0)
    minus.push(down > up && down > 0 ? down : 0)
    ranges.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)))
  }
  const atr = average(ranges.slice(-period))
  if (atr === 0) return { adx: 0, plus: 0, minus: 0 }
  const plusDi = average(plus.slice(-period)) / atr * 100
  const minusDi = average(minus.slice(-period)) / atr * 100
  const dx = Math.abs(plusDi - minusDi) / Math.max(1, plusDi + minusDi) * 100
  return { adx: dx, plus: plusDi, minus: minusDi }
}

function superTrend(bars: readonly MarketBar[]): MethodologyDirection {
  return barDirection((bars.at(-2) as MarketBar).close, (bars.at(-1) as MarketBar).close)
}

function kdj(bars: readonly MarketBar[], period = 9): { readonly k: number; readonly d: number; readonly j: number } {
  let k = 50
  let d = 50
  for (let index = period - 1; index < bars.length; index += 1) {
    const slice = bars.slice(index - period + 1, index + 1)
    const low = Math.min(...slice.map(bar => bar.low))
    const high = Math.max(...slice.map(bar => bar.high))
    const rsv = high === low ? 50 : ((bars[index] as MarketBar).close - low) / (high - low) * 100
    k = 2 / 3 * k + 1 / 3 * rsv
    d = 2 / 3 * d + 1 / 3 * k
  }
  return { k, d, j: 3 * k - 2 * d }
}

function vwap(bars: readonly MarketBar[], period = 20): number {
  const slice = bars.slice(-period)
  const totalVolume = slice.reduce((sum, bar) => sum + bar.volume, 0)
  return slice.reduce((sum, bar) => sum + ((bar.high + bar.low + bar.close) / 3) * bar.volume, 0) / Math.max(1, totalVolume)
}

function volumeProfile(
  bars: readonly MarketBar[],
  bins = 12,
): { readonly poc: number; readonly valueAreaLow: number; readonly valueAreaHigh: number } {
  const low = Math.min(...bars.map(bar => bar.low))
  const high = Math.max(...bars.map(bar => bar.high))
  if (high === low) return { poc: high, valueAreaLow: low, valueAreaHigh: high }
  const step = (high - low) / bins
  const buckets = Array.from({ length: bins }, () => 0)
  for (const bar of bars) {
    const index = Math.min(bins - 1, Math.floor((bar.close - low) / step))
    buckets[index] = (buckets[index] as number) + bar.volume
  }
  const pocIndex = buckets.indexOf(Math.max(...buckets))
  const poc = low + (pocIndex + 0.5) * step
  return { poc, valueAreaLow: low + Math.max(0, pocIndex - 1) * step, valueAreaHigh: low + Math.min(bins, pocIndex + 2) * step }
}

function reading(
  entry: MethodologyCatalogEntry,
  status: MethodologyStatus,
  direction: MethodologyDirection,
  confidence: number,
  note: string,
  value?: number,
): MethodologyReading {
  return {
    id: entry.id,
    name: entry.name,
    category: entry.category,
    status,
    direction,
    confidence: Math.round(confidence),
    note,
    ...value === undefined ? {} : { value },
  }
}

function byId(id: string): MethodologyCatalogEntry {
  return CATALOG.find(entry => entry.id === id) as MethodologyCatalogEntry
}

/**
 * Build deterministic methodology readings and the strategy catalog.
 * @param snapshot - Normalized market snapshot.
 * @param language - Report language for reading notes and investor-lens copy.
 * @returns Data-backed readings, investor lenses, and the strategy catalog.
 */
export function buildMethodologyAnalysis(snapshot: MarketSnapshot, language: ReportLanguage = 'en'): MethodologyAnalysis {
  const copy: ReportCopy = REPORT_COPY[language]
  const localize = (entry: MethodologyCatalogEntry): MethodologyCatalogEntry => {
    const name = copy.catalogNames[entry.id] ?? entry.name
    return name === entry.name ? entry : { ...entry, name }
  }
  const localizeRequirement = (requirement: string): string => copy.requirements[requirement] ?? requirement
  const note = (key: string, params: Readonly<Record<string, string | number>> = {}): string =>
    formatCopy(copy.notes[key] as string, params)
  const analysis: IndicatorAnalysis = buildIndicatorAnalysis(snapshot)
  const bars = snapshot.bars
  const latest = bars.at(-1) as MarketBar
  const close = latest.close
  const maDirection = analysis.indicators.ema12 > analysis.indicators.ema26
    ? 'bullish'
    : analysis.indicators.ema12 < analysis.indicators.ema26 ? 'bearish' : 'neutral'
  const donchianWindow = bars.slice(-21, -1)
  const donchianHigh = Math.max(...donchianWindow.map(bar => bar.high))
  const donchianLow = Math.min(...donchianWindow.map(bar => bar.low))
  const reference = (bars.at(-21) as MarketBar).close
  const roc = (close - reference) / reference * 100
  const bollingerWindow = bars.slice(-20).map(bar => bar.close)
  const deviation = standardDeviation(bollingerWindow)
  const zScore = deviation === 0 ? 0 : (close - analysis.indicators.bollingerMiddle) / deviation
  const kdjValue = kdj(bars)
  const averageVolume = average(bars.slice(-20).map(bar => bar.volume))
  const vwapValue = vwap(bars)
  const profile = volumeProfile(bars)
  const swings = swingPoints(bars)
  const lastHighs = swings.highs.slice(-3)
  const lastLows = swings.lows.slice(-3)
  const highDirection = barDirection(lastHighs.at(-2) ?? close, lastHighs.at(-1) ?? close)
  const lowDirection = barDirection(lastLows.at(-2) ?? close, lastLows.at(-1) ?? close)
  const dowDirection = highDirection === lowDirection ? highDirection : 'neutral'
  const adxValue = adx(bars)
  const atr = analysis.indicators.atr14
  const cycleWindow = bars.slice(-60).map(bar => bar.close)
  const cycle = (() => {
    const mean = average(cycleWindow)
    const deviations = cycleWindow.map(value => value - mean)
    const lag = 20
    const numerator = deviations.slice(lag)
      .reduce((sum, value, index) => sum + value * (deviations[index] as number), 0)
    const denominator = deviations.reduce((sum, value) => sum + value * value, 0)
    return denominator === 0 ? 0 : numerator / denominator
  })()

  const readings: MethodologyReading[] = [
    reading(localize(byId('ma-trend')), 'available', maDirection, 75, note('ma-trend', { ema12: analysis.indicators.ema12, ema26: analysis.indicators.ema26 }), analysis.indicators.ema12 - analysis.indicators.ema26),
    reading(localize(byId('donchian')), 'available', close > donchianHigh ? 'bullish' : close < donchianLow ? 'bearish' : 'neutral', 70, note('donchian', { window: 20, low: donchianLow, high: donchianHigh })),
    reading(localize(byId('adx')), 'available', adxValue.adx >= 25 ? (adxValue.plus > adxValue.minus ? 'bullish' : 'bearish') : 'neutral', Math.min(90, adxValue.adx), note('adx', { adx: adxValue.adx.toFixed(2) }), adxValue.adx),
    reading(localize(byId('supertrend')), 'partial', superTrend(bars), 65, note('supertrend')),
    reading(localize(byId('roc')), 'available', barDirection(reference, close), 70, note('roc'), roc),
    reading(localize(byId('macd')), 'available', analysis.indicators.macdHistogram >= 0 ? 'bullish' : 'bearish', 70, note('macd'), analysis.indicators.macdHistogram),
    reading(localize(byId('rsi')), 'available', analysis.indicators.rsi14 >= 50 ? 'bullish' : 'bearish', 60, note('rsi', { rsi: analysis.indicators.rsi14 }), analysis.indicators.rsi14),
    reading(localize(byId('rsi-reversion')), 'available', analysis.indicators.rsi14 <= 30 ? 'bullish' : analysis.indicators.rsi14 >= 70 ? 'bearish' : 'neutral', 55, note('rsi-reversion'), analysis.indicators.rsi14),
    reading(localize(byId('bollinger')), 'available', zScore <= -2 ? 'bullish' : zScore >= 2 ? 'bearish' : 'neutral', 55, note('bollinger'), zScore),
    reading(localize(byId('kdj')), 'available', kdjValue.k > kdjValue.d ? 'bullish' : 'bearish', 55, note('kdj'), kdjValue.j),
    reading(localize(byId('volume-price')), 'available', barDirection(latest.open, latest.close), 55, note('volume-price', { volume: latest.volume, mean: averageVolume }), averageVolume),
    reading(localize(byId('obv')), 'available', analysis.indicators.obv >= analysis.indicators.obvSma20 ? 'bullish' : 'bearish', 60, note('obv'), analysis.indicators.obv - analysis.indicators.obvSma20),
    reading(localize(byId('vwap')), 'partial', barDirection(vwapValue, close), 45, note('vwap'), vwapValue),
    reading(localize(byId('volume-profile')), 'partial', barDirection(profile.poc, close), 45, note('volume-profile'), profile.poc),
    reading(localize(byId('chan')), 'partial', close > analysis.indicators.bollingerMiddle ? 'bullish' : close < analysis.indicators.bollingerMiddle ? 'bearish' : 'neutral', 35, note('chan')),
    reading(localize(byId('dow')), 'partial', dowDirection, 55, note('dow')),
    reading(localize(byId('price-action')), 'partial', close > analysis.indicators.sma20 ? 'bullish' : close < analysis.indicators.sma20 ? 'bearish' : 'neutral', 45, note('price-action')),
    reading(localize(byId('volatility-breakout')), 'available', (latest.high - latest.low) > atr ? barDirection(latest.open, latest.close) : 'neutral', 55, note('volatility-breakout'), latest.high - latest.low),
    reading(localize(byId('cycle')), 'partial', cycle > 0.2 ? 'bullish' : cycle < -0.2 ? 'bearish' : 'neutral', 30, note('cycle'), cycle),
    reading(localize(byId('elliott')), 'not-data-backed', 'insufficient-data', 10, note('elliott')),
    reading(localize(byId('wyckoff')), 'not-data-backed', 'insufficient-data', 10, note('wyckoff')),
    ...CATALOG.filter(entry => ['relative-strength', 'grid', 'pairs', 'opening-range', 'market-neutral', 'pca-arb', 'value', 'factor-momentum', 'quality', 'low-vol', 'size', 'multi-factor', 'dcf', 'financial-quality', 'industry-rotation', 'earnings', 'dividend-buyback', 'merger-arb', 'index-rebalance', 'forest', 'boosted-trees', 'sequence-model', 'reinforcement', 'market-making', 'order-flow', 'execution', 'order-book'].includes(entry.id))
      .map(entry => reading(
        localize(entry),
        entry.status,
        'insufficient-data',
        0,
        note('gap', { requirements: entry.dataRequirements.map(localizeRequirement).join(', ') }),
      )),
  ]
  const investorDefinitions = [
    { id: 'buffett', name: 'Warren Buffett', ids: ['quality', 'value', 'financial-quality'] },
    { id: 'graham', name: 'Benjamin Graham', ids: ['value', 'financial-quality'] },
    { id: 'munger', name: 'Charlie Munger', ids: ['quality'] },
    { id: 'lynch', name: 'Peter Lynch', ids: ['quality', 'factor-momentum'] },
    { id: 'soros', name: 'George Soros', ids: ['ma-trend', 'momentum', 'macd'] },
    { id: 'dalio', name: 'Ray Dalio', ids: ['adx', 'volatility-breakout'] },
    { id: 'simons', name: 'Jim Simons', ids: ['momentum', 'rsi', 'bollinger'] },
    { id: 'livermore', name: 'Jesse Livermore', ids: ['donchian', 'supertrend', 'adx'] },
    { id: 'marks', name: 'Howard Marks', ids: ['cycle', 'volatility-breakout'] },
    { id: 'taleb', name: 'Nassim Taleb', ids: ['volatility-breakout', 'cycle'] },
  ] as const
  const investors: InvestorLens[] = investorDefinitions.map((definition) => {
    const lens = copy.lenses[definition.id] as LensCopy
    const relevant = readings.filter(item => (definition.ids as readonly string[]).includes(item.id) && item.direction !== 'insufficient-data')
    const score = relevant.reduce((sum, item) => sum + (item.direction === 'bullish' ? 1 : item.direction === 'bearish' ? -1 : 0), 0)
    const stance = relevant.length === 0 ? 'insufficient-data' : score > 0 ? 'constructive' : score < 0 ? 'cautious' : 'neutral'
    return {
      id: definition.id,
      name: definition.name,
      school: lens.school,
      stance,
      evidence: relevant.map(item => `${item.name}: ${item.direction} (${String(Math.round(item.confidence))}%)`),
      questions: [...lens.questions],
      risk: lens.risk,
    }
  })
  const synthesisPrompt = [
    'Analyze the asset through each investor lens and the methodology readings.',
    'Separate data-backed findings from unavailable evidence.',
    'Preserve disagreements and cite the exact reading supporting each claim.',
    `Asset: ${snapshot.instrument.name} (${snapshot.instrument.symbol}), as of ${snapshot.asOf}.`,
  ].join(' ')
  return { readings, catalog: CATALOG, investors, synthesisPrompt }
}
