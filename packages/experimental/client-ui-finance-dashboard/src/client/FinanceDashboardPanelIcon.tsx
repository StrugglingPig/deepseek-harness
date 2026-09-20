/** Sidebar glyph for the finance dashboard panel. */

import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Render the finance dashboard sidebar icon.
 * @param props - sidebar icon size and active state.
 * @returns A simple chart glyph.
 */
export function FinanceDashboardPanelIcon({ size, active }: PropsRuntime<'sidebar.panellist'>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" data-active={active}>
      <path d="M4 19V5m0 14h16M7 15l3-4 3 2 4-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
