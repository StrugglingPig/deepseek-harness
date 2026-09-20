/** Host-side market data for the Web finance dashboard. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { FinanceDataError } from './error.ts'
import type {
  FinanceProviderRequest,
  FinanceProviderResponse,
  FinanceStockProviderId,
  FinanceStockSnapshot,
  MarketBar,
} from './types.ts'

/** Asset families supported by the dashboard. */
export type DashboardAsset = 'crypto' | 'stock' | 'us'

/** Chart intervals supported by the dashboard. */
export type DashboardInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w' | '1M'

/** One normalized dashboard candlestick. */
export interface DashboardBar {
  readonly time: number
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number
}

/** One normalized quote displayed above the chart. */
export interface DashboardQuote {
  readonly price: number
  readonly changePercent: number
  readonly volume: number
  readonly currency: string
}

/** One dashboard market response. */
export interface DashboardMarketResponse {
  readonly asset: DashboardAsset
  readonly symbol: string
  readonly name: string
  readonly interval: DashboardInterval
  readonly source: string
  readonly asOf: string
  readonly bars: readonly DashboardBar[]
  readonly quote: DashboardQuote
}

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
    const values = item.slice(0, 6).map(finite)
    if (values.some(value => value === undefined)) return []
    return [{
      time: values[0] as number,
      open: values[1] as number,
      high: values[2] as number,
      low: values[3] as number,
      close: values[4] as number,
      volume: values[5] as number,
    }]
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

/** Parse one dashboard request URL. */
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

/** Load one normalized dashboard response. */
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
    return {
      asset: request.asset,
      symbol: request.symbol,
      name: parsed.name,
      interval: request.interval,
      source: 'yahoo-finance',
      asOf: new Date((parsed.bars.at(-1) as DashboardBar).time).toISOString(),
      bars: parsed.bars,
      quote: quoteFromBars(parsed.bars, parsed.currency),
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

/** Register the authenticated-origin dashboard market route. */
export function registerFinanceDashboardRoutes(ctx: Context, deps: DashboardRouteDependencies): void {
  ctx.inject(['webServer'], webCtx => webCtx.webServer.register({
    kind: 'exact',
    path: '/api/finance-dashboard/market',
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }))
        return
      }
      try {
        const request = parseDashboardRequest(new URL(req.url ?? '/', 'http://127.0.0.1'))
        const body = await loadDashboardMarket(request, deps)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(body satisfies DashboardMarketResponse))
      } catch (error) {
        const failure = error instanceof FinanceDataError
          ? { code: error.code, message: error.message }
          : { code: 'DASHBOARD_FAILED', message: String(error) }
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: failure }))
      }
    },
  }))
}
