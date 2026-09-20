import { describe, expect, it } from 'vitest'
import { fixtureProvider } from '../src/data.ts'
import { buildResearchReport } from '../src/report.ts'

describe('finance research report', () => {
  it('builds an equity report with defaults', async () => {
    const report = await buildResearchReport(fixtureProvider, { symbol: 'AAPL' })
    expect(report.symbol).toBe('AAPL')
    expect(report.sections.map(section => section.title)).toEqual([
      'Summary', 'Research Question', 'Market Snapshot', 'Technical Indicators',
      'Multi-Indicator Synthesis', 'Risk And Limitations',
    ])
    expect(report.markdown).toContain('# Apple Inc. (AAPL) research report')
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
    expect(report.markdown).toContain('Snapshot source: external')
    expect(report.markdown).not.toContain('synthetic fixture')
    expect(report.markdown).not.toContain('deterministic fixture data')
  })

  it('adds prediction-market fields when present', async () => {
    const report = await buildResearchReport(fixtureProvider, {
      symbol: 'PREDICTION:FED-CUT', question: 'What is priced?',
    })
    expect(report.sections.some(section => section.title === 'Prediction Market')).toBe(true)
    expect(report.markdown).toContain('Implied probability:')
    expect(report.markdown).toContain('Open interest:')
  })
})
