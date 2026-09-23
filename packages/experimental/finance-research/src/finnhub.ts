/** Finnhub REST response normalization. */

import type { FinanceUsFundamentals } from './types.ts'

/** Finnhub metric fields this package quotes, with the normalized key and unit. */
const FINNHUB_METRICS: readonly (readonly [string, string])[] = [
  ['peTTM', 'peRatio'],
  ['pbAnnual', 'pbRatio'],
  ['psTTM', 'psRatio'],
  ['dividendYieldIndicatedAnnual', 'dividendYield'],
  ['roeTTM', 'roe'],
  ['roaTTM', 'roa'],
  ['netProfitMarginTTM', 'netMargin'],
  ['operatingMarginTTM', 'operatingMargin'],
  ['revenueGrowthTTMYoy', 'revenueGrowth'],
  ['epsGrowthTTMYoy', 'epsGrowth'],
  ['epsTTM', 'epsTtm'],
  ['beta', 'beta'],
]

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function finite(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Normalize the Finnhub profile, metrics, and peers answers for one ticker.
 * @param profile - `/stock/profile2` payload, or undefined when that call failed.
 * @param metric - `/stock/metric` payload, or undefined when that call failed.
 * @param peers - `/stock/peers` payload, or undefined when that call failed.
 * @param symbol - Ticker the answers belong to.
 * @returns The snapshot, or undefined when none of the calls published a company.
 */
export function normalizeFinnhubFundamentals(
  profile: unknown,
  metric: unknown,
  peers: unknown,
  symbol: string,
): FinanceUsFundamentals | undefined {
  const profileBody = record(profile)
  const name = text(profileBody?.name)
  const industry = text(profileBody?.finnhubIndustry)
  const exchange = text(profileBody?.exchange)
  const metrics = record(record(metric)?.metric)
  const indicators: Record<string, number> = {}
  for (const [field, key] of FINNHUB_METRICS) {
    const value = finite(metrics?.[field])
    if (value !== undefined) indicators[key] = value
  }
  // Profile market capitalisation is published in millions.
  const marketCapMillions = finite(profileBody?.marketCapitalization)
  if (marketCapMillions !== undefined) indicators.marketCap = marketCapMillions * 1_000_000
  const peerList = Array.isArray(peers)
    ? peers.flatMap(entry => text(entry) === undefined ? [] : [text(entry) as string])
    : undefined
  if (name === undefined && Object.keys(indicators).length === 0) return undefined
  return {
    symbol: text(profileBody?.ticker) ?? symbol,
    ...name === undefined ? {} : { name },
    ...industry === undefined ? {} : { industry },
    ...exchange === undefined ? {} : { exchange },
    ...peerList === undefined || peerList.length === 0 ? {} : { peers: peerList },
    indicators,
  }
}

/** One news headline Finnhub returns for a company. */
function latestHeadlines(payload: unknown, limit: number): readonly string[] {
  if (!Array.isArray(payload)) return []
  return payload
    .flatMap(entry => text(record(entry)?.headline) === undefined ? [] : [text(record(entry)?.headline) as string])
    .slice(0, limit)
}

/**
 * Read the next scheduled earnings date from a Finnhub earnings calendar.
 * @param payload - `/calendar/earnings` payload, or undefined when that call failed.
 * @param today - Date the answer is resolved against.
 * @returns The earliest date on or after `today`, or undefined when none is scheduled.
 */
export function nextEarningsDate(payload: unknown, today: Date): string | undefined {
  const rows = record(payload)?.earningsCalendar
  if (!Array.isArray(rows)) return undefined
  const todayText = today.toISOString().slice(0, 10)
  return rows
    .flatMap(entry => text(record(entry)?.date) === undefined ? [] : [text(record(entry)?.date) as string])
    .filter(date => date >= todayText)
    .sort()[0]
}

/**
 * Read the newest reported EPS surprise from a Finnhub earnings history.
 * @param payload - `/stock/earnings` payload, or undefined when that call failed.
 * @returns The surprise percentage, or undefined when the payload carries none.
 */
export function latestEpsSurprise(payload: unknown): number | undefined {
  if (!Array.isArray(payload)) return undefined
  const values = payload.flatMap((entry) => {
    const surprise = finite(record(entry)?.surprisePercent)
    return surprise === undefined ? [] : [surprise]
  })
  return values[0]
}

/**
 * Read the newest monthly insider sentiment.
 * @param payload - `/stock/insider-sentiment` payload, or undefined when that call failed.
 * @returns The month's net share change and its sentiment score, when published.
 */
export function latestInsiderSentiment(payload: unknown): { readonly netShares?: number; readonly sentiment?: number } {
  const rows = record(payload)?.data
  if (!Array.isArray(rows)) return {}
  const latest: unknown = rows.at(-1)
  const entry = record(latest)
  const netShares = finite(entry?.change)
  const sentiment = finite(entry?.mspr)
  return {
    ...netShares === undefined ? {} : { netShares },
    ...sentiment === undefined ? {} : { sentiment },
  }
}

/**
 * Read the newest analyst rating counts from a Finnhub recommendation trend.
 * @param payload - `/stock/recommendation` payload, or undefined when that call failed.
 * @returns The newest period and its buy, hold, and sell counts.
 */
export function latestAnalystConsensus(payload: unknown): {
  readonly period?: string
  readonly buy?: number
  readonly hold?: number
  readonly sell?: number
} {
  if (!Array.isArray(payload)) return {}
  // Trends are ordered by the period the ratings were published for.
  const trends = payload.flatMap((row) => {
    const entry = record(row)
    const period = text(entry?.period)
    return entry === undefined || period === undefined ? [] : [{ entry, period }]
  })
  const newest = trends.sort((left, right) => right.period.localeCompare(left.period))[0]
  if (newest === undefined) return {}
  const strongBuy = finite(newest.entry.strongBuy)
  const buy = finite(newest.entry.buy)
  const hold = finite(newest.entry.hold)
  const sell = finite(newest.entry.sell)
  const strongSell = finite(newest.entry.strongSell)
  const bull = strongBuy === undefined && buy === undefined
    ? undefined
    : (strongBuy ?? 0) + (buy ?? 0)
  const bear = sell === undefined && strongSell === undefined
    ? undefined
    : (sell ?? 0) + (strongSell ?? 0)
  return {
    period: newest.period,
    ...bull === undefined ? {} : { buy: bull },
    ...hold === undefined ? {} : { hold },
    ...bear === undefined ? {} : { sell: bear },
  }
}

/**
 * Total the disclosed insider share purchases and sales over a trailing window.
 * @param payload - `/stock/insider-transactions` payload, or undefined when that call failed.
 * @param today - Date the window ends on.
 * @param windowDays - Length of the trailing window in days.
 * @returns Bought and sold share totals, when the feed published either.
 */
export function insiderTradeTotals(
  payload: unknown,
  today: Date,
  windowDays: number,
): { readonly bought?: number; readonly sold?: number } {
  const rows = record(payload)?.data
  if (!Array.isArray(rows)) return {}
  const from = new Date(today.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10)
  let bought = 0
  let sold = 0
  let published = 0
  for (const row of rows) {
    const entry = record(row)
    const date = text(entry?.transactionDate)
    const change = finite(entry?.change)
    if (date === undefined || change === undefined || date < from) continue
    published += 1
    if (change > 0) bought += change
    else sold -= change
  }
  if (published === 0) return {}
  return {
    ...bought === 0 ? {} : { bought },
    ...sold === 0 ? {} : { sold },
  }
}

/**
 * Read the newest SEC filing that is not an insider ownership form.
 * @param payload - `/stock/filings` payload, or undefined when that call failed.
 * @returns The filing form and its filed date, or the newest filing when every entry is an ownership form.
 */
export function latestMaterialFiling(payload: unknown): { readonly form?: string; readonly date?: string } {
  if (!Array.isArray(payload)) return {}
  const filings = payload.flatMap((entry) => {
    const body = record(entry)
    const form = text(body?.form)
    const filed = text(body?.filedDate)
    if (body === undefined || form === undefined || filed === undefined) return []
    return [{ body, form, date: filed.slice(0, 10) }]
  })
  // Forms 3, 4, 5, and 144 report insider ownership, which the insider metrics already cover.
  const material = filings.filter(entry => !['3', '4', '5', '144'].includes(entry.form))
  const newest = (material.length === 0 ? filings : material)
    .sort((left, right) => right.date.localeCompare(left.date))[0]
  return newest === undefined ? {} : { form: newest.form, date: newest.date }
}

/** Revenue concepts a reported income statement may file, most specific first. */
const REVENUE_CONCEPTS: readonly string[] = [
  'us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax',
  'us-gaap_RevenueFromContractWithCustomerIncludingAssessedTax',
  'us-gaap_Revenues',
]
/** Net-income concepts a reported income statement may file, most specific first. */
const NET_INCOME_CONCEPTS: readonly string[] = ['us-gaap_NetIncomeLoss', 'us-gaap_ProfitLoss']

/** One reported line: the metric it fills, its statement section, and the concepts to try. */
interface ReportedLineSpec {
  readonly key: string
  readonly bucket: string
  readonly concepts: readonly string[]
}

/**
 * Lines the financial-quality block quotes, all published by the same free statements endpoint.
 * A concept list holds the alternatives filers use, most specific first.
 */
const REPORTED_LINES: readonly ReportedLineSpec[] = [
  { key: 'revenue', bucket: 'ic', concepts: REVENUE_CONCEPTS },
  { key: 'grossProfit', bucket: 'ic', concepts: ['us-gaap_GrossProfit'] },
  { key: 'operatingIncome', bucket: 'ic', concepts: ['us-gaap_OperatingIncomeLoss'] },
  { key: 'netIncome', bucket: 'ic', concepts: NET_INCOME_CONCEPTS },
  { key: 'pretaxIncome', bucket: 'ic', concepts: [
    'us-gaap_IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
    'us-gaap_IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
  ] },
  { key: 'taxExpense', bucket: 'ic', concepts: ['us-gaap_IncomeTaxExpenseBenefit'] },
  { key: 'interestExpense', bucket: 'ic', concepts: ['us-gaap_InterestExpense', 'us-gaap_InterestExpenseNonoperating'] },
  { key: 'totalAssets', bucket: 'bs', concepts: ['us-gaap_Assets'] },
  { key: 'currentAssets', bucket: 'bs', concepts: ['us-gaap_AssetsCurrent'] },
  { key: 'currentLiabilities', bucket: 'bs', concepts: ['us-gaap_LiabilitiesCurrent'] },
  { key: 'retainedEarnings', bucket: 'bs', concepts: ['us-gaap_RetainedEarningsAccumulatedDeficit'] },
  // Filers publish either the period-end share count or a weighted average; the later entry wins.
  { key: 'sharesOutstanding', bucket: 'ic', concepts: [
    'us-gaap_WeightedAverageNumberOfDilutedSharesOutstanding',
    'us-gaap_WeightedAverageNumberOfSharesOutstandingBasic',
  ] },
  { key: 'sharesOutstanding', bucket: 'bs', concepts: [
    'us-gaap_CommonStockSharesOutstanding',
    'us-gaap_EntityCommonStockSharesOutstanding',
  ] },
  { key: 'liabilities', bucket: 'bs', concepts: ['us-gaap_Liabilities'] },
  { key: 'equity', bucket: 'bs', concepts: [
    'us-gaap_StockholdersEquity',
    'us-gaap_StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
  ] },
  { key: 'cash', bucket: 'bs', concepts: [
    'us-gaap_CashAndCashEquivalentsAtCarryingValue',
    'us-gaap_CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
  ] },
  { key: 'operatingCashFlow', bucket: 'cf', concepts: ['us-gaap_NetCashProvidedByUsedInOperatingActivities'] },
  { key: 'capex', bucket: 'cf', concepts: [
    'us-gaap_PaymentsToAcquirePropertyPlantAndEquipment',
    'us-gaap_PaymentsToAcquireProductiveAssets',
  ] },
  { key: 'dividendsPaid', bucket: 'cf', concepts: ['us-gaap_PaymentsOfDividends', 'us-gaap_PaymentsOfDividendsCommonStock'] },
  { key: 'buybacks', bucket: 'cf', concepts: ['us-gaap_PaymentsForRepurchaseOfCommonStock'] },
  { key: 'stockBasedCompensation', bucket: 'cf', concepts: ['us-gaap_ShareBasedCompensation'] },
  { key: 'depreciation', bucket: 'cf', concepts: [
    'us-gaap_DepreciationDepletionAndAmortization',
    'us-gaap_DepreciationAmortizationAndAccretionNet',
  ] },
]

/** Debt components a reported balance sheet may carry; each component resolves on its own concept list. */
const DEBT_COMPONENTS: readonly (readonly string[])[] = [
  ['us-gaap_LongTermDebtCurrent'],
  ['us-gaap_CommercialPaper'],
  ['us-gaap_LongTermDebtNoncurrent', 'us-gaap_LongTermDebt'],
]

/**
 * Read one reported figure out of a statement bucket by concept.
 * @param statement - Reported statement record.
 * @param bucket - Statement section, such as `ic`.
 * @param concepts - Concepts to try, most specific first.
 * @returns The reported value, or undefined when the statement omits every concept.
 */
function reportedFigure(statement: unknown, bucket: string, concepts: readonly string[]): number | undefined {
  const rows = record(statement)?.[bucket]
  if (!Array.isArray(rows)) return undefined
  for (const concept of concepts) {
    for (const row of rows as readonly unknown[]) {
      if (record(row)?.concept !== concept) continue
      const value = finite(record(row)?.value)
      if (value !== undefined) return value
    }
  }
  return undefined
}

/**
 * Read every reported line the financial-quality block quotes out of the three statements.
 * @param statement - Reported statement record carrying the `ic`, `bs`, and `cf` sections.
 * @returns The reported values keyed by metric name; a filing that omits a line leaves the key out.
 */
function reportedLines(statement: unknown): Readonly<Record<string, number>> {
  const lines: Record<string, number> = {}
  for (const { key, bucket, concepts } of REPORTED_LINES) {
    const value = reportedFigure(statement, bucket, concepts)
    if (value !== undefined) lines[key] = value
  }
  // Debt has no single concept, so the components are whatever the balance sheet filed.
  const components = DEBT_COMPONENTS.flatMap((concepts) => {
    const value = reportedFigure(statement, 'bs', concepts)
    return value === undefined ? [] : [value]
  })
  if (components.length > 0) lines.totalDebt = components.reduce((sum, value) => sum + value, 0)
  const operatingCashFlow = lines.operatingCashFlow
  const capex = lines.capex
  if (operatingCashFlow !== undefined && capex !== undefined) lines.freeCashFlow = operatingCashFlow - capex
  return lines
}

/** Period label and reported figures of the newest statements. */
export interface FinnhubReportedFinancials {
  /** Label such as `FY2025 10-K`. */
  readonly label: string
  /** Reported figures keyed by metric name. */
  readonly lines: Readonly<Record<string, number>>
}

/** One reported period, with the filing it came from. */
export interface FinnhubReportedPeriod extends FinnhubReportedFinancials {
  /** Period the statement covers, as `YYYY-MM-DD`, when the answer published one. */
  readonly endDate?: string
  /** SEC form the statement was filed on, such as `10-K`. */
  readonly form: string
}

/**
 * Read every reported period an answer carries, newest first as the endpoint orders them.
 * @param payload - `/stock/financials-reported` payload, or undefined when that call failed.
 * @returns One record per period the answer published, or an empty list when it carried none.
 */
export function reportedFinancialsHistory(payload: unknown): readonly FinnhubReportedPeriod[] {
  const rows = record(payload)?.data
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row) => {
    const entry = record(row)
    const year = finite(entry?.year)
    const form = text(entry?.form)
    if (year === undefined || form === undefined) return []
    const quarter = finite(entry?.quarter)
    const period = quarter === undefined || quarter === 0 ? `FY${year}` : `Q${quarter} ${year}`
    const endDate = text(entry?.endDate)?.slice(0, 10)
    return [{
      label: `${period} ${form}`,
      form,
      ...endDate === undefined ? {} : { endDate },
      lines: reportedLines(record(entry)?.report),
    }]
  })
}

/**
 * Read the period label and the reported lines of the newest reported statements.
 * @param payload - `/stock/financials-reported` payload, or undefined when that call failed.
 * @returns The label with whatever lines the statement published, or undefined when no period was published.
 */
export function latestReportedFinancials(payload: unknown): FinnhubReportedFinancials | undefined {
  const [newest] = reportedFinancialsHistory(payload)
  return newest === undefined ? undefined : { label: newest.label, lines: newest.lines }
}

/** Free-tier extras a Finnhub lookup adds to the fundamentals snapshot. */
export interface FinnhubExtras {
  readonly headlines?: readonly string[]
  readonly nextEarnings?: string
  readonly epsSurprise?: number
  readonly insiderNetShares?: number
  readonly insiderSentiment?: number
  readonly analystPeriod?: string
  readonly analystBuy?: number
  readonly analystHold?: number
  readonly analystSell?: number
  readonly insiderBoughtShares?: number
  readonly insiderSoldShares?: number
  readonly latestFilingForm?: string
  readonly latestFilingDate?: string
  readonly reportedFinancials?: string
  /** Reported statement lines keyed by metric name, carrying the period `reportedFinancials` names. */
  readonly reportedLines?: Readonly<Record<string, number>>
}

/**
 * Normalize the free-tier extras Finnhub publishes beside the fundamentals.
 * @param payloads - Company news, calendar, earnings, insider, analyst, filings, and reported statements.
 * @param today - Date the earnings calendar and the insider window are resolved against.
 * @returns Extras that carry at least one value.
 */
export function normalizeFinnhubExtras(
  payloads: {
    readonly news?: unknown
    readonly calendar?: unknown
    readonly earnings?: unknown
    readonly insider?: unknown
    readonly recommendation?: unknown
    readonly transactions?: unknown
    readonly filings?: unknown
    readonly reported?: unknown
  },
  today: Date,
): FinnhubExtras {
  const headlines = latestHeadlines(payloads.news, 3)
  const nextEarnings = nextEarningsDate(payloads.calendar, today)
  const epsSurprise = latestEpsSurprise(payloads.earnings)
  const insider = latestInsiderSentiment(payloads.insider)
  const analyst = latestAnalystConsensus(payloads.recommendation)
  const trades = insiderTradeTotals(payloads.transactions, today, 90)
  const filing = latestMaterialFiling(payloads.filings)
  const reported = latestReportedFinancials(payloads.reported)
  return {
    ...headlines.length === 0 ? {} : { headlines },
    ...nextEarnings === undefined ? {} : { nextEarnings },
    ...epsSurprise === undefined ? {} : { epsSurprise },
    ...insider.netShares === undefined ? {} : { insiderNetShares: insider.netShares },
    ...insider.sentiment === undefined ? {} : { insiderSentiment: insider.sentiment },
    ...analyst.period === undefined ? {} : { analystPeriod: analyst.period },
    ...analyst.buy === undefined ? {} : { analystBuy: analyst.buy },
    ...analyst.hold === undefined ? {} : { analystHold: analyst.hold },
    ...analyst.sell === undefined ? {} : { analystSell: analyst.sell },
    ...trades.bought === undefined ? {} : { insiderBoughtShares: trades.bought },
    ...trades.sold === undefined ? {} : { insiderSoldShares: trades.sold },
    ...filing.form === undefined ? {} : { latestFilingForm: filing.form },
    ...filing.date === undefined ? {} : { latestFilingDate: filing.date },
    ...reported === undefined ? {} : { reportedFinancials: reported.label, reportedLines: reported.lines },
  }
}
