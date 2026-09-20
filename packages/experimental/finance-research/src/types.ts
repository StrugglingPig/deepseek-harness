/** Shared finance research vocabulary for the experimental research tools. */

/** Asset classes supported by the initial finance research slice. */
export type FinanceAssetClass = 'equity' | 'crypto' | 'prediction'

/** One normalized OHLCV bar. */
export interface MarketBar {
  /** UTC ISO-8601 bar start. */
  readonly timestamp: string
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number
}

/** Prediction-market fields accompanying a probability bar series. */
export interface PredictionMarketSnapshot {
  readonly impliedProbability: number
  readonly bid: number
  readonly ask: number
  readonly volume: number
  readonly openInterest: number
  readonly resolution: string
  readonly rules: string
}

/** One normalized market snapshot shared by analysis and reporting. */
export interface MarketSnapshot {
  readonly instrument: {
    readonly symbol: string
    readonly name: string
    readonly assetClass: FinanceAssetClass
    readonly currency: string
  }
  readonly asOf: string
  readonly source: {
    readonly provider: string
    readonly retrievedAt: string
    readonly synthetic: boolean
  }
  readonly quote: {
    readonly price: number
    readonly changePercent: number
  }
  readonly bars: readonly MarketBar[]
  readonly prediction?: PredictionMarketSnapshot
}

/** Binance account families exposed by the private read-only provider. */
export type FinancePrivateAccountScope = 'spot' | 'usdm' | 'coinm'

/** One read-only private account request. */
export interface FinancePrivateAccountRequest {
  /** Binance account family. */
  readonly scope: FinancePrivateAccountScope
  /** Optional symbol filter for open orders and futures positions. */
  readonly symbol?: string
  /** Whether to include current open orders when the upstream endpoint provides them. */
  readonly includeOpenOrders?: boolean
}

/** One normalized non-zero account balance. */
export interface FinancePrivateBalance {
  readonly asset: string
  readonly free: number
  readonly locked: number
  readonly total: number
}

/** One normalized non-flat futures position. */
export interface FinancePrivatePosition {
  readonly symbol: string
  readonly side: 'long' | 'short'
  readonly quantity: number
  readonly entryPrice: number
  readonly markPrice: number
  readonly unrealizedPnl: number
  readonly leverage: number
}

/** One normalized open order. */
export interface FinancePrivateOpenOrder {
  readonly orderId: string
  readonly symbol: string
  readonly side: string
  readonly type: string
  readonly price: number
  readonly quantity: number
  readonly executedQuantity: number
  readonly status: string
  readonly time?: string
}

/** Normalized read-only private account result. */
export interface FinancePrivateAccountSnapshot {
  readonly scope: FinancePrivateAccountScope
  readonly accountType: string
  readonly canTrade: boolean
  readonly canWithdraw?: boolean
  readonly retrievedAt: string
  readonly totalWalletBalance?: number
  readonly totalUnrealizedProfit?: number
  readonly balances: readonly FinancePrivateBalance[]
  readonly positions: readonly FinancePrivatePosition[]
  readonly openOrders?: readonly FinancePrivateOpenOrder[]
}

/** Replacing this provider changes the data source without changing the tools. */
export interface FinanceMarketDataProvider {
  readonly id: string
  /** Load the normalized research snapshot used by indicators and reports. */
  load(symbol: string, signal?: AbortSignal): Promise<MarketSnapshot>
  /** Describe provider origins, authentication, and upstream documentation. */
  describe?(): FinanceProviderDescriptor
  /** Send a provider-native request when the provider exposes a generic transport. */
  request?(request: FinanceProviderRequest, signal?: AbortSignal): Promise<FinanceProviderResponse>
  /** Load normalized read-only private account data when the provider supports it. */
  loadPrivateAccount?(request: FinancePrivateAccountRequest, signal?: AbortSignal): Promise<FinancePrivateAccountSnapshot>
}

/** Lossless JSON value accepted from or returned by provider-native requests. */
export type FinanceJsonValue =
  | null
  | boolean
  | number
  | string
  | FinanceJsonValue[]
  | { [key: string]: FinanceJsonValue }

/** HTTP methods accepted by the generic provider transport. */
export type FinanceHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** One provider origin the caller may address. */
export interface FinanceProviderBase {
  readonly name: string
  readonly description: string
  readonly auth: 'none' | 'api-key' | 'signed'
  readonly docs: string
}

/** Provider metadata used to discover origins without an endpoint whitelist. */
export interface FinanceProviderDescriptor {
  readonly id: string
  readonly displayName: string
  readonly bases: readonly FinanceProviderBase[]
  readonly notes: readonly string[]
}

/** One generic provider request. Data availability is owned by the upstream API. */
export interface FinanceProviderRequest {
  /** Configured base name from the provider descriptor. */
  readonly base: string
  /** Upstream path beginning with `/`. */
  readonly path: string
  /** HTTP method; the provider defaults to GET. */
  readonly method?: FinanceHttpMethod
  /** Provider-native query parameters. */
  readonly query?: Readonly<Record<string, FinanceJsonValue>>
  /** Provider-native JSON request body for non-GET methods. */
  readonly body?: FinanceJsonValue
  /** Optional request headers; model tools do not expose credential headers. */
  readonly headers?: Readonly<Record<string, string>>
  /** Authentication mode requested by the caller. */
  readonly auth?: 'none' | 'signed'
}

/** One bounded WebSocket collection request. */
export interface FinanceMarketStreamRequest {
  /** Combined-stream names such as `btcusdt@miniTicker`. */
  readonly streams: readonly string[]
  /** Optional collection timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Optional maximum parsed events. */
  readonly maxEvents?: number
}

/** One parsed real-time stream event. */
export interface FinanceMarketStreamEvent {
  /** Combined-stream name. */
  readonly stream: string
  /** Local receipt time in UTC. */
  readonly receivedAt: string
  /** Upstream JSON payload. */
  readonly data: FinanceJsonValue
}

/** Real-time market-data provider seam. */
export interface FinanceMarketStreamProvider {
  /** Collect a bounded event batch from the configured upstream stream. */
  collect(request: FinanceMarketStreamRequest, signal?: AbortSignal): Promise<readonly FinanceMarketStreamEvent[]>
}

/** One generic provider response carrying the upstream JSON unchanged. */
export interface FinanceProviderResponse {
  readonly provider: string
  readonly base: string
  readonly method: FinanceHttpMethod
  readonly path: string
  readonly status: number
  readonly data: FinanceJsonValue
}

/** Direction used by every indicator signal and by the composite result. */
export type IndicatorDirection = 'bullish' | 'bearish' | 'neutral'

/** One deterministic indicator contribution. */
export interface IndicatorSignal {
  readonly name: string
  readonly direction: IndicatorDirection
  readonly weight: number
  readonly value: number
  readonly rationale: string
}

/** Calculated indicator values exposed to tools and reports. */
export interface IndicatorValues {
  readonly sma20: number
  readonly sma50: number
  readonly ema12: number
  readonly ema26: number
  readonly rsi14: number
  readonly macd: number
  readonly macdSignal: number
  readonly macdHistogram: number
  readonly atr14: number
  readonly bollingerMiddle: number
  readonly bollingerUpper: number
  readonly bollingerLower: number
  readonly obv: number
  readonly obvSma20: number
}

/** Deterministic multi-indicator analysis for one snapshot. */
export interface IndicatorAnalysis {
  readonly symbol: string
  readonly asOf: string
  readonly indicators: IndicatorValues
  readonly signals: readonly IndicatorSignal[]
  readonly composite: {
    readonly direction: IndicatorDirection
    readonly score: number
    readonly confidence: number
    readonly summary: string
  }
  readonly conflicts: readonly string[]
  readonly risk: {
    readonly atrPercent: number
  }
}

/** One report section in the structured report result. */
export interface ResearchReportSection {
  readonly title: string
  readonly content: string
}

/** Complete report returned by the report tool. */
export interface ResearchReport {
  readonly symbol: string
  readonly asOf: string
  readonly title: string
  readonly markdown: string
  readonly sections: readonly ResearchReportSection[]
  readonly evidence: readonly {
    readonly source: string
    readonly asOf: string
    readonly url: string
  }[]
}

/** Input accepted by the report builder. */
export interface ResearchReportRequest {
  readonly symbol: string
  readonly question?: string
  readonly horizon?: string
}
