import { describe, expect, it } from 'vitest'
import {
  insiderTradeTotals, latestAnalystConsensus, latestEpsSurprise, latestInsiderSentiment,
  latestMaterialFiling, latestReportedFinancials, nextEarningsDate,
  normalizeFinnhubExtras, normalizeFinnhubFundamentals,
} from '../src/finnhub.ts'

describe('Finnhub normalization', () => {
  it('reads the profile, the metric set, and the peer list', () => {
    const snapshot = normalizeFinnhubFundamentals(
      {
        name: 'Apple Inc',
        ticker: 'AAPL',
        exchange: 'NASDAQ',
        finnhubIndustry: 'Technology',
        marketCapitalization: 3_000_000,
      },
      {
        metric: {
          peTTM: 32.5,
          pbAnnual: 45.2,
          psTTM: 8.1,
          dividendYieldIndicatedAnnual: 0.45,
          roeTTM: 150,
          roaTTM: 25,
          netProfitMarginTTM: 25.3,
          operatingMarginTTM: 31.5,
          revenueGrowthTTMYoy: 8,
          epsGrowthTTMYoy: 12,
          epsTTM: 6.1,
          beta: 1.2,
          ignoredMetric: 1,
        },
      },
      ['AAPL', 'MSFT', 'GOOGL'],
      'AAPL',
    )
    expect(snapshot).toMatchObject({
      symbol: 'AAPL',
      name: 'Apple Inc',
      industry: 'Technology',
      exchange: 'NASDAQ',
      peers: ['AAPL', 'MSFT', 'GOOGL'],
    })
    expect(snapshot?.indicators).toMatchObject({
      peRatio: 32.5, pbRatio: 45.2, psRatio: 8.1, dividendYield: 0.45, roe: 150, roa: 25,
      netMargin: 25.3, operatingMargin: 31.5, revenueGrowth: 8, epsGrowth: 12, epsTtm: 6.1,
      beta: 1.2, marketCap: 3_000_000_000_000,
    })
    expect(snapshot?.indicators.ignoredMetric).toBeUndefined()
  })

  it('keeps whatever the answered calls published', () => {
    const metricOnly = normalizeFinnhubFundamentals(undefined, { metric: { peTTM: 10 } }, undefined, 'AAPL')
    expect(metricOnly).toEqual({ symbol: 'AAPL', indicators: { peRatio: 10 } })

    const profileOnly = normalizeFinnhubFundamentals({ name: 'Apple Inc', ticker: 'AAPL' }, undefined, 'nope', 'AAPL')
    expect(profileOnly).toEqual({ symbol: 'AAPL', name: 'Apple Inc', indicators: {} })

    // A peer list with unusable entries keeps only the usable symbols.
    const mixedPeers = normalizeFinnhubFundamentals({ name: 'Apple Inc' }, undefined, ['AAPL', 7, ''], 'AAPL')
    expect(mixedPeers?.peers).toEqual(['AAPL'])
  })

  it('reports nothing when no call published a company', () => {
    expect(normalizeFinnhubFundamentals(undefined, undefined, undefined, 'AAPL')).toBeUndefined()
    expect(normalizeFinnhubFundamentals({}, {}, [], 'AAPL')).toBeUndefined()
    expect(normalizeFinnhubFundamentals({ name: '', ticker: 'AAPL' }, { metric: {} }, ['AAPL'], 'AAPL')).toBeUndefined()
  })
})

describe('Finnhub free-tier extras', () => {
  const today = new Date('2026-09-22T00:00:00.000Z')

  it('reads analyst ratings, insider trades, filings, and reported statements', () => {
    const extras = normalizeFinnhubExtras({
      recommendation: [
        { period: '2026-08-01', strongBuy: 1, buy: 1, hold: 1, sell: 1, strongSell: 1 },
        { period: '2026-09-01', strongBuy: 12, buy: 22, hold: 15, sell: 3, strongSell: 1 },
      ],
      transactions: {
        data: [
          { transactionDate: '2026-08-25', change: -1_439 },
          { transactionDate: '2026-08-11', change: 4_000 },
          { transactionDate: '2026-01-05', change: -9_000 },
        ],
      },
      filings: [
        { form: '4', filedDate: '2026-08-27 00:00:00' },
        { form: '10-Q', filedDate: '2026-08-01 00:00:00' },
        { form: '10-K', filedDate: '2025-10-31 00:00:00' },
      ],
      reported: { cik: '320193', data: [{
        year: 2025,
        quarter: 0,
        form: '10-K',
        report: { ic: [
          { concept: 'us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax', value: 416_161_000_000 },
          { concept: 'us-gaap_NetIncomeLoss', value: 112_010_000_000 },
        ] },
      }] },
    }, today)
    expect(extras).toEqual({
      analystPeriod: '2026-09-01',
      analystBuy: 34,
      analystHold: 15,
      analystSell: 4,
      insiderBoughtShares: 4_000,
      insiderSoldShares: 1_439,
      latestFilingForm: '10-Q',
      latestFilingDate: '2026-08-01',
      reportedFinancials: 'FY2025 10-K',
      revenue: 416_161_000_000,
      netIncome: 112_010_000_000,
    })
  })

  it('reads the newer extras on their own', () => {
    expect(latestAnalystConsensus([{ period: '2026-09-01', buy: 3 }])).toEqual({ period: '2026-09-01', buy: 3 })
    // A trend without a period cannot be ordered, so it contributes nothing.
    expect(latestAnalystConsensus([{ strongBuy: 2, strongSell: 1 }])).toEqual({})
    expect(latestAnalystConsensus([{ period: '2026-09-01', strongBuy: 2, buy: 1, hold: 0, sell: 0, strongSell: 0 }]))
      .toEqual({ period: '2026-09-01', buy: 3, hold: 0, sell: 0 })
    // A period with no published counts carries only the period.
    expect(latestAnalystConsensus([{ period: '2026-09-01' }])).toEqual({ period: '2026-09-01' })
    expect(latestAnalystConsensus([{ period: '2026-09-01', sell: 1 }])).toEqual({ period: '2026-09-01', sell: 1 })
    expect(latestAnalystConsensus([{ period: '2026-09-01', strongBuy: 5, strongSell: 2 }]))
      .toEqual({ period: '2026-09-01', buy: 5, sell: 2 })
    expect(latestAnalystConsensus([{ period: 7 }])).toEqual({})
    expect(latestAnalystConsensus({})).toEqual({})

    expect(insiderTradeTotals({ data: [{ transactionDate: '2026-08-25', change: 5 }] }, today, 90)).toEqual({ bought: 5 })
    expect(insiderTradeTotals({ data: [{ transactionDate: '2026-08-25', change: 'nope' }] }, today, 90)).toEqual({})
    // A window whose only trades moved no shares reports no totals.
    expect(insiderTradeTotals({ data: [{ transactionDate: '2026-08-25', change: 0 }] }, today, 90)).toEqual({})
    expect(insiderTradeTotals({ data: [] }, today, 90)).toEqual({})
    expect(insiderTradeTotals({}, today, 90)).toEqual({})

    // Every entry an ownership form still reports the newest filing.
    expect(latestMaterialFiling([{ form: '4', filedDate: '2026-08-27 00:00:00' }, { form: '144', filedDate: '2026-08-11 00:00:00' }]))
      .toEqual({ form: '4', date: '2026-08-27' })
    expect(latestMaterialFiling([{ form: '10-K' }, 7])).toEqual({})
    expect(latestMaterialFiling({})).toEqual({})

    expect(latestReportedFinancials({ data: [{ year: 2026, quarter: 3, form: '10-Q' }] })).toEqual({ label: 'Q3 2026 10-Q' })
    // The newest period wins even when an older filing is the one with statements.
    expect(latestReportedFinancials({ data: [{ quarter: 3, form: '10-Q' }, { year: 2025, form: '10-K' }] }))
      .toEqual({ label: 'FY2025 10-K' })
    // Reported totals come out of the income statement by concept.
    expect(latestReportedFinancials({ data: [{ year: 2025, quarter: 0, form: '10-K', report: { ic: [
      { concept: 'us-gaap_Revenues', value: 416_161_000_000 },
      { concept: 'us-gaap_NetIncomeLoss', value: 112_010_000_000 },
    ] } }] })).toEqual({ label: 'FY2025 10-K', revenue: 416_161_000_000, netIncome: 112_010_000_000 })
    // A statement that omits the concepts contributes the label alone.
    expect(latestReportedFinancials({ data: [{ year: 2025, quarter: 0, form: '10-K', report: { ic: [{}] } }] }))
      .toEqual({ label: 'FY2025 10-K' })
    expect(latestReportedFinancials({ data: [{ year: 2025, quarter: 0, form: '10-K', report: 'nope' }] }))
      .toEqual({ label: 'FY2025 10-K' })
    expect(latestReportedFinancials({ data: [] })).toBeUndefined()
    expect(latestReportedFinancials({})).toBeUndefined()
  })

  it('reads the headlines, the earnings calendar, the surprise, and insider sentiment', () => {
    const extras = normalizeFinnhubExtras({
      news: [
        { headline: 'Apple unveils the next iPhone' },
        { headline: 'Apple raises its buyback' },
        { headline: 'Analysts lift Apple targets' },
        { headline: 'A fourth headline the snapshot drops' },
      ],
      calendar: {
        earningsCalendar: [
          { date: '2026-10-29', symbol: 'AAPL' },
          { date: '2026-10-22', symbol: 'AAPL' },
          { date: '2026-09-01', symbol: 'AAPL' },
        ],
      },
      earnings: [{ period: '2026-06-30', actual: 1.4, estimate: 1.35, surprise: 0.05, surprisePercent: 3.7 }],
      insider: { data: [{ change: -1_200, mspr: -12.5 }, { change: 4_500, mspr: 22.1 }] },
    }, today)
    expect(extras).toEqual({
      headlines: [
        'Apple unveils the next iPhone',
        'Apple raises its buyback',
        'Analysts lift Apple targets',
      ],
      nextEarnings: '2026-10-22',
      epsSurprise: 3.7,
      insiderNetShares: 4_500,
      insiderSentiment: 22.1,
    })
  })

  it('drops fields the upstream omitted or published in another type', () => {
    expect(normalizeFinnhubExtras({}, today)).toEqual({})
    expect(normalizeFinnhubExtras({
      news: [{ headline: '' }, { title: 'no headline field' }, 'nope'],
      calendar: { earningsCalendar: [{ date: '2026-09-01' }, { date: 7 }] },
      earnings: [{ surprisePercent: 'nope' }],
      insider: { data: [{ change: 'nope' }] },
    }, today)).toEqual({})
    // A payload the upstream did not answer leaves every extra absent.
    expect(normalizeFinnhubExtras({
      news: undefined, calendar: undefined, earnings: undefined, insider: undefined,
    }, today)).toEqual({})
  })

  it('reads each extra on its own', () => {
    expect(nextEarningsDate({ earningsCalendar: [{ date: '2026-09-22' }] }, today)).toBe('2026-09-22')
    expect(nextEarningsDate({ earningsCalendar: [] }, today)).toBeUndefined()
    expect(nextEarningsDate({ nope: true }, today)).toBeUndefined()
    expect(latestEpsSurprise([{ surprisePercent: 0 }, { surprisePercent: 9 }])).toBe(0)
    expect(latestEpsSurprise({})).toBeUndefined()
    expect(latestInsiderSentiment({ data: [{ change: 10 }] })).toEqual({ netShares: 10 })
    expect(latestInsiderSentiment({ data: [{ mspr: -3 }] })).toEqual({ sentiment: -3 })
    expect(latestInsiderSentiment({ data: [] })).toEqual({})
    expect(latestInsiderSentiment({})).toEqual({})
  })
})
