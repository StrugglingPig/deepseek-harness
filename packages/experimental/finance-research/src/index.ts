/** Model-facing finance research tools over a replaceable market-data provider. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { fixtureProvider } from './data.ts'
import { buildIndicatorAnalysis } from './indicators.ts'
import { buildResearchReport } from './report.ts'
import type {
  FinanceMarketDataProvider,
  MarketSnapshot,
} from './types.ts'

export type * from './types.ts'
export { FixtureFinanceMarketDataProvider, classifyAsset, loadFixtureSnapshot } from './data.ts'
export {
  buildIndicatorAnalysis, compositeDirection, directionValue, latestAtr, latestBollinger,
  latestEma, latestMacd, latestObv, latestRsi, latestSma, macdDirection, obvSeries,
  priceBandDirection, rsiDirection, trendDirection, volumeDirection,
} from './indicators.ts'
export { buildResearchReport } from './report.ts'

export const name = 'experimental-finance-research'
export const inject = ['tools']

function snapshotValue(snapshot: MarketSnapshot) {
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

function analysisValue(snapshot: MarketSnapshot) {
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

/**
 * Register the finance research tools against one data provider.
 * @param ctx - Registrant context carrying the tool registry.
 * @param provider - Market-data provider used by all three tools.
 */
export function registerFinanceTools(ctx: Context, provider: FinanceMarketDataProvider = fixtureProvider): void {
  ctx.tools.register(defineTool({
    name: 'finance_market_snapshot',
    description: 'Load a normalized market snapshot for an equity, crypto, or PREDICTION: instrument.',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Ticker, coin, or PREDICTION:<market> symbol.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          symbol: { type: 'string', required: true },
          asset_class: { type: 'string', required: true, enum: ['equity', 'crypto', 'prediction'] },
          as_of: { type: 'string', required: true },
          name: { type: 'string', required: true },
          currency: { type: 'string', required: true },
          price: { type: 'number', required: true },
          change_percent: { type: 'number', required: true },
          bar_count: { type: 'integer', required: true },
          source: { type: 'string', required: true },
          synthetic: { type: 'boolean', required: true },
          prediction: {
            type: 'object',
            additionalProperties: false,
            properties: {
              implied_probability: { type: 'number', required: true },
              bid: { type: 'number', required: true },
              ask: { type: 'number', required: true },
              volume: { type: 'number', required: true },
              open_interest: { type: 'number', required: true },
              resolution: { type: 'string', required: true },
              rules: { type: 'string', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.symbol} ${value.price} ${value.currency} (${value.bar_count} bars, ${value.source})`,
      }],
    },
    async execute(args, exec) {
      return snapshotValue(await provider.load(args.symbol, exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'finance_technical_analysis',
    description: 'Compute deterministic technical indicators and a multi-indicator summary for a symbol.',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Ticker, coin, or PREDICTION:<market> symbol.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          symbol: { type: 'string', required: true },
          as_of: { type: 'string', required: true },
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
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.symbol}: ${value.composite.direction} (${value.composite.confidence}% confidence), ${value.conflicts.length} conflicts`,
      }],
    },
    async execute(args, exec) {
      return analysisValue(await provider.load(args.symbol, exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'finance_research_report',
    description: 'Generate a structured Markdown research report from deterministic market analysis.',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Ticker, coin, or PREDICTION:<market> symbol.' },
      question: { type: 'string', description: 'Research question to include in the report.' },
      horizon: { type: 'string', description: 'Requested research horizon.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          symbol: { type: 'string', required: true },
          as_of: { type: 'string', required: true },
          title: { type: 'string', required: true },
          markdown: { type: 'string', required: true },
          sections: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                content: { type: 'string', required: true },
              },
            },
          },
          evidence: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                source: { type: 'string', required: true },
                as_of: { type: 'string', required: true },
                url: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.markdown }],
    },
    async execute(args, exec) {
      const report = await buildResearchReport(provider, {
        symbol: args.symbol,
        ...args.question === undefined ? {} : { question: args.question },
        ...args.horizon === undefined ? {} : { horizon: args.horizon },
      }, exec.signal)
      return {
        symbol: report.symbol,
        as_of: report.asOf,
        title: report.title,
        markdown: report.markdown,
        sections: report.sections.map(section => ({ title: section.title, content: section.content })),
        evidence: report.evidence.map(item => ({
          source: item.source,
          as_of: item.asOf,
          url: item.url,
        })),
      }
    },
  }))
}

/** Default plugin application using the deterministic fixture provider. */
export function apply(ctx: Context): void {
  registerFinanceTools(ctx)
}
