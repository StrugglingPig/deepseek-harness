import { describe, expect, it } from 'vitest'
import { normalizeCoinGeckoCommunity } from '../src/coingecko.ts'

describe('CoinGecko normalization', () => {
  it('reads community and developer counts', () => {
    const community = normalizeCoinGeckoCommunity({
      id: 'bitcoin',
      symbol: 'btc',
      name: 'Bitcoin',
      categories: ['Cryptocurrency', 'Layer 1 (L1)'],
      sentiment_votes_up_percentage: 78.5,
      sentiment_votes_down_percentage: 21.5,
      watchlist_portfolio_users: 2_452_826,
      genesis_date: '2009-01-03',
      links: { repos_url: { github: ['https://github.com/bitcoin/bitcoin'], bitbucket: [] } },
      community_data: {
        twitter_followers: 7_100_000,
        reddit_subscribers: 5_200_000,
        telegram_channel_user_count: 120_000,
      },
      developer_data: {
        stars: 85_000,
        forks: 36_000,
        subscribers: 4_000,
        commit_count_4_weeks: 210,
        closed_issues: 9_000,
      },
    })
    expect(community).toMatchObject({
      id: 'bitcoin',
      name: 'Bitcoin',
      symbol: 'btc',
      categories: ['Cryptocurrency', 'Layer 1 (L1)'],
      twitterFollowers: 7_100_000,
      redditSubscribers: 5_200_000,
      telegramUsers: 120_000,
      githubStars: 85_000,
      githubForks: 36_000,
      githubSubscribers: 4_000,
      githubCommits4w: 210,
      githubClosedIssues: 9_000,
      sentimentUp: 78.5,
      sentimentDown: 21.5,
      watchlistUsers: 2_452_826,
      genesisDate: '2009-01-03',
      githubRepos: ['https://github.com/bitcoin/bitcoin'],
    })
  })

  it('omits counts the upstream did not publish', () => {
    const community = normalizeCoinGeckoCommunity({ id: 'bitcoin', name: 'Bitcoin', community_data: {}, developer_data: {} })
    expect(community).toEqual({ id: 'bitcoin', name: 'Bitcoin' })
  })

  it('keeps only the string categories', () => {
    const community = normalizeCoinGeckoCommunity({ id: 'bitcoin', name: 'Bitcoin', categories: ['Layer 1 (L1)', 7, null] })
    expect(community?.categories).toEqual(['Layer 1 (L1)'])
    const empty = normalizeCoinGeckoCommunity({ id: 'bitcoin', name: 'Bitcoin', categories: [] })
    expect(empty?.categories).toBeUndefined()
    const noRepos = normalizeCoinGeckoCommunity({ id: 'bitcoin', name: 'Bitcoin', links: { homepage: ['https://bitcoin.org'] } })
    expect(noRepos?.githubRepos).toBeUndefined()
    const mixedRepos = normalizeCoinGeckoCommunity({
      id: 'bitcoin', name: 'Bitcoin', links: { repos_url: { github: [7, 'https://github.com/bitcoin/bips'] } },
    })
    expect(mixedRepos?.githubRepos).toEqual(['https://github.com/bitcoin/bips'])
  })

  it('rejects a payload without a coin id', () => {
    expect(normalizeCoinGeckoCommunity(undefined)).toBeUndefined()
    expect(normalizeCoinGeckoCommunity({ name: 'Bitcoin' })).toBeUndefined()
    expect(normalizeCoinGeckoCommunity({ id: 'bitcoin' })).toBeUndefined()
  })
})
