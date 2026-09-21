// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createChart } from 'lightweight-charts'
import { TradingChart } from '../src/client/TradingChart.tsx'

const mock = vi.hoisted(() => {
  const state = { fail: false }
  const series = () => ({ setData: vi.fn() })
  const panes = Array.from({ length: 4 }, () => ({ setStretchFactor: vi.fn() }))
  const api = {
    addSeries: vi.fn(series),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    panes: vi.fn(() => panes),
    remove: vi.fn(),
  }
  return { state, api, panes }
})

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => {
    if (mock.state.fail) throw new Error('chart failed')
    return mock.api
  }),
  CrosshairMode: { Normal: 0 },
  CandlestickSeries: {},
  HistogramSeries: {},
  LineSeries: {},
}))

const bars = Array.from({ length: 30 }, (_, index) => ({
  time: 1_700_000_000_000 + index * 60_000,
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: index % 2 === 0 ? 101 + index : 99.5 + index,
  volume: 10 + index,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mock.state.fail = false
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as never
})

describe('TradingChart', () => {
  it('renders a native chart and cleans up series', async () => {
    const view = render(<TradingChart bars={bars} interval="1m" chartLabel="chart" />)
    await waitFor(() => { expect(view.getByTestId('finance-chart').getAttribute('data-native')).toBe('true') })
    expect(mock.api.addSeries).toHaveBeenCalled()
    view.unmount()
    expect(mock.api.remove).toHaveBeenCalled()
  })

  it('keeps the time axis visible and lets the price pane lead the panes', async () => {
    const view = render(<TradingChart bars={bars} interval="1d" chartLabel="chart" />)
    await waitFor(() => { expect(view.getByTestId('finance-chart').getAttribute('data-native')).toBe('true') })
    const options = vi.mocked(createChart).mock.calls[0]?.[1]
    expect(options?.timeScale?.borderVisible).toBe(true)
    expect(options?.timeScale?.timeVisible).toBe(true)
    expect(mock.panes[0]?.setStretchFactor).toHaveBeenCalledWith(3)
    for (const pane of mock.panes.slice(1)) expect(pane.setStretchFactor).toHaveBeenCalledWith(1)
    view.unmount()
  })

  it('renders the SVG fallback for empty or unavailable canvas data', () => {
    const view = render(<TradingChart bars={[]} interval="1m" chartLabel="chart" />)
    expect(view.getByTestId('finance-chart').getAttribute('data-native')).toBe('false')
    expect(view.container.querySelector('path')).toBeTruthy()
    view.unmount()

    HTMLCanvasElement.prototype.getContext = vi.fn(() => { throw new Error('no canvas') }) as never
    const thrown = render(<TradingChart bars={bars} interval="1m" chartLabel="chart" />)
    expect(thrown.getByTestId('finance-chart').getAttribute('data-native')).toBe('false')
    thrown.unmount()
  })

  it('handles a canvasless environment and import failure', async () => {
    const saved = globalThis.HTMLCanvasElement
    Object.defineProperty(globalThis, 'HTMLCanvasElement', { value: undefined, configurable: true })
    const withoutCanvas = render(<TradingChart bars={bars} interval="1m" chartLabel="chart" />)
    expect(withoutCanvas.getByTestId('finance-chart').getAttribute('data-native')).toBe('false')
    withoutCanvas.unmount()
    Object.defineProperty(globalThis, 'HTMLCanvasElement', { value: saved, configurable: true })

    mock.state.fail = true
    const failed = render(<TradingChart bars={bars} interval="1m" chartLabel="chart" />)
    await waitFor(() => { expect(failed.getByTestId('finance-chart').getAttribute('data-native')).toBe('false') })
    failed.unmount()
  })

  it('ignores an import that resolves after unmount', async () => {
    const view = render(<TradingChart bars={bars} interval="1m" chartLabel="chart" />)
    view.unmount()
    await Promise.resolve()
  })
})
