import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { registerFinanceTools } from '../src/index.ts'

function textOf(result: Awaited<ReturnType<Context['tools']['execute']>>): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('')
}

describe('CoinMarketCap tools', () => {
  it('normalizes quote and OHLCV requests for the model', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const loadCoinMarketCapQuotes = vi.fn(async () => [{
      id: 1, name: 'Bitcoin', symbol: 'BTC', currency: 'USD', price: 60_000,
    }, {
      id: 1027,
      name: 'Ethereum',
      symbol: 'ETH',
      slug: 'ethereum',
      rank: 2,
      currency: 'USD',
      price: 3_000,
      percentChange24h: -1.5,
      marketCap: 360_000,
      volume24h: 15_000,
      lastUpdated: '2026-09-20T10:00:00.000Z',
    }, {
      id: 2, name: 'Litecoin', symbol: 'LTC', currency: 'USD',
    }])
    const loadCoinMarketCapOhlcv = vi.fn(async () => [{
      id: 1,
      name: 'Bitcoin',
      symbol: 'BTC',
      currency: 'USD',
      bars: [{ timestamp: '2026-09-19T00:00:00.000Z', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }],
    }])
    registerFinanceTools(ctx, {
      id: 'cmc',
      async load() { throw new Error('not used') },
      loadCoinMarketCapQuotes,
      loadCoinMarketCapOhlcv,
    })

    const quotes = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'cmc-quotes' as never,
      name: 'finance_coinmarketcap_quotes',
      arguments: { id: 1, ids: [1], symbols: ['BTC'], convert: 'usd' },
    })
    expect(quotes.isError).toBe(false)
    expect(textOf(quotes)).toBe('3 CoinMarketCap quote(s)')
    expect(loadCoinMarketCapQuotes).toHaveBeenCalledWith({ id: 1, ids: [1], symbols: ['BTC'], convert: 'usd' }, expect.any(AbortSignal))
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'cmc-quotes-empty' as never,
      name: 'finance_coinmarketcap_quotes',
      arguments: {},
    })
    expect(loadCoinMarketCapQuotes).toHaveBeenLastCalledWith({}, expect.any(AbortSignal))

    const ohlcv = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'cmc-ohlcv' as never,
      name: 'finance_coinmarketcap_ohlcv',
      arguments: {
        id: 1, ids: [1], symbols: ['BTC'], convert: 'usd', time_start: '2026-09-01T00:00:00.000Z',
        time_end: '2026-09-20T00:00:00.000Z', count: 20, interval: '1d',
      },
    })
    expect(ohlcv.isError).toBe(false)
    expect(textOf(ohlcv)).toBe('1 CoinMarketCap OHLCV series')
    expect(loadCoinMarketCapOhlcv).toHaveBeenCalledWith({
      id: 1, ids: [1], symbols: ['BTC'], convert: 'usd',
      timeStart: '2026-09-01T00:00:00.000Z', timeEnd: '2026-09-20T00:00:00.000Z', count: 20, interval: '1d',
    }, expect.any(AbortSignal))
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'cmc-ohlcv-empty' as never,
      name: 'finance_coinmarketcap_ohlcv',
      arguments: {},
    })
    expect(loadCoinMarketCapOhlcv).toHaveBeenLastCalledWith({}, expect.any(AbortSignal))
  })

  it('collects CoinMarketCap latest-price stream events', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const collect = vi.fn(async () => [{
      provider: 'coinmarketcap' as const,
      stream: 'market@crypto_latest_price',
      receivedAt: '2026-09-20T10:00:00.000Z',
      data: { cid: 1, p: 60_000 },
    }])
    registerFinanceTools(ctx, { id: 'fake', async load() { throw new Error('not used') } }, { collect })

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'cmc-stream' as never,
      name: 'finance_realtime_stream',
      arguments: { provider: 'coinmarketcap', crypto_ids: [1], max_events: 1 },
    })

    expect(result.isError).toBe(false)
    expect(collect).toHaveBeenCalledWith({
      provider: 'coinmarketcap', streams: [], cryptoIds: [1], maxEvents: 1,
    }, expect.any(AbortSignal))
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'cmc-stream-timeout' as never,
      name: 'finance_realtime_stream',
      arguments: { provider: 'coinmarketcap', crypto_ids: [1], timeout_ms: 10 },
    })
    expect(collect).toHaveBeenLastCalledWith({
      provider: 'coinmarketcap', streams: [], cryptoIds: [1], timeoutMs: 10,
    }, expect.any(AbortSignal))
    expect(textOf(result)).toContain('1 real-time events')
  })

  it('rejects missing CoinMarketCap IDs before collection', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const collect = vi.fn()
    registerFinanceTools(ctx, { id: 'fake', async load() { throw new Error('not used') } }, { collect })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'cmc-stream-missing' as never,
      name: 'finance_realtime_stream',
      arguments: { provider: 'coinmarketcap' },
    })
    expect(result.isError).toBe(true)
    expect(collect).not.toHaveBeenCalled()
  })
})
