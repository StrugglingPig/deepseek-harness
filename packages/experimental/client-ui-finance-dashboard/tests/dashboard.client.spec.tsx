// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { FinanceDashboard } from '../src/client/FinanceDashboard.tsx'
import type { FinanceDashboardProps } from '../src/client/FinanceDashboard.tsx'
import type { FinanceDashboardState } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'
import { FinanceDashboardPanelIcon } from '../src/client/FinanceDashboardPanelIcon.tsx'

afterEach(cleanup)

const t = ((key: keyof typeof en) => en[key]) as FinanceDashboardProps['t']

function renderDashboard(overrides: Partial<FinanceDashboardState> = {}) {
  const store = createSnapshotStore<FinanceDashboardState>({
    status: 'ready',
    symbol: 'BTC',
    interval: '1m',
    bars: [
      { time: 1, open: 100, high: 110, low: 95, close: 102, volume: 10 },
      { time: 2, open: 102, high: 115, low: 101, close: 112, volume: 12 },
    ],
    latestPrice: 112,
    changePercent: 12,
    streamStatus: 'live',
    error: undefined,
    ...overrides,
  })
  const refresh = vi.fn()
  const setSymbol = vi.fn()
  const setInterval = vi.fn()
  const props = {
    t,
    useDashboard: bindSnapshotSelector(store),
    refresh,
    setSymbol,
    setInterval,
  } as unknown as FinanceDashboardProps
  render(<FinanceDashboard {...props} />)
  return { refresh, setSymbol, setInterval }
}

describe('FinanceDashboard', () => {
  it('renders live market state and forwards chart controls', () => {
    const actions = renderDashboard()
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByText('112.00')).toBeTruthy()
    expect(screen.getByText('+12.00%')).toBeTruthy()
    expect(screen.getByText(en.live)).toBeTruthy()
    expect(screen.getByTestId('finance-chart').querySelector('path')?.getAttribute('d')).toContain('M 0')

    fireEvent.change(screen.getByLabelText(en.symbol), { target: { value: 'ETH' } })
    expect(actions.setSymbol).toHaveBeenCalledWith('ETH')
    fireEvent.change(screen.getByLabelText(en.interval), { target: { value: '1h' } })
    expect(actions.setInterval).toHaveBeenCalledWith('1h')
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(actions.refresh).toHaveBeenCalledOnce()
  })

  it('renders loading, empty, failure, connecting, and offline states', () => {
    renderDashboard({ status: 'loading', bars: [], latestPrice: undefined, changePercent: undefined })
    expect(screen.getByRole('status').textContent).toBe(en.loading)
    cleanup()
    renderDashboard({ status: 'ready', bars: [], latestPrice: undefined, changePercent: undefined, streamStatus: 'connecting' })
    expect(screen.getByText(en.empty)).toBeTruthy()
    expect(screen.getByText(en.connecting)).toBeTruthy()
    cleanup()
    renderDashboard({ status: 'error', error: 'offline', bars: [], latestPrice: undefined, changePercent: undefined, streamStatus: 'offline' as never })
    expect(screen.getByRole('alert').textContent).toContain('offline')
    cleanup()
    renderDashboard({ status: 'error', error: undefined, bars: [], latestPrice: undefined, changePercent: undefined, streamStatus: 'disconnected' })
    expect(screen.getByRole('alert').textContent).toBe(en.error)
    cleanup()
    renderDashboard({ status: 'ready', bars: [], latestPrice: undefined, changePercent: undefined, streamStatus: 'disconnected' })
    expect(screen.getByText(en.offline)).toBeTruthy()
  })

  it('falls back to the latest bar when quote metrics are absent', () => {
    renderDashboard({ latestPrice: undefined, changePercent: undefined })
    expect(screen.getByText('112.00')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    cleanup()
    renderDashboard({ changePercent: -4.5 })
    expect(screen.getByText('-4.50%')).toBeTruthy()
  })

  it('renders the sidebar chart glyph at the requested size', () => {
    const props = { size: 18, active: true } as unknown as Parameters<typeof FinanceDashboardPanelIcon>[0]
    const view = render(<FinanceDashboardPanelIcon {...props} />)
    expect(view.container.querySelector('svg')?.getAttribute('width')).toBe('18')
    expect(view.container.querySelector('svg')?.getAttribute('data-active')).toBe('true')
  })
})
