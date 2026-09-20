import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { SubprocessFinanceStockDataProvider, registerStockTools } from '../src/stock.ts'
import type { FinanceStockBridge } from '../src/stock.ts'

function bars(length = 60): Record<string, number | string>[] {
  return Array.from({ length }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    open: 10 + index,
    high: 11 + index,
    low: 9 + index,
    close: 10.5 + index,
    volume: 1_000 + index,
  }))
}

function bridge(): FinanceStockBridge {
  return {
    async run(request) {
      if (request.action === 'stock_history') {
        return { symbol: request.symbol, name: '贵州茅台', bars: bars() }
      }
      return {
        quotes: [{
          symbol: '600519',
          name: '贵州茅台',
          currency: 'CNY',
          asOf: '2026-09-20T10:00:00.000Z',
          source: request.provider,
          price: 1_500,
          changePercent: 1.25,
          open: 1_480,
        }, {
          symbol: '000002',
          currency: 'CNY',
          asOf: '2026-09-20T10:00:00.000Z',
          source: request.provider,
        }, {
          symbol: '000001',
          currency: 'CNY',
          asOf: '2026-09-20T10:00:00.000Z',
          source: request.provider,
          price: 12,
          changePercent: -0.5,
          change: -0.06,
          open: 12.1,
          high: 12.2,
          low: 11.9,
          previousClose: 12.06,
          volume: 100,
          amount: 1_200,
        }],
      }
    },
  }
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('SubprocessFinanceStockDataProvider', () => {
  it('normalizes history and quotes for AKShare and iFinD', async () => {
    const provider = new SubprocessFinanceStockDataProvider(bridge(), { now: () => new Date('2026-09-20T10:00:00.000Z') })
    const snapshot = await provider.loadStockSnapshot({
      provider: 'akshare', symbol: '600519', startDate: '2026-01-01', endDate: '2026-09-20', adjust: 'qfq',
    })
    expect(snapshot).toMatchObject({
      instrument: { symbol: '600519', name: '贵州茅台', assetClass: 'equity', currency: 'CNY' },
      source: { provider: 'akshare', synthetic: false },
      quote: { price: 69.5 },
    })
    expect(snapshot.bars).toHaveLength(60)

    await expect(provider.loadStockQuotes({ provider: 'ifind', symbols: ['600519'] }))
      .resolves.toMatchObject([
        { symbol: '600519', price: 1_500, source: 'ifind' },
        { symbol: '000002', price: undefined, name: undefined, source: 'ifind' },
        { symbol: '000001', price: 12, name: undefined, source: 'ifind' },
      ])
    const akshareQuotes = await provider.loadStockQuotes({ provider: 'akshare', symbols: ['600519'] })
    expect(akshareQuotes[0]).toMatchObject({ symbol: '600519', source: 'akshare' })
    const zeroPrevious = new SubprocessFinanceStockDataProvider({
      async run() {
        const values = bars()
        values[values.length - 2] = { ...values[values.length - 2], close: 0 }
        return { symbol: '600519', name: '贵州茅台', bars: values }
      },
    })
    await expect(zeroPrevious.loadStockSnapshot({ provider: 'akshare', symbol: '600519' }))
      .resolves.toMatchObject({ quote: { changePercent: 0 } })
  })

  it('passes the configured iFinD transport to the bridge', async () => {
    const requests: unknown[] = []
    const provider = new SubprocessFinanceStockDataProvider({
      async run(request) {
        requests.push(request)
        return { symbol: request.symbol, name: '贵州茅台', bars: bars() }
      },
    }, { ifindTransport: () => 'local' })
    await provider.loadStockSnapshot({ provider: 'ifind', symbol: '600519' })
    expect(requests[0]).toMatchObject({ provider: 'ifind', transport: 'local' })
  })

  it('rejects invalid, disabled, and insufficient stock requests', async () => {
    const provider = new SubprocessFinanceStockDataProvider(bridge(), {
      enabled: provider => provider === 'ifind',
    })
    await expect(provider.loadStockSnapshot({ provider: 'akshare', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'STOCK_PROVIDER_DISABLED' })
    await expect(provider.loadStockSnapshot({ provider: 'ifind', symbol: ' ' }))
      .rejects.toMatchObject({ code: 'INVALID_SYMBOL' })
    await expect(provider.loadStockQuotes({ provider: 'ifind', symbols: [] }))
      .rejects.toMatchObject({ code: 'INVALID_SYMBOL' })

    const insufficient = new SubprocessFinanceStockDataProvider({
      async run() { return { symbol: '600519', name: '贵州茅台', bars: bars(2) } },
    })
    await expect(insufficient.loadStockSnapshot({ provider: 'akshare', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_HISTORY' })
  })
})

describe('registerStockTools', () => {
  it('registers snapshot, quote, and technical analysis tools', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    registerStockTools(ctx, new SubprocessFinanceStockDataProvider(bridge()))

    const snapshot = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-snapshot' as never,
      name: 'finance_stock_snapshot',
      arguments: { provider: 'akshare', symbol: '600519', start_date: '2026-01-01', end_date: '2026-09-20', adjust: 'qfq' },
    })
    expect(snapshot.isError).toBe(false)
    expect(textOf(snapshot)).toContain('贵州茅台')
    expect(textOf(snapshot)).toContain('first_bar_at')

    const quotes = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-quotes' as never,
      name: 'finance_stock_quote',
      arguments: { provider: 'ifind', symbols: ['600519'] },
    })
    expect(quotes.isError).toBe(false)
    expect(textOf(quotes)).toContain('"quotes"')
    expect(textOf(quotes)).toContain('贵州茅台')

    const analysis = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-analysis' as never,
      name: 'finance_stock_technical_analysis',
      arguments: { provider: 'akshare', symbol: '600519', start_date: '2026-01-01', end_date: '2026-09-20', adjust: 'qfq' },
    })
    expect(analysis.isError).toBe(false)
    expect(textOf(analysis)).toContain('600519')
    expect(textOf(analysis)).toContain('sma20')
    expect(textOf(analysis)).toContain('rationale')

    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-analysis-defaults' as never,
      name: 'finance_stock_technical_analysis',
      arguments: { provider: 'akshare', symbol: '600519' },
    })
  })
  it('exports stock research reports as Markdown and HTML', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const writes = new Map<string, string>()
    ctx.provide('fs', {
      resolve: async (path: string) => ({ targetKey: path, displayPath: path }),
      writeText: async (target: { displayPath: string }, content: string) => {
        writes.set(target.displayPath, content)
        return { operation: 'create', version: 'v', after: content }
      },
    } as never)
    registerStockTools(ctx, new SubprocessFinanceStockDataProvider(bridge()))
    const report = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-report' as never,
      name: 'finance_stock_research_report',
      arguments: { provider: 'akshare', symbol: '600519' },
    })
    expect(report.isError).toBe(false)
    expect(textOf(report)).toContain('Investor Lenses')
    const configuredReport = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-report-configured' as never,
      name: 'finance_stock_research_report',
      arguments: { provider: 'akshare', symbol: '600519', start_date: '2026-01-01', end_date: '2026-09-20', adjust: 'qfq', question: 'What matters?', horizon: '1w' },
    })
    expect(configuredReport.isError).toBe(false)
    const stockMethodology = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-methodology' as never,
      name: 'finance_stock_methodology_analysis',
      arguments: { provider: 'akshare', symbol: '600519' },
    })
    expect(stockMethodology.isError).toBe(false)
    expect(textOf(stockMethodology)).toContain('Warren Buffett')
    const configuredMethodology = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-methodology-configured' as never,
      name: 'finance_stock_methodology_analysis',
      arguments: { provider: 'akshare', symbol: '600519', start_date: '2026-01-01', end_date: '2026-09-20', adjust: 'qfq' },
    })
    expect(configuredMethodology.isError).toBe(false)
    const exported = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-export' as never,
      name: 'finance_stock_report_export',
      arguments: { provider: 'akshare', symbol: '600519', output_dir: 'reports', basename: 'moutai' },
    })
    expect(exported.isError).toBe(false)
    expect(writes.has('reports/moutai.md')).toBe(true)
    expect(writes.has('reports/moutai.html')).toBe(true)
    const configuredExport = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-export-configured' as never,
      name: 'finance_stock_report_export',
      arguments: { provider: 'akshare', symbol: '600519', start_date: '2026-01-01', end_date: '2026-09-20', adjust: 'qfq', question: 'What matters?', horizon: '1w', output_dir: 'reports', basename: 'moutai-config' },
    })
    expect(configuredExport.isError).toBe(false)
    expect(writes.has('reports/moutai-config.html')).toBe(true)
    const defaultExport = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-export-default' as never,
      name: 'finance_stock_report_export',
      arguments: { provider: 'akshare', symbol: '600519' },
    })
    expect(defaultExport.isError).toBe(false)
    expect([...writes.keys()].some(path => path.startsWith('.artifacts/finance-reports/'))).toBe(true)
  })

})
