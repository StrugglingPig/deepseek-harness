// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IndicatorSettings, type IndicatorSettingsProps } from '../src/client/IndicatorSettings.tsx'
import { DEFAULT_INDICATOR_IDS, INDICATORS } from '../src/client/indicators.ts'
import type { IndicatorPreferences } from '../src/client/indicator-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function renderSettings(preferences: IndicatorPreferences = { enabled: DEFAULT_INDICATOR_IDS, parameters: {} }) {
  const callbacks = {
    onToggle: vi.fn(),
    onParameter: vi.fn(),
    onReset: vi.fn(),
    onResetAll: vi.fn(),
    onClose: vi.fn(),
  }
  const t = ((key: keyof typeof en): string => en[key]) as unknown as IndicatorSettingsProps['t']
  const view = render(<IndicatorSettings preferences={preferences} t={t} {...callbacks} />)
  return { ...view, ...callbacks }
}

describe('IndicatorSettings', () => {
  it('groups every catalogued indicator by where it draws', () => {
    renderSettings()
    expect(screen.getByRole('dialog', { name: en.indicatorSettings })).toBeTruthy()
    expect(screen.getByRole('region', { name: en.indicatorOverlays })).toBeTruthy()
    expect(screen.getByRole('region', { name: en.indicatorPanes })).toBeTruthy()
    for (const spec of INDICATORS) {
      expect(screen.getByRole('checkbox', { name: en[spec.labelKey] })).toBeTruthy()
    }
  })

  it('reports the enabled count and forwards toggles, edits, and resets', () => {
    const actions = renderSettings({ enabled: ['sma', 'td'], parameters: { td: { lookback: 3 } } })
    expect(screen.getByText(`2 ${en.indicatorEnabled}`)).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: en.kdj }))
    expect(actions.onToggle).toHaveBeenCalledWith('kdj')

    fireEvent.change(screen.getByLabelText(`${en.td} ${en.paramLookback}`), { target: { value: '5' } })
    expect(actions.onParameter).toHaveBeenCalledWith('td', 'lookback', 5)
    // Untouched parameters keep their declared default in the field.
    expect(screen.getByLabelText<HTMLInputElement>(`${en.td} ${en.paramTarget}`).value).toBe('9')

    fireEvent.click(screen.getByRole('button', { name: `${en.indicatorReset} ${en.td}` }))
    expect(actions.onReset).toHaveBeenCalledWith('td')
    fireEvent.click(screen.getByRole('button', { name: en.indicatorResetAll }))
    expect(actions.onResetAll).toHaveBeenCalledOnce()
  })

  it('closes from the button, the backdrop, and keeps the dialog open on inner clicks', () => {
    const actions = renderSettings()
    fireEvent.click(screen.getByRole('button', { name: en.indicatorClose }))
    expect(actions.onClose).toHaveBeenCalledOnce()

    const dialog = screen.getByRole('dialog', { name: en.indicatorSettings })
    fireEvent.click(dialog)
    expect(actions.onClose).toHaveBeenCalledOnce()
    fireEvent.click(dialog.parentElement as HTMLElement)
    expect(actions.onClose).toHaveBeenCalledTimes(2)
  })
})
