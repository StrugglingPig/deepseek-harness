/** Market and fundamental metrics a report quotes about its instrument. */

import type { FinanceStockFundamentals } from './types.ts'

/** Dimensions an asset metric belongs to; report blocks claim one or more. */
export const ASSET_METRIC_GROUPS = [
  'valuation', 'profitability', 'growth', 'balance', 'cash',
  'market', 'supply', 'development', 'community', 'industry',
] as const

/** One asset metric dimension. */
export type AssetMetricGroup = typeof ASSET_METRIC_GROUPS[number]

/** One reported metric about the instrument. */
export interface AssetMetric {
  readonly group: AssetMetricGroup
  /** Locale dictionary key for the metric label. */
  readonly key: string
  readonly value: number
  /** Reported unit: `%`, `CNY`, `USD`, or empty for a bare ratio or count. */
  readonly unit: string
  /** Reporting period or observation time, as published upstream. */
  readonly asOf: string
  readonly source: string
}

/** Ratios the A-share fundamentals bridge reports, with their dimension and unit. */
const EQUITY_METRICS: Readonly<Record<string, { readonly group: AssetMetricGroup; readonly unit: string }>> = {
  eps: { group: 'valuation', unit: 'CNY' },
  bookValuePerShare: { group: 'valuation', unit: 'CNY' },
  roe: { group: 'profitability', unit: '%' },
  netMargin: { group: 'profitability', unit: '%' },
  operatingMargin: { group: 'profitability', unit: '%' },
  revenueGrowth: { group: 'growth', unit: '%' },
  profitGrowth: { group: 'growth', unit: '%' },
  debtRatio: { group: 'balance', unit: '%' },
  currentRatio: { group: 'balance', unit: '' },
  cashConversion: { group: 'cash', unit: '' },
}

/**
 * Turn the newest reported A-share period into report metrics.
 * @param fundamentals - Normalized fundamentals series, when one loaded.
 * @returns Metrics for the newest reporting period, empty when none published.
 */
export function equityMetricsFromFundamentals(
  fundamentals: FinanceStockFundamentals | undefined,
): AssetMetric[] {
  const latest = fundamentals?.periods.at(-1)
  if (latest === undefined) return []
  return Object.entries(latest.metrics).flatMap(([key, value]) => {
    const entry = EQUITY_METRICS[key]
    if (entry === undefined) return []
    return [{
      group: entry.group,
      key,
      value,
      unit: entry.unit,
      asOf: latest.period,
      source: 'akshare',
    }]
  })
}
