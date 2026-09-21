/** CoinGecko REST response normalization. */

import type { FinanceCoinGeckoCommunity } from './types.ts'

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
  }
}
