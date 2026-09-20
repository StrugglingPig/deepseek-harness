/** Model-facing finance research tools over a replaceable market-data provider. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { fixtureProvider } from './data.ts'
import { createHttpFinanceMarketDataProvider } from './http.ts'
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
export {
  createHttpFinanceMarketDataProvider,
  FinanceDataError,
  HttpFinanceMarketDataProvider,
} from './http.ts'
export type { HttpFinanceMarketDataProviderOptions } from './http.ts'

export const name = 'experimental-finance-research'
export const inject = ['tools']

/** Deployment selection for the finance market-data provider. */
export interface Config {
  /** `fixture` keeps the deterministic local provider; `http` enables public live endpoints. */
  readonly provider?: 'fixture' | 'http'
  /** HTTP request timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Maximum live history bars requested. */
  readonly barLimit?: number
  /** Yahoo Finance origin. */
  readonly yahooBaseUrl?: string
  /** Binance Spot REST origin. */
  readonly binanceBaseUrl?: string
  /** Binance USD-M Futures REST origin. */
  readonly binanceUsdmBaseUrl?: string
  /** Binance COIN-M Futures REST origin. */
  readonly binanceCoinmBaseUrl?: string
  /** Binance Options REST origin. */
  readonly binanceOptionsBaseUrl?: string
  /** Polymarket Gamma API origin. */
  readonly polymarketGammaBaseUrl?: string
  /** Polymarket CLOB API origin. */
  readonly polymarketClobBaseUrl?: string
}

/** Schemastery configuration for the finance research plugin. */
export const Config: z<Config> = z.object({
  provider: z.union(['fixture', 'http'] as const).default('fixture'),
  timeoutMs: z.number().min(1).default(15_000),
  barLimit: z.number().step(1).min(50).default(80),
  yahooBaseUrl: z.string().default('https://query1.finance.yahoo.com'),
  binanceBaseUrl: z.string().default('https://api.binance.com'),
  binanceUsdmBaseUrl: z.string().default('https://fapi.binance.com'),
  binanceCoinmBaseUrl: z.string().default('https://dapi.binance.com'),
  binanceOptionsBaseUrl: z.string().default('https://eapi.binance.com'),
  polymarketGammaBaseUrl: z.string().default('https://gamma-api.polymarket.com'),
  polymarketClobBaseUrl: z.string().default('https://clob.polymarket.com'),
})

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

  const describeProvider = provider.describe?.bind(provider)
  if (describeProvider !== undefined) {
    ctx.tools.register(defineTool({
      name: 'finance_provider_describe',
      description: 'Describe the active finance provider origins, authentication mode, and upstream documentation. The descriptor does not define an endpoint whitelist.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            provider: { type: 'string', required: true },
            display_name: { type: 'string', required: true },
            bases: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  description: { type: 'string', required: true },
                  auth: { type: 'string', required: true, enum: ['none', 'api-key', 'signed'] },
                  docs: { type: 'string', required: true },
                },
              },
            },
            notes: { type: 'array', required: true, items: { type: 'string' } },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: [
            `provider: ${value.provider}`,
            ...value.bases.map(base => `${base.name} (${base.auth}) — ${base.description}`),
            ...value.notes,
          ].join('\n'),
        }],
      },
      execute() {
        const descriptor = describeProvider()
        return Promise.resolve({
          provider: descriptor.id,
          display_name: descriptor.displayName,
          bases: descriptor.bases.map(base => ({
            name: base.name,
            description: base.description,
            auth: base.auth,
            docs: base.docs,
          })),
          notes: [...descriptor.notes],
        })
      },
    }))
  }

  const requestProvider = provider.request?.bind(provider)
  if (requestProvider !== undefined) {
    ctx.tools.register(defineTool({
      name: 'finance_provider_request',
      description: 'Send a generic request to the active finance provider. Pass a base from finance_provider_describe, an upstream path, and provider-native query parameters. Available data is limited by the upstream API, credentials, rate limits, and network policy, not by a local endpoint whitelist.',
      parameters: {
        base: { type: 'string', required: true, description: 'Provider base name from finance_provider_describe.' },
        path: { type: 'string', required: true, description: 'Upstream path beginning with `/`.' },
        method: {
          type: 'string',
          description: 'HTTP method; defaults to GET.',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        },
        query: {
          type: 'object',
          additionalProperties: true,
          description: 'Provider-native query parameters.',
        },
        body: {
          type: 'json',
          description: 'JSON request body for non-GET methods.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            provider: { type: 'string', required: true },
            base: { type: 'string', required: true },
            method: { type: 'string', required: true, enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
            path: { type: 'string', required: true },
            status: { type: 'integer', required: true },
            data: { type: 'json', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `HTTP ${value.status} ${value.method} ${value.base}${value.path}\n${JSON.stringify(value.data, null, 2)}`,
        }],
      },
      async execute(args, exec) {
        return requestProvider({
          base: args.base,
          path: args.path,
          ...args.method === undefined ? {} : { method: args.method },
          ...args.query === undefined ? {} : { query: args.query },
          ...args.body === undefined ? {} : { body: args.body },
        }, exec.signal)
      },
    }))
  }

}

/**
 * Register finance research tools using the configured provider.
 * @param ctx - Registrant context carrying the tool registry.
 * @param config - Resolved provider and HTTP settings.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as Required<Config>
  const provider = resolved.provider === 'http'
    ? createHttpFinanceMarketDataProvider({
      timeoutMs: resolved.timeoutMs,
      barLimit: resolved.barLimit,
      yahooBaseUrl: resolved.yahooBaseUrl,
      binanceBaseUrl: resolved.binanceBaseUrl,
      binanceUsdmBaseUrl: resolved.binanceUsdmBaseUrl,
      binanceCoinmBaseUrl: resolved.binanceCoinmBaseUrl,
      binanceOptionsBaseUrl: resolved.binanceOptionsBaseUrl,
      polymarketGammaBaseUrl: resolved.polymarketGammaBaseUrl,
      polymarketClobBaseUrl: resolved.polymarketClobBaseUrl,
    })
    : fixtureProvider
  registerFinanceTools(ctx, provider)
}
