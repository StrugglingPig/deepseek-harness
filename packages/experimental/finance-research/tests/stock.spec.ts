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
      if (request.action !== 'stock_quote') throw new Error(`unexpected action ${request.action}`)
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
      async run(raw) {
        requests.push(raw)
        const request = raw as { readonly symbol?: string }
        return { symbol: request.symbol, name: '贵州茅台', bars: bars() }
      },
    }, { ifindTransport: () => 'local' })
    await provider.loadStockSnapshot({ provider: 'ifind', symbol: '600519' })
    expect(requests[0]).toMatchObject({ provider: 'ifind', transport: 'local' })
  })

  it('loads iFinD announcements for one symbol or a whole market', async () => {
    const requests: unknown[] = []
    const provider = new SubprocessFinanceStockDataProvider({
      async run(raw) {
        requests.push(raw)
        const request = raw as { readonly mode?: string }
        return {
          symbol: request.mode === undefined ? '600519' : '',
          mode: request.mode ?? '',
          truncated: request.mode !== undefined,
          announcements: [{
            symbol: '600519',
            name: '贵州茅台',
            title: '贵州茅台2026年半年度报告',
            announcedAt: '2026-08-15T00:00:00.000Z',
            publishedAt: '2026-08-14T20:41:43.000Z',
            language: 'zh',
            url: 'http://ft.10jqka.com.cn/report',
          }, {
            symbol: '600519',
            name: null,
            title: '贵州茅台关于召开业绩说明会的公告',
            announcedAt: '2026-08-15T00:00:00.000Z',
            publishedAt: null,
            language: null,
            url: null,
          }],
        }
      },
    }, { ifindTransport: () => 'http' })

    await expect(provider.loadStockAnnouncements({ symbol: 'sh600519', reportTypes: ['901', '902'] }))
      .resolves.toEqual({
        symbol: '600519',
        truncated: false,
        announcements: [{
          symbol: '600519',
          name: '贵州茅台',
          title: '贵州茅台2026年半年度报告',
          announcedAt: '2026-08-15T00:00:00.000Z',
          publishedAt: '2026-08-14T20:41:43.000Z',
          language: 'zh',
          url: 'http://ft.10jqka.com.cn/report',
        }, {
          symbol: '600519',
          title: '贵州茅台关于召开业绩说明会的公告',
          announcedAt: '2026-08-15T00:00:00.000Z',
        }],
      })
    expect(requests[0]).toMatchObject({
      action: 'stock_announcements',
      provider: 'ifind',
      transport: 'http',
      symbol: '600519',
      reportTypes: ['901', '902'],
    })

    const market = await provider.loadStockAnnouncements({
      mode: 'allAStock', startDate: '2026-09-24', endDate: '2026-09-24',
    })
    expect(market).toMatchObject({ symbol: '', mode: 'allAStock', truncated: true })
    expect(requests[1]).toMatchObject({ mode: 'allAStock', startDate: '2026-09-24' })
    expect(requests[1]).not.toHaveProperty('symbol')
  })

  it('rejects an announcement query without a target and a disabled provider', async () => {
    const provider = new SubprocessFinanceStockDataProvider(bridge())
    await expect(provider.loadStockAnnouncements({}))
      .rejects.toMatchObject({ code: 'INVALID_SYMBOL' })
    const disabled = new SubprocessFinanceStockDataProvider(bridge(), { enabled: () => false })
    await expect(disabled.loadStockAnnouncements({ symbol: '600519' }))
      .rejects.toMatchObject({ code: 'STOCK_PROVIDER_DISABLED' })
  })

  it('reads intraday points and an indicator history through iFinD', async () => {
    const requests: unknown[] = []
    const provider = new SubprocessFinanceStockDataProvider({
      async run(raw) {
        requests.push(raw)
        const request = raw as { readonly action: string; readonly indicator?: string }
        if (request.action === 'stock_series') {
          if (request.indicator === '') throw new Error('unexpected')
          return { symbol: '600519', indicator: 'ths_pe_ttm_stock', observations: [{ date: '2026-09-23', value: 19.21 }] }
        }
        return {
          symbol: '600519',
          granularity: '5',
          points: [
            {
              timestamp: '2026-09-23T09:35:00+08:00',
              open: 1255.03,
              high: 1258.38,
              low: 1252.02,
              close: 1257.9,
              volume: 147_800,
              amount: 185_640_356.98,
            },
            {
              timestamp: '2026-09-23T09:40:00+08:00',
              open: null,
              high: null,
              low: null,
              close: 1251.25,
              previousClose: null,
              volume: null,
              amount: null,
            },
          ],
        }
      },
    }, { ifindTransport: () => 'http' })

    await expect(provider.loadStockIntraday({
      symbol: 'sh600519', granularity: '5', startDate: '2026-09-23', endDate: '2026-09-23',
    })).resolves.toEqual({
      symbol: '600519',
      granularity: '5',
      points: [
        {
          timestamp: '2026-09-23T09:35:00+08:00',
          open: 1255.03,
          high: 1258.38,
          low: 1252.02,
          close: 1257.9,
          volume: 147_800,
          amount: 185_640_356.98,
        },
        { timestamp: '2026-09-23T09:40:00+08:00', close: 1251.25 },
      ],
    })
    expect(requests[0]).toMatchObject({
      action: 'stock_intraday', provider: 'ifind', transport: 'http', symbol: '600519', granularity: '5',
    })

    await expect(provider.loadStockSeries({ symbol: '600519', indicator: 'ths_pe_ttm_stock' }))
      .resolves.toEqual({
        symbol: '600519',
        indicator: 'ths_pe_ttm_stock',
        observations: [{ date: '2026-09-23', value: 19.21 }],
      })
    expect(requests[1]).toMatchObject({ action: 'stock_series', indicator: 'ths_pe_ttm_stock' })

    await provider.loadStockSeries({
      symbol: '600519', indicator: 'ths_pe_ttm_stock', parameter: '8', startDate: '2026-08-01', endDate: '2026-09-23',
    })
    expect(requests[2]).toMatchObject({
      action: 'stock_series', parameter: '8', startDate: '2026-08-01', endDate: '2026-09-23',
    })
  })

  it('rejects an empty symbol and a disabled provider for intraday and series', async () => {
    const provider = new SubprocessFinanceStockDataProvider(bridge())
    await expect(provider.loadStockIntraday({ symbol: ' ', granularity: 'tick' }))
      .rejects.toMatchObject({ code: 'INVALID_SYMBOL' })
    await expect(provider.loadStockSeries({ symbol: ' ', indicator: 'ths_pe_ttm_stock' }))
      .rejects.toMatchObject({ code: 'INVALID_SYMBOL' })
    const disabled = new SubprocessFinanceStockDataProvider(bridge(), { enabled: () => false })
    await expect(disabled.loadStockIntraday({ symbol: '600519', granularity: 'tick' }))
      .rejects.toMatchObject({ code: 'STOCK_PROVIDER_DISABLED' })
    await expect(disabled.loadStockSeries({ symbol: '600519', indicator: 'ths_pe_ttm_stock' }))
      .rejects.toMatchObject({ code: 'STOCK_PROVIDER_DISABLED' })
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
  it('registers intraday and indicator-series tools', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const requests: unknown[] = []
    registerStockTools(ctx, new SubprocessFinanceStockDataProvider({
      async run(raw) {
        requests.push(raw)
        const request = raw as { readonly action: string; readonly indicator?: string }
        if (request.action === 'stock_series') {
          return { symbol: '600519', indicator: request.indicator, observations: [{ date: '2026-09-23', value: 19.21 }] }
        }
        return {
          symbol: '600519',
          granularity: 'tick',
          points: [{
            timestamp: '2026-09-24T09:36:02+08:00',
            open: 1250.01,
            high: 1256.13,
            low: 1243.34,
            close: 1247,
            previousClose: 1251.24,
            volume: 400,
            amount: 498_880,
          }, {
            timestamp: '2026-09-24T09:36:05+08:00',
            close: 1247.5,
          }],
        }
      },
    }, { ifindTransport: () => 'http' }))

    const intraday = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-intraday' as never,
      name: 'finance_stock_intraday',
      arguments: { symbol: '600519', granularity: 'tick', start_date: '2026-09-24 09:30:00', end_date: '2026-09-24 10:00:00' },
    })
    expect(intraday.isError).toBe(false)
    expect(JSON.parse(textOf(intraday))).toMatchObject({
      symbol: '600519',
      granularity: 'tick',
      points: [
        { timestamp: '2026-09-24T09:36:02+08:00', previous_close: 1251.24, close: 1247 },
        { timestamp: '2026-09-24T09:36:05+08:00', close: 1247.5 },
      ],
    })
    expect(requests[0]).toMatchObject({
      action: 'stock_intraday', startDate: '2026-09-24 09:30:00', endDate: '2026-09-24 10:00:00',
    })

    // The window is optional: without one the bridge reads the current session.
    const current = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-intraday-current' as never,
      name: 'finance_stock_intraday',
      arguments: { symbol: '600519', granularity: '1' },
    })
    expect(current.isError).toBe(false)
    expect(requests[1]).not.toHaveProperty('startDate')
    expect(requests[1]).not.toHaveProperty('endDate')

    const series = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-series' as never,
      name: 'finance_stock_series',
      arguments: { symbol: '600519', indicator: 'ths_pe_ttm_stock', parameter: '8', end_date: '2026-09-23' },
    })
    expect(series.isError).toBe(false)
    expect(textOf(series)).toContain('ths_pe_ttm_stock')
    expect(requests[2]).toMatchObject({ action: 'stock_series', indicator: 'ths_pe_ttm_stock', parameter: '8' })

    const defaults = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-series-defaults' as never,
      name: 'finance_stock_series',
      arguments: { symbol: '600519', indicator: 'ths_pe_ttm_stock' },
    })
    expect(defaults.isError).toBe(false)
    expect(requests[3]).not.toHaveProperty('parameter')
    expect(requests[3]).not.toHaveProperty('startDate')

    // Every optional field reaches the bridge when the caller supplies it.
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-series-window' as never,
      name: 'finance_stock_series',
      arguments: { symbol: '600519', indicator: 'ths_pe_ttm_stock', parameter: '8', start_date: '2026-08-01', end_date: '2026-09-23' },
    })
    expect(requests[4]).toMatchObject({ parameter: '8', startDate: '2026-08-01', endDate: '2026-09-23' })
  })

  it('registers the announcement tool for one symbol and a whole market', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const requests: unknown[] = []
    registerStockTools(ctx, new SubprocessFinanceStockDataProvider({
      async run(raw) {
        requests.push(raw)
        const request = raw as { readonly mode?: string }
        return {
          symbol: request.mode === undefined ? '600519' : '',
          mode: request.mode ?? '',
          truncated: request.mode !== undefined,
          announcements: [{
            symbol: '600519',
            name: '贵州茅台',
            title: '贵州茅台：贵州茅台2026年半年度报告',
            announcedAt: '2026-08-15T00:00:00.000Z',
            publishedAt: '2026-08-14T20:41:43.000Z',
            language: 'zh',
            url: 'http://ft.10jqka.com.cn/report',
          }, {
            symbol: '600519',
            title: '贵州茅台关于召开业绩说明会的公告',
            announcedAt: '2026-08-15T00:00:00.000Z',
          }],
        }
      },
    }, { ifindTransport: () => 'http' }))

    const single = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-announcements' as never,
      name: 'finance_stock_announcements',
      arguments: { symbol: '600519', report_types: ['901'], start_date: '2026-01-01' },
    })
    expect(single.isError).toBe(false)
    expect(JSON.parse(textOf(single))).toMatchObject({
      symbol: '600519',
      truncated: false,
      announcements: [
        { symbol: '600519', name: '贵州茅台', announced_at: '2026-08-15T00:00:00.000Z', published_at: '2026-08-14T20:41:43.000Z', language: 'zh' },
        { symbol: '600519', announced_at: '2026-08-15T00:00:00.000Z' },
      ],
    })
    expect(requests[0]).toMatchObject({ action: 'stock_announcements', reportTypes: ['901'], startDate: '2026-01-01' })

    const market = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-announcements-market' as never,
      name: 'finance_stock_announcements',
      arguments: { mode: 'allAStock', end_date: '2026-09-24' },
    })
    expect(market.isError).toBe(false)
    expect(JSON.parse(textOf(market))).toMatchObject({ symbol: '', mode: 'allAStock', truncated: true })
    expect(requests[1]).toMatchObject({ mode: 'allAStock', endDate: '2026-09-24' })

    const targetless = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-announcements-empty' as never,
      name: 'finance_stock_announcements',
      arguments: {},
    })
    expect(targetless.isError).toBe(true)
  })

  it('reports a provider that publishes no intraday or series table', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    registerStockTools(ctx, {
      id: 'stub',
      async loadStockSnapshot() { throw new Error('unused') },
      async loadStockQuotes() { return [] },
    })

    const intraday = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-intraday-stub' as never,
      name: 'finance_stock_intraday',
      arguments: { symbol: '600519', granularity: 'tick' },
    })
    expect(intraday.isError).toBe(true)
    const series = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-series-stub' as never,
      name: 'finance_stock_series',
      arguments: { symbol: '600519', indicator: 'ths_pe_ttm_stock' },
    })
    expect(series.isError).toBe(true)
    const announcements = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-announcements-stub' as never,
      name: 'finance_stock_announcements',
      arguments: { symbol: '600519' },
    })
    expect(announcements.isError).toBe(true)
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
      arguments: { provider: 'akshare', symbol: '600519', start_date: '2026-01-01', end_date: '2026-09-20', adjust: 'qfq', question: 'What matters?', horizon: '1w', report_type: 'equity-event' },
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
      arguments: { provider: 'akshare', symbol: '600519', output_dir: 'reports', basename: 'moutai', report_type: 'equity-earnings' },
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
