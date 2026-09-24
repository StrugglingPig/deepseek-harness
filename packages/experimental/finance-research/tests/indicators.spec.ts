import { describe, expect, it } from 'vitest'
import {
  biasDirection,
  buildIndicatorAnalysis,
  cciDirection,
  compositeDirection,
  directionValue,
  latestAtr,
  latestBias,
  latestBollinger,
  latestCci,
  latestDmi,
  latestEma,
  latestKdj,
  latestMacd,
  latestObv,
  latestRsi,
  latestSar,
  latestSma,
  latestTdSequential,
  latestVwap,
  latestWr,
  macdDirection,
  obvSeries,
  priceBandDirection,
  rsiDirection,
  setupDirection,
  trendDirection,
  volumeDirection,
  wrDirection,
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

/** Bars whose span is zero, so range-based indicators read their fallback. */
function flatBars(count: number, close = 100, volume = 0): readonly MarketBar[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    open: close,
    high: close,
    low: close,
    close,
    volume,
  }))
}

/** Bars built from explicit high/low spans, with the close at the span midpoint. */
function spanBars(spans: readonly (readonly [number, number])[]): readonly MarketBar[] {
  return spans.map(([high, low], index) => ({
    timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    open: low,
    high,
    low,
    close: (high + low) / 2,
    volume: 1_000,
  }))
}

/** Rising highs, a crash, a lower low, then a recovery that flips the parabolic stop twice. */
const reversalBars: readonly MarketBar[] = spanBars([[101, 99], [103, 101], [105, 103], [91, 89], [88, 84], [111, 109]])

/** Directional movement spanning both sides of each +DI and -DI branch. */
const directionalBars: readonly MarketBar[] = spanBars([[110, 100], [115, 105], [110, 115], [105, 100], [95, 105], [100, 100]])

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
    expect(analysis.signals).toHaveLength(13)
    expect(analysis.composite.direction).toBeDefined()
    expect(analysis.risk.atrPercent).toBeGreaterThan(0)
    expect(analysis.indicators.tdSetup.side).toBe('sell')
    expect(analysis.indicators.vwap).toBeGreaterThan(0)
  })

  it('computes KDJ and reads a flat window as the midpoint', () => {
    expect(() => latestKdj(bars, 0)).toThrow('period must be a positive number')
    expect(() => latestKdj(bars, 9, 0)).toThrow('kSmooth must be a positive number')
    expect(() => latestKdj(bars, 9, 3, 0)).toThrow('dSmooth must be a positive number')
    expect(latestKdj(bars.slice(0, 4), 9)).toBeUndefined()
    // The window always carries a count once the period fits, so the read resolves.
    expect((latestKdj(flatBars(20)) as { readonly k: number }).k).toBe(50)
    expect((latestKdj(bars) as { readonly k: number }).k).toBeGreaterThan(50)
  })

  it('counts TD Sequential setups on both sides', () => {
    expect(() => latestTdSequential(bars, 0)).toThrow('lookback must be a positive number')
    expect(latestTdSequential(bars.slice(0, 4), 4)).toBeUndefined()
    expect(latestTdSequential(bars)).toEqual({ side: 'sell', count: bars.length - 4 })
    expect(latestTdSequential([...bars].reverse())?.side).toBe('buy')
    expect(latestTdSequential(flatBars(20))).toBeUndefined()
  })

  it('computes VWAP, CCI, Williams %R, and BIAS', () => {
    expect(latestVwap([])).toBeUndefined()
    expect(latestVwap(flatBars(2))).toBe(100)
    expect(latestVwap(bars)).toBeGreaterThan(100)
    expect(() => latestCci(bars, 0)).toThrow('period must be a positive number')
    expect(latestCci(bars.slice(0, 4), 14)).toBeUndefined()
    expect(latestCci(flatBars(20))).toBe(0)
    expect(latestCci(bars)).toBeGreaterThan(0)
    expect(() => latestWr(bars, 0)).toThrow('period must be a positive number')
    expect(latestWr(bars.slice(0, 4), 14)).toBeUndefined()
    expect(latestWr(flatBars(20))).toBe(50)
    expect(latestWr(bars)).toBeLessThan(20)
    expect(() => latestBias(bars, 0)).toThrow('period must be a positive number')
    expect(latestBias(bars.slice(0, 4), 6)).toBeUndefined()
    expect(latestBias(flatBars(6, 0))).toBe(0)
    expect(latestBias(bars)).toBeGreaterThan(0)
  })

  it('computes parabolic SAR across both trends', () => {
    expect(() => latestSar(bars, 0)).toThrow('step must be a positive number')
    expect(() => latestSar(bars, 0.02, 0)).toThrow('maxStep must be a positive number')
    expect(latestSar([])).toBeUndefined()
    expect(latestSar(bars.slice(0, 1))).toBe(98)
    expect(latestSar(bars)).toBeGreaterThan(0)
    expect(latestSar(reversalBars)).toBe(84)
  })

  it('computes DMI across both directional branches', () => {
    expect(() => latestDmi(bars, 0)).toThrow('period must be a positive number')
    expect(latestDmi(bars.slice(0, 3), 2)).toBeUndefined()
    expect(latestDmi(flatBars(4), 2)).toEqual({ plusDi: 0, minusDi: 0, adx: 0 })
    const directional = latestDmi(directionalBars, 2)
    expect(directional?.plusDi).toBeGreaterThan(0)
    expect(directional?.minusDi).toBeGreaterThan(0)
    expect(latestDmi(bars, 14)).toBeDefined()
  })

  it('maps the extended indicators to signal directions', () => {
    expect(setupDirection('buy')).toBe('bullish')
    expect(setupDirection('sell')).toBe('bearish')
    expect(cciDirection(120)).toBe('bullish')
    expect(cciDirection(-120)).toBe('bearish')
    expect(cciDirection(0)).toBe('neutral')
    expect(wrDirection(90)).toBe('bullish')
    expect(wrDirection(10)).toBe('bearish')
    expect(wrDirection(50)).toBe('neutral')
    expect(biasDirection(2)).toBe('bearish')
    expect(biasDirection(-2)).toBe('bullish')
    expect(biasDirection(0)).toBe('neutral')
  })

  it('reads a flat snapshot as a neutral composite with an idle TD count', () => {
    const analysis = buildIndicatorAnalysis(snapshot(flatBars(60)))
    expect(analysis.indicators.tdSetup).toEqual({ side: 'none', count: 0 })
    expect(analysis.indicators.wr14).toBe(50)
    expect(analysis.composite.direction).toBe('neutral')
    expect(analysis.signals.map(signal => signal.name)).toContain('williams-r')
  })
})
