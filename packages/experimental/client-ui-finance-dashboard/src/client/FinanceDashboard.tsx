/** Finance dashboard page: live chart, quote metrics, and stream status. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { chartPath } from './market-data.ts'
import type { DashboardInterval, FinanceDashboardFace, FinanceDashboardState } from './controller.ts'
import css from './FinanceDashboard.module.css'

/** Props the Web shell binds for the finance dashboard page. */
export type FinanceDashboardProps =
  PropsRuntime<'main'>
  & PropsLocale<'financeDashboard'>
  & InjectFace<FinanceDashboardFace>

const INTERVALS: readonly DashboardInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d']

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatChange(value: number | undefined): string {
  if (value === undefined) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function streamLabel(status: FinanceDashboardState['streamStatus'], t: FinanceDashboardProps['t']): string {
  if (status === 'live') return t('live')
  if (status === 'connecting') return t('connecting')
  return t('offline')
}

/**
 * Render the finance dashboard panel.
 * @param props - locale copy, dashboard snapshot, and actions.
 * @returns The live market dashboard.
 */
export function FinanceDashboard(props: FinanceDashboardProps) {
  const { t } = props
  const state = props.useDashboard(snapshot => snapshot)
  const latest = state.bars.at(-1)
  return (
    <section className={css.root}>
      <header className={css.header}>
        <div>
          <h1 className={css.title}>{t('title')}</h1>
          <p className={css.subtitle}>{t('subtitle')}</p>
        </div>
        <button type="button" className={css.button} onClick={props.refresh}>{t('refresh')}</button>
      </header>
      <div className={css.controls}>
        <label className={css.control}>
          <span>{t('symbol')}</span>
          <input aria-label={t('symbol')} value={state.symbol} onChange={(event) => { props.setSymbol(event.target.value) }} />
        </label>
        <label className={css.control}>
          <span>{t('interval')}</span>
          <select aria-label={t('interval')} value={state.interval} onChange={(event) => { props.setInterval(event.target.value as DashboardInterval) }}>
            {INTERVALS.map(interval => <option key={interval} value={interval}>{interval}</option>)}
          </select>
        </label>
        <span className={css.stream} data-status={state.streamStatus}>{streamLabel(state.streamStatus, t)}</span>
      </div>
      {state.status === 'loading' ? <p role="status" className={css.notice}>{t('loading')}</p> : null}
      {state.status === 'error' ? <p role="alert" className={css.error}>{t('error')}{state.error === undefined ? '' : `: ${state.error}`}</p> : null}
      {state.status === 'ready' && latest === undefined ? <p className={css.notice}>{t('empty')}</p> : null}
      {state.status === 'ready' && latest !== undefined ? (
        <>
          <div className={css.metrics}>
            <article><span>{t('close')}</span><strong>{formatNumber(state.latestPrice ?? latest.close)}</strong></article>
            <article><span>{t('change')}</span><strong data-direction={(state.changePercent ?? 0) >= 0 ? 'up' : 'down'}>{formatChange(state.changePercent)}</strong></article>
            <article><span>{t('volume')}</span><strong>{formatNumber(latest.volume)}</strong></article>
          </div>
          <div className={css.chart} data-testid="finance-chart">
            <svg viewBox="0 0 600 220" role="img" aria-label={t('chartLabel')}>
              <path d={chartPath(state.bars, 600, 220)} className={css.line} />
            </svg>
          </div>
        </>
      ) : null}
      <p className={css.accountNote}>{t('accountNote')}</p>
    </section>
  )
}
