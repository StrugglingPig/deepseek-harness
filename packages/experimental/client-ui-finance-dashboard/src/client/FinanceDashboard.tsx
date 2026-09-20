/** Finance dashboard page: multi-asset quotes, TradingView-style chart, and stream status. */

import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  defaultSymbol,
  intervalsFor,
  watchlist,
  type DashboardAsset,
  type DashboardInterval,
} from './market-data.ts'
import type { FinanceDashboardFace, FinanceDashboardState } from './controller.ts'
import { TradingChart } from './TradingChart.tsx'
import css from './FinanceDashboard.module.css'

/** Props the Web shell binds for the finance dashboard page. */
export type FinanceDashboardProps =
  PropsRuntime<'main'>
  & PropsLocale<'financeDashboard'>
  & InjectFace<FinanceDashboardFace>

const ASSETS: readonly DashboardAsset[] = ['crypto', 'stock', 'us']

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
 * @returns The live multi-asset market dashboard.
 */
export function FinanceDashboard(props: FinanceDashboardProps) {
  const { t } = props
  const state = props.useDashboard(snapshot => snapshot)
  const latest = state.bars.at(-1)
  const currentAsset = state.asset ?? 'crypto'
  const [draft, setDraft] = useState(state.symbol ?? defaultSymbol(currentAsset))
  useEffect(() => { setDraft(state.symbol ?? defaultSymbol(currentAsset)) }, [state.symbol, currentAsset])
  const submit = (): void => { props.setSymbol(draft) }
  return (
    <section className={css.root}>
      <header className={css.header}>
        <div>
          <h1 className={css.title}>{t('title')}</h1>
          <p className={css.subtitle}>{t('subtitle')}</p>
        </div>
        <button type="button" className={css.button} onClick={props.refresh}>{t('refresh')}</button>
      </header>
      <div className={css.assetTabs} role="tablist" aria-label={t('asset')}>
        {ASSETS.map(option => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={currentAsset === option}
            className={css.assetTab}
            data-active={currentAsset === option ? 'true' : 'false'}
            onClick={() => { props.setAsset(option) }}
          >
            {t(option)}
          </button>
        ))}
      </div>
      <div className={css.controls}>
        <label className={css.control}>
          <span>{t('symbol')}</span>
          <input
            aria-label={t('symbol')}
            value={draft}
            onChange={(event) => { setDraft(event.target.value) }}
            onBlur={submit}
            onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
          />
        </label>
        <label className={css.control}>
          <span>{t('interval')}</span>
          <select aria-label={t('interval')} value={state.interval} onChange={(event) => { props.setInterval(event.target.value as DashboardInterval) }}>
            {intervalsFor(currentAsset).map(interval => <option key={interval} value={interval}>{interval}</option>)}
          </select>
        </label>
        <span className={css.stream} data-status={state.streamStatus}>{streamLabel(state.streamStatus, t)}</span>
      </div>
      <div className={css.watchlist} aria-label={t('watchlist')}>
        {watchlist(currentAsset).map(symbol => (
          <button key={symbol} type="button" className={css.watchItem} onClick={() => { props.setSymbol(symbol) }}>{symbol}</button>
        ))}
      </div>
      {state.status === 'loading' ? <p role="status" className={css.notice}>{t('loading')}</p> : null}
      {state.status === 'error' ? <p role="alert" className={css.error}>{t('error')}{state.error === undefined ? '' : `: ${state.error}`}</p> : null}
      {state.status === 'ready' && latest === undefined ? <p className={css.notice}>{t('empty')}</p> : null}
      {state.status === 'ready' && latest !== undefined ? (
        <>
          <div className={css.instrument}>
            <strong>{state.name ?? state.symbol}</strong>
            <span>{state.symbol} · {state.source} · {state.asOf?.slice(0, 19).replace('T', ' ') ?? ''}</span>
          </div>
          <div className={css.metrics}>
            <article><span>{t('close')}</span><strong>{formatNumber(state.quote?.price ?? latest.close)}</strong></article>
            <article><span>{t('change')}</span><strong data-direction={(state.quote?.changePercent ?? 0) >= 0 ? 'up' : 'down'}>{formatChange(state.quote?.changePercent)}</strong></article>
            <article><span>{t('volume')}</span><strong>{formatNumber(state.quote?.volume ?? latest.volume)}</strong></article>
            <article><span>{t('interval')}</span><strong>{state.interval}</strong></article>
          </div>
          <TradingChart bars={state.bars} interval={state.interval} chartLabel={t('chartLabel')} />
          <div className={css.legend}><span data-color="blue">SMA20</span><span data-color="amber">EMA12</span><span data-color="violet">RSI14</span><span data-color="sky">MACD</span></div>
        </>
      ) : null}
      <p className={css.accountNote}>{t('accountNote')}</p>
    </section>
  )
}

export { defaultSymbol }
