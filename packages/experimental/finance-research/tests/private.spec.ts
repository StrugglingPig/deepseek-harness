import { describe, expect, it, vi } from 'vitest'
import type { FinanceRequestAuthorizer } from '../src/auth.ts'
import { createHttpFinanceMarketDataProvider } from '../src/http.ts'
import { SettingsFinanceMarketDataProvider } from '../src/settings-provider.ts'
import type { FinanceRuntimeSettings } from '../src/settings-provider.ts'

const NOW = new Date('2026-09-20T10:00:00.000Z')

function provider(fetch: typeof globalThis.fetch, authorize?: FinanceRequestAuthorizer) {
  return createHttpFinanceMarketDataProvider({
    now: () => NOW,
    fetch,
    ...authorize === undefined ? {} : { authorize },
    binanceBaseUrl: 'https://spot.test',
    binanceUsdmBaseUrl: 'https://usdm.test',
    binanceCoinmBaseUrl: 'https://coinm.test',
    binanceOptionsBaseUrl: 'https://options.test',
  })
}

function signedAuthorize(): FinanceRequestAuthorizer {
  return vi.fn(async (
    request: Parameters<FinanceRequestAuthorizer>[0],
    _url: URL,
    headers: Record<string, string>,
  ) => {
    if (request.auth !== 'signed') return
    headers['X-MBX-APIKEY'] = 'test-key'
  })
}

describe('Binance private account data', () => {
  it('loads a normalized Spot account and optional open orders', async () => {
    const authorize = signedAuthorize()
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      expect((init?.headers as Record<string, string>)['X-MBX-APIKEY']).toBe('test-key')
      if (url.includes('/openOrders')) {
        return new Response(JSON.stringify([{
          orderId: 7,
          symbol: 'BTCUSDT',
          side: 'BUY',
          type: 'LIMIT',
          price: '60000',
          origQty: '0.1',
          executedQty: '0.02',
          status: 'NEW',
          time: 1_700_000_000_000,
        }]), { status: 200 })
      }
      return new Response(JSON.stringify({
        accountType: 'SPOT',
        canTrade: true,
        canWithdraw: false,
        balances: [
          { asset: 'BTC', free: '0.5', locked: '0.1' },
          { asset: 'USDT', free: '0', locked: '0' },
        ],
      }), { status: 200 })
    })

    const account = await provider(fetch, authorize).loadPrivateAccount({
      scope: 'spot',
      includeOpenOrders: true,
    })

    expect(account).toMatchObject({
      scope: 'spot',
      accountType: 'SPOT',
      canTrade: true,
      canWithdraw: false,
      retrievedAt: NOW.toISOString(),
      balances: [{ asset: 'BTC', free: 0.5, locked: 0.1, total: 0.6 }],
      openOrders: [{
        orderId: '7', symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: 60_000,
        quantity: 0.1, executedQuantity: 0.02, status: 'NEW', time: '2023-11-14T22:13:20.000Z',
      }],
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ base: 'binance-spot', path: '/api/v3/account', auth: 'signed' }),
      expect.any(URL),
      expect.any(Object),
    )
  })

  it('loads USD-M balances and non-flat positions', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/positionRisk')) {
        return new Response(JSON.stringify([
          {
            symbol: 'BTCUSDT', positionAmt: '0.25', entryPrice: '60000', markPrice: '61000',
            unRealizedProfit: '250', leverage: '3', positionSide: 'BOTH',
          },
          {
            symbol: 'ETHUSDT', positionAmt: '0', entryPrice: '0', markPrice: '3000',
            unRealizedProfit: '0', leverage: '3', positionSide: 'BOTH',
          },
        ]), { status: 200 })
      }
      return new Response(JSON.stringify({
        totalWalletBalance: '1000',
        totalUnrealizedProfit: '250',
        assets: [{ asset: 'USDT', walletBalance: '1000', availableBalance: '900' }],
      }), { status: 200 })
    })

    const account = await provider(fetch, signedAuthorize()).loadPrivateAccount({ scope: 'usdm' })

    expect(account).toMatchObject({
      scope: 'usdm',
      totalWalletBalance: 1_000,
      totalUnrealizedProfit: 250,
      balances: [{ asset: 'USDT', free: 900, locked: 100, total: 1_000 }],
      positions: [{
        symbol: 'BTCUSDT', side: 'long', quantity: 0.25, entryPrice: 60_000,
        markPrice: 61_000, unrealizedPnl: 250, leverage: 3,
      }],
    })
  })

  it('rejects empty symbols and unsupported account scopes', async () => {
    const target = provider(async () => new Response('{}', { status: 200 }))
    await expect(target.loadPrivateAccount({ scope: 'spot', symbol: '  ' })).rejects.toMatchObject({
      code: 'INVALID_SYMBOL',
    })
    await expect(target.loadPrivateAccount({ scope: 'options' as never })).rejects.toMatchObject({
      code: 'AUTH_UNSUPPORTED',
    })
  })

  it('supports Spot reads without orders and COIN-M reads with a symbol filter', async () => {
    const urls: string[] = []
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      urls.push(url)
      if (url.includes('spot.test/api/v3/openOrders')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (url.includes('coinm.test/dapi/v1/account')) {
        return new Response(JSON.stringify({ totalWalletBalance: '1', totalUnrealizedProfit: '0', assets: [] }), { status: 200 })
      }
      if (url.includes('coinm.test/dapi/v1/positionRisk')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (url.includes('coinm.test/dapi/v1/openOrders')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response(JSON.stringify({ accountType: 'SPOT', canTrade: true, balances: [] }), { status: 200 })
    })
    const target = provider(fetch, signedAuthorize())
    await target.loadPrivateAccount({ scope: 'spot' })
    await target.loadPrivateAccount({ scope: 'spot', symbol: 'btcusdt', includeOpenOrders: true })
    await target.loadPrivateAccount({ scope: 'coinm', symbol: 'BTCUSD_PERP', includeOpenOrders: true })
    await target.loadPrivateAccount({ scope: 'coinm', includeOpenOrders: true })

    expect(urls.some(url => url.includes('/api/v3/account'))).toBe(true)
    expect(urls.some(url => url.includes('/api/v3/openOrders?symbol=BTCUSDT'))).toBe(true)
    expect(urls.some(url => url.includes('/dapi/v1/positionRisk?symbol=BTCUSD_PERP'))).toBe(true)
    expect(urls.some(url => url.includes('/dapi/v1/openOrders?symbol=BTCUSD_PERP'))).toBe(true)
  })

  it('rejects private account reads through the fixture settings provider', async () => {
    const settings: FinanceRuntimeSettings = {
      provider: 'fixture',
      reportLanguage: 'auto',
      timeoutMs: 1_000,
      barLimit: 60,
      yahooBaseUrl: 'https://yahoo.test',
      binanceBaseUrl: 'https://spot.test',
      binanceUsdmBaseUrl: 'https://usdm.test',
      binanceCoinmBaseUrl: 'https://coinm.test',
      binanceOptionsBaseUrl: 'https://options.test',
      polymarketGammaBaseUrl: 'https://gamma.test',
      polymarketClobBaseUrl: 'https://clob.test',
      enableSignedRequests: false,
      enableCoinMarketCapRequests: false,
      enableCoinGeckoRequests: false,
      enableFinnhubRequests: false,
      githubBaseUrl: 'https://api.github.test',
      finnhubBaseUrl: 'https://finnhub.test/api/v1',
      enableAkshare: true,
      enableIfind: false,
      ifindTransport: 'http',
      ifindBaseUrl: 'https://quantapi.test',
      pythonExecutable: 'python3',
      stockBridgeTimeoutMs: 60_000,
      stockBridgeMaxOutputBytes: 4 * 1024 * 1024,
      coinMarketCapBaseUrl: 'https://pro-api.test',
      coinGeckoBaseUrl: 'https://api.coingecko.test/v3',
      fredBaseUrl: 'https://fred.test',
      worldBankBaseUrl: 'https://worldbank.test',
      imfBaseUrl: 'https://imf.test',
      enableFredRequests: true,
      requestCacheTtlMs: 0,
      requestCacheMaxEntries: 0,
      requestMaxRetries: 0,
      requestRetryBaseDelayMs: 1,
      requestRetryMaxDelayMs: 1,
      requestsPerMinute: 60,
      requestBurst: 1,
      binanceWebSocketBaseUrl: 'wss://stream.test',
      coinMarketCapWebSocketBaseUrl: 'wss://pro-stream.test/v1',
      marketStreamTimeoutMs: 1_000,
      marketStreamMaxEvents: 2,
    }
    const target = new SettingsFinanceMarketDataProvider(() => settings, async () => undefined)

    await expect(target.loadPrivateAccount({ scope: 'spot' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    })
  })
})
