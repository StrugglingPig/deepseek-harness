/** Finnhub REST response normalization. */

import type { FinanceUsFundamentals } from './types.ts'

/** Finnhub metric fields this package quotes, with the normalized key and unit. */
const FINNHUB_METRICS: readonly (readonly [string, string])[] = [
  ['peTTM', 'peRatio'],
  ['pbAnnual', 'pbRatio'],
  ['psTTM', 'psRatio'],
  ['dividendYieldIndicatedAnnual', 'dividendYield'],
  ['roeTTM', 'roe'],
  ['roaTTM', 'roa'],
  ['netProfitMarginTTM', 'netMargin'],
  ['operatingMarginTTM', 'operatingMargin'],
  ['revenueGrowthTTMYoy', 'revenueGrowth'],
  ['epsGrowthTTMYoy', 'epsGrowth'],
  ['epsTTM', 'epsTtm'],
  ['beta', 'beta'],
]

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function finite(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Normalize the Finnhub profile, metrics, and peers answers for one ticker.
 * @param profile - `/stock/profile2` payload, or undefined when that call failed.
 * @param metric - `/stock/metric` payload, or undefined when that call failed.
 * @param peers - `/stock/peers` payload, or undefined when that call failed.
 * @param symbol - Ticker the answers belong to.
 * @returns The snapshot, or undefined when none of the calls published a company.
 */
export function normalizeFinnhubFundamentals(
  profile: unknown,
  metric: unknown,
  peers: unknown,
  symbol: string,
): FinanceUsFundamentals | undefined {
  const profileBody = record(profile)
  const name = text(profileBody?.name)
  const industry = text(profileBody?.finnhubIndustry)
  const exchange = text(profileBody?.exchange)
  const metrics = record(record(metric)?.metric)
  const indicators: Record<string, number> = {}
  for (const [field, key] of FINNHUB_METRICS) {
    const value = finite(metrics?.[field])
    if (value !== undefined) indicators[key] = value
  }
  // Profile market capitalisation is published in millions.
  const marketCapMillions = finite(profileBody?.marketCapitalization)
  if (marketCapMillions !== undefined) indicators.marketCap = marketCapMillions * 1_000_000
  const peerList = Array.isArray(peers)
    ? peers.flatMap(entry => text(entry) === undefined ? [] : [text(entry) as string])
    : undefined
  if (name === undefined && Object.keys(indicators).length === 0) return undefined
  return {
    symbol: text(profileBody?.ticker) ?? symbol,
    ...name === undefined ? {} : { name },
    ...industry === undefined ? {} : { industry },
    ...exchange === undefined ? {} : { exchange },
    ...peerList === undefined || peerList.length === 0 ? {} : { peers: peerList },
    indicators,
  }
}
