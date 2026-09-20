import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  BINANCE_API_KEY_REF,
  BINANCE_API_SECRET_REF,
  COINMARKETCAP_API_KEY_REF,
  composeRequestAuthorizers,
  createBinanceRequestAuthorizer,
  createCoinMarketCapRequestAuthorizer,
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
