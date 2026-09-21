/** Macro series domain: normalized observations, source routing, and the settings-backed provider. */

import { FinanceDataError } from './error.ts'
import { macroSourcesOf, type MacroCategory, type MacroCountry, type MacroFrequency, type MacroIndicator, type MacroSourceId, type MacroTiming } from './macro-catalog.ts'

/** One normalized macro observation. */
export interface MacroObservation {
  /** Period the value describes, as published upstream. */
  readonly date: string
  readonly value: number
  /** Set when the upstream published the value as a projection rather than an outcome. */
  readonly projection?: boolean
}

/** One macro series request. */
export interface MacroSeriesQuery {
  readonly indicator: MacroIndicator
  readonly country: MacroCountry
  /** Explicit upstream, or `auto` to walk the catalog bindings in order. */
  readonly source?: MacroSourceId | 'auto'
  readonly startDate?: string
  readonly endDate?: string
  /** Maximum observations kept, newest last. */
  readonly limit?: number
}

/** One normalized macro series with its catalog metadata. */
export interface MacroSeries {
  readonly indicator: string
  readonly name: string
  readonly nameZh: string
  readonly category: MacroCategory
  readonly country: MacroCountry
  readonly unit: string
  readonly frequency: MacroFrequency
  readonly timing: MacroTiming
  readonly reading: string
  readonly affectedAssets: readonly string[]
  readonly source: MacroSourceId
  readonly observations: readonly MacroObservation[]
  readonly latest: MacroObservation
  readonly previous: MacroObservation | undefined
  readonly retrievedAt: string
}

/** Loader for one upstream. */
export interface MacroSeriesLoader {
  readonly id: MacroSourceId
  /**
   * Unit this upstream actually reports for one indicator, when it differs from
   * the catalog's primary unit.
   * @param query - Catalog request being resolved.
   * @returns The binding unit, or undefined to use the catalog unit.
   */
  unit?(query: MacroSeriesQuery): string | undefined
  /**
   * Load raw normalized observations for one catalog binding.
   * @param query - Catalog entry, country, and range.
   * @param signal - optional caller cancellation.
   * @returns Observations in ascending date order.
   */
  load(query: MacroSeriesQuery, signal?: AbortSignal): Promise<readonly MacroObservation[]>
}

/** Source-routing macro provider over the configured upstream loaders. */
export interface FinanceMacroDataProvider {
  readonly id: string
  /**
   * Load one catalog series, routing across upstreams for `auto`.
   * @param query - Catalog entry, country, source, and range.
   * @param signal - optional caller cancellation.
   * @returns The normalized series.
   */
  load(query: MacroSeriesQuery, signal?: AbortSignal): Promise<MacroSeries>
}

/**
 * Sort, de-duplicate, filter, and trim observations.
 * @param observations - Raw observations.
 * @param query - Request range and limit.
 * @returns Observations in ascending date order, newest last.
 */
export function normalizeObservations(
  observations: readonly MacroObservation[],
  query: Pick<MacroSeriesQuery, 'startDate' | 'endDate' | 'limit'> = {},
): readonly MacroObservation[] {
  const byDate = new Map<string, MacroObservation>()
  for (const observation of observations) {
    if (!Number.isFinite(observation.value)) continue
    byDate.set(observation.date, observation)
  }
  const ordered = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
  const ranged = ordered.filter(observation =>
    (query.startDate === undefined || observation.date >= query.startDate)
    && (query.endDate === undefined || observation.date <= query.endDate))
  if (query.limit === undefined || ranged.length <= query.limit) return ranged
  return ranged.slice(ranged.length - query.limit)
}

/**
 * Attach catalog metadata to one loaded series.
 * @param query - Resolved request.
 * @param source - Upstream that served the series.
 * @param observations - Observations already normalized.
 * @param now - Retrieval clock.
 * @returns The series record consumed by tools and reports.
 */
export function buildMacroSeries(
  query: MacroSeriesQuery,
  source: MacroSourceId,
  observations: readonly MacroObservation[],
  now: () => Date = () => new Date(),
): MacroSeries {
  if (observations.length === 0) {
    throw new FinanceDataError(`${query.indicator.id} returned no observations from ${source}`, 'MACRO_EMPTY')
  }
  const latest = observations[observations.length - 1] as MacroObservation
  return {
    indicator: query.indicator.id,
    name: query.indicator.name,
    nameZh: query.indicator.nameZh,
    category: query.indicator.category,
    country: query.country,
    unit: query.indicator.unit,
    frequency: query.indicator.frequency,
    timing: query.indicator.timing,
    reading: query.indicator.reading,
    affectedAssets: query.indicator.affectedAssets,
    source,
    observations,
    latest,
    previous: observations.length > 1 ? observations[observations.length - 2] : undefined,
    retrievedAt: now().toISOString(),
  }
}

/**
 * Preference order for `auto`: the authoritative long-history source first, then
 * the local AKShare bridge, then the global panels.
 */
const AUTO_PRECEDENCE: readonly MacroSourceId[] = ['fred', 'akshare', 'worldbank', 'imf']

/** Settings-backed macro provider that routes one query across its loaders. */
export class SettingsFinanceMacroDataProvider implements FinanceMacroDataProvider {
  readonly id = 'macro-settings'

  private readonly loaders = new Map<MacroSourceId, MacroSeriesLoader>()

  /**
   * @param loaders - Upstream loaders available at construction.
   * @param now - Retrieval clock for source metadata.
   */
  constructor(
    loaders: readonly MacroSeriesLoader[],
    private readonly now: () => Date = () => new Date(),
  ) {
    for (const loader of loaders) this.addLoader(loader)
  }

  /**
   * Install or replace one upstream loader. Loaders that arrive after
   * construction, such as the Python bridge behind its capability injection,
   * keep their {@link AUTO_PRECEDENCE} position rather than the insertion order.
   * @param loader - Upstream loader.
   */
  addLoader(loader: MacroSeriesLoader): void {
    this.loaders.set(loader.id, loader)
  }

  /** Loaders in `auto` preference order. */
  private orderedLoaders(): readonly MacroSeriesLoader[] {
    return AUTO_PRECEDENCE.flatMap((source) => {
      const loader = this.loaders.get(source)
      return loader === undefined ? [] : [loader]
    })
  }

  private loaderFor(source: MacroSourceId): MacroSeriesLoader {
    const loader = this.loaders.get(source)
    if (loader === undefined) {
      throw new FinanceDataError(`macro source ${source} is not available in this composition`, 'MACRO_SOURCE_UNAVAILABLE')
    }
    return loader
  }

  /** Build one series, letting the serving loader override the catalog unit. */
  private series(
    query: MacroSeriesQuery,
    source: MacroSourceId,
    loader: MacroSeriesLoader,
    observations: readonly MacroObservation[],
  ): MacroSeries {
    const series = buildMacroSeries(query, source, observations, this.now)
    const unit = loader.unit?.(query)
    return unit === undefined || unit === series.unit ? series : { ...series, unit }
  }

  /**
   * Load one catalog series.
   * @param query - Catalog entry, country, source, and range.
   * @param signal - optional caller cancellation.
   * @returns The normalized series with catalog metadata.
   */
  async load(query: MacroSeriesQuery, signal?: AbortSignal): Promise<MacroSeries> {
    const bound = macroSourcesOf(query.indicator)
    if (bound.length === 0) {
      throw new FinanceDataError(`${query.indicator.id} has no upstream binding`, 'MACRO_SOURCE_UNAVAILABLE')
    }
    const requested = query.source ?? 'auto'
    if (requested !== 'auto') {
      if (!bound.includes(requested)) {
        throw new FinanceDataError(`${query.indicator.id} is not bound to ${requested}`, 'MACRO_SOURCE_UNAVAILABLE')
      }
      const loader = this.loaderFor(requested)
      const observations = normalizeObservations(await loader.load(query, signal), query)
      return this.series(query, requested, loader, observations)
    }
    const failures: string[] = []
    for (const loader of this.orderedLoaders()) {
      if (!bound.includes(loader.id)) continue
      const source = loader.id
      try {
        const observations = await loader.load(query, signal)
        return this.series(query, source, loader, normalizeObservations(observations, query))
      } catch (error: unknown) {
        if (signal?.aborted === true) throw new FinanceDataError('macro request aborted', 'ABORTED')
        // `auto` is a preference walk: a disabled, unconfigured, or failing
        // upstream is recorded and the next binding gets the chance.
        failures.push(`${source}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new FinanceDataError(
      `no upstream returned ${query.indicator.id}: ${failures.join('; ')}`,
      'MACRO_SOURCE_FAILED',
    )
  }
}
