/** Model-facing macro tools: the indicator catalog and one routed snapshot call. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FinanceDataError } from './error.ts'
import { exportResearchReport } from './export.ts'
import { buildMacroReport } from './macro-report.ts'
import type { ReportLanguage } from './report-language.ts'
import {
  MACRO_CATEGORIES, MACRO_COUNTRIES, MACRO_INDICATORS, MACRO_SOURCES, macroIndicatorById, macroIndicatorsMatching, macroSourcesOf,
  type MacroCategory, type MacroCountry, type MacroIndicator, type MacroSourceId,
} from './macro-catalog.ts'
import type { FinanceMacroDataProvider, MacroObservation, MacroSeries } from './macro.ts'

/** Maximum catalog series one snapshot call may fan out to. */
const MAX_MACRO_INDICATORS = 12
/** Maximum catalog series one macro report loads. */
const MAX_MACRO_REPORT_SERIES = 36
/** Series one country contributes to a report, so no country can starve the others. */
const MACRO_REPORT_PER_COUNTRY = 12

/** One observation as returned to the model. */
interface MacroObservationValue {
  readonly date: string
  readonly value: number
  readonly projection?: boolean
}

/** One series as returned to the model. */
interface MacroSeriesValue {
  readonly indicator: string
  readonly name: string
  readonly name_zh: string
  readonly category: string
  readonly country: string
  readonly unit: string
  readonly frequency: string
  readonly timing: string
  readonly source: string
  readonly latest: MacroObservationValue
  /** True when the latest published value is a projection rather than an outcome. */
  readonly latest_projection: boolean
  readonly previous?: MacroObservationValue
  readonly change?: number
  readonly change_percent?: number
  readonly observations: MacroObservationValue[]
}

/**
 * Project one observation into the tool payload.
 * @param observation - Normalized observation.
 * @returns The model-facing value.
 */
function observationValue(observation: MacroObservation): MacroObservationValue {
  return {
    date: observation.date,
    value: observation.value,
    ...observation.projection === true ? { projection: true } : {},
  }
}

/**
 * Project one loaded series into the tool payload.
 * @param series - Normalized series.
 * @returns The model-facing value.
 */
export function macroSeriesValue(series: MacroSeries): MacroSeriesValue {
  const previous = series.previous
  const change = previous === undefined ? undefined : series.latest.value - previous.value
  const changePercent = previous === undefined || change === undefined || previous.value === 0
    ? undefined
    : change / Math.abs(previous.value) * 100
  return {
    indicator: series.indicator,
    name: series.name,
    name_zh: series.nameZh,
    category: series.category,
    country: series.country,
    unit: series.unit,
    frequency: series.frequency,
    timing: series.timing,
    source: series.source,
    latest: observationValue(series.latest),
    latest_projection: series.latest.projection === true,
    ...previous === undefined ? {} : { previous: observationValue(previous) },
    ...change === undefined ? {} : { change },
    ...changePercent === undefined ? {} : { change_percent: changePercent },
    observations: series.observations.map(observation => observationValue(observation)),
  }
}

/** Output schema of one observation. */
const OBSERVATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    date: { type: 'string', required: true },
    value: { type: 'number', required: true },
    projection: { type: 'boolean' },
  },
} as const

/** Output schema of one series. */
const SERIES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    indicator: { type: 'string', required: true },
    name: { type: 'string', required: true },
    name_zh: { type: 'string', required: true },
    category: { type: 'string', required: true },
    country: { type: 'string', required: true },
    unit: { type: 'string', required: true },
    frequency: { type: 'string', required: true },
    timing: { type: 'string', required: true },
    source: { type: 'string', required: true },
    latest: { ...OBSERVATION_SCHEMA, required: true },
    latest_projection: { type: 'boolean', required: true },
    previous: OBSERVATION_SCHEMA,
    change: { type: 'number' },
    change_percent: { type: 'number' },
    observations: { type: 'array', required: true, items: OBSERVATION_SCHEMA },
  },
} as const

/** Most indicators read at once; each one fans out to every upstream it is bound to. */
const MACRO_LOAD_CONCURRENCY = 6

/** One indicator read, tagged so failures stay attributable after a parallel run. */
type MacroLoadOutcome =
  | { readonly ok: true; readonly series: MacroSeries }
  | { readonly ok: false; readonly failure: { indicator: string; message: string } }

/**
 * Read every indicator with a bounded number of in-flight requests.
 * @param provider - Macro provider that routes each series to an upstream.
 * @param entries - Indicators to read, in the order the caller wants them back.
 * @param limit - Observations kept per series.
 * @returns One outcome per entry, positionally matched to `entries`.
 */
async function loadIndicators(
  provider: FinanceMacroDataProvider,
  entries: readonly MacroIndicator[],
  limit: number,
): Promise<MacroLoadOutcome[]> {
  const outcomes = new Array<MacroLoadOutcome>(entries.length)
  let next = 0
  const workers = Array.from({ length: Math.min(MACRO_LOAD_CONCURRENCY, entries.length) }, async () => {
    for (;;) {
      const index = next
      next += 1
      const entry = entries[index]
      if (entry === undefined) return
      try {
        outcomes[index] = { ok: true, series: await provider.load({ indicator: entry, country: entry.country, limit }) }
      } catch (error: unknown) {
        outcomes[index] = { ok: false, failure: { indicator: entry.id, message: error instanceof Error ? error.message : String(error) } }
      }
    }
  })
  await Promise.all(workers)
  return outcomes
}

/**
 * Load the series one macro report covers.
 * @param provider - Macro provider that routes each series to an upstream.
 * @param countries - Countries to cover.
 * @param categories - Optional category narrowing.
 * @param limit - Observations kept per series.
 * @returns Loaded series and per-indicator failures.
 */
async function loadReportSeries(
  provider: FinanceMacroDataProvider,
  countries: readonly MacroCountry[],
  categories: readonly MacroCategory[],
  limit: number,
): Promise<{ series: MacroSeries[]; failures: { indicator: string; message: string }[] }> {
  // Catalog order is category-clustered, so a flat slice would fill a report with
  // one country's first categories. Pick round-robin across categories instead,
  // which keeps every report section populated and every country represented.
  const entries = countries.flatMap((country) => {
    const buckets = new Map<MacroCategory, MacroIndicator[]>()
    for (const entry of macroIndicatorsMatching({ country })) {
      if (categories.length > 0 && !categories.includes(entry.category)) continue
      const bucket = buckets.get(entry.category) ?? []
      bucket.push(entry)
      buckets.set(entry.category, bucket)
    }
    const picked: MacroIndicator[] = []
    let progressed = true
    while (picked.length < MACRO_REPORT_PER_COUNTRY && progressed) {
      progressed = false
      for (const bucket of buckets.values()) {
        const next = bucket.shift()
        if (next === undefined) continue
        picked.push(next)
        progressed = true
        if (picked.length >= MACRO_REPORT_PER_COUNTRY) break
      }
    }
    return picked
  }).slice(0, MAX_MACRO_REPORT_SERIES)
  const series: MacroSeries[] = []
  const failures: { indicator: string; message: string }[] = []
  for (const outcome of await loadIndicators(provider, entries, limit)) {
    if (outcome.ok) series.push(outcome.series)
    else failures.push(outcome.failure)
  }
  return { series, failures }
}

/** Series every research report carries as its macro precondition. */
export const MACRO_REPORT_CONTEXT_IDS: readonly string[] = [
  'us-fed-funds-rate', 'us-10y-yield', 'us-yield-curve-10y2y', 'us-hy-credit-spread',
  'us-core-pce', 'us-unemployment-rate',
  'cn-cpi', 'cn-ppi', 'cn-policy-rate', 'cn-social-financing',
  'global-gdp-growth', 'global-inflation',
]

/**
 * Load the macro series a research report quotes as its precondition.
 * @param provider - Macro provider that routes each series to an upstream.
 * @param limit - Observations kept per series.
 * @returns The series that loaded; failures are dropped so a report still builds.
 */
export async function loadMacroContext(
  provider: FinanceMacroDataProvider,
  limit = 6,
): Promise<MacroSeries[]> {
  const wanted = new Set(MACRO_REPORT_CONTEXT_IDS)
  const entries = MACRO_INDICATORS.filter(entry => wanted.has(entry.id))
  const outcomes = await loadIndicators(provider, entries, limit)
  // A macro precondition that an upstream cannot serve must not block the asset
  // report; the missing series simply does not appear in the context.
  return outcomes.flatMap(outcome => outcome.ok ? [outcome.series] : [])
}

/**
 * Register the macro catalog, snapshot, and report tools.
 * @param ctx - Registrant context carrying the tool registry.
 * @param provider - Macro provider that routes each series to an upstream.
 * @param reportLanguage - Resolves the configured report language.
 */
export function registerMacroTools(
  ctx: Context,
  provider: FinanceMacroDataProvider,
  reportLanguage: () => ReportLanguage = () => 'en',
): void {
  ctx.tools.register(defineTool({
    name: 'finance_macro_catalog',
    description: 'List the macro indicator catalog: category, country, unit, frequency, cycle timing, transmission reading, affected assets, and the upstreams that can serve each series. Use it before finance_macro_snapshot to pick indicator ids.',
    parameters: {
      category: { type: 'string', description: `Optional category filter: ${MACRO_CATEGORIES.join(', ')}.` },
      country: { type: 'string', description: `Optional country filter: ${MACRO_COUNTRIES.join(', ')}.` },
      source: { type: 'string', description: `Optional upstream filter: ${MACRO_SOURCES.join(', ')}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                name_zh: { type: 'string', required: true },
                category: { type: 'string', required: true },
                country: { type: 'string', required: true },
                unit: { type: 'string', required: true },
                frequency: { type: 'string', required: true },
                timing: { type: 'string', required: true },
                reading: { type: 'string', required: true },
                affected_assets: { type: 'array', required: true, items: { type: 'string' } },
                sources: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const entries = macroIndicatorsMatching({
        ...args.category === undefined ? {} : { category: args.category as never },
        ...args.country === undefined ? {} : { country: args.country as never },
        ...args.source === undefined ? {} : { source: args.source as never },
      }).map(entry => ({
        id: entry.id,
        name: entry.name,
        name_zh: entry.nameZh,
        category: entry.category,
        country: entry.country,
        unit: entry.unit,
        frequency: entry.frequency,
        timing: entry.timing,
        reading: entry.reading,
        affected_assets: [...entry.affectedAssets],
        sources: [...macroSourcesOf(entry)],
      }))
      return Promise.resolve({ entries })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'finance_macro_snapshot',
    description: 'Read macro series from AKShare, FRED, the World Bank, or the IMF DataMapper. Pass catalog indicator ids, or a category and country (no filter returns the catalog head), and choose source=auto to let the catalog order the upstreams. Each series returns its latest value, change, unit, and observation history. Output is upstream-as-published: quarterly and annual series are not resampled.',
    parameters: {
      indicators: { type: 'array', items: { type: 'string' }, description: `Catalog indicator ids, at most ${String(MAX_MACRO_INDICATORS)} per call.` },
      category: { type: 'string', description: `Category filter when indicators are omitted: ${MACRO_CATEGORIES.join(', ')}.` },
      country: { type: 'string', description: `Country filter when indicators are omitted: ${MACRO_COUNTRIES.join(', ')}.` },
      source: { type: 'string', description: `Upstream: auto (default) or ${MACRO_SOURCES.join(', ')}.` },
      start_date: { type: 'string', description: 'Optional inclusive lower bound for observation dates, as published upstream (YYYY, YYYY-MM, or YYYY-MM-DD).' },
      end_date: { type: 'string', description: 'Optional inclusive upper bound for observation dates.' },
      limit: { type: 'integer', description: 'Maximum observations kept per series, newest last. Defaults to 60.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          series: { type: 'array', required: true, items: SERIES_SCHEMA },
          errors: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                indicator: { type: 'string', required: true },
                message: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const source = (args.source ?? 'auto') as MacroSourceId | 'auto'
      let entries = args.indicators === undefined || args.indicators.length === 0
        ? macroIndicatorsMatching({
          ...args.category === undefined ? {} : { category: args.category as never },
          ...args.country === undefined ? {} : { country: args.country as never },
          ...source === 'auto' ? {} : { source },
        })
        : args.indicators.map((id) => {
          const entry = macroIndicatorById(id)
          if (entry === undefined) {
            throw new FinanceDataError(`unknown macro indicator "${id}"; call finance_macro_catalog for ids`, 'MACRO_UNKNOWN_INDICATOR')
          }
          return entry
        })
      if (entries.length === 0) {
        throw new FinanceDataError('no macro indicator matches the requested filter', 'MACRO_NO_MATCH')
      }
      if (entries.length > MAX_MACRO_INDICATORS) entries = entries.slice(0, MAX_MACRO_INDICATORS)
      const limit = args.limit ?? 60
      const series: MacroSeriesValue[] = []
      const errors: { indicator: string; message: string }[] = []
      for (const entry of entries) {
        try {
          const loaded = await provider.load({
            indicator: entry,
            country: entry.country,
            source,
            ...args.start_date === undefined ? {} : { startDate: args.start_date },
            ...args.end_date === undefined ? {} : { endDate: args.end_date },
            limit,
          })
          series.push(macroSeriesValue(loaded))
        } catch (error: unknown) {
          errors.push({
            indicator: entry.id,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      return { series, errors }
    },
  }))

  const reportParameters = {
    countries: { type: 'array', items: { type: 'string' }, description: `Countries to cover; defaults to all of ${MACRO_COUNTRIES.join(', ')}.` },
    categories: { type: 'array', items: { type: 'string' }, description: `Optional category narrowing: ${MACRO_CATEGORIES.join(', ')}.` },
    limit: { type: 'integer', description: 'Observations kept per series. Defaults to 12.' },
    title: { type: 'string', description: 'Optional report title override.' },
  } as const
  const reportSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', required: true },
      as_of: { type: 'string', required: true },
      report_type: { type: 'string', required: true },
      markdown: { type: 'string', required: true },
      html: { type: 'string', required: true },
      series_count: { type: 'integer', required: true },
      failures: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            indicator: { type: 'string', required: true },
            message: { type: 'string', required: true },
          },
        },
      },
    },
  } as const

  /** Resolve the countries a report call asked for. */
  const reportCountries = (requested: readonly string[] | undefined): MacroCountry[] =>
    requested === undefined || requested.length === 0
      ? [...MACRO_COUNTRIES]
      : requested.flatMap((country) => {
        const resolved = MACRO_COUNTRIES.find(candidate => candidate === country)
        if (resolved === undefined) {
          throw new FinanceDataError(`unknown macro country "${country}"`, 'MACRO_UNKNOWN_COUNTRY')
        }
        return [resolved]
      })

  ctx.tools.register(defineTool({
    name: 'finance_macro_report',
    description: 'Compose a data-backed macro report for China, the United States, and global aggregates: growth, inflation, employment, demand, money and credit, fiscal, external, and market transmission sections built from the live upstream series, with a coverage and gaps section. Returns self-contained Markdown and HTML.',
    parameters: reportParameters,
    output: {
      schema: reportSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const loaded = await loadReportSeries(
        provider,
        reportCountries(args.countries),
        (args.categories ?? []) as MacroCategory[],
        args.limit ?? 12,
      )
      if (loaded.series.length === 0) {
        throw new FinanceDataError('no macro series loaded for the requested scope', 'MACRO_REPORT_EMPTY')
      }
      const report = buildMacroReport({
        language: reportLanguage() === 'zh' ? 'zh' : 'en',
        asOf: new Date().toISOString(),
        series: loaded.series,
        failures: loaded.failures,
      }, args.title)
      return {
        title: report.title,
        as_of: report.asOf,
        report_type: report.reportType,
        markdown: report.markdown,
        html: report.html,
        series_count: loaded.series.length,
        failures: loaded.failures,
      }
    },
  }))

  ctx.inject(['fs'], (fsCtx) => {
    ctx.tools.register(defineTool({
      name: 'finance_macro_report_export',
      description: 'Compose the data-backed macro report and persist both Markdown and self-contained HTML in the workspace.',
      parameters: {
        ...reportParameters,
        output_dir: { type: 'string', description: 'Workspace-relative output directory.', default: '.artifacts/finance-reports' },
        basename: { type: 'string', description: 'Optional file stem.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', required: true },
            as_of: { type: 'string', required: true },
            series_count: { type: 'integer', required: true },
            markdown_path: { type: 'string', required: true },
            html_path: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args) {
        const loaded = await loadReportSeries(
          provider,
          reportCountries(args.countries),
          (args.categories ?? []) as MacroCategory[],
          args.limit ?? 12,
        )
        if (loaded.series.length === 0) {
          throw new FinanceDataError('no macro series loaded for the requested scope', 'MACRO_REPORT_EMPTY')
        }
        const report = buildMacroReport({
          language: reportLanguage() === 'zh' ? 'zh' : 'en',
          asOf: new Date().toISOString(),
          series: loaded.series,
          failures: loaded.failures,
        }, args.title)
        const files = await exportResearchReport(
          fsCtx.fs,
          report,
          args.output_dir ?? '.artifacts/finance-reports',
          args.basename,
        )
        return {
          title: report.title,
          as_of: report.asOf,
          series_count: loaded.series.length,
          markdown_path: files.markdown,
          html_path: files.html,
        }
      },
    }))
  })
}
