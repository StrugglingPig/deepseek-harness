/** Lightweight TradingView-style chart with an SVG fallback for tests and unsupported canvases. */

import { useEffect, useRef, useState } from 'react'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import {
  atr, bias, bollinger, cci, chartPath, dmi, ema, kdj, macd, obv, rsi, sar, sma, tdSequential, vwap, wr,
  type DashboardBar, type DashboardInterval, type IndicatorPoint,
} from './market-data.ts'
import { chartHeight, indicatorPaneCount, indicatorValue, type ResolvedIndicator } from './indicators.ts'
import css from './FinanceDashboard.module.css'

/** Props for the live finance chart. */
export interface TradingChartProps {
  readonly bars: readonly DashboardBar[]
  readonly interval: DashboardInterval
  readonly chartLabel: string
  readonly indicators: readonly ResolvedIndicator[]
}

/** Band and oscillator colours, kept apart from the candle red/green pair. */
const COLORS = {
  sma: '#2563eb',
  ema: '#f59e0b',
  boll: '#8b5cf6',
  band: 'rgba(139, 92, 246, 0.55)',
  rsi: '#8b5cf6',
  macd: '#0ea5e9',
  signal: '#f97316',
  k: '#0ea5e9',
  d: '#f97316',
  j: '#8b5cf6',
  sar: '#0d9488',
  vwap: '#db2777',
  wr: '#0ea5e9',
  cci: '#f97316',
  bias: '#8b5cf6',
  obv: '#0d9488',
  atr: '#f97316',
  plusDi: '#db2777',
  minusDi: '#0ea5e9',
  adx: '#f59e0b',
  tdBuy: '#16a34a',
  tdSell: '#dc2626',
} as const

function canvasAvailable(): boolean {
  if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return false
  try {
    return document.createElement('canvas').getContext('2d') !== null
  } catch {
    return false
  }
}

function lineData(points: readonly IndicatorPoint[]): { time: never; value: number }[] {
  return points.map(point => ({ time: Math.floor(point.time / 1_000) as never, value: point.value }))
}

/**
 * Render one interactive chart, falling back to SVG when canvas is unavailable.
 * @param props - Bars, interval, enabled indicators, and accessible label.
 * @returns The chart container.
 */
export function TradingChart(props: TradingChartProps) {
  const container = useRef<HTMLDivElement>(null)
  const [native, setNative] = useState(false)
  const paneCount = indicatorPaneCount(props.indicators)
  const signature = props.indicators
    .map(indicator => `${indicator.id}:${indicator.spec.parameters.map(parameter => indicator.values[parameter.key]).join(',')}`)
    .join('|')

  useEffect(() => {
    const element = container.current
    if (element === null || props.bars.length === 0 || !canvasAvailable()) return
    let disposed = false
    let remove: (() => void) | undefined
    void import('lightweight-charts').then((charts) => {
      if (disposed || container.current === null) return
      element.replaceChildren()
      const chart = charts.createChart(element, {
        autoSize: true,
        layout: {
          background: { color: 'transparent' },
          textColor: '#64748b',
          fontFamily: 'inherit',
        },
        grid: {
          vertLines: { color: 'rgba(148, 163, 184, 0.22)' },
          horzLines: { color: 'rgba(148, 163, 184, 0.22)' },
        },
        crosshair: { mode: charts.CrosshairMode.Normal },
        // The chart fills most of the panel, so a wheel over it must scroll the
        // panel rather than being swallowed for chart zoom. Panning (drag) and
        // axis scaling stay available.
        handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: true, timeVisible: true, secondsVisible: false, rightOffset: 2 },
      })
      const candle = chart.addSeries(charts.CandlestickSeries, {
        upColor: '#16a34a',
        downColor: '#dc2626',
        borderUpColor: '#16a34a',
        borderDownColor: '#dc2626',
        wickUpColor: '#16a34a',
        wickDownColor: '#dc2626',
      })
      candle.setData(props.bars.map(bar => ({
        time: Math.floor(bar.time / 1_000) as never,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })))
      let pane = 1
      for (const indicator of props.indicators) {
        switch (indicator.id) {
          case 'sma':
            chart.addSeries(charts.LineSeries, { color: COLORS.sma, lineWidth: 2, priceLineVisible: false }, 0)
              .setData(lineData(sma(props.bars, indicatorValue(indicator, 'period'))))
            break
          case 'ema':
            chart.addSeries(charts.LineSeries, { color: COLORS.ema, lineWidth: 2, priceLineVisible: false }, 0)
              .setData(lineData(ema(props.bars, indicatorValue(indicator, 'period'))))
            break
          case 'boll': {
            const bands = bollinger(props.bars, indicatorValue(indicator, 'period'), indicatorValue(indicator, 'multiplier'))
            chart.addSeries(charts.LineSeries, { color: COLORS.boll, lineWidth: 1, priceLineVisible: false }, 0)
              .setData(lineData(bands.middle))
            chart.addSeries(charts.LineSeries, { color: COLORS.band, lineWidth: 1, priceLineVisible: false }, 0)
              .setData(lineData(bands.upper))
            chart.addSeries(charts.LineSeries, { color: COLORS.band, lineWidth: 1, priceLineVisible: false }, 0)
              .setData(lineData(bands.lower))
            break
          }
          case 'volume':
            chart.addSeries(charts.HistogramSeries, {
              priceFormat: { type: 'volume' },
              priceScaleId: '',
              color: 'rgba(100, 116, 139, 0.55)',
            }, pane).setData(props.bars.map(bar => ({
              time: Math.floor(bar.time / 1_000) as never,
              value: bar.volume,
              color: bar.close >= bar.open ? 'rgba(22, 163, 74, 0.65)' : 'rgba(220, 38, 38, 0.65)',
            })))
            pane += 1
            break
          case 'rsi':
            chart.addSeries(charts.LineSeries, { color: COLORS.rsi, lineWidth: 2, priceLineVisible: false }, pane)
              .setData(lineData(rsi(props.bars, indicatorValue(indicator, 'period'))))
            pane += 1
            break
          case 'macd': {
            const values_ = macd(props.bars, indicatorValue(indicator, 'fast'), indicatorValue(indicator, 'slow'), indicatorValue(indicator, 'signal'))
            chart.addSeries(charts.LineSeries, { color: COLORS.macd, lineWidth: 2, priceLineVisible: false }, pane)
              .setData(lineData(values_.macd))
            chart.addSeries(charts.LineSeries, { color: COLORS.signal, lineWidth: 2, priceLineVisible: false }, pane)
              .setData(lineData(values_.signal))
            pane += 1
            break
          }
          case 'kdj': {
            const values_ = kdj(props.bars, indicatorValue(indicator, 'period'), indicatorValue(indicator, 'kSmooth'), indicatorValue(indicator, 'dSmooth'))
            chart.addSeries(charts.LineSeries, { color: COLORS.k, lineWidth: 2, priceLineVisible: false }, pane)
              .setData(lineData(values_.k))
            chart.addSeries(charts.LineSeries, { color: COLORS.d, lineWidth: 2, priceLineVisible: false }, pane)
              .setData(lineData(values_.d))
            chart.addSeries(charts.LineSeries, { color: COLORS.j, lineWidth: 2, priceLineVisible: false }, pane)
              .setData(lineData(values_.j))
            pane += 1
            break
          }
          case 'sar':
            chart.addSeries(charts.LineSeries, { color: COLORS.sar, lineWidth: 1, lineStyle: 2, priceLineVisible: false }, 0)
              .setData(lineData(sar(props.bars, indicatorValue(indicator, 'step'), indicatorValue(indicator, 'maxStep'))))
            break
          case 'vwap':
            chart.addSeries(charts.LineSeries, { color: COLORS.vwap, lineWidth: 2, priceLineVisible: false }, 0)
              .setData(lineData(vwap(props.bars)))
            break
          case 'td': {
            // TD Sequential marks the price pane: numbers above sell setups and
            // below buy setups, with counts at the target drawn solid.
            const target = indicatorValue(indicator, 'target')
            const markers = tdSequential(props.bars, indicatorValue(indicator, 'lookback')).map(count => ({
              time: Math.floor(count.time / 1_000) as never,
              position: count.side === 'sell' ? 'aboveBar' as const : 'belowBar' as const,
              shape: 'circle' as const,
              color: count.count >= target ? COLORS.tdSell : COLORS.tdBuy,
              text: String(count.count),
              size: count.count >= target ? 1 : 0.6,
            }))
            charts.createSeriesMarkers(candle, markers)
            break
          }
          case 'wr':
            chart.addSeries(charts.LineSeries, { color: COLORS.wr, lineWidth: 2, priceLineVisible: false }, pane)
              .setData(lineData(wr(props.bars, indicatorValue(indicator, 'period'))))
            pane += 1
            break
          case 'cci':
            chart.addSeries(charts.LineSeries, { color: COLORS.cci, lineWidth: 2, priceLineVisible: false }, pane)
              .setData(lineData(cci(props.bars, indicatorValue(indicator, 'period'))))
            pane += 1
            break
          case 'bias':
            chart.addSeries(charts.LineSeries, { color: COLORS.bias, lineWidth: 2, priceLineVisible: false }, pane)
              .setData(lineData(bias(props.bars, indicatorValue(indicator, 'period'))))
            pane += 1
            break
          case 'obv':
            chart.addSeries(charts.LineSeries, { color: COLORS.obv, lineWidth: 2, priceLineVisible: false }, pane)
              .setData(lineData(obv(props.bars)))
            pane += 1
            break
          case 'atr':
            chart.addSeries(charts.LineSeries, { color: COLORS.atr, lineWidth: 2, priceLineVisible: false }, pane)
              .setData(lineData(atr(props.bars, indicatorValue(indicator, 'period'))))
            pane += 1
            break
          case 'dmi': {
            const values_ = dmi(props.bars, indicatorValue(indicator, 'period'))
            chart.addSeries(charts.LineSeries, { color: COLORS.plusDi, lineWidth: 2, priceLineVisible: false }, pane)
              .setData(lineData(values_.plusDi))
            chart.addSeries(charts.LineSeries, { color: COLORS.minusDi, lineWidth: 2, priceLineVisible: false }, pane)
              .setData(lineData(values_.minusDi))
            chart.addSeries(charts.LineSeries, { color: COLORS.adx, lineWidth: 2, priceLineVisible: false }, pane)
              .setData(lineData(values_.adx))
            pane += 1
            break
          }
          /* v8 ignore next -- closed-union backstop; the compiler rejects a new indicator here. */
          default: assertNever(indicator.id, 'finance dashboard indicator')
        }
      }
      // The price pane carries the candles; indicator panes below need axis room only.
      const panes = chart.panes()
      panes[0]?.setStretchFactor(3)
      for (const indicatorPane of panes.slice(1)) indicatorPane.setStretchFactor(1)
      chart.timeScale().fitContent()
      setNative(true)
      remove = () => { chart.remove() }
    }).catch(() => { setNative(false) })
    return () => {
      disposed = true
      remove?.()
    }
  }, [props.bars, signature])

  return (
    <div
      className={css.chart}
      data-testid="finance-chart"
      data-native={native ? 'true' : 'false'}
      style={{ minHeight: `${String(chartHeight(paneCount))}px` }}
    >
      <div ref={container} className={css.nativeChart} aria-hidden={!native} />
      <svg className={css.fallbackChart} style={{ display: native ? 'none' : 'block' }} viewBox="0 0 600 220" role="img" aria-label={props.chartLabel} aria-hidden={native}>
        <path d={chartPath(props.bars, 600, 220)} className={css.line} />
      </svg>
    </div>
  )
}
