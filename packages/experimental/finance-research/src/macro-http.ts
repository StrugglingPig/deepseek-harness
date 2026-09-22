/** REST macro loaders: FRED, World Bank, IMF DataMapper, EIA, and CFTC. */

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

/** EIA API v2 energy series, addressed through the `seriesid` route. */
export class EiaMacroLoader implements MacroSeriesLoader {
  readonly id = 'eia' as const

  /**
   * @param transport - Shared HTTP transport.
   * @param enabled - Whether credentialed EIA requests are switched on in settings.
   */
  constructor(
    private readonly transport: MacroHttpTransport,
    private readonly enabled: () => boolean,
  ) {}

  /**
   * Load one EIA series.
   * @param query - Catalog request whose binding names the EIA series id.
   * @param signal - optional caller cancellation.
   * @returns Observations in upstream order.
   */
  async load(query: MacroSeriesQuery, signal?: AbortSignal): Promise<readonly MacroObservation[]> {
    const seriesId = query.indicator.sources.eia?.seriesId
    if (seriesId === undefined) {
      throw new FinanceDataError(`${query.indicator.id} has no EIA series`, 'MACRO_SOURCE_UNAVAILABLE')
    }
    if (!this.enabled()) {
      throw new FinanceDataError('EIA macro requests are disabled in settings', 'MACRO_SOURCE_DISABLED')
    }
    const response = await this.transport.request({
      base: 'eia',
      path: `/seriesid/${seriesId}`,
      query: {},
      auth: 'api-key',
    }, signal)
    // EIA returns one row per period, newest first, with the value as a number
    // or a blank string; the series is oldest-first like every other loader.
    const rows = record(record(response.data)?.response)?.data
    if (!Array.isArray(rows)) {
      throw new FinanceDataError('EIA returned no data rows', 'MACRO_SOURCE_FAILED')
    }
    const observations = rows.flatMap((row) => {
      const entry = record(row)
      const date = entry?.period
      const value = finite(entry?.value)
      if (typeof date !== 'string' || value === undefined) return []
      return [{ date, value }]
    })
    return observations.sort((left, right) => left.date.localeCompare(right.date))
  }
}

/** CFTC Commitments of Traders weekly net positioning. */
export class CftcMacroLoader implements MacroSeriesLoader {
  readonly id = 'cftc' as const

  /** @param transport - Shared HTTP transport. */
  constructor(private readonly transport: MacroHttpTransport) {}

  /**
   * Load one market's weekly non-commercial net position.
   * @param query - Catalog request whose binding names the CFTC market.
   * @param signal - optional caller cancellation.
   * @returns Observations in ascending report-date order.
   */
  async load(query: MacroSeriesQuery, signal?: AbortSignal): Promise<readonly MacroObservation[]> {
    const market = query.indicator.sources.cftc?.market
    if (market === undefined) {
      throw new FinanceDataError(`${query.indicator.id} has no CFTC market`, 'MACRO_SOURCE_UNAVAILABLE')
    }
    const response = await this.transport.request({
      base: 'cftc',
      path: '/resource/6dca-aqww.json',
      query: {
        $where: `market_and_exchange_names='${market}'`,
        $order: 'report_date_as_yyyy_mm_dd DESC',
        $limit: '26',
      },
    }, signal)
    if (!Array.isArray(response.data)) {
      throw new FinanceDataError('CFTC returned no report rows', 'MACRO_SOURCE_FAILED')
    }
    const observations = response.data.flatMap((row) => {
      const entry = record(row)
      const reportDate = entry?.report_date_as_yyyy_mm_dd
      const long = finite(entry?.noncomm_positions_long_all)
      const short = finite(entry?.noncomm_positions_short_all)
      if (typeof reportDate !== 'string' || long === undefined || short === undefined) return []
      return [{ date: reportDate.slice(0, 10), value: long - short }]
    })
    return observations.sort((left, right) => left.date.localeCompare(right.date))
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

  /**
   * @param transport - Shared HTTP transport.
   * @param now - Clock deciding which published years are projections.
   */
  constructor(
    private readonly transport: MacroHttpTransport,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
    // The DataMapper panel mixes outcomes with WEO projections: mark every year
    // after the current one so a report cannot quote a forecast as an outcome.
    const currentYear = this.now().getUTCFullYear()
    return Object.entries(years).flatMap(([year, value]) => {
      const parsed = finite(value)
      if (parsed === undefined) return []
      const numericYear = Number(year)
      return [{
        date: year,
        value: parsed,
        ...Number.isFinite(numericYear) && numericYear > currentYear ? { projection: true } : {},
      }]
    })
  }
}
