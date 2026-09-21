/** Market and fundamental metrics a report quotes about its instrument. */

import { githubSlug } from './github.ts'
import type {
  FinanceCoinGeckoCommunity, FinanceCoinMarketCapQuote, FinanceGithubRepo, FinanceStockFundamentals,
} from './types.ts'

/** Dimensions an asset metric belongs to; report blocks claim one or more. */
export const ASSET_METRIC_GROUPS = [
  'valuation', 'profitability', 'growth', 'balance', 'cash',
  'market', 'supply', 'development', 'community', 'industry',
] as const

/** One asset metric dimension. */
export type AssetMetricGroup = typeof ASSET_METRIC_GROUPS[number]

/** One reported metric about the instrument. */
export interface AssetMetric {
  readonly group: AssetMetricGroup
  /** Locale dictionary key for the metric label. */
  readonly key: string
  readonly value: number
  /** Reported unit: `%`, `CNY`, `USD`, or empty for a bare ratio or count. */
  readonly unit: string
  /** Reporting period or observation time, as published upstream. */
  readonly asOf: string
  readonly source: string
}

/** Ratios the A-share fundamentals bridge reports, with their dimension and unit. */
const EQUITY_METRICS: Readonly<Record<string, { readonly group: AssetMetricGroup; readonly unit: string }>> = {
  eps: { group: 'valuation', unit: 'CNY' },
  bookValuePerShare: { group: 'valuation', unit: 'CNY' },
  roe: { group: 'profitability', unit: '%' },
  netMargin: { group: 'profitability', unit: '%' },
  operatingMargin: { group: 'profitability', unit: '%' },
  revenueGrowth: { group: 'growth', unit: '%' },
  profitGrowth: { group: 'growth', unit: '%' },
  debtRatio: { group: 'balance', unit: '%' },
  currentRatio: { group: 'balance', unit: '' },
  cashConversion: { group: 'cash', unit: '' },
}

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
  return Object.entries(latest.metrics).flatMap(([key, value]) => {
    const entry = EQUITY_METRICS[key]
    if (entry === undefined) return []
    return [{
      group: entry.group,
      key,
      value,
      unit: entry.unit,
      asOf: latest.period,
      source: 'akshare',
    }]
  })
}

/** Market fields a CoinMarketCap quote contributes, with their dimension and unit. */
const CRYPTO_QUOTE_METRICS: readonly (readonly [AssetMetricGroup, string, string])[] = [
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
const COMMUNITY_METRICS: readonly (readonly [AssetMetricGroup, string, string])[] = [
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
]

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
const GITHUB_METRICS: readonly (readonly [string, keyof FinanceGithubRepo])[] = [
  ['githubStars', 'stars'],
  ['githubForks', 'forks'],
  ['githubWatchers', 'watchers'],
  ['githubOpenIssues', 'openIssues'],
  ['githubCommits4w', 'commits4w'],
]

/**
 * Turn one GitHub repository snapshot into report metrics.
 * @param repo - Normalized repository, when one loaded.
 * @returns Development metrics; counts GitHub omitted are skipped.
 */
export function cryptoMetricsFromGithub(repo: FinanceGithubRepo | undefined): AssetMetric[] {
  if (repo === undefined) return []
  return GITHUB_METRICS.flatMap(([key, field]) => {
    const value = repo[field]
    return typeof value === 'number' ? [{ group: 'development' as const, key, value, unit: '', asOf: '', source: 'github' }] : []
  })
}
