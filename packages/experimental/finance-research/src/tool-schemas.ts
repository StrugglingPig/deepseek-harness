/** Schema fragments and value mappers shared by the finance tool definitions. */

import { buildIndicatorAnalysis } from './indicators.ts'
import type { MarketSnapshot } from './types.ts'

/** A-share request fields shared by the mainland stock tools. */
export const STOCK_INPUT_PARAMETERS = {
  symbol: { type: 'string', required: true, description: 'Six-digit A-share symbol.' },
  provider: { type: 'string', required: true, enum: ['auto', 'akshare', 'ifind'], description: 'Installed Python stock data provider, or auto to try every enabled provider in order.' },
  start_date: { type: 'string', description: 'Inclusive ISO start date.' },
  end_date: { type: 'string', description: 'Inclusive ISO end date.' },
  adjust: { type: 'string', enum: ['none', 'qfq', 'hfq'], description: 'Price adjustment mode.' },
} as const

/** Technical-analysis output properties shared by the normalized and stock tools. */
export const ANALYSIS_OUTPUT_PROPERTIES = {
  indicators: {
    type: 'object',
    additionalProperties: false,
    required: true,
    properties: {
      sma20: { type: 'number', required: true }, sma50: { type: 'number', required: true },
      ema12: { type: 'number', required: true }, ema26: { type: 'number', required: true },
      rsi14: { type: 'number', required: true }, macd: { type: 'number', required: true },
      macd_signal: { type: 'number', required: true }, macd_histogram: { type: 'number', required: true },
      atr14: { type: 'number', required: true }, bollinger_middle: { type: 'number', required: true },
      bollinger_upper: { type: 'number', required: true }, bollinger_lower: { type: 'number', required: true },
      obv: { type: 'number', required: true }, obv_sma20: { type: 'number', required: true },
    },
  },
  signals: {
    type: 'array',
    required: true,
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', required: true },
        direction: { type: 'string', required: true, enum: ['bullish', 'bearish', 'neutral'] },
        weight: { type: 'number', required: true },
        value: { type: 'number', required: true },
        rationale: { type: 'string', required: true },
      },
    },
  },
  composite: {
    type: 'object',
    additionalProperties: false,
    required: true,
    properties: {
      direction: { type: 'string', required: true, enum: ['bullish', 'bearish', 'neutral'] },
      score: { type: 'number', required: true },
      confidence: { type: 'integer', required: true },
      summary: { type: 'string', required: true },
    },
  },
  conflicts: { type: 'array', required: true, items: { type: 'string' } },
  risk: {
    type: 'object',
    additionalProperties: false,
    required: true,
    properties: { atr_percent: { type: 'number', required: true } },
  },
} as const

/** Methodology output properties shared by the normalized and stock tools. */
export const METHODOLOGY_OUTPUT_PROPERTIES = {
  readings: {
    type: 'array',
    required: true,
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        name: { type: 'string', required: true },
        category: { type: 'string', required: true },
        status: { type: 'string', required: true },
        direction: { type: 'string', required: true },
        confidence: { type: 'integer', required: true },
        value: { type: 'number' },
        note: { type: 'string', required: true },
      },
    },
  },
  investors: {
    type: 'array',
    required: true,
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        name: { type: 'string', required: true },
        school: { type: 'string', required: true },
        stance: { type: 'string', required: true },
        evidence: { type: 'array', required: true, items: { type: 'string' } },
        questions: { type: 'array', required: true, items: { type: 'string' } },
        risk: { type: 'string', required: true },
      },
    },
  },
  synthesis_prompt: { type: 'string', required: true },
} as const

/** Normalized snapshot result shared by the market and stock snapshot tools. */
export interface SnapshotToolValue {
  readonly symbol: string
  readonly asset_class: 'equity' | 'crypto' | 'prediction'
  readonly as_of: string
  readonly name: string
  readonly currency: string
  readonly price: number
  readonly change_percent: number
  readonly bar_count: number
  readonly source: string
  readonly synthetic: boolean
  readonly prediction?: {
    readonly implied_probability: number
    readonly bid: number
    readonly ask: number
    readonly volume: number
    readonly open_interest: number
    readonly resolution: string
    readonly rules: string
  }
}

/** Technical-analysis tool result. */
export interface AnalysisToolValue {
  readonly symbol: string
  readonly as_of: string
  readonly indicators: {
    readonly sma20: number
    readonly sma50: number
    readonly ema12: number
    readonly ema26: number
    readonly rsi14: number
    readonly macd: number
    readonly macd_signal: number
    readonly macd_histogram: number
    readonly atr14: number
    readonly bollinger_middle: number
    readonly bollinger_upper: number
    readonly bollinger_lower: number
    readonly obv: number
    readonly obv_sma20: number
  }
  readonly signals: {
    readonly name: string
    readonly direction: 'bullish' | 'bearish' | 'neutral'
    readonly weight: number
    readonly value: number
    readonly rationale: string
  }[]
  readonly composite: {
    readonly direction: 'bullish' | 'bearish' | 'neutral'
    readonly score: number
    readonly confidence: number
    readonly summary: string
  }
  readonly conflicts: string[]
  readonly risk: { readonly atr_percent: number }
}

/**
 * Map one snapshot onto the tool result.
 * @param snapshot - Normalized market snapshot.
 * @returns The tool result value.
 */
export function snapshotValue(snapshot: MarketSnapshot): SnapshotToolValue {
  const prediction = snapshot.prediction
  return {
    symbol: snapshot.instrument.symbol,
    asset_class: snapshot.instrument.assetClass,
    as_of: snapshot.asOf,
    name: snapshot.instrument.name,
    currency: snapshot.instrument.currency,
    price: snapshot.quote.price,
    change_percent: snapshot.quote.changePercent,
    bar_count: snapshot.bars.length,
    source: snapshot.source.provider,
    synthetic: snapshot.source.synthetic,
    ...prediction === undefined ? {} : {
      prediction: {
        implied_probability: prediction.impliedProbability,
        bid: prediction.bid,
        ask: prediction.ask,
        volume: prediction.volume,
        open_interest: prediction.openInterest,
        resolution: prediction.resolution,
        rules: prediction.rules,
      },
    },
  }
}

/**
 * Map one snapshot onto the technical-analysis tool result.
 * @param snapshot - Normalized market snapshot.
 * @returns The tool result value.
 */
export function analysisValue(snapshot: MarketSnapshot): AnalysisToolValue {
  const analysis = buildIndicatorAnalysis(snapshot)
  return {
    symbol: analysis.symbol,
    as_of: analysis.asOf,
    indicators: {
      sma20: analysis.indicators.sma20,
      sma50: analysis.indicators.sma50,
      ema12: analysis.indicators.ema12,
      ema26: analysis.indicators.ema26,
      rsi14: analysis.indicators.rsi14,
      macd: analysis.indicators.macd,
      macd_signal: analysis.indicators.macdSignal,
      macd_histogram: analysis.indicators.macdHistogram,
      atr14: analysis.indicators.atr14,
      bollinger_middle: analysis.indicators.bollingerMiddle,
      bollinger_upper: analysis.indicators.bollingerUpper,
      bollinger_lower: analysis.indicators.bollingerLower,
      obv: analysis.indicators.obv,
      obv_sma20: analysis.indicators.obvSma20,
    },
    signals: analysis.signals.map(signal => ({
      name: signal.name,
      direction: signal.direction,
      weight: signal.weight,
      value: signal.value,
      rationale: signal.rationale,
    })),
    composite: {
      direction: analysis.composite.direction,
      score: analysis.composite.score,
      confidence: analysis.composite.confidence,
      summary: analysis.composite.summary,
    },
    conflicts: [...analysis.conflicts],
    risk: { atr_percent: analysis.risk.atrPercent },
  }
}
