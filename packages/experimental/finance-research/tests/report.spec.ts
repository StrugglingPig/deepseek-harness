import { describe, expect, it } from 'vitest'
import { fixtureProvider } from '../src/data.ts'
import { buildResearchReport } from '../src/report.ts'
import type { AssetMetric } from '../src/asset-context.ts'
import type { FinanceMarketDataProvider } from '../src/types.ts'

/** Provider over a fixed close series, so trend bands can be exercised directly. */
function closeProvider(closes: readonly number[]): FinanceMarketDataProvider {
  return {
    id: 'closes',
    async load() {
      return {
        instrument: { symbol: 'X', name: 'X', assetClass: 'equity' as const, currency: 'USD' },
        asOf: '2026-09-21T00:00:00.000Z',
        source: { provider: 'closes', retrievedAt: '2026-09-21T00:00:00.000Z', synthetic: false },
        quote: { price: closes[closes.length - 1] as number, changePercent: 0 },
        bars: closes.map((close, index) => ({
          timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
          open: close, high: close * 1.01, low: close * 0.99, close, volume: 1_000 + index,
        })),
      }
    },
  }
}

function sectionOf(report: { readonly sections: readonly { readonly title: string; readonly content: string }[] }, title: string): string {
  return report.sections.find(section => section.title === title)?.content ?? ''
}

describe('finance research report', () => {
  it('builds an equity report with defaults', async () => {
    const report = await buildResearchReport(fixtureProvider, { symbol: 'AAPL' })
    expect(report.symbol).toBe('AAPL')
    expect(report.reportType).toBe('equity-deep-dive')
    expect(report.sections.map(section => section.title)).toEqual([
      'Investment View', 'Summary', 'Research Question', 'Macro Drivers', 'Market Snapshot', 'Price Action',
      'Industry Landscape', 'Valuation Framework', 'Earnings Review', 'Financial Quality',
      'Competitive Position', 'Technical Indicators', 'Multi-Indicator Synthesis', 'Methodology Coverage',
      'Investor Lenses', 'Scenario Analysis', 'Strategy Gaps', 'Risk And Limitations',
    ])
    expect(report.markdown).toContain('# Apple Inc. (AAPL) · Equity Deep dive')
    expect(report.html).toContain('<title>Apple Inc. (AAPL) · Equity Deep dive</title>')
    expect(report.html).toContain('data-report-type="equity-deep-dive"')
    expect(report.html).toContain('id="price-chart"')
    expect(report.markdown).toContain('synthetic fixture')
    expect(report.evidence[0]?.url).toBe('fixture://AAPL')
  })

  it('carries the loaded macro precondition into a crypto report', async () => {
    const macro = [{
      indicator: 'us-fed-funds-rate',
      name: 'US effective federal funds rate',
      nameZh: '美国联邦基金有效利率',
      category: 'policy' as const,
      country: 'us' as const,
      unit: '%',
      frequency: 'daily' as const,
      timing: 'coincident' as const,
      reading: 'The realised policy rate.',
      affectedAssets: ['USTs'],
      source: 'fred' as const,
      observations: [{ date: '2026-09-17', value: 3.88 }],
      latest: { date: '2026-09-17', value: 3.88 },
      previous: undefined,
      retrievedAt: '2026-09-21T00:00:00.000Z',
    }]
    const report = await buildResearchReport(fixtureProvider, { symbol: 'BTC' }, undefined, 'en', macro)
    expect(report.reportType).toBe('crypto-deep-dive')
    expect(report.sections.map(section => section.title)).toContain('Macro Drivers')
    const block = report.sections.find(section => section.title === 'Macro Drivers')
    expect(block?.content).toContain('US effective federal funds rate: 3.88 %')
    expect(block?.content).toContain('source fred')
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

  it('reads a falling series as a reduce stance with bearish technical context', async () => {
    // Flat, then an accelerating decline, so both the mean-reversion and MACD reads turn bearish.
    const closes = Array.from({ length: 60 }, (_, index) => index < 45 ? 200 : 200 - (index - 44) * 6)
    const report = await buildResearchReport(closeProvider(closes), { symbol: 'X' })
    expect(sectionOf(report, 'Investment View')).toContain('Reduce')
    const technical = sectionOf(report, 'Technical Indicators')
    expect(technical).toContain('oversold')
    expect(technical).toContain('MACD below its signal line')
  })

  it('reads a flat series as a watch stance with a neutral stack', async () => {
    const report = await buildResearchReport(closeProvider(Array.from({ length: 60 }, () => 100)), { symbol: 'X' })
    expect(sectionOf(report, 'Investment View')).toContain('Watch')
    expect(sectionOf(report, 'Technical Indicators')).toContain('Moving-average stack: neutral')
  })

  it('flags an overbought reading on a steep advance', async () => {
    const closes = Array.from({ length: 60 }, (_, index) => 100 * 1.02 ** index)
    const report = await buildResearchReport(closeProvider(closes), { symbol: 'X' })
    expect(sectionOf(report, 'Technical Indicators')).toContain('overbought')
  })

  it('fills the fundamental blocks from the supplied metrics', async () => {
    const metrics: AssetMetric[] = [
      { group: 'valuation', key: 'eps', value: 36.8243, unit: 'CNY', asOf: '2026-06-30', source: 'akshare' },
      { group: 'profitability', key: 'roe', value: 17.72, unit: '%', asOf: '2026-06-30', source: 'akshare' },
      { group: 'balance', key: 'currentRatio', value: 5.5895, unit: '', asOf: '2026-06-30', source: 'akshare' },
      { group: 'growth', key: 'profitGrowth', value: -2.029, unit: '%', asOf: '2026-06-30', source: 'akshare' },
      { group: 'market', key: 'marketCap', value: 1.7e12, unit: 'USD', asOf: '2026-09-21', source: 'coinmarketcap' },
      { group: 'valuation', key: 'marketCap', value: 1_565_815_000_000, unit: 'CNY', asOf: '2026-09-21', source: 'akshare' },
      { group: 'market', key: 'beta', value: 0.42, unit: 'x', asOf: '2026-09-21', source: 'coinmarketcap' },
    ]
    const report = await buildResearchReport(fixtureProvider, { symbol: 'AAPL' }, undefined, 'en', [], metrics)
    expect(sectionOf(report, 'Valuation Framework')).toContain('Diluted EPS: 36.82 CNY (2026-06-30, source akshare)')
    expect(sectionOf(report, 'Valuation Framework')).toContain('1.57T CNY')
    expect(sectionOf(report, 'Financial Quality')).toContain('Return on equity: 17.72%')
    expect(sectionOf(report, 'Financial Quality')).toContain('Current ratio: 5.59')
    const withIndustry = await buildResearchReport(fixtureProvider, { symbol: 'AAPL' }, undefined, 'en', [], [
      { group: 'industry', key: 'industryName', value: 0, text: '酒、饮料和精制茶制造业', unit: '', asOf: '2026-09-21', source: 'akshare' },
    ])
    expect(sectionOf(withIndustry, 'Industry Landscape')).toContain('Industry: 酒、饮料和精制茶制造业')
    expect(sectionOf(report, 'Earnings Review')).toContain('Net profit growth (YoY): -2.03%')
    // A category block with no matching metric still reports what it needs.
    const crypto = await buildResearchReport(fixtureProvider, { symbol: 'BTC' }, undefined, 'en', [], metrics)
    const community = await buildResearchReport(fixtureProvider, { symbol: 'BTC', reportType: 'crypto-deep-dive' }, undefined, 'en', [],
      [{ group: 'community', key: 'watchlistUsers', value: 2_452_829, unit: '', asOf: '', source: 'coingecko' }])
    expect(sectionOf(community, 'Project And Community')).toContain('(source coingecko)')
    expect(sectionOf(crypto, 'Fund Flows And Positioning')).toContain('1.7T USD')
    expect(sectionOf(crypto, 'Fund Flows And Positioning')).toContain('0.42 x')
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
      '投资结论', '摘要', '研究问题', '宏观驱动', '行情快照', '价格行为',
      '行业格局', '估值框架', '业绩点评', '财务质量', '竞争格局', '技术指标', '多指标综合',
      '方法论覆盖', '投资大师视角', '情景分析', '策略缺口', '风险与限制',
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

describe('macro blocks inside an asset report', () => {
  const macroSeries = (id: string, value: number, category: string, country: string, unit: string, date: string) => ({
    indicator: id,
    name: id,
    nameZh: id,
    category,
    country,
    unit,
    frequency: 'monthly',
    timing: 'coincident',
    reading: 'reading',
    affectedAssets: [],
    source: 'fred',
    observations: [{ date, value }],
    latest: { date, value },
    previous: undefined,
    retrievedAt: '2026-09-21T00:00:00.000Z',
  }) as const

  it('renders real macro values in the macro and rates blocks when the tool supplies them', async () => {
    const provider = fixtureProvider
    const macro = [
      macroSeries('us-10y-yield', 4.94, 'market', 'us', '%', '2026-09-17'),
      macroSeries('us-hy-credit-spread', 2.7, 'market', 'us', '%', '2026-09-17'),
      macroSeries('global-gdp-growth', 2.92, 'growth', 'global', '%', '2025'),
      { ...macroSeries('cn-government-debt', 106.9, 'fiscal', 'cn', '%', '2026'), latest: { date: '2026', value: 106.9, projection: true } },
    ]
    const report = await buildResearchReport(
      provider,
      { symbol: 'AAPL', reportType: 'macro-deep-dive' },
      undefined,
      'en',
      macro as never,
    )
    const blocks = report.sections.map(section => `${section.title}\n${section.content}`).join('\n')
    expect(blocks).toContain('US us-10y-yield: 4.94 %')
    expect(blocks).toContain('source fred')
    expect(blocks).toContain('(projection)')
    expect(blocks).toContain('Macro Drivers')
  })

  it('falls back to the missing-input block when no macro series were loaded', async () => {
    const report = await buildResearchReport(
      fixtureProvider,
      { symbol: 'AAPL', reportType: 'macro-deep-dive' },
      undefined,
      'en',
    )
    const blocks = report.sections.map(section => `${section.title}\n${section.content}`).join('\n')
    expect(blocks).toContain('Macro Drivers')
    expect(blocks).not.toContain('US us-10y-yield: 4.94 %')
  })
})
