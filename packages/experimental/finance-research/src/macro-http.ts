/** REST macro loaders: FRED, World Bank, and the IMF DataMapper. */

import { FinanceDataError } from './error.ts'
import type { MacroObservation, MacroSeriesLoader, MacroSeriesQuery } from './macro.ts'
import type { FinanceProviderRequest, FinanceProviderResponse } from './types.ts'

/** Transport the macro loaders share with the market provider's HTTP plumbing. */
export interface MacroHttpTransport {
  /**
   * Send one provider request through the shared timeout, retry, cache, and authorization path.
   * @param request - Base, path, and provider-native query.
   * @param signal - optional caller cancellation.
   * @returns The upstream response envelope.
   */
  request(request: FinanceProviderRequest, signal?: AbortSignal): Promise<FinanceProviderResponse>
}

/** Read an upstream response body as an object. */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/** Read one finite number, or undefined for blanks and non-numeric cells. */
function finite(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed === '.') return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Read the observation range as FRED query parameters.
 * @param query - Catalog request.
 * @returns Provider-native date bounds.
 */
function dateQuery(query: MacroSeriesQuery): Record<string, string> {
  return {
    ...query.startDate === undefined ? {} : { observation_start: query.startDate },
    ...query.endDate === undefined ? {} : { observation_end: query.endDate },
  }
}

/** FRED series observations. */
export class FredMacroLoader implements MacroSeriesLoader {
  readonly id = 'fred' as const

  /**
   * @param transport - Shared HTTP transport.
   * @param enabled - Whether credentialed FRED requests are switched on in settings.
   */
  constructor(
    private readonly transport: MacroHttpTransport,
    private readonly enabled: () => boolean,
  ) {}

  /**
   * Load one FRED series.
   * @param query - Catalog request whose binding names the series id.
   * @param signal - optional caller cancellation.
   * @returns Observations in upstream order.
   */
  async load(query: MacroSeriesQuery, signal?: AbortSignal): Promise<readonly MacroObservation[]> {
    const seriesId = query.indicator.sources.fred?.seriesId
    if (seriesId === undefined) {
      throw new FinanceDataError(`${query.indicator.id} has no FRED series`, 'MACRO_SOURCE_UNAVAILABLE')
    }
    if (!this.enabled()) {
      throw new FinanceDataError('FRED macro requests are disabled in settings', 'MACRO_SOURCE_DISABLED')
    }
    const response = await this.transport.request({
      base: 'fred',
      path: '/fred/series/observations',
      query: { series_id: seriesId, file_type: 'json', ...dateQuery(query) },
      auth: 'api-key',
    }, signal)
    const body = record(response.data)
    const observations = body?.observations
    if (!Array.isArray(observations)) {
      throw new FinanceDataError('FRED returned no observation array', 'MACRO_SOURCE_FAILED')
    }
    return observations.flatMap((row) => {
      const entry = record(row)
      const date = entry?.date
      const value = finite(entry?.value)
      if (typeof date !== 'string' || value === undefined) return []
      return [{ date, value }]
    })
  }
}

/** World Bank indicator series. */
export class WorldBankMacroLoader implements MacroSeriesLoader {
  readonly id = 'worldbank' as const

  /** @param transport - Shared HTTP transport. */
  constructor(private readonly transport: MacroHttpTransport) {}

  /**
   * Load one World Bank indicator.
   * @param query - Catalog request whose binding names the indicator and ISO3 country.
   * @param signal - optional caller cancellation.
   * @returns Observations in upstream order.
   */
  async load(query: MacroSeriesQuery, signal?: AbortSignal): Promise<readonly MacroObservation[]> {
    const binding = query.indicator.sources.worldbank
    if (binding === undefined) {
      throw new FinanceDataError(`${query.indicator.id} has no World Bank indicator`, 'MACRO_SOURCE_UNAVAILABLE')
    }
    const response = await this.transport.request({
      base: 'worldbank',
      path: `/v2/country/${binding.country}/indicator/${binding.indicator}`,
      query: {
        format: 'json',
        per_page: '200',
        ...query.startDate === undefined && query.endDate === undefined
          ? {}
          : { date: `${query.startDate?.slice(0, 4) ?? ''}:${query.endDate?.slice(0, 4) ?? ''}` },
      },
    }, signal)
    if (!Array.isArray(response.data) || response.data.length < 2) {
      throw new FinanceDataError('World Bank returned an unexpected envelope', 'MACRO_SOURCE_FAILED')
    }
    const rows = response.data[1]
    if (!Array.isArray(rows)) {
      throw new FinanceDataError('World Bank returned no observation rows', 'MACRO_SOURCE_FAILED')
    }
    return rows.flatMap((row) => {
      const entry = record(row)
      const date = entry?.date
      const value = finite(entry?.value)
      if (typeof date !== 'string' || value === undefined) return []
      return [{ date, value }]
    })
  }
}

/** IMF DataMapper indicator series. */
export class ImfMacroLoader implements MacroSeriesLoader {
  readonly id = 'imf' as const

  /** @param transport - Shared HTTP transport. */
  constructor(private readonly transport: MacroHttpTransport) {}

  /**
   * Load one IMF DataMapper indicator for one country.
   * @param query - Catalog request whose binding names the indicator and country code.
   * @param signal - optional caller cancellation.
   * @returns Observations in ascending year order.
   */
  async load(query: MacroSeriesQuery, signal?: AbortSignal): Promise<readonly MacroObservation[]> {
    const binding = query.indicator.sources.imf
    if (binding === undefined) {
      throw new FinanceDataError(`${query.indicator.id} has no IMF indicator`, 'MACRO_SOURCE_UNAVAILABLE')
    }
    const response = await this.transport.request({
      base: 'imf',
      path: `/${binding.indicator}`,
      query: {},
    }, signal)
    const values = record(record(response.data)?.values)
    const byCountry = record(values?.[binding.indicator])
    const years = record(byCountry?.[binding.country])
    if (years === undefined) {
      throw new FinanceDataError(`IMF returned no ${binding.country} series for ${binding.indicator}`, 'MACRO_SOURCE_FAILED')
    }
    return Object.entries(years).flatMap(([year, value]) => {
      const parsed = finite(value)
      if (parsed === undefined) return []
      return [{ date: year, value: parsed }]
    })
  }
}
