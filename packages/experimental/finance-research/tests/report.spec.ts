import { describe, expect, it } from 'vitest'
import { fixtureProvider } from '../src/data.ts'
import { NO_BACKTEST, summarizeBacktest, type BacktestSummary, type ValuationValidation } from '../src/backtest.ts'
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
      'Industry Landscape', 'Valuation Framework', 'Model Valuation And Reference Range', 'Earnings Review',
      'Financial Quality', 'Competitive Position', 'Ownership And Insiders', 'Catalysts', 'Technical Indicators',
      'Multi-Indicator Synthesis', 'Methodology Coverage',
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
    expect(block?.content).toContain('| US | US effective federal funds rate | 3.88 % | 2026-09-17 |')
    expect(block?.content).toContain('| fred |')
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
    expect(report.markdown).toContain('| Source | external |')
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
    expect(sectionOf(report, 'Technical Indicators')).toContain('| SMA 20 / 50 | 100.00 / 100.00 | neutral |')
  })

  it('flags an overbought reading on a steep advance', async () => {
    const closes = Array.from({ length: 60 }, (_, index) => 100 * 1.02 ** index)
    const report = await buildResearchReport(closeProvider(closes), { symbol: 'X' })
    expect(sectionOf(report, 'Technical Indicators')).toContain('overbought')
  })

  it('states a reference range with the methods, inputs, and expectations gap behind it', async () => {
    const metrics: readonly AssetMetric[] = [
      { group: 'valuation', key: 'epsTtm', value: 8.72, unit: 'USD', asOf: '', source: 'finnhub' },
      { group: 'growth', key: 'revenueGrowth', value: 8, unit: '%', asOf: '', source: 'finnhub' },
      { group: 'growth', key: 'revenue', value: 416_161_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'grossProfit', value: 195_201_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'operatingIncome', value: 133_050_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'netIncome', value: 112_010_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'pretaxIncome', value: 132_729_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'taxExpense', value: 20_719_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'totalAssets', value: 359_241_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'currentAssets', value: 147_957_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'currentLiabilities', value: 165_631_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'retainedEarnings', value: -14_264_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'liabilities', value: 285_508_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'equity', value: 73_733_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'totalDebt', value: 98_657_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'cash', value: 35_934_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'operatingCashFlow', value: 111_482_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'capex', value: 12_715_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'freeCashFlow', value: 98_767_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'depreciation', value: 11_698_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'netMargin', value: 26.92, unit: '%', asOf: '', source: 'finnhub' },
      { group: 'profitability', key: 'reportedFinancials', value: 0, text: 'FY2025 10-K', unit: '', asOf: '', source: 'finnhub' },
      { group: 'valuation', key: 'marketCap', value: 3_800_000_000_000, unit: 'USD', asOf: '', source: 'finnhub' },
      { group: 'market', key: 'beta', value: 1.1, unit: '', asOf: '', source: 'finnhub' },
    ]
    const report = await buildResearchReport(
      fixtureProvider,
      { symbol: 'AAPL', reportType: 'equity-deep-dive' },
      undefined,
      'en',
      [],
      metrics,
    )
    const valuation = sectionOf(report, 'Model Valuation And Reference Range')
    expect(valuation).toMatch(/\*\*(Accumulate|Hold|Reduce)\*\* · Credibility gradeB/u)
    expect(valuation).toContain('| Model reference range (bear–bull) |')
    expect(valuation).toContain('| Probability-weighted reference value |')
    expect(valuation).toContain('**Methods behind the range**')
    expect(valuation).toContain('| FCFF DCF |')
    expect(valuation).toContain('| Earnings power value (no growth) |')
    expect(valuation).toContain('| Reverse DCF |')
    expect(valuation).toContain('**Financial ratios**')
    expect(valuation).toContain('| Accruals ratio (net income − operating cash flow) / total assets |')
    expect(valuation).toContain('**Earnings-quality signals**')
    expect(valuation).toContain('**Cost of capital and its components**')
    expect(valuation).toContain('| Risk-free rate | 4.00% | assumption |')
    expect(valuation).toContain('**Discount-rate sensitivity (±1 percentage point)**')
    expect(valuation).toContain('**Terminal-value check**')
    expect(valuation).toContain('**Projected path**')
    expect(valuation).toContain('| 2027 |')
    // The recorded backtest did not beat the unchanged-price control, so the value stays a reference.
    expect(valuation).toContain('did not beat the unchanged-price control')
    // The football field carries one text bar per method, scaled to the same axis.
    expect(valuation).toContain('| Low | High | Range |')
    expect(valuation).toMatch(/\| FCFF DCF \| [\d,.]+ \| [\d,.]+ \| [·█│]{20} \|/u)
    expect(valuation).toContain('**Model assumptions**')
    expect(valuation).toContain('| Parameter | Value | Against default |')
    expect(valuation).toContain('| valuationEquityRiskPremiumPercent | 4.50% | Default |')
    expect(valuation).toContain('| valuationBearProbability | 0.25 | Default |')
    // The assumption sheet carries no source column: an assumption has no upstream to name.
    const assumptions = valuation.slice(valuation.indexOf('**Model assumptions**'))
    expect(assumptions.slice(0, assumptions.indexOf('**Financial ratios**'))).not.toContain('Source')
    expect(valuation).toContain('**Sourced figures**')
    expect(valuation).toContain('| Market cap | 3,800,000,000,000.00 USD | finnhub | FY2025 10-K |')
    expect(valuation).toContain('| Operating cash flow | 111,482,000,000.00 USD | finnhub | FY2025 10-K |')
    // The investment view carries the verdict box: the action, the range, and the trading direction.
    const view = sectionOf(report, 'Investment View')
    expect(view).toContain('Model reference range')
    expect(view).toContain('| Action |')
    expect(view).toContain('| One-to-three-month direction |')
    expect(view).toContain('| Credibility grade |')
    expect(view).toContain('| Conviction |')
    expect(report.html).toContain('<section class="verdict">')
    expect(report.html).toContain('<dt>Implied upside range</dt>')
    expect(report.html).toContain('<dt>Conviction</dt>')
    expect(report.html).toContain('<section class="football">')
    expect(report.html).toContain('class="football-band"')
    expect(report.markdown).not.toContain('Model target price')
    expect(report.html).toContain('<span>Reference range</span>')
  })

  it('leaves the base-rate row out when the history published no percentile', async () => {
    const report = await buildResearchReport(
      fixtureProvider,
      { symbol: 'AAPL', reportType: 'equity-deep-dive' },
      undefined,
      'en',
      [],
      [
        { group: 'valuation', key: 'epsTtm', value: 7.5, unit: 'USD', asOf: '', source: 'finnhub' },
        { group: 'growth', key: 'revenueGrowth', value: 6, unit: '%', asOf: '', source: 'finnhub' },
        { group: 'growth', key: 'revenue', value: 1_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'profitability', key: 'operatingIncome', value: 200, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'profitability', key: 'netIncome', value: 150, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'cash', key: 'operatingCashFlow', value: 180, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'cash', key: 'capex', value: 20, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'cash', key: 'depreciation', value: 10, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'balance', key: 'totalAssets', value: 1_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'valuation', key: 'marketCap', value: 10_000, unit: 'USD', asOf: '', source: 'finnhub' },
      ],
    )
    const valuation = sectionOf(report, 'Model Valuation And Reference Range')
    expect(valuation).toContain('| FCFF DCF |')
    // Without a percentile the row prints as not obtained rather than disappearing.
    expect(valuation).toContain('| Assumption against the reported growth history | Not obtained |')
    expect(valuation).toContain('sits inside this company own reported growth range')

    // A percentile below the top decile prints its position and the within-range note.
    const within = await buildResearchReport(
      fixtureProvider,
      { symbol: 'AAPL', reportType: 'equity-deep-dive' },
      undefined,
      'en',
      [],
      [
        { group: 'valuation', key: 'epsTtm', value: 7.5, unit: 'USD', asOf: '', source: 'finnhub' },
        { group: 'growth', key: 'revenueGrowth', value: 6, unit: '%', asOf: '', source: 'finnhub' },
        { group: 'growth', key: 'revenueGrowthPercentile', value: 50, unit: '%', asOf: '', source: 'finnhub' },
        { group: 'growth', key: 'revenue', value: 1_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'profitability', key: 'operatingIncome', value: 200, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'profitability', key: 'netIncome', value: 150, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'cash', key: 'operatingCashFlow', value: 180, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'cash', key: 'capex', value: 20, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'cash', key: 'depreciation', value: 10, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'balance', key: 'totalAssets', value: 1_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'valuation', key: 'marketCap', value: 10_000, unit: 'USD', asOf: '', source: 'finnhub' },
      ],
    )
    const withinSection = sectionOf(within, 'Model Valuation And Reference Range')
    expect(withinSection).toContain('| Assumption against the reported growth history | 50.00% |')
    expect(withinSection).toContain('sits inside this company own reported growth range')

    // A percentile in the top decile adds the reason the assumption needs.
    const top = await buildResearchReport(
      fixtureProvider,
      { symbol: 'AAPL', reportType: 'equity-deep-dive' },
      undefined,
      'en',
      [],
      [
        { group: 'valuation', key: 'epsTtm', value: 7.5, unit: 'USD', asOf: '', source: 'finnhub' },
        { group: 'growth', key: 'revenueGrowth', value: 6, unit: '%', asOf: '', source: 'finnhub' },
        { group: 'growth', key: 'revenueGrowthPercentile', value: 95, unit: '%', asOf: '', source: 'finnhub' },
        { group: 'growth', key: 'revenue', value: 1_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'profitability', key: 'operatingIncome', value: 200, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'profitability', key: 'netIncome', value: 150, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'cash', key: 'operatingCashFlow', value: 180, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'cash', key: 'capex', value: 20, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'cash', key: 'depreciation', value: 10, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'balance', key: 'totalAssets', value: 1_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
        { group: 'valuation', key: 'marketCap', value: 10_000, unit: 'USD', asOf: '', source: 'finnhub' },
      ],
    )
    const topSection = sectionOf(top, 'Model Valuation And Reference Range')
    expect(topSection).toContain('| Assumption against the reported growth history | 95.00% · The assumed growth sits in the top decile')
    expect(topSection).toContain('needs a stated structural reason')
  })

  it('uses the loaded ten-year yield as the risk-free rate', async () => {
    const metrics: readonly AssetMetric[] = [
      { group: 'growth', key: 'revenue', value: 1_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'operatingIncome', value: 200, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'netIncome', value: 150, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'operatingCashFlow', value: 180, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'capex', value: 20, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'depreciation', value: 10, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'totalAssets', value: 1_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'valuation', key: 'marketCap', value: 10_000, unit: 'USD', asOf: '', source: 'finnhub' },
      { group: 'growth', key: 'revenueGrowth', value: 6, unit: '%', asOf: '', source: 'finnhub' },
    ]
    const macro = [{
      indicator: 'us-10y-yield',
      name: 'US 10-year Treasury yield',
      nameZh: '美国 10 年期国债收益率',
      category: 'market' as const,
      country: 'us' as const,
      unit: '%',
      frequency: 'daily' as const,
      timing: 'coincident' as const,
      reading: 'The realised yield.',
      affectedAssets: [],
      source: 'fred' as const,
      observations: [{ date: '2026-09-22', value: 5.01 }],
      latest: { date: '2026-09-22', value: 5.01 },
      previous: undefined,
      retrievedAt: '2026-09-23T00:00:00.000Z',
    }]
    const report = await buildResearchReport(
      fixtureProvider, { symbol: 'AAPL', reportType: 'equity-deep-dive' }, undefined, 'en', macro, metrics,
    )
    const valuation = sectionOf(report, 'Model Valuation And Reference Range')
    expect(valuation).toContain('| Risk-free rate | 5.01% | fred | 2026-09-22 |')
  })

  it('suppresses the valuation when the credibility grade is D', async () => {
    const metrics: readonly AssetMetric[] = [
      { group: 'growth', key: 'revenue', value: 1_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'operatingIncome', value: 100, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'netIncome', value: 100, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'operatingCashFlow', value: 0, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'capex', value: 10, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'depreciation', value: 5, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'totalAssets', value: 1_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'valuation', key: 'marketCap', value: 1_000, unit: 'USD', asOf: '', source: 'finnhub' },
      { group: 'growth', key: 'revenueGrowth', value: 6, unit: '%', asOf: '', source: 'finnhub' },
    ]
    const report = await buildResearchReport(
      fixtureProvider, { symbol: 'AAPL', reportType: 'equity-deep-dive' }, undefined, 'en', [], metrics,
    )
    const valuation = sectionOf(report, 'Model Valuation And Reference Range')
    expect(valuation).toContain('**Avoid**')
    expect(valuation).toContain('A D credibility grade suppresses the valuation')
    expect(valuation).not.toContain('Model reference range (bear–bull)')
  })

  it('caps the action at watch when no credibility grade can be computed', async () => {
    const metrics: readonly AssetMetric[] = [
      { group: 'valuation', key: 'epsTtm', value: 7.5, unit: 'USD', asOf: '', source: 'finnhub' },
      { group: 'growth', key: 'revenue', value: 1_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'operatingIncome', value: 200, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'capex', value: 20, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'depreciation', value: 10, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'valuation', key: 'marketCap', value: 10_000, unit: 'USD', asOf: '', source: 'finnhub' },
      { group: 'growth', key: 'revenueGrowth', value: 6, unit: '%', asOf: '', source: 'finnhub' },
    ]
    const report = await buildResearchReport(
      fixtureProvider, { symbol: 'AAPL', reportType: 'equity-deep-dive' }, undefined, 'en', [], metrics,
    )
    const valuation = sectionOf(report, 'Model Valuation And Reference Range')
    expect(valuation).toContain('**Watch**')
    expect(valuation).toContain('No credibility grade could be computed, so the action is capped at watch.')
    expect(valuation).toContain('| Not obtained |')
    // The projected path prints an em dash for the net income this filing did not publish.
    expect(valuation).toContain('| — |')
  })

  it('lists the ratios a stalled valuation still misses', async () => {
    // Without a reported revenue base the cash-flow model cannot run, so the block lists every missing ratio.
    const metrics: readonly AssetMetric[] = [
      { group: 'valuation', key: 'epsTtm', value: 8.72, unit: 'USD', asOf: '', source: 'finnhub' },
      { group: 'growth', key: 'revenueGrowth', value: 6, unit: '%', asOf: '', source: 'finnhub' },
    ]
    const report = await buildResearchReport(
      fixtureProvider, { symbol: 'AAPL', reportType: 'equity-deep-dive' }, undefined, 'en', [], metrics,
    )
    const valuation = sectionOf(report, 'Model Valuation And Reference Range')
    expect(valuation).toContain('Inputs this read still needs:')
    expect(valuation).toContain('Gross margin')
  })

  it('marks a discount-rate step that reaches the terminal growth and a breached ceiling', async () => {
    const metrics: readonly AssetMetric[] = [
      { group: 'valuation', key: 'epsTtm', value: 8.72, unit: 'USD', asOf: '', source: 'finnhub' },
      { group: 'growth', key: 'revenueGrowth', value: 8, unit: '%', asOf: '', source: 'finnhub' },
      { group: 'growth', key: 'revenue', value: 416_161_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'operatingIncome', value: 133_050_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'netIncome', value: 112_010_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'totalAssets', value: 359_241_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'totalDebt', value: 98_657_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'cash', value: 35_934_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'operatingCashFlow', value: 111_482_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'capex', value: 12_715_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'depreciation', value: 11_698_000_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'valuation', key: 'marketCap', value: 3_800_000_000_000, unit: 'USD', asOf: '', source: 'finnhub' },
      { group: 'market', key: 'beta', value: 1.1, unit: '', asOf: '', source: 'finnhub' },
    ]
    const report = await buildResearchReport(
      fixtureProvider,
      { symbol: 'AAPL', reportType: 'equity-deep-dive' },
      undefined,
      'en',
      [],
      metrics,
      {
        explicitYears: 3,
        fadeYears: 4,
        terminalGrowthPercent: 3.5,
        equityRiskPremiumPercent: 0,
        riskFreeFallbackPercent: 4,
        creditSpreadPercent: 0,
        taxRateFallbackPercent: 21,
        bearGrowthShiftPercent: -5,
        bullGrowthShiftPercent: 5,
        bearMarginShiftPercent: -2,
        bullMarginShiftPercent: 2,
        bearProbability: 0.25,
        bullProbability: 0.25,
        accumulateUpsidePercent: 15,
        reduceUpsidePercent: -10,
        terminalValueCeilingPercent: 20,
      },
    )
    const valuation = sectionOf(report, 'Model Valuation And Reference Range')
    expect(valuation).toContain('| Not obtained |')
    expect(valuation).toContain('The terminal-value share is above its ceiling, so read the range as an upper bound.')
  })

  it('stalls the valuation without listing a ratio it could compute', async () => {
    // Every ratio resolves, but no equity value means the weighted cost of capital cannot exist.
    const metrics: readonly AssetMetric[] = [
      { group: 'growth', key: 'revenue', value: 1_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'grossProfit', value: 450, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'operatingIncome', value: 200, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'netIncome', value: 150, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'totalAssets', value: 1_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'currentAssets', value: 400, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'currentLiabilities', value: 200, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'equity', value: 400, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'totalDebt', value: 200, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'cash', value: 100, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'operatingCashFlow', value: 180, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'freeCashFlow', value: 150, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'capex', value: 30, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'depreciation', value: 20, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
    ]
    const report = await buildResearchReport(
      fixtureProvider, { symbol: 'AAPL', reportType: 'equity-deep-dive' }, undefined, 'en', [], metrics,
    )
    const valuation = sectionOf(report, 'Model Valuation And Reference Range')
    expect(valuation).toContain('Required inputs: reported statements')
    expect(valuation).not.toContain('Inputs this read still needs:')
  })

  it('calls the value a target price only when a passing backtest is recorded', async () => {
    const metrics: readonly AssetMetric[] = [
      { group: 'growth', key: 'revenue', value: 1_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'operatingIncome', value: 200, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'profitability', key: 'netIncome', value: 150, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'operatingCashFlow', value: 180, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'capex', value: 20, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'cash', key: 'depreciation', value: 10, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'balance', key: 'totalAssets', value: 1_000, unit: 'USD', asOf: 'FY2025 10-K', source: 'finnhub' },
      { group: 'valuation', key: 'marketCap', value: 10_000, unit: 'USD', asOf: '', source: 'finnhub' },
      { group: 'growth', key: 'revenueGrowth', value: 6, unit: '%', asOf: '', source: 'finnhub' },
    ]
    const summary = summarizeBacktest(
      Array.from({ length: 60 }, () => ({ valuePerShare: 100, entryPrice: 120, exitPrice: 100 })),
      12,
    ) as BacktestSummary
    const validation: ValuationValidation = { asOf: '2026-09-23', symbols: 8, horizonMonths: 12, summary }
    const report = await buildResearchReport(
      fixtureProvider,
      { symbol: 'AAPL', reportType: 'equity-deep-dive' },
      undefined,
      'en',
      [],
      metrics,
      undefined,
      validation,
    )
    const valuation = sectionOf(report, 'Model Valuation And Reference Range')
    expect(valuation).toContain('| Target price range (bear–bull) |')
    expect(valuation).toContain('passed the recorded out-of-sample backtest over 60 symbol-dates on 2026-09-23')
    expect(sectionOf(report, 'Investment View')).toContain('Target price range')
    expect(report.markdown).not.toContain('Model reference range')

    // A checkout whose backtest has never run carries no evidence and prints the plain notice.
    const unrun = await buildResearchReport(
      fixtureProvider,
      { symbol: 'AAPL', reportType: 'equity-deep-dive' },
      undefined,
      'en',
      [],
      metrics,
      undefined,
      NO_BACKTEST,
    )
    expect(sectionOf(unrun, 'Model Valuation And Reference Range'))
      .toContain('the model has not passed an out-of-sample backtest')
  })

  it('asks for the valuation inputs when no instrument metrics loaded', async () => {
    const report = await buildResearchReport(fixtureProvider, { symbol: 'AAPL', reportType: 'equity-deep-dive' })
    const valuation = sectionOf(report, 'Model Valuation And Reference Range')
    expect(valuation).toContain('reported statements')
    expect(valuation).toContain('a government yield')
  })

  it('renders the comparable-company table when peer figures loaded', async () => {
    const metrics: readonly AssetMetric[] = [
      { group: 'competition', key: 'peRatio', value: 32.5, unit: '', asOf: '', source: 'finnhub', subject: 'AAPL' },
      { group: 'competition', key: 'roe', value: 137.2, unit: '%', asOf: '', source: 'finnhub', subject: 'AAPL' },
      { group: 'competition', key: 'peRatio', value: 28.1, unit: '', asOf: '', source: 'finnhub', subject: 'MSFT' },
    ]
    const report = await buildResearchReport(
      fixtureProvider,
      { symbol: 'AAPL', reportType: 'equity-deep-dive' },
      undefined,
      'en',
      [],
      metrics,
    )
    const comparables = sectionOf(report, 'Competitive Position')
    expect(comparables).toContain('| Company |')
    expect(comparables).toContain('| AAPL | 32.5 | 137.20% |')
    // A peer that did not publish a figure still gets its row.
    expect(comparables).toContain('| MSFT | 28.1 | — |')
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
    expect(sectionOf(report, 'Valuation Framework')).toContain('| Diluted EPS | 36.82 CNY（2026-06-30） | akshare |')
    expect(sectionOf(report, 'Valuation Framework')).toContain('1.57T CNY')
    expect(sectionOf(report, 'Financial Quality')).toContain('| Return on equity | 17.72%（2026-06-30） | akshare |')
    expect(sectionOf(report, 'Financial Quality')).toContain('| Current ratio | 5.59（2026-06-30） | akshare |')
    const withIndustry = await buildResearchReport(fixtureProvider, { symbol: 'AAPL' }, undefined, 'en', [], [
      { group: 'industry', key: 'industryName', value: 0, text: '酒、饮料和精制茶制造业', unit: '', asOf: '2026-09-21', source: 'akshare' },
    ])
    expect(sectionOf(withIndustry, 'Industry Landscape')).toContain('| Industry | 酒、饮料和精制茶制造业（2026-09-21） | akshare |')
    expect(sectionOf(report, 'Earnings Review')).toContain('| Net profit growth (YoY) | -2.03%（2026-06-30） | akshare |')
    // A category block with no matching metric still reports what it needs.
    const crypto = await buildResearchReport(fixtureProvider, { symbol: 'BTC' }, undefined, 'en', [], metrics)
    const community = await buildResearchReport(fixtureProvider, { symbol: 'BTC', reportType: 'crypto-deep-dive' }, undefined, 'en', [],
      [{ group: 'community', key: 'watchlistUsers', value: 2_452_829, unit: '', asOf: '', source: 'coingecko' }])
    expect(sectionOf(community, 'Project And Community')).toContain('coingecko')
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
      '行业格局', '估值框架', '模型估值与参考价值区间', '业绩点评', '财务质量', '竞争格局', '股权与内部人',
      '催化剂', '技术指标', '多指标综合',
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
    expect(blocks).toContain('| US | us-10y-yield | 4.94 % | 2026-09-17 | coincident | fred |')
    expect(blocks).toContain('| US | us-10y-yield | 4.94 % | 2026-09-17 | coincident | fred |')
    expect(blocks).toContain('| CN | cn-government-debt | 106.90 % | 2026 (projection) | coincident | fred |')
    expect(blocks).toContain('Macro Drivers')
  })

  it('renders scheduled catalysts and insider metrics when the extras are loaded', async () => {
    const metrics: readonly AssetMetric[] = [
      { group: 'catalyst', key: 'nextEarnings', value: 0, text: '2026-10-22', unit: '', asOf: '', source: 'finnhub' },
      { group: 'catalyst', key: 'newsHeadlines', value: 0, text: 'Apple unveils the next iPhone', unit: '', asOf: '', source: 'finnhub' },
      { group: 'insider', key: 'insiderNetShares', value: -1_200, unit: '', asOf: '', source: 'finnhub' },
      { group: 'insider', key: 'insiderSentiment', value: 22.1, unit: '', asOf: '', source: 'finnhub' },
    ]
    const report = await buildResearchReport(
      fixtureProvider,
      { symbol: 'AAPL', reportType: 'equity-earnings' },
      undefined,
      'en',
      [],
      metrics,
    )
    const catalysts = sectionOf(report, 'Catalysts')
    expect(catalysts).toContain('| Next scheduled earnings | 2026-10-22 | finnhub |')
    expect(catalysts).toContain('| Recent headlines | Apple unveils the next iPhone | finnhub |')
    expect(catalysts).toContain('**What to watch**')
    // The standing list stays under the dated events.
    expect(catalysts).toContain('- earnings and guidance')
    expect(catalysts).not.toContain('Missing inputs')
    const insiders = sectionOf(report, 'Ownership And Insiders')
    expect(insiders).toContain('| Insider net share change (month) | -1.2K | finnhub |')
    expect(insiders).toContain('| Insider sentiment (MSPR) | 22.1 | finnhub |')
  })

  it('asks for the missing catalysts and ownership inputs when nothing was loaded', async () => {
    const report = await buildResearchReport(fixtureProvider, { symbol: 'AAPL', reportType: 'equity-earnings' })
    expect(sectionOf(report, 'Catalysts')).toContain('scheduled events')
    expect(sectionOf(report, 'Ownership And Insiders')).toContain('insider transactions')
  })

  it('renders macro series in Chinese with localized names, units, and cycle timing', async () => {
    const series = {
      ...macroSeries('brent-crude', 130.8, 'commodity', 'global', 'USD/barrel', '2026-09-15'),
      name: 'Brent crude oil price',
      nameZh: '布伦特原油价格',
    }
    const report = await buildResearchReport(
      fixtureProvider,
      { symbol: 'GLD', reportType: 'commodity-fx-deep-dive' },
      undefined,
      'zh',
      [series] as never,
    )
    const balance = sectionOf(report, '供需平衡')
    // Name, unit, cycle token, and column labels all follow the report language.
    expect(balance).toContain('| 地区 | 指标 | 数值 | 日期 | 周期 | 来源 |')
    expect(balance).toContain('| GLOBAL | 布伦特原油价格 | 130.80 美元/桶 | 2026-09-15 | 同步 | fred |')
    // An English report keeps the upstream name, unit, and cycle token.
    const english = await buildResearchReport(
      fixtureProvider,
      { symbol: 'GLD', reportType: 'commodity-fx-deep-dive' },
      undefined,
      'en',
      [series] as never,
    )
    expect(sectionOf(english, 'Supply And Demand Balance')).toContain('| GLOBAL | Brent crude oil price | 130.80 USD/barrel |')
  })

  it('renders commodity and currency series and keeps the inputs they still lack', async () => {
    const macro = [
      macroSeries('brent-crude', 130.8, 'commodity', 'global', 'USD/barrel', '2026-09-15'),
      macroSeries('usd-cny', 6.6975, 'currency', 'cn', 'CNY per USD', '2026-09-18'),
    ]
    const report = await buildResearchReport(
      fixtureProvider,
      { symbol: 'GLD', reportType: 'commodity-fx-deep-dive' },
      undefined,
      'en',
      macro as never,
    )
    const balance = sectionOf(report, 'Supply And Demand Balance')
    expect(balance).toContain('| GLOBAL | brent-crude |')
    expect(balance).toContain('Still missing: ')
    expect(balance).toContain('inventories')
    const fx = sectionOf(report, 'FX Drivers')
    expect(fx).toContain('| CN | usd-cny |')
    expect(fx).toContain('Still missing: ')
  })

  it('drops the gap note once inventories and positioning loaded', async () => {
    const macro = [
      macroSeries('brent-crude', 130.8, 'commodity', 'global', 'USD/barrel', '2026-09-15'),
      macroSeries('eia-crude-stocks', 415_000, 'inventory', 'us', 'thousand barrels', '2026-09-11'),
      macroSeries('cftc-usd-index-net', 34_571, 'positioning', 'us', 'contracts', '2026-09-15'),
    ]
    const report = await buildResearchReport(
      fixtureProvider,
      { symbol: 'GLD', reportType: 'commodity-fx-deep-dive' },
      undefined,
      'en',
      macro as never,
    )
    const balance = sectionOf(report, 'Supply And Demand Balance')
    expect(balance).toContain('| US | eia-crude-stocks |')
    // The cost curve has no upstream yet, so it stays named.
    expect(balance).toContain('Still missing: the cost curve and futures term structure')
    const fx = sectionOf(report, 'FX Drivers')
    expect(fx).toContain('| US | cftc-usd-index-net |')
    expect(fx).not.toContain('Still missing')
  })

  it('keeps the input-demanding block when no commodity or currency series loaded', async () => {
    const report = await buildResearchReport(
      fixtureProvider,
      { symbol: 'GLD', reportType: 'commodity-fx-deep-dive' },
      undefined,
      'en',
    )
    const balance = sectionOf(report, 'Supply And Demand Balance')
    expect(balance).toContain('inventories')
    expect(balance).not.toContain('Still missing: ')
    expect(sectionOf(report, 'FX Drivers')).toContain('rate differentials')
  })

  it('renders published headlines in the event context when the snapshot carries them', async () => {
    const metrics: readonly AssetMetric[] = [
      { group: 'catalyst', key: 'newsHeadlines', value: 0, text: 'Apple unveils the next iPhone', unit: '', asOf: '', source: 'finnhub' },
      { group: 'catalyst', key: 'latestFilingForm', value: 0, text: '10-Q', unit: '', asOf: '', source: 'finnhub' },
    ]
    const report = await buildResearchReport(
      fixtureProvider,
      { symbol: 'AAPL', reportType: 'equity-event' },
      undefined,
      'en',
      [],
      metrics,
    )
    const context = sectionOf(report, 'Event Context')
    expect(context).toContain('| Recent headlines | Apple unveils the next iPhone | finnhub |')
    expect(context).toContain('Still missing: ')
    expect(context).toContain('event timeline')
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
