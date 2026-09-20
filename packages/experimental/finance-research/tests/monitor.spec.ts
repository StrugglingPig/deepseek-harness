import { describe, expect, it } from 'vitest'
import { planFinanceMonitor } from '../src/monitor.ts'

describe('finance monitor planning', () => {
  it('schedules the next pre-market check before the next US trading session', () => {
    const plan = planFinanceMonitor({
      kind: 'pre-market',
      symbol: 'AAPL',
      now: new Date('2026-09-19T14:00:00.000Z'),
    })

    expect(plan.schedule).toEqual({ at: '2026-09-21T13:00:00.000Z' })
    expect(plan.prompt).toContain('AAPL')
    expect(plan.prompt).toContain('after reporting')
  })

  it('schedules after-hours on the same weekday when the close buffer is still ahead', () => {
    const plan = planFinanceMonitor({
      kind: 'after-hours',
      symbol: 'MSFT',
      now: new Date('2026-09-21T14:00:00.000Z'),
    })

    expect(plan.schedule).toEqual({ at: '2026-09-21T20:30:00.000Z' })
  })

  it('moves an after-hours check to the next weekday after the buffer has passed', () => {
    const plan = planFinanceMonitor({
      kind: 'after-hours',
      symbol: 'MSFT',
      now: new Date('2026-09-21T21:30:00.000Z'),
    })

    expect(plan.schedule).toEqual({ at: '2026-09-22T20:30:00.000Z' })
  })

  it('rejects missing symbols, invalid offsets, and unsupported BTC intervals', () => {
    expect(() => planFinanceMonitor({ kind: 'pre-market' })).toThrow('symbol is required')
    expect(() => planFinanceMonitor({ kind: 'pre-market', symbol: 'AAPL', preOpenMinutes: -1 })).toThrow('non-negative')
    expect(() => planFinanceMonitor({ kind: 'after-hours', symbol: 'AAPL', afterCloseMinutes: 1_000 })).toThrow('outside')
    expect(() => planFinanceMonitor({ kind: 'btc-24x7', btcIntervalSeconds: 299 })).toThrow('at least 300')
  })

  it('uses the current time and custom time zone when no clock is supplied', () => {
    const plan = planFinanceMonitor({ kind: 'after-hours', symbol: 'AAPL', timeZone: 'UTC', afterCloseMinutes: 0 })
    if (!('at' in plan.schedule)) throw new Error('expected an absolute schedule')
    expect(plan.schedule.at).toMatch(/T16:00:00\.000Z$/)
  })

  it('schedules BTC 24/7 monitoring on a fixed interval', () => {
    const plan = planFinanceMonitor({
      kind: 'btc-24x7',
      now: new Date('2026-09-21T00:00:00.000Z'),
    })

    expect(plan.schedule).toEqual({ everySeconds: 900 })
    expect(plan.prompt).toContain('BTCUSDT')
    expect(plan.prompt).toContain('material changes only')
  })
})
