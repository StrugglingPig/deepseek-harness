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
