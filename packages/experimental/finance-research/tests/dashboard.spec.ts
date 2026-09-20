import { describe, expect, it, vi } from 'vitest'
import { FinanceDataError } from '../src/error.ts'
import {
  loadDashboardMarket,
  parseDashboardRequest,
  registerFinanceDashboardRoutes,
  type DashboardRouteDependencies,
} from '../src/dashboard.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { DashboardBar } from '../src/dashboard.ts'
import type { FinanceProviderResponse, FinanceStockSnapshot } from '../src/types.ts'

function marketResponse(data: unknown): FinanceProviderResponse {
  return {
    provider: 'test',
    base: 'test',
    method: 'GET',
    path: '/test',
    status: 200,
    data: data as never,
  }
}

function stockBars(count = 60): readonly DashboardBar[] {
  return Array.from({ length: count }, (_, index) => ({
    time: Date.UTC(2026, 0, index + 1),
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
    volume: 1_000 + index,
  }))
}

function snapshot(): FinanceStockSnapshot {
  return {
    instrument: { symbol: '600519', name: '贵州茅台', assetClass: 'equity', currency: 'CNY' },
    asOf: '2026-03-01T00:00:00.000Z',
    source: { provider: 'akshare', retrievedAt: '2026-03-01T00:00:00.000Z', synthetic: false },
    quote: { price: 160, changePercent: 1 },
    bars: stockBars().map(bar => ({
      timestamp: new Date(bar.time).toISOString(),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    })),
  }
}

function deps(overrides: Partial<DashboardRouteDependencies> = {}): DashboardRouteDependencies {
  return {
    market: {
      request: vi.fn(async request => marketResponse(
        request.base === 'binance-spot'
          ? [[1_700_000_000_000, '100', '110', '95', '105', '12']]
          : {
            chart: {
              result: [{
                meta: { shortName: 'Apple Inc.', currency: 'USD' },
                timestamp: [1_700_000_000],
                indicators: { quote: [{ open: [100], high: [110], low: [95], close: [105], volume: [12] }] },
              }],
            },
          },
      )),
    },
    stock: () => ({ loadStockSnapshot: async () => snapshot() }),
    enabledStock: () => true,
    now: () => new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('finance dashboard market route', () => {
  it('parses and validates dashboard query parameters', () => {
    expect(parseDashboardRequest(new URL('http://localhost/api?asset=stock&symbol=600519&interval=1w&provider=ifind&limit=50')))
      .toEqual({ asset: 'stock', symbol: '600519', interval: '1w', limit: 50, provider: 'ifind' })
    expect(() => parseDashboardRequest(new URL('http://localhost/api?asset=bad'))).toThrow(FinanceDataError)
    expect(() => parseDashboardRequest(new URL('http://localhost/api?asset=stock'))).toThrow(FinanceDataError)
  })

  it('normalizes Binance crypto bars and quote', async () => {
    const response = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=crypto&symbol=btc&interval=1m')),
      deps(),
    )
    expect(response).toMatchObject({
      asset: 'crypto',
      symbol: 'BTCUSDT',
      interval: '1m',
      source: 'binance-spot',
      bars: [{ open: 100, high: 110, low: 95, close: 105, volume: 12 }],
      quote: { price: 105, currency: 'USDT' },
    })
  })

  it('normalizes Yahoo equity bars and quote', async () => {
    const response = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=us&symbol=AAPL&interval=1d')),
      deps(),
    )
    expect(response).toMatchObject({
      asset: 'us',
      symbol: 'AAPL',
      name: 'Apple Inc.',
      source: 'yahoo-finance',
      quote: { price: 105, currency: 'USD' },
    })
  })

  it('loads and aggregates AKShare stock bars', async () => {
    const response = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=stock&symbol=600519&interval=1w')),
      deps(),
    )
    expect(response.asset).toBe('stock')
    expect(response.symbol).toBe('600519')
    expect(response.source).toBe('akshare')
    expect(response.bars.length).toBeLessThan(60)
    expect(response.bars.at(-1)?.close).toBe(160)
  })

  it('reports missing and disabled stock providers', async () => {
    await expect(loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=stock&symbol=600519')),
      deps({ stock: () => undefined }),
    )).rejects.toMatchObject({ code: 'DASHBOARD_UNAVAILABLE' })
    await expect(loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=stock&symbol=600519')),
      deps({ enabledStock: () => false }),
    )).rejects.toMatchObject({ code: 'STOCK_PROVIDER_DISABLED' })
  })
  it('rejects invalid intervals, providers, and malformed upstream payloads', async () => {
    expect(() => parseDashboardRequest(new URL('http://localhost/api?asset=crypto&symbol=BTC&interval=2h'))).toThrow(FinanceDataError)
    expect(() => parseDashboardRequest(new URL('http://localhost/api?asset=stock&symbol=600519&provider=other'))).toThrow(FinanceDataError)
    const malformedMarket = deps({
      market: { request: async () => marketResponse([[1, '100', 'bad', '95', '105', '12']]) },
    })
    await expect(loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=crypto&symbol=BTC')),
      malformedMarket,
    )).rejects.toMatchObject({ code: 'DASHBOARD_EMPTY' })
    const malformedYahoo = deps({
      market: { request: async () => marketResponse({ chart: { result: [{ meta: { shortName: 'Fallback' }, timestamp: ['bad'], indicators: { quote: [] } }] } }) },
    })
    await expect(loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=us&symbol=AAPL')),
      malformedYahoo,
    )).rejects.toMatchObject({ code: 'DASHBOARD_EMPTY' })
  })

  it('covers crypto, Yahoo, weekly, monthly, and date branches', async () => {
    const crypto = deps({ market: { request: async () => marketResponse([['bad'], [1, '100', '110', '95', '105', '12']]) } })
    const cryptoResult = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=crypto&symbol=BTC&interval=1w&limit=10')),
      crypto,
    )
    expect(cryptoResult.bars).toHaveLength(1)

    const yahooPayload = {
      chart: {
        result: [{
          meta: { longName: 'Apple', currency: 'USD' },
          timestamp: [1_700_000_000, 1_700_000_060, 1_700_000_120],
          indicators: { quote: [{ open: [100, 101, 'bad'], high: [110, 111, 112], low: [95, 96, 97], close: [105, 106, 107], volume: [12, 13, 14] }] },
        }],
      },
    }
    const yahoo = deps({ market: { request: async () => marketResponse(yahooPayload) } })
    const us = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=us&symbol=AAPL&interval=1h')),
      yahoo,
    )
    expect(us.name).toBe('Apple')

    const monthly = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=stock&symbol=600519&interval=1M&limit=3')),
      deps(),
    )
    expect(monthly.bars.length).toBeGreaterThan(0)
  })

  it('registers and answers the Host route', async () => {
    let routeHandler: ((req: never, res: never) => Promise<void>) | undefined
    const register = vi.fn((route: { handler: typeof routeHandler }) => {
      routeHandler = route.handler
      return () => undefined
    })
    const ctx = {
      inject: (_deps: readonly string[], callback: (ctx: unknown) => unknown) => callback({ webServer: { register } }),
    } as unknown as Context
    registerFinanceDashboardRoutes(ctx, deps())
    expect(register).toHaveBeenCalledOnce()
    const status: number[] = []
    const bodies: string[] = []
    const response = {
      writeHead: (code: number) => { status.push(code) },
      end: (body?: string) => { bodies.push(body ?? '') },
    }
    await routeHandler?.({ method: 'POST', url: '/api/finance-dashboard/market' } as never, response as never)
    await routeHandler?.({ method: 'GET', url: '/api/finance-dashboard/market?asset=crypto&symbol=BTC' } as never, response as never)
    await routeHandler?.({ method: 'GET', url: '/api/finance-dashboard/market?asset=bad' } as never, response as never)
    expect(status).toEqual([405, 200, 400])
    expect(bodies[0]).toContain('METHOD_NOT_ALLOWED')
    expect(bodies[1]).toContain('BTCUSDT')
    expect(bodies[2]).toContain('DASHBOARD_INVALID_REQUEST')
  })

  it('covers defaults and malformed provider payload failures', async () => {
    const { now: _cryptoNow, ...cryptoWithoutNow } = deps()
    const noLimit = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=crypto&symbol=BTC')),
      cryptoWithoutNow,
    )
    expect(noLimit.symbol).toBe('BTCUSDT')
    expect(parseDashboardRequest(new URL('http://localhost/api?asset=&symbol=BTC&limit=bad')).asset).toBe('crypto')
    expect(parseDashboardRequest(new URL('http://localhost/api?asset=crypto&symbol=BTC&limit=bad')).limit).toBe(240)
    expect((await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=crypto&symbol=BTCUSDT')),
      deps(),
    )).symbol).toBe('BTCUSDT')

    await expect(loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=crypto&symbol=BTC')),
      deps({ market: { request: async () => marketResponse(null) } }),
    )).rejects.toMatchObject({ code: 'DASHBOARD_EMPTY' })

    const emptyCrypto = deps({ market: { request: async () => marketResponse(null) } })
    await expect(loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=us&symbol=AAPL')),
      emptyCrypto,
    )).rejects.toMatchObject({ code: 'DASHBOARD_EMPTY' })

    const malformedYahoo = deps({
      market: {
        request: async () => marketResponse({ chart: { result: [{ meta: { shortName: 'Fallback' }, timestamp: 'bad' }] } }),
      },
    })
    await expect(loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=us&symbol=AAPL')),
      malformedYahoo,
    )).rejects.toMatchObject({ code: 'DASHBOARD_EMPTY' })

    const bareQuote = { open: [100], high: [101], low: [99], close: [100], volume: [1] }
    const bareYahoo = deps({
      market: {
        request: async () => marketResponse({
          chart: { result: [{ meta: {}, timestamp: [1_700_000_000], indicators: { quote: [null, bareQuote] } }] },
        }),
      },
    })
    const bare = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=us&symbol=AAPL&interval=1M')),
      bareYahoo,
    )
    expect(bare.name).toBe('Equity')

    const fallbackYahoo = deps({
      market: {
        request: async () => marketResponse({
          chart: {
            result: [{
              meta: { shortName: 'Fallback' },
              timestamp: [1_700_000_000],
              indicators: { quote: [{ open: [100], high: [101], low: [99], close: [100], volume: [1] }] },
            }],
          },
        }),
      },
    })
    const fallback = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=us&symbol=AAPL&interval=1m')),
      fallbackYahoo,
    )
    expect(fallback.name).toBe('Fallback')
    expect(fallback.quote.currency).toBe('USD')

    const zeroPercent = deps({ market: { request: async () => marketResponse([
      [1, '100', '100', '100', '0', '1'],
      [2, '0', '10', '0', '10', '1'],
    ]) } })
    const zero = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=crypto&symbol=BTC&interval=1d')),
      zeroPercent,
    )
    expect(zero.quote.changePercent).toBe(0)
  })

  it('covers stock fallback branches and route errors', async () => {
    const emptyStock = deps({ stock: () => ({ loadStockSnapshot: async () => ({ ...snapshot(), bars: [] }) }) })
    await expect(loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=stock&symbol=600519&interval=1d')),
      emptyStock,
    )).rejects.toMatchObject({ code: 'DASHBOARD_EMPTY' })

    const { now: _stockNow, ...stockWithoutNow } = deps()
    const daily = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=stock&symbol=600519&interval=1d')),
      stockWithoutNow,
    )
    expect(daily.bars.length).toBe(60)

    let routeHandler: ((req: never, res: never) => Promise<void>) | undefined
    const register = vi.fn((route: { handler: typeof routeHandler }) => {
      routeHandler = route.handler
      return () => undefined
    })
    const routeContext = {
      inject: (_deps: readonly string[], callback: (ctx: unknown) => unknown) => callback({ webServer: { register } }),
    } as unknown as Context
    registerFinanceDashboardRoutes(routeContext, deps({
      market: { request: async () => { throw new Error('boom') } },
    }))
    const status: number[] = []
    const bodies: string[] = []
    const response = { writeHead: (code: number) => { status.push(code) }, end: (body?: string) => { bodies.push(body ?? '') } }
    await routeHandler?.({ method: 'GET', url: undefined } as never, response as never)
    await routeHandler?.({ method: 'GET', url: '/api/finance-dashboard/market?asset=crypto&symbol=BTC' } as never, response as never)
    expect(status).toEqual([400, 400])
    expect(bodies[0]).toContain('DASHBOARD_INVALID_REQUEST')
    expect(bodies[1]).toContain('DASHBOARD_FAILED')
  })

})
