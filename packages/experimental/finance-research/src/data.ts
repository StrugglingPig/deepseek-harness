/** Deterministic fixture market data for the experimental finance research slice. */

import type {
  FinanceAssetClass,
  FinanceMarketDataProvider,
  MarketBar,
  MarketSnapshot,
} from './types.ts'

const BAR_COUNT = 80
const FIRST_BAR_MS = Date.UTC(2026, 5, 1)
const DAY_MS = 86_400_000
const FIXTURE_RETRIEVED_AT = '2026-09-20T00:00:00.000Z'

interface InstrumentParameters {
  readonly startPrice: number
  readonly dailyReturn: number
  readonly volatility: number
  readonly currency: string
  readonly name: string
}

/**
 * Classify one symbol into the fixture's supported research surface.
 * @param symbol - Symbol to classify; prediction symbols use the `PREDICTION:` prefix.
 * @returns The asset class used by the fixture provider.
 */
export function classifyAsset(symbol: string): FinanceAssetClass {
  if (symbol.startsWith('PREDICTION:')) return 'prediction'
  if (symbol === 'BTC' || symbol === 'ETH') return 'crypto'
  return 'equity'
}

function instrumentParameters(symbol: string, assetClass: FinanceAssetClass): InstrumentParameters {
  if (assetClass === 'prediction') {
    return {
      startPrice: 0.62,
      dailyReturn: 0,
      volatility: 0.018,
      currency: 'PROB',
      name: symbol.slice('PREDICTION:'.length),
    }
  }
  if (assetClass === 'crypto') {
    return {
      startPrice: symbol === 'BTC' ? 67_000 : 3_500,
      dailyReturn: 0.0015,
      volatility: 0.035,
      currency: 'USD',
      name: symbol === 'BTC' ? 'Bitcoin' : 'Ether',
    }
  }
  return {
    startPrice: symbol === 'AAPL' ? 228 : 100,
    dailyReturn: 0.0008,
    volatility: 0.018,
    currency: 'USD',
    name: symbol === 'AAPL' ? 'Apple Inc.' : symbol,
  }
}

function seedFor(value: string): number {
  let seed = 2_166_136_261
  for (const character of value) {
    seed ^= character.codePointAt(0) as number
    seed = Math.imul(seed, 16_777_619)
  }
  return seed >>> 0
}

function nextSeed(seed: number): number {
  return (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
}

function unit(seed: number): number {
  return seed / 0xffff_ffff
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value: number, assetClass: FinanceAssetClass): number {
  return Number(value.toFixed(assetClass === 'prediction' ? 4 : 2))
}

function createBars(
  symbol: string,
  assetClass: FinanceAssetClass,
  parameters: InstrumentParameters,
): MarketBar[] {
  let seed = seedFor(symbol)
  let previousClose = parameters.startPrice
  const bars: MarketBar[] = []
  for (let index = 0; index < BAR_COUNT; index += 1) {
    seed = nextSeed(seed)
    const noise = unit(seed) - 0.5
    const open = previousClose
    const proposedClose = open * (1 + parameters.dailyReturn + noise * parameters.volatility)
    const close = assetClass === 'prediction' ? clamp(proposedClose, 0.01, 0.99) : proposedClose
    const high = Math.max(open, close) * (1 + ((seed >>> 8) % 200) / 100_000)
    const low = Math.min(open, close) * (1 - ((seed >>> 16) % 200) / 100_000)
    bars.push({
      timestamp: new Date(FIRST_BAR_MS + index * DAY_MS).toISOString(),
      open: round(open, assetClass),
      high: round(high, assetClass),
      low: round(low, assetClass),
      close: round(close, assetClass),
      volume: 1_000_000 + (seed % 500_000),
    })
    previousClose = close
  }
  return bars
}

/**
 * Build one deterministic snapshot from the symbol alone.
 * @param input - Ticker, coin, or `PREDICTION:<market>` symbol.
 * @returns The normalized fixture snapshot.
 */
export function loadFixtureSnapshot(input: string): MarketSnapshot {
  const symbol = input.trim().toUpperCase()
  if (symbol.length === 0) throw new Error('symbol must be a non-empty string')
  const assetClass = classifyAsset(symbol)
  const parameters = instrumentParameters(symbol, assetClass)
  const bars = createBars(symbol, assetClass, parameters)
  const latest = bars.at(-1) as MarketBar
  const previous = bars.at(-2) as MarketBar
  const price = latest.close
  const changePercent = ((price - previous.close) / previous.close) * 100
  const prediction = assetClass === 'prediction'
    ? {
      impliedProbability: price,
      bid: round(clamp(price - 0.01, 0.01, 0.99), assetClass),
      ask: round(clamp(price + 0.01, 0.01, 0.99), assetClass),
      volume: latest.volume,
      openInterest: 250_000 + (seedFor(symbol) % 500_000),
      resolution: '2026-12-31T23:59:59.000Z',
      rules: `Resolution rules for fixture market ${symbol.slice('PREDICTION:'.length)}.`,
    }
    : undefined
  return {
    instrument: {
      symbol,
      name: parameters.name,
      assetClass,
      currency: parameters.currency,
    },
    asOf: latest.timestamp,
    source: {
      provider: 'fixture',
      retrievedAt: FIXTURE_RETRIEVED_AT,
      synthetic: true,
    },
    quote: {
      price,
      changePercent: round(changePercent, assetClass),
    },
    bars,
    ...prediction === undefined ? {} : { prediction },
  }
}

/** Provider implementation backed by deterministic fixture bars. */
export class FixtureFinanceMarketDataProvider implements FinanceMarketDataProvider {
  readonly id = 'fixture'

  load(symbol: string): Promise<MarketSnapshot> {
    return Promise.resolve(loadFixtureSnapshot(symbol))
  }
}

/** Shared fixture instance used by the default plugin application. */
export const fixtureProvider = new FixtureFinanceMarketDataProvider()
