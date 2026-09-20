/** Model-facing finance research tools over a replaceable market-data provider. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  composeRequestAuthorizers,
  createBinanceRequestAuthorizer,
  createCoinMarketCapRequestAuthorizer,
  type FinanceCredentialResolver,
} from './auth.ts'
import { FinanceDataError } from './error.ts'
import { fixtureProvider } from './data.ts'
import {
  SettingsFinanceMarketDataProvider,
  SettingsFinanceMarketStreamProvider,
  type FinanceRuntimeSettings,
} from './settings-provider.ts'
import {
  FinanceStockSubprocessBridge,
  SubprocessFinanceStockDataProvider,
  registerStockTools,
} from './stock.ts'
import { buildIndicatorAnalysis } from './indicators.ts'
import { MONITOR_DEFAULT_BTC_INTERVAL_SECONDS, MONITOR_MINIMUM_BTC_INTERVAL_SECONDS, planFinanceMonitor } from './monitor.ts'
import { buildResearchReport } from './report.ts'
import { buildMethodologyAnalysis } from './methodology.ts'
import { registerFinanceDashboardRoutes } from './dashboard.ts'
import { exportResearchReport } from './export.ts'
import type {
  FinanceMarketDataProvider,
  FinanceMarketStreamProvider,
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
export { buildMethodologyAnalysis } from './methodology.ts'
export type { InvestorLens, MethodologyAnalysis, MethodologyCatalogEntry, MethodologyCategory, MethodologyDirection, MethodologyReading, MethodologyStatus } from './methodology.ts'
export { loadDashboardMarket, parseDashboardRequest, registerFinanceDashboardRoutes } from './dashboard.ts'
export type { DashboardAsset, DashboardBar, DashboardInterval, DashboardMarketResponse, DashboardQuote } from './dashboard.ts'
export {
  BINANCE_API_KEY_REF,
  BINANCE_API_SECRET_REF,
  COINMARKETCAP_API_KEY_REF,
  composeRequestAuthorizers,
  createBinanceRequestAuthorizer,
  createCoinMarketCapRequestAuthorizer,
} from './auth.ts'
export type {
  BinanceRequestAuthorizerOptions,
  CoinMarketCapRequestAuthorizerOptions,
  FinanceCredentialResolver,
  FinanceRequestAuthorizer,
} from './auth.ts'
export { normalizeCoinMarketCapOhlcv, normalizeCoinMarketCapQuotes } from './coinmarketcap.ts'
export { SettingsFinanceMarketDataProvider } from './settings-provider.ts'
export type { FinanceRuntimeSettings } from './settings-provider.ts'
export {
  createHttpFinanceMarketDataProvider,
  FinanceDataError,
  HttpFinanceMarketDataProvider,
} from './http.ts'
export type { HttpFinanceMarketDataProviderOptions } from './http.ts'
export {
  FinanceStockSubprocessBridge,
  SubprocessFinanceStockDataProvider,
  registerStockTools,
} from './stock.ts'
export type {
  FinanceStockBridge,
  FinanceStockBridgeRequest,
  FinanceStockSubprocessBridgeOptions,
  FinanceStockSubprocessBridgeRuntimeOptions,
  SubprocessFinanceStockDataProviderOptions,
} from './stock.ts'

export const name = 'experimental-finance-research'
export const inject = ['tools']

/** Deployment selection and user settings for the finance market-data provider. */
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
  /** CoinMarketCap Pro REST origin. */
  readonly coinMarketCapBaseUrl?: string
  /** Whether the user permits explicit signed Binance requests. */
  readonly enableSignedRequests?: boolean
  /** Whether the user permits CoinMarketCap API-key requests. */
  readonly enableCoinMarketCapRequests?: boolean
  /** Whether AKShare stock data is available. */
  readonly enableAkshare?: boolean
  /** Whether iFinD stock data is available. */
  readonly enableIfind?: boolean
  /** iFinD transport: HTTP API or local iFinDPy SDK. */
  readonly ifindTransport?: 'http' | 'local'
  /** Tonghuashun iFinD HTTP API origin. */
  readonly ifindBaseUrl?: string
  /** Python executable used by the stock bridge. */
  readonly pythonExecutable?: string
  /** Stock bridge timeout in milliseconds. */
  readonly stockBridgeTimeoutMs?: number
  /** Maximum stock bridge output captured per stream. */
  readonly stockBridgeMaxOutputBytes?: number
  /** Successful GET cache lifetime in milliseconds. */
  readonly requestCacheTtlMs?: number
  /** Maximum cached GET responses. */
  readonly requestCacheMaxEntries?: number
  /** Retries after the initial finance HTTP request. */
  readonly requestMaxRetries?: number
  /** First retry delay in milliseconds. */
  readonly requestRetryBaseDelayMs?: number
  /** Maximum retry delay in milliseconds. */
  readonly requestRetryMaxDelayMs?: number
  /** Per-origin finance request budget in requests per minute. */
  readonly requestsPerMinute?: number
  /** Per-origin request burst capacity. */
  readonly requestBurst?: number
  /** Binance combined-stream WebSocket origin. */
  readonly binanceWebSocketBaseUrl?: string
  /** CoinMarketCap latest-price WebSocket origin. */
  readonly coinMarketCapWebSocketBaseUrl?: string
  /** WebSocket collection timeout in milliseconds. */
  readonly marketStreamTimeoutMs?: number
  /** Maximum WebSocket events returned by one collection. */
  readonly marketStreamMaxEvents?: number
}

/** Settings namespace owned by the finance research plugin. */
export const FINANCE_SETTINGS_NS = 'finance-research'

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
  coinMarketCapBaseUrl: z.string().default('https://pro-api.coinmarketcap.com'),
  enableSignedRequests: z.boolean().default(false),
  enableCoinMarketCapRequests: z.boolean().default(false),
  enableAkshare: z.boolean().default(true),
  enableIfind: z.boolean().default(false),
  ifindTransport: z.union(['http', 'local'] as const).default('http'),
  ifindBaseUrl: z.string().default('https://quantapi.51ifind.com'),
  pythonExecutable: z.string().default('python3'),
  stockBridgeTimeoutMs: z.number().min(1).default(60_000),
  stockBridgeMaxOutputBytes: z.number().step(1).min(1).default(4 * 1024 * 1024),
  requestCacheTtlMs: z.number().min(0).default(5_000),
  requestCacheMaxEntries: z.number().step(1).min(0).default(256),
  requestMaxRetries: z.number().step(1).min(0).default(2),
  requestRetryBaseDelayMs: z.number().min(0).default(250),
  requestRetryMaxDelayMs: z.number().min(0).default(4_000),
  requestsPerMinute: z.number().min(1).default(120),
  requestBurst: z.number().step(1).min(1).default(10),
  binanceWebSocketBaseUrl: z.string().default('wss://stream.binance.com:9443'),
  coinMarketCapWebSocketBaseUrl: z.string().default('wss://pro-stream.coinmarketcap.com/v1'),
  marketStreamTimeoutMs: z.number().min(1).default(15_000),
  marketStreamMaxEvents: z.number().step(1).min(1).default(100),
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
 * @param provider - Market-data provider used by the normalized tools.
 * @param streamProvider - Optional real-time market-stream provider.
 */
export function registerFinanceTools(
  ctx: Context,
  provider: FinanceMarketDataProvider = fixtureProvider,
  streamProvider?: FinanceMarketStreamProvider,
): void {
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
    description: 'Generate a structured Markdown and interactive HTML research report from deterministic market analysis.',
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
          html: { type: 'string', required: true },
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
        html: report.html,
        sections: report.sections.map(section => ({ title: section.title, content: section.content })),
        evidence: report.evidence.map(item => ({
          source: item.source,
          as_of: item.asOf,
          url: item.url,
        })),
      }
    },
  }))

  ctx.inject(['fs'], (fsCtx) => {
    ctx.tools.register(defineTool({
      name: 'finance_report_export',
      description: 'Generate a finance research report and persist both Markdown and self-contained interactive HTML files in the workspace.',
      parameters: {
        symbol: { type: 'string', required: true, description: 'Ticker, coin, or PREDICTION:<market> symbol.' },
        question: { type: 'string', description: 'Research question to include in the report.' },
        horizon: { type: 'string', description: 'Requested research horizon.' },
        output_dir: { type: 'string', description: 'Workspace-relative output directory.', default: '.artifacts/finance-reports' },
        basename: { type: 'string', description: 'Optional file stem.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            symbol: { type: 'string', required: true },
            as_of: { type: 'string', required: true },
            title: { type: 'string', required: true },
            markdown_path: { type: 'string', required: true },
            html_path: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `Report exported:\n- Markdown: ${value.markdown_path}\n- HTML: ${value.html_path}` }],
      },
      async execute(args, exec) {
        const report = await buildResearchReport(provider, {
          symbol: args.symbol,
          ...args.question === undefined ? {} : { question: args.question },
          ...args.horizon === undefined ? {} : { horizon: args.horizon },
        }, exec.signal)
        const files = await exportResearchReport(
          fsCtx.fs,
          report,
          args.output_dir ?? '.artifacts/finance-reports',
          args.basename,
          exec.signal,
        )
        return {
          symbol: report.symbol,
          as_of: report.asOf,
          title: report.title,
          markdown_path: files.markdown,
          html_path: files.html,
        }
      },
    }))
  })

  ctx.tools.register(defineTool({
    name: 'finance_methodology_analysis',
    description: 'Run deterministic methodology readings and investor lenses over a symbol. It separates available evidence from strategies that require additional inputs.',
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
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const snapshot = await provider.load(args.symbol, exec.signal)
      const methodology = buildMethodologyAnalysis(snapshot)
      return {
        symbol: snapshot.instrument.symbol,
        as_of: snapshot.asOf,
        readings: [...methodology.readings],
        investors: methodology.investors.map(investor => ({
          id: investor.id,
          name: investor.name,
          school: investor.school,
          stance: investor.stance,
          evidence: [...investor.evidence],
          questions: [...investor.questions],
          risk: investor.risk,
        })),
        synthesis_prompt: methodology.synthesisPrompt,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'finance_strategy_catalog',
    description: 'Return the investment methodology catalog with category, logic, quant suitability, data requirements, and execution status.',
    parameters: {
      category: { type: 'string', description: 'Optional methodology category filter.' },
      status: { type: 'string', description: 'Optional execution status filter.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                category: { type: 'string', required: true },
                logic: { type: 'string', required: true },
                quant_rating: { type: 'integer', required: true },
                status: { type: 'string', required: true },
                data_requirements: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const snapshot = await fixtureProvider.load('AAPL')
      const catalog = buildMethodologyAnalysis(snapshot).catalog
      const entries = catalog
        .filter(entry => args.category === undefined || entry.category === args.category)
        .filter(entry => args.status === undefined || entry.status === args.status)
        .map(entry => ({
          id: entry.id,
          name: entry.name,
          category: entry.category,
          logic: entry.logic,
          quant_rating: entry.quantRating,
          status: entry.status,
          data_requirements: [...entry.dataRequirements],
        }))
      return { entries }
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
        auth: {
          type: 'string',
          description: 'Authentication mode; signed uses stored Binance credentials without exposing them to the model.',
          enum: ['none', 'signed'],
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
          ...args.auth === undefined ? {} : { auth: args.auth },
        }, exec.signal)
      },
    }))
  }

  const loadPrivateAccount = provider.loadPrivateAccount?.bind(provider)
  if (loadPrivateAccount !== undefined) {
    ctx.tools.register(defineTool({
      name: 'finance_private_account',
      description: 'Read normalized read-only Binance account balances, futures positions, and optional open orders. Credentials remain in the Host credential service and never appear in the result.',
      parameters: {
        scope: {
          type: 'string',
          required: true,
          description: 'Binance account family.',
          enum: ['spot', 'usdm', 'coinm'],
        },
        symbol: {
          type: 'string',
          description: 'Optional symbol filter for open orders and futures positions.',
        },
        include_open_orders: {
          type: 'boolean',
          description: 'Include current open orders; defaults to false.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            scope: { type: 'string', required: true, enum: ['spot', 'usdm', 'coinm'] },
            account_type: { type: 'string', required: true },
            can_trade: { type: 'boolean', required: true },
            can_withdraw: { type: 'boolean' },
            retrieved_at: { type: 'string', required: true },
            total_wallet_balance: { type: 'number' },
            total_unrealized_profit: { type: 'number' },
            balances: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  asset: { type: 'string', required: true },
                  free: { type: 'number', required: true },
                  locked: { type: 'number', required: true },
                  total: { type: 'number', required: true },
                },
              },
            },
            positions: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  symbol: { type: 'string', required: true },
                  side: { type: 'string', required: true, enum: ['long', 'short'] },
                  quantity: { type: 'number', required: true },
                  entry_price: { type: 'number', required: true },
                  mark_price: { type: 'number', required: true },
                  unrealized_pnl: { type: 'number', required: true },
                  leverage: { type: 'number', required: true },
                },
              },
            },
            open_orders: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  order_id: { type: 'string', required: true },
                  symbol: { type: 'string', required: true },
                  side: { type: 'string', required: true },
                  type: { type: 'string', required: true },
                  price: { type: 'number', required: true },
                  quantity: { type: 'number', required: true },
                  executed_quantity: { type: 'number', required: true },
                  status: { type: 'string', required: true },
                  time: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          const orders = value.open_orders === undefined
            ? ''
            : `, ${String(value.open_orders.length)} open orders`
          return [{
            type: 'text',
            text: `${value.scope}: ${value.account_type}, ${String(value.balances.length)} non-zero balance, ${String(value.positions.length)} positions${orders}`,
          }]
        },
      },
      async execute(args, exec) {
        const account = await loadPrivateAccount({
          scope: args.scope,
          ...args.symbol === undefined ? {} : { symbol: args.symbol },
          ...args.include_open_orders === undefined ? {} : { includeOpenOrders: args.include_open_orders },
        }, exec.signal)
        return {
          scope: account.scope,
          account_type: account.accountType,
          can_trade: account.canTrade,
          ...account.canWithdraw === undefined ? {} : { can_withdraw: account.canWithdraw },
          retrieved_at: account.retrievedAt,
          ...account.totalWalletBalance === undefined ? {} : { total_wallet_balance: account.totalWalletBalance },
          ...account.totalUnrealizedProfit === undefined ? {} : { total_unrealized_profit: account.totalUnrealizedProfit },
          balances: account.balances.map(balance => ({
            asset: balance.asset,
            free: balance.free,
            locked: balance.locked,
            total: balance.total,
          })),
          positions: account.positions.map(position => ({
            symbol: position.symbol,
            side: position.side,
            quantity: position.quantity,
            entry_price: position.entryPrice,
            mark_price: position.markPrice,
            unrealized_pnl: position.unrealizedPnl,
            leverage: position.leverage,
          })),
          ...account.openOrders === undefined ? {} : {
            open_orders: account.openOrders.map(order => ({
              order_id: order.orderId,
              symbol: order.symbol,
              side: order.side,
              type: order.type,
              price: order.price,
              quantity: order.quantity,
              executed_quantity: order.executedQuantity,
              status: order.status,
              ...order.time === undefined ? {} : { time: order.time },
            })),
          },
        }
      },
    }))
  }

  const loadCoinMarketCapQuotes = provider.loadCoinMarketCapQuotes?.bind(provider)
  if (loadCoinMarketCapQuotes !== undefined) {
    ctx.tools.register(defineTool({
      name: 'finance_coinmarketcap_quotes',
      description: 'Read latest CoinMarketCap cryptocurrency quotes through the Host API-key credential. Pass CoinMarketCap IDs or symbols and an optional conversion currency.',
      parameters: {
        id: { type: 'number', description: 'One CoinMarketCap cryptocurrency ID.' },
        ids: { type: 'array', description: 'CoinMarketCap cryptocurrency IDs.', items: { type: 'number' } },
        symbols: { type: 'array', description: 'Cryptocurrency symbols such as BTC or ETH.', items: { type: 'string' } },
        convert: { type: 'string', description: 'Conversion currency; defaults to USD.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            quotes: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'number', required: true },
                  name: { type: 'string', required: true },
                  symbol: { type: 'string', required: true },
                  slug: { type: 'string' },
                  rank: { type: 'number' },
                  currency: { type: 'string', required: true },
                  price: { type: 'number' },
                  percent_change_24h: { type: 'number' },
                  market_cap: { type: 'number' },
                  volume_24h: { type: 'number' },
                  last_updated: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `${String(value.quotes.length)} CoinMarketCap quote(s)` }],
      },
      async execute(args, exec) {
        const quotes = await loadCoinMarketCapQuotes({
          ...args.id === undefined ? {} : { id: args.id },
          ...args.ids === undefined ? {} : { ids: args.ids },
          ...args.symbols === undefined ? {} : { symbols: args.symbols },
          ...args.convert === undefined ? {} : { convert: args.convert },
        }, exec.signal)
        return {
          quotes: quotes.map(quote => ({
            id: quote.id,
            name: quote.name,
            symbol: quote.symbol,
            ...quote.slug === undefined ? {} : { slug: quote.slug },
            ...quote.rank === undefined ? {} : { rank: quote.rank },
            currency: quote.currency,
            ...quote.price === undefined ? {} : { price: quote.price },
            ...quote.percentChange24h === undefined ? {} : { percent_change_24h: quote.percentChange24h },
            ...quote.marketCap === undefined ? {} : { market_cap: quote.marketCap },
            ...quote.volume24h === undefined ? {} : { volume_24h: quote.volume24h },
            ...quote.lastUpdated === undefined ? {} : { last_updated: quote.lastUpdated },
          })),
        }
      },
    }))
  }

  const loadCoinMarketCapOhlcv = provider.loadCoinMarketCapOhlcv?.bind(provider)
  if (loadCoinMarketCapOhlcv !== undefined) {
    ctx.tools.register(defineTool({
      name: 'finance_coinmarketcap_ohlcv',
      description: 'Read CoinMarketCap historical OHLCV through the Host API-key credential. Pass a CoinMarketCap ID or symbol, dates or count, and an interval such as 1d.',
      parameters: {
        id: { type: 'number', description: 'One CoinMarketCap cryptocurrency ID.' },
        ids: { type: 'array', description: 'CoinMarketCap cryptocurrency IDs.', items: { type: 'number' } },
        symbols: { type: 'array', description: 'Cryptocurrency symbols such as BTC or ETH.', items: { type: 'string' } },
        convert: { type: 'string', description: 'Conversion currency; defaults to USD.' },
        time_start: { type: 'string', description: 'Exclusive ISO-8601 start time.' },
        time_end: { type: 'string', description: 'Inclusive ISO-8601 end time.' },
        count: { type: 'number', description: 'Number of periods when no start time is supplied.' },
        interval: { type: 'string', description: 'CoinMarketCap interval such as 1h or 1d.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            series: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'number', required: true },
                  name: { type: 'string', required: true },
                  symbol: { type: 'string', required: true },
                  currency: { type: 'string', required: true },
                  bars: {
                    type: 'array',
                    required: true,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        timestamp: { type: 'string', required: true },
                        open: { type: 'number', required: true },
                        high: { type: 'number', required: true },
                        low: { type: 'number', required: true },
                        close: { type: 'number', required: true },
                        volume: { type: 'number', required: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `${String(value.series.length)} CoinMarketCap OHLCV series` }],
      },
      async execute(args, exec) {
        const series = await loadCoinMarketCapOhlcv({
          ...args.id === undefined ? {} : { id: args.id },
          ...args.ids === undefined ? {} : { ids: args.ids },
          ...args.symbols === undefined ? {} : { symbols: args.symbols },
          ...args.convert === undefined ? {} : { convert: args.convert },
          ...args.time_start === undefined ? {} : { timeStart: args.time_start },
          ...args.time_end === undefined ? {} : { timeEnd: args.time_end },
          ...args.count === undefined ? {} : { count: args.count },
          ...args.interval === undefined ? {} : { interval: args.interval },
        }, exec.signal)
        return {
          series: series.map(item => ({
            id: item.id,
            name: item.name,
            symbol: item.symbol,
            currency: item.currency,
            bars: item.bars.map(bar => ({ ...bar })),
          })),
        }
      },
    }))
  }

  if (streamProvider !== undefined) {
    ctx.tools.register(defineTool({
      name: 'finance_realtime_stream',
      description: 'Collect a bounded real-time WebSocket batch. Binance supports miniTicker/trade/kline streams; CoinMarketCap supports latest-price subscriptions by crypto_ids.',
      parameters: {
        provider: {
          type: 'string',
          description: 'WebSocket provider; defaults to Binance.',
          enum: ['binance', 'coinmarketcap'],
        },
        symbols: {
          type: 'array',
          description: 'Binance symbols such as BTCUSDT or ETHUSDT.',
          items: { type: 'string' },
        },
        crypto_ids: {
          type: 'array',
          description: 'CoinMarketCap numeric cryptocurrency IDs such as 1 for BTC or 1027 for ETH.',
          items: { type: 'number' },
        },
        stream_type: {
          type: 'string',
          description: 'Binance stream suffix; defaults to miniTicker.',
          enum: ['trade', 'miniTicker', 'kline_1m'],
        },
        timeout_ms: {
          type: 'number',
          description: 'Maximum collection time in milliseconds.',
        },
        max_events: {
          type: 'number',
          description: 'Maximum parsed events to return.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            events: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  provider: { type: 'string', required: true, enum: ['binance', 'coinmarketcap'] },
                  stream: { type: 'string', required: true },
                  received_at: { type: 'string', required: true },
                  data: { type: 'json', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `${String(value.events.length)} real-time events from ${String(new Set(value.events.map(event => event.stream)).size)} streams`,
        }],
      },
      async execute(args, exec) {
        const provider = args.provider ?? 'binance'
        const events = provider === 'coinmarketcap'
          ? await (() => {
            if (args.crypto_ids === undefined || args.crypto_ids.length === 0) {
              throw new FinanceDataError('crypto_ids must contain at least one CoinMarketCap cryptocurrency ID', 'INVALID_STREAM')
            }
            return streamProvider.collect({
              provider,
              streams: [],
              cryptoIds: args.crypto_ids,
              ...args.timeout_ms === undefined ? {} : { timeoutMs: args.timeout_ms },
              ...args.max_events === undefined ? {} : { maxEvents: args.max_events },
            }, exec.signal)
          })()
          : await (() => {
            if (args.symbols === undefined || args.symbols.length === 0) {
              throw new FinanceDataError('symbols must contain at least one Binance symbol', 'INVALID_STREAM')
            }
            const streamType = args.stream_type ?? 'miniTicker'
            return streamProvider.collect({
              provider,
              streams: args.symbols.map(symbol => `${symbol.trim().toLowerCase()}@${streamType}`),
              ...args.timeout_ms === undefined ? {} : { timeoutMs: args.timeout_ms },
              ...args.max_events === undefined ? {} : { maxEvents: args.max_events },
            }, exec.signal)
          })()
        return {
          events: events.map(event => ({
            provider: event.provider ?? provider,
            stream: event.stream,
            received_at: event.receivedAt,
            data: event.data,
          })),
        }
      },
    }))
  }

  ctx.tools.register(defineTool({
    name: 'finance_monitor_plan',
    description: 'Build scheduler arguments for pre-market, after-hours, or BTC 24/7 monitoring. Pass the returned schedule and prompt to schedule_create.',
    parameters: {
      kind: {
        type: 'string',
        required: true,
        description: 'Monitoring cadence.',
        enum: ['pre-market', 'after-hours', 'btc-24x7'],
      },
      symbol: {
        type: 'string',
        description: 'Instrument symbol for pre-market or after-hours monitoring.',
      },
      pre_open_minutes: {
        type: 'number',
        description: 'Minutes before the US regular-session open; defaults to 30.',
      },
      after_close_minutes: {
        type: 'number',
        description: 'Minutes after the US regular-session close; defaults to 30.',
      },
      btc_interval_seconds: {
        type: 'number',
        description: `BTC fixed-rate interval in seconds; minimum ${String(MONITOR_MINIMUM_BTC_INTERVAL_SECONDS)}, default ${String(MONITOR_DEFAULT_BTC_INTERVAL_SECONDS)}.`,
      },
      time_zone: {
        type: 'string',
        description: 'IANA time zone for US session boundaries; defaults to America/New_York.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, enum: ['pre-market', 'after-hours', 'btc-24x7'] },
          symbol: { type: 'string' },
          schedule: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              at: { type: 'string' },
              every_seconds: { type: 'number' },
            },
          },
          prompt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.schedule.at === undefined
          ? `${value.kind}: every ${String(value.schedule.every_seconds)} seconds`
          : `${value.kind} ${value.symbol} at ${value.schedule.at}`,
      }],
    },
    execute(args) {
      const plan = planFinanceMonitor({
        kind: args.kind,
        ...args.symbol === undefined ? {} : { symbol: args.symbol },
        ...args.pre_open_minutes === undefined ? {} : { preOpenMinutes: args.pre_open_minutes },
        ...args.after_close_minutes === undefined ? {} : { afterCloseMinutes: args.after_close_minutes },
        ...args.btc_interval_seconds === undefined ? {} : { btcIntervalSeconds: args.btc_interval_seconds },
        ...args.time_zone === undefined ? {} : { timeZone: args.time_zone },
      })
      return Promise.resolve({
        kind: plan.kind,
        ...plan.symbol === undefined ? {} : { symbol: plan.symbol },
        schedule: 'at' in plan.schedule
          ? { at: plan.schedule.at }
          : { every_seconds: plan.schedule.everySeconds },
        prompt: plan.prompt,
      })
    },
  }))

}

/**
 * Register finance research tools using the settings-backed provider.
 * @param ctx - Registrant context carrying tool, settings, and credential services.
 * @param config - Resolved composition defaults.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as Required<Config>
  let currentSettings: FinanceRuntimeSettings = {
    provider: resolved.provider,
    timeoutMs: resolved.timeoutMs,
    barLimit: resolved.barLimit,
    yahooBaseUrl: resolved.yahooBaseUrl,
    binanceBaseUrl: resolved.binanceBaseUrl,
    binanceUsdmBaseUrl: resolved.binanceUsdmBaseUrl,
    binanceCoinmBaseUrl: resolved.binanceCoinmBaseUrl,
    binanceOptionsBaseUrl: resolved.binanceOptionsBaseUrl,
    polymarketGammaBaseUrl: resolved.polymarketGammaBaseUrl,
    polymarketClobBaseUrl: resolved.polymarketClobBaseUrl,
    coinMarketCapBaseUrl: resolved.coinMarketCapBaseUrl,
    enableSignedRequests: resolved.enableSignedRequests,
    enableCoinMarketCapRequests: resolved.enableCoinMarketCapRequests,
    enableAkshare: resolved.enableAkshare,
    enableIfind: resolved.enableIfind,
    ifindTransport: resolved.ifindTransport,
    ifindBaseUrl: resolved.ifindBaseUrl,
    pythonExecutable: resolved.pythonExecutable,
    stockBridgeTimeoutMs: resolved.stockBridgeTimeoutMs,
    stockBridgeMaxOutputBytes: resolved.stockBridgeMaxOutputBytes,
    requestCacheTtlMs: resolved.requestCacheTtlMs,
    requestCacheMaxEntries: resolved.requestCacheMaxEntries,
    requestMaxRetries: resolved.requestMaxRetries,
    requestRetryBaseDelayMs: resolved.requestRetryBaseDelayMs,
    requestRetryMaxDelayMs: resolved.requestRetryMaxDelayMs,
    requestsPerMinute: resolved.requestsPerMinute,
    requestBurst: resolved.requestBurst,
    binanceWebSocketBaseUrl: resolved.binanceWebSocketBaseUrl,
    coinMarketCapWebSocketBaseUrl: resolved.coinMarketCapWebSocketBaseUrl,
    marketStreamTimeoutMs: resolved.marketStreamTimeoutMs,
    marketStreamMaxEvents: resolved.marketStreamMaxEvents,
  }
  let stockProvider: SubprocessFinanceStockDataProvider | undefined
  let resolveCredential: FinanceCredentialResolver = () => Promise.resolve(undefined)
  const authorize = composeRequestAuthorizers(
    createBinanceRequestAuthorizer({
      resolveCredential: ref => resolveCredential(ref),
      enabled: () => currentSettings.enableSignedRequests,
    }),
    createCoinMarketCapRequestAuthorizer({
      resolveCredential: ref => resolveCredential(ref),
      enabled: () => currentSettings.enableCoinMarketCapRequests,
    }),
  )
  const provider = new SettingsFinanceMarketDataProvider(() => currentSettings, authorize)
  const streamProvider = new SettingsFinanceMarketStreamProvider(
    () => currentSettings,
    ref => resolveCredential(ref),
  )
  registerFinanceTools(ctx, provider, streamProvider)
  ctx.inject(['subprocess'], (subprocessCtx) => {
    const bridge = new FinanceStockSubprocessBridge({
      subprocess: subprocessCtx.subprocess,
      pythonExecutable: currentSettings.pythonExecutable,
      timeoutMs: currentSettings.stockBridgeTimeoutMs,
      maxOutputBytes: currentSettings.stockBridgeMaxOutputBytes,
      ifindBaseUrl: currentSettings.ifindBaseUrl,
      readRuntimeOptions: () => ({
        pythonExecutable: currentSettings.pythonExecutable,
        timeoutMs: currentSettings.stockBridgeTimeoutMs,
        maxOutputBytes: currentSettings.stockBridgeMaxOutputBytes,
        ifindBaseUrl: currentSettings.ifindBaseUrl,
      }),
      resolveCredential: ref => resolveCredential(ref),
    })
    stockProvider = new SubprocessFinanceStockDataProvider(bridge, {
      enabled: provider => provider === 'akshare'
        ? currentSettings.enableAkshare
        : currentSettings.enableIfind,
      ifindTransport: () => currentSettings.ifindTransport,
    })
    registerStockTools(ctx, stockProvider)
  })

  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(FINANCE_SETTINGS_NS, Config, { base: resolved })
    currentSettings = scope.get() as FinanceRuntimeSettings
    scope.watch((next) => {
      currentSettings = next as FinanceRuntimeSettings
    })
  })
  ctx.inject(['credentials'], (credentialCtx) => {
    resolveCredential = async (ref) => {
      const hit = await credentialCtx.credentials.resolve(credentialRef(ref))
      return hit?.value
    }
  })
  registerFinanceDashboardRoutes(ctx, {
    market: provider,
    stock: () => stockProvider,
    enabledStock: provider => provider === 'akshare'
      ? currentSettings.enableAkshare
      : currentSettings.enableIfind,
  })
}
