import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { macroIndicatorById, type MacroIndicator } from '../src/macro-catalog.ts'
import { registerMacroTools } from '../src/macro-tools.ts'
import type { FinanceMacroDataProvider, MacroSeries } from '../src/macro.ts'

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function seriesFor(indicator: MacroIndicator, values: readonly number[]): MacroSeries {
  const observations = values.map((value, index) => ({ date: `2026-${String(index + 1).padStart(2, '0')}`, value }))
  return {
    indicator: indicator.id,
    name: indicator.name,
    nameZh: indicator.nameZh,
    category: indicator.category,
    country: indicator.country,
    unit: indicator.unit,
    frequency: indicator.frequency,
    timing: indicator.timing,
    reading: indicator.reading,
    affectedAssets: indicator.affectedAssets,
    source: 'fred',
    observations,
    latest: observations[observations.length - 1] as { date: string; value: number },
    previous: observations.length > 1 ? observations[observations.length - 2] : undefined,
    retrievedAt: '2026-09-21T00:00:00.000Z',
  }
}

async function bench(provider?: Partial<FinanceMacroDataProvider>) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const calls: { indicator: string; limit?: number; start?: string; end?: string; source?: string }[] = []
  const macro: FinanceMacroDataProvider = {
    id: 'macro-test',
    async load(query) {
      calls.push({
        indicator: query.indicator.id,
        ...query.limit === undefined ? {} : { limit: query.limit },
        ...query.startDate === undefined ? {} : { start: query.startDate },
        ...query.endDate === undefined ? {} : { end: query.endDate },
        ...query.source === undefined ? {} : { source: query.source },
      })
      if (provider?.load !== undefined) return provider.load(query)
      return seriesFor(query.indicator, [1, 2])
    },
  }
  registerMacroTools(ctx, macro)
  return { ctx, calls }
}

async function execute(ctx: Context, name: string, args: Record<string, unknown>) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: `${name}-call` as never,
    name,
    arguments: args,
  })
}

describe('finance_macro_catalog', () => {
  it('lists every indicator with its metadata and upstreams', async () => {
    const { ctx } = await bench()
    const result = await execute(ctx, 'finance_macro_catalog', {})
    expect(result.isError).toBe(false)
    const entries = (JSON.parse(textOf(result)) as {
      entries: { id: string; sources: string[]; reading: string }[]
    }).entries
    expect(entries.length).toBeGreaterThan(40)
    expect(entries[0]?.id).toBe('cn-gdp-growth')
    expect(entries[0]?.sources).toEqual(['akshare', 'worldbank', 'imf'])
    expect(entries[0]?.reading).toContain('cyclicals')
  })

  it('filters by category, country, and source', async () => {
    const { ctx } = await bench()
    const result = await execute(ctx, 'finance_macro_catalog', { category: 'market', country: 'us', source: 'fred' })
    const entries = (JSON.parse(textOf(result)) as {
      entries: { category: string; country: string }[]
    }).entries
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every(entry => entry.category === 'market' && entry.country === 'us')).toBe(true)
  })
})

describe('finance_macro_snapshot', () => {
  it('loads named indicators with the default window and reports changes', async () => {
    const { ctx, calls } = await bench()
    const result = await execute(ctx, 'finance_macro_snapshot', { indicators: ['us-cpi', 'cn-pmi'] })
    expect(result.isError).toBe(false)
    const payload = JSON.parse(textOf(result)) as {
      series: { indicator: string; latest: { value: number }; previous?: { value: number }; change?: number; change_percent?: number }[]
      errors: unknown[]
    }
    expect(payload.series.map(entry => entry.indicator)).toEqual(['us-cpi', 'cn-pmi'])
    expect(payload.series[0]?.change).toBe(1)
    expect(payload.series[0]?.change_percent).toBe(100)
    expect(payload.errors).toEqual([])
    expect(calls[0]?.limit).toBe(60)
    expect(calls[0]?.source).toBe('auto')
  })

  it('accepts a category and country filter with an explicit source and window', async () => {
    const { ctx, calls } = await bench()
    const result = await execute(ctx, 'finance_macro_snapshot', {
      category: 'policy',
      country: 'cn',
      source: 'akshare',
      limit: 5,
      start_date: '2020-01-01',
      end_date: '2026-01-01',
    })
    expect(result.isError).toBe(false)
    const payload = JSON.parse(textOf(result)) as { series: { indicator: string }[] }
    expect(payload.series.every(entry => entry.indicator.startsWith('cn-'))).toBe(true)
    expect(calls[0]).toMatchObject({ limit: 5, start: '2020-01-01', end: '2026-01-01', source: 'akshare' })
  })

  it('caps the fan-out at the documented maximum', async () => {
    const { ctx, calls } = await bench()
    // No filter walks the whole catalog and stops at the documented cap.
    const result = await execute(ctx, 'finance_macro_snapshot', {})
    expect(result.isError).toBe(false)
    expect(calls.length).toBe(12)
  })

  it('rejects unknown ids and empty filters, and records per-indicator failures', async () => {
    const { ctx } = await bench()
    const unknown = await execute(ctx, 'finance_macro_snapshot', { indicators: ['nope'] })
    expect(unknown.isError).toBe(true)
    expect(textOf(unknown)).toContain('unknown macro indicator')

    const empty = await execute(ctx, 'finance_macro_snapshot', { category: 'market', country: 'cn' })
    expect(empty.isError).toBe(true)
    expect(textOf(empty)).toContain('no macro indicator matches')

    const thrownString = await bench({
      async load() { throw 'plain failure' },
    })
    const stringFailure = await execute(thrownString.ctx, 'finance_macro_snapshot', { indicators: ['us-cpi'] })
    const stringPayload = JSON.parse(textOf(stringFailure)) as { errors: { message: string }[] }
    expect(stringPayload.errors[0]?.message).toContain('plain failure')

    const failing = await bench({
      async load() { throw new Error('upstream is down') },
    })
    const partial = await execute(failing.ctx, 'finance_macro_snapshot', { indicators: ['us-cpi'] })
    expect(partial.isError).toBe(false)
    const payload = JSON.parse(textOf(partial)) as { series: unknown[]; errors: { message: string }[] }
    expect(payload.series).toEqual([])
    expect(payload.errors[0]?.message).toContain('upstream is down')
  })

  it('omits the change fields when a series has a single observation at a zero baseline', async () => {
    const { ctx } = await bench()
    const single = await bench({
      async load(query) { return seriesFor(query.indicator, [0]) },
    })
    const result = await execute(single.ctx, 'finance_macro_snapshot', { indicators: ['us-cpi'] })
    const payload = JSON.parse(textOf(result)) as { series: Record<string, unknown>[] }
    expect(payload.series[0]?.previous).toBeUndefined()
    expect(payload.series[0]?.change).toBeUndefined()
    expect(payload.series[0]?.change_percent).toBeUndefined()
    expect(macroIndicatorById('us-cpi')?.nameZh).toBe('美国 CPI')
    expect(ctx).toBeDefined()
  })
})
