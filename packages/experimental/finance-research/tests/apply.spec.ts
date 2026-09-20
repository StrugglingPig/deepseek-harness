import { Context } from '@deepseek-ai/cordis'
import { WebSocketServer } from 'ws'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { apply, BINANCE_API_KEY_REF, COINMARKETCAP_API_KEY_REF } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { FinanceRuntimeSettings } from '../src/settings-provider.ts'

const CONFIG: Required<Config> = {
  provider: 'http',
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
  coinMarketCapBaseUrl: 'https://pro-api.test',
  requestCacheTtlMs: 0,
  requestCacheMaxEntries: 10,
  requestMaxRetries: 0,
  requestRetryBaseDelayMs: 1,
  requestRetryMaxDelayMs: 1,
  requestsPerMinute: 60,
  requestBurst: 1,
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
    ctx.provide('settings', { register } as never)
    const resolve = vi.fn(async (ref: string) => ({
      value: ref === BINANCE_API_KEY_REF ? 'api-key'
        : ref === COINMARKETCAP_API_KEY_REF ? 'cmc-key'
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
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/quotes/latest')) {
        return new Response(JSON.stringify({ data: [{ id: 1, name: 'Bitcoin', symbol: 'BTC', quote: { USD: { price: 60_000 } } }] }), { status: 200 })
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

  it('uses the default credential resolver when the credentials service is absent', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const scope = { get: () => CONFIG, watch: vi.fn() }
    ctx.provide('settings', { register: vi.fn(() => scope) } as never)

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
})
