import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { registerFinanceTools } from '../src/index.ts'
import type { FinanceMarketDataProvider, FinanceMarketStreamProvider } from '../src/types.ts'

function textOf(result: Awaited<ReturnType<Context['tools']['execute']>>): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('')
}

describe('finance_realtime_stream tool', () => {
  it('collects combined-stream events and renders a compact summary', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const provider: FinanceMarketDataProvider = {
      id: 'fake',
      async load() { throw new Error('not used') },
    }
    const collect = vi.fn(async () => [
      { stream: 'btcusdt@miniTicker', receivedAt: '2026-09-20T10:00:00.000Z', data: { c: '60000' } },
      { stream: 'ethusdt@miniTicker', receivedAt: '2026-09-20T10:00:00.000Z', data: { c: '3000' } },
    ] satisfies Awaited<ReturnType<FinanceMarketStreamProvider['collect']>>)
    registerFinanceTools(ctx, provider, { collect })

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stream' as never,
      name: 'finance_realtime_stream',
      arguments: { symbols: ['BTCUSDT', 'ETHUSDT'], stream_type: 'miniTicker', max_events: 2 },
    })

    expect(result.isError).toBe(false)
    expect(collect).toHaveBeenCalledWith({
      streams: ['btcusdt@miniTicker', 'ethusdt@miniTicker'],
      maxEvents: 2,
    }, expect.any(AbortSignal))
    expect(textOf(result)).toContain('2 real-time events from 2 streams')
  })

  it('defaults the stream type and passes an optional timeout', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const collect = vi.fn(async () => [])
    registerFinanceTools(ctx, { id: 'fake', async load() { throw new Error('not used') } }, { collect })

    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stream-defaults' as never,
      name: 'finance_realtime_stream',
      arguments: { symbols: ['BTCUSDT'], timeout_ms: 50 },
    })

    expect(collect).toHaveBeenCalledWith({ streams: ['btcusdt@miniTicker'], timeoutMs: 50 }, expect.any(AbortSignal))
  })

  it('rejects an empty symbol list before opening a socket', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const collect = vi.fn()
    registerFinanceTools(ctx, { id: 'fake', async load() { throw new Error('not used') } }, { collect })

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'stream-empty' as never,
      name: 'finance_realtime_stream',
      arguments: { symbols: [] },
    })

    expect(result.isError).toBe(true)
    expect(collect).not.toHaveBeenCalled()
  })
})
