/** Lightweight TradingView-style chart with an SVG fallback for tests and unsupported canvases. */

import { useEffect, useRef, useState } from 'react'
import { chartPath, ema, macd, rsi, sma, type DashboardBar, type DashboardInterval } from './market-data.ts'
import css from './FinanceDashboard.module.css'

/** Props for the live finance chart. */
export interface TradingChartProps {
  readonly bars: readonly DashboardBar[]
  readonly interval: DashboardInterval
  readonly chartLabel: string
}

function canvasAvailable(): boolean {
  if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return false
  try {
    return document.createElement('canvas').getContext('2d') !== null
  } catch {
    return false
  }
}

/**
 * Render one interactive chart, falling back to SVG when canvas is unavailable.
 * @param props - Bars, interval, and accessible label.
 * @returns The chart container.
 */
export function TradingChart(props: TradingChartProps) {
  const container = useRef<HTMLDivElement>(null)
  const [native, setNative] = useState(false)

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
      const volume = chart.addSeries(charts.HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        color: 'rgba(100, 116, 139, 0.55)',
      }, 1)
      volume.setData(props.bars.map(bar => ({
        time: Math.floor(bar.time / 1_000) as never,
        value: bar.volume,
        color: bar.close >= bar.open ? 'rgba(22, 163, 74, 0.65)' : 'rgba(220, 38, 38, 0.65)',
      })))
      const sma20 = chart.addSeries(charts.LineSeries, { color: '#2563eb', lineWidth: 2, priceLineVisible: false }, 0)
      const ema12 = chart.addSeries(charts.LineSeries, { color: '#f59e0b', lineWidth: 2, priceLineVisible: false }, 0)
      sma20.setData(sma(props.bars, 20).map(point => ({ time: Math.floor(point.time / 1_000) as never, value: point.value })))
      ema12.setData(ema(props.bars, 12).map(point => ({ time: Math.floor(point.time / 1_000) as never, value: point.value })))
      const rsi14 = chart.addSeries(charts.LineSeries, { color: '#8b5cf6', lineWidth: 2, priceLineVisible: false }, 2)
      rsi14.setData(rsi(props.bars, 14).map(point => ({ time: Math.floor(point.time / 1_000) as never, value: point.value })))
      const macdValues = macd(props.bars)
      const macdLine = chart.addSeries(charts.LineSeries, { color: '#0ea5e9', lineWidth: 2, priceLineVisible: false }, 3)
      const signalLine = chart.addSeries(charts.LineSeries, { color: '#f97316', lineWidth: 2, priceLineVisible: false }, 3)
      macdLine.setData(macdValues.macd.map(point => ({ time: Math.floor(point.time / 1_000) as never, value: point.value })))
      signalLine.setData(macdValues.signal.map(point => ({ time: Math.floor(point.time / 1_000) as never, value: point.value })))
      // The price pane carries the candles; indicator panes below need axis room only.
      const panes = chart.panes()
      panes[0]?.setStretchFactor(3)
      for (const pane of panes.slice(1)) pane.setStretchFactor(1)
      chart.timeScale().fitContent()
      setNative(true)
      remove = () => { chart.remove() }
    }).catch(() => { setNative(false) })
    return () => {
      disposed = true
      remove?.()
    }
  }, [props.bars])

  return (
    <div className={css.chart} data-testid="finance-chart" data-native={native ? 'true' : 'false'}>
      <div ref={container} className={css.nativeChart} aria-hidden={!native} />
      <svg className={css.fallbackChart} style={{ display: native ? 'none' : 'block' }} viewBox="0 0 600 220" role="img" aria-label={props.chartLabel} aria-hidden={native}>
        <path d={chartPath(props.bars, 600, 220)} className={css.line} />
      </svg>
    </div>
  )
}
