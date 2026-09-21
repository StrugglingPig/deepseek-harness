/** Dedicated indicator settings module: selection, parameters, and resets. */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  INDICATOR_GROUPS,
  INDICATORS,
  resolveIndicatorParameters,
  type IndicatorId,
} from './indicators.ts'
import type { IndicatorPreferences } from './indicator-store.ts'
import css from './IndicatorSettings.module.css'

/** Props the dashboard binds into the indicator settings module. */
export interface IndicatorSettingsProps {
  readonly preferences: IndicatorPreferences
  readonly t: PropsLocale<'financeDashboard'>['t']
  readonly onToggle: (id: IndicatorId) => void
  readonly onParameter: (id: IndicatorId, key: string, value: number) => void
  readonly onReset: (id: IndicatorId) => void
  readonly onResetAll: () => void
  readonly onClose: () => void
}

/**
 * Render the indicator settings dialog.
 * @param props - Persisted preferences, locale seat, and edit callbacks.
 * @returns The settings dialog.
 */
export function IndicatorSettings(props: IndicatorSettingsProps) {
  const { t, preferences } = props
  return (
    <div className={css.overlay} role="presentation" onClick={props.onClose}>
      <div
        className={css.dialog}
        role="dialog"
        aria-label={t('indicatorSettings')}
        onClick={(event) => { event.stopPropagation() }}
      >
        <header className={css.header}>
          <div>
            <h2 className={css.title}>{t('indicatorSettings')}</h2>
            <p className={css.hint}>{t('indicatorHint')}</p>
          </div>
          <span className={css.count}>{preferences.enabled.length} {t('indicatorEnabled')}</span>
        </header>
        <div className={css.body}>
          {INDICATOR_GROUPS.map(group => (
            <section key={group.placement} className={css.group} aria-label={t(group.labelKey)}>
              <h3 className={css.groupTitle}>{t(group.labelKey)}</h3>
              <ul className={css.list}>
                {INDICATORS.filter(spec => spec.placement === group.placement).map((spec) => {
                  const active = preferences.enabled.includes(spec.id)
                  const values = resolveIndicatorParameters(spec, preferences.parameters[spec.id])
                  return (
                    <li key={spec.id} className={css.row} data-active={active ? 'true' : 'false'}>
                      <label className={css.toggle}>
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => { props.onToggle(spec.id) }}
                        />
                        <span className={css.name}>{t(spec.labelKey)}</span>
                      </label>
                      <div className={css.parameters}>
                        {spec.parameters.map(parameter => (
                          <label key={parameter.key} className={css.parameter}>
                            <span>{t(parameter.labelKey)}</span>
                            <input
                              type="number"
                              min={parameter.min}
                              max={parameter.max}
                              step={parameter.step}
                              value={values[parameter.key]}
                              aria-label={`${t(spec.labelKey)} ${t(parameter.labelKey)}`}
                              onChange={(event) => {
                                props.onParameter(spec.id, parameter.key, Number(event.target.value))
                              }}
                            />
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        className={css.reset}
                        aria-label={`${t('indicatorReset')} ${t(spec.labelKey)}`}
                        onClick={() => { props.onReset(spec.id) }}
                      >
                        {t('indicatorReset')}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
        <footer className={css.footer}>
          <button type="button" className={css.action} onClick={props.onResetAll}>{t('indicatorResetAll')}</button>
          <button type="button" className={css.action} onClick={props.onClose}>{t('indicatorClose')}</button>
        </footer>
      </div>
    </div>
  )
}
