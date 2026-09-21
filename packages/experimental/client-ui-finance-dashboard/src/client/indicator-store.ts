/** Persisted chart-indicator preferences for the finance dashboard. */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_INDICATOR_IDS, INDICATORS, type IndicatorId, type IndicatorParameterMap } from './indicators.ts'

/** Persisted indicator selection and parameter overrides. */
export interface IndicatorPreferences {
  readonly enabled: readonly IndicatorId[]
  readonly parameters: IndicatorParameterMap
}

/** localStorage key owning the indicator selection. */
export const INDICATOR_PERSIST_KEY = 'dsh.finance.dashboard.indicators.v1'

/**
 * Create the indicator preference store.
 * @returns The store, rehydrated from localStorage when the browser has one.
 */
export function createIndicatorStore(): SnapshotStore<IndicatorPreferences> {
  return createSnapshotStore<IndicatorPreferences>(
    { enabled: DEFAULT_INDICATOR_IDS, parameters: {} },
    { persist: { name: INDICATOR_PERSIST_KEY } },
  )
}

/**
 * Toggle one indicator, keeping catalog order.
 * @param preferences - Current preferences.
 * @param id - Indicator to add or remove.
 * @returns The next preferences.
 */
export function toggleIndicator(preferences: IndicatorPreferences, id: IndicatorId): IndicatorPreferences {
  const enabled = new Set(preferences.enabled)
  if (enabled.has(id)) enabled.delete(id)
  else enabled.add(id)
  return { ...preferences, enabled: INDICATORS.flatMap(spec => enabled.has(spec.id) ? [spec.id] : []) }
}

/**
 * Store one indicator parameter override. Out-of-range and non-finite values are
 * clamped or dropped when the indicator resolves.
 * @param preferences - Current preferences.
 * @param id - Indicator owning the parameter.
 * @param key - Parameter name.
 * @param value - Requested value.
 * @returns The next preferences.
 */
export function setIndicatorParameter(
  preferences: IndicatorPreferences,
  id: IndicatorId,
  key: string,
  value: number,
): IndicatorPreferences {
  const current = preferences.parameters[id] ?? {}
  return { ...preferences, parameters: { ...preferences.parameters, [id]: { ...current, [key]: value } } }
}
