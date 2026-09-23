import { describe, expect, it, vi } from 'vitest'
import { FinanceDataError } from '../src/error.ts'
import {
  dashboardResearchLoader,
  loadDashboardEvents,
  loadDashboardMacroStrip,
  loadDashboardMarket,
  parseDashboardRequest,
  registerFinanceDashboardRoutes,
  type DashboardRouteDependencies,
} from '../src/dashboard.ts'
import type { Context } from '@deepseek-ai/cordis'
import { DASHBOARD_MARKET_PATH } from '../src/shared.ts'
import type { DashboardBar } from '../src/shared.ts'
import { NO_BACKTEST } from '../src/backtest.ts'
import { VALUATION_PARAMETERS } from '../src/valuation.ts'
import type {
  FinanceMarketDataProvider, FinanceProviderRequest, FinanceProviderResponse, FinanceStockSnapshot,
  FinanceUsFundamentals,
} from '../src/types.ts'

/** Fetch route shape claimed from Connection's exact-route registry. */
interface DashboardFetchRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: string
  readonly fetch: (request: Request) => Promise<Response>
}

/** Context whose injection hands the callback a Connection fetch registry. */
function routeContext(register: (route: DashboardFetchRoute) => () => Promise<void>): Context {
  return {
    inject: (_deps: readonly string[], callback: (ctx: unknown) => unknown) => callback({
      connection: { fetch: { register } },
    }),
  } as unknown as Context
}

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
      request: vi.fn(async (request: FinanceProviderRequest) => marketResponse(
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

/**
 * One reported set the loader can value, keyed the way the report builder emits it.
 * @param overrides - Metric overrides for the case under test.
 * @returns The provider answer.
 */
function fundamentalsWith(overrides: Readonly<Record<string, number>> = {}): FinanceUsFundamentals {
  return {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    reportedFinancials: 'FY2025 10-K',
    nextEarnings: '2026-10-22',
    indicators: {
      revenue: 1_000,
      operatingIncome: 200,
      netIncome: 150,
      totalAssets: 1_000,
      operatingCashFlow: 180,
      capex: 20,
      depreciation: 10,
      marketCap: 10_000,
      revenueGrowth: 6,
      ...overrides,
    },
  }
}

/**
 * Provider stub the loader reads; the chart seam is never called here.
 * @param loadUsFundamentals - Fundamentals answer to serve, omitted to model a provider without the seam.
 * @returns The provider.
 */
function researchProvider(
  loadUsFundamentals?: (request: { readonly symbol: string }) => Promise<FinanceUsFundamentals | undefined>,
): FinanceMarketDataProvider {
  return {
    id: 'stub',
    load: async () => { throw new FinanceDataError('chart not used', 'DASHBOARD_UNAVAILABLE') },
    ...loadUsFundamentals === undefined ? {} : { loadUsFundamentals },
  }
}

describe('dashboard research summary', () => {
  it('answers nothing when the provider cannot read US fundamentals', async () => {
    const loader = dashboardResearchLoader(researchProvider(), () => VALUATION_PARAMETERS, NO_BACKTEST)
    await expect(loader('AAPL', 100)).resolves.toBeUndefined()
    const empty = dashboardResearchLoader(
      researchProvider(async () => undefined),
      () => VALUATION_PARAMETERS,
      NO_BACKTEST,
    )
    await expect(empty('AAPL', 100)).resolves.toBeUndefined()
  })

  it('summarizes the model read the report would print', async () => {
    const loader = dashboardResearchLoader(
      researchProvider(async () => fundamentalsWith()),
      () => VALUATION_PARAMETERS,
      NO_BACKTEST,
    )
    const research = await loader('AAPL', 100)
    expect(research).toMatchObject({
      source: 'finnhub',
      reportedPeriod: 'FY2025 10-K',
      label: 'reference',
      nextEarnings: '2026-10-22',
    })
    expect(research?.range?.low).toBeLessThan(research?.range?.high as number)
    expect(research?.range?.weighted).toBeGreaterThan(0)
    expect(research?.ratios.find(reading => reading.id === 'netMargin')?.value).toBeCloseTo(15, 6)
    // Ratios the statements cannot support still travel, so the panel can print them as not obtained.
    expect(research?.ratios.find(reading => reading.id === 'currentRatio')?.value).toBeUndefined()
  })

  it('carries the empty period and no next earnings when the filing published neither', async () => {
    const loader = dashboardResearchLoader(
      researchProvider(async () => {
        const answer = fundamentalsWith()
        return { symbol: answer.symbol, indicators: answer.indicators }
      }),
      () => VALUATION_PARAMETERS,
      NO_BACKTEST,
    )
    const research = await loader('AAPL', 100)
    expect(research?.reportedPeriod).toBe('')
    expect(research?.nextEarnings).toBeUndefined()
  })

  it('leaves the range out when the model cannot value the instrument', async () => {
    const loader = dashboardResearchLoader(
      researchProvider(async () => fundamentalsWith({ operatingIncome: -50 })),
      () => VALUATION_PARAMETERS,
      NO_BACKTEST,
    )
    const research = await loader('AAPL', 100)
    expect(research?.range).toBeUndefined()
    expect(research?.action).toBeUndefined()
    expect(research?.label).toBe('reference')
  })
})
describe('finance dashboard market route', () => {
  it('parses and validates dashboard query parameters', () => {
    expect(parseDashboardRequest(new URL('http://localhost/api?asset=stock&symbol=600519&interval=1w&provider=ifind&limit=50')))
      .toEqual({ asset: 'stock', symbol: '600519', interval: '1w', limit: 50, provider: 'ifind' })
    expect(() => parseDashboardRequest(new URL('http://localhost/api?asset=bad'))).toThrow(FinanceDataError)
    expect(() => parseDashboardRequest(new URL('http://localhost/api?asset=stock'))).toThrow(FinanceDataError)
  })

  it('quotes the macro strip and drops the series an upstream cannot serve', async () => {
    const series = (id: string, value: number) => ({
      indicator: id,
      name: id,
      nameZh: id,
      category: 'market' as const,
      country: 'us' as const,
      unit: '%',
      frequency: 'daily' as const,
      timing: 'coincident' as const,
      reading: 'test',
      affectedAssets: [],
      source: 'fred' as const,
      observations: [{ date: '2026-09-22', value }],
      latest: { date: '2026-09-22', value },
      previous: undefined,
      retrievedAt: '2026-09-23T00:00:00.000Z',
    })
    const macro = await loadDashboardMacroStrip({
      id: 'macro',
      load: async (query) => {
        if (query.indicator.id === 'us-cpi') throw new FinanceDataError('fred down', 'PROVIDER_FAILED')
        return series(query.indicator.id, 4.25)
      },
    }, ['us-10y-yield', 'us-cpi', 'not-a-series'])
    expect(macro).toEqual([
      { id: 'us-10y-yield', value: 4.25, unit: '%', date: '2026-09-22', source: 'fred' },
    ])
  })

  it('reads the upcoming release calendar and keeps malformed rows out', async () => {
    const events = await loadDashboardEvents({
      request: vi.fn(async () => marketResponse({
        release_dates: [
          { date: '2026-09-24', release_name: 'Gross Domestic Product' },
          { date: '2026-09-25' },
          { release_name: 'Employment Situation' },
        ],
      })),
    }, 5)
    expect(events).toEqual([{ date: '2026-09-24', label: 'Gross Domestic Product', source: 'fred' }])

    // A key FRED will not serve leaves the calendar empty instead of failing the panel.
    const unavailable = await loadDashboardEvents({
      request: vi.fn(async () => { throw new FinanceDataError('no key', 'PROVIDER_UNAUTHORIZED') }),
    }, 5)
    expect(unavailable).toEqual([])
    const empty = await loadDashboardEvents({ request: vi.fn(async () => marketResponse({})) }, 5)
    expect(empty).toEqual([])
  })

  it('attaches the strips to the answer and survives a failing strip read', async () => {
    const withStrips = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=crypto&symbol=btc&interval=1h')),
      deps({
        macro: async () => [{ id: 'us-10y-yield', value: 4.25, unit: '%', date: '2026-09-22', source: 'fred' }],
        events: async () => [{ date: '2026-09-24', label: 'Gross Domestic Product', source: 'fred' }],
      }),
    )
    expect(withStrips.macro).toHaveLength(1)
    expect(withStrips.events).toHaveLength(1)

    const failing = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=crypto&symbol=btc&interval=1h')),
      deps({
        macro: async () => { throw new FinanceDataError('fred down', 'PROVIDER_FAILED') },
        events: async () => { throw new FinanceDataError('fred down', 'PROVIDER_FAILED') },
      }),
    )
    expect(failing.macro).toBeUndefined()
    expect(failing.events).toBeUndefined()
    expect(failing.bars.length).toBeGreaterThan(0)
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

  it('drops the in-progress Yahoo session that carries zero prices', async () => {
    const response = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=us&symbol=AAPL&interval=1d')),
      deps({
        market: {
          request: vi.fn(async () => marketResponse({
            chart: {
              result: [{
                meta: { shortName: 'Apple Inc.', currency: 'USD' },
                timestamp: [1_700_000_000, 1_700_086_400],
                indicators: { quote: [{
                  open: [100, 0], high: [110, 0], low: [95, 0], close: [105, 0], volume: [12, 0],
                }] },
              }],
            },
          })),
        },
      }),
    )
    // The quote and the chart read the last session that actually traded.
    expect(response.bars).toHaveLength(1)
    expect(response.quote.price).toBe(105)
    expect(response.quote.changePercent).toBe(0)
  })

  it('attaches the research summary to a US snapshot and survives a failing read', async () => {
    const summary = {
      source: 'finnhub',
      reportedPeriod: 'FY2025 10-K',
      label: 'reference' as const,
      grade: undefined,
      action: undefined,
      nextEarnings: undefined,
      range: undefined,
      ratios: [],
    }
    const research = vi.fn(async () => summary)
    const withResearch = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=us&symbol=AAPL&interval=1d')),
      deps({ research }),
    )
    expect(withResearch.research).toEqual(summary)
    expect(research).toHaveBeenCalledWith('AAPL', 105, undefined)

    // A failing research read leaves the chart mounted without its summary strip.
    const failing = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=us&symbol=AAPL&interval=1d')),
      deps({ research: async () => { throw new FinanceDataError('finnhub down', 'PROVIDER_FAILED') } }),
    )
    expect(failing.research).toBeUndefined()
    expect(failing.bars.length).toBeGreaterThan(0)
    // Without a loader the route answers the chart alone.
    const bare = await loadDashboardMarket(
      parseDashboardRequest(new URL('http://localhost/api?asset=us&symbol=AAPL&interval=1d')),
      deps(),
    )
    expect(bare.research).toBeUndefined()
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

  it('registers and answers the authenticated Fetch route', async () => {
    let route: DashboardFetchRoute | undefined
    const register = vi.fn((value: DashboardFetchRoute) => {
      route = value
      return () => Promise.resolve()
    })
    registerFinanceDashboardRoutes(routeContext(register), deps())
    expect(register).toHaveBeenCalledOnce()
    expect(route?.path).toBe(DASHBOARD_MARKET_PATH)
    expect(route?.methods).toEqual(['GET'])
    expect(route?.requestBody).toBe('buffered')
    const served = await route?.fetch(new Request(`http://localhost${DASHBOARD_MARKET_PATH}?asset=crypto&symbol=BTC`))
    expect(served?.status).toBe(200)
    expect(served?.headers.get('cache-control')).toBe('no-store')
    expect(await served?.text()).toContain('BTCUSDT')
    const rejected = await route?.fetch(new Request(`http://localhost${DASHBOARD_MARKET_PATH}?asset=bad`))
    expect(rejected?.status).toBe(400)
    expect(await rejected?.text()).toContain('DASHBOARD_INVALID_REQUEST')
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

    let routeHandler: ((request: Request) => Promise<Response>) | undefined
    const register = vi.fn((value: DashboardFetchRoute) => {
      routeHandler = value.fetch
      return () => Promise.resolve()
    })
    registerFinanceDashboardRoutes(routeContext(register), deps({
      market: { request: async () => { throw new Error('boom') } },
    }))
    const invalid = await routeHandler?.(new Request('http://localhost')) as Response
    const failed = await routeHandler?.(new Request(`http://localhost${DASHBOARD_MARKET_PATH}?asset=crypto&symbol=BTC`)) as Response
    expect(invalid.status).toBe(400)
    expect(await invalid.text()).toContain('DASHBOARD_INVALID_REQUEST')
    expect(failed.status).toBe(400)
    expect(await failed.text()).toContain('DASHBOARD_FAILED')
  })

})
