/** Model-facing macro tools: the indicator catalog and one routed snapshot call. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FinanceDataError } from './error.ts'
import {
  MACRO_CATEGORIES, MACRO_COUNTRIES, MACRO_SOURCES, macroIndicatorById, macroIndicatorsMatching, macroSourcesOf,
  type MacroSourceId,
} from './macro-catalog.ts'
import type { FinanceMacroDataProvider, MacroSeries } from './macro.ts'

/** Maximum catalog series one snapshot call may fan out to. */
const MAX_MACRO_INDICATORS = 12

/** One observation as returned to the model. */
interface MacroObservationValue {
  readonly date: string
  readonly value: number
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
  readonly previous?: MacroObservationValue
  readonly change?: number
  readonly change_percent?: number
  readonly observations: MacroObservationValue[]
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
    latest: { date: series.latest.date, value: series.latest.value },
    ...previous === undefined ? {} : { previous: { date: previous.date, value: previous.value } },
    ...change === undefined ? {} : { change },
    ...changePercent === undefined ? {} : { change_percent: changePercent },
    observations: series.observations.map(observation => ({ date: observation.date, value: observation.value })),
  }
}

/** Output schema of one observation. */
const OBSERVATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    date: { type: 'string', required: true },
    value: { type: 'number', required: true },
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
    previous: OBSERVATION_SCHEMA,
    change: { type: 'number' },
    change_percent: { type: 'number' },
    observations: { type: 'array', required: true, items: OBSERVATION_SCHEMA },
  },
} as const

/**
 * Register the macro catalog and snapshot tools.
 * @param ctx - Registrant context carrying the tool registry.
 * @param provider - Macro provider that routes each series to an upstream.
 */
export function registerMacroTools(ctx: Context, provider: FinanceMacroDataProvider): void {
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
}
