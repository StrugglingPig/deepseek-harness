import { describe, expect, it } from 'vitest'
import { fixtureProvider } from '../src/data.ts'
import { buildResearchReport } from '../src/report.ts'

describe('finance research report', () => {
  it('builds an equity report with defaults', async () => {
    const report = await buildResearchReport(fixtureProvider, { symbol: 'AAPL' })
    expect(report.symbol).toBe('AAPL')
    expect(report.reportType).toBe('equity-deep-dive')
    expect(report.sections.map(section => section.title)).toEqual([
      'Summary', 'Research Question', 'Market Snapshot', 'Price Action', 'Technical Indicators',
      'Multi-Indicator Synthesis', 'Methodology Coverage', 'Valuation Framework', 'Financial Quality',
      'Competitive Position', 'Investor Lenses', 'Scenario Analysis', 'Strategy Gaps', 'Risk And Limitations',
    ])
    expect(report.markdown).toContain('# Apple Inc. (AAPL) · Equity Deep dive')
    expect(report.html).toContain('<title>Apple Inc. (AAPL) · Equity Deep dive</title>')
    expect(report.html).toContain('data-report-type="equity-deep-dive"')
    expect(report.html).toContain('id="price-chart"')
    expect(report.markdown).toContain('synthetic fixture')
    expect(report.evidence[0]?.url).toBe('fixture://AAPL')
  })

  it('builds a crypto report with a question and horizon', async () => {
    const report = await buildResearchReport(fixtureProvider, {
      symbol: 'BTC', question: 'Where is the range?', horizon: '1w',
    })
    expect(report.markdown).toContain('Where is the range?')
    expect(report.markdown).toContain('Horizon: 1w')
    expect(report.markdown).not.toContain('## Prediction Market')
  })

  it('omits the synthetic marker when a non-synthetic provider is used', async () => {
    const report = await buildResearchReport({
      id: 'external',
      async load(symbol) {
        return {
          instrument: { symbol, name: 'External', assetClass: 'equity', currency: 'USD' },
          asOf: '2026-09-19T00:00:00.000Z',
          source: { provider: 'external', retrievedAt: '2026-09-20T00:00:00.000Z', synthetic: false },
          quote: { price: 100, changePercent: 0 },
          bars: Array.from({ length: 60 }, (_, index) => ({
            timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
            open: 100 + index,
            high: 101 + index,
            low: 99 + index,
            close: 100 + index,
            volume: 1_000,
          })),
        }
      },
    }, { symbol: 'EXT' })
    expect(report.markdown).toContain('Source: external')
    expect(report.html).toContain('Snapshot source: external')
    expect(report.markdown).toContain('Snapshot source: external')
    expect(report.markdown).not.toContain('synthetic fixture')
    expect(report.markdown).not.toContain('deterministic fixture data')
  })

  it('escapes HTML and script terminators in interactive report data', async () => {
    const report = await buildResearchReport({
      id: 'external',
      async load(symbol) {
        return {
          instrument: { symbol, name: '<script>alert(1)</script>', assetClass: 'equity', currency: 'USD' },
          asOf: '2026-09-19T00:00:00.000Z',
          source: { provider: 'external', retrievedAt: '2026-09-20T00:00:00.000Z', synthetic: false },
          quote: { price: 100, changePercent: 0 },
          bars: Array.from({ length: 60 }, (_, index) => ({
            timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
            open: 100, high: 101, low: 99, close: 100, volume: 1,
          })),
        }
      },
    }, { symbol: 'XSS' })
    expect(report.html).not.toContain('<script>alert(1)</script>')
    expect(report.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(report.html).toContain('\\u003c')
  })

  it('adds prediction-market fields when present', async () => {
    const report = await buildResearchReport(fixtureProvider, {
      symbol: 'PREDICTION:FED-CUT', question: 'What is priced?',
    })
    expect(report.sections.some(section => section.title === 'Prediction Market')).toBe(true)
    expect(report.markdown).toContain('Implied probability:')
    expect(report.markdown).toContain('Open interest:')
  })
  it('renders the report in the requested Chinese copy', async () => {
    const report = await buildResearchReport(fixtureProvider, { symbol: 'AAPL' }, undefined, 'zh')
    expect(report.title).toBe('Apple Inc. (AAPL) · 股票深度报告')
    expect(report.sections.map(section => section.title)).toEqual([
      '摘要', '研究问题', '行情快照', '价格行为', '技术指标', '多指标综合', '方法论覆盖',
      '估值框架', '财务质量', '竞争格局', '投资大师视角', '情景分析', '策略缺口', '风险与限制',
    ])
    expect(report.markdown).toContain('Apple Inc. (AAPL) 呈')
    expect(report.markdown).toContain('综合评分：')
    expect(report.markdown).toContain('风险：')
    expect(report.markdown).toContain('；需要 ')
    expect(report.html).toContain('<html lang="zh">')
    expect(report.html).toContain('交互式价格图')
    expect(report.html).toContain('全部')
    expect(report.html).not.toContain('<html lang="en">')
  })

  it('avoids a duplicate symbol label when the provider has no instrument name', async () => {
    const report = await buildResearchReport({
      id: 'external',
      async load(symbol) {
        return {
          instrument: { symbol, name: symbol, assetClass: 'equity', currency: 'CNY' },
          asOf: '2026-09-19T00:00:00.000Z',
          source: { provider: 'external', retrievedAt: '2026-09-20T00:00:00.000Z', synthetic: false },
          quote: { price: 100, changePercent: 0 },
          bars: Array.from({ length: 60 }, (_, index) => ({
            timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
            open: 100, high: 101, low: 99, close: 100, volume: 1,
          })),
        }
      },
    }, { symbol: '600519' })
    expect(report.title).toBe('600519 · Equity Deep dive')
    expect(report.markdown).toContain('bias for 600519.')
    expect(report.markdown).not.toContain('600519 (600519)')
  })

})
