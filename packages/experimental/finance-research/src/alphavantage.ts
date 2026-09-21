/** Alpha Vantage response normalization. */

import type { FinanceUsFundamentals } from './types.ts'

/** Response fields that name a top-level figure, with its normalized metric key. */
const OVERVIEW_FIELDS: Readonly<Record<string, string>> = {
  MarketCapitalization: 'marketCap',
  PERatio: 'peRatio',
  PEGRatio: 'pegRatio',
  PriceToBookRatio: 'pbRatio',
  PriceToSalesRatioTTM: 'psRatio',
  EVToEBITDA: 'evToEbitda',
  DividendYield: 'dividendYield',
  EPS: 'eps',
  DilutedEPSTTM: 'epsTtm',
  ProfitMargin: 'netMargin',
  OperatingMarginTTM: 'operatingMargin',
  ReturnOnAssetsTTM: 'roa',
  ReturnOnEquityTTM: 'roe',
  RevenueGrowthYOY: 'revenueGrowth',
  QuarterlyRevenueGrowthYOY: 'revenueGrowthQoq',
  QuarterlyEarningsGrowthYOY: 'earningsGrowthQoq',
  Beta: 'beta',
  AnalystTargetPrice: 'analystTargetPrice',
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function finite(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '' || value === 'None') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Normalize one Alpha Vantage company overview.
 * @param payload - Upstream JSON.
 * @param symbol - Symbol the overview was requested for.
 * @returns The snapshot, or undefined for a rate-limit or unknown-symbol notice.
 */
export function normalizeUsFundamentals(payload: unknown, symbol: string): FinanceUsFundamentals | undefined {
  const overview = record(payload)
  if (overview === undefined) return undefined
  const name = text(overview.Name)
  if (name === undefined) return undefined
  const sector = text(overview.Sector)
  const industry = text(overview.Industry)
  const exchange = text(overview.Exchange)
  const indicators: Record<string, number> = {}
  for (const [field, key] of Object.entries(OVERVIEW_FIELDS)) {
    const value = finite(overview[field])
    if (value !== undefined) indicators[key] = value
  }
  return {
    symbol: text(overview.Symbol) ?? symbol,
    name,
    ...sector === undefined ? {} : { sector },
    ...industry === undefined ? {} : { industry },
    ...exchange === undefined ? {} : { exchange },
    indicators,
  }
}
