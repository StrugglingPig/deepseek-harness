// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FinanceDashboard, type FinanceDashboardProps } from '../src/client/FinanceDashboard.tsx'
import { FinanceDashboardPanelIcon } from '../src/client/FinanceDashboardPanelIcon.tsx'
import type { FinanceDashboardState } from '../src/client/controller.ts'
import type { DashboardQuote } from '../src/client/market-data.ts'
import { en } from '../src/client/locales.ts'

beforeEach(() => {
  if (typeof HTMLCanvasElement !== 'undefined') HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never
})

const state: FinanceDashboardState = {
  status: 'ready',
  asset: 'crypto',
  symbol: 'BTCUSDT',
  interval: '1m',
  bars: [
    { time: 1_700_000_000_000, open: 100, high: 110, low: 95, close: 100, volume: 10 },
    { time: 1_700_000_060_000, open: 100, high: 115, low: 99, close: 112, volume: 12 },
  ],
  quote: { price: 112, changePercent: 12, volume: 12, currency: 'USDT' },
  name: 'Bitcoin',
  source: 'binance-spot',
  asOf: '2026-09-20T00:00:00.000Z',
  streamStatus: 'live',
  error: undefined,
}

function renderDashboard(patch: Partial<FinanceDashboardState> = {}) {
  const current = { ...state, ...patch }
  const refresh = vi.fn()
  const setSymbol = vi.fn()
  const setAsset = vi.fn()
  const setInterval = vi.fn()
  const props = {
    useDashboard: <T,>(selector: (value: FinanceDashboardState) => T): T => selector(current),
    refresh,
    setSymbol,
    setAsset,
    setInterval,
    t: (key: keyof typeof en) => en[key],
  } as unknown as FinanceDashboardProps
  const view = render(<FinanceDashboard {...props} />)
  return { ...view, refresh, setSymbol, setAsset, setInterval }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('FinanceDashboard', () => {
  it('renders multi-asset market state and forwards controls', () => {
    const actions = renderDashboard()
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByText('112.00')).toBeTruthy()
    expect(screen.getByText('+12.00%')).toBeTruthy()
    expect(screen.getByText(en.live)).toBeTruthy()
    expect(screen.getByTestId('finance-chart').querySelector('path')?.getAttribute('d')).toContain('M 0')

    fireEvent.click(screen.getByRole('tab', { name: en.stock }))
    expect(actions.setAsset).toHaveBeenCalledWith('stock')
    fireEvent.click(screen.getByRole('button', { name: 'ETH' }))
    expect(actions.setSymbol).toHaveBeenCalledWith('ETH')
    fireEvent.change(screen.getByLabelText(en.symbol), { target: { value: 'SOL' } })
    fireEvent.blur(screen.getByLabelText(en.symbol))
    expect(actions.setSymbol).toHaveBeenCalledWith('SOL')
    fireEvent.change(screen.getByLabelText(en.interval), { target: { value: '1h' } })
    expect(actions.setInterval).toHaveBeenCalledWith('1h')
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(actions.refresh).toHaveBeenCalledOnce()
  })

  it('renders loading, empty, failure, connecting, and offline states', () => {
    renderDashboard({ status: 'loading', bars: [], quote: undefined })
    expect(screen.getByRole('status').textContent).toBe(en.loading)
    cleanup()
    renderDashboard({ status: 'ready', bars: [], quote: undefined, streamStatus: 'connecting' })
    expect(screen.getByText(en.empty)).toBeTruthy()
    expect(screen.getByText(en.connecting)).toBeTruthy()
    cleanup()
    renderDashboard({ status: 'error', error: 'offline', bars: [], quote: undefined, streamStatus: 'error' })
    expect(screen.getByRole('alert').textContent).toContain('offline')
    cleanup()
    renderDashboard({ status: 'ready', bars: [], quote: undefined, streamStatus: 'disconnected' })
    expect(screen.getByText(en.offline)).toBeTruthy()
  })

  it('falls back to the latest bar when quote metrics are absent', () => {
    renderDashboard({ quote: undefined })
    expect(screen.getByText('112.00')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('renders the sidebar chart glyph at the requested size', () => {
    const props = { size: 18, active: true } as unknown as Parameters<typeof FinanceDashboardPanelIcon>[0]
    const view = render(<FinanceDashboardPanelIcon {...props} />)
    expect(view.container.querySelector('svg')?.getAttribute('width')).toBe('18')
    expect(view.container.querySelector('svg')?.getAttribute('data-active')).toBe('true')
  })
  it('covers placeholder labels, negative changes, and keyboard submission', () => {
    const actions = renderDashboard({
      name: undefined,
      source: undefined,
      asOf: undefined,
      quote: { ...(state.quote as DashboardQuote), changePercent: -3 },
    })
    expect(screen.getByText('-3.00%')).toBeTruthy()
    const input = screen.getByLabelText(en.symbol)
    fireEvent.keyDown(input, { key: 'a' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(actions.setSymbol).toHaveBeenCalled()
    cleanup()
    renderDashboard({ status: 'error', error: undefined })
    expect(screen.getByRole('alert').textContent).toBe(en.error)
  })

})
