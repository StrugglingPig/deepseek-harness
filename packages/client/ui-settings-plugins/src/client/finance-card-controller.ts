/** Finance research provider settings and write-only Binance credentials. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CardForm, booleanField, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/** Host settings namespace owned by the finance research plugin. */
export const FINANCE_NS = 'finance-research'
/** Credential reference for the Binance API key. */
export const BINANCE_API_KEY_REF = 'FINANCE_BINANCE_API_KEY'
/** Credential reference for the Binance API secret. */
export const BINANCE_API_SECRET_REF = 'FINANCE_BINANCE_API_SECRET'

const API_KEY_FIELD = 'binanceApiKey'
const API_SECRET_FIELD = 'binanceApiSecret'

/** Non-secret fields this page edits. */
export interface FinanceSettings {
  provider?: string
  timeoutMs?: number
  barLimit?: number
  yahooBaseUrl?: string
  binanceBaseUrl?: string
  binanceUsdmBaseUrl?: string
  binanceCoinmBaseUrl?: string
  binanceOptionsBaseUrl?: string
  polymarketGammaBaseUrl?: string
  polymarketClobBaseUrl?: string
  enableSignedRequests?: boolean
  requestCacheTtlMs?: number
  requestCacheMaxEntries?: number
  requestMaxRetries?: number
  requestRetryBaseDelayMs?: number
  requestRetryMaxDelayMs?: number
  requestsPerMinute?: number
  requestBurst?: number
  binanceWebSocketBaseUrl?: string
  marketStreamTimeoutMs?: number
  marketStreamMaxEvents?: number
}

interface CredentialState {
  configured: boolean
  writable: boolean
}

/** Full state rendered by the finance settings page. */
export interface FinanceCardState extends CardShell {
  provider: CardFieldState
  timeoutMs: CardFieldState
  barLimit: CardFieldState
  yahooBaseUrl: CardFieldState
  binanceBaseUrl: CardFieldState
  binanceUsdmBaseUrl: CardFieldState
  binanceCoinmBaseUrl: CardFieldState
  binanceOptionsBaseUrl: CardFieldState
  polymarketGammaBaseUrl: CardFieldState
  polymarketClobBaseUrl: CardFieldState
  enableSignedRequests: CardFieldState
  requestCacheTtlMs: CardFieldState
  requestCacheMaxEntries: CardFieldState
  requestMaxRetries: CardFieldState
  requestRetryBaseDelayMs: CardFieldState
  requestRetryMaxDelayMs: CardFieldState
  requestsPerMinute: CardFieldState
  requestBurst: CardFieldState
  binanceWebSocketBaseUrl: CardFieldState
  marketStreamTimeoutMs: CardFieldState
  marketStreamMaxEvents: CardFieldState
  binanceApiKey: CardFieldState
  binanceApiSecret: CardFieldState
  binanceApiKeyConfigured: boolean
  binanceApiSecretConfigured: boolean
  binanceApiKeyWritable: boolean
  binanceApiSecretWritable: boolean
}

/** Registration-side face injected into the finance settings component. */
export interface FinanceCardFace extends CardActions {
  hooks: {
    financeCard: SnapshotStore<FinanceCardState>
  }
}

/** Bridges the finance settings namespace and the credentials domain. */
export class FinanceCardController {
  private readonly form: CardForm<FinanceSettings>
  private readonly store: SnapshotStore<FinanceCardState>
  private apiKey: CredentialState = { configured: false, writable: true }
  private apiSecret: CredentialState = { configured: false, writable: true }

  /**
   * @param scope - Bound `finance-research` settings scope.
   * @param ctx - Browser context exposing the credentials remote.
   */
  constructor(
    scope: SettingsScope<FinanceSettings>,
    private readonly ctx: ClientContext,
  ) {
    this.form = new CardForm(
      scope,
      [
        textField('provider'), numberField('timeoutMs'), numberField('barLimit'),
        textField('yahooBaseUrl'), textField('binanceBaseUrl'), textField('binanceUsdmBaseUrl'),
        textField('binanceCoinmBaseUrl'), textField('binanceOptionsBaseUrl'),
        textField('polymarketGammaBaseUrl'), textField('polymarketClobBaseUrl'),
        booleanField('enableSignedRequests'), numberField('requestCacheTtlMs'),
        numberField('requestCacheMaxEntries'), numberField('requestMaxRetries'),
        numberField('requestRetryBaseDelayMs'), numberField('requestRetryMaxDelayMs'),
        numberField('requestsPerMinute'), numberField('requestBurst'),
        textField('binanceWebSocketBaseUrl'), numberField('marketStreamTimeoutMs'),
        numberField('marketStreamMaxEvents'),
      ],
      [
        { field: API_KEY_FIELD, write: text => this.writeCredential(BINANCE_API_KEY_REF, text) },
        { field: API_SECRET_FIELD, write: text => this.writeCredential(BINANCE_API_SECRET_REF, text) },
      ],
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => { void this.readCredentials() })
    void this.readCredentials()
  }

  private projection(): FinanceCardState {
    return {
      ...this.form.shell(),
      provider: this.form.field('provider'),
      timeoutMs: this.form.field('timeoutMs'),
      barLimit: this.form.field('barLimit'),
      yahooBaseUrl: this.form.field('yahooBaseUrl'),
      binanceBaseUrl: this.form.field('binanceBaseUrl'),
      binanceUsdmBaseUrl: this.form.field('binanceUsdmBaseUrl'),
      binanceCoinmBaseUrl: this.form.field('binanceCoinmBaseUrl'),
      binanceOptionsBaseUrl: this.form.field('binanceOptionsBaseUrl'),
      polymarketGammaBaseUrl: this.form.field('polymarketGammaBaseUrl'),
      polymarketClobBaseUrl: this.form.field('polymarketClobBaseUrl'),
      enableSignedRequests: this.form.field('enableSignedRequests'),
      requestCacheTtlMs: this.form.field('requestCacheTtlMs'),
      requestCacheMaxEntries: this.form.field('requestCacheMaxEntries'),
      requestMaxRetries: this.form.field('requestMaxRetries'),
      requestRetryBaseDelayMs: this.form.field('requestRetryBaseDelayMs'),
      requestRetryMaxDelayMs: this.form.field('requestRetryMaxDelayMs'),
      requestsPerMinute: this.form.field('requestsPerMinute'),
      requestBurst: this.form.field('requestBurst'),
      binanceWebSocketBaseUrl: this.form.field('binanceWebSocketBaseUrl'),
      marketStreamTimeoutMs: this.form.field('marketStreamTimeoutMs'),
      marketStreamMaxEvents: this.form.field('marketStreamMaxEvents'),
      binanceApiKey: this.form.field(API_KEY_FIELD),
      binanceApiSecret: this.form.field(API_SECRET_FIELD),
      binanceApiKeyConfigured: this.apiKey.configured,
      binanceApiSecretConfigured: this.apiSecret.configured,
      binanceApiKeyWritable: this.apiKey.writable,
      binanceApiSecretWritable: this.apiSecret.writable,
    }
  }

  private async readCredentials(): Promise<void> {
    const response = await this.ctx.remote.credentials.describe([BINANCE_API_KEY_REF, BINANCE_API_SECRET_REF])
    if (!response.ok) return
    const apiKey = response.value[BINANCE_API_KEY_REF]
    const apiSecret = response.value[BINANCE_API_SECRET_REF]
    const nextKey = { configured: apiKey?.configured ?? false, writable: apiKey?.writable ?? true }
    const nextSecret = { configured: apiSecret?.configured ?? false, writable: apiSecret?.writable ?? true }
    if (nextKey.configured === this.apiKey.configured && nextKey.writable === this.apiKey.writable
      && nextSecret.configured === this.apiSecret.configured && nextSecret.writable === this.apiSecret.writable) return
    this.apiKey = nextKey
    this.apiSecret = nextSecret
    this.store.set(this.projection())
  }

  /**
   * Re-read status after a credential changes elsewhere.
   * @param ref - Changed credential reference.
   */
  refreshCredential(ref: string): void {
    if (ref === BINANCE_API_KEY_REF || ref === BINANCE_API_SECRET_REF) void this.readCredentials()
  }

  private async writeCredential(ref: string, value: string): Promise<boolean> {
    await this.ctx.remote.credentials.set(ref, value)
    await this.readCredentials()
    return ref === BINANCE_API_KEY_REF ? this.apiKey.configured : this.apiSecret.configured
  }

  /**
   * Build the face the component injects.
   * @returns Snapshot store and staged form actions.
   */
  inject(): FinanceCardFace {
    return { hooks: { financeCard: this.store }, ...this.form.actions() }
  }
}

/**
 * Read the current namespace value; exported for controller tests.
 * @param snapshot - Current bound settings snapshot.
 * @returns Effective finance settings or an empty section.
 */
export function financeScopeValue(snapshot: SettingsScopeSnapshot<FinanceSettings>): FinanceSettings {
  return snapshot.value ?? {}
}
