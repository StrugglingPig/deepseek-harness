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

/** Replacing this provider changes the data source without changing the tools. */
export interface FinanceMarketDataProvider {
  readonly id: string
  load(symbol: string, signal?: AbortSignal): Promise<MarketSnapshot>
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
