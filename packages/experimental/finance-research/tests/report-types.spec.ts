import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { fixtureProvider } from '../src/data.ts'
import { registerFinanceTools } from '../src/index.ts'
import { REPORT_COPY } from '../src/report-copy.ts'
import { buildResearchReport } from '../src/report.ts'
import { REPORT_TYPES } from '../src/report-types.ts'

const INPUT_BLOCKS = [
  'valuation-framework', 'financial-quality', 'earnings-review', 'event-context', 'industry-landscape',
  'competitive-position', 'macro-drivers', 'rates-credit', 'commodity-balance', 'fx-drivers',
  'fund-flows', 'onchain-tokenomics',
] as const

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('finance report types', () => {
  it('covers every category and form with unique ids', () => {
    const ids = REPORT_TYPES.map(type => type.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(REPORT_TYPES).toHaveLength(33)
    expect(new Set(REPORT_TYPES.map(type => type.category)).size).toBe(8)
    for (const type of REPORT_TYPES) {
      expect(type.sections.length).toBeGreaterThanOrEqual(5)
      expect(new Set(type.sections).size).toBe(type.sections.length)
    }
  })

  it('renders every report type with its own section plan', async () => {
    for (const type of REPORT_TYPES) {
      const report = await buildResearchReport(fixtureProvider, { symbol: 'AAPL', reportType: type.id })
      expect(report.reportType).toBe(type.id)
      expect(report.sections).toHaveLength(type.sections.length)
      expect(report.title).toContain(REPORT_COPY.en.reportForms[type.form])
      for (const section of report.sections) {
        expect(section.title.length).toBeGreaterThan(0)
        expect(section.content.length).toBeGreaterThan(0)
      }
      expect(report.html).toContain(`data-report-type="${type.id}"`)
    }
  })

  it('renders degenerate price histories without undefined fields', async () => {
    const flat = {
      id: 'flat',
      async load(symbol: string) {
        return {
          instrument: { symbol, name: symbol, assetClass: 'equity' as const, currency: 'USD' },
          asOf: '2026-09-19T00:00:00.000Z',
          source: { provider: 'flat', retrievedAt: '2026-09-20T00:00:00.000Z', synthetic: false },
          quote: { price: 100, changePercent: 0 },
          bars: Array.from({ length: 60 }, (_, index) => ({
            timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
            open: 100, high: 100, low: 100, close: 100, volume: 0,
          })),
        }
      },
    }
    const flash = await buildResearchReport(flat, { symbol: 'FLAT', reportType: 'equity-flash' })
    expect(flash.markdown).toContain('Range position: 50.00%')
    expect(flash.markdown).toContain('Volume vs 20-bar mean: 0.00x')
    const allocation = await buildResearchReport(flat, { symbol: 'FLAT', reportType: 'strategy-allocation' })
    expect(allocation.markdown).toContain('Indicative position size: 100.00%')
    expect(allocation.markdown).toContain('Bull case (+2 ATR): 100.00 (0.00%)')
  })

  it('defaults to the family deep dive and honors explicit types', async () => {
    const equity = await buildResearchReport(fixtureProvider, { symbol: 'AAPL' })
    expect(equity.reportType).toBe('equity-deep-dive')
    const crypto = await buildResearchReport(fixtureProvider, { symbol: 'BTC' })
    expect(crypto.reportType).toBe('crypto-deep-dive')
    const prediction = await buildResearchReport(fixtureProvider, { symbol: 'PREDICTION:FED-CUT' })
    expect(prediction.reportType).toBe('strategy-deep-dive')
    expect(prediction.sections.some(section => section.title === 'Prediction Market')).toBe(true)
    const unknown = await buildResearchReport(fixtureProvider, { symbol: 'AAPL', reportType: 'not-a-type' })
    expect(unknown.reportType).toBe('equity-deep-dive')
    const earnings = await buildResearchReport(fixtureProvider, { symbol: 'AAPL', reportType: 'equity-earnings' })
    expect(earnings.sections.map(section => section.title)).toContain('Earnings Review')
    expect(earnings.sections.map(section => section.title)).toContain('Catalysts')
  })

  it('localizes report type names, focus lines, and input blocks', async () => {
    for (const type of REPORT_TYPES) {
      expect(REPORT_COPY.zh.reportCategories[type.category]?.name).toBeDefined()
      expect(REPORT_COPY.zh.reportForms[type.form]).toBeDefined()
    }
    for (const id of INPUT_BLOCKS) {
      expect(REPORT_COPY.en.blocks[id]?.requires.length).toBeGreaterThan(0)
      expect(REPORT_COPY.zh.blocks[id]?.checks.length).toBeGreaterThan(0)
    }
    const zh = await buildResearchReport(fixtureProvider, { symbol: 'AAPL', reportType: 'equity-earnings' }, undefined, 'zh')
    expect(zh.title).toContain('财报点评')
    expect(zh.markdown).toContain('## 业绩点评')
    expect(zh.markdown).toContain('所需输入：')
    expect(zh.markdown).toContain('## 催化剂')
  })

  it('lists the report type catalog through the tool surface', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    registerFinanceTools(ctx, fixtureProvider)
    const all = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'report-types' as never,
      name: 'finance_report_types',
      arguments: {},
    })
    expect(all.isError).toBe(false)
    const listed = JSON.parse(textOf(all)) as { types: { id: string; category: string; sections: string[] }[] }
    expect(listed.types).toHaveLength(REPORT_TYPES.length)
    expect(listed.types[0]?.sections.length).toBeGreaterThan(0)
    const typedContext = new Context()
    await typedContext.plugin(SystemPrompt)
    await typedContext.plugin(ToolRuntime)
    registerFinanceTools(typedContext, fixtureProvider)
    const typedReport = await typedContext.tools.execute({
      signal: new AbortController().signal,
      callId: 'typed-report-crypto' as never,
      name: 'finance_research_report',
      arguments: { symbol: 'BTC', report_type: 'crypto-weekly' },
    })
    expect(textOf(typedReport)).toContain('Crypto Weekly')
    await typedContext.fiber.dispose()

    const filtered = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'report-types-crypto' as never,
      name: 'finance_report_types',
      arguments: { category: 'crypto', form: 'weekly' },
    })
    const crypto = JSON.parse(textOf(filtered)) as { types: { id: string }[] }
    expect(crypto.types.map(type => type.id)).toEqual(['crypto-weekly'])
    await ctx.fiber.dispose()
  })
})
