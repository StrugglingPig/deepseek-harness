import { describe, expect, it } from 'vitest'
import { buildMethodologyAnalysis } from '../src/methodology.ts'
import type { MarketBar, MarketSnapshot } from '../src/types.ts'

function bar(index: number, close: number, volume = 1_000): MarketBar {
  return {
    timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume,
  }
}

function snapshot(bars: readonly MarketBar[], overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    instrument: { symbol: 'TEST', name: 'Test Asset', assetClass: 'equity', currency: 'USD' },
    asOf: bars.at(-1)?.timestamp ?? '2026-01-01T00:00:00.000Z',
    source: { provider: 'fixture', retrievedAt: '2026-01-01T00:00:00.000Z', synthetic: true },
    quote: { price: bars.at(-1)?.close ?? 100, changePercent: 0 },
    bars,
    ...overrides,
  }
}

const rising = Array.from({ length: 80 }, (_, index) => bar(index, 100 + index))
const falling = Array.from({ length: 80 }, (_, index) => bar(index, 200 - index))
const flat = Array.from({ length: 80 }, (_, index) => bar(index, 100, index === 79 ? 0 : 1_000))
const short = Array.from({ length: 50 }, (_, index) => bar(index, 100 + index * 0.01))
const zeroRange = Array.from({ length: 80 }, (_, index) => ({
  timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  open: 100,
  high: 100,
  low: 100,
  close: 100,
  volume: 1,
}))
const wave = Array.from({ length: 80 }, (_, index) => bar(index, 100 + Math.sin(index / 3) * 10))

describe('finance methodology analysis', () => {
  it('covers available readings for rising, falling, flat, and short histories', () => {
    const risingResult = buildMethodologyAnalysis(snapshot(rising))
    const fallingResult = buildMethodologyAnalysis(snapshot(falling))
    const flatResult = buildMethodologyAnalysis(snapshot(flat))
    const shortResult = buildMethodologyAnalysis(snapshot(short))
    expect(risingResult.readings.find(reading => reading.id === 'ma-trend')?.direction).toBe('bullish')
    expect(fallingResult.readings.find(reading => reading.id === 'ma-trend')?.direction).toBe('bearish')
    expect(flatResult.readings.find(reading => reading.id === 'bollinger')?.direction).toBe('neutral')
    expect(flatResult.readings.find(reading => reading.id === 'kdj')?.direction).toBeDefined()
    expect(flatResult.readings.find(reading => reading.id === 'vwap')?.status).toBe('partial')
    expect(shortResult.readings.some(reading => reading.status === 'requires-input')).toBe(true)
  })

  it('returns the full strategy catalog and investor lenses', () => {
    const result = buildMethodologyAnalysis(snapshot(rising))
    expect(result.catalog).toHaveLength(50)
    expect(result.catalog.some(entry => entry.id === 'turtle' && entry.quantRating === 5)).toBe(true)
    expect(result.catalog.some(entry => entry.id === 'order-book' && entry.status === 'requires-input')).toBe(true)
    expect(result.investors).toHaveLength(10)
    expect(result.investors.find(investor => investor.id === 'livermore')?.stance).toBe('constructive')
    expect(result.investors.find(investor => investor.id === 'buffett')?.stance).toBe('insufficient-data')
    expect(result.synthesisPrompt).toContain('TEST')
  })

  it('handles alternating cycles and volume-profile bounds', () => {
    const alternating = Array.from({ length: 80 }, (_, index) => bar(index, index % 2 === 0 ? 100 : 110))
    const result = buildMethodologyAnalysis(snapshot(alternating))
    expect(result.readings.find(reading => reading.id === 'cycle')?.direction).toBeDefined()
    expect(result.readings.find(reading => reading.id === 'volume-profile')?.direction).toBeDefined()
  })
  it('covers zero-range, swing, and extreme bollinger cases', () => {
    const zero = buildMethodologyAnalysis(snapshot(zeroRange))
    expect(zero.readings.find(reading => reading.id === 'adx')?.value).toBe(0)
    expect(zero.readings.find(reading => reading.id === 'kdj')?.direction).toBeDefined()
    expect(zero.readings.find(reading => reading.id === 'volume-profile')?.direction).toBeDefined()
    const swings = buildMethodologyAnalysis(snapshot(wave))
    expect(swings.readings.find(reading => reading.id === 'dow')?.direction).toBeDefined()
    const lowExtreme = buildMethodologyAnalysis(snapshot(Array.from({ length: 80 }, (_, index) => bar(index, index === 79 ? 50 : 100))))
    const highExtreme = buildMethodologyAnalysis(snapshot(Array.from({ length: 80 }, (_, index) => bar(index, index === 79 ? 150 : 100))))
    expect(lowExtreme.readings.find(reading => reading.id === 'bollinger')?.direction).toBe('bullish')
    expect(highExtreme.readings.find(reading => reading.id === 'bollinger')?.direction).toBe('bearish')
  })

  it('covers supertrend, swing, volatility, and cycle directional branches', () => {
    const rebound = Array.from({ length: 80 }, (_, index) => {
      const close = index < 79 ? 200 - index : 500
      return { ...bar(index, close), open: close, high: close + 1, low: close - 1 }
    })
    const trendWave = Array.from({ length: 80 }, (_, index) => bar(index, 100 + index * 0.2 + Math.sin(index / 2) * 5))
    const rangeSpike = Array.from({ length: 80 }, (_, index) => index === 79
      ? { ...bar(index, 200), open: 100, high: 250, low: 50 }
      : bar(index, 100))
    expect(buildMethodologyAnalysis(snapshot(rebound)).readings.find(reading => reading.id === 'supertrend')?.direction).toBeDefined()
    expect(buildMethodologyAnalysis(snapshot(trendWave)).readings.find(reading => reading.id === 'dow')?.direction).toBeDefined()
    expect(buildMethodologyAnalysis(snapshot(rangeSpike)).readings.find(reading => reading.id === 'volatility-breakout')?.direction).toBeDefined()
    expect(buildMethodologyAnalysis(snapshot(Array.from({ length: 80 }, (_, index) => bar(index, 100 + Math.sin(index / 4) * 20)))).readings.find(reading => reading.id === 'cycle')?.direction).toBeDefined()
    expect(buildMethodologyAnalysis(snapshot(Array.from({ length: 80 }, (_, index) => ({ ...bar(index, 100 + index), high: 100 + index, low: 99 + index })))).readings.find(reading => reading.id === 'volume-profile')?.direction).toBeDefined()
  })

})
