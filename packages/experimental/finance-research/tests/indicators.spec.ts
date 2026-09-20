import { describe, expect, it } from 'vitest'
import {
  buildIndicatorAnalysis,
  compositeDirection,
  directionValue,
  latestAtr,
  latestBollinger,
  latestEma,
  latestMacd,
  latestObv,
  latestRsi,
  latestSma,
  macdDirection,
  obvSeries,
  priceBandDirection,
  rsiDirection,
  trendDirection,
  volumeDirection,
} from '../src/indicators.ts'
import type { MarketBar, MarketSnapshot } from '../src/types.ts'

const bars: readonly MarketBar[] = Array.from({ length: 60 }, (_, index) => {
  const close = 100 + index
  return {
    timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1_000 + index,
  }
})

function snapshot(inputBars: readonly MarketBar[]): MarketSnapshot {
  const latest = inputBars.at(-1)!
  return {
    instrument: { symbol: 'TEST', name: 'Test', assetClass: 'equity', currency: 'USD' },
    asOf: latest.timestamp,
    source: { provider: 'fixture', retrievedAt: '2026-09-20T00:00:00.000Z', synthetic: true },
    quote: { price: latest.close, changePercent: 0 },
    bars: inputBars,
  }
}

describe('technical indicator primitives', () => {
  it('validates periods and handles short windows', () => {
    expect(() => latestSma([1, 2], 0)).toThrow('period must be a positive number')
    expect(() => latestSma([1, 2], Number.NaN)).toThrow('period must be a positive number')
    expect(latestSma([1, 2], 3)).toBeUndefined()
    expect(latestSma([1, 2, 3], 3)).toBe(2)
    expect(latestEma([1, 2], 3)).toBeUndefined()
    expect(latestEma([1, 2, 3], 3)).toBe(2)
  })

  it('computes RSI branches', () => {
    expect(latestRsi([1, 2], 2)).toBeUndefined()
    expect(latestRsi([1, 1, 1], 2)).toBe(50)
    expect(latestRsi([1, 2, 3], 2)).toBe(100)
    expect(latestRsi([3, 2, 1], 2)).toBe(0)
    expect(latestRsi([1, 2, 1], 2)).toBeCloseTo(50)
  })

  it('computes MACD branches', () => {
    expect(() => latestMacd([1, 2, 3], 0)).toThrow('fast must be a positive number')
    expect(() => latestMacd([1, 2, 3], 3, 2)).toThrow('fast must be smaller than slow')
    expect(latestMacd([1, 2, 3], 2, 3, 3)).toBeUndefined()
    expect(latestMacd(bars.map(bar => bar.close))).toBeDefined()
  })

  it('computes ATR and Bollinger branches', () => {
    expect(() => latestAtr(bars, 0)).toThrow('period must be a positive number')
    expect(latestAtr(bars.slice(0, 2), 14)).toBeUndefined()
    expect(latestAtr(bars, 14)).toBeGreaterThan(0)
    expect(() => latestBollinger(bars.map(bar => bar.close), 0)).toThrow('period must be a positive number')
    expect(() => latestBollinger(bars.map(bar => bar.close), 20, 0)).toThrow('multiplier must be a positive number')
    expect(latestBollinger([1, 2], 3)).toBeUndefined()
    expect(latestBollinger(bars.map(bar => bar.close))).toBeDefined()
  })

  it('computes OBV and direction helpers', () => {
    expect(obvSeries([])).toEqual([])
    expect(latestObv([])).toBe(0)
    expect(obvSeries(bars).at(-1)).toBeGreaterThan(0)
    expect(trendDirection(2, 1)).toBe('bullish')
    expect(trendDirection(1, 2)).toBe('bearish')
    expect(trendDirection(1, 1)).toBe('neutral')
    expect(rsiDirection(20)).toBe('bullish')
    expect(rsiDirection(80)).toBe('bearish')
    expect(rsiDirection(50)).toBe('neutral')
    expect(macdDirection(1)).toBe('bullish')
    expect(macdDirection(-1)).toBe('bearish')
    expect(macdDirection(0)).toBe('neutral')
    expect(priceBandDirection(1, 2, 0)).toBe('neutral')
    expect(priceBandDirection(3, 2, 0)).toBe('bearish')
    expect(priceBandDirection(-1, 2, 0)).toBe('bullish')
    expect(volumeDirection(2, 1)).toBe('bullish')
    expect(volumeDirection(1, 2)).toBe('bearish')
    expect(volumeDirection(1, 1)).toBe('neutral')
    expect(directionValue('bullish')).toBe(1)
    expect(directionValue('bearish')).toBe(-1)
    expect(directionValue('neutral')).toBe(0)
    expect(compositeDirection(0.2)).toBe('bullish')
    expect(compositeDirection(-0.2)).toBe('bearish')
    expect(compositeDirection(0)).toBe('neutral')
  })

  it('rejects insufficient snapshots and analyzes a complete snapshot', () => {
    expect(() => buildIndicatorAnalysis(snapshot(bars.slice(0, 2)))).toThrow('at least 50 bars are required')
    const analysis = buildIndicatorAnalysis(snapshot(bars))
    expect(analysis.symbol).toBe('TEST')
    expect(analysis.signals).toHaveLength(5)
    expect(analysis.composite.direction).toBeDefined()
    expect(analysis.risk.atrPercent).toBeGreaterThan(0)
  })
})
