import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { WebSocketServer } from 'ws'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { apply, BINANCE_API_KEY_REF, COINMARKETCAP_API_KEY_REF, FRED_API_KEY_REF } from '../src/index.ts'
import { DASHBOARD_MARKET_PATH } from '../src/shared.ts'
import type { Config } from '../src/index.ts'
import type { FinanceRuntimeSettings } from '../src/settings-provider.ts'

function textOfReport(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const CONFIG: Required<Config> = {
  provider: 'http',
  reportLanguage: 'auto',
  uiLocale: 'en',
  timeoutMs: 1_000,
  barLimit: 60,
  yahooBaseUrl: 'https://yahoo.test',
  binanceBaseUrl: 'https://spot.test',
  binanceUsdmBaseUrl: 'https://usdm.test',
  binanceCoinmBaseUrl: 'https://coinm.test',
  binanceOptionsBaseUrl: 'https://options.test',
  polymarketGammaBaseUrl: 'https://gamma.test',
  polymarketClobBaseUrl: 'https://clob.test',
  enableSignedRequests: true,
  enableCoinMarketCapRequests: true,
  enableCoinGeckoRequests: true,
  enableFinnhubRequests: true,
  githubBaseUrl: 'https://api.github.test',
  finnhubBaseUrl: 'https://finnhub.test/api/v1',
  enableAkshare: true,
  enableIfind: true,
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
  eiaBaseUrl: 'https://eia.test/v2',
  cftcBaseUrl: 'https://cftc.test',
  enableFredRequests: true,
  enableEiaRequests: true,
  requestCacheTtlMs: 0,
  requestCacheMaxEntries: 10,
  requestMaxRetries: 0,
  requestRetryBaseDelayMs: 1,
  requestRetryMaxDelayMs: 1,
  requestsPerMinute: 60,
  requestBurst: 10,
  binanceWebSocketBaseUrl: 'wss://stream.test',
  coinMarketCapWebSocketBaseUrl: 'wss://pro-stream.test/v1',
  marketStreamTimeoutMs: 100,
  marketStreamMaxEvents: 2,
}

describe('finance apply', () => {
  it('binds settings and credentials so signed tools use the live credential service', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    let current: FinanceRuntimeSettings = CONFIG
    const watch = vi.fn((listener: (next: FinanceRuntimeSettings) => void) => { listener(current) })
    const scope = {
      get: () => current,
      watch,
    }
    const register = vi.fn(() => scope)
    ctx.provide('settings', { register, get: vi.fn(() => undefined) } as never)
    const resolve = vi.fn(async (ref: string) => ({
      value: ref === BINANCE_API_KEY_REF ? 'api-key'
        : ref === COINMARKETCAP_API_KEY_REF ? 'cmc-key'
          : ref === FRED_API_KEY_REF ? 'fred-key'
            : 'api-secret',
    }))
    ctx.provide('credentials', { resolve } as never)
    const server = new WebSocketServer({ port: 0 })
    await new Promise<void>(resolve => server.once('listening', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server has no port')
    server.on('connection', (socket) => {
      socket.send(JSON.stringify({ stream: 'btcusdt@miniTicker', data: { c: '60000' } }))
    })
    const cmcServer = new WebSocketServer({ port: 0 })
    await new Promise<void>(resolve => cmcServer.once('listening', resolve))
    const cmcAddress = cmcServer.address()
    if (cmcAddress === null || typeof cmcAddress === 'string') throw new Error('test server has no port')
    cmcServer.on('connection', (socket) => {
      socket.send(JSON.stringify({
        type: 'data', channel: 'market@crypto_latest_price', data: { cid: 1, p: 60_000 },
      }))
    })
    const config = {
      ...CONFIG,
      binanceWebSocketBaseUrl: `ws://127.0.0.1:${String(address.port)}`,
      coinMarketCapWebSocketBaseUrl: `ws://127.0.0.1:${String(cmcAddress.port)}`,
    }
    current = config
    const requestedUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      requestedUrls.push(url)
      if (url.includes('/stock/profile2') || url.includes('/stock/metric') || url.includes('/stock/peers')) {
        if (url.includes('/stock/peers')) return new Response(JSON.stringify(['AAPL', 'MSFT']), { status: 200 })
        if (url.includes('/stock/metric')) return new Response(JSON.stringify({ metric: { peTTM: 32.5 } }), { status: 200 })
        return new Response(JSON.stringify({ name: 'Apple Inc', ticker: 'AAPL', finnhubIndustry: 'Technology' }), { status: 200 })
      }
      if (url.includes('/coins/bitcoin')) {
        return new Response(JSON.stringify({
          id: 'bitcoin',
          name: 'Bitcoin',
          community_data: { twitter_followers: 7_100_000 },
          developer_data: { stars: 85_000 },
        }), { status: 200 })
      }
      if (url.includes('/fred/series/observations')) {
        expect(url).toContain('api_key=fred-key')
        return new Response(JSON.stringify({ observations: [{ date: '2026-01-01', value: '4.5' }, { date: '2026-02-01', value: '4.7' }] }), { status: 200 })
      }
      if (url.includes('/seriesid/')) {
        expect(url).toContain('api_key=')
        return new Response(JSON.stringify({ response: { data: [{ period: '2026-09-11', value: 415_000 }] } }), { status: 200 })
      }
      if (url.includes('cftc.test')) {
        return new Response(JSON.stringify([
          { report_date_as_yyyy_mm_dd: '2026-09-15T00:00:00.000', noncomm_positions_long_all: '258059', noncomm_positions_short_all: '27721' },
        ]), { status: 200 })
      }
      if (url.includes('/quotes/latest')) {
        return new Response(JSON.stringify({ data: [{ id: 1, name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin', quote: { USD: { price: 60_000 } } }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ balances: [] }), { status: 200 })
    }))

    apply(ctx, config)
    await Promise.resolve()
    expect(register).toHaveBeenCalledWith('finance-research', expect.anything(), { base: config })
    expect(watch).toHaveBeenCalled()

    current = { ...config, enableSignedRequests: true }
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'signed-request' as never,
      name: 'finance_provider_request',
      arguments: { base: 'binance-spot', path: '/api/v3/account', auth: 'signed' },
    })
    expect(result.isError).toBe(false)
    expect(resolve).toHaveBeenCalled()

    const streamed = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stream-request' as never,
      name: 'finance_realtime_stream',
      arguments: { symbols: ['BTCUSDT'], max_events: 1 },
    })
    expect(streamed.isError).toBe(false)

    const quotes = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'cmc-quotes-request' as never,
      name: 'finance_coinmarketcap_quotes',
      arguments: { symbols: ['BTC'], convert: 'USD' },
    })
    expect(quotes.isError).toBe(false)

    const macro = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'macro-snapshot' as never,
      name: 'finance_macro_snapshot',
      arguments: { indicators: ['us-10y-yield'], source: 'fred', limit: 2 },
    })
    expect(macro.isError).toBe(false)
    expect(textOfReport(macro)).toContain('4.7')

    const energy = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'macro-eia' as never,
      name: 'finance_macro_snapshot',
      arguments: { indicators: ['eia-crude-stocks'], source: 'eia', limit: 1 },
    })
    expect(energy.isError).toBe(false)
    expect(textOfReport(energy)).toContain('415000')

    const positioning = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'macro-cftc' as never,
      name: 'finance_macro_snapshot',
      arguments: { indicators: ['cftc-gold-net'], source: 'cftc', limit: 1 },
    })
    expect(positioning.isError).toBe(false)
    expect(textOfReport(positioning)).toContain('230338')

    const cmcStreamed = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'cmc-stream-request' as never,
      name: 'finance_realtime_stream',
      arguments: { provider: 'coinmarketcap', crypto_ids: [1], max_events: 1 },
    })
    expect(cmcStreamed.isError).toBe(false)

    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    await new Promise<void>((resolve) => { cmcServer.close(() => { resolve() }) })
    await ctx.fiber.dispose()
    vi.unstubAllGlobals()
  })

  it('registers Python stock tools when the subprocess service is present', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const scope = { get: () => ({ ...CONFIG, enableCoinGeckoRequests: true, enableAlphaVantageRequests: true }), watch: vi.fn() }
    ctx.provide('settings', { register: vi.fn(() => scope), get: vi.fn(() => undefined) } as never)
    const history = {
      symbol: '600519',
      name: '贵州茅台',
      bars: Array.from({ length: 60 }, (_, index) => ({
        timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        open: 10 + index,
        high: 11 + index,
        low: 9 + index,
        close: 10.5 + index,
        volume: 1_000 + index,
      })),
    }
    let payload: object = history
    const payloadFor = (stdin: string): object => {
      if (stdin.includes('stock_valuation')) {
        return {
          symbol: '600519',
          industry: '酒、饮料和精制茶制造业',
          indicators: { peTtm: 19.23, pb: 6.23 },
          industryPe: { date: '2026-09-21', weighted: 18.94 },
        }
      }
      if (stdin.includes('macro_series')) {
        return { function: 'macro_china_pmi', observations: [{ date: '2026-01', value: 50.5 }] }
      }
      if (stdin.includes('stock_fundamentals')) {
        return stdin.includes('000001')
          ? { symbol: '000001', periods: 'not-an-array' }
          : { symbol: '600519', periods: [{ period: '2026-06-30', metrics: { roe: 17.72, revenueGrowth: 1.47 } }] }
      }
      return history
    }
    const handle = {
      collected: {
        stdout: { readFrom: () => ({ text: JSON.stringify({ ok: true, data: payload }), nextOffset: 0, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      done: Promise.resolve({ exitCode: 0, signal: null }),
    } as unknown as SubprocessHandle
    ctx.provide('subprocess', {
      resolveExecutable: async () => '/usr/bin/python3',
      spawn: (request: { readonly stdio?: { readonly stdin?: { readonly data?: string } } }) => {
        payload = payloadFor(request.stdio?.stdin?.data ?? '')
        return handle
      },
    } as never)
    ctx.provide('credentials', { resolve: async () => ({ value: 'credential' }) } as never)
    const requestedUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      requestedUrls.push(url)
      if (url.includes('/coins/bitcoin')) {
        return new Response(JSON.stringify({
          id: 'bitcoin',
          name: 'Bitcoin',
          community_data: { twitter_followers: 7_100_000 },
          links: { repos_url: { github: ['https://github.com/bitcoin/bitcoin'], bitbucket: [] } },
        }), { status: 200 })
      }
      if (url.includes('/repos/bitcoin/bitcoin')) {
        return new Response(JSON.stringify({ name: 'bitcoin', stargazers_count: 85_000, forks_count: 36_000 }), { status: 200 })
      }
      if (url.includes('/quotes/latest')) {
        return new Response(JSON.stringify({
          data: [{ id: 1, name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin', quote: { USD: { price: 60_000 } } }],
        }), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }))
    let route: { fetch: (request: Request) => Promise<Response> } | undefined
    ctx.provide('connection', {
      fetch: { register: (value: typeof route) => { route = value; return () => Promise.resolve() } },
    } as never)

    apply(ctx, CONFIG)
    await Promise.resolve()
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-snapshot' as never,
      name: 'finance_stock_snapshot',
      arguments: { provider: 'akshare', symbol: '600519' },
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('贵州茅台')

    const ifind = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-ifind' as never,
      name: 'finance_stock_snapshot',
      arguments: { provider: 'ifind', symbol: '600519' },
    })
    expect(ifind.isError).toBe(false)

    const akshareRoute = await route?.fetch(new Request(`http://localhost${DASHBOARD_MARKET_PATH}?asset=stock&symbol=600519&provider=akshare`))
    const ifindRoute = await route?.fetch(new Request(`http://localhost${DASHBOARD_MARKET_PATH}?asset=stock&symbol=600519&provider=ifind`))
    expect(akshareRoute?.status).toBe(200)
    expect(ifindRoute?.status).toBe(200)
    expect(await akshareRoute?.text()).toContain('贵州茅台')

    const macro = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'macro-akshare' as never,
      name: 'finance_macro_snapshot',
      arguments: { indicators: ['cn-pmi'], source: 'akshare', limit: 1 },
    })
    expect(macro.isError).toBe(false)
    expect(textOfReport(macro)).toContain('50.5')

    // The A-share report resolves its macro precondition through the same provider.
    const stockReport = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-report' as never,
      name: 'finance_stock_research_report',
      arguments: { provider: 'akshare', symbol: '600519' },
    })
    expect(stockReport.isError).toBe(false)
    expect(textOfReport(stockReport)).toContain('Macro Drivers')
    expect(textOfReport(stockReport)).toContain('Return on equity: 17.72%')
    expect(textOfReport(stockReport)).toContain('P/E (TTM): 19.23')

    // A failing fundamentals read leaves the report intact.
    const withoutFundamentals = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stock-report-gap' as never,
      name: 'finance_stock_research_report',
      arguments: { provider: 'akshare', symbol: '000001' },
    })
    expect(withoutFundamentals.isError).toBe(false)
    expect(textOfReport(withoutFundamentals)).toContain('Valuation Framework')

    // A quoted crypto pair routes through the market quote and then its community page.
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'crypto-report' as never,
      name: 'finance_research_report',
      arguments: { symbol: 'BTC-USD' },
    })
    expect(requestedUrls.some(url => url.includes('/coins/bitcoin'))).toBe(true)
    expect(requestedUrls.some(url => url.includes('/repos/bitcoin/bitcoin'))).toBe(true)
    expect(requestedUrls.some(url => url.includes('/v3/cryptocurrency/quotes/latest'))).toBe(true)

    // A listed ticker routes through the US fundamentals context instead.
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'us-report' as never,
      name: 'finance_research_report',
      arguments: { symbol: 'AAPL' },
    })
    expect(requestedUrls.some(url => url.includes('/stock/profile2'))).toBe(true)
    vi.unstubAllGlobals()
    await ctx.fiber.dispose()
  })

  it('uses the default credential resolver when the credentials service is absent', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const scope = { get: () => CONFIG, watch: vi.fn() }
    ctx.provide('settings', { register: vi.fn(() => scope), get: vi.fn(() => undefined) } as never)

    apply(ctx, CONFIG)
    await Promise.resolve()
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'signed-no-credentials' as never,
      name: 'finance_provider_request',
      arguments: { base: 'binance-spot', path: '/api/v3/account', auth: 'signed' },
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('credentials are not configured')
    await ctx.fiber.dispose()
  })

  it('renders reports in the published locale, stored preference, or explicit language', async () => {
    const fixtureConfig = { ...CONFIG, provider: 'fixture' as const }
    const { uiLocale: _published, ...unpublished } = fixtureConfig
    const publishedScope = { get: () => ({ ...fixtureConfig, uiLocale: 'zh-CN' }), watch: vi.fn() }
    const published = new Context()
    await published.plugin(SystemPrompt)
    await published.plugin(ToolRuntime)
    published.provide('settings', {
      register: vi.fn(() => publishedScope),
      get: vi.fn(() => undefined),
    } as never)
    apply(published, fixtureConfig)
    await vi.waitFor(async () => {
      const result = await published.tools.execute({
        signal: new AbortController().signal,
        callId: 'browser-locale-report' as never,
        name: 'finance_research_report',
        arguments: { symbol: 'AAPL' },
      })
      const report = textOfReport(result)
      expect(report).toContain('股票深度报告')
      return report
    })
    await published.fiber.dispose()

    const preferenceScope = { get: () => unpublished, watch: vi.fn() }
    const localized = new Context()
    await localized.plugin(SystemPrompt)
    await localized.plugin(ToolRuntime)
    localized.provide('settings', {
      register: vi.fn(() => preferenceScope),
      get: vi.fn((ns: string) => ns === 'locale' ? { preference: 'zh' } : undefined),
    } as never)
    apply(localized, unpublished)
    await vi.waitFor(async () => {
      const result = await localized.tools.execute({
        signal: new AbortController().signal,
        callId: 'locale-report' as never,
        name: 'finance_research_report',
        arguments: { symbol: 'AAPL' },
      })
      const report = textOfReport(result)
      expect(report).toContain('股票深度报告')
      return report
    })
    await localized.fiber.dispose()

    const explicitScope = { get: () => ({ ...unpublished, reportLanguage: 'zh' as const }), watch: vi.fn() }
    const explicit = new Context()
    await explicit.plugin(SystemPrompt)
    await explicit.plugin(ToolRuntime)
    explicit.provide('settings', {
      register: vi.fn(() => explicitScope),
      get: vi.fn(() => undefined),
    } as never)
    apply(explicit, { ...unpublished, reportLanguage: 'zh' })
    await vi.waitFor(async () => {
      const result = await explicit.tools.execute({
        signal: new AbortController().signal,
        callId: 'pinned-report' as never,
        name: 'finance_research_report',
        arguments: { symbol: 'AAPL' },
      })
      const report = textOfReport(result)
      expect(report).toContain('股票深度报告')
      return report
    })
    await explicit.fiber.dispose()
  })
})
