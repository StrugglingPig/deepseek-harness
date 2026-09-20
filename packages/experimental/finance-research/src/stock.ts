/** Python-backed mainland stock data through the subprocess capability seam. */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z as zod } from 'zod'
import type { FinanceCredentialResolver } from './auth.ts'
import { FinanceDataError } from './error.ts'
import { buildIndicatorAnalysis } from './indicators.ts'
import type {
  FinanceStockDataProvider,
  FinanceStockHistoryRequest,
  FinanceStockQuote,
  FinanceStockQuoteRequest,
  FinanceStockSnapshot,
  MarketBar,
} from './types.ts'

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const IFIND_USER_REF = 'FINANCE_IFIND_USER'
const IFIND_PASSWORD_REF = 'FINANCE_IFIND_PASSWORD'
const IFIND_REFRESH_TOKEN_REF = 'FINANCE_IFIND_REFRESH_TOKEN'
const DEFAULT_IFIND_BASE_URL = 'https://quantapi.51ifind.com'
const stockBarSchema = zod.object({
  timestamp: zod.string(),
  open: zod.number(),
  high: zod.number(),
  low: zod.number(),
  close: zod.number(),
  volume: zod.number(),
})
const stockHistorySchema = zod.object({
  symbol: zod.string(),
  name: zod.string(),
  bars: zod.array(stockBarSchema),
})
const stockQuoteSchema = zod.object({
  symbol: zod.string(),
  name: zod.string().optional(),
  currency: zod.literal('CNY'),
  asOf: zod.string(),
  source: zod.union([zod.literal('akshare'), zod.literal('ifind')]),
  price: zod.number().optional(),
  changePercent: zod.number().optional(),
  change: zod.number().optional(),
  open: zod.number().optional(),
  high: zod.number().optional(),
  low: zod.number().optional(),
  previousClose: zod.number().optional(),
  volume: zod.number().optional(),
  amount: zod.number().optional(),
})
const stockQuotesSchema = zod.object({ quotes: zod.array(stockQuoteSchema) })
const bridgeSuccessSchema = zod.object({
  ok: zod.literal(true),
  data: zod.unknown(),
})
const bridgeFailureSchema = zod.object({
  ok: zod.literal(false),
  error: zod.object({
    code: zod.string(),
    message: zod.string(),
  }),
})

/** One request sent to the bundled Python stock bridge. */
export interface FinanceStockBridgeRequest {
  readonly action: 'stock_history' | 'stock_quote'
  readonly provider: 'akshare' | 'ifind'
  readonly symbol?: string
  readonly symbols?: readonly string[]
  readonly startDate?: string
  readonly endDate?: string
  readonly adjust?: 'none' | 'qfq' | 'hfq'
  /** iFinD transport selected by Host settings. */
  readonly transport?: 'http' | 'local'
}

/** Testable result returned by the Python stock bridge. */
export interface FinanceStockBridge {
  /** Run one bridge request and return its validated JSON data. */
  run(request: FinanceStockBridgeRequest, signal?: AbortSignal): Promise<unknown>
}

/** Runtime options read fresh before each stock bridge invocation. */
export interface FinanceStockSubprocessBridgeRuntimeOptions {
  /** Python executable used to run the bridge. */
  readonly pythonExecutable: string
  /** Bridge timeout in milliseconds. */
  readonly timeoutMs: number
  /** Maximum captured stdout size in bytes. */
  readonly maxOutputBytes: number
  /** iFinD HTTP API origin. */
  readonly ifindBaseUrl: string
}

/** Options for the bundled Python stock bridge. */
export interface FinanceStockSubprocessBridgeOptions {
  /** Subprocess service used for confinement and output limits. */
  readonly subprocess: SubprocessRuntime
  /** Initial Python executable used to run the bridge. */
  readonly pythonExecutable: string
  /** Initial bridge timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Initial maximum captured stdout size in bytes. */
  readonly maxOutputBytes?: number
  /** Optional bridge script path override. */
  readonly scriptPath?: string
  /** Optional working directory for the Python process. */
  readonly cwd?: string
  /** Initial iFinD HTTP API origin. */
  readonly ifindBaseUrl?: string
  /** Read the latest runtime options before each invocation. */
  readonly readRuntimeOptions?: () => FinanceStockSubprocessBridgeRuntimeOptions
  /** Resolve iFinD credentials without exposing them to model-visible data. */
  readonly resolveCredential: FinanceCredentialResolver
}

interface ResolvedBridgeOptions {
  readonly subprocess: SubprocessRuntime
  readonly scriptPath: string
  readonly cwd: string
  readonly readRuntimeOptions: () => FinanceStockSubprocessBridgeRuntimeOptions
  readonly resolveCredential: FinanceCredentialResolver
}

/** Run the bundled Python bridge through `ctx.subprocess`. */
export class FinanceStockSubprocessBridge implements FinanceStockBridge {
  private readonly options: ResolvedBridgeOptions

  /**
   * @param options - subprocess service, Python executable, limits, and credentials.
   */
  constructor(options: FinanceStockSubprocessBridgeOptions) {
    const initialRuntimeOptions: FinanceStockSubprocessBridgeRuntimeOptions = {
      pythonExecutable: options.pythonExecutable,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      ifindBaseUrl: options.ifindBaseUrl ?? DEFAULT_IFIND_BASE_URL,
    }
    this.options = {
      subprocess: options.subprocess,
      scriptPath: options.scriptPath ?? fileURLToPath(new URL('../python/finance_stock_bridge.py', import.meta.url)),
      cwd: options.cwd ?? process.cwd(),
      readRuntimeOptions: options.readRuntimeOptions ?? (() => initialRuntimeOptions),
      resolveCredential: options.resolveCredential,
    }
  }

  /**
   * Run one bridge request.
   * @param request - stock action, provider, and query fields.
   * @param signal - optional caller cancellation.
   * @returns Parsed JSON data from the bridge.
   */
  async run(request: FinanceStockBridgeRequest, signal?: AbortSignal): Promise<unknown> {
    const runtime = this.options.readRuntimeOptions()
    const timeout = AbortSignal.timeout(runtime.timeoutMs)
    const requestSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const env: Record<string, string> = { PYTHONIOENCODING: 'utf-8' }
    if (request.provider === 'ifind') {
      if (request.transport === undefined) {
        throw new FinanceDataError('iFinD transport is required', 'INVALID_STOCK_TRANSPORT')
      }
      env.IFIND_BASE_URL = runtime.ifindBaseUrl
      if (request.transport === 'http') {
        const refreshToken = await this.options.resolveCredential(IFIND_REFRESH_TOKEN_REF)
        if (refreshToken === undefined || refreshToken.length === 0) {
          throw new FinanceDataError('iFinD refresh token is not configured', 'IFIND_AUTH_REQUIRED')
        }
        env.IFIND_REFRESH_TOKEN = refreshToken
      } else {
        const user = await this.options.resolveCredential(IFIND_USER_REF)
        const password = await this.options.resolveCredential(IFIND_PASSWORD_REF)
        if (user === undefined || user.length === 0 || password === undefined || password.length === 0) {
          throw new FinanceDataError('iFinD account and password are not configured', 'IFIND_AUTH_REQUIRED')
        }
        env.IFIND_USER = user
        env.IFIND_PASSWORD = password
      }
    }

    let executable: string
    try {
      executable = await this.options.subprocess.resolveExecutable(runtime.pythonExecutable, undefined, requestSignal)
    } catch (error: unknown) {
      throw new FinanceDataError(`Python executable was not found: ${runtime.pythonExecutable}: ${String(error)}`, 'STOCK_PYTHON_NOT_FOUND')
    }

    const handle = this.options.subprocess.spawn({
      argv: [executable, this.options.scriptPath],
      cwd: this.options.cwd,
      stdio: {
        stdin: { data: JSON.stringify(request) },
        stdout: { maxBytes: runtime.maxOutputBytes },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 1_000,
      signal: requestSignal,
      env,
    })
    let outcome: { readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }
    try {
      outcome = await handle.done
    } catch (error: unknown) {
      if (timeout.aborted) throw new FinanceDataError('stock bridge timed out', 'STOCK_BRIDGE_TIMEOUT')
      if (signal?.aborted === true) throw new FinanceDataError('stock bridge aborted', 'ABORTED')
      throw new FinanceDataError(`stock bridge failed: ${String(error)}`, 'STOCK_BRIDGE_FAILED')
    }
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    if (stdout.length === 0) {
      throw new FinanceDataError(`stock bridge produced no output${stderr.length === 0 ? '' : `: ${stderr}`}`, 'STOCK_BRIDGE_FAILED')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(stdout)
    } catch (error: unknown) {
      throw new FinanceDataError(`stock bridge returned invalid JSON: ${String(error)}`, 'STOCK_BRIDGE_INVALID_JSON')
    }
    const failure = bridgeFailureSchema.safeParse(parsed)
    if (failure.success) throw new FinanceDataError(failure.data.error.message, failure.data.error.code)
    const success = bridgeSuccessSchema.safeParse(parsed)
    if (!success.success) {
      throw new FinanceDataError(`stock bridge returned an invalid envelope (exit ${String(outcome.exitCode)})`, 'STOCK_BRIDGE_INVALID_RESPONSE')
    }
    return success.data.data
  }
}

/** Options for the Python-backed stock provider. */
export interface SubprocessFinanceStockDataProviderOptions {
  /** Retrieval clock for normalized source metadata. */
  readonly now?: () => Date
  /** Whether one configured stock provider is enabled. */
  readonly enabled?: (provider: 'akshare' | 'ifind') => boolean
  /** iFinD transport selected by the latest Host settings. */
  readonly ifindTransport?: () => 'http' | 'local'
}

/** Stock provider that delegates installed AKShare/iFinD calls to the bridge. */
export class SubprocessFinanceStockDataProvider implements FinanceStockDataProvider {
  readonly id = 'stock-python'
  private readonly now: () => Date
  private readonly enabled: (provider: 'akshare' | 'ifind') => boolean
  private readonly ifindTransport: () => 'http' | 'local'

  /**
   * @param bridge - validated Python bridge.
   * @param options - clock and provider feature switches.
   */
  constructor(
    private readonly bridge: FinanceStockBridge,
    options: SubprocessFinanceStockDataProviderOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
    this.enabled = options.enabled ?? (() => true)
    this.ifindTransport = options.ifindTransport ?? (() => 'http')
  }

  private assertEnabled(provider: 'akshare' | 'ifind'): void {
    if (!this.enabled(provider)) {
      throw new FinanceDataError(`${provider} stock data is disabled in settings`, 'STOCK_PROVIDER_DISABLED')
    }
  }

  /**
   * Load normalized daily A-share history.
   * @param request - provider, symbol, dates, and adjustment mode.
   * @param signal - optional caller cancellation.
   * @returns Snapshot ready for technical analysis and reports.
   */
  async loadStockSnapshot(request: FinanceStockHistoryRequest, signal?: AbortSignal): Promise<FinanceStockSnapshot> {
    this.assertEnabled(request.provider)
    const symbol = request.symbol.trim().toUpperCase()
    if (symbol.length === 0) throw new FinanceDataError('stock symbol must be a non-empty string', 'INVALID_SYMBOL')
    const data = stockHistorySchema.parse(await this.bridge.run({
      action: 'stock_history',
      provider: request.provider,
      symbol,
      ...request.startDate === undefined ? {} : { startDate: request.startDate },
      ...request.endDate === undefined ? {} : { endDate: request.endDate },
      ...request.adjust === undefined ? {} : { adjust: request.adjust },
      ...request.provider === 'ifind' ? { transport: this.ifindTransport() } : {},
    }, signal))
    if (data.bars.length < 50) throw new FinanceDataError(`only ${String(data.bars.length)} stock bars returned for ${symbol}`, 'INSUFFICIENT_HISTORY')
    const bars = data.bars as MarketBar[]
    const latest = bars.at(-1) as MarketBar
    const previous = bars.at(-2)
    const price = latest.close
    const changePercent = previous === undefined || previous.close === 0
      ? 0
      : (latest.close - previous.close) / previous.close * 100
    return {
      instrument: { symbol: data.symbol, name: data.name, assetClass: 'equity', currency: 'CNY' },
      asOf: latest.timestamp,
      source: { provider: request.provider, retrievedAt: this.now().toISOString(), synthetic: false },
      quote: { price, changePercent },
      bars,
    }
  }

  /**
   * Load normalized current A-share quotes.
   * @param request - provider and symbols.
   * @param signal - optional caller cancellation.
   * @returns Current quotes.
   */
  async loadStockQuotes(request: FinanceStockQuoteRequest, signal?: AbortSignal): Promise<readonly FinanceStockQuote[]> {
    this.assertEnabled(request.provider)
    const symbols = request.symbols.map(symbol => symbol.trim().toUpperCase()).filter(symbol => symbol.length > 0)
    if (symbols.length === 0) throw new FinanceDataError('stock quotes require at least one symbol', 'INVALID_SYMBOL')
    const data = stockQuotesSchema.parse(await this.bridge.run({
      action: 'stock_quote',
      provider: request.provider,
      symbols,
      ...request.provider === 'ifind' ? { transport: this.ifindTransport() } : {},
    }, signal))
    return data.quotes.map(quote => ({
      symbol: quote.symbol,
      name: quote.name,
      currency: quote.currency,
      asOf: quote.asOf,
      source: quote.source,
      price: quote.price,
      changePercent: quote.changePercent,
      change: quote.change,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      previousClose: quote.previousClose,
      volume: quote.volume,
      amount: quote.amount,
    }))
  }
}


/**
 * Register mainland stock tools over one Python-backed provider.
 * @param ctx - Registrant context carrying the tool registry.
 * @param provider - Stock data provider.
 */
export function registerStockTools(ctx: Context, provider: FinanceStockDataProvider): void {
  ctx.tools.register(defineTool({
    name: 'finance_stock_snapshot',
    description: 'Load normalized mainland A-share daily history through AKShare or Tonghuashun iFinD. Symbols are six-digit codes such as 600519 or 000001.',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Six-digit A-share symbol.' },
      provider: { type: 'string', required: true, enum: ['akshare', 'ifind'], description: 'Installed Python stock data provider.' },
      start_date: { type: 'string', description: 'Inclusive ISO start date.' },
      end_date: { type: 'string', description: 'Inclusive ISO end date.' },
      adjust: { type: 'string', enum: ['none', 'qfq', 'hfq'], description: 'Price adjustment mode.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          symbol: { type: 'string', required: true },
          asset_class: { type: 'string', required: true, const: 'equity' },
          as_of: { type: 'string', required: true },
          name: { type: 'string', required: true },
          currency: { type: 'string', required: true, const: 'CNY' },
          price: { type: 'number', required: true },
          change_percent: { type: 'number', required: true },
          bar_count: { type: 'integer', required: true },
          source: { type: 'string', required: true, enum: ['akshare', 'ifind'] },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.symbol}: ${value.name}, ${String(value.price)} CNY (${String(value.change_percent)}%), ${String(value.bar_count)} bars from ${value.source}` }],
    },
    async execute(args, exec) {
      const snapshot = await provider.loadStockSnapshot({
        provider: args.provider,
        symbol: args.symbol,
        ...args.start_date === undefined ? {} : { startDate: args.start_date },
        ...args.end_date === undefined ? {} : { endDate: args.end_date },
        ...args.adjust === undefined ? {} : { adjust: args.adjust },
      }, exec.signal)
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
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'finance_stock_quote',
    description: 'Read current mainland A-share real-time quotes through AKShare or Tonghuashun iFinD.',
    parameters: {
      symbols: { type: 'array', required: true, items: { type: 'string' }, description: 'Six-digit A-share symbols.' },
      provider: { type: 'string', required: true, enum: ['akshare', 'ifind'], description: 'Installed Python stock data provider.' },
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
                symbol: { type: 'string', required: true },
                name: { type: 'string' },
                currency: { type: 'string', required: true, const: 'CNY' },
                as_of: { type: 'string', required: true },
                source: { type: 'string', required: true, enum: ['akshare', 'ifind'] },
                price: { type: 'number' },
                change_percent: { type: 'number' },
                change: { type: 'number' },
                open: { type: 'number' },
                high: { type: 'number' },
                low: { type: 'number' },
                previous_close: { type: 'number' },
                volume: { type: 'number' },
                amount: { type: 'number' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${String(value.quotes.length)} mainland stock quote(s)` }],
    },
    async execute(args, exec) {
      const quotes = await provider.loadStockQuotes({ provider: args.provider, symbols: args.symbols }, exec.signal)
      return {
        quotes: quotes.map(quote => ({
          symbol: quote.symbol,
          ...quote.name === undefined ? {} : { name: quote.name },
          currency: quote.currency,
          as_of: quote.asOf,
          source: quote.source,
          ...quote.price === undefined ? {} : { price: quote.price },
          ...quote.changePercent === undefined ? {} : { change_percent: quote.changePercent },
          ...quote.change === undefined ? {} : { change: quote.change },
          ...quote.open === undefined ? {} : { open: quote.open },
          ...quote.high === undefined ? {} : { high: quote.high },
          ...quote.low === undefined ? {} : { low: quote.low },
          ...quote.previousClose === undefined ? {} : { previous_close: quote.previousClose },
          ...quote.volume === undefined ? {} : { volume: quote.volume },
          ...quote.amount === undefined ? {} : { amount: quote.amount },
        })),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'finance_stock_technical_analysis',
    description: 'Compute deterministic technical indicators for mainland A-share history returned by AKShare or iFinD.',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Six-digit A-share symbol.' },
      provider: { type: 'string', required: true, enum: ['akshare', 'ifind'], description: 'Installed Python stock data provider.' },
      start_date: { type: 'string', description: 'Inclusive ISO start date.' },
      end_date: { type: 'string', description: 'Inclusive ISO end date.' },
      adjust: { type: 'string', enum: ['none', 'qfq', 'hfq'], description: 'Price adjustment mode.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          symbol: { type: 'string', required: true },
          as_of: { type: 'string', required: true },
          composite: {
            type: 'object',
            required: true,
            additionalProperties: false,
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
            required: true,
            additionalProperties: false,
            properties: { atr_percent: { type: 'number', required: true } },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.symbol}: ${value.composite.direction} (${String(value.composite.confidence)}% confidence), ${String(value.conflicts.length)} conflicts` }],
    },
    async execute(args, exec) {
      const snapshot = await provider.loadStockSnapshot({
        provider: args.provider,
        symbol: args.symbol,
        ...args.start_date === undefined ? {} : { startDate: args.start_date },
        ...args.end_date === undefined ? {} : { endDate: args.end_date },
        ...args.adjust === undefined ? {} : { adjust: args.adjust },
      }, exec.signal)
      const analysis = buildIndicatorAnalysis(snapshot)
      return {
        symbol: analysis.symbol,
        as_of: analysis.asOf,
        composite: analysis.composite,
        conflicts: [...analysis.conflicts],
        risk: { atr_percent: analysis.risk.atrPercent },
      }
    },
  }))
}
