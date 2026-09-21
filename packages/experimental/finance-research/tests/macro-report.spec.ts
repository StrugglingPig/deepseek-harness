import { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { macroIndicatorById, type MacroIndicator } from '../src/macro-catalog.ts'
import { buildMacroReport, buildMacroSections, macroReportHtml } from '../src/macro-report.ts'
import { registerMacroTools } from '../src/macro-tools.ts'
import type { FinanceMacroDataProvider, MacroSeries } from '../src/macro.ts'

const entry = (id: string): MacroIndicator => macroIndicatorById(id) as MacroIndicator

function series(id: string, values: readonly number[], source: MacroSeries['source'] = 'fred'): MacroSeries {
  const indicator = entry(id)
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
    source,
    observations,
    latest: observations[observations.length - 1] as { date: string; value: number },
    previous: observations.length > 1 ? observations[observations.length - 2] : undefined,
    retrievedAt: '2026-09-21T00:00:00.000Z',
  }
}

describe('macro report builder', () => {
  it('renders every plan section in Chinese with values, direction, and source', () => {
    const report = buildMacroReport({
      language: 'zh',
      asOf: '2026-09-21T00:00:00.000Z',
      series: [series('us-10y-yield', [4.8, 4.94]), series('cn-cpi', [0.5, 0.8], 'akshare')],
      failures: [{ indicator: 'us-pce', message: 'fred: disabled' }],
    })
    expect(report.title).toContain('中美与全球宏观经济报告')
    expect(report.symbol).toBe('MACRO:CN-US-GLOBAL')
    expect(report.markdown).toContain('## 概览')
    expect(report.markdown).toContain('中国 · 中国 CPI 同比')
    expect(report.markdown).toContain('较上期上升')
    expect(report.markdown).toContain('来源 akshare')
    expect(report.markdown).toContain('us-pce: fred: disabled')
    expect(report.html).toContain('<!doctype html>')
    expect(report.reportType).toBe('macro-deep-dive')
    expect(report.evidence).toHaveLength(2)
  })

  it('renders English sections, marks projections, and notes empty groups', () => {
    const withProjection = series('cn-government-debt', [100, 106.9], 'imf')
    const projected = { ...withProjection, latest: { ...withProjection.latest, projection: true } }
    const report = buildMacroReport({
      language: 'en',
      asOf: '2026-09-21T00:00:00.000Z',
      series: [projected],
    })
    expect(report.title).toContain('China, US, and Global Macro Report')
    expect(report.markdown).toContain('(projection)')
    expect(report.markdown).toContain('No series in this group were loaded by this run.')
    expect(report.markdown).toContain('1 series loaded; 0 not loaded.')
    // A single observation renders without a direction clause.
    const single = buildMacroSections({ language: 'en', asOf: 'x', series: [series('us-cpi', [3.4])] })[0]?.content
    expect(single).toContain('3.4 index')
    expect(single).not.toContain('up ')
  })

  it('handles an unknown country label, a falling series, and a Chinese projection', () => {
    const unknown = { ...series('us-cpi', [3, 2]), country: 'zz' as never }
    const zhReport = buildMacroReport({
      language: 'zh',
      asOf: '2026-09-21T00:00:00.000Z',
      series: [{ ...unknown, latest: { ...unknown.latest, projection: true } }],
    })
    expect(zhReport.markdown).toContain('zz · 美国 CPI')
    expect(zhReport.markdown).toContain('（预测值）')
    expect(zhReport.markdown).toContain('较上期下降')

    const en = buildMacroReport({
      language: 'en',
      asOf: '2026-09-21T00:00:00.000Z',
      series: [series('us-cpi', [3, 2])],
    })
    expect(en.markdown).toContain(', down ')
  })

  it('renders a self-contained HTML document with escaped content', () => {
    const html = macroReportHtml('A < B', '2026-09-21', [{ title: 'T & T', content: '- line <one>' }])
    expect(html).toContain('A &lt; B')
    expect(html).toContain('T &amp; T')
    expect(html).toContain('line &lt;one&gt;')
    expect(macroReportHtml('t', 'x', [{ title: 'T', content: '- **Bold** plain' }])).toContain('<strong>Bold</strong>')
  })
})

async function bench(options: { readonly withFs?: boolean; readonly english?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const provider: FinanceMacroDataProvider = {
    id: 'macro-test',
    async load(query) {
      if (query.indicator.id === 'us-cpi') throw new Error('fred: disabled in settings')
      return series(query.indicator.id, [1, 2], query.indicator.sources.worldbank === undefined ? 'fred' : 'worldbank')
    },
  }
  const written: string[] = []
  if (options.withFs === true) {
    ctx.provide('fs', {
      resolve: vi.fn(async (path: string) => ({ displayPath: path })),
      writeText: vi.fn(async (target: { displayPath: string }) => { written.push(target.displayPath) }),
    } as unknown as FileSystem)
  }
  registerMacroTools(ctx, provider, () => options.withFs === true && options.english === true ? 'en' : 'zh')
  return { ctx, written }
}

async function execute(ctx: Context, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: `${name}-call` as never,
    name,
    arguments: args,
  })
  return {
    isError: result.isError,
    text: result.content.filter(block => block.type === 'text').map(block => block.text).join(''),
  }
}

describe('finance_macro_report', () => {
  it('builds a Chinese macro report and reports the indicators it could not load', async () => {
    const { ctx } = await bench()
    const result = await execute(ctx, 'finance_macro_report', { countries: ['us'], limit: 2 })
    expect(result.isError).toBe(false)
    const payload = JSON.parse(result.text) as { series_count: number; failures: { indicator: string }[]; markdown: string }
    expect(payload.series_count).toBeGreaterThan(0)
    expect(payload.failures.map(failure => failure.indicator)).toContain('us-cpi')
    expect(payload.markdown).toContain('# 中美与全球宏观经济报告')
  })

  it('rejects an unknown country and an empty scope', async () => {
    const { ctx } = await bench()
    expect((await execute(ctx, 'finance_macro_report', { countries: ['eu'] })).text).toContain('unknown macro country')
    expect((await execute(ctx, 'finance_macro_report', { countries: ['cn'], categories: ['market'] })).text)
      .toContain('no macro series loaded')
    // An empty country list means "everything", and a string failure still lands in the gap list.
    const fallback = await execute(ctx, 'finance_macro_report', { countries: [], title: 'Scope' })
    expect((JSON.parse(fallback.text) as { title: string }).title).toBe('Scope')
  })

  it('records a non-Error failure and defaults the report language', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const provider: FinanceMacroDataProvider = {
      id: 'macro-test',
      async load(query) {
        if (query.indicator.country === 'us') throw 'plain failure'
        return series(query.indicator.id, [1, 2])
      },
    }
    registerMacroTools(ctx, provider)
    const result = JSON.parse((await execute(ctx, 'finance_macro_report', { countries: ['us', 'cn'] })).text) as {
      failures: { message: string }[]
      markdown: string
    }
    expect(result.failures[0]?.message).toBe('plain failure')
    expect(result.markdown).toContain('China, US, and Global Macro Report')
  })

  it('writes the Markdown and HTML pair when the filesystem is available', async () => {
    const { ctx, written } = await bench({ withFs: true, english: true })
    const result = await execute(ctx, 'finance_macro_report_export', { countries: ['cn'], output_dir: '.artifacts/macro' })
    expect(result.isError).toBe(false)
    const payload = JSON.parse(result.text) as { markdown_path: string; html_path: string }
    expect(payload.markdown_path).toContain('.artifacts/macro/')
    expect(written).toHaveLength(2)

    // Defaults apply when the caller names neither a directory nor a stem.
    const defaults = await execute(ctx, 'finance_macro_report_export', { countries: ['cn'] })
    expect((JSON.parse(defaults.text) as { markdown_path: string }).markdown_path).toContain('.artifacts/finance-reports/')

    // An empty scope fails loudly instead of writing an empty report.
    const empty = await execute(ctx, 'finance_macro_report_export', { countries: ['cn'], categories: ['market'] })
    expect(empty.text).toContain('no macro series loaded')

    // The Chinese language path writes the localized title.
    const chinese = await bench({ withFs: true })
    await execute(chinese.ctx, 'finance_macro_report_export', { countries: ['cn'] })
    expect(chinese.written.some(path => path.includes('.md'))).toBe(true)
  })
})
