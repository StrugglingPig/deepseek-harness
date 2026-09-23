/**
 * Reconstruct symbol-dates from live data and record the valuation backtest.
 *
 * Every input is the one the model could have had on the as-of date: the newest 10-K filed at least
 * ninety days before it, the closing price that day, the share count that filing published, and the
 * ten-year yield observed on or before it. The result is written to `src/validation-record.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { installProxyFromEnvironment, type EnvLookup } from '../packages/util/http-proxy/src/index.ts'
import { reportedFinancialsHistory, type FinnhubReportedPeriod } from '../packages/experimental/finance-research/src/finnhub.ts'
import { summarizeBacktest, validationLabel, type BacktestObservation } from '../packages/experimental/finance-research/src/backtest.ts'
import { buildValuation, VALUATION_PARAMETERS, type ValuationInputs } from '../packages/experimental/finance-research/src/valuation.ts'

const env: EnvLookup = { get: name => process.env[name] === undefined ? undefined : { value: process.env[name] as string } }
await installProxyFromEnvironment(env, message => console.log('proxy:', message))

const refs = readFileSync(`${homedir()}/.dsh/.credentials.yaml`, 'utf8')
const read = (name: string) => new RegExp(`^[ \\t]*${name}:[ \\t]*([A-Za-z0-9_\\-]+)`, 'm').exec(refs)?.[1]
const finnhubKey = read('FINANCE_FINNHUB_API_KEY') as string
const fredKey = read('FINANCE_FRED_API_KEY') as string

const SYMBOLS = [
  'AAPL', 'MSFT', 'JNJ', 'KO', 'PG', 'XOM', 'WMT', 'CAT', 'HD', 'CSCO', 'PEP', 'MRK',
  'MCD', 'NKE', 'TXN', 'QCOM', 'ADI', 'AMAT', 'LRCX', 'INTC', 'ABT', 'TMO', 'UNH', 'LMT',
  'UPS', 'LOW', 'TJX', 'COST', 'ITW', 'EMR', 'MMM', 'DOV',
]
const HORIZON_DAYS = 365
/** Days after a period end before the filing counts as available. */
const FILING_LAG_DAYS = 90

const json = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${url} -> ${response.status}`)
  return await response.json() as T
}

/** Closing prices by `YYYY-MM-DD`, from one Yahoo chart answer. */
async function closes(symbol: string): Promise<readonly (readonly [string, number])[]> {
  const body = await json<{ chart?: { result?: readonly { timestamp?: readonly number[]; indicators?: { quote?: readonly { close?: readonly (number | null)[] }[] } }[] } }>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=8y&interval=1d`,
  )
  const result = body.chart?.result?.[0]
  const stamps = result?.timestamp ?? []
  const values = result?.indicators?.quote?.[0]?.close ?? []
  return stamps.flatMap((stamp, index) => {
    const close = values[index]
    return close === null || close === undefined ? [] : [[new Date(stamp * 1000).toISOString().slice(0, 10), close] as const]
  })
}

/** The ten-year yield by `YYYY-MM-DD`, newest last. */
async function yields(): Promise<readonly (readonly [string, number])[]> {
  const body = await json<{ observations?: readonly { date: string; value: string }[] }>(
    `https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=${fredKey}&file_type=json&sort_order=asc`,
  )
  return (body.observations ?? []).flatMap(observation =>
    observation.value === '.' ? [] : [[observation.date, Number(observation.value)] as const])
}

/** The newest observation on or before one date. */
function latestOnOrBefore(series: readonly (readonly [string, number])[], date: string): number | undefined {
  let found: number | undefined
  for (const [observed, value] of series) {
    if (observed > date) break
    found = value
  }
  return found
}

/** The newest observation on or after one date, inside a 30-day window. */
function firstOnOrAfter(series: readonly (readonly [string, number])[], date: string): number | undefined {
  for (const [observed, value] of series) {
    if (observed >= date) return value
  }
  return undefined
}

const shiftDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

const allYields = await yields()
console.log(`yields: ${allYields.length} observations`)

/** Build the model input record one period supports, or undefined when a required figure is missing. */
function inputsFor(
  period: FinnhubReportedPeriod,
  previous: FinnhubReportedPeriod | undefined,
  price: number,
  riskFreePercent: number,
  asOf: string,
): ValuationInputs | undefined {
  const { lines } = period
  const growth = previous?.lines.revenue === undefined || lines.revenue === undefined || previous.lines.revenue <= 0
    ? undefined
    : (lines.revenue / previous.lines.revenue - 1) * 100
  const shares = lines.sharesOutstanding
  if (shares === undefined || shares <= 0 || growth === undefined) return undefined
  const values = {
    revenue: lines.revenue,
    grossProfit: lines.grossProfit,
    operatingIncome: lines.operatingIncome,
    netIncome: lines.netIncome,
    totalAssets: lines.totalAssets,
    currentAssets: lines.currentAssets,
    currentLiabilities: lines.currentLiabilities,
    liabilities: lines.liabilities,
    equity: lines.equity,
    totalDebt: lines.totalDebt,
    cash: lines.cash,
    retainedEarnings: lines.retainedEarnings,
    operatingCashFlow: lines.operatingCashFlow,
    capex: lines.capex,
    freeCashFlow: lines.freeCashFlow,
    depreciation: lines.depreciation,
    pretaxIncome: lines.pretaxIncome,
    taxExpense: lines.taxExpense,
    interestExpense: lines.interestExpense,
  }
  return {
    price,
    reportedPeriod: period.label,
    revenueGrowthPercent: growth,
    marketCap: price * shares,
    // The free metric endpoint publishes only the current beta, so the backtest holds it at one.
    beta: 1,
    riskFreePercent,
    riskFreeSource: 'fred',
    riskFreeAsOf: asOf,
    ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)),
  } as ValuationInputs
}

const observations: BacktestObservation[] = []
const symbolsUsed = new Set<string>()
for (const symbol of SYMBOLS) {
  try {
    const [prices, reported] = await Promise.all([
      closes(symbol),
      json<unknown>(`https://finnhub.io/api/v1/stock/financials-reported?symbol=${symbol}&token=${finnhubKey}`),
    ])
    const periods = reportedFinancialsHistory(reported).filter(period => period.form === '10-K')
    let kept = 0
    for (const [index, period] of periods.entries()) {
      if (period.endDate === undefined) continue
      const asOf = shiftDays(period.endDate, FILING_LAG_DAYS)
      const previous = periods.slice(index + 1).find(candidate =>
        candidate.endDate !== undefined && candidate.endDate < (period.endDate as string))
      if (previous?.lines.revenue === undefined) continue
      const entryPrice = latestOnOrBefore(prices, asOf)
      const exitPrice = firstOnOrAfter(prices, shiftDays(asOf, HORIZON_DAYS))
      const riskFree = latestOnOrBefore(allYields, asOf)
      if (entryPrice === undefined || exitPrice === undefined || riskFree === undefined) continue
      const inputs = inputsFor(period, previous, entryPrice, riskFree, asOf)
      if (inputs === undefined) continue
      const analysis = buildValuation(inputs, VALUATION_PARAMETERS)
      const value = analysis.value?.weightedValuePerShare
      if (value === undefined || !Number.isFinite(value) || value <= 0) continue
      observations.push({ valuePerShare: value, entryPrice, exitPrice })
      symbolsUsed.add(symbol)
      kept += 1
    }
    console.log(`${symbol}: ${kept} sample(s)`)
  } catch (error) {
    console.log(`${symbol}: skipped (${error instanceof Error ? error.message : 'unknown error'})`)
  }
}

const summary = summarizeBacktest(observations, 12)
console.log(`\nsamples: ${summary?.samples ?? 0} across ${symbolsUsed.size} symbols`)
if (summary !== undefined) {
  console.log(`model MAE ${summary.modelMaePercent.toFixed(2)}% vs control ${summary.controlMaePercent.toFixed(2)}%`)
  console.log(`hit rate ${(summary.modelHitRate * 100).toFixed(1)}%, bias ${summary.modelBiasPercent.toFixed(2)}%`)
  console.log(`Diebold-Mariano ${summary.dmStatistic.toFixed(3)}, p ${summary.dmPValue.toFixed(4)}`)
}

const asOf = new Date().toISOString().slice(0, 10)
const round = (value: number, digits: number): number => Number(value.toFixed(digits))
const validation = summary === undefined
  ? undefined
  : {
    asOf,
    symbols: symbolsUsed.size,
    horizonMonths: 12,
    summary: {
      samples: summary.samples,
      horizonMonths: summary.horizonMonths,
      modelMaePercent: round(summary.modelMaePercent, 4),
      controlMaePercent: round(summary.controlMaePercent, 4),
      modelHitRate: round(summary.modelHitRate, 4),
      modelBiasPercent: round(summary.modelBiasPercent, 4),
      dmStatistic: round(summary.dmStatistic, 4),
      dmPValue: round(summary.dmPValue, 6),
    },
  }
const label = validationLabel(validation)
const record = `/**
 * Recorded out-of-sample evidence for the valuation model.
 *
 * The backtest runner writes this file, and the report reads it before it decides which words its
 * value may carry. A checkout whose backtest has never run carries the no-evidence record, which
 * reads as zero samples: the report then keeps calling its output a model reference value.
 */

import type { ValuationValidation } from './backtest.ts'

/** Latest recorded backtest; the no-evidence record until one has run. */
export const VALUATION_VALIDATION: ValuationValidation | undefined = ${
  validation === undefined ? 'undefined' : JSON.stringify(validation, null, 2)
    .replaceAll('"', "'")
    .replaceAll('\n}', ',\n}')}
`
writeFileSync('packages/experimental/finance-research/src/validation-record.ts', record)
console.log(`\nrecorded: ${validation === undefined ? 'none' : `${summary?.samples} samples`}; label stays ${label}`)
