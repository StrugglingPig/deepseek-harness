/** CoinGecko REST response normalization. */

import type { FinanceCoinGeckoCommunity, FinanceCoinGeckoGlobal, FinanceCoinMarketCapQuote } from './types.ts'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function finite(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Normalize a CoinGecko `/coins/{id}` response into community and developer counts.
 * @param payload - Upstream CoinGecko JSON.
 * @returns The normalized snapshot, or undefined when the payload carries no coin id.
 */
export function normalizeCoinGeckoCommunity(payload: unknown): FinanceCoinGeckoCommunity | undefined {
  const coin = record(payload)
  if (coin === undefined) return undefined
  const id = text(coin.id)
  const name = text(coin.name)
  if (id === undefined || name === undefined) return undefined
  const community = record(coin.community_data)
  const developer = record(coin.developer_data)
  const symbol = text(coin.symbol)
  const categories = Array.isArray(coin.categories)
    ? coin.categories.flatMap(entry => text(entry) === undefined ? [] : [text(entry) as string])
    : undefined
  const twitterFollowers = finite(community?.twitter_followers)
  const redditSubscribers = finite(community?.reddit_subscribers)
  const telegramUsers = finite(community?.telegram_channel_user_count)
  const githubStars = finite(developer?.stars)
  const githubForks = finite(developer?.forks)
  const githubSubscribers = finite(developer?.subscribers)
  const githubCommits4w = finite(developer?.commit_count_4_weeks)
  const githubClosedIssues = finite(developer?.closed_issues)
  const sentimentUp = finite(coin.sentiment_votes_up_percentage)
  const sentimentDown = finite(coin.sentiment_votes_down_percentage)
  const watchlistUsers = finite(coin.watchlist_portfolio_users)
  const genesisDate = text(coin.genesis_date)
  const market = record(coin.market_data)
  const athChangePercentage = finite(market?.ath_change_percentage)
  const atlChangePercentage = finite(market?.atl_change_percentage)
  const links = record(coin.links)
  const reposUrl = links === undefined ? undefined : record(links.repos_url)
  const repoLinks = reposUrl === undefined ? undefined : reposUrl.github
  const githubRepos = Array.isArray(repoLinks)
    ? repoLinks.flatMap(entry => text(entry) === undefined ? [] : [text(entry) as string])
    : undefined
  return {
    id,
    name,
    ...symbol === undefined ? {} : { symbol },
    ...categories === undefined || categories.length === 0 ? {} : { categories },
    ...twitterFollowers === undefined ? {} : { twitterFollowers },
    ...redditSubscribers === undefined ? {} : { redditSubscribers },
    ...telegramUsers === undefined ? {} : { telegramUsers },
    ...githubStars === undefined ? {} : { githubStars },
    ...githubForks === undefined ? {} : { githubForks },
    ...githubSubscribers === undefined ? {} : { githubSubscribers },
    ...githubCommits4w === undefined ? {} : { githubCommits4w },
    ...githubClosedIssues === undefined ? {} : { githubClosedIssues },
    ...sentimentUp === undefined ? {} : { sentimentUp },
    ...sentimentDown === undefined ? {} : { sentimentDown },
    ...watchlistUsers === undefined ? {} : { watchlistUsers },
    ...genesisDate === undefined ? {} : { genesisDate },
    ...githubRepos === undefined ? {} : { githubRepos },
    ...athChangePercentage === undefined ? {} : { athChangePercentage },
    ...atlChangePercentage === undefined ? {} : { atlChangePercentage },
  }
}

/**
 * Normalize a CoinGecko `/global` response into market-wide crypto context.
 * @param payload - Upstream CoinGecko JSON.
 * @returns The normalized snapshot, or undefined when the payload carries no data.
 */
export function normalizeCoinGeckoGlobal(payload: unknown): FinanceCoinGeckoGlobal | undefined {
  const data = record(record(payload)?.data)
  if (data === undefined) return undefined
  const marketCap = finite(record(data.total_market_cap)?.usd)
  const volume = finite(record(data.total_volume)?.usd)
  const marketCapPercentage = record(data.market_cap_percentage)
  const btcDominance = finite(marketCapPercentage?.btc)
  const ethDominance = finite(marketCapPercentage?.eth)
  const activeCryptocurrencies = finite(data.active_cryptocurrencies)
  const snapshot: FinanceCoinGeckoGlobal = {
    ...marketCap === undefined ? {} : { totalMarketCapUsd: marketCap },
    ...volume === undefined ? {} : { totalVolumeUsd: volume },
    ...btcDominance === undefined ? {} : { btcDominance },
    ...ethDominance === undefined ? {} : { ethDominance },
    ...activeCryptocurrencies === undefined ? {} : { activeCryptocurrencies },
  }
  return Object.keys(snapshot).length === 0 ? undefined : snapshot
}

/** One CoinGecko markets row, mapped onto the shared normalized quote record. */
function marketQuote(row: Record<string, unknown>, convert: string): FinanceCoinMarketCapQuote | undefined {
  const id = finite(row.id) ?? finite(row.market_cap_rank)
  const name = typeof row.name === 'string' ? row.name : undefined
  const symbol = typeof row.symbol === 'string' ? row.symbol.toUpperCase() : undefined
  if (name === undefined || symbol === undefined) return undefined
  const price = finite(row.current_price)
  const marketCap = finite(row.market_cap)
  const volume24h = finite(row.total_volume)
  const rank = finite(row.market_cap_rank)
  const percentChange24h = finite(row.price_change_percentage_24h)
  const percentChange7d = finite(row.price_change_percentage_7d_in_currency)
  const circulatingSupply = finite(row.circulating_supply)
  const totalSupply = finite(row.total_supply)
  const maxSupply = finite(row.max_supply)
  const lastUpdated = typeof row.last_updated === 'string' ? row.last_updated : undefined
  return {
    // CoinGecko publishes a numeric id only in other endpoints; the rank stands in
    // so the shared record keeps a stable number for non-ranking callers.
    id: id ?? 0,
    name,
    symbol,
    currency: convert,
    ...rank === undefined ? {} : { rank },
    ...price === undefined ? {} : { price },
    ...percentChange24h === undefined ? {} : { percentChange24h },
    ...percentChange7d === undefined ? {} : { percentChange7d },
    ...marketCap === undefined ? {} : { marketCap },
    ...volume24h === undefined ? {} : { volume24h },
    ...circulatingSupply === undefined ? {} : { circulatingSupply },
    ...totalSupply === undefined ? {} : { totalSupply },
    ...maxSupply === undefined ? {} : { maxSupply },
    ...lastUpdated === undefined ? {} : { lastUpdated },
  }
}

/**
 * Normalize a CoinGecko markets response onto the shared quote record.
 * @param payload - Upstream JSON array.
 * @param convert - Conversion currency the rows were requested in.
 * @returns One normalized quote per usable row.
 */
export function normalizeCoinGeckoMarkets(payload: unknown, convert: string): FinanceCoinMarketCapQuote[] {
  if (!Array.isArray(payload)) return []
  return payload.flatMap((entry) => {
    const row = record(entry)
    const quote = row === undefined ? undefined : marketQuote(row, convert)
    return quote === undefined ? [] : [quote]
  })
}
