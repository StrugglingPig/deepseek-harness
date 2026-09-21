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
      industryPe: { date: '2026-09-21', weighted: 18.94, median: 24.09, companies: 39 },
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
