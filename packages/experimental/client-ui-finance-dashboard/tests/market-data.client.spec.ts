import { describe, expect, it } from 'vitest'
import {
  atr,
  bias,
  bollinger,
  cci,
  chartPath,
  dmi,
  ema,
  kdj,
  obv,
  sar,
  tdSequential,
  vwap,
  wr,
  intervalsFor,
  macd,
  parseDashboardMarket,
  parseKlines,
  defaultSymbol,
  priceChangePercent,
  rsi,
  sma,
  toBinanceSymbol,
  watchlist,
} from '../src/client/market-data.ts'

const bars = [
  { time: 1, open: 100, high: 105, low: 95, close: 100, volume: 10 },
  { time: 2, open: 100, high: 110, low: 99, close: 110, volume: 12 },
]

describe('finance dashboard market data', () => {
  function shaped(closes: readonly number[], volume = 1) {
    return closes.map((close, index) => ({
      time: index + 1,
      open: close,
      high: close + 2,
      low: close - 2,
      close,
      volume,
    }))
  }

  it('tracks parabolic SAR through a reversal', () => {
    const rising = shaped([10, 11, 12, 13, 14, 15])
    const climbing = sar(rising, 0.5, 0.5)
    expect(climbing).toHaveLength(6)
    expect(climbing[0]?.value).toBe(8)
    expect((climbing.at(-1)?.value as number)).toBeLessThan(15)
    expect(sar([], 0.02, 0.2)).toEqual([])

    // A break below the stop flips the trend and restarts the acceleration factor.
    const reversal = sar(shaped([10, 12, 14, 9, 8]), 0.5, 0.5)
    expect((reversal.at(-1)?.value as number)).toBeGreaterThan(8)

    // A wave exercises both trends, the rising bar that makes no new extreme,
    // and both reversal directions.
    const wave = [10, 11, 12, 11.5, 9, 9.5, 10.5].map((close, index) => ({
      time: index + 1, open: close, high: close + 0.5, low: close - 0.5, close, volume: 1,
    }))
    const points = sar(wave, 0.5, 0.5)
    expect(points).toHaveLength(7)
    // The down reversal parks the stop above the falling prices, and the later
    // up reversal parks it below the rising ones.
    expect(points[4]?.value).toBe(12.5)
    expect(points[6]?.value).toBe(8.5)
  })

  it('weights price by volume for VWAP', () => {
    const points = vwap([
      { time: 1, open: 10, high: 12, low: 8, close: 10, volume: 1 },
      { time: 2, open: 10, high: 22, low: 18, close: 20, volume: 3 },
    ])
    // Typical prices 10 and 20, weighted 1:3.
    expect(points[0]?.value).toBe(10)
    expect(points[1]?.value).toBe(17.5)
    expect(vwap([{ time: 1, open: 5, high: 5, low: 5, close: 5, volume: 0 }])[0]?.value).toBe(5)
  })

  it('measures Williams %R on the 0-100 scale', () => {
    const window = [
      { time: 1, open: 10, high: 12, low: 8, close: 10, volume: 1 },
      { time: 2, open: 12, high: 14, low: 10, close: 12, volume: 1 },
      { time: 3, open: 14, high: 16, low: 12, close: 16, volume: 1 },
    ]
    // The close at the window high reads zero; at the window low it reads 100.
    expect(wr(window, 3)[0]?.value).toBe(0)
    expect(wr([...window.slice(0, 2), { time: 3, open: 12, high: 16, low: 8, close: 8, volume: 1 }], 3)[0]?.value).toBe(100)
    // A window with no range has no position to report.
    expect(wr([{ time: 1, open: 5, high: 5, low: 5, close: 5, volume: 1 }], 1)[0]?.value).toBe(0)
    expect(wr(window, 0)).toEqual([])
  })

  it('measures commodity channel index and deviation', () => {
    const spread = cci(shaped([10, 20, 30]), 3)
    expect(spread).toHaveLength(1)
    expect(Math.abs(spread[0]?.value as number)).toBeCloseTo(100)
    expect(cci(shaped([10, 10, 10]), 3)[0]?.value).toBe(0)
    expect(cci(shaped([10, 10, 10]), 0)).toEqual([])

    expect(bias(shaped([10, 20]), 2)[0]?.value).toBeCloseTo(33.33, 1)
    // A zero average carries no deviation to report.
    expect(bias(shaped([-1, 1]), 2)[0]?.value).toBe(0)
    expect(bias(shaped([1, 2]), 0)).toEqual([])
  })

  it('accumulates on-balance volume by close direction', () => {
    const points = obv(shaped([10, 12, 11, 11], 5))
    expect(points.map(point => point.value)).toEqual([0, 5, 0, 0])
  })

  it('smooths true range into ATR', () => {
    const points = atr([
      { time: 1, open: 10, high: 12, low: 8, close: 10, volume: 1 },
      { time: 2, open: 10, high: 15, low: 9, close: 14, volume: 1 },
      { time: 3, open: 14, high: 16, low: 13, close: 15, volume: 1 },
    ], 2)
    // First smoothed range averages the 4-wide first bar and the 6-wide second.
    expect(points[0]?.value).toBe(5)
    expect(points[0]?.time).toBe(2)
    expect(atr(shaped([1, 2]), 5)).toEqual([])
    expect(atr(shaped([1, 2]), 0)).toEqual([])
  })

  it('separates directional movement from its smoothed index', () => {
    const rising = dmi(shaped([10, 11, 12, 13, 14, 15, 16, 17]), 3)
    expect(rising.plusDi.length).toBeGreaterThan(0)
    expect(rising.plusDi[0]?.value).toBeGreaterThan(rising.minusDi[0]?.value as number)
    expect(rising.adx.length).toBeGreaterThan(0)
    expect(rising.adx[0]?.value).toBeGreaterThan(0)

    // A downtrend reports the mirror reading.
    const falling = dmi(shaped([20, 19, 18, 17, 16, 15, 14, 13]), 3)
    expect(falling.minusDi[0]?.value).toBeGreaterThan(falling.plusDi[0]?.value as number)

    // A flat window has no range and no directional movement to divide.
    const flat = shaped([10, 10, 10, 10, 10]).map(bar => ({ ...bar, high: 10, low: 10 }))
    expect(dmi(flat, 2).plusDi.every(point => point.value === 0)).toBe(true)
    expect(dmi(shaped([1, 2, 3]), 9)).toEqual({ plusDi: [], minusDi: [], adx: [] })
    expect(dmi(shaped([1, 2, 3]), 0)).toEqual({ plusDi: [], minusDi: [], adx: [] })
  })

  it('counts TD Sequential setups in both directions', () => {
    const falling = shaped(Array.from({ length: 14 }, (_, index) => 100 - index))
    const buy = tdSequential(falling, 4)
    expect(buy[0]).toEqual({ time: 5, count: 1, side: 'buy' })
    expect(buy.map(count => count.count)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(buy.every(count => count.side === 'buy')).toBe(true)

    const climbing = shaped(Array.from({ length: 6 }, (_, index) => 100 + index))
    expect(tdSequential(climbing, 4).map(count => count.side)).toEqual(['sell', 'sell'])

    // A close equal to the lookback close breaks both counts.
    expect(tdSequential(shaped([10, 9, 8, 7, 10, 9]), 4)).toEqual([])
    expect(tdSequential(falling, 0)).toEqual([])
  })

  it('bands closes around a moving average', () => {
    const series = [100, 110, 90, 120]
    const filled = series.map((close, index) => ({ time: index + 1, open: close, high: close, low: close, close, volume: 1 }))
    const bands = bollinger(filled, 3, 2)
    expect(bands.middle).toHaveLength(2)
    expect(bands.middle[0]?.value).toBeCloseTo(100)
    // Two-sigma on a {90,100,110} window is 16.33, so the bands sit well clear of it.
    expect(bands.upper[0]?.value).toBeCloseTo(116.33, 2)
    expect(bands.lower[0]?.value).toBeCloseTo(83.67, 2)
    expect(bollinger(filled, 0)).toEqual({ middle: [], upper: [], lower: [] })
  })

  it('smoothes KDJ from the raw stochastic value', () => {
    const filled = Array.from({ length: 6 }, (_, index) => ({
      time: index + 1,
      open: 100,
      high: 110 + index,
      low: 90 - index,
      close: 100 + index,
      volume: 1,
    }))
    const values = kdj(filled, 3, 3, 3)
    expect(values.k).toHaveLength(4)
    expect(values.k[0]?.value).toBeGreaterThan(50)
    expect(values.d[0]?.value).toBeGreaterThan(50)
    expect(values.j[0]?.value).toBeCloseTo(3 * (values.k[0]?.value as number) - 2 * (values.d[0]?.value as number))
    // A window with no price range reads as a neutral 50 rather than NaN.
    const flat = filled.map(bar => ({ ...bar, high: 100, low: 100 }))
    expect(kdj(flat, 3, 3, 3).k[0]?.value).toBeCloseTo(50)
    expect(kdj(filled, 9, 3, 3)).toEqual({ k: [], d: [], j: [] })
    expect(kdj(filled, 0)).toEqual({ k: [], d: [], j: [] })
  })

  it('normalizes common crypto symbols to Binance Spot pairs', () => {
    expect(toBinanceSymbol('btc')).toBe('BTCUSDT')
    expect(toBinanceSymbol('ETHUSDT')).toBe('ETHUSDT')
    expect(toBinanceSymbol(' sol ')).toBe('SOLUSDT')
    expect(defaultSymbol('us')).toBe('AAPL')
  })

  it('parses normalized Host dashboard payloads', () => {
    expect(parseDashboardMarket({
      asset: 'stock',
      symbol: '600519',
      name: '贵州茅台',
      interval: '1d',
      source: 'akshare',
      asOf: '2026-09-18T00:00:00.000Z',
      bars,
      quote: { price: 110, changePercent: 10, volume: 12, currency: 'CNY' },
    })).toMatchObject({ asset: 'stock', symbol: '600519', quote: { price: 110 } })
    expect(parseDashboardMarket({ asset: 'bad' })).toBeUndefined()
  })

  it('lists asset-specific intervals and watchlists', () => {
    expect(intervalsFor('stock')).toEqual(['1d', '1w', '1M'])
    expect(watchlist('us')).toContain('AAPL')
    expect(intervalsFor('crypto')).toContain('1m')
  })

  it('computes moving averages, RSI, and MACD', () => {
    expect(sma(bars, 2).map(point => point.value)).toEqual([105])
    expect(ema(bars, 2).map(point => point.value)).toEqual([100, 106.66666666666667])
    expect(sma([
      ...bars,
      { time: 3, open: 110, high: 112, low: 108, close: 108, volume: 10 },
    ], 2).at(-1)?.value).toBe(109)
    const rsiValues = rsi([
      ...Array.from({ length: 16 }, (_, index) => ({ time: index + 1, open: 1, high: 1, low: 1, close: 100 + index, volume: 1 })),
    ], 14)
    expect(rsiValues).toHaveLength(1)
    expect(rsiValues[0]?.value).toBe(100)
    expect(macd(bars).macd).toHaveLength(2)
    expect(rsi(
      Array.from({ length: 16 }, (_, index) => ({ time: index + 1, open: 1, high: 1, low: 1, close: 100 - index, volume: 1 })),
      14,
    )[0]?.value).toBe(0)
  })

  it('renders finite SVG paths for empty, flat, single, and rising series', () => {
    expect(chartPath([], 100, 50)).toBe('')
    expect(chartPath([{ time: 1, open: 100, high: 100, low: 100, close: 100, volume: 1 }], 100, 50))
      .toBe('M 0 25')
    expect(chartPath([
      { time: 1, open: 100, high: 100, low: 100, close: 100, volume: 1 },
      { time: 2, open: 100, high: 100, low: 100, close: 100, volume: 1 },
    ], 100, 50)).toBe('M 0 25 L 100 25')
    expect(priceChangePercent(bars)).toBe(10)
    expect(chartPath(bars, 100, 50)).toContain('M 0')
  })
  it('handles malformed dashboard payloads and indicator edge cases', () => {
    expect(parseDashboardMarket(null)).toBeUndefined()
    expect(parseDashboardMarket({ asset: 'crypto', symbol: '', name: 'BTC', interval: 'bad', source: 'x', asOf: 'x', bars, quote: { price: 1, changePercent: 0, volume: 1, currency: 'USD' } })).toBeUndefined()
    expect(parseDashboardMarket({ asset: 'crypto', symbol: 'BTC', name: 'BTC', interval: '1m', source: 'x', asOf: 'x', bars: [{ time: 1 }, { time: 1, open: 1, high: 1, low: 1, close: 1 }], quote: { price: 1, changePercent: 0, volume: 1, currency: 'USD' } })).toBeUndefined()
    expect(parseDashboardMarket({ asset: 'crypto', symbol: 'BTC', name: 'BTC', interval: '1m', source: 'x', asOf: 'x', bars, quote: { price: 'bad', changePercent: 0, volume: 1, currency: 'USD' } })).toBeUndefined()
    expect(parseKlines(null)).toEqual([])
    expect(parseKlines([[1, 2]])).toEqual([])
    expect(parseKlines([[1, '100', '105', '95', '102', '12']])).toEqual([{ time: 1, open: 100, high: 105, low: 95, close: 102, volume: 12 }])
    expect(parseKlines([[1, '2', '3', '4', '5', 'bad']])).toEqual([])
    expect(sma(bars, 0)).toEqual([])
    expect(ema([], 12)).toEqual([])
    expect(ema(bars, 0)).toEqual([])
    expect(rsi(bars, 14)).toEqual([])
    expect(macd([])).toEqual({ macd: [], signal: [] })
    expect(priceChangePercent([])).toBeUndefined()
    expect(priceChangePercent([{ time: 1, open: 0, high: 0, low: 0, close: 0, volume: 0 }])).toBeUndefined()
  })

})

describe('dashboard strip parsing', () => {
  it('forwards the research, macro, and event blocks the Host attached', () => {
    const parsed = parseDashboardMarket({
      asset: 'us',
      symbol: 'AAPL',
      name: 'Apple Inc.',
      interval: '1d',
      source: 'yahoo-finance',
      asOf: '2026-09-23T00:00:00.000Z',
      bars: [{ time: 1_700_000_000_000, open: 1, high: 2, low: 1, close: 2, volume: 3 }],
      quote: { price: 2, changePercent: 0, volume: 3, currency: 'USD' },
      research: { source: 'finnhub', reportedPeriod: 'FY2025 10-K', label: 'reference', ratios: [] },
      macro: [{ id: 'us-10y-yield', value: 4.25, unit: '%', date: '2026-09-22', source: 'fred' }],
      events: [{ date: '2026-09-24', label: 'Gross Domestic Product', source: 'fred' }],
    })
    expect(parsed?.research?.reportedPeriod).toBe('FY2025 10-K')
    expect(parsed?.macro?.[0]?.id).toBe('us-10y-yield')
    expect(parsed?.events?.[0]?.label).toBe('Gross Domestic Product')
  })
})
