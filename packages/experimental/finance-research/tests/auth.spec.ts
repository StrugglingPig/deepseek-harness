import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  BINANCE_API_KEY_REF,
  BINANCE_API_SECRET_REF,
  COINMARKETCAP_API_KEY_REF,
  composeRequestAuthorizers,
  createBinanceRequestAuthorizer,
  createCoinGeckoRequestAuthorizer,
  createGithubRequestAuthorizer,
  GITHUB_TOKEN_REF,
  createCoinMarketCapRequestAuthorizer,
  COINGECKO_API_KEY_REF,
  createFredRequestAuthorizer,
  FRED_API_KEY_REF,
} from '../src/auth.ts'

const NOW = Date.UTC(2026, 8, 20, 12, 0, 0)

function options(overrides: Partial<Parameters<typeof createBinanceRequestAuthorizer>[0]> = {}) {
  const values = new Map([
    [BINANCE_API_KEY_REF, 'api-key'],
    [BINANCE_API_SECRET_REF, 'api-secret'],
  ])
  return {
    resolveCredential: async (ref: string) => values.get(ref),
    enabled: () => true,
    now: () => NOW,
    ...overrides,
  }
}

describe('Binance request authorizer', () => {
  it('leaves unsigned requests unchanged', async () => {
    const authorize = createBinanceRequestAuthorizer(options())
    const url = new URL('https://api.binance.test/api/v3/time?x=1')
    const headers: Record<string, string> = { accept: 'application/json' }

    await authorize({ base: 'binance-spot', path: '/api/v3/time' }, url, headers)

    expect(url.href).toBe('https://api.binance.test/api/v3/time?x=1')
    expect(headers).toEqual({ accept: 'application/json' })
  })

  it('signs the exact serialized query and adds the API-key header', async () => {
    const authorize = createBinanceRequestAuthorizer(options())
    const url = new URL('https://api.binance.test/api/v3/account?omitZeroBalances=true')
    const headers: Record<string, string> = {}

    await authorize({ base: 'binance-spot', path: '/api/v3/account', auth: 'signed' }, url, headers)

    expect(url.searchParams.get('timestamp')).toBe(String(NOW))
    expect(url.searchParams.get('recvWindow')).toBe('5000')
    const signature = url.searchParams.get('signature')
    const unsigned = new URL(url)
    unsigned.searchParams.delete('signature')
    expect(signature).toBe(createHmac('sha256', 'api-secret').update(unsigned.searchParams.toString()).digest('hex'))
    expect(headers).toEqual({ 'X-MBX-APIKEY': 'api-key' })
  })

  it('uses Date.now by default and preserves an explicit timestamp and receive window', async () => {
    const { now: defaultNow, ...authorizerOptions } = options()
    void defaultNow
    const authorize = createBinanceRequestAuthorizer(authorizerOptions)
    const url = new URL('https://api.binance.test/api/v3/account?timestamp=123&recvWindow=999')
    await authorize({ base: 'binance-spot', path: '/api/v3/account', auth: 'signed' }, url, {})
    expect(url.searchParams.get('timestamp')).toBe('123')
    expect(url.searchParams.get('recvWindow')).toBe('999')

    const generated = new URL('https://api.binance.test/api/v3/account')
    await authorize({ base: 'binance-spot', path: '/api/v3/account', auth: 'signed' }, generated, {})
    expect(Number(generated.searchParams.get('timestamp'))).toBeGreaterThan(0)
  })

  it('rejects signed requests when the user has not enabled them', async () => {
    const authorize = createBinanceRequestAuthorizer(options({ enabled: () => false }))
    await expect(authorize(
      { base: 'binance-spot', path: '/api/v3/account', auth: 'signed' },
      new URL('https://api.binance.test/api/v3/account'),
      {},
    )).rejects.toMatchObject({ code: 'AUTH_DISABLED' })
  })

  it('rejects signed requests for non-Binance providers', async () => {
    const authorize = createBinanceRequestAuthorizer(options())
    await expect(authorize(
      { base: 'yahoo', path: '/v8/finance/chart/AAPL', auth: 'signed' },
      new URL('https://query.test/v8/finance/chart/AAPL'),
      {},
    )).rejects.toMatchObject({ code: 'AUTH_UNSUPPORTED' })
  })

  it('rejects signed request bodies', async () => {
    const authorize = createBinanceRequestAuthorizer(options())
    await expect(authorize(
      {
        base: 'binance-usdm',
        path: '/fapi/v1/order',
        method: 'POST',
        auth: 'signed',
        body: { symbol: 'BTCUSDT' },
      },
      new URL('https://fapi.binance.test/fapi/v1/order'),
      {},
    )).rejects.toMatchObject({ code: 'AUTH_UNSUPPORTED' })
  })

  it('rejects signing without both credentials', async () => {
    const resolveCredential = vi.fn(async (ref: string) => ref === BINANCE_API_KEY_REF ? 'api-key' : undefined)
    const authorize = createBinanceRequestAuthorizer(options({ resolveCredential }))
    await expect(authorize(
      { base: 'binance-spot', path: '/api/v3/account', auth: 'signed' },
      new URL('https://api.binance.test/api/v3/account'),
      {},
    )).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })

  it('adds the CoinMarketCap API key header only to api-key requests', async () => {
    const authorize = createCoinMarketCapRequestAuthorizer({
      resolveCredential: async ref => ref === COINMARKETCAP_API_KEY_REF ? 'cmc-key' : undefined,
      enabled: () => true,
    })
    const headers: Record<string, string> = {}
    await authorize({ base: 'coinmarketcap', path: '/v3/cryptocurrency/quotes/latest', auth: 'api-key' }, new URL('https://pro-api.test'), headers)
    expect(headers).toEqual({ 'X-CMC_PRO_API_KEY': 'cmc-key' })
  })

  it('leaves the other api-key base to its own authorizer', async () => {
    const authorize = createCoinMarketCapRequestAuthorizer({
      resolveCredential: async () => undefined,
      enabled: () => true,
    })
    const url = new URL('https://api.stlouisfed.org/fred/series/observations')
    await expect(authorize({ base: 'fred', path: '/fred/series/observations', auth: 'api-key' }, url, {}))
      .resolves.toBeUndefined()
    expect(url.searchParams.has('api_key')).toBe(false)
  })

  it('rejects disabled, wrong-base, and missing CoinMarketCap credentials', async () => {
    const request = { base: 'coinmarketcap', path: '/v3/cryptocurrency/quotes/latest', auth: 'api-key' } as const
    await expect(createCoinMarketCapRequestAuthorizer({
      resolveCredential: async () => 'cmc-key',
      enabled: () => false,
    })(request, new URL('https://pro-api.test'), {})).rejects.toMatchObject({ code: 'AUTH_DISABLED' })

    await expect(createCoinMarketCapRequestAuthorizer({
      resolveCredential: async () => 'cmc-key',
      enabled: () => true,
    })({ ...request, base: 'binance-spot' }, new URL('https://pro-api.test'), {})).rejects.toMatchObject({ code: 'AUTH_UNSUPPORTED' })

    await expect(createCoinMarketCapRequestAuthorizer({
      resolveCredential: async () => undefined,
      enabled: () => true,
    })(request, new URL('https://pro-api.test'), {})).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })

  it('adds the api_key query parameter to FRED requests only', async () => {
    const authorize = createFredRequestAuthorizer({
      resolveCredential: async ref => ref === FRED_API_KEY_REF ? 'fred-key' : undefined,
      enabled: () => true,
    })
    const url = new URL('https://api.stlouisfed.org/fred/series/observations')
    await authorize({ base: 'fred', path: '/fred/series/observations', auth: 'api-key' }, url, {})
    expect(url.searchParams.get('api_key')).toBe('fred-key')

    const untouched = new URL('https://api.stlouisfed.org/fred/series/observations')
    await authorize({ base: 'fred', path: '/fred/series/observations' }, untouched, {})
    expect(untouched.searchParams.has('api_key')).toBe(false)
  })

  it('rejects a disabled FRED switch and a missing FRED key', async () => {
    const disabled = createFredRequestAuthorizer({ resolveCredential: async () => 'fred-key', enabled: () => false })
    await expect(disabled({ base: 'fred', path: '/fred/series', auth: 'api-key' }, new URL('https://fred.test'), {}))
      .rejects.toMatchObject({ code: 'AUTH_DISABLED' })
    const missing = createFredRequestAuthorizer({ resolveCredential: async () => undefined, enabled: () => true })
    await expect(missing({ base: 'fred', path: '/fred/series', auth: 'api-key' }, new URL('https://fred.test'), {}))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })

  it('composes Binance and CoinMarketCap authorizers without cross-handling', async () => {
    const authorize = composeRequestAuthorizers(
      createBinanceRequestAuthorizer(options()),
      createCoinMarketCapRequestAuthorizer({
        resolveCredential: async () => 'cmc-key',
        enabled: () => true,
      }),
    )
    const headers: Record<string, string> = {}
    await authorize({ base: 'coinmarketcap', path: '/v3/cryptocurrency/quotes/latest', auth: 'api-key' }, new URL('https://pro-api.test'), headers)
    expect(headers).toEqual({ 'X-CMC_PRO_API_KEY': 'cmc-key' })
  })
})

describe('CoinGecko request authorizer', () => {
  const request = { base: 'coingecko', path: '/coins/bitcoin', auth: 'api-key' as const }

  it('adds the demo key header and leaves other bases to their own authorizers', async () => {
    const authorize = createCoinGeckoRequestAuthorizer({
      resolveCredential: async ref => ref === COINGECKO_API_KEY_REF ? 'cg-key' : undefined,
      enabled: () => true,
    })
    const headers: Record<string, string> = {}
    await authorize(request, new URL('https://api.coingecko.test/v3'), headers)
    expect(headers).toEqual({ 'x-cg-demo-api-key': 'cg-key' })

    // Bases owned by another authorizer pass through untouched.
    const fredHeaders: Record<string, string> = {}
    await authorize({ base: 'fred', path: '/fred/series', auth: 'api-key' }, new URL('https://fred.test'), fredHeaders)
    expect(fredHeaders).toEqual({})
  })

  it('rejects disabled requests, a missing key, unowned bases, and unauthenticated modes', async () => {
    const disabled = createCoinGeckoRequestAuthorizer({ resolveCredential: async () => 'cg-key', enabled: () => false })
    await expect(disabled(request, new URL('https://api.coingecko.test/v3'), {}))
      .rejects.toMatchObject({ code: 'AUTH_DISABLED' })

    const missing = createCoinGeckoRequestAuthorizer({ resolveCredential: async () => undefined, enabled: () => true })
    await expect(missing(request, new URL('https://api.coingecko.test/v3'), {}))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' })

    const unowned = createCoinGeckoRequestAuthorizer({ resolveCredential: async () => 'cg-key', enabled: () => true })
    await expect(unowned({ base: 'unknown', path: '/x', auth: 'api-key' }, new URL('https://x.test'), {}))
      .rejects.toMatchObject({ code: 'AUTH_UNSUPPORTED' })

    const unsigned = createCoinGeckoRequestAuthorizer({ resolveCredential: async () => 'cg-key', enabled: () => false })
    await expect(unsigned({ base: 'coingecko', path: '/coins/bitcoin', auth: 'none' }, new URL('https://x.test'), {}))
      .resolves.toBeUndefined()
  })
})

describe('GitHub request authorizer', () => {
  const request = { base: 'github', path: '/repos/bitcoin/bitcoin', auth: 'api-key' as const }

  it('adds a bearer token only when one is configured', async () => {
    const withToken = createGithubRequestAuthorizer({
      resolveCredential: async ref => ref === GITHUB_TOKEN_REF ? 'gh-token' : undefined,
    })
    const headers: Record<string, string> = {}
    await withToken(request, new URL('https://api.github.test'), headers)
    expect(headers).toEqual({ Authorization: 'Bearer gh-token' })

    // Public repositories need no token, so an unset credential is not an error.
    const withoutToken = createGithubRequestAuthorizer({ resolveCredential: async () => undefined })
    const anonymous: Record<string, string> = {}
    await expect(withoutToken(request, new URL('https://api.github.test'), anonymous)).resolves.toBeUndefined()
    expect(anonymous).toEqual({})
  })

  it('leaves owned bases alone and rejects unknown ones', async () => {
    const authorize = createGithubRequestAuthorizer({ resolveCredential: async () => 'gh-token' })
    const fred: Record<string, string> = {}
    await authorize({ base: 'fred', path: '/fred/series', auth: 'api-key' }, new URL('https://fred.test'), fred)
    expect(fred).toEqual({})

    await expect(authorize({ base: 'unknown', path: '/x', auth: 'api-key' }, new URL('https://x.test'), {}))
      .rejects.toMatchObject({ code: 'AUTH_UNSUPPORTED' })

    await expect(authorize({ base: 'github', path: '/x', auth: 'none' }, new URL('https://x.test'), {}))
      .resolves.toBeUndefined()
  })
})
