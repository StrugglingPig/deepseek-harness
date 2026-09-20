/** Runtime provider that follows user settings without re-registering tools. */

import type { FinanceCredentialResolver, FinanceRequestAuthorizer } from './auth.ts'
import { fixtureProvider } from './data.ts'
import { FinanceDataError } from './error.ts'
import { HttpFinanceMarketDataProvider } from './http.ts'
import { BinanceWebSocketStreamProvider, CoinMarketCapWebSocketStreamProvider, type FinanceWebSocketLike, type FinanceWebSocketOptions } from './stream.ts'
import type {
  FinanceCoinMarketCapOhlcvRequest,
  FinanceCoinMarketCapOhlcvSeries,
  FinanceCoinMarketCapQuote,
  FinanceCoinMarketCapQuoteRequest,
  FinanceMarketDataProvider,
  FinanceMarketStreamEvent,
  FinanceMarketStreamProvider,
  FinanceMarketStreamRequest,
  FinancePrivateAccountRequest,
  FinancePrivateAccountSnapshot,
  FinanceProviderDescriptor,
  FinanceProviderRequest,
  FinanceProviderResponse,
  MarketSnapshot,
} from './types.ts'

/** Non-secret provider settings owned by the finance settings namespace. */
export interface FinanceRuntimeSettings {
  readonly provider: 'fixture' | 'http'
  readonly timeoutMs: number
  readonly barLimit: number
  readonly yahooBaseUrl: string
  readonly binanceBaseUrl: string
  readonly binanceUsdmBaseUrl: string
  readonly binanceCoinmBaseUrl: string
  readonly binanceOptionsBaseUrl: string
  readonly coinMarketCapBaseUrl: string
  readonly polymarketGammaBaseUrl: string
  readonly polymarketClobBaseUrl: string
  readonly enableSignedRequests: boolean
  readonly enableCoinMarketCapRequests: boolean
  readonly enableAkshare: boolean
  readonly enableIfind: boolean
  readonly ifindTransport: 'http' | 'local'
  readonly ifindBaseUrl: string
  readonly pythonExecutable: string
  readonly stockBridgeTimeoutMs: number
  readonly stockBridgeMaxOutputBytes: number
  readonly requestCacheTtlMs: number
  readonly requestCacheMaxEntries: number
  readonly requestMaxRetries: number
  readonly requestRetryBaseDelayMs: number
  readonly requestRetryMaxDelayMs: number
  readonly requestsPerMinute: number
  readonly requestBurst: number
  readonly binanceWebSocketBaseUrl: string
  readonly coinMarketCapWebSocketBaseUrl: string
  readonly marketStreamTimeoutMs: number
  readonly marketStreamMaxEvents: number
}

/** Provider facade whose target follows the latest settings snapshot. */
export class SettingsFinanceMarketDataProvider implements FinanceMarketDataProvider {
  readonly id = 'settings'
  /**
   * @param readSettings - Latest non-secret finance settings.
   * @param authorize - Host-side auth/signing applied to HTTP requests.
   */
  constructor(
    private readonly readSettings: () => FinanceRuntimeSettings,
    private readonly authorize: FinanceRequestAuthorizer,
  ) {}

  private current(): FinanceMarketDataProvider {
    const settings = this.readSettings()
    if (settings.provider === 'fixture') return fixtureProvider
    return new HttpFinanceMarketDataProvider({
      timeoutMs: settings.timeoutMs,
      barLimit: settings.barLimit,
      yahooBaseUrl: settings.yahooBaseUrl,
      binanceBaseUrl: settings.binanceBaseUrl,
      binanceUsdmBaseUrl: settings.binanceUsdmBaseUrl,
      binanceCoinmBaseUrl: settings.binanceCoinmBaseUrl,
      binanceOptionsBaseUrl: settings.binanceOptionsBaseUrl,
      coinMarketCapBaseUrl: settings.coinMarketCapBaseUrl,
      polymarketGammaBaseUrl: settings.polymarketGammaBaseUrl,
      polymarketClobBaseUrl: settings.polymarketClobBaseUrl,
      authorize: this.authorize,
      cacheTtlMs: settings.requestCacheTtlMs,
      cacheMaxEntries: settings.requestCacheMaxEntries,
      maxRetries: settings.requestMaxRetries,
      retryBaseDelayMs: settings.requestRetryBaseDelayMs,
      retryMaxDelayMs: settings.requestRetryMaxDelayMs,
      requestsPerMinute: settings.requestsPerMinute,
      requestBurst: settings.requestBurst,
    })
  }

  /**
   * Load a normalized snapshot from the currently configured provider.
   * @param symbol - Instrument symbol.
   * @param signal - Optional caller cancellation.
   * @returns The current provider snapshot.
   */
  load(symbol: string, signal?: AbortSignal): Promise<MarketSnapshot> {
    return this.current().load(symbol, signal)
  }

  /**
   * Load normalized read-only account data from the current HTTP provider.
   * @param request - Account scope, optional symbol, and open-order inclusion.
   * @param signal - Optional caller cancellation.
   * @returns Normalized private account data.
   */
  loadPrivateAccount(
    request: FinancePrivateAccountRequest,
    signal?: AbortSignal,
  ): Promise<FinancePrivateAccountSnapshot> {
    const provider = this.current()
    if (this.readSettings().provider !== 'http' || provider.loadPrivateAccount === undefined) {
      return Promise.reject(new FinanceDataError(
        'private account data requires the live HTTP provider',
        'PROVIDER_UNAVAILABLE',
      ))
    }
    return provider.loadPrivateAccount(request, signal)
  }

  /**
   * Load normalized CoinMarketCap quotes from the current HTTP provider.
   * @param request - IDs or symbols and conversion currency.
   * @param signal - Optional caller cancellation.
   * @returns Normalized quote records.
   */
  loadCoinMarketCapQuotes(
    request: FinanceCoinMarketCapQuoteRequest,
    signal?: AbortSignal,
  ): Promise<readonly FinanceCoinMarketCapQuote[]> {
    const provider = this.current()
    if (this.readSettings().provider !== 'http' || provider.loadCoinMarketCapQuotes === undefined) {
      return Promise.reject(new FinanceDataError(
        'CoinMarketCap quotes require the live HTTP provider',
        'PROVIDER_UNAVAILABLE',
      ))
    }
    return provider.loadCoinMarketCapQuotes(request, signal)
  }

  /**
   * Load normalized CoinMarketCap OHLCV history from the current HTTP provider.
   * @param request - IDs or symbols, conversion, dates, count, and interval.
   * @param signal - Optional caller cancellation.
   * @returns Normalized OHLCV series.
   */
  loadCoinMarketCapOhlcv(
    request: FinanceCoinMarketCapOhlcvRequest,
    signal?: AbortSignal,
  ): Promise<readonly FinanceCoinMarketCapOhlcvSeries[]> {
    const provider = this.current()
    if (this.readSettings().provider !== 'http' || provider.loadCoinMarketCapOhlcv === undefined) {
      return Promise.reject(new FinanceDataError(
        'CoinMarketCap OHLCV requires the live HTTP provider',
        'PROVIDER_UNAVAILABLE',
      ))
    }
    return provider.loadCoinMarketCapOhlcv(request, signal)
  }

  /**
   * Describe the currently configured provider.
   * @returns Provider origins and auth metadata.
   */
  describe(): FinanceProviderDescriptor {
    const provider = this.current()
    return provider.describe?.() ?? {
      id: provider.id,
      displayName: 'Deterministic fixture provider',
      bases: [],
      notes: ['Set provider to http in Finance settings to enable live public endpoints.'],
    }
  }

  /**
   * Send a generic request through the currently configured provider.
   * @param request - Base, path, method, query, body, and auth mode.
   * @param signal - Optional caller cancellation.
   * @returns The provider response.
   */
  request(request: FinanceProviderRequest, signal?: AbortSignal): Promise<FinanceProviderResponse> {
    const provider = this.current()
    if (provider.request === undefined) {
      return Promise.reject(new FinanceDataError('the configured provider has no request transport', 'PROVIDER_UNAVAILABLE'))
    }
    return provider.request(request, signal)
  }
}

/** Options for deterministic WebSocket-carrier tests and embeddings. */
export interface SettingsFinanceMarketStreamProviderOptions {
  /** Injectable WebSocket factory. */
  readonly createSocket?: (url: string, options?: FinanceWebSocketOptions) => FinanceWebSocketLike
}

/** Stream facade whose target follows the latest settings snapshot. */
export class SettingsFinanceMarketStreamProvider implements FinanceMarketStreamProvider {
  /**
   * @param readSettings - Latest non-secret finance settings.
   */
  constructor(
    private readonly readSettings: () => FinanceRuntimeSettings,
    private readonly resolveCredential: FinanceCredentialResolver,
    private readonly options: SettingsFinanceMarketStreamProviderOptions = {},
  ) {}

  /**
   * Collect events from the currently configured WebSocket provider.
   * @param request - Provider, stream names or crypto IDs, timeout, and event cap.
   * @param signal - Optional caller cancellation.
   * @returns Parsed events in arrival order.
   */
  collect(
    request: FinanceMarketStreamRequest,
    signal?: AbortSignal,
  ): Promise<readonly FinanceMarketStreamEvent[]> {
    const settings = this.readSettings()
    if (request.provider === 'coinmarketcap') {
      return new CoinMarketCapWebSocketStreamProvider({
        baseUrl: settings.coinMarketCapWebSocketBaseUrl,
        resolveApiKey: () => this.resolveCredential('FINANCE_COINMARKETCAP_API_KEY'),
        enabled: () => settings.enableCoinMarketCapRequests,
        timeoutMs: settings.marketStreamTimeoutMs,
        maxEvents: settings.marketStreamMaxEvents,
        ...this.options.createSocket === undefined ? {} : { createSocket: this.options.createSocket },
      }).collect(request, signal)
    }
    return new BinanceWebSocketStreamProvider({
      baseUrl: settings.binanceWebSocketBaseUrl,
      timeoutMs: settings.marketStreamTimeoutMs,
      maxEvents: settings.marketStreamMaxEvents,
      ...this.options.createSocket === undefined ? {} : { createSocket: this.options.createSocket },
    }).collect(request, signal)
  }
}
