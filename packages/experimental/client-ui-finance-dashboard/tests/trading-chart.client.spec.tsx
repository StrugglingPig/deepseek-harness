// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChart } from 'lightweight-charts'
import { TradingChart } from '../src/client/TradingChart.tsx'
import { resolveIndicators, type IndicatorId, type ResolvedIndicator } from '../src/client/indicators.ts'

const mock = vi.hoisted(() => {
  const state = { fail: false, missingPaneElement: false }
  // The third argument is the pane index, which the pane-assignment case asserts.
  const series = (_definition?: unknown, _options?: unknown, _paneIndex?: number) => ({ setData: vi.fn() })
  const paneElements = Array.from({ length: 8 }, () => document.createElement('div'))
  const panes = paneElements.map(element => ({
    setStretchFactor: vi.fn(),
    getHTMLElement: () => (mock.state.missingPaneElement ? null : element),
  }))
  const api = {
    addSeries: vi.fn(series),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    panes: vi.fn(() => panes),
    remove: vi.fn(),
  }
  const markers = vi.fn((_series: unknown, list: readonly unknown[]) => ({ markers: () => list }))
  return { state, api, panes, paneElements, markers }
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

const labelOf = (indicator: ResolvedIndicator): string => indicator.id.toUpperCase()

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
  mock.state.missingPaneElement = false
  for (const element of mock.paneElements) element.replaceChildren()
})

afterEach(() => {
  cleanup()
  Object.defineProperty(globalThis, 'HTMLCanvasElement', { value: originalCanvas, configurable: true })
})

describe('TradingChart', () => {
  it('renders a native chart and cleans up series', async () => {
    const view = render(<TradingChart bars={bars} interval="1m" chartLabel="chart" indicators={indicators('sma', 'volume', 'rsi', 'macd')} labelOf={labelOf} />)
    await waitFor(() => { expect(view.getByTestId('finance-chart').getAttribute('data-native')).toBe('true') })
    expect(mock.api.addSeries).toHaveBeenCalled()
    view.unmount()
    expect(mock.api.remove).toHaveBeenCalled()
  })

  it('keeps the time axis visible, lets the page keep the wheel, and leads with the price pane', async () => {
    const view = render(<TradingChart bars={bars} interval="1d" chartLabel="chart" indicators={indicators('sma', 'volume')} labelOf={labelOf} />)
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
      labelOf={labelOf}
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
      labelOf={labelOf}
    />)
    await waitFor(() => { expect(view.getByTestId('finance-chart').getAttribute('data-native')).toBe('true') })

    const panes = mock.api.addSeries.mock.calls.map(call => call[2])
    // SAR and VWAP overlay the candles; TD Sequential only marks them.
    expect(panes.slice(0, 2)).toEqual([undefined, 0])
    // WR, CCI, BIAS, OBV, ATR own one pane each and DMI shares its own three lines.
    expect(panes.slice(2)).toEqual([0, 1, 2, 3, 4, 5, 6, 6, 6])
    expect(mock.markers).toHaveBeenCalledTimes(1)
    expect(Number.parseInt(view.getByTestId('finance-chart').style.minHeight, 10)).toBe(1160)
    view.unmount()
  })

  it('captions every pane with the indicator it draws', async () => {
    const view = render(<TradingChart
      bars={bars}
      interval="1d"
      chartLabel="chart"
      indicators={indicators('sma', 'boll', 'volume', 'rsi', 'dmi')}
      labelOf={labelOf}
    />)
    await waitFor(() => { expect(view.getByTestId('finance-chart').getAttribute('data-native')).toBe('true') })
    // Overlays share the price pane caption; each pane indicator states its own.
    expect(mock.paneElements[0]?.textContent).toBe('SMA · BOLL')
    expect(mock.paneElements[1]?.textContent).toBe('VOLUME')
    expect(mock.paneElements[2]?.textContent).toBe('RSI')
    expect(mock.paneElements[3]?.textContent).toBe('DMI')
    expect(mock.paneElements[0]?.firstElementChild?.className).toContain('paneLabel')
    // The caption anchors to its own pane row.
    expect(mock.paneElements[0]?.style.position).toBe('relative')
    // The retry must not append the caption twice.
    await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) })
    expect(mock.paneElements[0]?.querySelectorAll('[data-pane-label]')).toHaveLength(1)
    view.unmount()
  })

  it('attaches the captions on a timer where no frame clock exists', async () => {
    const saved = globalThis.requestAnimationFrame
    Object.defineProperty(globalThis, 'requestAnimationFrame', { value: undefined, configurable: true })
    try {
      const view = render(<TradingChart
        bars={bars}
        interval="1d"
        chartLabel="chart"
        indicators={indicators('volume')}
        labelOf={labelOf}
      />)
      await waitFor(() => { expect(mock.paneElements[1]?.textContent).toBe('VOLUME') })
      view.unmount()
    } finally {
      Object.defineProperty(globalThis, 'requestAnimationFrame', { value: saved, configurable: true })
    }
  })

  it('draws without captions when the library reports no pane element', async () => {
    mock.state.missingPaneElement = true
    const view = render(<TradingChart
      bars={bars}
      interval="1d"
      chartLabel="chart"
      indicators={indicators('volume', 'rsi')}
      labelOf={labelOf}
    />)
    await waitFor(() => { expect(view.getByTestId('finance-chart').getAttribute('data-native')).toBe('true') })
    expect(mock.paneElements[0]?.textContent).toBe('')
    view.unmount()
  })

  it('grows the chart with the number of indicator panes', async () => {
    const few = render(<TradingChart bars={bars} interval="1d" chartLabel="chart" indicators={indicators('sma')} labelOf={labelOf} />)
    const fewHeight = few.getByTestId('finance-chart').style.minHeight
    few.unmount()
    const many = render(<TradingChart bars={bars} interval="1d" chartLabel="chart" indicators={indicators('volume', 'rsi', 'macd', 'kdj')} labelOf={labelOf} />)
    const manyHeight = many.getByTestId('finance-chart').style.minHeight
    expect(Number.parseInt(fewHeight, 10)).toBeLessThan(Number.parseInt(manyHeight, 10))
    many.unmount()
  })

  it('renders the SVG fallback for empty or unavailable canvas data', () => {
    const view = render(<TradingChart bars={[]} interval="1m" chartLabel="chart" indicators={indicators('sma')} labelOf={labelOf} />)
    expect(view.getByTestId('finance-chart').getAttribute('data-native')).toBe('false')
    expect(view.container.querySelector('path')).toBeTruthy()
    view.unmount()

    HTMLCanvasElement.prototype.getContext = vi.fn(() => { throw new Error('no canvas') }) as never
    const thrown = render(<TradingChart bars={bars} interval="1m" chartLabel="chart" indicators={indicators('sma')} labelOf={labelOf} />)
    expect(thrown.getByTestId('finance-chart').getAttribute('data-native')).toBe('false')
    thrown.unmount()
  })

  it('handles a canvasless environment and import failure', async () => {
    Object.defineProperty(globalThis, 'HTMLCanvasElement', { value: undefined, configurable: true })
    const withoutCanvas = render(<TradingChart bars={bars} interval="1m" chartLabel="chart" indicators={indicators('sma')} labelOf={labelOf} />)
    expect(withoutCanvas.getByTestId('finance-chart').getAttribute('data-native')).toBe('false')
    withoutCanvas.unmount()
    Object.defineProperty(globalThis, 'HTMLCanvasElement', { value: originalCanvas, configurable: true })

    mock.state.fail = true
    const failed = render(<TradingChart bars={bars} interval="1m" chartLabel="chart" indicators={indicators('sma')} labelOf={labelOf} />)
    await waitFor(() => { expect(failed.getByTestId('finance-chart').getAttribute('data-native')).toBe('false') })
    failed.unmount()
  })

  it('ignores an import that resolves after unmount', async () => {
    const view = render(<TradingChart bars={bars} interval="1m" chartLabel="chart" indicators={indicators('sma')} labelOf={labelOf} />)
    view.unmount()
    await Promise.resolve()
  })
})
