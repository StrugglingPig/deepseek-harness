/** Finance research settings page: non-secret provider config plus write-only Binance credentials. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PluginConfigForm } from './PluginConfigForm.tsx'
import { SecretField, ValueField } from './fields.tsx'
import css from './fields.module.css'
import type { FinanceCardFace } from './finance-card-controller.ts'

/** Props the settings shell binds for the Finance research page. */
export type FinanceSettingsPageProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<FinanceCardFace>

/**
 * Render the Finance research settings page.
 * @param props - locale copy, form snapshot, and staged actions.
 * @returns The configured settings form.
 */
export function FinanceSettingsPage(props: FinanceSettingsPageProps) {
  const { t } = props
  const state = props.useFinanceCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginConfigForm t={t} state={state} onSave={props.save} onDiscard={props.discard}>
      <p className={css.hint}>{t('financeSecurityNote')}</p>
      <div className={css.field}>
        <div className={css.head}>
          <label className={css.label} htmlFor="finance-provider">{t('financeProvider')}</label>
        </div>
        <select
          id="finance-provider"
          className={css.input}
          value={state.provider.text || 'fixture'}
          disabled={disabled}
          onChange={(event) => { props.edit('provider', event.target.value) }}
        >
          <option value="fixture">{t('financeProviderFixture')}</option>
          <option value="http">{t('financeProviderHttp')}</option>
        </select>
        <p className={css.hint}>{t('financeProviderHint')}</p>
      </div>
      <ValueField id="finance-timeout" label={t('financeTimeoutMs')} hint={t('financeTimeoutMsHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        numeric disabled={disabled} {...state.timeoutMs}
        onEdit={(text) => { props.edit('timeoutMs', text) }} onReset={() => { props.resetField('timeoutMs') }} />
      <ValueField id="finance-bar-limit" label={t('financeBarLimit')} hint={t('financeBarLimitHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        numeric disabled={disabled} {...state.barLimit}
        onEdit={(text) => { props.edit('barLimit', text) }} onReset={() => { props.resetField('barLimit') }} />
      {([
        ['yahooBaseUrl', 'financeYahooBaseUrl'],
        ['binanceBaseUrl', 'financeBinanceSpotBaseUrl'],
        ['binanceUsdmBaseUrl', 'financeBinanceUsdmBaseUrl'],
        ['binanceCoinmBaseUrl', 'financeBinanceCoinmBaseUrl'],
        ['binanceOptionsBaseUrl', 'financeBinanceOptionsBaseUrl'],
        ['polymarketGammaBaseUrl', 'financePolymarketGammaBaseUrl'],
        ['polymarketClobBaseUrl', 'financePolymarketClobBaseUrl'],
      ] as const).map(([field, label]) => (
        <ValueField
          key={field}
          id={`finance-${field}`}
          label={t(label)}
          hint={t('financeEndpointHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          disabled={disabled}
          {...state[field]}
          onEdit={(text) => { props.edit(field, text) }}
          onReset={() => { props.resetField(field) }}
        />
      ))}
      <div className={css.field}>
        <div className={css.head}>
          <label className={css.label} htmlFor="finance-signed-requests">{t('financeEnableSignedRequests')}</label>
        </div>
        <input
          id="finance-signed-requests"
          type="checkbox"
          checked={state.enableSignedRequests.text === 'true'}
          disabled={disabled}
          onChange={(event) => { props.edit('enableSignedRequests', event.target.checked ? 'true' : 'false') }}
        />
        <p className={css.hint}>{t('financeEnableSignedRequestsHint')}</p>
      </div>
      <h3 className={css.label}>{t('financeDeliveryTitle')}</h3>
      <ValueField id="finance-ws-base" label={t('financeBinanceWebSocketBaseUrl')} hint={t('financeEndpointHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        disabled={disabled} {...state.binanceWebSocketBaseUrl}
        onEdit={(text) => { props.edit('binanceWebSocketBaseUrl', text) }} onReset={() => { props.resetField('binanceWebSocketBaseUrl') }} />
      <ValueField id="finance-market-stream-timeout" label={t('financeMarketStreamTimeoutMs')} hint={t('financeMarketStreamTimeoutMsHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        numeric disabled={disabled} {...state.marketStreamTimeoutMs}
        onEdit={(text) => { props.edit('marketStreamTimeoutMs', text) }} onReset={() => { props.resetField('marketStreamTimeoutMs') }} />
      <ValueField id="finance-market-stream-max-events" label={t('financeMarketStreamMaxEvents')} hint={t('financeMarketStreamMaxEventsHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        numeric disabled={disabled} {...state.marketStreamMaxEvents}
        onEdit={(text) => { props.edit('marketStreamMaxEvents', text) }} onReset={() => { props.resetField('marketStreamMaxEvents') }} />
      <h3 className={css.label}>{t('financeTransportTitle')}</h3>
      {([
        ['requestCacheTtlMs', 'financeRequestCacheTtlMs', 'financeRequestCacheTtlMsHint'],
        ['requestCacheMaxEntries', 'financeRequestCacheMaxEntries', 'financeRequestCacheMaxEntriesHint'],
        ['requestMaxRetries', 'financeRequestMaxRetries', 'financeRequestMaxRetriesHint'],
        ['requestRetryBaseDelayMs', 'financeRequestRetryBaseDelayMs', 'financeRequestRetryBaseDelayMsHint'],
        ['requestRetryMaxDelayMs', 'financeRequestRetryMaxDelayMs', 'financeRequestRetryMaxDelayMsHint'],
        ['requestsPerMinute', 'financeRequestsPerMinute', 'financeRequestsPerMinuteHint'],
        ['requestBurst', 'financeRequestBurst', 'financeRequestBurstHint'],
      ] as const).map(([field, label, hint]) => (
        <ValueField
          key={field}
          id={`finance-${field}`}
          label={t(label)}
          hint={t(hint)}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          numeric
          disabled={disabled}
          {...state[field]}
          onEdit={(text) => { props.edit(field, text) }}
          onReset={() => { props.resetField(field) }}
        />
      ))}
      <SecretField
        id="finance-binance-api-key"
        label={t('financeBinanceApiKey')}
        hint={t('financeBinanceApiKeyHint')}
        disabled={!state.binanceApiKeyWritable}
        text={state.binanceApiKey.text}
        configured={state.binanceApiKeyConfigured}
        stateLabel={state.binanceApiKeyConfigured ? t('financeCredentialSet') : t('financeCredentialUnset')}
        onEdit={(text) => { props.edit('binanceApiKey', text) }}
      />
      <SecretField
        id="finance-binance-api-secret"
        label={t('financeBinanceApiSecret')}
        hint={t('financeBinanceApiSecretHint')}
        disabled={!state.binanceApiSecretWritable}
        text={state.binanceApiSecret.text}
        configured={state.binanceApiSecretConfigured}
        stateLabel={state.binanceApiSecretConfigured ? t('financeCredentialSet') : t('financeCredentialUnset')}
        onEdit={(text) => { props.edit('binanceApiSecret', text) }}
      />
    </PluginConfigForm>
  )
}
