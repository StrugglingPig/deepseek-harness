/** Real public HTTP market-data providers behind the finance provider interface. */

export { FinanceDataError } from './error.ts'

import { z as zod } from 'zod'
import type { FinanceRequestAuthorizer } from './auth.ts'
import { classifyAsset } from './data.ts'
import { normalizeCoinGeckoCommunity } from './coingecko.ts'
import { normalizeGithubCommitActivity, normalizeGithubRepo } from './github.ts'
import { normalizeCoinMarketCapOhlcv, normalizeCoinMarketCapQuotes } from './coinmarketcap.ts'
import { FinanceDataError } from './error.ts'
import { isFuturesScope, normalizeFuturesAccount, normalizeSpotAccount } from './private.ts'
import { FinanceHttpTransport } from './transport.ts'
import type {
  FinanceCoinGeckoCommunity,
  FinanceCoinGeckoCommunityRequest,
  FinanceGithubRepo,
  FinanceGithubRepoRequest,
  FinanceCoinMarketCapOhlcvRequest,
  FinanceCoinMarketCapOhlcvSeries,
  FinanceCoinMarketCapQuote,
  FinanceCoinMarketCapQuoteRequest,
  FinanceHttpMethod,
  FinanceJsonValue,
  FinanceMarketDataProvider,
  FinancePrivateAccountRequest,
  FinancePrivateAccountSnapshot,
  FinanceProviderBase,
  FinanceProviderDescriptor,
  FinanceProviderRequest,
  FinanceProviderResponse,
  MarketBar,
  MarketSnapshot,
} from './types.ts'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_BAR_LIMIT = 80
const DEFAULT_YAHOO_BASE_URL = 'https://query1.finance.yahoo.com'
const DEFAULT_FRED_BASE_URL = 'https://api.stlouisfed.org'
const DEFAULT_WORLDBANK_BASE_URL = 'https://api.worldbank.org'
const DEFAULT_IMF_BASE_URL = 'https://www.imf.org/external/datamapper/api/v1'
const DEFAULT_BINANCE_BASE_URL = 'https://api.binance.com'
const DEFAULT_COINMARKETCAP_BASE_URL = 'https://pro-api.coinmarketcap.com'
const DEFAULT_COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3'
const DEFAULT_GITHUB_BASE_URL = 'https://api.github.com'
const DEFAULT_POLYMARKET_GAMMA_BASE_URL = 'https://gamma-api.polymarket.com'
const DEFAULT_POLYMARKET_CLOB_BASE_URL = 'https://clob.polymarket.com'
const USER_AGENT = 'deepseek-harness-finance-research/0.0.1'

const yahooChartSchema = zod.object({
  chart: zod.object({
    result: zod.array(zod.object({
      meta: zod.object({
        symbol: zod.string(),
        currency: zod.string().default('USD'),
        regularMarketPrice: zod.number(),
        shortName: zod.string().default(''),
        longName: zod.string().default(''),
      }),
      timestamp: zod.array(zod.number()),
      indicators: zod.object({
        quote: zod.array(zod.object({
          open: zod.array(zod.number().nullable()),
          high: zod.array(zod.number().nullable()),
          low: zod.array(zod.number().nullable()),
          close: zod.array(zod.number().nullable()),
          volume: zod.array(zod.number().nullable()),
        })).min(1),
      }),
    })).min(1),
  }),
})

const binanceKlinesSchema = zod.array(zod.tuple([
  zod.number(),
  zod.string(),
  zod.string(),
  zod.string(),
  zod.string(),
  zod.string(),
]).rest(zod.unknown()))

const polymarketMarketSchema = zod.object({
  question: zod.string().default(''),
  slug: zod.string().default(''),
  clobTokenIds: zod.string().default('[]'),
  outcomes: zod.string().default('[]'),
  outcomePrices: zod.string().default('[]'),
  bestBid: zod.number().default(0),
  bestAsk: zod.number().default(0),
  volumeNum: zod.number().default(0),
  liquidityNum: zod.number().default(0),
  endDate: zod.string().default(''),
  description: zod.string().default(''),
})

const polymarketGammaSchema = zod.array(polymarketMarketSchema)
const polymarketHistorySchema = zod.object({
  history: zod.array(zod.object({ t: zod.number(), p: zod.number() })),
})

/** Options accepted by the public HTTP provider. */
export interface HttpFinanceMarketDataProviderOptions {
  /** Fetch implementation; defaults to the ambient global fetch. */
  readonly fetch?: typeof globalThis.fetch
  /** Request timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Maximum bars requested from each history endpoint. */
  readonly barLimit?: number
  /** Yahoo Finance origin. */
  readonly yahooBaseUrl?: string
  /** Binance Spot REST origin. */
  readonly binanceBaseUrl?: string
  /** Binance USD-M Futures REST origin. */
  readonly binanceUsdmBaseUrl?: string
  /** Binance COIN-M Futures REST origin. */
  readonly binanceCoinmBaseUrl?: string
  /** Binance Options REST origin. */
  readonly binanceOptionsBaseUrl?: string
  /** Polymarket Gamma API origin. */
  readonly polymarketGammaBaseUrl?: string
  /** Polymarket CLOB API origin. */
  readonly polymarketClobBaseUrl?: string
  /** CoinMarketCap Pro REST origin. */
  readonly coinMarketCapBaseUrl?: string
  /** CoinGecko API origin. */
  readonly coinGeckoBaseUrl?: string
  /** GitHub API origin. */
  readonly githubBaseUrl?: string
  /** FRED API origin. */
  readonly fredBaseUrl?: string
  /** World Bank API origin. */
  readonly worldBankBaseUrl?: string
  /** IMF DataMapper origin. */
  readonly imfBaseUrl?: string
  /** Injectable clock for deterministic retrieved-at values. */
  readonly now?: () => Date
  /** Host-side authorization/signing applied before fetch. */
  readonly authorize?: FinanceRequestAuthorizer
  /** Successful GET cache lifetime in milliseconds. */
  readonly cacheTtlMs?: number
  /** Maximum cached GET responses. */
  readonly cacheMaxEntries?: number
  /** Retries after the initial request attempt. */
  readonly maxRetries?: number
  /** First retry delay in milliseconds. */
  readonly retryBaseDelayMs?: number
  /** Maximum retry delay in milliseconds. */
  readonly retryMaxDelayMs?: number
  /** Per-origin request budget in requests per minute. */
  readonly requestsPerMinute?: number
  /** Per-origin token-bucket burst capacity. */
  readonly requestBurst?: number
  /** Injectable delay for deterministic retry and rate-limit behavior. */
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

interface ResolvedOptions {
  readonly transport: FinanceHttpTransport
  readonly barLimit: number
  readonly yahooBaseUrl: string
  readonly binanceBaseUrl: string
  readonly binanceUsdmBaseUrl: string
  readonly binanceCoinmBaseUrl: string
  readonly binanceOptionsBaseUrl: string
  readonly polymarketGammaBaseUrl: string
  readonly polymarketClobBaseUrl: string
  readonly coinMarketCapBaseUrl: string
  readonly coinGeckoBaseUrl: string
  readonly githubBaseUrl: string
  readonly fredBaseUrl: string
  readonly worldBankBaseUrl: string
  readonly imfBaseUrl: string
  readonly now: () => Date
  readonly authorize?: FinanceRequestAuthorizer
}

const CRYPTO_METADATA: Readonly<Record<string, { readonly pair: string; readonly name: string }>> = {
  BTC: { pair: 'BTCUSDT', name: 'Bitcoin' },
  ETH: { pair: 'ETHUSDT', name: 'Ether' },
}

const PROVIDER_BASES: readonly FinanceProviderBase[] = [
  { name: 'binance-spot', description: 'Binance Spot public REST', auth: 'none', docs: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api' },
  { name: 'binance-usdm', description: 'Binance USD-M Futures public REST', auth: 'none', docs: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/general-info' },
  { name: 'binance-coinm', description: 'Binance COIN-M Futures public REST', auth: 'none', docs: 'https://developers.binance.com/docs/derivatives/coin-margined-futures/general-info' },
  { name: 'binance-options', description: 'Binance Options public REST', auth: 'none', docs: 'https://developers.binance.com/docs/derivatives/options-trading/general-info' },
  { name: 'yahoo', description: 'Yahoo Finance public chart and quote endpoints', auth: 'none', docs: 'https://query1.finance.yahoo.com' },
  { name: 'polymarket-gamma', description: 'Polymarket Gamma public catalog API', auth: 'none', docs: 'https://gamma-api.polymarket.com' },
  { name: 'polymarket-clob', description: 'Polymarket CLOB public market API', auth: 'none', docs: 'https://clob.polymarket.com' },
  { name: 'coingecko', description: 'CoinGecko community and developer data', auth: 'api-key', docs: 'https://docs.coingecko.com/reference/coins-id' },
  { name: 'github', description: 'GitHub public REST API for repository activity', auth: 'api-key', docs: 'https://docs.github.com/rest' },
  { name: 'coinmarketcap', description: 'CoinMarketCap Pro REST API', auth: 'api-key', docs: 'https://coinmarketcap.com/api/documentation/' },
  { name: 'fred', description: 'Federal Reserve Economic Data (FRED) series and observations', auth: 'api-key', docs: 'https://fred.stlouisfed.org/docs/api/fred/' },
  { name: 'worldbank', description: 'World Bank indicator API', auth: 'none', docs: 'https://datahelpdesk.worldbank.org/knowledgebase/articles/889392' },
  { name: 'imf', description: 'IMF DataMapper macro indicators', auth: 'none', docs: 'https://www.imf.org/external/datamapper/api/help' },
]

const BASE_ORIGINS: Readonly<Record<string, keyof ResolvedOptions>> = {
  'binance-spot': 'binanceBaseUrl',
  'binance-usdm': 'binanceUsdmBaseUrl',
  'binance-coinm': 'binanceCoinmBaseUrl',
  'binance-options': 'binanceOptionsBaseUrl',
  yahoo: 'yahooBaseUrl',
  'polymarket-gamma': 'polymarketGammaBaseUrl',
  'polymarket-clob': 'polymarketClobBaseUrl',
  coingecko: 'coinGeckoBaseUrl',
  github: 'githubBaseUrl',
  coinmarketcap: 'coinMarketCapBaseUrl',
  fred: 'fredBaseUrl',
  worldbank: 'worldBankBaseUrl',
  imf: 'imfBaseUrl',
}

function queryValue(value: FinanceJsonValue): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return value.toString()
  return JSON.stringify(value)
}

function iso(secondsOrMilliseconds: number, unit: 'seconds' | 'milliseconds'): string {
  return new Date(unit === 'seconds' ? secondsOrMilliseconds * 1000 : secondsOrMilliseconds).toISOString()
}

function percentChange(previous: number, current: number): number {
  if (previous === 0) return 0
  return ((current - previous) / previous) * 100
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function quoteFromBars(snapshot: Omit<MarketSnapshot, 'quote'>): MarketSnapshot['quote'] {
  const latest = snapshot.bars.at(-1) as MarketBar
  const previous = snapshot.bars.at(-2) as MarketBar
  return { price: latest.close, changePercent: percentChange(previous.close, latest.close) }
}

/** Public Yahoo/Binance/Polymarket implementation of the market-data provider. */
export class HttpFinanceMarketDataProvider implements FinanceMarketDataProvider {
  readonly id = 'http'
  private readonly options: ResolvedOptions

  /**
   * @param options - Endpoint, timeout, fetch, clock, and history-limit overrides.
   */
  constructor(options: HttpFinanceMarketDataProviderOptions = {}) {
    this.options = {
      transport: new FinanceHttpTransport({
        fetch: options.fetch ?? globalThis.fetch,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs },
        ...options.cacheMaxEntries === undefined ? {} : { cacheMaxEntries: options.cacheMaxEntries },
        ...options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries },
        ...options.retryBaseDelayMs === undefined ? {} : { retryBaseDelayMs: options.retryBaseDelayMs },
        ...options.retryMaxDelayMs === undefined ? {} : { retryMaxDelayMs: options.retryMaxDelayMs },
        ...options.requestsPerMinute === undefined ? {} : { requestsPerMinute: options.requestsPerMinute },
        ...options.requestBurst === undefined ? {} : { requestBurst: options.requestBurst },
        ...options.sleep === undefined ? {} : { sleep: options.sleep },
      }),
      barLimit: options.barLimit ?? DEFAULT_BAR_LIMIT,
      yahooBaseUrl: options.yahooBaseUrl ?? DEFAULT_YAHOO_BASE_URL,
      binanceBaseUrl: options.binanceBaseUrl ?? DEFAULT_BINANCE_BASE_URL,
      binanceUsdmBaseUrl: options.binanceUsdmBaseUrl ?? 'https://fapi.binance.com',
      binanceCoinmBaseUrl: options.binanceCoinmBaseUrl ?? 'https://dapi.binance.com',
      binanceOptionsBaseUrl: options.binanceOptionsBaseUrl ?? 'https://eapi.binance.com',
      polymarketGammaBaseUrl: options.polymarketGammaBaseUrl ?? DEFAULT_POLYMARKET_GAMMA_BASE_URL,
      polymarketClobBaseUrl: options.polymarketClobBaseUrl ?? DEFAULT_POLYMARKET_CLOB_BASE_URL,
      coinMarketCapBaseUrl: options.coinMarketCapBaseUrl ?? DEFAULT_COINMARKETCAP_BASE_URL,
      coinGeckoBaseUrl: options.coinGeckoBaseUrl ?? DEFAULT_COINGECKO_BASE_URL,
      githubBaseUrl: options.githubBaseUrl ?? DEFAULT_GITHUB_BASE_URL,
      fredBaseUrl: options.fredBaseUrl ?? DEFAULT_FRED_BASE_URL,
      worldBankBaseUrl: options.worldBankBaseUrl ?? DEFAULT_WORLDBANK_BASE_URL,
      imfBaseUrl: options.imfBaseUrl ?? DEFAULT_IMF_BASE_URL,
      now: options.now ?? (() => new Date()),
      ...options.authorize === undefined ? {} : { authorize: options.authorize },
    }
  }

  /**
   * Load one live snapshot from the provider selected by the symbol class.
   * @param symbol - Equity ticker, crypto symbol, or `PREDICTION:<slug>`.
   * @param signal - Optional caller cancellation.
   * @returns The normalized non-synthetic market snapshot.
   */
  async load(symbol: string, signal?: AbortSignal): Promise<MarketSnapshot> {
    const normalized = symbol.trim().toUpperCase()
    if (normalized.length === 0) throw new FinanceDataError('symbol must be a non-empty string', 'INVALID_SYMBOL')
    if (classifyAsset(normalized) === 'prediction') return this.loadPrediction(normalized, signal)
    if (classifyAsset(normalized) === 'crypto') return this.loadCrypto(normalized, signal)
    return this.loadEquity(normalized, signal)
  }

  private async fetchJson(
    url: string,
    signal?: AbortSignal,
    init: {
      readonly method?: FinanceHttpMethod
      readonly headers?: Readonly<Record<string, string>>
      readonly body?: FinanceJsonValue
      readonly cache?: boolean
    } = {},
  ): Promise<{ readonly status: number; readonly data: FinanceJsonValue }> {
    const method = init.method ?? 'GET'
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': USER_AGENT,
      ...init.headers,
    }
    const body = init.body === undefined ? undefined : JSON.stringify(init.body)
    if (body !== undefined) headers['content-type'] = 'application/json'
    return await this.options.transport.request({
      url,
      method,
      headers,
      ...body === undefined ? {} : { body },
      ...signal === undefined ? {} : { signal },
      ...init.cache === undefined ? {} : { cache: init.cache },
    })
  }

  /**
   * Describe provider origins, authentication, and upstream documentation.
   * @returns The provider descriptor used by the discovery tool.
   */
  describe(): FinanceProviderDescriptor {
    return {
      id: this.id,
      displayName: 'Public HTTP finance providers',
      bases: PROVIDER_BASES,
      notes: [
        'Data availability is defined by the upstream API, credentials, rate limits, and network policy.',
        'No endpoint whitelist is enforced; pass a base, an absolute public path, and provider-native parameters.',
      ],
    }
  }

  /**
   * Send one generic provider-native request.
   * @param request - Base, path, method, query, body, and optional headers.
   * @param signal - Optional caller cancellation.
   * @returns The upstream status and JSON value.
   */
  async request(request: FinanceProviderRequest, signal?: AbortSignal): Promise<FinanceProviderResponse> {
    const method = request.method ?? 'GET'
    if (!request.path.startsWith('/')) throw new FinanceDataError('request path must start with /', 'INVALID_PATH')
    if (method === 'GET' && request.body !== undefined) {
      throw new FinanceDataError('GET requests cannot carry a body', 'INVALID_REQUEST')
    }
    const originKey = BASE_ORIGINS[request.base]
    if (originKey === undefined) throw new FinanceDataError(`unknown provider base ${request.base}`, 'UNKNOWN_BASE')
    const url = new URL((this.options[originKey] as string) + request.path)
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, queryValue(item))
      } else {
        url.searchParams.set(key, queryValue(value))
      }
    }
    const headers: Record<string, string> = { ...request.headers }
    await this.options.authorize?.(request, url, headers)
    const response = await this.fetchJson(url.href, signal, {
      method,
      ...Object.keys(headers).length === 0 ? {} : { headers },
      ...request.body === undefined ? {} : { body: request.body },
      cache: request.auth !== 'signed',
    })
    return {
      provider: this.id,
      base: request.base,
      method,
      path: request.path,
      status: response.status,
      data: response.data,
    }
  }

  /**
   * Load normalized CoinMarketCap latest cryptocurrency quotes.
   * @param request - IDs or symbols and conversion currency.
   * @param signal - Optional caller cancellation.
   * @returns Normalized quote records.
   */
  async loadCoinMarketCapQuotes(
    request: FinanceCoinMarketCapQuoteRequest,
    signal?: AbortSignal,
  ): Promise<readonly FinanceCoinMarketCapQuote[]> {
    const convert = (request.convert ?? 'USD').toUpperCase()
    const identifier = request.id === undefined ? request.ids?.join(',') : String(request.id)
    const response = await this.request({
      base: 'coinmarketcap',
      path: '/v3/cryptocurrency/quotes/latest',
      auth: 'api-key',
      query: {
        ...identifier === undefined ? {} : { id: identifier },
        ...request.symbols === undefined || request.symbols.length === 0 ? {} : { symbol: request.symbols.join(',') },
        convert,
        skip_invalid: true,
      },
    }, signal)
    return normalizeCoinMarketCapQuotes(response.data, convert)
  }

  /**
   * Load one CoinGecko community and developer snapshot.
   * @param request - CoinGecko coin id, such as `bitcoin`.
   * @param signal - optional caller cancellation.
   * @returns The normalized snapshot, or undefined when CoinGecko omits the coin.
   */
  async loadCoinGeckoCommunity(
    request: FinanceCoinGeckoCommunityRequest,
    signal?: AbortSignal,
  ): Promise<FinanceCoinGeckoCommunity | undefined> {
    const response = await this.request({
      base: 'coingecko',
      path: `/coins/${encodeURIComponent(request.id)}`,
      auth: 'api-key',
      query: {
        localization: false,
        tickers: false,
        market_data: false,
        community_data: true,
        developer_data: true,
        sparkline: false,
      },
    }, signal)
    return normalizeCoinGeckoCommunity(response.data)
  }

  /**
   * Load one GitHub repository snapshot, including trailing commit activity.
   * @param request - Repository in `owner/name` form.
   * @param signal - optional caller cancellation.
   * @returns The snapshot, or undefined when GitHub cannot serve the repository.
   */
  async loadGithubRepo(
    request: FinanceGithubRepoRequest,
    signal?: AbortSignal,
  ): Promise<FinanceGithubRepo | undefined> {
    const path = `/repos/${request.repository}`
    try {
      const response = await this.request({ base: 'github', path, auth: 'api-key' }, signal)
      const repo = normalizeGithubRepo(response.data, request.repository)
      if (repo === undefined) return undefined
      try {
        // GitHub answers 202 with an empty body while it computes this series.
        const activity = await this.request({ base: 'github', path: `${path}/stats/commit_activity`, auth: 'api-key' }, signal)
        const commits4w = normalizeGithubCommitActivity(activity.data)
        return commits4w === undefined ? repo : { ...repo, commits4w }
      } catch {
        return repo
      }
    } catch {
      // A repository the API rate-limits or cannot find simply contributes no metrics.
      return undefined
    }
  }

  /**
   * Load normalized CoinMarketCap OHLCV history.
   * @param request - IDs or symbols, conversion, dates, count, and interval.
   * @param signal - Optional caller cancellation.
   * @returns Normalized OHLCV series.
   */
  async loadCoinMarketCapOhlcv(
    request: FinanceCoinMarketCapOhlcvRequest,
    signal?: AbortSignal,
  ): Promise<readonly FinanceCoinMarketCapOhlcvSeries[]> {
    const convert = (request.convert ?? 'USD').toUpperCase()
    const identifier = request.id === undefined ? request.ids?.join(',') : String(request.id)
    const response = await this.request({
      base: 'coinmarketcap',
      path: '/v2/cryptocurrency/ohlcv/historical',
      auth: 'api-key',
      query: {
        ...identifier === undefined ? {} : { id: identifier },
        ...request.symbols === undefined || request.symbols.length === 0 ? {} : { symbol: request.symbols.join(',') },
        convert,
        ...request.timeStart === undefined ? {} : { time_start: request.timeStart },
        ...request.timeEnd === undefined ? {} : { time_end: request.timeEnd },
        ...request.count === undefined ? {} : { count: request.count },
        ...request.interval === undefined ? {} : { interval: request.interval },
        skip_invalid: true,
      },
    }, signal)
    return normalizeCoinMarketCapOhlcv(response.data, convert)
  }

  /**
   * Load normalized read-only Binance account data for the selected account family.
   * @param request - Account scope, optional symbol, and open-order inclusion.
   * @param signal - Optional caller cancellation.
   * @returns Normalized balances, positions, and optional open orders.
   */
  async loadPrivateAccount(
    request: FinancePrivateAccountRequest,
    signal?: AbortSignal,
  ): Promise<FinancePrivateAccountSnapshot> {
    const normalizedSymbol = request.symbol?.trim().toUpperCase()
    if (normalizedSymbol === '') throw new FinanceDataError('symbol must be a non-empty string', 'INVALID_SYMBOL')

    if (request.scope === 'spot') {
      const account = await this.request({ base: 'binance-spot', path: '/api/v3/account', auth: 'signed' }, signal)
      const orders = request.includeOpenOrders === true
        ? await this.request({
          base: 'binance-spot',
          path: '/api/v3/openOrders',
          auth: 'signed',
          ...normalizedSymbol === undefined ? {} : { query: { symbol: normalizedSymbol } },
        }, signal)
        : undefined
      return normalizeSpotAccount(account.data, orders?.data, this.options.now())
    }
    if (!isFuturesScope(request.scope)) {
      throw new FinanceDataError(`unsupported private account scope ${String(request.scope)}`, 'AUTH_UNSUPPORTED')
    }
    const base = request.scope === 'usdm' ? 'binance-usdm' : 'binance-coinm'
    const accountPath = request.scope === 'usdm' ? '/fapi/v2/account' : '/dapi/v1/account'
    const positionsPath = request.scope === 'usdm' ? '/fapi/v2/positionRisk' : '/dapi/v1/positionRisk'
    const ordersPath = request.scope === 'usdm' ? '/fapi/v1/openOrders' : '/dapi/v1/openOrders'
    const [account, positions] = await Promise.all([
      this.request({ base, path: accountPath, auth: 'signed' }, signal),
      this.request({
        base,
        path: positionsPath,
        auth: 'signed',
        ...normalizedSymbol === undefined ? {} : { query: { symbol: normalizedSymbol } },
      }, signal),
    ])
    const orders = request.includeOpenOrders === true
      ? await this.request({
        base,
        path: ordersPath,
        auth: 'signed',
        ...normalizedSymbol === undefined ? {} : { query: { symbol: normalizedSymbol } },
      }, signal)
      : undefined
    return normalizeFuturesAccount(request.scope, account.data, positions.data, orders?.data, this.options.now())
  }

  private async loadEquity(symbol: string, signal?: AbortSignal): Promise<MarketSnapshot> {
    const url = `${this.options.yahooBaseUrl}/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`
    const payload = yahooChartSchema.parse((await this.fetchJson(url, signal)).data)
    const result = payload.chart.result[0] as zod.infer<typeof yahooChartSchema>['chart']['result'][number]
    const quote = result.indicators.quote[0] as zod.infer<typeof yahooChartSchema>['chart']['result'][number]['indicators']['quote'][number]
    const bars = result.timestamp.flatMap((timestamp, index) => {
      const open = quote.open[index]
      const high = quote.high[index]
      const low = quote.low[index]
      const close = quote.close[index]
      const volume = quote.volume[index]
      if (open === null || high === null || low === null || close === null || volume === null
        || open === undefined || high === undefined || low === undefined || close === undefined || volume === undefined) {
        return []
      }
      return [{
        timestamp: iso(timestamp, 'seconds'),
        open,
        high,
        low,
        close,
        volume,
      }]
    })
    if (bars.length < 50) throw new FinanceDataError(`Yahoo returned only ${bars.length} complete bars`, 'INSUFFICIENT_HISTORY')
    const snapshot: Omit<MarketSnapshot, 'quote'> = {
      instrument: {
        symbol,
        name: result.meta.longName || result.meta.shortName || symbol,
        assetClass: 'equity',
        currency: result.meta.currency,
      },
      asOf: (bars.at(-1) as MarketBar).timestamp,
      source: { provider: 'yahoo-finance', retrievedAt: this.options.now().toISOString(), synthetic: false },
      bars,
    }
    const latestQuote = {
      price: result.meta.regularMarketPrice,
      changePercent: percentChange((bars.at(-2) as MarketBar).close, result.meta.regularMarketPrice),
    }
    return { ...snapshot, quote: latestQuote }
  }

  private async loadCrypto(symbol: string, signal?: AbortSignal): Promise<MarketSnapshot> {
    const metadata = CRYPTO_METADATA[symbol] as { readonly pair: string; readonly name: string }
    const url = `${this.options.binanceBaseUrl}/api/v3/klines?symbol=${encodeURIComponent(metadata.pair)}&interval=1d&limit=${String(this.options.barLimit)}`
    const payload = binanceKlinesSchema.parse((await this.fetchJson(url, signal)).data)
    const bars: MarketBar[] = payload.map(row => ({
      timestamp: iso(row[0], 'milliseconds'),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    if (bars.length < 50) throw new FinanceDataError(`Binance returned only ${bars.length} bars`, 'INSUFFICIENT_HISTORY')
    const snapshot: Omit<MarketSnapshot, 'quote'> = {
      instrument: { symbol, name: metadata.name, assetClass: 'crypto', currency: 'USD' },
      asOf: (bars.at(-1) as MarketBar).timestamp,
      source: { provider: 'binance', retrievedAt: this.options.now().toISOString(), synthetic: false },
      bars,
    }
    return { ...snapshot, quote: quoteFromBars(snapshot) }
  }

  private async loadPrediction(symbol: string, signal?: AbortSignal): Promise<MarketSnapshot> {
    const slug = symbol.slice('PREDICTION:'.length).toLowerCase()
    const gammaUrl = `${this.options.polymarketGammaBaseUrl}/markets?slug=${encodeURIComponent(slug)}&limit=1`
    const markets = polymarketGammaSchema.parse((await this.fetchJson(gammaUrl, signal)).data)
    const market = markets[0]
    if (market === undefined) throw new FinanceDataError(`Polymarket market ${slug} was not found`, 'MARKET_NOT_FOUND')
    const tokens = parseStringArray(market.clobTokenIds)
    const token = tokens[0]
    if (token === undefined) throw new FinanceDataError(`Polymarket market ${slug} has no CLOB token id`, 'MARKET_NOT_FOUND')
    const outcomes = parseStringArray(market.outcomes)
    const outcomePrices = parseStringArray(market.outcomePrices)
    const yesIndex = Math.max(outcomes.findIndex(outcome => outcome.toLowerCase() === 'yes'), 0)
    const impliedProbability = Number(outcomePrices[yesIndex] ?? 0)
    const historyUrl = `${this.options.polymarketClobBaseUrl}/prices-history?market=${encodeURIComponent(token)}&interval=1d&fidelity=60`
    const history = polymarketHistorySchema.parse((await this.fetchJson(historyUrl, signal)).data).history.slice(-this.options.barLimit)
    const bars: MarketBar[] = history.map(point => ({
      timestamp: iso(point.t, 'seconds'),
      open: point.p,
      high: point.p,
      low: point.p,
      close: point.p,
      volume: 0,
    }))
    if (bars.length < 50) throw new FinanceDataError(`Polymarket returned only ${bars.length} history points`, 'INSUFFICIENT_HISTORY')
    const snapshot: Omit<MarketSnapshot, 'quote'> = {
      instrument: {
        symbol,
        name: market.question || market.slug || slug,
        assetClass: 'prediction',
        currency: 'PROB',
      },
      asOf: (bars.at(-1) as MarketBar).timestamp,
      source: { provider: 'polymarket', retrievedAt: this.options.now().toISOString(), synthetic: false },
      bars,
      prediction: {
        impliedProbability,
        bid: market.bestBid,
        ask: market.bestAsk,
        volume: market.volumeNum,
        openInterest: market.liquidityNum,
        resolution: market.endDate,
        rules: market.description,
      },
    }
    return { ...snapshot, quote: quoteFromBars(snapshot) }
  }
}

/**
 * Create the public HTTP provider with resolved defaults.
 * @param options - Optional endpoint, timeout, clock, and fetch overrides.
 * @returns A provider backed by Yahoo, Binance, and Polymarket.
 */
export function createHttpFinanceMarketDataProvider(
  options: HttpFinanceMarketDataProviderOptions = {},
): HttpFinanceMarketDataProvider {
  return new HttpFinanceMarketDataProvider(options)
}
