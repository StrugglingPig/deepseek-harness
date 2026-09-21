// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChart } from 'lightweight-charts'
import { TradingChart } from '../src/client/TradingChart.tsx'
import { resolveIndicators, type IndicatorId } from '../src/client/indicators.ts'

const mock = vi.hoisted(() => {
  const state = { fail: false }
  // The third argument is the pane index, which the pane-assignment case asserts.
  const series = (_definition?: unknown, _options?: unknown, _paneIndex?: number) => ({ setData: vi.fn() })
  const panes = Array.from({ length: 6 }, () => ({ setStretchFactor: vi.fn() }))
  const api = {
    addSeries: vi.fn(series),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    panes: vi.fn(() => panes),
    remove: vi.fn(),
  }
  const markers = vi.fn((_series: unknown, list: readonly unknown[]) => ({ markers: () => list }))
  return { state, api, panes, markers }
})

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => {
    if (mock.state.fail) throw new Error('chart failed')
    return mock.api
  }),
  createSeriesMarkers: (series: unknown, list: readonly unknown[]) => mock.markers(series, list),
  CrosshairMode: { Normal: 0 },
  CandlestickSeries: {},
  HistogramSeries: {},
  LineSeries: {},
}))

function indicators(...ids: IndicatorId[]) {
  return resolveIndicators(ids, {})
}

const bars = Array.from({ length: 30 }, (_, index) => ({
  time: 1_700_000_000_000 + index * 60_000,
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: index % 2 === 0 ? 101 + index : 99.5 + index,
  volume: 10 + index,
}))

const originalCanvas = globalThis.HTMLCanvasElement

beforeEach(() => {
  vi.clearAllMocks()
  mock.state.fail = false
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as never
})

afterEach(() => {
  cleanup()
  Object.defineProperty(globalThis, 'HTMLCanvasElement', { value: originalCanvas, configurable: true })
})

describe('TradingChart', () => {
  it('renders a native chart and cleans up series', async () => {
    const view = render(<TradingChart bars={bars} interval="1m" chartLabel="chart" indicators={indicators('sma', 'volume', 'rsi', 'macd')} />)
    await waitFor(() => { expect(view.getByTestId('finance-chart').getAttribute('data-native')).toBe('true') })
    expect(mock.api.addSeries).toHaveBeenCalled()
    view.unmount()
    expect(mock.api.remove).toHaveBeenCalled()
  })

  it('keeps the time axis visible, lets the page keep the wheel, and leads with the price pane', async () => {
    const view = render(<TradingChart bars={bars} interval="1d" chartLabel="chart" indicators={indicators('sma', 'volume')} />)
    await waitFor(() => { expect(view.getByTestId('finance-chart').getAttribute('data-native')).toBe('true') })
    const options = vi.mocked(createChart).mock.calls[0]?.[1]
    expect(options?.timeScale?.borderVisible).toBe(true)
    expect(options?.timeScale?.timeVisible).toBe(true)
    // The chart fills most of the panel: a wheel or vertical touch drag over it
    // must scroll the panel instead of being consumed for chart zoom.
    expect(options?.handleScroll).toMatchObject({ mouseWheel: false, vertTouchDrag: false })
    expect(options?.handleScale).toMatchObject({ mouseWheel: false })
    expect(mock.panes[0]?.setStretchFactor).toHaveBeenCalledWith(3)
    expect(mock.panes[1]?.setStretchFactor).toHaveBeenCalledWith(1)
    view.unmount()
  })

  it('draws overlays on the price pane and one pane per pane indicator', async () => {
    const view = render(<TradingChart
      bars={bars}
      interval="1d"
      chartLabel="chart"
      indicators={indicators('sma', 'ema', 'boll', 'volume', 'rsi', 'macd', 'kdj')}
    />)
    await waitFor(() => { expect(view.getByTestId('finance-chart').getAttribute('data-native')).toBe('true') })
    const panes = mock.api.addSeries.mock.calls.map(call => call[2])
    // Candles, SMA, EMA, and the three BOLL bands share pane 0.
    expect(panes.slice(0, 7)).toEqual([undefined, 0, 0, 0, 0, 0, 1])
    // Volume, RSI, MACD, and KDJ each own a pane below the candles.
    expect(panes.slice(7, 12)).toEqual([2, 3, 3, 4, 4])
    expect(mock.api.addSeries).toHaveBeenCalledTimes(13)
    expect(panes.at(-1)).toBe(4)
    view.unmount()
  })

  it('draws every catalogued pane indicator and marks TD Sequential setups', async () => {
    // A wave produces both a buy setup and a sell setup for the TD markers.
    const wave = [...Array.from({ length: 12 }, (_, index) => 100 - index), ...Array.from({ length: 12 }, (_, index) => 90 + index)]
      .map((close, index) => ({ time: 1_700_000_000_000 + index * 60_000, open: close, high: close + 1, low: close - 1, close, volume: 5 }))
    const view = render(<TradingChart
      bars={wave}
      interval="1d"
      chartLabel="chart"
      indicators={indicators('sar', 'vwap', 'td', 'wr', 'cci', 'bias', 'obv', 'atr', 'dmi')}
    />)
    await waitFor(() => { expect(view.getByTestId('finance-chart').getAttribute('data-native')).toBe('true') })

    const panes = mock.api.addSeries.mock.calls.map(call => call[2])
    // SAR and VWAP overlay the candles; TD Sequential only marks them.
    expect(panes.slice(0, 2)).toEqual([undefined, 0])
    // WR, CCI, BIAS, OBV, ATR own one pane each and DMI shares its own three lines.
    expect(panes.slice(2)).toEqual([0, 1, 2, 3, 4, 5, 6, 6, 6])
    expect(mock.markers).toHaveBeenCalledTimes(1)
    expect(Number.parseInt(view.getByTestId('finance-chart').style.minHeight, 10)).toBe(980)
    view.unmount()
  })

  it('grows the chart with the number of indicator panes', async () => {
    const few = render(<TradingChart bars={bars} interval="1d" chartLabel="chart" indicators={indicators('sma')} />)
    const fewHeight = few.getByTestId('finance-chart').style.minHeight
    few.unmount()
    const many = render(<TradingChart bars={bars} interval="1d" chartLabel="chart" indicators={indicators('volume', 'rsi', 'macd', 'kdj')} />)
    const manyHeight = many.getByTestId('finance-chart').style.minHeight
    expect(Number.parseInt(fewHeight, 10)).toBeLessThan(Number.parseInt(manyHeight, 10))
    many.unmount()
  })

  it('renders the SVG fallback for empty or unavailable canvas data', () => {
    const view = render(<TradingChart bars={[]} interval="1m" chartLabel="chart" indicators={indicators('sma')} />)
    expect(view.getByTestId('finance-chart').getAttribute('data-native')).toBe('false')
    expect(view.container.querySelector('path')).toBeTruthy()
    view.unmount()

    HTMLCanvasElement.prototype.getContext = vi.fn(() => { throw new Error('no canvas') }) as never
    const thrown = render(<TradingChart bars={bars} interval="1m" chartLabel="chart" indicators={indicators('sma')} />)
    expect(thrown.getByTestId('finance-chart').getAttribute('data-native')).toBe('false')
    thrown.unmount()
  })

  it('handles a canvasless environment and import failure', async () => {
    Object.defineProperty(globalThis, 'HTMLCanvasElement', { value: undefined, configurable: true })
    const withoutCanvas = render(<TradingChart bars={bars} interval="1m" chartLabel="chart" indicators={indicators('sma')} />)
    expect(withoutCanvas.getByTestId('finance-chart').getAttribute('data-native')).toBe('false')
    withoutCanvas.unmount()
    Object.defineProperty(globalThis, 'HTMLCanvasElement', { value: originalCanvas, configurable: true })

    mock.state.fail = true
    const failed = render(<TradingChart bars={bars} interval="1m" chartLabel="chart" indicators={indicators('sma')} />)
    await waitFor(() => { expect(failed.getByTestId('finance-chart').getAttribute('data-native')).toBe('false') })
    failed.unmount()
  })

  it('ignores an import that resolves after unmount', async () => {
    const view = render(<TradingChart bars={bars} interval="1m" chartLabel="chart" indicators={indicators('sma')} />)
    view.unmount()
    await Promise.resolve()
  })
})
