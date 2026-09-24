import { describe, expect, it, vi } from 'vitest'
import { SubprocessFinanceStockDataProvider, type FinanceStockBridge } from '../src/stock.ts'

function bridge(run: (request: unknown) => Promise<unknown>): FinanceStockBridge {
  return { run: vi.fn(run) }
}

describe('stock fundamentals provider', () => {
  it('loads reported ratios for the first symbol', async () => {
    const run = async () => ({
      symbol: '600519',
      periods: [{ period: '2026-06-30', metrics: { roe: 17.72 } }],
    })
    const provider = new SubprocessFinanceStockDataProvider(bridge(run))
    await expect(provider.loadStockFundamentals({ provider: 'akshare', symbols: ['600519'] }))
      .resolves.toEqual([{ symbol: '600519', periods: [{ period: '2026-06-30', metrics: { roe: 17.72 } }] }])
  })

  it('normalizes the symbol and returns nothing for an empty request', async () => {
    const run = vi.fn(async () => ({ symbol: '600519', periods: [] }))
    const provider = new SubprocessFinanceStockDataProvider(bridge(run))
    await expect(provider.loadStockFundamentals({ provider: 'akshare', symbols: [] })).resolves.toEqual([])
    await expect(provider.loadStockFundamentals({ provider: 'akshare', symbols: ['SH600519'] })).resolves.toEqual([
      { symbol: '600519', periods: [] },
    ])
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      action: 'stock_fundamentals',
      symbol: '600519',
    }), undefined)
  })

  it('refuses a disabled provider', async () => {
    const provider = new SubprocessFinanceStockDataProvider(bridge(async () => ({})), {
      enabled: () => false,
    })
    await expect(provider.loadStockFundamentals({ provider: 'akshare', symbols: ['600519'] }))
      .rejects.toMatchObject({ code: 'STOCK_PROVIDER_DISABLED' })
  })
})

describe('stock valuation provider', () => {
  it('loads multiples and the industry baseline', async () => {
    const provider = new SubprocessFinanceStockDataProvider(bridge(async () => ({
      symbol: '600519',
      name: '贵州茅台酒股份有限公司',
      industry: '酒、饮料和精制茶制造业',
      market: '上交所',
      indicators: { peTtm: 19.23, pb: 6.23 },
      marketCapYuan: 1_565_815_000_000,
      industryPe: { date: '2026-09-21', weighted: 18.94, median: 24.09, arithmetic: 107.56, companies: 39 },
    })))
    await expect(provider.loadStockValuation({ provider: 'akshare', symbols: ['600519'] })).resolves.toEqual([{
      symbol: '600519',
      name: '贵州茅台酒股份有限公司',
      industry: '酒、饮料和精制茶制造业',
      market: '上交所',
      indicators: { peTtm: 19.23, pb: 6.23 },
      marketCapYuan: 1_565_815_000_000,
      industryPe: { date: '2026-09-21', weighted: 18.94, median: 24.09, companies: 39 },
    }])
    await expect(provider.loadStockValuation({ provider: 'akshare', symbols: [] })).resolves.toEqual([])
  })

  it('omits every optional valuation field the upstream did not publish', async () => {
    const bare = new SubprocessFinanceStockDataProvider(bridge(async () => ({ symbol: '600519', indicators: {} })))
    await expect(bare.loadStockValuation({ provider: 'akshare', symbols: ['600519'] }))
      .resolves.toEqual([{ symbol: '600519', indicators: {} }])

    const partial = new SubprocessFinanceStockDataProvider(bridge(async () => ({
      symbol: '600519', indicators: { pb: 6.23 }, name: '贵州茅台酒股份有限公司', industryPe: {},
    })))
    await expect(partial.loadStockValuation({ provider: 'akshare', symbols: ['600519'] }))
      .resolves.toEqual([{ symbol: '600519', indicators: { pb: 6.23 }, name: '贵州茅台酒股份有限公司', industryPe: {} }])
  })
})

describe('stock provider selection', () => {
  const history = (symbol: string) => ({
    symbol,
    name: '贵州茅台',
    bars: Array.from({ length: 60 }, (_, index) => ({
      timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      open: 10 + index, high: 11 + index, low: 9 + index, close: 10.5 + index, volume: 1_000 + index,
    })),
  })

  it('falls through to the next enabled provider on auto', async () => {
    const seen: string[] = []
    const provider = new SubprocessFinanceStockDataProvider(bridge(async (request) => {
      const { provider: upstream } = request as { provider: 'akshare' | 'ifind' }
      seen.push(upstream)
      if (upstream === 'akshare') throw new Error('akshare upstream down')
      return history('600519')
    }))
    const snapshot = await provider.loadStockSnapshot({ provider: 'auto', symbol: '600519' })
    expect(seen).toEqual(['akshare', 'ifind'])
    expect(snapshot.source.provider).toBe('ifind')
  })

  it('skips a disabled provider and reports when none can serve the symbol', async () => {
    const seen: string[] = []
    const onlyIfind = new SubprocessFinanceStockDataProvider(bridge(async (request) => {
      seen.push((request as { provider: string }).provider)
      return history('600519')
    }), { enabled: provider => provider === 'ifind' })
    await expect(onlyIfind.loadStockSnapshot({ provider: 'auto', symbol: '600519' }))
      .resolves.toMatchObject({ source: { provider: 'ifind' } })
    expect(seen).toEqual(['ifind'])

    const noneEnabled = new SubprocessFinanceStockDataProvider(bridge(async () => history('600519')), { enabled: () => false })
    await expect(noneEnabled.loadStockSnapshot({ provider: 'auto', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'STOCK_PROVIDER_DISABLED' })

    const allFail = new SubprocessFinanceStockDataProvider(bridge(async () => { throw new Error('bridge down') }))
    await expect(allFail.loadStockSnapshot({ provider: 'auto', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'STOCK_PROVIDER_FAILED' })

    const silent = new SubprocessFinanceStockDataProvider(bridge(async () => history('600519')))
    const controller = new AbortController()
    controller.abort()
    await expect(new SubprocessFinanceStockDataProvider(bridge(async () => {
      controller.abort()
      throw new Error('aborted mid-flight')
    })).loadStockSnapshot({ provider: 'auto', symbol: '600519' }, controller.signal))
      .rejects.toMatchObject({ code: 'ABORTED' })
    expect(silent).toBeDefined()
  })

  it('falls through for quotes as well and reports a total failure', async () => {
    const quote = { symbol: '600519', currency: 'CNY' as const, asOf: '2026-09-21T00:00:00.000Z', source: 'ifind' as const, price: 1 }
    const provider = new SubprocessFinanceStockDataProvider(bridge(async (request) => {
      if ((request as { provider: string }).provider === 'akshare') throw new Error('down')
      return { quotes: [quote] }
    }))
    await expect(provider.loadStockQuotes({ provider: 'auto', symbols: ['600519'] }))
      .resolves.toMatchObject([{ symbol: '600519', price: 1 }])

    const failing = new SubprocessFinanceStockDataProvider(bridge(async () => { throw new Error('down') }))
    await expect(failing.loadStockQuotes({ provider: 'auto', symbols: ['600519'] }))
      .rejects.toMatchObject({ code: 'STOCK_PROVIDER_FAILED' })

    const stringFailure = new SubprocessFinanceStockDataProvider(bridge(async () => { throw 'quote bridge exploded' }))
    await expect(stringFailure.loadStockQuotes({ provider: 'auto', symbols: ['600519'] }))
      .rejects.toThrow(/akshare: quote bridge exploded; ifind: quote bridge exploded/)
  })

  it('keeps a single attempt error, stringifies non-errors, and honours aborts', async () => {
    const single = new SubprocessFinanceStockDataProvider(bridge(async () => { throw new Error('only source down') }))
    await expect(single.loadStockSnapshot({ provider: 'akshare', symbol: '600519' }))
      .rejects.toThrow('only source down')

    const nonError = new SubprocessFinanceStockDataProvider(bridge(async () => { throw 'bridge exploded' }))
    await expect(nonError.loadStockSnapshot({ provider: 'auto', symbol: '600519' }))
      .rejects.toThrow(/akshare: bridge exploded; ifind: bridge exploded/)

    const controller = new AbortController()
    const aborting = new SubprocessFinanceStockDataProvider(bridge(async () => {
      controller.abort()
      throw new Error('aborted mid-flight')
    }))
    await expect(aborting.loadStockQuotes({ provider: 'auto', symbols: ['600519'] }, controller.signal))
      .rejects.toMatchObject({ code: 'ABORTED' })

    const quoteFailure = new SubprocessFinanceStockDataProvider(bridge(async () => { throw new Error('quote source down') }))
    await expect(quoteFailure.loadStockQuotes({ provider: 'ifind', symbols: ['600519'] }))
      .rejects.toThrow('quote source down')
  })

  it('records the explicit iFinD provider for fundamentals and valuation', async () => {
    const seen: string[] = []
    const provider = new SubprocessFinanceStockDataProvider(bridge(async (request) => {
      const call = request as { provider: string; action: string }
      seen.push(call.provider)
      return call.action === 'stock_valuation'
        ? { symbol: '600519', indicators: {} }
        : { symbol: '600519', periods: [] }
    }), { enabled: () => true })
    await provider.loadStockFundamentals({ provider: 'ifind', symbols: ['600519'] })
    await provider.loadStockValuation({ provider: 'ifind', symbols: ['600519'] })
    expect(seen).toEqual(['ifind', 'ifind'])
  })

  it('falls back to iFinD for the ratio table and sends its configured transport', async () => {
    const requests: { provider: string; transport?: string }[] = []
    const provider = new SubprocessFinanceStockDataProvider(bridge(async (request) => {
      const call = request as { provider: 'akshare' | 'ifind'; transport?: string }
      requests.push({ provider: call.provider, ...call.transport === undefined ? {} : { transport: call.transport } })
      // AKShare is down; the iFinD ratio table still answers.
      if (call.provider === 'akshare') throw new Error('akshare fundamentals down')
      return { symbol: '600519', periods: [{ period: '2026-06-30', metrics: { roe: 36.81 } }] }
    }), { ifindTransport: () => 'http' })
    await expect(provider.loadStockFundamentals({ provider: 'auto', symbols: ['600519'] }))
      .resolves.toEqual([{ symbol: '600519', periods: [{ period: '2026-06-30', metrics: { roe: 36.81 } }] }])
    expect(requests).toEqual([{ provider: 'akshare' }, { provider: 'ifind', transport: 'http' }])
  })

  it('resolves auto to the only provider that publishes fundamentals', async () => {
    const seen: string[] = []
    const provider = new SubprocessFinanceStockDataProvider(bridge(async (request) => {
      const call = request as { provider: string; action: string }
      seen.push(call.provider)
      return call.action === 'stock_valuation'
        ? { symbol: '600519', indicators: { peTtm: 19.23 } }
        : { symbol: '600519', periods: [{ period: '2026-06-30', metrics: { roe: 17.72 } }] }
    }))
    await expect(provider.loadStockFundamentals({ provider: 'auto', symbols: ['600519'] })).resolves.toHaveLength(1)
    await expect(provider.loadStockValuation({ provider: 'auto', symbols: ['600519'] })).resolves.toHaveLength(1)
    expect(seen).toEqual(['akshare', 'akshare'])
  })
})
