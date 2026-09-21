/** AKShare macro loader over the shared Python finance bridge. */

import { z as zod } from 'zod'
import { FinanceDataError } from './error.ts'
import type { MacroObservation, MacroSeriesLoader, MacroSeriesQuery } from './macro.ts'
import type { FinanceStockBridge } from './stock.ts'

const macroSeriesSchema = zod.object({
  function: zod.string(),
  observations: zod.array(zod.object({ date: zod.string(), value: zod.number() })),
})

/** AKShare macro loader; the Python bridge owns the AKShare call and frame normalization. */
export class AkshareMacroLoader implements MacroSeriesLoader {
  readonly id = 'akshare' as const

  /**
   * @param bridge - Shared Python finance bridge.
   * @param enabled - Whether AKShare reads are switched on in settings.
   */
  constructor(
    private readonly bridge: FinanceStockBridge,
    private readonly enabled: () => boolean,
  ) {}

  /** @param query - Catalog request whose binding may override the catalog unit. */
  unit(query: MacroSeriesQuery): string | undefined {
    return query.indicator.sources.akshare?.unit
  }

  /**
   * Load one AKShare macro series.
   * @param query - Catalog request whose binding names the AKShare function.
   * @param signal - optional caller cancellation.
   * @returns Observations in upstream order.
   */
  async load(query: MacroSeriesQuery, signal?: AbortSignal): Promise<readonly MacroObservation[]> {
    const binding = query.indicator.sources.akshare
    if (binding === undefined) {
      throw new FinanceDataError(`${query.indicator.id} has no AKShare macro function`, 'MACRO_SOURCE_UNAVAILABLE')
    }
    if (!this.enabled()) {
      throw new FinanceDataError('AKShare macro requests are disabled in settings', 'MACRO_SOURCE_DISABLED')
    }
    const data = macroSeriesSchema.parse(await this.bridge.run({
      action: 'macro_series',
      function: binding.function,
      ...binding.params === undefined ? {} : { params: binding.params },
      ...binding.column === undefined ? {} : { column: binding.column },
    }, signal))
    if (data.observations.length === 0) {
      throw new FinanceDataError(`${binding.function} returned no usable observations`, 'MACRO_EMPTY')
    }
    return data.observations
  }
}
