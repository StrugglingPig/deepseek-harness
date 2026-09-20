/** Browser entry for the finance research dashboard panel. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { FinanceDashboard } from './FinanceDashboard.tsx'
import { FinanceDashboardPanelIcon } from './FinanceDashboardPanelIcon.tsx'
import { FinanceDashboardController } from './controller.ts'
import { en, NS, zh, type FinanceDashboardLocaleKey } from './locales.ts'

export type { FinanceDashboardProps } from './FinanceDashboard.tsx'
export type { DashboardInterval, FinanceDashboardFace, FinanceDashboardState } from './controller.ts'
export type { FinanceDashboardLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Finance dashboard copy. */
    financeDashboard: FinanceDashboardLocaleKey
  }
}

/** The finance settings namespace that owns dashboard endpoints. */
export const FINANCE_NS = 'finance-research'
/** Shared id for the main panel and its sidebar entry. */
export const PANEL_ID = 'finance-dashboard' as MainPanelId

/** Services required by the dashboard registration. */
export const inject = ['slots', 'locale', 'settingsScope']

/** Interval between re-reading the served finance namespace. */
const SYNC_EVENT = 'connection/reset'

/**
 * Register the finance dashboard when the finance settings namespace is served.
 * @param ctx - Browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'finance-dashboard: dictionaries')
  const t = ctx.locale.bind(NS)
  const scope = ctx.settingsScope.bind<{
    readonly binanceBaseUrl?: string
    readonly binanceWebSocketBaseUrl?: string
  }>({ namespace: FINANCE_NS })
  const controller = new FinanceDashboardController(scope)
  ctx.effect(() => () => { controller.dispose() }, 'finance-dashboard: controller')
  const describe = ctx.settingsScope.describe()
  ctx.effect(() => {
    let registered: (() => void) | undefined
    const sync = (): void => {
      const served = describe.getSnapshot().view?.namespaces.some(namespace => namespace.ns === FINANCE_NS) ?? false
      if (served && registered === undefined) {
        const disposeMain = ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => controller.inject(),
        }, FinanceDashboard))
        const disposeSidebar = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 25,
          label: () => t('title'),
          locale: NS,
        }, FinanceDashboardPanelIcon))
        registered = () => {
          disposeMain()
          disposeSidebar()
        }
      } else if (!served && registered !== undefined) {
        registered()
        registered = undefined
      }
    }
    const unsubscribe = describe.subscribe(sync)
    void describe.ensure()
    const reset = (): void => { void describe.ensure() }
    const offReset = ctx.on(SYNC_EVENT, reset)
    sync()
    return () => {
      unsubscribe()
      offReset()
      registered?.()
      registered = undefined
    }
  }, 'finance-dashboard: registration')
}
