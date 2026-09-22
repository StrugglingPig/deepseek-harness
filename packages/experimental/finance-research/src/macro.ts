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
  /** Newest published outcome; the newest projected period when an upstream publishes nothing else. */
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
 * Rank a published period so the mixed granularities upstreams use compare
 * directly. A label ranks at the start of the period it covers, so an annual
 * `2026` cannot outrank a monthly `2026-08` that already measured part of it,
 * while `2026` still outranks every `2025` label.
 * @param date - Upstream period label: `YYYY`, `YYYY-Qn`, `YYYY-MM`, or `YYYY-MM-DD`.
 * @returns Comparable integer; a later period ranks higher.
 */
function periodRank(date: string): number {
  const year = Number.parseInt(date.slice(0, 4), 10)
  if (!Number.isFinite(year)) return 0
  const rest = date.slice(4)
  const quarter = rest.startsWith('-Q') ? Number.parseInt(rest.slice(2), 10) : Number.NaN
  if (Number.isFinite(quarter)) return year * 10_000 + quarter * 300 - 199
  const month = Number.parseInt(rest.slice(1, 3), 10)
  if (!Number.isFinite(month)) return year * 10_000 + 101
  const day = Number.parseInt(rest.slice(4, 6), 10)
  return year * 10_000 + month * 100 + (Number.isFinite(day) ? day : 1)
}

/** Latest published outcome, ignoring values an upstream marked as projections. */
function latestOutcome(observations: readonly MacroObservation[]): MacroObservation | undefined {
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    const observation = observations[index]
    if (observation !== undefined && observation.projection !== true) return observation
  }
  return undefined
}

/**
 * Sort, de-duplicate, filter, and trim observations.
 * @param observations - Raw observations.
 * @param query - Request range and limit; bounds compare as period starts.
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
  // Bounds compare as period starts so a month-level observation still matches a
  // day-level bound inside the same month.
  const start = query.startDate === undefined ? undefined : periodRank(query.startDate)
  const end = query.endDate === undefined ? undefined : periodRank(query.endDate)
  const ranged = ordered.filter((observation) => {
    const rank = periodRank(observation.date)
    return (start === undefined || rank >= start) && (end === undefined || rank <= end)
  })
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
  const newest = observations[observations.length - 1] as MacroObservation
  // Falls back to the newest projected period when an upstream publishes no outcome.
  const latest = latestOutcome(observations) ?? newest
  const position = observations.indexOf(latest)
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
    previous: position > 0 ? observations[position - 1] : undefined,
    retrievedAt: now().toISOString(),
  }
}

/**
 * Order that settles an `auto` tie when two upstreams publish the same latest
 * period: the authoritative long-history and official statistical sources first,
 * then the local AKShare bridge, then the global panels. It never decides which
 * upstream wins outright; recency does. Every source a catalog binding can name
 * has to appear here, because the provider only calls the loaders it lists.
 */
const AUTO_TIE_BREAK: readonly MacroSourceId[] = ['fred', 'eia', 'cftc', 'akshare', 'worldbank', 'imf']

/** One upstream that answered an `auto` request. */
interface MacroCandidate {
  readonly series: MacroSeries
  /** Position in {@link AUTO_TIE_BREAK}; lower wins a tie. */
  readonly tieBreak: number
  /** Latest outcome, or undefined when every observation is a projection. */
  readonly outcome: MacroObservation | undefined
}

/**
 * Score one candidate. Dimensions are compared in order, highest first.
 * @param candidate - Upstream that answered.
 * @param ranged - Whether the request named a date range, which rewards coverage over recency.
 * @returns Comparable integers in significance order.
 */
function candidateScore(candidate: MacroCandidate, ranged: boolean): readonly number[] {
  const covered = candidate.series.observations.length
  const hasOutcome = candidate.outcome === undefined ? 0 : 1
  const recency = periodRank((candidate.outcome ?? candidate.series.latest).date)
  const order = AUTO_TIE_BREAK.length - candidate.tieBreak
  return ranged ? [covered, hasOutcome, recency, order] : [hasOutcome, recency, covered, order]
}

/**
 * Pick the better of two candidates.
 * @param left - First candidate.
 * @param right - Second candidate.
 * @param ranged - Whether the request named a date range.
 * @returns The preferred candidate, or `left` when they score identically.
 */
function betterCandidate(left: MacroCandidate, right: MacroCandidate, ranged: boolean): MacroCandidate {
  const mine = candidateScore(left, ranged)
  const other = candidateScore(right, ranged)
  // The last dimension is the source's position in the tie-break order, which is
  // unique per candidate, so some dimension always differs.
  const decided = mine.findIndex((value, index) => value !== other[index])
  return (mine[decided] as number) > (other[decided] as number) ? left : right
}

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
   * keep their {@link AUTO_TIE_BREAK} position rather than the insertion order.
   * @param loader - Upstream loader.
   */
  addLoader(loader: MacroSeriesLoader): void {
    this.loaders.set(loader.id, loader)
  }

  /** Loaders in `auto` tie-break order. */
  private orderedLoaders(): readonly MacroSeriesLoader[] {
    return AUTO_TIE_BREAK.flatMap((source) => {
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
    // `auto` reads every upstream bound to the indicator and keeps the one
    // publishing the latest period, so the resolved source follows what each
    // upstream currently has rather than a fixed catalog order.
    const ranged = query.startDate !== undefined || query.endDate !== undefined
    const attempted = this.orderedLoaders().filter(loader => bound.includes(loader.id))
    const settled = await Promise.allSettled(attempted.map(async (loader) => {
      const observations = normalizeObservations(await loader.load(query, signal), query)
      return this.series(query, loader.id, loader, observations)
    }))
    if (signal?.aborted === true) throw new FinanceDataError('macro request aborted', 'ABORTED')
    const failures: string[] = []
    const candidates: MacroCandidate[] = []
    settled.forEach((result, index) => {
      const loader = attempted[index] as MacroSeriesLoader
      if (result.status === 'rejected') {
        failures.push(`${loader.id}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
        return
      }
      candidates.push({
        series: result.value,
        tieBreak: AUTO_TIE_BREAK.indexOf(loader.id),
        outcome: latestOutcome(result.value.observations),
      })
    })
    let best: MacroCandidate | undefined
    for (const candidate of candidates) {
      best = best === undefined ? candidate : betterCandidate(best, candidate, ranged)
    }
    if (best === undefined) {
      throw new FinanceDataError(
        `no upstream returned ${query.indicator.id}: ${failures.join('; ')}`,
        'MACRO_SOURCE_FAILED',
      )
    }
    return best.series
  }
}
