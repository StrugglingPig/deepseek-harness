import { describe, expect, it } from 'vitest'
import {
  bollinger,
  chartPath,
  ema,
  kdj,
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
