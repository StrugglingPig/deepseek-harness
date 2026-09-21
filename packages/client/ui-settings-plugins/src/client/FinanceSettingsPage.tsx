/** Finance research settings page: non-secret provider config plus write-only Binance credentials. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PluginConfigForm } from './PluginConfigForm.tsx'
import { NumericValueField, SecretField, ValueField } from './fields.tsx'
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
      {/* jscpd:ignore-start -- rows restate the shared NumericValueField props */}
      <NumericValueField id="finance-timeout" label={t('financeTimeoutMs')} hint={t('financeTimeoutMsHint')}
        copy={{ overridden: t('overridden'), reset: t('reset'), invalidNumber: t('invalidNumber') }}
        disabled={disabled} field={state.timeoutMs}
        onEdit={(text) => { props.edit('timeoutMs', text) }} onReset={() => { props.resetField('timeoutMs') }} />
      <NumericValueField id="finance-bar-limit" label={t('financeBarLimit')} hint={t('financeBarLimitHint')}
        copy={{ overridden: t('overridden'), reset: t('reset'), invalidNumber: t('invalidNumber') }}
        disabled={disabled} field={state.barLimit}
        onEdit={(text) => { props.edit('barLimit', text) }} onReset={() => { props.resetField('barLimit') }} />
      {/* jscpd:ignore-end */}
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
      <h3 className={css.label}>{t('financeStockTitle')}</h3>
      <div className={css.field}>
        <div className={css.head}>
          <label className={css.label} htmlFor="finance-enable-akshare">{t('financeEnableAkshare')}</label>
        </div>
        <input
          id="finance-enable-akshare"
          type="checkbox"
          checked={state.enableAkshare.text === 'true'}
          disabled={disabled}
          onChange={(event) => { props.edit('enableAkshare', event.target.checked ? 'true' : 'false') }}
        />
        <p className={css.hint}>{t('financeEnableAkshareHint')}</p>
      </div>
      <div className={css.field}>
        <div className={css.head}>
          <label className={css.label} htmlFor="finance-enable-ifind">{t('financeEnableIfind')}</label>
        </div>
        <input
          id="finance-enable-ifind"
          type="checkbox"
          checked={state.enableIfind.text === 'true'}
          disabled={disabled}
          onChange={(event) => { props.edit('enableIfind', event.target.checked ? 'true' : 'false') }}
        />
        <p className={css.hint}>{t('financeEnableIfindHint')}</p>
      </div>
      <div className={css.field}>
        <div className={css.head}>
          <label className={css.label} htmlFor="finance-ifind-transport">{t('financeIfindTransport')}</label>
        </div>
        <select
          id="finance-ifind-transport"
          className={css.input}
          value={state.ifindTransport.text || 'http'}
          disabled={disabled}
          onChange={(event) => { props.edit('ifindTransport', event.target.value) }}
        >
          <option value="http">{t('financeIfindTransportHttp')}</option>
          <option value="local">{t('financeIfindTransportLocal')}</option>
        </select>
        <p className={css.hint}>{t('financeIfindTransportHint')}</p>
      </div>
      <ValueField id="finance-ifind-base-url" label={t('financeIfindBaseUrl')} hint={t('financeIfindBaseUrlHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        disabled={disabled} {...state.ifindBaseUrl}
        onEdit={(text) => { props.edit('ifindBaseUrl', text) }} onReset={() => { props.resetField('ifindBaseUrl') }} />
      <ValueField id="finance-python-executable" label={t('financePythonExecutable')} hint={t('financePythonExecutableHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        disabled={disabled} {...state.pythonExecutable}
        onEdit={(text) => { props.edit('pythonExecutable', text) }} onReset={() => { props.resetField('pythonExecutable') }} />
      <ValueField id="finance-stock-bridge-timeout" label={t('financeStockBridgeTimeoutMs')} hint={t('financeStockBridgeTimeoutMsHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        numeric disabled={disabled} {...state.stockBridgeTimeoutMs}
        onEdit={(text) => { props.edit('stockBridgeTimeoutMs', text) }} onReset={() => { props.resetField('stockBridgeTimeoutMs') }} />
      <ValueField id="finance-stock-bridge-max-output" label={t('financeStockBridgeMaxOutputBytes')} hint={t('financeStockBridgeMaxOutputBytesHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        numeric disabled={disabled} {...state.stockBridgeMaxOutputBytes}
        onEdit={(text) => { props.edit('stockBridgeMaxOutputBytes', text) }} onReset={() => { props.resetField('stockBridgeMaxOutputBytes') }} />
      <SecretField
        id="finance-ifind-refresh-token"
        label={t('financeIfindRefreshToken')}
        hint={t('financeIfindRefreshTokenHint')}
        disabled={!state.ifindRefreshTokenWritable}
        text={state.ifindRefreshToken.text}
        configured={state.ifindRefreshTokenConfigured}
        stateLabel={state.ifindRefreshTokenConfigured ? t('financeCredentialSet') : t('financeCredentialUnset')}
        onEdit={(text) => { props.edit('ifindRefreshToken', text) }}
      />
      <SecretField
        id="finance-ifind-user"
        label={t('financeIfindUser')}
        hint={t('financeIfindUserHint')}
        disabled={!state.ifindUserWritable}
        text={state.ifindUser.text}
        configured={state.ifindUserConfigured}
        stateLabel={state.ifindUserConfigured ? t('financeCredentialSet') : t('financeCredentialUnset')}
        onEdit={(text) => { props.edit('ifindUser', text) }}
      />
      <SecretField
        id="finance-ifind-password"
        label={t('financeIfindPassword')}
        hint={t('financeIfindPasswordHint')}
        disabled={!state.ifindPasswordWritable}
        text={state.ifindPassword.text}
        configured={state.ifindPasswordConfigured}
        stateLabel={state.ifindPasswordConfigured ? t('financeCredentialSet') : t('financeCredentialUnset')}
        onEdit={(text) => { props.edit('ifindPassword', text) }}
      />
      <h3 className={css.label}>{t('financeCoinMarketCapTitle')}</h3>
      <div className={css.field}>
        <div className={css.head}>
          <label className={css.label} htmlFor="finance-enable-coinmarketcap">{t('financeEnableCoinMarketCapRequests')}</label>
        </div>
        <input
          id="finance-enable-coinmarketcap"
          type="checkbox"
          checked={state.enableCoinMarketCapRequests.text === 'true'}
          disabled={disabled}
          onChange={(event) => { props.edit('enableCoinMarketCapRequests', event.target.checked ? 'true' : 'false') }}
        />
        <p className={css.hint}>{t('financeEnableCoinMarketCapRequestsHint')}</p>
      </div>
      <ValueField id="finance-coinmarketcap-base" label={t('financeCoinMarketCapBaseUrl')} hint={t('financeEndpointHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        disabled={disabled} {...state.coinMarketCapBaseUrl}
        onEdit={(text) => { props.edit('coinMarketCapBaseUrl', text) }} onReset={() => { props.resetField('coinMarketCapBaseUrl') }} />
      <ValueField id="finance-coinmarketcap-ws" label={t('financeCoinMarketCapWebSocketBaseUrl')} hint={t('financeEndpointHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        disabled={disabled} {...state.coinMarketCapWebSocketBaseUrl}
        onEdit={(text) => { props.edit('coinMarketCapWebSocketBaseUrl', text) }} onReset={() => { props.resetField('coinMarketCapWebSocketBaseUrl') }} />
      <SecretField
        id="finance-coinmarketcap-api-key"
        label={t('financeCoinMarketCapApiKey')}
        hint={t('financeCoinMarketCapApiKeyHint')}
        disabled={!state.coinMarketCapApiKeyWritable}
        text={state.coinMarketCapApiKey.text}
        configured={state.coinMarketCapApiKeyConfigured}
        stateLabel={state.coinMarketCapApiKeyConfigured ? t('financeCredentialSet') : t('financeCredentialUnset')}
        onEdit={(text) => { props.edit('coinMarketCapApiKey', text) }}
      />
      <h3 className={css.label}>{t('financeFredTitle')}</h3>
      <div className={css.field}>
        <div className={css.head}>
          <label className={css.label} htmlFor="finance-enable-fred">{t('financeEnableFredRequests')}</label>
        </div>
        <input
          id="finance-enable-fred"
          type="checkbox"
          checked={state.enableFredRequests.text === 'true'}
          disabled={disabled}
          onChange={(event) => { props.edit('enableFredRequests', event.target.checked ? 'true' : 'false') }}
        />
        <p className={css.hint}>{t('financeEnableFredRequestsHint')}</p>
      </div>
      <ValueField id="finance-fred-base" label={t('financeFredBaseUrl')} hint={t('financeEndpointHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        disabled={disabled} {...state.fredBaseUrl}
        onEdit={(text) => { props.edit('fredBaseUrl', text) }} onReset={() => { props.resetField('fredBaseUrl') }} />
      <SecretField
        id="finance-fred-api-key"
        label={t('financeFredApiKey')}
        hint={t('financeFredApiKeyHint')}
        disabled={!state.fredApiKeyWritable}
        text={state.fredApiKey.text}
        configured={state.fredApiKeyConfigured}
        stateLabel={state.fredApiKeyConfigured ? t('financeCredentialSet') : t('financeCredentialUnset')}
        onEdit={(text) => { props.edit('fredApiKey', text) }}
      />
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
