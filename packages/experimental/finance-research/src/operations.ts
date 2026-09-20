/** Provider-native public endpoint catalog for the HTTP finance data provider. */

/** Base origins the HTTP provider can address. */
export type FinanceQueryBase =
  | 'binance-spot'
  | 'binance-usdm'
  | 'binance-coinm'
  | 'binance-options'
  | 'yahoo'
  | 'polymarket-gamma'
  | 'polymarket-clob'

/** One named provider endpoint with a fixed path template. */
export interface FinanceQueryOperation {
  /** Upstream platform family. */
  readonly provider: 'binance' | 'yahoo' | 'polymarket'
  /** Configured origin family. */
  readonly base: FinanceQueryBase
  /** URL path; `{name}` segments consume path parameters. */
  readonly path: string
  /** Short discovery description. */
  readonly description: string
}

function operations(
  provider: FinanceQueryOperation['provider'],
  base: FinanceQueryBase,
  prefix: string,
  paths: Readonly<Record<string, string>>,
): Readonly<Record<string, FinanceQueryOperation>> {
  return Object.fromEntries(
    Object.entries(paths).map(([name, path]) => [
      `${prefix}.${name}`,
      {
        provider,
        base,
        path,
        description: `${provider} ${name.replaceAll('_', ' ')} public endpoint`,
      },
    ]),
  )
}

/** Every provider-native operation the HTTP provider can query. */
export const QUERY_OPERATIONS: Readonly<Record<string, FinanceQueryOperation>> = {
  ...operations('binance', 'binance-spot', 'binance.spot', {
    ping: '/api/v3/ping',
    server_time: '/api/v3/time',
    exchange_info: '/api/v3/exchangeInfo',
    depth: '/api/v3/depth',
    trades: '/api/v3/trades',
    historical_trades: '/api/v3/historicalTrades',
    aggregate_trades: '/api/v3/aggTrades',
    klines: '/api/v3/klines',
    ui_klines: '/api/v3/uiKlines',
    average_price: '/api/v3/avgPrice',
    ticker_24hr: '/api/v3/ticker/24hr',
    ticker_price: '/api/v3/ticker/price',
    ticker_book: '/api/v3/ticker/bookTicker',
  }),
  ...operations('binance', 'binance-usdm', 'binance.usdm', {
    ping: '/fapi/v1/ping',
    server_time: '/fapi/v1/time',
    exchange_info: '/fapi/v1/exchangeInfo',
    depth: '/fapi/v1/depth',
    trades: '/fapi/v1/trades',
    historical_trades: '/fapi/v1/historicalTrades',
    aggregate_trades: '/fapi/v1/aggTrades',
    klines: '/fapi/v1/klines',
    continuous_klines: '/fapi/v1/continuousKlines',
    index_price_klines: '/fapi/v1/indexPriceKlines',
    mark_price_klines: '/fapi/v1/markPriceKlines',
    premium_index_klines: '/fapi/v1/premiumIndexKlines',
    funding_rate: '/fapi/v1/fundingRate',
    open_interest: '/fapi/v1/openInterest',
    premium_index: '/fapi/v1/premiumIndex',
    ticker_24hr: '/fapi/v1/ticker/24hr',
    ticker_price: '/fapi/v1/ticker/price',
    ticker_book: '/fapi/v1/ticker/bookTicker',
    index_info: '/fapi/v1/indexInfo',
    asset_index: '/fapi/v1/assetIndex',
    constituents: '/fapi/v1/constituents',
  }),
  ...operations('binance', 'binance-coinm', 'binance.coinm', {
    ping: '/dapi/v1/ping',
    server_time: '/dapi/v1/time',
    exchange_info: '/dapi/v1/exchangeInfo',
    depth: '/dapi/v1/depth',
    trades: '/dapi/v1/trades',
    historical_trades: '/dapi/v1/historicalTrades',
    aggregate_trades: '/dapi/v1/aggTrades',
    klines: '/dapi/v1/klines',
    continuous_klines: '/dapi/v1/continuousKlines',
    index_price_klines: '/dapi/v1/indexPriceKlines',
    mark_price_klines: '/dapi/v1/markPriceKlines',
    premium_index_klines: '/dapi/v1/premiumIndexKlines',
    funding_rate: '/dapi/v1/fundingRate',
    open_interest: '/dapi/v1/openInterest',
    premium_index: '/dapi/v1/premiumIndex',
    ticker_24hr: '/dapi/v1/ticker/24hr',
    ticker_price: '/dapi/v1/ticker/price',
    ticker_book: '/dapi/v1/ticker/bookTicker',
    index_info: '/dapi/v1/indexInfo',
  }),
  ...operations('binance', 'binance-options', 'binance.options', {
    ping: '/eapi/v1/ping',
    server_time: '/eapi/v1/time',
    exchange_info: '/eapi/v1/exchangeInfo',
    depth: '/eapi/v1/depth',
    trades: '/eapi/v1/trades',
    historical_trades: '/eapi/v1/historicalTrades',
    klines: '/eapi/v1/klines',
    mark: '/eapi/v1/mark',
    ticker: '/eapi/v1/ticker',
    index: '/eapi/v1/index',
    open_interest: '/eapi/v1/openInterest',
    exercise_history: '/eapi/v1/exerciseHistory',
  }),
  ...operations('yahoo', 'yahoo', 'yahoo', {
    chart: '/v8/finance/chart/{symbol}',
    quote: '/v7/finance/quote',
    quote_summary: '/v10/finance/quoteSummary/{symbol}',
    search: '/v1/finance/search',
    trending: '/v1/finance/trending/{region}',
  }),
  ...operations('polymarket', 'polymarket-gamma', 'polymarket.gamma', {
    markets: '/markets',
    market: '/markets/{id}',
    events: '/events',
    event: '/events/{id}',
    tags: '/tags',
    tag: '/tags/{id}',
    series: '/series',
    series_one: '/series/{id}',
    comments: '/comments',
    comment: '/comments/{id}',
    sports: '/sports',
    teams: '/teams',
    users: '/users',
    activity: '/activity',
    holders: '/holders',
    positions: '/positions',
  }),
  ...operations('polymarket', 'polymarket-clob', 'polymarket.clob', {
    markets: '/markets',
    market: '/markets/{condition_id}',
    book: '/book',
    books: '/books',
    price: '/price',
    prices: '/prices',
    midpoint: '/midpoint',
    midpoints: '/midpoints',
    spread: '/spread',
    spreads: '/spreads',
    last_trade_price: '/last-trade-price',
    last_trades_prices: '/last-trades-prices',
    prices_history: '/prices-history',
    tick_size: '/tick-size',
    neg_risk: '/neg-risk',
    sampling_markets: '/sampling-markets',
    simplified_markets: '/simplified-markets',
    server_time: '/time',
    ok: '/ok',
  }),
}
