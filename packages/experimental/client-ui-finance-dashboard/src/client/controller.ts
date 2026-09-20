/** Finance dashboard controller owning Host market snapshots and refresh lifecycle. */

import { DASHBOARD_MARKET_PATH } from '@deepseek-ai/dsh-experimental-finance-research/shared'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  defaultSymbol,
  intervalsFor,
  parseDashboardMarket,
  type DashboardAsset,
  type DashboardBar,
  type DashboardInterval,
  type DashboardQuote,
} from './market-data.ts'

const DEFAULT_LIMIT = 240
const DEFAULT_POLL_MS = 15_000

/** Snapshot rendered by the finance dashboard. */
export interface FinanceDashboardState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly asset: DashboardAsset
  readonly symbol: string
  readonly interval: DashboardInterval
  readonly bars: readonly DashboardBar[]
  readonly quote: DashboardQuote | undefined
  readonly name: string | undefined
  readonly source: string | undefined
  readonly asOf: string | undefined
  readonly streamStatus: 'disconnected' | 'connecting' | 'live' | 'error'
  readonly error: string | undefined
}

/** Actions exposed to the dashboard component. */
export interface FinanceDashboardActions {
  /** Start the initial load once. */
  ensure(): void
  /** Reload Host history immediately. */
  refresh(): void
  /**
   * Change the requested symbol.
   * @param symbol - User-entered symbol.
   */
  setSymbol(symbol: string): void
  /**
   * Change the selected asset family.
   * @param asset - Crypto, A-share, or US equity.
   */
  setAsset(asset: DashboardAsset): void
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
        readonly enableAkshare?: boolean
        readonly enableIfind?: boolean
      }
      | undefined
  }
  subscribe(listener: () => void): () => void
}

/** Options for deterministic dashboard tests and embeddings. */
export interface FinanceDashboardControllerOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly pollMs?: number
}

interface ResolvedOptions {
  readonly fetch: typeof globalThis.fetch
  readonly pollMs: number
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Owns one dashboard's Host request, polling, and refresh lifecycle. */
export class FinanceDashboardController {
  private readonly store: SnapshotStore<FinanceDashboardState>
  private readonly options: ResolvedOptions
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private requestId = 0
  private readonly unsubscribe: () => void

  /**
   * @param scope - Bound finance settings namespace.
   * @param options - Fetch and polling overrides.
   */
  constructor(
    scope: FinanceDashboardSettingsScope,
    options: FinanceDashboardControllerOptions = {},
  ) {
    this.options = {
      fetch: options.fetch ?? globalThis.fetch,
      pollMs: options.pollMs ?? DEFAULT_POLL_MS,
    }
    this.store = createSnapshotStore({
      status: 'idle',
      asset: 'crypto',
      symbol: defaultSymbol('crypto'),
      interval: '1m',
      bars: [],
      quote: undefined,
      name: undefined,
      source: undefined,
      asOf: undefined,
      streamStatus: 'disconnected',
      error: undefined,
    })
    this.unsubscribe = scope.subscribe(() => { this.refresh() })
  }

  private update(patch: Partial<FinanceDashboardState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  private schedule(): void {
    this.clearTimer()
    if (this.disposed || this.options.pollMs <= 0) return
    this.timer = setTimeout(() => { this.refresh() }, this.options.pollMs)
  }

  /**
   * Fetch one market snapshot from the Host dashboard route.
   * @param state - Current dashboard state.
   * @returns Nothing after the state has been updated.
   */
  private async load(state: FinanceDashboardState): Promise<void> {
    const request = this.options.fetch
    const requestId = ++this.requestId
    this.update({ status: 'loading', streamStatus: 'connecting', error: undefined })
    const query = new URLSearchParams({
      asset: state.asset,
      symbol: state.symbol,
      interval: state.interval,
      limit: String(DEFAULT_LIMIT),
    })
    try {
      const response = await request(`${DASHBOARD_MARKET_PATH}?${query.toString()}`, {
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      const parsed = parseDashboardMarket(await response.json())
      if (parsed === undefined) throw new Error('dashboard response was invalid')
      if (requestId !== this.requestId || this.disposed) return
      this.update({
        status: 'ready',
        streamStatus: 'live',
        asset: parsed.asset,
        symbol: parsed.symbol,
        interval: parsed.interval,
        bars: parsed.bars,
        quote: parsed.quote,
        name: parsed.name,
        source: parsed.source,
        asOf: parsed.asOf,
        error: undefined,
      })
    } catch (error) {
      if (requestId !== this.requestId || this.disposed) return
      this.update({ status: 'error', streamStatus: 'error', error: errorText(error) })
    } finally {
      if (requestId === this.requestId && !this.disposed) this.schedule()
    }
  }

  /** Start the initial load once. */
  ensure(): void {
    const state = this.store.getSnapshot()
    if (state.status === 'idle') void this.load(state)
  }

  /** Reload Host history and reset the polling deadline. */
  refresh(): void {
    this.clearTimer()
    void this.load(this.store.getSnapshot())
  }

  /**
   * Change the requested symbol.
   * @param symbol - User-entered symbol.
   */
  setSymbol(symbol: string): void {
    const normalized = symbol.trim().toUpperCase()
    if (normalized.length === 0) return
    this.update({ symbol: normalized })
    this.refresh()
  }

  /**
   * Change the selected asset family.
   * @param asset - Crypto, A-share, or US equity.
   */
  setAsset(asset: DashboardAsset): void {
    const state = this.store.getSnapshot()
    const intervals = intervalsFor(asset)
    const interval = intervals.includes(state.interval) ? state.interval : intervals[0] as DashboardInterval
    this.update({ asset, symbol: defaultSymbol(asset), interval })
    this.refresh()
  }

  /**
   * Change the chart interval.
   * @param interval - Selected chart interval.
   */
  setInterval(interval: DashboardInterval): void {
    this.update({ interval })
    this.refresh()
  }

  /**
 * Build the public browser face.
 * @returns The actions and state store bound to this controller.
 */
  inject(): FinanceDashboardFace {
    return {
      ensure: () => { this.ensure() },
      refresh: () => { this.refresh() },
      setSymbol: (symbol) => { this.setSymbol(symbol) },
      setAsset: (asset) => { this.setAsset(asset) },
      setInterval: (interval) => { this.setInterval(interval) },
      hooks: { dashboard: this.store },
    }
  }

  /** Stop polling and detach the settings subscription. */
  dispose(): void {
    this.disposed = true
    this.clearTimer()
    this.unsubscribe()
  }
}
