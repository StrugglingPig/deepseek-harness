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
import { IndicatorSettings } from './IndicatorSettings.tsx'
import { INDICATOR_COLORS, indicatorParameterSuffix, resolveIndicators } from './indicators.ts'
import { TradingChart } from './TradingChart.tsx'
import css from './FinanceDashboard.module.css'

/** Props the Web shell binds for the finance dashboard page. */
export type FinanceDashboardProps =
  PropsRuntime<'main'>
  & PropsLocale<'financeDashboard'>
  & InjectFace<FinanceDashboardFace>

const ASSETS: readonly DashboardAsset[] = ['crypto', 'stock', 'us']

/**
 * Placeholder artwork for the empty and loading panel state.
 * @returns The inline glyph.
 */
function EmptyGlyph() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
      <rect x="6.5" y="8.5" width="31" height="27" rx="4" stroke="currentColor" strokeWidth="2" />
      <path d="M6.5 14.5h31" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M11 29.5l5.5-6.5 4.5 4.5 3.5-4.5L31 29.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

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
  const ACTION_LABELS = {
    accumulate: 'actionAccumulate',
    hold: 'actionHold',
    reduce: 'actionReduce',
    watch: 'actionWatch',
    avoid: 'actionAvoid',
  } as const
  const indicatorLabel = (indicator: (typeof indicators)[number]): string =>
    `${t(indicator.spec.labelKey)}${indicatorParameterSuffix(indicator.spec, indicator.values)}`
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
          aria-haspopup="dialog"
          aria-expanded={showIndicators}
          onClick={() => { setShowIndicators(!showIndicators) }}
        >
          {t('indicators')}
        </button>
        <div className={css.legend}>
          {indicators.map(indicator => (
            <span key={indicator.id} style={{ color: INDICATOR_COLORS[indicator.id] }}>
              {indicatorLabel(indicator)}
            </span>
          ))}
        </div>
      </div>
      {!showIndicators ? null : (
        <IndicatorSettings
          preferences={preferences}
          t={t}
          onToggle={props.toggleIndicator}
          onParameter={props.setIndicatorParameter}
          onReset={props.resetIndicator}
          onResetAll={props.resetIndicators}
          onClose={() => { setShowIndicators(false) }}
        />
      )}
      {latest !== undefined ? null : (
        <div className={css.empty} data-status={state.status} data-testid="finance-empty">
          <span className={css.emptyGlyph} aria-hidden><EmptyGlyph /></span>
          <p role="status" className={css.emptyTitle}>
            {state.status === 'loading' ? t('loading') : t('emptyTitle')}
          </p>
          {state.status === 'loading' ? null : (
            <>
              <p className={css.emptyHint}>{t('emptyHint')}</p>
              <button type="button" className={css.button} onClick={props.refresh}>{t('refresh')}</button>
            </>
          )}
          {state.error === undefined ? null : (
            <details className={css.emptyDetails}>
              <summary>{t('emptyDetails')}</summary>
              <p>{state.error}</p>
            </details>
          )}
        </div>
      )}
      {/* A poll or a failed reload keeps the last snapshot mounted: unmounting it
          would drop the reader's scroll position on every interval. */}
      {latest === undefined ? null : (
        <>
          <div className={css.instrument}>
            <strong>{state.name ?? state.symbol}</strong>
            <span>{state.symbol} · {state.source} · {state.asOf?.slice(0, 19).replace('T', ' ') ?? ''}</span>
          </div>
          {state.research === undefined ? null : (
            <section className={css.research} aria-label={t('researchTitle')}>
              <header>
                <strong>{t('researchTitle')}</strong>
                <span>
                  {state.research.source}
                  {state.research.reportedPeriod === '' ? '' : ` · ${t('researchReported')} ${state.research.reportedPeriod}`}
                </span>
              </header>
              <div className={css.researchGrid}>
                <article>
                  <span>{t('researchRange')}</span>
                  <strong>
                    {state.research.range === undefined
                      ? t('researchMissing')
                      : `${formatNumber(state.research.range.low)} – ${formatNumber(state.research.range.high)}`}
                  </strong>
                </article>
                <article>
                  <span>{t('researchWeighted')}</span>
                  <strong>{state.research.range === undefined ? t('researchMissing') : formatNumber(state.research.range.weighted)}</strong>
                </article>
                <article>
                  <span>{t('researchGrade')}</span>
                  <strong>{state.research.grade ?? t('researchMissing')}</strong>
                </article>
                <article>
                  <span>{t('researchAction')}</span>
                  <strong>{state.research.action === undefined
                    ? t('researchMissing')
                    : t(ACTION_LABELS[state.research.action])}</strong>
                </article>
                <article>
                  <span>{t('researchNextEarnings')}</span>
                  <strong>{state.research.nextEarnings ?? t('researchMissing')}</strong>
                </article>
              </div>
              <ul className={css.researchRatios}>
                {state.research.ratios.map(reading => (
                  <li key={reading.id}>
                    <span>{t(reading.id)}</span>
                    <strong>{reading.value === undefined ? t('researchMissing') : formatNumber(reading.value)}</strong>
                  </li>
                ))}
              </ul>
              <p>{t('researchNote')}</p>
            </section>
          )}
          <div className={css.metrics}>
            <article><span>{t('close')}</span><strong>{formatNumber(state.quote?.price ?? latest.close)}</strong></article>
            <article><span>{t('change')}</span><strong data-direction={(state.quote?.changePercent ?? 0) >= 0 ? 'up' : 'down'}>{formatChange(state.quote?.changePercent)}</strong></article>
            <article><span>{t('volume')}</span><strong>{formatNumber(state.quote?.volume ?? latest.volume)}</strong></article>
            <article><span>{t('interval')}</span><strong>{state.interval}</strong></article>
          </div>
          <TradingChart
            bars={state.bars}
            interval={state.interval}
            chartLabel={t('chartLabel')}
            indicators={indicators}
            labelOf={indicatorLabel}
          />
        </>
      )}
      <p className={css.accountNote}>{t('accountNote')}</p>
    </section>
  )
}

export { defaultSymbol }
