/** Market and fundamental metrics a report quotes about its instrument. */

import { githubSlug } from './github.ts'
import type {
  FinanceCoinGeckoCommunity, FinanceCoinGeckoGlobal, FinanceCoinMarketCapQuote, FinanceGithubRepo,
  FinanceStockFundamentals, FinanceStockValuation, FinanceUsFundamentals,
} from './types.ts'

/**
 * Every metric key a builder can produce. The report copy dictionaries are typed
 * against this union, so adding a builder key without its label fails the build.
 */
export const REPORT_METRIC_KEYS = [
  'bookValuePerShare', 'cashConversion', 'change24h', 'change30d', 'change7d', 'change90d',
  'circulatingSupply', 'currentRatio', 'debtRatio', 'dividendYield', 'eps', 'epsGrowth', 'epsTtm',
  'fullyDilutedMarketCap', 'githubClosedIssues', 'githubCommits4w', 'githubForks', 'githubOpenIssues',
  'githubStars', 'githubSubscribers', 'githubWatchers', 'industry', 'industryName', 'industryPe',
  'industryPeArithmetic', 'industryPeCompanies', 'industryPeMedian', 'marketCap', 'marketCapDominance',
  'maxSupply', 'netMargin', 'operatingMargin', 'pb', 'pbRatio', 'peRatio', 'peStatic', 'peTtm',
  'peVsIndustry', 'peVsIndustryMedian', 'peers', 'profitGrowth', 'psRatio', 'rank', 'redditSubscribers',
  'revenueGrowth', 'roa', 'roe', 'sentimentDown', 'sentimentUp', 'telegramUsers', 'totalSupply',
  'twitterFollowers', 'volume24h', 'volumeChange24h', 'watchlistUsers', 'beta',
  'activeCryptocurrencies', 'analystBuy', 'analystHold', 'analystSell', 'athChangePercentage',
  'atlChangePercentage', 'btcDominance', 'epsSurprise', 'ethDominance', 'githubLatestRelease',
  'githubReleases1y', 'insiderBoughtShares', 'insiderNetShares', 'insiderSentiment', 'insiderSoldShares',
  'latestFilingDate', 'latestFilingForm', 'netIncome', 'newsHeadlines', 'nextEarnings',
  'reportedFinancials', 'revenue',
  // Reported statement lines the financial-quality block quotes.
  'buybacks', 'capex', 'cash', 'currentAssets', 'depreciation', 'dividendsPaid', 'equity',
  'freeCashFlow', 'grossProfit', 'liabilities', 'operatingCashFlow', 'operatingIncome',
  'stockBasedCompensation', 'totalAssets', 'totalDebt',
] as const

/** One metric key a report knows how to label. */
export type ReportMetricKey = typeof REPORT_METRIC_KEYS[number]

/** Dimensions an asset metric belongs to; report blocks claim one or more. */
export const ASSET_METRIC_GROUPS = [
  'valuation', 'profitability', 'growth', 'balance', 'cash',
  'market', 'supply', 'development', 'community', 'industry', 'competition', 'catalyst', 'insider',
] as const

/** One asset metric dimension. */
export type AssetMetricGroup = typeof ASSET_METRIC_GROUPS[number]

/** One reported metric about the instrument. */
export interface AssetMetric {
  readonly group: AssetMetricGroup
  /** Locale dictionary key for the metric label. */
  readonly key: ReportMetricKey
  readonly value: number
  /** Set instead of a number when the metric is textual, such as an industry name. */
  readonly text?: string
  /** Reported unit: `%`, `CNY`, `USD`, or empty for a bare ratio or count. */
  readonly unit: string
  /** Reporting period or observation time, as published upstream. */
  readonly asOf: string
  readonly source: string
  /** Instrument this metric describes, when a block compares several of them. */
  readonly subject?: string
}

/** Ratios the A-share fundamentals bridge reports, with their dimension and unit. */
const EQUITY_METRICS: readonly (readonly [ReportMetricKey, AssetMetricGroup, string])[] = [
  ['eps', 'valuation', 'CNY'],
  ['bookValuePerShare', 'valuation', 'CNY'],
  ['roe', 'profitability', '%'],
  ['netMargin', 'profitability', '%'],
  ['operatingMargin', 'profitability', '%'],
  ['revenueGrowth', 'growth', '%'],
  ['profitGrowth', 'growth', '%'],
  ['debtRatio', 'balance', '%'],
  ['currentRatio', 'balance', ''],
  ['cashConversion', 'cash', ''],
]

/**
 * Turn the newest reported A-share period into report metrics.
 * @param fundamentals - Normalized fundamentals series, when one loaded.
 * @returns Metrics for the newest reporting period, empty when none published.
 */
export function equityMetricsFromFundamentals(
  fundamentals: FinanceStockFundamentals | undefined,
): AssetMetric[] {
  const latest = fundamentals?.periods.at(-1)
  if (latest === undefined) return []
  return EQUITY_METRICS.flatMap(([key, group, unit]) => {
    const value = latest.metrics[key]
    return value === undefined ? [] : [{ group, key, value, unit, asOf: latest.period, source: 'akshare' }]
  })
}

/** Market fields a CoinMarketCap quote contributes, with their dimension and unit. */
const CRYPTO_QUOTE_METRICS: readonly (readonly [AssetMetricGroup, ReportMetricKey, string])[] = [
  ['market', 'rank', ''],
  ['market', 'marketCap', 'USD'],
  ['market', 'fullyDilutedMarketCap', 'USD'],
  ['market', 'marketCapDominance', '%'],
  ['market', 'volume24h', 'USD'],
  ['market', 'volumeChange24h', '%'],
  ['market', 'change24h', '%'],
  ['market', 'change7d', '%'],
  ['market', 'change30d', '%'],
  ['market', 'change90d', '%'],
  ['supply', 'circulatingSupply', ''],
  ['supply', 'totalSupply', ''],
  ['supply', 'maxSupply', ''],
]

/** Quote field backing each crypto metric key. */
const CRYPTO_QUOTE_FIELDS: Readonly<Record<string, keyof FinanceCoinMarketCapQuote>> = {
  rank: 'rank',
  marketCap: 'marketCap',
  fullyDilutedMarketCap: 'fullyDilutedMarketCap',
  marketCapDominance: 'marketCapDominance',
  volume24h: 'volume24h',
  volumeChange24h: 'volumeChange24h',
  change24h: 'percentChange24h',
  change7d: 'percentChange7d',
  change30d: 'percentChange30d',
  change90d: 'percentChange90d',
  circulatingSupply: 'circulatingSupply',
  totalSupply: 'totalSupply',
  maxSupply: 'maxSupply',
}

/**
 * Turn one CoinMarketCap quote into report metrics.
 * @param quote - Normalized quote, when one loaded.
 * @returns Market and supply metrics; fields the upstream omitted are skipped.
 */
export function cryptoMetricsFromQuote(quote: FinanceCoinMarketCapQuote | undefined): AssetMetric[] {
  if (quote === undefined) return []
  const asOf = quote.lastUpdated ?? ''
  return CRYPTO_QUOTE_METRICS.flatMap(([group, key, unit]) => {
    const value = quote[CRYPTO_QUOTE_FIELDS[key] as keyof FinanceCoinMarketCapQuote]
    return typeof value === 'number' ? [{ group, key, value, unit, asOf, source: 'coinmarketcap' }] : []
  })
}

/** One report's instrument lookup. */
export interface ReportAssetRequest {
  readonly symbol: string
}

/** Loads the metrics a report quotes for one instrument. */
export type ReportAssetContext = (request: ReportAssetRequest) => Promise<readonly AssetMetric[]>

/**
 * Build crypto metrics for one quoted pair from its market quote and community page.
 * @param symbol - Snapshot symbol such as `BTC-USD`.
 * @param loadQuotes - Loader that returns quotes for the given ticker symbols.
 * @param loadCommunity - Loader for a CoinGecko coin id, addressed by the quote slug.
 * @param loadGithub - Loader for the repository the community snapshot links.
 * @returns Market and supply metrics, plus community and development metrics when the
 * community source answers.
 */
export async function cryptoMetricsForSymbol(
  symbol: string,
  loadQuotes: (symbols: readonly string[]) => Promise<readonly FinanceCoinMarketCapQuote[]>,
  loadCommunity?: (id: string) => Promise<FinanceCoinGeckoCommunity | undefined>,
  loadGithub?: (repository: string) => Promise<FinanceGithubRepo | undefined>,
): Promise<readonly AssetMetric[]> {
  const [base] = symbol.split('-')
  if (base === undefined || base === symbol) return []
  let quote: FinanceCoinMarketCapQuote | undefined
  try {
    [quote] = await loadQuotes([base])
  } catch {
    quote = undefined
  }
  const market = cryptoMetricsFromQuote(quote)
  const id = quote?.slug
  if (id === undefined || loadCommunity === undefined) return market
  let community: FinanceCoinGeckoCommunity | undefined
  try {
    community = await loadCommunity(id)
  } catch {
    return market
  }
  const project = cryptoMetricsFromCommunity(community)
  const repository = githubSlug(community?.githubRepos)
  if (repository === undefined || loadGithub === undefined) return [...market, ...project]
  try {
    return [...market, ...project, ...cryptoMetricsFromGithub(await loadGithub(repository))]
  } catch {
    return [...market, ...project]
  }
}

/** Community and developer counts a CoinGecko snapshot contributes. */
const COMMUNITY_METRICS: readonly (readonly [AssetMetricGroup, ReportMetricKey, string])[] = [
  ['community', 'twitterFollowers', ''],
  ['community', 'redditSubscribers', ''],
  ['community', 'telegramUsers', ''],
  ['community', 'sentimentUp', '%'],
  ['community', 'sentimentDown', '%'],
  ['community', 'watchlistUsers', ''],
  ['development', 'githubStars', ''],
  ['development', 'githubForks', ''],
  ['development', 'githubSubscribers', ''],
  ['development', 'githubCommits4w', ''],
  ['development', 'githubClosedIssues', ''],
  ['market', 'athChangePercentage', '%'],
  ['market', 'atlChangePercentage', '%'],
]

/** Market-wide figures a CoinGecko global snapshot contributes. */
const CRYPTO_GLOBAL_METRICS: readonly (readonly [ReportMetricKey, string])[] = [
  ['btcDominance', '%'],
  ['ethDominance', '%'],
  ['activeCryptocurrencies', ''],
]

/**
 * Turn one CoinGecko global snapshot into market-age metrics.
 * @param global - Normalized snapshot, when one loaded.
 * @returns Market metrics; figures the upstream omitted are skipped.
 */
export function cryptoMetricsFromGlobal(global: FinanceCoinGeckoGlobal | undefined): AssetMetric[] {
  if (global === undefined) return []
  return CRYPTO_GLOBAL_METRICS.flatMap(([key, unit]) => {
    const value = global[key as keyof FinanceCoinGeckoGlobal]
    return typeof value === 'number' ? [{ group: 'market' as const, key, value, unit, asOf: '', source: 'coingecko' }] : []
  })
}

/**
 * Turn one CoinGecko snapshot into report metrics.
 * @param community - Normalized snapshot, when one loaded.
 * @returns Community and development metrics; counts the upstream omitted are skipped.
 */
export function cryptoMetricsFromCommunity(community: FinanceCoinGeckoCommunity | undefined): AssetMetric[] {
  if (community === undefined) return []
  return COMMUNITY_METRICS.flatMap(([group, key, unit]) => {
    const value = community[key as keyof FinanceCoinGeckoCommunity]
    return typeof value === 'number' ? [{ group, key, value, unit, asOf: '', source: 'coingecko' }] : []
  })
}

/** Repository fields a GitHub snapshot contributes, all in the development dimension. */
const GITHUB_METRICS: readonly (readonly [ReportMetricKey, keyof FinanceGithubRepo])[] = [
  ['githubStars', 'stars'],
  ['githubForks', 'forks'],
  ['githubWatchers', 'watchers'],
  ['githubOpenIssues', 'openIssues'],
  ['githubCommits4w', 'commits4w'],
  ['githubReleases1y', 'releases1y'],
]

/**
 * Turn one GitHub repository snapshot into report metrics.
 * @param repo - Normalized repository, when one loaded.
 * @returns Development metrics; counts GitHub omitted are skipped.
 */
export function cryptoMetricsFromGithub(repo: FinanceGithubRepo | undefined): AssetMetric[] {
  if (repo === undefined) return []
  const metrics: AssetMetric[] = GITHUB_METRICS.flatMap(([key, field]) => {
    const value = repo[field]
    return typeof value === 'number' ? [{ group: 'development' as const, key, value, unit: '', asOf: '', source: 'github' }] : []
  })
  if (repo.latestRelease !== undefined) {
    metrics.push({
      group: 'development', key: 'githubLatestRelease', value: 0, text: repo.latestRelease, unit: '', asOf: '', source: 'github',
    })
  }
  return metrics
}

/** Multiples the valuation bridge reports, with their dimension and unit. */
const VALUATION_METRICS: readonly (readonly [ReportMetricKey, AssetMetricGroup, string])[] = [
  ['peTtm', 'valuation', ''],
  ['peStatic', 'valuation', ''],
  ['pb', 'valuation', ''],
]

/**
 * Turn one valuation snapshot into report metrics, including the industry premium.
 * @param valuation - Normalized valuation, when one loaded.
 * @returns Valuation and industry metrics, empty when nothing loaded.
 */
export function equityMetricsFromValuation(valuation: FinanceStockValuation | undefined): AssetMetric[] {
  if (valuation === undefined) return []
  const asOf = valuation.industryPe?.date ?? ''
  const metrics: AssetMetric[] = VALUATION_METRICS.flatMap(([key, group, unit]) => {
    const value = valuation.indicators[key]
    return value === undefined ? [] : [{ group, key, value, unit, asOf, source: 'akshare' }]
  })
  if (valuation.marketCapYuan !== undefined) {
    metrics.push({ group: 'valuation', key: 'marketCap', value: valuation.marketCapYuan, unit: 'CNY', asOf, source: 'akshare' })
  }
  if (valuation.industry !== undefined) {
    metrics.push({ group: 'industry', key: 'industryName', value: 0, text: valuation.industry, unit: '', asOf, source: 'akshare' })
  }
  const baseline = valuation.industryPe?.weighted
  // CNINFO publishes the industry multiple on a static basis, so the comparison
  // uses the stock's static multiple rather than its trailing one.
  const pe = valuation.indicators.peStatic
  if (baseline !== undefined) {
    metrics.push({ group: 'industry', key: 'industryPe', value: baseline, unit: '', asOf, source: 'akshare' })
  }
  const median = valuation.industryPe?.median
  if (median !== undefined) {
    metrics.push({ group: 'industry', key: 'industryPeMedian', value: median, unit: '', asOf, source: 'akshare' })
  }
  const arithmetic = valuation.industryPe?.arithmetic
  if (arithmetic !== undefined) {
    metrics.push({ group: 'industry', key: 'industryPeArithmetic', value: arithmetic, unit: '', asOf, source: 'akshare' })
  }
  const companies = valuation.industryPe?.companies
  if (companies !== undefined) {
    metrics.push({ group: 'industry', key: 'industryPeCompanies', value: companies, unit: '', asOf, source: 'akshare' })
  }
  if (pe !== undefined && median !== undefined && median !== 0) {
    metrics.push({
      group: 'valuation',
      key: 'peVsIndustryMedian',
      value: (pe / median - 1) * 100,
      unit: '%',
      asOf,
      source: 'akshare',
    })
  }
  if (pe !== undefined && baseline !== undefined && baseline !== 0) {
    metrics.push({
      group: 'valuation',
      key: 'peVsIndustry',
      value: (pe / baseline - 1) * 100,
      unit: '%',
      asOf,
      source: 'akshare',
    })
  }
  return metrics
}

/** Overview figures Finnhub reports, with their dimension and unit. */
const US_METRICS: readonly (readonly [ReportMetricKey, AssetMetricGroup, string])[] = [
  ['marketCap', 'valuation', 'USD'],
  ['peRatio', 'valuation', ''],
  ['pbRatio', 'valuation', ''],
  ['psRatio', 'valuation', ''],
  ['dividendYield', 'valuation', '%'],
  ['epsTtm', 'profitability', 'USD'],
  ['netMargin', 'profitability', '%'],
  ['operatingMargin', 'profitability', '%'],
  ['roa', 'profitability', '%'],
  ['roe', 'profitability', '%'],
  ['revenueGrowth', 'growth', '%'],
  ['epsGrowth', 'growth', '%'],
  ['beta', 'market', ''],
]

/**
 * Reported statement lines Finnhub files, with the dimension and unit each belongs to.
 * Revenue sits in the growth dimension so the earnings-review block quotes it beside the growth rates.
 */
const US_STATEMENT_METRICS: readonly (readonly [ReportMetricKey, AssetMetricGroup, string])[] = [
  ['revenue', 'growth', 'USD'],
  ['grossProfit', 'profitability', 'USD'],
  ['operatingIncome', 'profitability', 'USD'],
  ['netIncome', 'profitability', 'USD'],
  ['totalAssets', 'balance', 'USD'],
  ['currentAssets', 'balance', 'USD'],
  ['liabilities', 'balance', 'USD'],
  ['equity', 'balance', 'USD'],
  ['totalDebt', 'balance', 'USD'],
  ['cash', 'balance', 'USD'],
  ['operatingCashFlow', 'cash', 'USD'],
  ['capex', 'cash', 'USD'],
  ['freeCashFlow', 'cash', 'USD'],
  ['depreciation', 'cash', 'USD'],
  ['stockBasedCompensation', 'cash', 'USD'],
  ['dividendsPaid', 'cash', 'USD'],
  ['buybacks', 'cash', 'USD'],
]

/**
 * Turn one US fundamentals overview into report metrics.
 * @param fundamentals - Normalized overview, when one loaded.
 * @returns Valuation, profitability, growth, and industry metrics.
 */
export function usMetricsFromFundamentals(fundamentals: FinanceUsFundamentals | undefined): AssetMetric[] {
  if (fundamentals === undefined) return []
  const metrics: AssetMetric[] = US_METRICS.flatMap(([key, group, unit]) => {
    const value = fundamentals.indicators[key]
    return value === undefined ? [] : [{ group, key, value, unit, asOf: '', source: 'finnhub' }]
  })
  // A statement line carries the period it was filed for, so no reader reads it as a current-market figure.
  const reportedPeriod = fundamentals.reportedFinancials ?? ''
  for (const [key, group, unit] of US_STATEMENT_METRICS) {
    const value = fundamentals.indicators[key]
    if (value !== undefined) metrics.push({ group, key, value, unit, asOf: reportedPeriod, source: 'finnhub' })
  }
  if (fundamentals.industry !== undefined) {
    metrics.push({
      group: 'industry', key: 'industry', value: 0, text: fundamentals.industry, unit: '', asOf: '', source: 'finnhub',
    })
  }
  const epsSurprise = fundamentals.indicators.epsSurprise
  if (epsSurprise !== undefined) {
    metrics.push(METRIC('growth', 'epsSurprise', epsSurprise, '%', '', 'finnhub'))
  }
  // The analyst counts share the rating period the upstream published them for.
  const analystPeriod = fundamentals.analystPeriod ?? ''
  for (const key of ['analystBuy', 'analystHold', 'analystSell'] as const) {
    const value = fundamentals.indicators[key]
    if (value !== undefined) metrics.push(METRIC('valuation', key, value, '', analystPeriod, 'finnhub'))
  }
  // The calendar, the headlines, and the newest material filing are what a catalyst block can act on.
  if (fundamentals.nextEarnings !== undefined) {
    metrics.push(METRIC_TEXT('catalyst', 'nextEarnings', fundamentals.nextEarnings))
  }
  if (fundamentals.headlines !== undefined && fundamentals.headlines.length > 0) {
    metrics.push(METRIC_TEXT('catalyst', 'newsHeadlines', fundamentals.headlines.join(' / ')))
  }
  if (fundamentals.latestFilingForm !== undefined) {
    metrics.push(METRIC_TEXT('catalyst', 'latestFilingForm', fundamentals.latestFilingForm))
  }
  if (fundamentals.latestFilingDate !== undefined) {
    metrics.push(METRIC_TEXT('catalyst', 'latestFilingDate', fundamentals.latestFilingDate))
  }
  if (fundamentals.reportedFinancials !== undefined) {
    metrics.push(METRIC_TEXT('profitability', 'reportedFinancials', fundamentals.reportedFinancials))
  }
  for (const key of ['insiderBoughtShares', 'insiderNetShares', 'insiderSentiment', 'insiderSoldShares'] as const) {
    const value = fundamentals.indicators[key]
    if (value !== undefined) metrics.push(METRIC('insider', key, value, '', '', 'finnhub'))
  }
  if (fundamentals.peers !== undefined && fundamentals.peers.length > 0) {
    metrics.push({
      group: 'competition',
      key: 'peers',
      value: 0,
      text: fundamentals.peers.join(', '),
      unit: '',
      asOf: '',
      source: 'finnhub',
    })
  }
  return metrics
}

/** Comparable-company columns, in the order the table renders them. */
const COMPARABLE_METRIC_KEYS: readonly ReportMetricKey[] = [
  'peRatio', 'pbRatio', 'roe', 'revenueGrowth', 'epsGrowth', 'dividendYield',
]

/** Comparable figures with the unit the US metric catalog reports them in. */
const COMPARABLE_METRICS = US_METRICS.filter(([key]) => COMPARABLE_METRIC_KEYS.includes(key))

/**
 * Build the comparable-company rows a competitive-position block renders.
 * @param primary - Fundamentals of the instrument under review, when loaded.
 * @param peers - Fundamentals of the peer companies, in the upstream's order.
 * @returns One metric per subject and comparable figure; a missing figure is skipped.
 */
export function usComparableMetrics(
  primary: FinanceUsFundamentals | undefined,
  peers: readonly FinanceUsFundamentals[],
): AssetMetric[] {
  const subjects = [...primary === undefined ? [] : [primary], ...peers]
  return subjects.flatMap(subject => COMPARABLE_METRICS.flatMap(([key, , unit]) => {
    const value = subject.indicators[key]
    return value === undefined ? [] : [{
      group: 'competition' as const,
      key,
      value,
      unit,
      asOf: '',
      source: 'finnhub',
      subject: subject.symbol,
    }]
  }))
}

/**
 * Read crypto quotes from the primary source, falling back to the secondary one.
 * @param symbols - Ticker symbols to read.
 * @param loadPrimary - Primary quote loader.
 * @param loadFallback - Loader used when the primary fails or publishes nothing.
 * @returns Quotes from whichever source answered, primary first.
 */
export async function cryptoQuotesFromSources(
  symbols: readonly string[],
  loadPrimary: (symbols: readonly string[]) => Promise<readonly FinanceCoinMarketCapQuote[]>,
  loadFallback: (symbols: readonly string[]) => Promise<readonly FinanceCoinMarketCapQuote[]>,
): Promise<readonly FinanceCoinMarketCapQuote[]> {
  try {
    const quotes = await loadPrimary(symbols)
    if (quotes.length > 0) return quotes
  } catch {
    // The fallback below covers a failing primary source.
  }
  return loadFallback(symbols)
}

/** One numeric metric record. */
function METRIC(
  group: AssetMetricGroup,
  key: ReportMetricKey,
  value: number,
  unit: string,
  asOf: string,
  source: string,
): AssetMetric {
  return { group, key, value, unit, asOf, source }
}

/** One textual metric record. */
function METRIC_TEXT(group: AssetMetricGroup, key: ReportMetricKey, text: string): AssetMetric {
  return { group, key, value: 0, text, unit: '', asOf: '', source: 'finnhub' }
}
