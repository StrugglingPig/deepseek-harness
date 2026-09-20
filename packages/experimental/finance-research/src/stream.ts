/** Binance combined WebSocket stream collection for real-time finance tools. */

import WebSocket from 'ws'
import { z as zod } from 'zod'
import { FinanceDataError } from './error.ts'
import type {
  FinanceMarketStreamEvent,
  FinanceMarketStreamRequest,
  FinanceMarketStreamProvider,
} from './types.ts'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_EVENTS = 100
const streamMessageSchema = zod.object({
  stream: zod.string(),
  data: zod.json(),
})

/** Minimal WebSocket surface owned by the stream collector. */
export interface FinanceWebSocketLike {
  on(event: 'message', listener: (data: unknown) => void): unknown
  on(event: 'error', listener: (error: unknown) => void): unknown
  on(event: 'close', listener: () => void): unknown
  removeAllListeners(event?: string): unknown
  close(): void
}

/** Options for the Binance combined-stream provider. */
export interface BinanceWebSocketStreamProviderOptions {
  /** Binance WebSocket origin. */
  readonly baseUrl: string
  /** Timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Maximum parsed events returned by one collection. */
  readonly maxEvents?: number
  /** Injectable clock for deterministic received-at values. */
  readonly now?: () => Date
  /** Injectable socket factory for tests and custom carriers. */
  readonly createSocket?: (url: string) => FinanceWebSocketLike
}

interface ResolvedOptions {
  readonly baseUrl: string
  readonly timeoutMs: number
  readonly maxEvents: number
  readonly now: () => Date
  readonly createSocket: (url: string) => FinanceWebSocketLike
}

function createSocket(url: string): FinanceWebSocketLike {
  return new WebSocket(url)
}

function textOfMessage(data: unknown): string {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return String(data)
}

function parseMessage(data: unknown, receivedAt: string): FinanceMarketStreamEvent {
  let parsed: unknown
  try {
    parsed = JSON.parse(textOfMessage(data))
  } catch (error: unknown) {
    throw new FinanceDataError(`invalid WebSocket JSON: ${String(error)}`, 'STREAM_INVALID')
  }
  const message = streamMessageSchema.safeParse(parsed)
  if (!message.success) throw new FinanceDataError('invalid Binance stream message', 'STREAM_INVALID')
  return { stream: message.data.stream, receivedAt, data: message.data.data }
}

/** Collect bounded real-time events from Binance's combined market-data stream. */
export class BinanceWebSocketStreamProvider implements FinanceMarketStreamProvider {
  private readonly options: ResolvedOptions

  /**
   * @param options - WebSocket origin, timeout, event cap, clock, and socket factory.
   */
  constructor(options: BinanceWebSocketStreamProviderOptions) {
    this.options = {
      baseUrl: options.baseUrl.replace(/\/+$/u, ''),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxEvents: options.maxEvents ?? DEFAULT_MAX_EVENTS,
      now: options.now ?? (() => new Date()),
      createSocket: options.createSocket ?? createSocket,
    }
  }

  /**
   * Open one combined stream and collect a bounded batch of parsed events.
   * @param request - Stream names plus optional timeout and event cap.
   * @param signal - Optional caller cancellation.
   * @returns Parsed events in arrival order.
   */
  async collect(
    request: FinanceMarketStreamRequest,
    signal?: AbortSignal,
  ): Promise<readonly FinanceMarketStreamEvent[]> {
    if (request.streams.length === 0) throw new FinanceDataError('at least one stream is required', 'INVALID_STREAM')
    if (signal?.aborted === true) throw new FinanceDataError('WebSocket stream aborted', 'ABORTED')
    const timeoutMs = request.timeoutMs ?? this.options.timeoutMs
    const maxEvents = request.maxEvents ?? this.options.maxEvents
    const url = `${this.options.baseUrl}/stream?streams=${request.streams.join('/')}`

    return await new Promise<readonly FinanceMarketStreamEvent[]>((resolve, reject) => {
      const events: FinanceMarketStreamEvent[] = []
      let settled = false
      const socket = this.options.createSocket(url)
      const finish = (result: readonly FinanceMarketStreamEvent[]): void => {
        /* v8 ignore next -- listener removal makes a second settle unreachable. */
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        socket.removeAllListeners('message')
        socket.removeAllListeners('error')
        socket.removeAllListeners('close')
        socket.close()
        resolve(result)
      }
      const fail = (error: FinanceDataError): void => {
        /* v8 ignore next -- listener removal makes a second settle unreachable. */
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        socket.removeAllListeners('message')
        socket.removeAllListeners('error')
        socket.removeAllListeners('close')
        socket.close()
        reject(error)
      }
      const onAbort = (): void => { fail(new FinanceDataError('WebSocket stream aborted', 'ABORTED')) }
      const timer = setTimeout(() => {
        if (events.length === 0) fail(new FinanceDataError('WebSocket stream timed out', 'STREAM_TIMEOUT'))
        else finish(events)
      }, timeoutMs)

      signal?.addEventListener('abort', onAbort, { once: true })
      socket.on('message', (data: unknown) => {
        try {
          events.push(parseMessage(data, this.options.now().toISOString()))
          if (events.length >= maxEvents) finish(events)
        } catch (error: unknown) {
          fail(error instanceof FinanceDataError
            ? error
            : new FinanceDataError(`WebSocket stream failed: ${String(error)}`, 'STREAM_FAILED'))
        }
      })
      socket.on('error', (error: unknown) => {
        fail(new FinanceDataError(`WebSocket stream failed: ${String(error)}`, 'STREAM_FAILED'))
      })
      socket.on('close', () => {
        /* v8 ignore next -- the close listener is removed on every settle. */
        if (!settled) fail(new FinanceDataError('WebSocket stream closed before completion', 'STREAM_CLOSED'))
      })
    })
  }
}
