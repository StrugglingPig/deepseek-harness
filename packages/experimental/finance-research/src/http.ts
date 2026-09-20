/** Real public HTTP market-data providers behind the finance provider interface. */

import { z as zod } from 'zod'
import { classifyAsset } from './data.ts'
import type {
  FinanceHttpMethod,
  FinanceJsonValue,
  FinanceMarketDataProvider,
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
const DEFAULT_BINANCE_BASE_URL = 'https://api.binance.com'
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

/** One provider failure with a stable machine-routable code. */
export class FinanceDataError extends Error {
  /**
   * @param message - Human-readable failure detail.
   * @param code - Stable provider error code.
   */
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'FinanceDataError'
  }
}

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
  /** Injectable clock for deterministic retrieved-at values. */
  readonly now?: () => Date
}

interface ResolvedOptions {
  readonly fetch: typeof globalThis.fetch
  readonly timeoutMs: number
  readonly barLimit: number
  readonly yahooBaseUrl: string
  readonly binanceBaseUrl: string
  readonly binanceUsdmBaseUrl: string
  readonly binanceCoinmBaseUrl: string
  readonly binanceOptionsBaseUrl: string
  readonly polymarketGammaBaseUrl: string
  readonly polymarketClobBaseUrl: string
  readonly now: () => Date
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
]

const BASE_ORIGINS: Readonly<Record<string, keyof ResolvedOptions>> = {
  'binance-spot': 'binanceBaseUrl',
  'binance-usdm': 'binanceUsdmBaseUrl',
  'binance-coinm': 'binanceCoinmBaseUrl',
  'binance-options': 'binanceOptionsBaseUrl',
  yahoo: 'yahooBaseUrl',
  'polymarket-gamma': 'polymarketGammaBaseUrl',
  'polymarket-clob': 'polymarketClobBaseUrl',
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
      fetch: options.fetch ?? globalThis.fetch,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      barLimit: options.barLimit ?? DEFAULT_BAR_LIMIT,
      yahooBaseUrl: options.yahooBaseUrl ?? DEFAULT_YAHOO_BASE_URL,
      binanceBaseUrl: options.binanceBaseUrl ?? DEFAULT_BINANCE_BASE_URL,
      binanceUsdmBaseUrl: options.binanceUsdmBaseUrl ?? 'https://fapi.binance.com',
      binanceCoinmBaseUrl: options.binanceCoinmBaseUrl ?? 'https://dapi.binance.com',
      binanceOptionsBaseUrl: options.binanceOptionsBaseUrl ?? 'https://eapi.binance.com',
      polymarketGammaBaseUrl: options.polymarketGammaBaseUrl ?? DEFAULT_POLYMARKET_GAMMA_BASE_URL,
      polymarketClobBaseUrl: options.polymarketClobBaseUrl ?? DEFAULT_POLYMARKET_CLOB_BASE_URL,
      now: options.now ?? (() => new Date()),
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
    } = {},
  ): Promise<{ readonly status: number; readonly data: FinanceJsonValue }> {
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs)
    const requestSignal = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal])
    const method = init.method ?? 'GET'
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': USER_AGENT,
      ...init.headers,
    }
    const body = init.body === undefined ? undefined : JSON.stringify(init.body)
    if (body !== undefined) headers['content-type'] = 'application/json'
    let response: Response
    try {
      response = await this.options.fetch(url, {
        method,
        headers,
        ...body === undefined ? {} : { body },
        signal: requestSignal,
      })
    } catch (error: unknown) {
      throw new FinanceDataError(`request failed for ${url}: ${String(error)}`, 'REQUEST_FAILED')
    }
    if (!response.ok) {
      throw new FinanceDataError(`request failed for ${url}: HTTP ${response.status}`, 'HTTP_ERROR')
    }
    try {
      return { status: response.status, data: await response.json() as FinanceJsonValue }
    } catch (error: unknown) {
      throw new FinanceDataError(`invalid JSON from ${url}: ${String(error)}`, 'INVALID_JSON')
    }
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
    const response = await this.fetchJson(url.href, signal, {
      method,
      ...request.headers === undefined ? {} : { headers: request.headers },
      ...request.body === undefined ? {} : { body: request.body },
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
