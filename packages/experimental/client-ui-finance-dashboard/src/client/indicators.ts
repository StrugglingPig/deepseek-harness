/** Selectable chart indicators, their editable parameters, and resolution helpers. */

import type { FinanceDashboardLocaleKey } from './locales.ts'

/** Chart indicators the dashboard can draw. */
export type IndicatorId =
  | 'sma' | 'ema' | 'boll' | 'sar' | 'vwap' | 'td'
  | 'volume' | 'rsi' | 'macd' | 'kdj' | 'wr' | 'cci' | 'bias' | 'obv' | 'atr' | 'dmi'

/** Where an indicator draws: over the candles or in its own pane. */
export type IndicatorPlacement = 'overlay' | 'pane'

/** One user-editable numeric parameter of an indicator. */
export interface IndicatorParameterSpec {
  readonly key: string
  readonly labelKey: FinanceDashboardLocaleKey
  readonly min: number
  readonly max: number
  readonly step: number
  readonly defaultValue: number
}

/** One selectable indicator and the parameters it exposes. */
export interface IndicatorSpec {
  readonly id: IndicatorId
  readonly labelKey: FinanceDashboardLocaleKey
  readonly placement: IndicatorPlacement
  readonly parameters: readonly IndicatorParameterSpec[]
}

/** One enabled indicator with its parameters resolved to numbers. */
export interface ResolvedIndicator {
  readonly id: IndicatorId
  readonly spec: IndicatorSpec
  readonly values: Readonly<Record<string, number>>
}

/** Parameter overrides keyed by indicator id, then by parameter key. */
export type IndicatorParameterMap = Readonly<Record<string, Readonly<Record<string, number>> | undefined>>

/** Every indicator the dashboard offers, in display order. */
export const INDICATORS: readonly IndicatorSpec[] = [
  {
    id: 'sma',
    labelKey: 'sma',
    placement: 'overlay',
    parameters: [{ key: 'period', labelKey: 'paramPeriod', min: 2, max: 250, step: 1, defaultValue: 20 }],
  },
  {
    id: 'ema',
    labelKey: 'ema',
    placement: 'overlay',
    parameters: [{ key: 'period', labelKey: 'paramPeriod', min: 2, max: 250, step: 1, defaultValue: 12 }],
  },
  {
    id: 'boll',
    labelKey: 'boll',
    placement: 'overlay',
    parameters: [
      { key: 'period', labelKey: 'paramPeriod', min: 2, max: 250, step: 1, defaultValue: 20 },
      { key: 'multiplier', labelKey: 'paramMultiplier', min: 0.5, max: 5, step: 0.5, defaultValue: 2 },
    ],
  },
  {
    id: 'sar',
    labelKey: 'sar',
    placement: 'overlay',
    parameters: [
      { key: 'step', labelKey: 'paramStep', min: 0.01, max: 0.2, step: 0.01, defaultValue: 0.02 },
      { key: 'maxStep', labelKey: 'paramMaxStep', min: 0.05, max: 1, step: 0.05, defaultValue: 0.2 },
    ],
  },
  {
    id: 'vwap',
    labelKey: 'vwap',
    placement: 'overlay',
    parameters: [],
  },
  {
    id: 'td',
    labelKey: 'td',
    placement: 'overlay',
    parameters: [
      { key: 'lookback', labelKey: 'paramLookback', min: 1, max: 20, step: 1, defaultValue: 4 },
      { key: 'target', labelKey: 'paramTarget', min: 5, max: 13, step: 1, defaultValue: 9 },
    ],
  },
  {
    id: 'volume',
    labelKey: 'volume',
    placement: 'pane',
    parameters: [],
  },
  {
    id: 'rsi',
    labelKey: 'rsi',
    placement: 'pane',
    parameters: [{ key: 'period', labelKey: 'paramPeriod', min: 2, max: 250, step: 1, defaultValue: 14 }],
  },
  {
    id: 'macd',
    labelKey: 'macd',
    placement: 'pane',
    parameters: [
      { key: 'fast', labelKey: 'paramFast', min: 2, max: 100, step: 1, defaultValue: 12 },
      { key: 'slow', labelKey: 'paramSlow', min: 2, max: 200, step: 1, defaultValue: 26 },
      { key: 'signal', labelKey: 'paramSignal', min: 2, max: 100, step: 1, defaultValue: 9 },
    ],
  },
  {
    id: 'kdj',
    labelKey: 'kdj',
    placement: 'pane',
    parameters: [
      { key: 'period', labelKey: 'paramPeriod', min: 2, max: 250, step: 1, defaultValue: 9 },
      { key: 'kSmooth', labelKey: 'paramKSmooth', min: 2, max: 50, step: 1, defaultValue: 3 },
      { key: 'dSmooth', labelKey: 'paramDSmooth', min: 2, max: 50, step: 1, defaultValue: 3 },
    ],
  },
  {
    id: 'wr',
    labelKey: 'wr',
    placement: 'pane',
    parameters: [{ key: 'period', labelKey: 'paramPeriod', min: 2, max: 250, step: 1, defaultValue: 14 }],
  },
  {
    id: 'cci',
    labelKey: 'cci',
    placement: 'pane',
    parameters: [{ key: 'period', labelKey: 'paramPeriod', min: 2, max: 250, step: 1, defaultValue: 14 }],
  },
  {
    id: 'bias',
    labelKey: 'bias',
    placement: 'pane',
    parameters: [{ key: 'period', labelKey: 'paramPeriod', min: 2, max: 250, step: 1, defaultValue: 6 }],
  },
  {
    id: 'obv',
    labelKey: 'obv',
    placement: 'pane',
    parameters: [],
  },
  {
    id: 'atr',
    labelKey: 'atr',
    placement: 'pane',
    parameters: [{ key: 'period', labelKey: 'paramPeriod', min: 2, max: 250, step: 1, defaultValue: 14 }],
  },
  {
    id: 'dmi',
    labelKey: 'dmi',
    placement: 'pane',
    parameters: [{ key: 'period', labelKey: 'paramPeriod', min: 2, max: 250, step: 1, defaultValue: 14 }],
  },
]

/** Indicator selection before the user changes it. */
export const DEFAULT_INDICATOR_IDS: readonly IndicatorId[] = ['sma', 'ema', 'volume', 'rsi', 'macd']

/** Representative colour per indicator, used by the legend. */
export const INDICATOR_COLORS: Readonly<Record<IndicatorId, string>> = {
  sma: '#2563eb',
  ema: '#f59e0b',
  boll: '#8b5cf6',
  sar: '#0d9488',
  vwap: '#db2777',
  td: '#dc2626',
  volume: '#64748b',
  rsi: '#8b5cf6',
  macd: '#0ea5e9',
  kdj: '#0ea5e9',
  wr: '#0ea5e9',
  cci: '#f97316',
  bias: '#8b5cf6',
  obv: '#0d9488',
  atr: '#f97316',
  dmi: '#db2777',
}

/** Display groups of the indicator settings module. */
export const INDICATOR_GROUPS: readonly { readonly placement: IndicatorPlacement; readonly labelKey: FinanceDashboardLocaleKey }[] = [
  { placement: 'overlay', labelKey: 'indicatorOverlays' },
  { placement: 'pane', labelKey: 'indicatorPanes' },
]

const SPEC_BY_ID = new Map<IndicatorId, IndicatorSpec>(INDICATORS.map(spec => [spec.id, spec] as const))

/** Height the price pane keeps for candles, in CSS pixels. */
const PRICE_PANE_HEIGHT = 260
/** Height of one indicator pane, in CSS pixels. */
const INDICATOR_PANE_HEIGHT = 120
/** Shortest chart that still draws the time axis with a readable price pane. */
const MIN_CHART_HEIGHT = 360

/**
 * Whether a value names a chart indicator.
 * @param value - Candidate indicator id.
 * @returns True when the catalog owns the id.
 */
export function isIndicatorId(value: unknown): value is IndicatorId {
  return typeof value === 'string' && SPEC_BY_ID.has(value as IndicatorId)
}

/**
 * Resolve one indicator's parameters, clamped to their declared range.
 * @param spec - Indicator owning the parameters.
 * @param overrides - User overrides keyed by parameter name.
 * @returns One resolved number per declared parameter.
 */
export function resolveIndicatorParameters(
  spec: IndicatorSpec,
  overrides: Readonly<Record<string, number>> | undefined,
): Record<string, number> {
  const entries: [string, number][] = spec.parameters.map((parameter) => {
    const requested = overrides?.[parameter.key]
    const value = typeof requested === 'number' && Number.isFinite(requested) ? requested : parameter.defaultValue
    return [parameter.key, Math.min(parameter.max, Math.max(parameter.min, value))]
  })
  return Object.fromEntries(entries)
}

/**
 * Resolve the enabled indicators in catalog order.
 * @param ids - Enabled indicator ids, possibly naming indicators this build dropped.
 * @param overrides - Parameter overrides keyed by indicator id.
 * @returns Enabled indicators with numeric parameters.
 */
export function resolveIndicators(
  ids: readonly IndicatorId[],
  overrides: IndicatorParameterMap,
): ResolvedIndicator[] {
  const enabled = new Set(ids)
  return INDICATORS.flatMap((spec) => {
    if (!enabled.has(spec.id)) return []
    return [{ id: spec.id, spec, values: resolveIndicatorParameters(spec, overrides[spec.id]) }]
  })
}

/**
 * Count the indicator panes drawn below the price pane.
 * @param indicators - Enabled indicators.
 * @returns Number of indicator panes.
 */
export function indicatorPaneCount(indicators: readonly ResolvedIndicator[]): number {
  return indicators.filter(indicator => indicator.spec.placement === 'pane').length
}

/**
 * Read one resolved indicator parameter.
 * @param indicator - Indicator whose parameters were resolved.
 * @param key - Parameter name declared by the indicator's spec.
 * @returns The resolved value, the declared default when it was not resolved, or zero for an unknown name.
 */
export function indicatorValue(indicator: ResolvedIndicator, key: string): number {
  const resolved = indicator.values[key]
  if (resolved !== undefined) return resolved
  return indicator.spec.parameters.find(parameter => parameter.key === key)?.defaultValue ?? 0
}

/**
 * Build the legend suffix for one indicator's configured parameters.
 * @param spec - Indicator owning the parameters.
 * @param values - Resolved parameter values.
 * @returns Empty for a parameterless indicator, the bare value for one parameter, or a parenthesized list.
 */
export function indicatorParameterSuffix(
  spec: IndicatorSpec,
  values: Readonly<Record<string, number>>,
): string {
  const rendered = spec.parameters.map(parameter => String(values[parameter.key]))
  if (rendered.length === 0) return ''
  if (rendered.length === 1) return rendered[0] as string
  return `(${rendered.join(',')})`
}

/**
 * Minimum height that fits the price pane, every indicator pane, and the time axis.
 * @param paneCount - Number of indicator panes.
 * @returns Chart height in CSS pixels.
 */
export function chartHeight(paneCount: number): number {
  return Math.max(MIN_CHART_HEIGHT, PRICE_PANE_HEIGHT + paneCount * INDICATOR_PANE_HEIGHT)
}
