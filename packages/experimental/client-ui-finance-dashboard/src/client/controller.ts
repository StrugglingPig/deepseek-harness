/** Finance dashboard controller owning REST snapshots and the live Binance stream. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { parseKlines, priceChangePercent, toBinanceSymbol, type DashboardBar } from './market-data.ts'

const DEFAULT_BASE_URL = 'https://api.binance.com'
const DEFAULT_WS_URL = 'wss://stream.binance.com:9443'
const DEFAULT_LIMIT = 120

/** Supported dashboard chart intervals. */
export type DashboardInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'

/** Snapshot rendered by the finance dashboard. */
export interface FinanceDashboardState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly symbol: string
  readonly interval: DashboardInterval
  readonly bars: readonly DashboardBar[]
  readonly latestPrice: number | undefined
  readonly changePercent: number | undefined
  readonly streamStatus: 'disconnected' | 'connecting' | 'live' | 'error'
  readonly error: string | undefined
}

/** Actions exposed to the dashboard component. */
export interface FinanceDashboardActions {
  /** Start the initial load once. */
  ensure(): void
  /** Reload REST history and reconnect the stream. */
  refresh(): void
  /**
   * Change the requested symbol.
   * @param symbol - User-entered symbol.
   */
  setSymbol(symbol: string): void
  /**
   * Change the chart interval.
   * @param interval - Selected chart interval.
   */
  setInterval(interval: DashboardInterval): void
}

/** Browser face injected into the dashboard component. */
export interface FinanceDashboardFace extends FinanceDashboardActions {
  readonly hooks: {
    readonly dashboard: SnapshotStore<FinanceDashboardState>
  }
}

/** Minimal settings surface read by the dashboard. */
export interface FinanceDashboardSettingsScope {
  getSnapshot(): {
    readonly value:
      | {
        readonly binanceBaseUrl?: string
        readonly binanceWebSocketBaseUrl?: string
      }
      | undefined
  }
  subscribe(listener: () => void): () => void
}

/** Minimal browser WebSocket surface owned by the dashboard. */
export interface FinanceDashboardSocket {
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  close(): void
}

/** Options for deterministic dashboard tests and embeddings. */
export interface FinanceDashboardControllerOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly createSocket?: (url: string) => FinanceDashboardSocket
  readonly reconnectMs?: number
}

interface ResolvedOptions {
  readonly fetch: typeof globalThis.fetch
  readonly createSocket?: (url: string) => FinanceDashboardSocket
  readonly reconnectMs: number
}

function defaultCreateSocket(url: string): FinanceDashboardSocket {
  return new WebSocket(url)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Owns one dashboard's REST request, stream, and reconnect lifecycle. */
export class FinanceDashboardController {
  private readonly store: SnapshotStore<FinanceDashboardState>
  private readonly options: ResolvedOptions
  private socket: FinanceDashboardSocket | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private readonly unsubscribe: () => void

  /**
   * @param scope - Bound finance settings namespace.
   * @param options - Fetch, WebSocket, and reconnect overrides.
   */
  constructor(
    private readonly scope: FinanceDashboardSettingsScope,
    options: FinanceDashboardControllerOptions = {},
  ) {
    this.options = {
      fetch: options.fetch ?? globalThis.fetch,
      ...options.createSocket === undefined ? {} : { createSocket: options.createSocket },
      reconnectMs: options.reconnectMs ?? 3_000,
    }
    this.store = createSnapshotStore({
      status: 'idle',
      symbol: 'BTC',
      interval: '1m',
      bars: [],
      latestPrice: undefined,
      changePercent: undefined,
      streamStatus: 'disconnected',
      error: undefined,
    })
    this.unsubscribe = scope.subscribe(() => { this.closeSocket() })
  }

  private settings() {
    const value = this.scope.getSnapshot().value
    return {
      baseUrl: value?.binanceBaseUrl ?? DEFAULT_BASE_URL,
      wsUrl: value?.binanceWebSocketBaseUrl ?? DEFAULT_WS_URL,
    }
  }

  private update(patch: Partial<FinanceDashboardState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  private closeSocket(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    this.socket?.close()
    this.socket = undefined
  }

  private connect(): void {
    if (this.disposed) return
    this.closeSocket()
    const state = this.store.getSnapshot()
    const createSocket = this.options.createSocket ?? defaultCreateSocket
    const socket = createSocket(`${this.settings().wsUrl}/ws/${toBinanceSymbol(state.symbol).toLowerCase()}@kline_${state.interval}`)
    this.socket = socket
    this.update({ streamStatus: 'connecting' })
    socket.onopen = () => { this.update({ streamStatus: 'live' }) }
    socket.onerror = () => { this.update({ streamStatus: 'error' }) }
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as {
          k?: { t?: unknown; o?: unknown; h?: unknown; l?: unknown; c?: unknown; v?: unknown }
        }
        const k = payload.k
        const values = [k?.t, k?.o, k?.h, k?.l, k?.c, k?.v].map(Number)
        if (values.some(value => !Number.isFinite(value))) return
        const bar: DashboardBar = {
          time: values[0] as number,
          open: values[1] as number,
          high: values[2] as number,
          low: values[3] as number,
          close: values[4] as number,
          volume: values[5] as number,
        }
        const current = this.store.getSnapshot()
        const bars = current.bars.at(-1)?.time === bar.time
          ? [...current.bars.slice(0, -1), bar]
          : [...current.bars, bar]
        this.update({
          bars,
          latestPrice: bar.close,
          changePercent: priceChangePercent(bars),
        })
      } catch {
        this.update({ streamStatus: 'error' })
      }
    }
    socket.onclose = () => {
      if (this.socket !== socket || this.disposed) return
      this.socket = undefined
      this.update({ streamStatus: 'disconnected' })
      if (this.options.reconnectMs > 0) {
        this.reconnectTimer = setTimeout(() => { this.connect() }, this.options.reconnectMs)
      }
    }
  }

  private async load(): Promise<void> {
    if (this.disposed) return
    this.update({ status: 'loading', error: undefined })
    const state = this.store.getSnapshot()
    const query = `symbol=${encodeURIComponent(toBinanceSymbol(state.symbol))}&interval=${encodeURIComponent(state.interval)}&limit=${String(DEFAULT_LIMIT)}`
    try {
      const request = this.options.fetch
      const response = await request(`${this.settings().baseUrl}/api/v3/klines?${query}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bars = parseKlines(await response.json())
      if (bars.length === 0) throw new Error('no market data')
      this.update({
        status: 'ready',
        bars,
        latestPrice: bars.at(-1)?.close,
        changePercent: priceChangePercent(bars),
        error: undefined,
      })
      this.connect()
    } catch (error: unknown) {
      this.update({ status: 'error', error: errorText(error) })
    }
  }

  /** Start the initial load once. */
  ensure(): void {
    if (this.store.getSnapshot().status === 'idle') void this.load()
  }

  /** Reload REST history and reconnect the stream. */
  refresh(): void {
    void this.load()
  }

  /**
   * Change the requested symbol.
   * @param symbol - User-entered symbol.
   */
  setSymbol(symbol: string): void {
    const normalized = symbol.trim().toUpperCase()
    if (normalized.length === 0) return
    this.update({ symbol: normalized })
    void this.load()
  }

  /**
   * Change the chart interval.
   * @param interval - Selected chart interval.
   */
  setInterval(interval: DashboardInterval): void {
    this.update({ interval })
    void this.load()
  }

  /**
   * Build the component face and start the initial lazy load.
   * @returns Dashboard actions and snapshot hooks.
   */
  inject(): FinanceDashboardFace {
    this.ensure()
    return {
      ensure: () => { this.ensure() },
      refresh: () => { this.refresh() },
      setSymbol: (symbol) => { this.setSymbol(symbol) },
      setInterval: (interval) => { this.setInterval(interval) },
      hooks: { dashboard: this.store },
    }
  }

  /** Release the live stream and settings subscription. */
  dispose(): void {
    this.disposed = true
    this.closeSocket()
    this.unsubscribe()
  }
}
