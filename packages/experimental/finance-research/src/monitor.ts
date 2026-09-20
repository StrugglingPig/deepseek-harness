/** Deterministic plans for pre-market, after-hours, and BTC 24/7 monitoring. */

import { FinanceDataError } from './error.ts'

const DEFAULT_PRE_OPEN_MINUTES = 30
const DEFAULT_AFTER_CLOSE_MINUTES = 30
const DEFAULT_BTC_INTERVAL_SECONDS = 900

/** Monitoring cadence owned by the finance package. */
export type FinanceMonitorKind = 'pre-market' | 'after-hours' | 'btc-24x7'

/** One requested monitoring plan. */
export interface FinanceMonitorPlanRequest {
  /** Monitoring cadence. */
  readonly kind: FinanceMonitorKind
  /** Instrument symbol for pre-market and after-hours plans. */
  readonly symbol?: string
  /** Minutes before the US regular-session open. */
  readonly preOpenMinutes?: number
  /** Minutes after the US regular-session close. */
  readonly afterCloseMinutes?: number
  /** BTC fixed-rate interval in seconds. */
  readonly btcIntervalSeconds?: number
  /** IANA time zone used for US session boundaries. */
  readonly timeZone?: string
  /** Planning clock. */
  readonly now?: Date
}

/** One deterministic plan that can be passed to Schedule's `schedule_create` tool. */
export interface FinanceMonitorPlan {
  readonly kind: FinanceMonitorKind
  readonly symbol?: string
  readonly schedule:
    | { readonly at: string }
    | { readonly everySeconds: number }
  readonly prompt: string
}

interface LocalParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

function localParts(date: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const values = new Map(formatter.formatToParts(date).map(part => [part.type, part.value]))
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')) % 24,
    minute: Number(values.get('minute')),
    second: Number(values.get('second')),
  }
}

function offsetMilliseconds(date: Date, timeZone: string): number {
  const parts = localParts(date, timeZone)
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime()
}

function localToUtc(parts: Omit<LocalParts, 'second'>, timeZone: string): Date {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  let candidate = target
  for (let iteration = 0; iteration < 3; iteration += 1) {
    candidate = target - offsetMilliseconds(new Date(candidate), timeZone)
  }
  return new Date(candidate)
}

function timeOfDay(totalMinutes: number): { readonly hour: number; readonly minute: number } {
  return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 }
}

function nextWeekdayAt(
  now: Date,
  timeZone: string,
  minuteOfDay: number,
): Date {
  const current = localParts(now, timeZone)
  for (let offset = 0; offset <= 7; offset += 1) {
    const calendar = new Date(Date.UTC(current.year, current.month - 1, current.day + offset))
    const weekday = calendar.getUTCDay()
    if (weekday === 0 || weekday === 6) continue
    const time = timeOfDay(minuteOfDay)
    const candidate = localToUtc({
      year: calendar.getUTCFullYear(),
      month: calendar.getUTCMonth() + 1,
      day: calendar.getUTCDate(),
      ...time,
    }, timeZone)
    if (candidate.getTime() > now.getTime()) return candidate
  }
  /* v8 ignore next -- a seven-day inclusive scan always contains a weekday. */
  throw new FinanceDataError('could not resolve the next US trading weekday', 'MONITOR_PLAN_FAILED')
}

function nonNegativeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FinanceDataError(`${name} must be a non-negative safe integer`, 'INVALID_MONITOR_PLAN')
  }
  return value
}

/**
 * Build one deterministic monitoring plan for scheduler integration.
 * @param request - Cadence, symbol, offsets, interval, time zone, and clock.
 * @returns A schedule argument and monitor prompt.
 */
export function planFinanceMonitor(request: FinanceMonitorPlanRequest): FinanceMonitorPlan {
  if (request.kind === 'btc-24x7') {
    const interval = request.btcIntervalSeconds ?? DEFAULT_BTC_INTERVAL_SECONDS
    if (!Number.isSafeInteger(interval) || interval < 300) {
      throw new FinanceDataError('btcIntervalSeconds must be a safe integer of at least 300 seconds', 'INVALID_MONITOR_PLAN')
    }
    return {
      kind: request.kind,
      schedule: { everySeconds: interval },
      prompt: 'BTC 24/7 monitor: call finance_realtime_stream for BTCUSDT and finance_technical_analysis for BTC; report material changes only.',
    }
  }

  const symbol = request.symbol?.trim().toUpperCase()
  if (symbol === undefined || symbol.length === 0) {
    throw new FinanceDataError('symbol is required for pre-market and after-hours monitoring', 'INVALID_MONITOR_PLAN')
  }
  const timeZone = request.timeZone ?? 'America/New_York'
  const offset = request.kind === 'pre-market'
    ? nonNegativeInteger('preOpenMinutes', request.preOpenMinutes ?? DEFAULT_PRE_OPEN_MINUTES)
    : nonNegativeInteger('afterCloseMinutes', request.afterCloseMinutes ?? DEFAULT_AFTER_CLOSE_MINUTES)
  const minuteOfDay = request.kind === 'pre-market'
    ? 9 * 60 + 30 - offset
    : 16 * 60 + offset
  if (minuteOfDay < 0 || minuteOfDay >= 24 * 60) {
    throw new FinanceDataError('monitor offset moved outside the local day', 'INVALID_MONITOR_PLAN')
  }
  const at = nextWeekdayAt(request.now ?? new Date(), timeZone, minuteOfDay)
  const label = request.kind === 'pre-market' ? 'Pre-market' : 'After-hours'
  return {
    kind: request.kind,
    symbol,
    schedule: { at: at.toISOString() },
    prompt: `${label} monitor for ${symbol}: call finance_market_snapshot and finance_technical_analysis and summarize material changes; after reporting, schedule the next ${request.kind} check with schedule_create.`,
  }
}

/** Whole-minute constants used by the plan tool's schema descriptions. */
export const MONITOR_MINIMUM_BTC_INTERVAL_SECONDS = 300
/** Default BTC cadence in seconds. */
export const MONITOR_DEFAULT_BTC_INTERVAL_SECONDS = DEFAULT_BTC_INTERVAL_SECONDS
