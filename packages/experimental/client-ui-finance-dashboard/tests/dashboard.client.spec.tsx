// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FinanceDashboard, type FinanceDashboardProps } from '../src/client/FinanceDashboard.tsx'
import { FinanceDashboardPanelIcon } from '../src/client/FinanceDashboardPanelIcon.tsx'
import type { FinanceDashboardState } from '../src/client/controller.ts'
import { DEFAULT_INDICATOR_IDS, type IndicatorId, type IndicatorParameterMap } from '../src/client/indicators.ts'
import type { IndicatorPreferences } from '../src/client/indicator-store.ts'
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
  research: undefined,
  macro: undefined,
  events: undefined,
  streamStatus: 'live',
  error: undefined,
}

function renderDashboard(
  patch: Partial<FinanceDashboardState> = {},
  preferences: IndicatorPreferences = { enabled: DEFAULT_INDICATOR_IDS, parameters: {} },
) {
  const current = { ...state, ...patch }
  const refresh = vi.fn()
  const setSymbol = vi.fn()
  const setAsset = vi.fn()
  const setInterval = vi.fn()
  const toggleIndicator = vi.fn()
  const setIndicatorParameter = vi.fn()
  const resetIndicator = vi.fn()
  const resetIndicators = vi.fn()
  const props = {
    useDashboard: <T,>(selector: (value: FinanceDashboardState) => T): T => selector(current),
    useIndicators: <T,>(selector: (value: IndicatorPreferences) => T): T => selector(preferences),
    refresh,
    setSymbol,
    setAsset,
    setInterval,
    toggleIndicator,
    setIndicatorParameter,
    resetIndicator,
    resetIndicators,
    t: (key: keyof typeof en) => en[key],
  } as unknown as FinanceDashboardProps
  const view = render(<FinanceDashboard {...props} />)
  return {
    ...view, refresh, setSymbol, setAsset, setInterval,
    toggleIndicator, setIndicatorParameter, resetIndicator, resetIndicators,
  }
}

function indicatorPreferences(enabled: readonly IndicatorId[], parameters: IndicatorParameterMap = {}): IndicatorPreferences {
  return { enabled, parameters }
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

  it('renders the macro strip and the event calendar', () => {
    renderDashboard({
      macro: [
        { id: 'us-10y-yield', value: 4.25, unit: '%', date: '2026-09-22', source: 'fred' },
        { id: 'unknown-series', value: 1, unit: '', date: '2026-09-22', source: 'fred' },
      ],
      events: [{ date: '2026-09-24', label: 'Gross Domestic Product', source: 'fred' }],
    })
    const macro = screen.getByRole('region', { name: en.macroTitle })
    expect(within(macro).getByText(en.macroUs10y)).toBeDefined()
    // A series the client has no label for still prints under the generic name.
    expect(within(macro).getByText(en.macroUnknown)).toBeDefined()
    expect(within(macro).getByText('4.25 %')).toBeDefined()
    const events = screen.getByRole('region', { name: en.eventsTitle })
    expect(within(events).getByText('Gross Domestic Product')).toBeDefined()
    expect(within(events).getByText('2026-09-24')).toBeDefined()
  })

  it('says so when the calendar has no scheduled release, and stays quiet without strips', () => {
    renderDashboard({ events: [] })
    const events = screen.getByRole('region', { name: en.eventsTitle })
    expect(within(events).getByText(en.eventsEmpty)).toBeDefined()
    cleanup()
    // A macro-only answer renders the strip without the calendar.
    renderDashboard({ macro: [{ id: 'us-cpi', value: 3.1, unit: '%', date: '2026-08-01', source: 'fred' }] })
    expect(screen.getByRole('region', { name: en.macroTitle })).toBeDefined()
    expect(screen.queryByRole('region', { name: en.eventsTitle })).toBeNull()
    cleanup()
    renderDashboard()
    expect(screen.queryByRole('region', { name: en.macroTitle })).toBeNull()
    expect(screen.queryByRole('region', { name: en.eventsTitle })).toBeNull()
  })

  it('renders the research summary the Host attached to a US snapshot', () => {
    renderDashboard({
      asset: 'us',
      symbol: 'AAPL',
      name: 'Apple Inc.',
      research: {
        source: 'finnhub',
        reportedPeriod: 'FY2025 10-K',
        label: 'reference',
        grade: 'B',
        action: 'reduce',
        nextEarnings: '2026-10-22',
        range: { low: 108.88, high: 147.57, weighted: 127.73 },
        ratios: [
          { id: 'netMargin', value: 26.92 },
          { id: 'currentRatio', value: undefined },
        ],
      },
    })
    const summary = screen.getByRole('region', { name: en.researchTitle })
    expect(within(summary).getByText('finnhub · Reported FY2025 10-K')).toBeDefined()
    expect(within(summary).getByText('108.88 – 147.57')).toBeDefined()
    expect(within(summary).getByText('127.73')).toBeDefined()
    expect(within(summary).getByText('B')).toBeDefined()
    expect(within(summary).getByText(en.actionReduce)).toBeDefined()
    expect(within(summary).getByText('2026-10-22')).toBeDefined()
    expect(within(summary).getByText('26.92')).toBeDefined()
    // A ratio the statements cannot support prints as not obtained rather than blank.
    expect(within(summary).getByText(en.researchMissing)).toBeDefined()
  })

  it('leaves the summary out when the snapshot carries none', () => {
    renderDashboard()
    expect(screen.queryByRole('region', { name: en.researchTitle })).toBeNull()
    // A snapshot whose model could not value the instrument still shows the strip's ratios.
    renderDashboard({
      asset: 'us',
      symbol: 'AAPL',
      research: {
        source: 'finnhub',
        reportedPeriod: '',
        label: 'reference',
        grade: undefined,
        action: undefined,
        nextEarnings: undefined,
        range: undefined,
        ratios: [],
      },
    })
    const summary = screen.getByRole('region', { name: en.researchTitle })
    expect(within(summary).getByText('finnhub')).toBeDefined()
    expect(within(summary).getAllByText(en.researchMissing).length).toBeGreaterThan(0)
  })

  it('renders the loading and empty panel states', () => {
    renderDashboard({ status: 'loading', bars: [], quote: undefined })
    expect(screen.getByRole('status').textContent).toBe(en.loading)
    expect(screen.queryByText(en.emptyHint)).toBeNull()
    cleanup()
    renderDashboard({ status: 'ready', bars: [], quote: undefined, streamStatus: 'connecting' })
    expect(screen.getByText(en.emptyTitle)).toBeTruthy()
    expect(screen.getByText(en.emptyHint)).toBeTruthy()
    expect(screen.getByText(en.connecting)).toBeTruthy()
    cleanup()
    renderDashboard({ status: 'ready', bars: [], quote: undefined, streamStatus: 'disconnected' })
    expect(screen.getByText(en.offline)).toBeTruthy()
    expect(screen.getByText(en.emptyTitle)).toBeTruthy()
  })

  it('reports a failed load as no data, with the provider message collapsed', () => {
    const actions = renderDashboard({
      status: 'error',
      error: 'request failed for https://query1.finance.yahoo.com/v8/finance/chart/TSLA: HTTP 403',
      bars: [],
      quote: undefined,
      streamStatus: 'error',
    })
    expect(screen.getByText(en.emptyTitle)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    // The raw provider message only appears inside the disclosure.
    expect(screen.getByText(en.emptyDetails)).toBeTruthy()
    expect(screen.getByText(/query1\.finance\.yahoo\.com/)).toBeTruthy()
    fireEvent.click(within(screen.getByTestId('finance-empty')).getByRole('button', { name: en.refresh }))
    expect(actions.refresh).toHaveBeenCalledOnce()
  })

  it('keeps the snapshot mounted while a background poll or failure is pending', () => {
    renderDashboard({ status: 'loading', streamStatus: 'connecting' })
    // A poll still has bars to draw: showing the loading notice and unmounting
    // the chart would reset the panel's scroll position every interval.
    expect(screen.getByTestId('finance-chart')).toBeTruthy()
    expect(screen.getByText('112.00')).toBeTruthy()
    expect(screen.queryByText(en.loading)).toBeNull()
    expect(screen.getByText(en.connecting)).toBeTruthy()
    cleanup()

    renderDashboard({ status: 'error', error: 'offline', streamStatus: 'error' })
    // A failed poll keeps the last snapshot on screen and stays out of the way.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('finance-chart')).toBeTruthy()
  })

  it('opens the indicator settings module and forwards its edits', () => {
    const actions = renderDashboard()
    expect(screen.queryByRole('dialog', { name: en.indicatorSettings })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.indicators }))
    expect(screen.getByRole('dialog', { name: en.indicatorSettings })).toBeTruthy()
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: en.sma }).checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: en.kdj }).checked).toBe(false)

    fireEvent.click(screen.getByRole('checkbox', { name: en.kdj }))
    expect(actions.toggleIndicator).toHaveBeenCalledWith('kdj')

    fireEvent.change(screen.getByLabelText(`${en.rsi} ${en.paramPeriod}`), { target: { value: '7' } })
    expect(actions.setIndicatorParameter).toHaveBeenCalledWith('rsi', 'period', 7)

    // A parameterless indicator shows no inputs at all.
    expect(screen.queryByLabelText(`${en.volume} ${en.paramPeriod}`)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.indicatorResetAll }))
    expect(actions.resetIndicators).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: en.indicatorClose }))
    expect(screen.queryByRole('dialog', { name: en.indicatorSettings })).toBeNull()
  })

  it('renders the legend from the configured indicators only', () => {
    renderDashboard({}, indicatorPreferences(['boll', 'kdj'], { boll: { period: 10, multiplier: 3 } }))
    expect(screen.getByText('BOLL(10,3)')).toBeTruthy()
    expect(screen.getByText('KDJ(9,3,3)')).toBeTruthy()
    expect(screen.queryByText('SMA20')).toBeNull()
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
    renderDashboard({ status: 'error', error: undefined, bars: [], quote: undefined })
    expect(screen.getByText(en.emptyTitle)).toBeTruthy()
    expect(screen.queryByText(en.emptyDetails)).toBeNull()
  })

})
