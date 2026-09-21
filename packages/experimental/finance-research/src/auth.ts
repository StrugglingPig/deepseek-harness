/** Host-side request authorization and signing for finance providers. */

import { createHmac } from 'node:crypto'
import { FinanceDataError } from './error.ts'
import type { FinanceProviderRequest } from './types.ts'

/** Resolve one credential reference without exposing the value to model-visible data. */
export type FinanceCredentialResolver = (ref: string) => Promise<string | undefined>

/** Mutate the outbound URL and headers before the provider sends a request. */
export type FinanceRequestAuthorizer = (
  request: FinanceProviderRequest,
  url: URL,
  headers: Record<string, string>,
) => Promise<void>

/** Options for Binance API-key signing. */
export interface BinanceRequestAuthorizerOptions {
  /** Resolve stored credential references at request time. */
  readonly resolveCredential: FinanceCredentialResolver
  /** Whether the user enabled signed requests in the finance settings section. */
  readonly enabled: () => boolean
  /** Timestamp source used for Binance signed requests. */
  readonly now?: () => number
}

/** Credential reference for the Binance API key. */
export const BINANCE_API_KEY_REF = 'FINANCE_BINANCE_API_KEY'
/** Credential reference for the Binance API secret. */
export const BINANCE_API_SECRET_REF = 'FINANCE_BINANCE_API_SECRET'
/** Credential reference for the CoinMarketCap API key. */
export const COINMARKETCAP_API_KEY_REF = 'FINANCE_COINMARKETCAP_API_KEY'
/** Credential reference for the CoinGecko demo API key. */
export const COINGECKO_API_KEY_REF = 'FINANCE_COINGECKO_API_KEY'
/** Credential reference for the FRED API key. */
export const FRED_API_KEY_REF = 'FINANCE_FRED_API_KEY'

/** Bases whose requests carry an API key; each has exactly one owning authorizer. */
const API_KEY_BASES: ReadonlySet<string> = new Set(['coingecko', 'coinmarketcap', 'fred'])

/** Options for CoinMarketCap API-key authorization. */
export interface CoinMarketCapRequestAuthorizerOptions {
  /** Resolve the stored API key at request time. */
  readonly resolveCredential: FinanceCredentialResolver
  /** Whether the user enabled CoinMarketCap API requests in settings. */
  readonly enabled: () => boolean
}

/** Options for CoinGecko API-key authorization. */
export interface CoinGeckoRequestAuthorizerOptions {
  /** Resolve the stored API key at request time. */
  readonly resolveCredential: FinanceCredentialResolver
  /** Whether the user enabled CoinGecko API requests in settings. */
  readonly enabled: () => boolean
}

/**
 * Create the CoinGecko request authorizer.
 * @param options - credential resolver and feature switch.
 * @returns an authorizer that adds the demo API key header for CoinGecko requests.
 */
export function createCoinGeckoRequestAuthorizer(
  options: CoinGeckoRequestAuthorizerOptions,
): FinanceRequestAuthorizer {
  return async (request, _url, headers) => {
    if (request.auth !== 'api-key') return
    if (request.base !== 'coingecko') {
      // Another authorizer owns the remaining api-key bases.
      if (API_KEY_BASES.has(request.base)) return
      throw new FinanceDataError('api-key requests are configured only for the CoinGecko, CoinMarketCap, and FRED bases', 'AUTH_UNSUPPORTED')
    }
    if (!options.enabled()) throw new FinanceDataError('CoinGecko requests are disabled in settings', 'AUTH_DISABLED')
    const apiKey = await options.resolveCredential(COINGECKO_API_KEY_REF)
    if (apiKey === undefined || apiKey.length === 0) {
      throw new FinanceDataError('CoinGecko API key is not configured', 'AUTH_REQUIRED')
    }
    headers['x-cg-demo-api-key'] = apiKey
  }
}

/**
 * Create the Binance request authorizer.
 * @param options - credential resolver, feature switch, and clock.
 * @returns an authorizer that signs only explicit `auth: 'signed'` requests.
 */
export function createBinanceRequestAuthorizer(
  options: BinanceRequestAuthorizerOptions,
): FinanceRequestAuthorizer {
  const now = options.now ?? (() => Date.now())
  return async (request, url, headers) => {
    if (request.auth !== 'signed') return
    if (!options.enabled()) throw new FinanceDataError('signed finance requests are disabled in settings', 'AUTH_DISABLED')
    if (!request.base.startsWith('binance-')) {
      throw new FinanceDataError('signed requests are configured only for Binance bases', 'AUTH_UNSUPPORTED')
    }
    if (request.body !== undefined) {
      throw new FinanceDataError('signed Binance requests require query parameters, not a JSON body', 'AUTH_UNSUPPORTED')
    }
    const apiKey = await options.resolveCredential(BINANCE_API_KEY_REF)
    const apiSecret = await options.resolveCredential(BINANCE_API_SECRET_REF)
    if (apiKey === undefined || apiKey.length === 0 || apiSecret === undefined || apiSecret.length === 0) {
      throw new FinanceDataError('Binance API credentials are not configured', 'AUTH_REQUIRED')
    }
    if (!url.searchParams.has('timestamp')) url.searchParams.set('timestamp', String(now()))
    if (!url.searchParams.has('recvWindow')) url.searchParams.set('recvWindow', '5000')
    const signature = createHmac('sha256', apiSecret).update(url.searchParams.toString()).digest('hex')
    url.searchParams.set('signature', signature)
    headers['X-MBX-APIKEY'] = apiKey
  }
}


/**
 * Create the CoinMarketCap API-key authorizer.
 * @param options - credential resolver and feature switch.
 * @returns an authorizer that adds `X-CMC_PRO_API_KEY` to explicit `auth: 'api-key'` requests.
 */
export function createCoinMarketCapRequestAuthorizer(
  options: CoinMarketCapRequestAuthorizerOptions,
): FinanceRequestAuthorizer {
  return async (request, _url, headers) => {
    if (request.auth !== 'api-key') return
    if (request.base !== 'coinmarketcap') {
      // Another authorizer owns the remaining api-key bases; an unknown base is
      // still a misconfiguration rather than a silently unauthenticated call.
      if (API_KEY_BASES.has(request.base)) return
      throw new FinanceDataError('api-key requests are configured only for the CoinGecko, CoinMarketCap, and FRED bases', 'AUTH_UNSUPPORTED')
    }
    if (!options.enabled()) throw new FinanceDataError('CoinMarketCap requests are disabled in settings', 'AUTH_DISABLED')
    const apiKey = await options.resolveCredential(COINMARKETCAP_API_KEY_REF)
    if (apiKey === undefined || apiKey.length === 0) {
      throw new FinanceDataError('CoinMarketCap API key is not configured', 'AUTH_REQUIRED')
    }
    headers['X-CMC_PRO_API_KEY'] = apiKey
  }
}

/**
 * Create the FRED API-key authorizer.
 * @param options - credential resolver and feature switch.
 * @returns an authorizer that adds the `api_key` query parameter to FRED requests.
 */
export function createFredRequestAuthorizer(
  options: CoinMarketCapRequestAuthorizerOptions,
): FinanceRequestAuthorizer {
  return async (request, url) => {
    if (request.auth !== 'api-key' || request.base !== 'fred') return
    if (!options.enabled()) throw new FinanceDataError('FRED requests are disabled in settings', 'AUTH_DISABLED')
    const apiKey = await options.resolveCredential(FRED_API_KEY_REF)
    if (apiKey === undefined || apiKey.length === 0) {
      throw new FinanceDataError('FRED API key is not configured', 'AUTH_REQUIRED')
    }
    url.searchParams.set('api_key', apiKey)
  }
}

/**
 * Compose request authorizers in order.
 * @param authorizers - authorizers that ignore authentication modes they do not own.
 * @returns one authorizer that delegates every request through each contributor.
 */
export function composeRequestAuthorizers(
  ...authorizers: readonly FinanceRequestAuthorizer[]
): FinanceRequestAuthorizer {
  return async (request, url, headers) => {
    for (const authorize of authorizers) await authorize(request, url, headers)
  }
}
