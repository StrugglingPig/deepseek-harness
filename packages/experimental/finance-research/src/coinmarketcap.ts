/** CoinMarketCap REST response normalization. */

import type {
  FinanceCoinMarketCapOhlcvSeries,
  FinanceCoinMarketCapQuote,
  MarketBar,
} from './types.ts'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function records(value: unknown): Record<string, unknown>[] {
  const values = Array.isArray(value) ? value : Object.values(record(value) ?? {})
  const found: Record<string, unknown>[] = []
  for (const item of values) {
    const itemRecord = record(item)
    if (itemRecord !== undefined) found.push(itemRecord)
  }
  return found
}

function finite(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function quoteMap(value: unknown, convert: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) return record(value.find(item => record(item)?.symbol === convert)) ?? record(value[0])
  const object = record(value)
  return object === undefined ? undefined : record(object[convert]) ?? record(Object.values(object)[0])
}

/**
 * Normalize a v3 cryptocurrency quotes response.
 * @param payload - Upstream CoinMarketCap JSON.
 * @param convert - Conversion currency.
 * @returns Normalized quote records.
 */
export function normalizeCoinMarketCapQuotes(payload: unknown, convert: string): FinanceCoinMarketCapQuote[] {
  const data = record(payload)?.data
  return records(data).flatMap((item) => {
    const id = finite(item.id)
    const name = string(item.name)
    const symbol = string(item.symbol)
    if (id === undefined || name === undefined || symbol === undefined) return []
    const quote = quoteMap(item.quote, convert)
    const slug = string(item.slug)
    const rank = finite(item.cmc_rank)
    const price = finite(quote?.price)
    const percentChange1h = finite(quote?.percent_change_1h)
    const percentChange24h = finite(quote?.percent_change_24h)
    const percentChange7d = finite(quote?.percent_change_7d)
    const percentChange30d = finite(quote?.percent_change_30d)
    const percentChange90d = finite(quote?.percent_change_90d)
    const marketCap = finite(quote?.market_cap)
    const fullyDilutedMarketCap = finite(quote?.fully_diluted_market_cap)
    const marketCapDominance = finite(quote?.market_cap_dominance)
    const volume24h = finite(quote?.volume_24h)
    const volumeChange24h = finite(quote?.volume_change_24h)
    const circulatingSupply = finite(item.circulating_supply)
    const totalSupply = finite(item.total_supply)
    const maxSupply = finite(item.max_supply)
    const lastUpdated = string(quote?.last_updated) ?? string(item.last_updated)
    return [{
      id,
      name,
      symbol,
      ...slug === undefined ? {} : { slug },
      ...rank === undefined ? {} : { rank },
      currency: convert,
      ...price === undefined ? {} : { price },
      ...percentChange1h === undefined ? {} : { percentChange1h },
      ...percentChange24h === undefined ? {} : { percentChange24h },
      ...percentChange7d === undefined ? {} : { percentChange7d },
      ...percentChange30d === undefined ? {} : { percentChange30d },
      ...percentChange90d === undefined ? {} : { percentChange90d },
      ...marketCap === undefined ? {} : { marketCap },
      ...fullyDilutedMarketCap === undefined ? {} : { fullyDilutedMarketCap },
      ...marketCapDominance === undefined ? {} : { marketCapDominance },
      ...volume24h === undefined ? {} : { volume24h },
      ...volumeChange24h === undefined ? {} : { volumeChange24h },
      ...circulatingSupply === undefined ? {} : { circulatingSupply },
      ...totalSupply === undefined ? {} : { totalSupply },
      ...maxSupply === undefined ? {} : { maxSupply },
      ...lastUpdated === undefined ? {} : { lastUpdated },
    }]
  })
}

/**
 * Normalize a v2 cryptocurrency OHLCV historical response.
 * @param payload - Upstream CoinMarketCap JSON.
 * @param convert - Conversion currency.
 * @returns Normalized OHLCV series.
 */
export function normalizeCoinMarketCapOhlcv(payload: unknown, convert: string): FinanceCoinMarketCapOhlcvSeries[] {
  const data = record(payload)?.data
  const dataObject = record(data)
  const seriesRecords = dataObject !== undefined && ('quotes' in dataObject || 'symbol' in dataObject)
    ? [dataObject]
    : records(data)
  return seriesRecords.flatMap((item) => {
    const id = finite(item.id)
    const name = string(item.name)
    const symbol = string(item.symbol)
    if (id === undefined || name === undefined || symbol === undefined || !Array.isArray(item.quotes)) return []
    const bars = item.quotes.flatMap((entry): MarketBar[] => {
      const point = record(entry)
      const timestamp = string(point?.time_open)
      const quote = quoteMap(point?.quote, convert)
      const open = finite(quote?.open)
      const high = finite(quote?.high)
      const low = finite(quote?.low)
      const close = finite(quote?.close)
      const volume = finite(quote?.volume)
      if (timestamp === undefined || !Number.isFinite(Date.parse(timestamp))
        || open === undefined || high === undefined || low === undefined || close === undefined || volume === undefined) return []
      return [{ timestamp, open, high, low, close, volume }]
    })
    return [{ id, name, symbol, currency: convert, bars }]
  })
}
