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
/** Credential reference for the CoinMarketCap API key. */
export const COINMARKETCAP_API_KEY_REF = 'FINANCE_COINMARKETCAP_API_KEY'
/** Credential reference for the CoinGecko demo API key. */
export const COINGECKO_API_KEY_REF = 'FINANCE_COINGECKO_API_KEY'
/** Credential reference for the optional GitHub token. */
export const GITHUB_TOKEN_REF = 'FINANCE_GITHUB_TOKEN'
/** Credential reference for the FRED API key. */
export const FRED_API_KEY_REF = 'FINANCE_FRED_API_KEY'
/** Credential reference for the iFinD account. */
export const IFIND_USER_REF = 'FINANCE_IFIND_USER'
/** Credential reference for the iFinD password. */
export const IFIND_PASSWORD_REF = 'FINANCE_IFIND_PASSWORD'
/** Credential reference for the iFinD HTTP API refresh token. */
export const IFIND_REFRESH_TOKEN_REF = 'FINANCE_IFIND_REFRESH_TOKEN'

const API_KEY_FIELD = 'binanceApiKey'
const API_SECRET_FIELD = 'binanceApiSecret'
const COINMARKETCAP_API_KEY_FIELD = 'coinMarketCapApiKey'
const COINGECKO_API_KEY_FIELD = 'coinGeckoApiKey'
const GITHUB_TOKEN_FIELD = 'githubToken'
const FRED_API_KEY_FIELD = 'fredApiKey'
const IFIND_USER_FIELD = 'ifindUser'
const IFIND_PASSWORD_FIELD = 'ifindPassword'
const IFIND_REFRESH_TOKEN_FIELD = 'ifindRefreshToken'

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
  coinMarketCapBaseUrl?: string
  coinGeckoBaseUrl?: string
  fredBaseUrl?: string
  enableSignedRequests?: boolean
  enableCoinMarketCapRequests?: boolean
  enableCoinGeckoRequests?: boolean
  enableFredRequests?: boolean
  enableAkshare?: boolean
  enableIfind?: boolean
  ifindTransport?: string
  ifindBaseUrl?: string
  pythonExecutable?: string
  stockBridgeTimeoutMs?: number
  stockBridgeMaxOutputBytes?: number
  requestCacheTtlMs?: number
  requestCacheMaxEntries?: number
  requestMaxRetries?: number
  requestRetryBaseDelayMs?: number
  requestRetryMaxDelayMs?: number
  requestsPerMinute?: number
  requestBurst?: number
  binanceWebSocketBaseUrl?: string
  coinMarketCapWebSocketBaseUrl?: string
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
  coinMarketCapBaseUrl: CardFieldState
  coinGeckoBaseUrl: CardFieldState
  fredBaseUrl: CardFieldState
  enableSignedRequests: CardFieldState
  enableCoinMarketCapRequests: CardFieldState
  enableCoinGeckoRequests: CardFieldState
  enableFredRequests: CardFieldState
  enableAkshare: CardFieldState
  enableIfind: CardFieldState
  ifindTransport: CardFieldState
  ifindBaseUrl: CardFieldState
  pythonExecutable: CardFieldState
  stockBridgeTimeoutMs: CardFieldState
  stockBridgeMaxOutputBytes: CardFieldState
  requestCacheTtlMs: CardFieldState
  requestCacheMaxEntries: CardFieldState
  requestMaxRetries: CardFieldState
  requestRetryBaseDelayMs: CardFieldState
  requestRetryMaxDelayMs: CardFieldState
  requestsPerMinute: CardFieldState
  requestBurst: CardFieldState
  binanceWebSocketBaseUrl: CardFieldState
  coinMarketCapWebSocketBaseUrl: CardFieldState
  marketStreamTimeoutMs: CardFieldState
  marketStreamMaxEvents: CardFieldState
  binanceApiKey: CardFieldState
  binanceApiSecret: CardFieldState
  coinMarketCapApiKey: CardFieldState
  coinGeckoApiKey: CardFieldState
  githubToken: CardFieldState
  fredApiKey: CardFieldState
  ifindUser: CardFieldState
  ifindPassword: CardFieldState
  ifindRefreshToken: CardFieldState
  binanceApiKeyConfigured: boolean
  binanceApiSecretConfigured: boolean
  coinMarketCapApiKeyConfigured: boolean
  coinGeckoApiKeyConfigured: boolean
  githubTokenConfigured: boolean
  fredApiKeyConfigured: boolean
  ifindUserConfigured: boolean
  ifindPasswordConfigured: boolean
  ifindRefreshTokenConfigured: boolean
  binanceApiKeyWritable: boolean
  binanceApiSecretWritable: boolean
  coinMarketCapApiKeyWritable: boolean
  coinGeckoApiKeyWritable: boolean
  githubTokenWritable: boolean
  fredApiKeyWritable: boolean
  ifindUserWritable: boolean
  ifindPasswordWritable: boolean
  ifindRefreshTokenWritable: boolean
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
  private coinMarketCapApiKey: CredentialState = { configured: false, writable: true }
  private coinGeckoApiKey: CredentialState = { configured: false, writable: true }
  private githubToken: CredentialState = { configured: false, writable: true }
  private fredApiKey: CredentialState = { configured: false, writable: true }
  private ifindUser: CredentialState = { configured: false, writable: true }
  private ifindPassword: CredentialState = { configured: false, writable: true }
  private ifindRefreshToken: CredentialState = { configured: false, writable: true }

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
        textField('coinMarketCapBaseUrl'), textField('coinGeckoBaseUrl'), textField('fredBaseUrl'),
        booleanField('enableSignedRequests'), booleanField('enableCoinMarketCapRequests'),
        booleanField('enableCoinGeckoRequests'),
        booleanField('enableFredRequests'),
        booleanField('enableAkshare'), booleanField('enableIfind'),
        textField('ifindTransport'), textField('ifindBaseUrl'),
        textField('pythonExecutable'), numberField('stockBridgeTimeoutMs'),
        numberField('stockBridgeMaxOutputBytes'), numberField('requestCacheTtlMs'),
        numberField('requestCacheMaxEntries'), numberField('requestMaxRetries'),
        numberField('requestRetryBaseDelayMs'), numberField('requestRetryMaxDelayMs'),
        numberField('requestsPerMinute'), numberField('requestBurst'),
        textField('binanceWebSocketBaseUrl'), textField('coinMarketCapWebSocketBaseUrl'),
        numberField('marketStreamTimeoutMs'), numberField('marketStreamMaxEvents'),
      ],
      [
        { field: API_KEY_FIELD, write: text => this.writeCredential(BINANCE_API_KEY_REF, text) },
        { field: API_SECRET_FIELD, write: text => this.writeCredential(BINANCE_API_SECRET_REF, text) },
        { field: COINMARKETCAP_API_KEY_FIELD, write: text => this.writeCredential(COINMARKETCAP_API_KEY_REF, text) },
        { field: COINGECKO_API_KEY_FIELD, write: text => this.writeCredential(COINGECKO_API_KEY_REF, text) },
        { field: GITHUB_TOKEN_FIELD, write: text => this.writeCredential(GITHUB_TOKEN_REF, text) },
        { field: FRED_API_KEY_FIELD, write: text => this.writeCredential(FRED_API_KEY_REF, text) },
        { field: IFIND_USER_FIELD, write: text => this.writeCredential(IFIND_USER_REF, text) },
        { field: IFIND_PASSWORD_FIELD, write: text => this.writeCredential(IFIND_PASSWORD_REF, text) },
        { field: IFIND_REFRESH_TOKEN_FIELD, write: text => this.writeCredential(IFIND_REFRESH_TOKEN_REF, text) },
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
      coinMarketCapBaseUrl: this.form.field('coinMarketCapBaseUrl'),
      coinGeckoBaseUrl: this.form.field('coinGeckoBaseUrl'),
      fredBaseUrl: this.form.field('fredBaseUrl'),
      enableSignedRequests: this.form.field('enableSignedRequests'),
      enableCoinMarketCapRequests: this.form.field('enableCoinMarketCapRequests'),
      enableCoinGeckoRequests: this.form.field('enableCoinGeckoRequests'),
      enableFredRequests: this.form.field('enableFredRequests'),
      enableAkshare: this.form.field('enableAkshare'),
      enableIfind: this.form.field('enableIfind'),
      ifindTransport: this.form.field('ifindTransport'),
      ifindBaseUrl: this.form.field('ifindBaseUrl'),
      pythonExecutable: this.form.field('pythonExecutable'),
      stockBridgeTimeoutMs: this.form.field('stockBridgeTimeoutMs'),
      stockBridgeMaxOutputBytes: this.form.field('stockBridgeMaxOutputBytes'),
      requestCacheTtlMs: this.form.field('requestCacheTtlMs'),
      requestCacheMaxEntries: this.form.field('requestCacheMaxEntries'),
      requestMaxRetries: this.form.field('requestMaxRetries'),
      requestRetryBaseDelayMs: this.form.field('requestRetryBaseDelayMs'),
      requestRetryMaxDelayMs: this.form.field('requestRetryMaxDelayMs'),
      requestsPerMinute: this.form.field('requestsPerMinute'),
      requestBurst: this.form.field('requestBurst'),
      binanceWebSocketBaseUrl: this.form.field('binanceWebSocketBaseUrl'),
      coinMarketCapWebSocketBaseUrl: this.form.field('coinMarketCapWebSocketBaseUrl'),
      marketStreamTimeoutMs: this.form.field('marketStreamTimeoutMs'),
      marketStreamMaxEvents: this.form.field('marketStreamMaxEvents'),
      binanceApiKey: this.form.field(API_KEY_FIELD),
      binanceApiSecret: this.form.field(API_SECRET_FIELD),
      coinMarketCapApiKey: this.form.field(COINMARKETCAP_API_KEY_FIELD),
      coinGeckoApiKey: this.form.field(COINGECKO_API_KEY_FIELD),
      githubToken: this.form.field(GITHUB_TOKEN_FIELD),
      fredApiKey: this.form.field(FRED_API_KEY_FIELD),
      ifindUser: this.form.field(IFIND_USER_FIELD),
      ifindPassword: this.form.field(IFIND_PASSWORD_FIELD),
      ifindRefreshToken: this.form.field(IFIND_REFRESH_TOKEN_FIELD),
      binanceApiKeyConfigured: this.apiKey.configured,
      binanceApiSecretConfigured: this.apiSecret.configured,
      coinMarketCapApiKeyConfigured: this.coinMarketCapApiKey.configured,
      coinGeckoApiKeyConfigured: this.coinGeckoApiKey.configured,
      githubTokenConfigured: this.githubToken.configured,
      fredApiKeyConfigured: this.fredApiKey.configured,
      ifindUserConfigured: this.ifindUser.configured,
      ifindPasswordConfigured: this.ifindPassword.configured,
      ifindRefreshTokenConfigured: this.ifindRefreshToken.configured,
      binanceApiKeyWritable: this.apiKey.writable,
      binanceApiSecretWritable: this.apiSecret.writable,
      coinMarketCapApiKeyWritable: this.coinMarketCapApiKey.writable,
      coinGeckoApiKeyWritable: this.coinGeckoApiKey.writable,
      githubTokenWritable: this.githubToken.writable,
      fredApiKeyWritable: this.fredApiKey.writable,
      ifindUserWritable: this.ifindUser.writable,
      ifindPasswordWritable: this.ifindPassword.writable,
      ifindRefreshTokenWritable: this.ifindRefreshToken.writable,
    }
  }

  private async readCredentials(): Promise<void> {
    const response = await this.ctx.remote.credentials.describe([
      BINANCE_API_KEY_REF, BINANCE_API_SECRET_REF, COINMARKETCAP_API_KEY_REF, COINGECKO_API_KEY_REF,
      GITHUB_TOKEN_REF,
      FRED_API_KEY_REF,
      IFIND_USER_REF, IFIND_PASSWORD_REF, IFIND_REFRESH_TOKEN_REF,
    ])
    if (!response.ok) return
    const apiKey = response.value[BINANCE_API_KEY_REF]
    const apiSecret = response.value[BINANCE_API_SECRET_REF]
    const coinMarketCapApiKey = response.value[COINMARKETCAP_API_KEY_REF]
    const coinGeckoApiKey = response.value[COINGECKO_API_KEY_REF]
    const githubToken = response.value[GITHUB_TOKEN_REF]
    const fredApiKey = response.value[FRED_API_KEY_REF]
    const ifindUser = response.value[IFIND_USER_REF]
    const ifindPassword = response.value[IFIND_PASSWORD_REF]
    const ifindRefreshToken = response.value[IFIND_REFRESH_TOKEN_REF]
    const nextKey = { configured: apiKey?.configured ?? false, writable: apiKey?.writable ?? true }
    const nextSecret = { configured: apiSecret?.configured ?? false, writable: apiSecret?.writable ?? true }
    const nextCoinMarketCapKey = {
      configured: coinMarketCapApiKey?.configured ?? false,
      writable: coinMarketCapApiKey?.writable ?? true,
    }
    const nextCoinGeckoKey = { configured: coinGeckoApiKey?.configured ?? false, writable: coinGeckoApiKey?.writable ?? true }
    const nextGithubToken = { configured: githubToken?.configured ?? false, writable: githubToken?.writable ?? true }
    const nextFredKey = { configured: fredApiKey?.configured ?? false, writable: fredApiKey?.writable ?? true }
    const nextIfindUser = { configured: ifindUser?.configured ?? false, writable: ifindUser?.writable ?? true }
    const nextIfindPassword = { configured: ifindPassword?.configured ?? false, writable: ifindPassword?.writable ?? true }
    const nextIfindRefreshToken = { configured: ifindRefreshToken?.configured ?? false, writable: ifindRefreshToken?.writable ?? true }
    if (nextKey.configured === this.apiKey.configured && nextKey.writable === this.apiKey.writable
      && nextSecret.configured === this.apiSecret.configured && nextSecret.writable === this.apiSecret.writable
      && nextCoinMarketCapKey.configured === this.coinMarketCapApiKey.configured
      && nextCoinMarketCapKey.writable === this.coinMarketCapApiKey.writable
      && nextCoinGeckoKey.configured === this.coinGeckoApiKey.configured
      && nextCoinGeckoKey.writable === this.coinGeckoApiKey.writable
      && nextGithubToken.configured === this.githubToken.configured
      && nextGithubToken.writable === this.githubToken.writable
      && nextFredKey.configured === this.fredApiKey.configured && nextFredKey.writable === this.fredApiKey.writable
      && nextIfindUser.configured === this.ifindUser.configured && nextIfindUser.writable === this.ifindUser.writable
      && nextIfindPassword.configured === this.ifindPassword.configured
      && nextIfindPassword.writable === this.ifindPassword.writable
      && nextIfindRefreshToken.configured === this.ifindRefreshToken.configured
      && nextIfindRefreshToken.writable === this.ifindRefreshToken.writable) return
    this.apiKey = nextKey
    this.apiSecret = nextSecret
    this.coinMarketCapApiKey = nextCoinMarketCapKey
    this.coinGeckoApiKey = nextCoinGeckoKey
    this.githubToken = nextGithubToken
    this.fredApiKey = nextFredKey
    this.ifindUser = nextIfindUser
    this.ifindPassword = nextIfindPassword
    this.ifindRefreshToken = nextIfindRefreshToken
    this.store.set(this.projection())
  }

  /**
   * Re-read status after a credential changes elsewhere.
   * @param ref - Changed credential reference.
   */
  refreshCredential(ref: string): void {
    if (
      ref === BINANCE_API_KEY_REF || ref === BINANCE_API_SECRET_REF || ref === COINMARKETCAP_API_KEY_REF
      || ref === FRED_API_KEY_REF
      || ref === IFIND_USER_REF || ref === IFIND_PASSWORD_REF || ref === IFIND_REFRESH_TOKEN_REF
    ) {
      void this.readCredentials()
    }
  }

  private async writeCredential(ref: string, value: string): Promise<boolean> {
    await this.ctx.remote.credentials.set(ref, value)
    await this.readCredentials()
    if (ref === BINANCE_API_KEY_REF) return this.apiKey.configured
    if (ref === BINANCE_API_SECRET_REF) return this.apiSecret.configured
    if (ref === COINMARKETCAP_API_KEY_REF) return this.coinMarketCapApiKey.configured
    if (ref === FRED_API_KEY_REF) return this.fredApiKey.configured
    if (ref === IFIND_USER_REF) return this.ifindUser.configured
    if (ref === IFIND_PASSWORD_REF) return this.ifindPassword.configured
    return this.ifindRefreshToken.configured
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
