/** Browser-side Binance market-data parsing and chart geometry. */

/** One plotted OHLCV bar. */
export interface DashboardBar {
  readonly time: number
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number
}

/**
 * Normalize a user symbol to a Binance Spot pair.
 * @param symbol - User-entered symbol.
 * @returns Upper-case Binance Spot symbol.
 */
export function toBinanceSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase()
  return normalized.endsWith('USDT') ? normalized : `${normalized}USDT`
}

/**
 * Parse Binance kline rows and discard malformed values.
 * @param payload - Upstream JSON payload.
 * @returns Finite dashboard bars.
 */
export function parseKlines(payload: unknown): DashboardBar[] {
  if (!Array.isArray(payload)) return []
  return payload.flatMap((row) => {
    if (!Array.isArray(row) || row.length < 6) return []
    const values = (row as unknown[]).slice(0, 6).map(value => Number(value))
    if (values.some(value => !Number.isFinite(value))) return []
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

function formatCoordinate(value: number): string {
  return Number(value.toFixed(4)).toString()
}

/**
 * Build a compact SVG polyline from bar closes.
 * @param bars - Bars to plot.
 * @param width - Chart width.
 * @param height - Chart height.
 * @returns SVG path data.
 */
export function chartPath(bars: readonly DashboardBar[], width: number, height: number): string {
  if (bars.length === 0) return ''
  const closes = bars.map(bar => bar.close)
  const minimum = Math.min(...closes)
  const maximum = Math.max(...closes)
  const range = maximum - minimum
  const points = closes.map((close, index) => {
    const x = bars.length === 1 ? 0 : index / (bars.length - 1) * width
    const y = range === 0 ? height / 2 : (maximum - close) / range * height
    return `${formatCoordinate(x)} ${formatCoordinate(y)}`
  })
  return `M ${points[0]}${points.slice(1).map(point => ` L ${point}`).join('')}`
}

/**
 * Percent change between the first and latest close.
 * @param bars - Bars to compare.
 * @returns Percent change, or undefined when unavailable.
 */
export function priceChangePercent(bars: readonly DashboardBar[]): number | undefined {
  const first = bars[0]?.close
  const last = bars.at(-1)?.close
  if (first === undefined || last === undefined || first === 0) return undefined
  return (last - first) / first * 100
}
