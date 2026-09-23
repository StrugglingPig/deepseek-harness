/** Host-side market data for the Web finance dashboard. */

import { usMetricsFromFundamentals } from './asset-context.ts'
import { buildValuation, buildValuationInputs, type ValuationParameters } from './valuation.ts'
import type { ValuationValidation } from './backtest.ts'
import type { FinanceMarketDataProvider } from './types.ts'


import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { FinanceDataError } from './error.ts'
import {
  DASHBOARD_MARKET_PATH,
  type DashboardResearch,
  barFromRow,
  type DashboardAsset,
  type DashboardBar,
  type DashboardInterval,
  type DashboardMarketResponse,
  type DashboardQuote,
} from './shared.ts'
import type {
  FinanceProviderRequest,
  FinanceProviderResponse,
  FinanceStockProviderId,
  FinanceStockSnapshot,
  MarketBar,
} from './types.ts'

/** Provider surface required by the dashboard route. */
export interface DashboardMarketProvider {
  request(request: FinanceProviderRequest, signal?: AbortSignal): Promise<FinanceProviderResponse>
}

/** Stock provider surface required by the dashboard route. */
export interface DashboardStockProvider {
  loadStockSnapshot(
    request: { readonly provider: FinanceStockProviderId; readonly symbol: string; readonly startDate?: string; readonly endDate?: string; readonly adjust?: 'none' | 'qfq' | 'hfq' },
    signal?: AbortSignal,
  ): Promise<FinanceStockSnapshot>
}

/** Dependencies and clocks owned by the dashboard route. */
export interface DashboardRouteDependencies {
  readonly market: DashboardMarketProvider
  readonly stock: () => DashboardStockProvider | undefined
  readonly enabledStock: (provider: FinanceStockProviderId) => boolean
  /** Loads the research summary the dashboard shows beside a US equity chart. */
  readonly research?: (symbol: string, price: number, signal?: AbortSignal) => Promise<DashboardResearch | undefined>
  readonly now?: () => Date
}

const INTERVALS = new Set<DashboardInterval>(['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'])

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function finite(value: unknown): number | undefined {
  const result = Number(value)
  return Number.isFinite(result) ? result : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function rows(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const row = record(item)
    return row === undefined ? [] : [row]
  }) : []
}

function percent(first: number, last: number): number {
  return first === 0 ? 0 : (last - first) / first * 100
}

function quoteFromBars(bars: readonly DashboardBar[], currency: string): DashboardQuote {
  const latest = bars.at(-1) as DashboardBar
  const previous = bars.at(-2)
  return {
    price: latest.close,
    changePercent: previous === undefined ? 0 : percent(previous.close, latest.close),
    volume: latest.volume,
    currency,
  }
}

function parseCryptoBars(payload: unknown): DashboardBar[] {
  if (!Array.isArray(payload)) return []
  return payload.flatMap((item) => {
    if (!Array.isArray(item) || item.length < 6) return []
    const bar = barFromRow(item)
    return bar === undefined ? [] : [bar]
  })
}

function parseYahooBars(payload: unknown): { readonly bars: readonly DashboardBar[]; readonly name: string; readonly currency: string } {
  const chart = record(record(payload)?.chart)
  const result = Array.isArray(chart?.result) ? record(chart.result[0]) : undefined
  if (result === undefined) throw new FinanceDataError('Yahoo returned no chart result', 'DASHBOARD_EMPTY')
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : []
  const quote = rows(record(result.indicators)?.quote)[0]
  const opens = Array.isArray(quote?.open) ? quote.open : []
  const highs = Array.isArray(quote?.high) ? quote.high : []
  const lows = Array.isArray(quote?.low) ? quote.low : []
  const closes = Array.isArray(quote?.close) ? quote.close : []
  const volumes = Array.isArray(quote?.volume) ? quote.volume : []
  const bars = timestamps.flatMap((timestamp, index) => {
    const time = finite(timestamp)
    const open = finite(opens[index])
    const high = finite(highs[index])
    const low = finite(lows[index])
    const close = finite(closes[index])
    const volume = finite(volumes[index])
    if (time === undefined || open === undefined || high === undefined || low === undefined
      || close === undefined || volume === undefined) return []
    // Yahoo publishes the in-progress session with zero prices before its first print, which would
    // otherwise become a zero close and a −100% change on the dashboard.
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return []
    return [{ time: time * 1_000, open, high, low, close, volume }]
  })
  if (bars.length === 0) throw new FinanceDataError('Yahoo returned no complete bars', 'DASHBOARD_EMPTY')
  const meta = record(result.meta)
  const name = stringValue(meta?.longName) ?? stringValue(meta?.shortName) ?? 'Equity'
  const currency = stringValue(meta?.currency) ?? 'USD'
  return { bars, name, currency }
}

function yahooRange(interval: DashboardInterval): string {
  if (interval === '1m' || interval === '5m' || interval === '15m') return '5d'
  if (interval === '1h') return '3mo'
  return '2y'
}

function aggregateBars(bars: readonly DashboardBar[], interval: DashboardInterval): DashboardBar[] {
  if (interval === '1d') return [...bars]
  const unit = interval === '1w' ? 7 * 24 * 60 * 60 * 1_000 : 30 * 24 * 60 * 60 * 1_000
  const grouped: DashboardBar[] = []
  for (const bar of bars) {
    const latest = grouped.at(-1)
    if (latest === undefined || bar.time - latest.time >= unit) {
      grouped.push({ ...bar })
    } else {
      grouped[grouped.length - 1] = {
        time: latest.time,
        open: latest.open,
        high: Math.max(latest.high, bar.high),
        low: Math.min(latest.low, bar.low),
        close: bar.close,
        volume: latest.volume + bar.volume,
      }
    }
  }
  return grouped
}

function startDate(now: Date, interval: DashboardInterval, limit: number): string {
  const days = interval === '1M' ? limit * 31 : interval === '1w' ? limit * 7 : Math.max(365, limit * 2)
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
}

/**
 * Parse one dashboard request URL.
 * @param url - Request URL carrying asset, symbol, interval, limit, and provider.
 * @returns The normalized dashboard request.
 */
export function parseDashboardRequest(url: URL): {
  readonly asset: DashboardAsset
  readonly symbol: string
  readonly interval: DashboardInterval
  readonly limit: number
  readonly provider: FinanceStockProviderId
} {
  const asset = stringValue(url.searchParams.get('asset')) ?? 'crypto'
  if (asset !== 'crypto' && asset !== 'stock' && asset !== 'us') {
    throw new FinanceDataError('asset must be crypto, stock, or us', 'DASHBOARD_INVALID_REQUEST')
  }
  const symbol = stringValue(url.searchParams.get('symbol'))
  if (symbol === undefined) throw new FinanceDataError('symbol is required', 'DASHBOARD_INVALID_REQUEST')
  const interval = stringValue(url.searchParams.get('interval')) ?? '1d'
  if (!INTERVALS.has(interval as DashboardInterval)) {
    throw new FinanceDataError('unsupported dashboard interval', 'DASHBOARD_INVALID_REQUEST')
  }
  const limitValue = finite(url.searchParams.get('limit')) ?? 240
  const limit = Math.max(30, Math.min(1_000, Math.trunc(limitValue)))
  const provider = stringValue(url.searchParams.get('provider')) ?? 'akshare'
  if (provider !== 'akshare' && provider !== 'ifind') {
    throw new FinanceDataError('stock provider must be akshare or ifind', 'DASHBOARD_INVALID_REQUEST')
  }
  return { asset, symbol: symbol.toUpperCase(), interval: interval as DashboardInterval, limit, provider }
}

/**
 * Build the research loader the US equity route calls.
 * @param provider - Market-data provider carrying the settings-backed US fundamentals seam.
 * @param parameters - Reads the valuation parameters the current settings resolve to.
 * @param validation - Recorded backtest evidence that decides the wording.
 * @returns A loader that answers one summary per symbol, or undefined when the provider cannot answer.
 */
export function dashboardResearchLoader(
  provider: FinanceMarketDataProvider,
  parameters: () => ValuationParameters,
  validation: ValuationValidation,
): (symbol: string, price: number, signal?: AbortSignal) => Promise<DashboardResearch | undefined> {
  return async (symbol, price, signal) => {
    if (provider.loadUsFundamentals === undefined) return undefined
    const fundamentals = await provider.loadUsFundamentals({ symbol }, signal)
    if (fundamentals === undefined) return undefined
    const analysis = buildValuation(
      buildValuationInputs(usMetricsFromFundamentals(fundamentals), [], price),
      parameters(),
      validation,
    )
    const value = analysis.value
    return {
      source: 'finnhub',
      reportedPeriod: fundamentals.reportedFinancials ?? '',
      label: analysis.label,
      grade: analysis.quality.grade,
      action: value === undefined ? undefined : analysis.verdict.action,
      nextEarnings: fundamentals.nextEarnings,
      range: value === undefined ? undefined : {
        low: value.lowValuePerShare,
        high: value.highValuePerShare,
        weighted: value.weightedValuePerShare,
      },
      ratios: analysis.ratios.map(reading => ({ id: reading.id, value: reading.value })),
    }
  }
}

/**
 * Load one normalized dashboard response.
 * @param request - Parsed dashboard request.
 * @param deps - Market and stock providers owned by the route.
 * @param signal - Optional cancellation signal.
 * @returns The normalized market response.
 */
export async function loadDashboardMarket(
  request: ReturnType<typeof parseDashboardRequest>,
  deps: DashboardRouteDependencies,
  signal?: AbortSignal,
): Promise<DashboardMarketResponse> {
  const now = deps.now ?? (() => new Date())
  if (request.asset === 'crypto') {
    const pair = request.symbol.endsWith('USDT') ? request.symbol : `${request.symbol}USDT`
    const response = await deps.market.request({
      base: 'binance-spot',
      path: '/api/v3/klines',
      query: { symbol: pair, interval: request.interval, limit: request.limit },
    }, signal)
    const bars = parseCryptoBars(response.data)
    if (bars.length === 0) throw new FinanceDataError('Binance returned no complete bars', 'DASHBOARD_EMPTY')
    return {
      asset: request.asset,
      symbol: pair,
      name: pair,
      interval: request.interval,
      source: 'binance-spot',
      asOf: new Date((bars.at(-1) as DashboardBar).time).toISOString(),
      bars,
      quote: quoteFromBars(bars, 'USDT'),
    }
  }
  if (request.asset === 'us') {
    const response = await deps.market.request({
      base: 'yahoo',
      path: `/v8/finance/chart/${encodeURIComponent(request.symbol)}`,
      query: { range: yahooRange(request.interval), interval: request.interval === '1M' ? '1mo' : request.interval },
    }, signal)
    const parsed = parseYahooBars(response.data)
    const quote = quoteFromBars(parsed.bars, parsed.currency)
    // A failing research read leaves the chart mounted without its summary strip.
    const research = deps.research === undefined
      ? undefined
      : await deps.research(request.symbol, quote.price, signal).catch(() => undefined)
    return {
      asset: request.asset,
      symbol: request.symbol,
      name: parsed.name,
      interval: request.interval,
      source: 'yahoo-finance',
      asOf: new Date((parsed.bars.at(-1) as DashboardBar).time).toISOString(),
      bars: parsed.bars,
      quote,
      ...research === undefined ? {} : { research },
    }
  }
  const stock = deps.stock()
  if (stock === undefined) throw new FinanceDataError('stock provider is not available', 'DASHBOARD_UNAVAILABLE')
  if (!deps.enabledStock(request.provider)) {
    throw new FinanceDataError(`${request.provider} stock data is disabled in settings`, 'STOCK_PROVIDER_DISABLED')
  }
  const snapshot = await stock.loadStockSnapshot({
    provider: request.provider,
    symbol: request.symbol,
    startDate: startDate(now(), request.interval, request.limit),
    endDate: now().toISOString().slice(0, 10),
    adjust: 'qfq',
  }, signal)
  const bars = aggregateBars(snapshot.bars.map((bar: MarketBar) => ({
    time: Date.parse(bar.timestamp),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  })), request.interval)
  if (bars.length === 0) throw new FinanceDataError('stock provider returned no complete bars', 'DASHBOARD_EMPTY')
  return {
    asset: request.asset,
    symbol: snapshot.instrument.symbol,
    name: snapshot.instrument.name,
    interval: request.interval,
    source: snapshot.source.provider,
    asOf: snapshot.asOf,
    bars,
    quote: quoteFromBars(bars, snapshot.instrument.currency),
  }
}

/**
 * Register the dashboard market route inside Connection's authentication fence.
 * @param ctx - Context that receives the route registration.
 * @param deps - Market and stock providers owned by the route.
 */
export function registerFinanceDashboardRoutes(ctx: Context, deps: DashboardRouteDependencies): void {
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.fetch.register({
      path: DASHBOARD_MARKET_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const headers = { 'cache-control': 'no-store' }
        try {
          const body = await loadDashboardMarket(parseDashboardRequest(new URL(request.url)), deps, request.signal)
          return Response.json(body satisfies DashboardMarketResponse, { headers })
        } catch (error) {
          const failure = error instanceof FinanceDataError
            ? { code: error.code, message: error.message }
            : { code: 'DASHBOARD_FAILED', message: String(error) }
          return Response.json({ error: failure }, { status: 400, headers })
        }
      },
    })
  })
}
