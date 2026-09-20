import { describe, expect, it } from 'vitest'
import { chartPath, parseKlines, priceChangePercent, toBinanceSymbol } from '../src/client/market-data.ts'

describe('finance dashboard market data', () => {
  it('normalizes common crypto symbols to Binance Spot pairs', () => {
    expect(toBinanceSymbol('btc')).toBe('BTCUSDT')
    expect(toBinanceSymbol('ETHUSDT')).toBe('ETHUSDT')
    expect(toBinanceSymbol(' sol ')).toBe('SOLUSDT')
  })

  it('parses Binance klines into finite dashboard bars', () => {
    expect(parseKlines([
      [1_700_000_000_000, '100', '105', '95', '102', '12.5'],
      ['bad', '100', '105', '95', '102', '12.5'],
    ])).toEqual([
      { time: 1_700_000_000_000, open: 100, high: 105, low: 95, close: 102, volume: 12.5 },
    ])
  })

  it('renders finite SVG paths for empty, flat, single, and rising series', () => {
    expect(chartPath([], 100, 50)).toBe('')
    expect(chartPath([{ time: 1, open: 100, high: 100, low: 100, close: 100, volume: 1 }], 100, 50))
      .toBe('M 0 25')
    expect(chartPath([
      { time: 1, open: 100, high: 100, low: 100, close: 100, volume: 1 },
      { time: 2, open: 100, high: 100, low: 100, close: 100, volume: 1 },
    ], 100, 50)).toBe('M 0 25 L 100 25')
    expect(chartPath([
      { time: 1, open: 100, high: 105, low: 95, close: 100, volume: 1 },
      { time: 2, open: 100, high: 110, low: 99, close: 110, volume: 1 },
    ], 100, 50)).toBe('M 0 50 L 100 0')
  })

  it('reports percent change only for a usable, non-zero series', () => {
    expect(priceChangePercent([])).toBeUndefined()
    expect(priceChangePercent([{ time: 1, open: 0, high: 0, low: 0, close: 0, volume: 0 }])).toBeUndefined()
    expect(priceChangePercent([
      { time: 1, open: 100, high: 100, low: 100, close: 100, volume: 1 },
      { time: 2, open: 100, high: 110, low: 100, close: 110, volume: 1 },
    ])).toBe(10)
    expect(parseKlines(null)).toEqual([])
    expect(parseKlines([[1, 2]])).toEqual([])
  })
})
