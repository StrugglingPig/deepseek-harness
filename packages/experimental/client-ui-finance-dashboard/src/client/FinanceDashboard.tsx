/** Finance dashboard page: multi-asset quotes, TradingView-style chart, and request status. */

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
import { INDICATOR_COLORS, INDICATORS, indicatorParameterSuffix, resolveIndicatorParameters, resolveIndicators } from './indicators.ts'
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
  const preferences = props.useIndicators(snapshot => snapshot)
  const latest = state.bars.at(-1)
  const currentAsset = state.asset
  const indicators = resolveIndicators(preferences.enabled, preferences.parameters)
  const [draft, setDraft] = useState(state.symbol)
  const [showIndicators, setShowIndicators] = useState(false)
  useEffect(() => { setDraft(state.symbol) }, [state.symbol, currentAsset])
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
      <div className={css.indicators}>
        <button
          type="button"
          className={css.button}
          aria-expanded={showIndicators}
          onClick={() => { setShowIndicators(!showIndicators) }}
        >
          {t('indicators')}
        </button>
        {!showIndicators ? null : (
          <div className={css.indicatorPanel} role="group" aria-label={t('indicators')}>
            {INDICATORS.map((spec) => {
              const active = preferences.enabled.includes(spec.id)
              const values = resolveIndicatorParameters(spec, preferences.parameters[spec.id])
              return (
                <div key={spec.id} className={css.indicatorRow}>
                  <label className={css.indicatorToggle}>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => { props.toggleIndicator(spec.id) }}
                    />
                    <span>{t(spec.labelKey)}</span>
                  </label>
                  {!active ? null : spec.parameters.map(parameter => (
                    <label key={parameter.key} className={css.indicatorParam}>
                      <span>{t(parameter.labelKey)}</span>
                      <input
                        type="number"
                        min={parameter.min}
                        max={parameter.max}
                        step={parameter.step}
                        value={values[parameter.key]}
                        aria-label={`${t(spec.labelKey)} ${t(parameter.labelKey)}`}
                        onChange={(event) => { props.setIndicatorParameter(spec.id, parameter.key, Number(event.target.value)) }}
                      />
                    </label>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {state.status === 'loading' && latest === undefined ? <p role="status" className={css.notice}>{t('loading')}</p> : null}
      {state.status === 'error' ? <p role="alert" className={css.error}>{t('error')}{state.error === undefined ? '' : `: ${state.error}`}</p> : null}
      {state.status === 'ready' && latest === undefined ? <p className={css.notice}>{t('empty')}</p> : null}
      {/* A poll or a failed reload keeps the last snapshot mounted: unmounting it
          would drop the reader's scroll position on every interval. */}
      {latest === undefined ? null : (
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
          <TradingChart bars={state.bars} interval={state.interval} chartLabel={t('chartLabel')} indicators={indicators} />
          <div className={css.legend}>
            {indicators.map(indicator => (
              <span key={indicator.id} style={{ color: INDICATOR_COLORS[indicator.id] }}>
                {t(indicator.spec.labelKey)}{indicatorParameterSuffix(indicator.spec, indicator.values)}
              </span>
            ))}
          </div>
        </>
      )}
      <p className={css.accountNote}>{t('accountNote')}</p>
    </section>
  )
}

export { defaultSymbol }
