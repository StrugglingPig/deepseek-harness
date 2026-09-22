import { describe, expect, it } from 'vitest'
import { normalizeCoinGeckoCommunity, normalizeCoinGeckoGlobal, normalizeCoinGeckoMarkets } from '../src/coingecko.ts'

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

  it('reads the all-time-high and all-time-low changes from the market block', () => {
    const community = normalizeCoinGeckoCommunity({
      id: 'bitcoin',
      name: 'Bitcoin',
      market_data: { ath_change_percentage: { usd: -21.4, btc: -7.7 }, atl_change_percentage: { usd: 132_000_000 } },
    })
    expect(community).toMatchObject({ id: 'bitcoin', name: 'Bitcoin', athChangePercentage: -21.4, atlChangePercentage: 132_000_000 })
    expect(normalizeCoinGeckoCommunity({ id: 'bitcoin', name: 'Bitcoin' }))
      .toEqual({ id: 'bitcoin', name: 'Bitcoin' })
    // A payload without USD figures leaves both changes out.
    expect(normalizeCoinGeckoCommunity({
      id: 'bitcoin', name: 'Bitcoin', market_data: { ath_change_percentage: { btc: -7.7 } },
    })).toEqual({ id: 'bitcoin', name: 'Bitcoin' })
  })

  it('reads the global crypto market snapshot', () => {
    expect(normalizeCoinGeckoGlobal({
      data: {
        active_cryptocurrencies: 21_358,
        total_market_cap: { usd: 2_902_076_300_969.686 },
        total_volume: { usd: 148_653_166_754.13 },
        market_cap_percentage: { btc: 57.3, eth: 12.1, usdt: 5.9 },
      },
    })).toEqual({
      totalMarketCapUsd: 2_902_076_300_969.686,
      totalVolumeUsd: 148_653_166_754.13,
      btcDominance: 57.3,
      ethDominance: 12.1,
      activeCryptocurrencies: 21_358,
    })
    // A payload with no usable figure reports nothing rather than an empty record.
    expect(normalizeCoinGeckoGlobal({ data: {} })).toBeUndefined()
    expect(normalizeCoinGeckoGlobal({})).toBeUndefined()
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

describe('CoinGecko market rows', () => {
  it('maps the markets response onto the shared quote record', () => {
    const quotes = normalizeCoinGeckoMarkets([{
      id: 'bitcoin',
      symbol: 'btc',
      name: 'Bitcoin',
      market_cap_rank: 1,
      current_price: 86_102,
      market_cap: 1_727_073_625_507,
      total_volume: 51_744_942_904,
      circulating_supply: 20_087_418,
      total_supply: 20_087_478,
      max_supply: 21_000_000,
      price_change_percentage_24h: 6.67,
      price_change_percentage_7d_in_currency: 9.74,
      last_updated: '2026-09-21T15:07:20.000Z',
    }], 'USD')
    expect(quotes).toEqual([{
      id: 1, name: 'Bitcoin', symbol: 'BTC', currency: 'USD', rank: 1,
      price: 86_102, percentChange24h: 6.67, percentChange7d: 9.74,
      marketCap: 1_727_073_625_507, volume24h: 51_744_942_904,
      circulatingSupply: 20_087_418, totalSupply: 20_087_478, maxSupply: 21_000_000,
      lastUpdated: '2026-09-21T15:07:20.000Z',
    }])
  })

  it('skips rows without a name or symbol and non-array payloads', () => {
    expect(normalizeCoinGeckoMarkets({}, 'USD')).toEqual([])
    expect(normalizeCoinGeckoMarkets([{ id: 'x' }, 'nope'], 'USD')).toEqual([])
    const unnamed = normalizeCoinGeckoMarkets([{ name: 'Bitcoin', symbol: 'btc', market_cap_rank: 3 }], 'USD')
    expect(unnamed[0]).toMatchObject({ id: 3, name: 'Bitcoin', symbol: 'BTC' })
    // A numeric id and a name without a symbol both have to be handled.
    expect(normalizeCoinGeckoMarkets([{ id: 7, name: 'Bitcoin', symbol: 'btc' }], 'USD')[0]).toMatchObject({ id: 7 })
    expect(normalizeCoinGeckoMarkets([{ name: 'Bitcoin' }], 'USD')).toEqual([])
    // Without an id or a rank the shared record still keeps a numeric placeholder.
    expect(normalizeCoinGeckoMarkets([{ name: 'Bitcoin', symbol: 'btc' }], 'USD')[0]).toMatchObject({ id: 0 })
  })
})
