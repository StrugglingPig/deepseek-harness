import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INDICATOR_IDS,
  INDICATOR_COLORS,
  INDICATORS,
  chartHeight,
  indicatorPaneCount,
  indicatorParameterSuffix,
  indicatorValue,
  isIndicatorId,
  resolveIndicatorParameters,
  resolveIndicators,
  type IndicatorSpec,
} from '../src/client/indicators.ts'

const smaSpec = INDICATORS.find(spec => spec.id === 'sma') as IndicatorSpec
const bollSpec = INDICATORS.find(spec => spec.id === 'boll') as IndicatorSpec
const volumeSpec = INDICATORS.find(spec => spec.id === 'volume') as IndicatorSpec

describe('finance dashboard indicators', () => {
  it('recognizes catalogued indicator ids only', () => {
    expect(isIndicatorId('kdj')).toBe(true)
    expect(isIndicatorId('supertrend')).toBe(false)
    expect(isIndicatorId(4)).toBe(false)
  })

  it('falls back to declared defaults and clamps overrides into range', () => {
    expect(resolveIndicatorParameters(smaSpec, undefined)).toEqual({ period: 20 })
    expect(resolveIndicatorParameters(smaSpec, { period: 5 })).toEqual({ period: 5 })
    expect(resolveIndicatorParameters(smaSpec, { period: 0 })).toEqual({ period: 2 })
    expect(resolveIndicatorParameters(smaSpec, { period: 5_000 })).toEqual({ period: 250 })
    expect(resolveIndicatorParameters(smaSpec, { period: Number.NaN })).toEqual({ period: 20 })
    expect(resolveIndicatorParameters(bollSpec, { multiplier: 3.5 })).toEqual({ period: 20, multiplier: 3.5 })
  })

  it('resolves the enabled indicators in catalog order and drops retired ids', () => {
    const resolved = resolveIndicators(['kdj', 'sma', 'sma', 'retired'] as never, { kdj: { period: 12 } })
    expect(resolved.map(indicator => indicator.id)).toEqual(['sma', 'kdj'])
    expect(resolved[1]?.values).toEqual({ period: 12, kSmooth: 3, dSmooth: 3 })
  })

  it('keeps the default selection inside the catalog', () => {
    expect(DEFAULT_INDICATOR_IDS.every(isIndicatorId)).toBe(true)
    expect(Object.keys(INDICATOR_COLORS)).toEqual(INDICATORS.map(spec => spec.id))
  })

  it('counts panes and sizes the chart for them', () => {
    const resolved = resolveIndicators(['sma', 'volume', 'rsi'], {})
    expect(indicatorPaneCount(resolved)).toBe(2)
    expect(chartHeight(0)).toBe(360)
    expect(chartHeight(1)).toBe(410)
    expect(chartHeight(4)).toBe(860)
  })

  it('reads resolved parameters, falling back to the declared default', () => {
    const resolved = resolveIndicators(['sma'], {})[0] as Parameters<typeof indicatorValue>[0]
    expect(indicatorValue(resolved, 'period')).toBe(20)
    expect(indicatorValue({ ...resolved, values: {} }, 'period')).toBe(20)
    expect(indicatorValue({ ...resolved, values: {} }, 'unknown')).toBe(0)
  })

  it('renders legend suffixes for zero, one, and many parameters', () => {
    expect(indicatorParameterSuffix(volumeSpec, {})).toBe('')
    expect(indicatorParameterSuffix(smaSpec, { period: 20 })).toBe('20')
    expect(indicatorParameterSuffix(bollSpec, { period: 20, multiplier: 2 })).toBe('(20,2)')
  })
})
