import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { fixtureProvider } from '../src/data.ts'
import { registerFinanceTools } from '../src/index.ts'

describe('finance research report language default', () => {
  it('writes English when no report-language resolver is supplied', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    registerFinanceTools(ctx, fixtureProvider)

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'default-language-report' as never,
      name: 'finance_research_report',
      arguments: { symbol: 'AAPL' },
    })

    expect(result.isError).toBe(false)
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('Apple Inc. (AAPL) research report')
    expect(text).toContain('## Investor Lenses')
    await ctx.fiber.dispose()
  })
})

describe('finance_monitor_plan tool', () => {
  it('returns schedule_create arguments for the requested monitor', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    registerFinanceTools(ctx, { id: 'fake', async load() { throw new Error('not used') } })

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'monitor' as never,
      name: 'finance_monitor_plan',
      arguments: { kind: 'btc-24x7', btc_interval_seconds: 600 },
    })

    const value = result.value as { kind: string; schedule: { every_seconds: number }; prompt: string }
    expect(result.isError).toBe(false)
    expect(value.kind).toBe('btc-24x7')
    expect(value.schedule.every_seconds).toBe(600)
    expect(value.prompt).toContain('BTCUSDT')
  })

  it('returns a pre-market and an after-hours schedule with explicit offsets', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    registerFinanceTools(ctx, { id: 'fake', async load() { throw new Error('not used') } })

    const pre = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'monitor-pre' as never,
      name: 'finance_monitor_plan',
      arguments: { kind: 'pre-market', symbol: 'AAPL', pre_open_minutes: 15, time_zone: 'UTC' },
    })
    const preValue = pre.value as { kind: string; symbol: string; schedule: { at: string } }
    expect(pre.isError).toBe(false)
    expect(preValue).toMatchObject({ kind: 'pre-market', symbol: 'AAPL' })
    expect(preValue.schedule.at).toContain('T')

    const after = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'monitor-after' as never,
      name: 'finance_monitor_plan',
      arguments: { kind: 'after-hours', symbol: 'MSFT', after_close_minutes: 45, time_zone: 'UTC' },
    })
    const afterValue = after.value as { kind: string; symbol: string; schedule: { at: string } }
    expect(after.isError).toBe(false)
    expect(afterValue).toMatchObject({ kind: 'after-hours', symbol: 'MSFT' })
    expect(afterValue.schedule.at).toContain('T')
  })

  it('rejects an invalid pre-market offset as a tool error', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    registerFinanceTools(ctx, { id: 'fake', async load() { throw new Error('not used') } })

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'monitor-invalid' as never,
      name: 'finance_monitor_plan',
      arguments: { kind: 'pre-market', symbol: 'AAPL', pre_open_minutes: -1 },
    })

    expect(result.isError).toBe(true)
  })
})
