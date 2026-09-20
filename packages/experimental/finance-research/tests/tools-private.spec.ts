import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { registerFinanceTools } from '../src/index.ts'
import type { FinanceMarketDataProvider } from '../src/types.ts'

function textOf(result: Awaited<ReturnType<Context['tools']['execute']>>): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('')
}

describe('finance_private_account tool', () => {
  it('returns normalized private balances with a compact model summary', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const provider: FinanceMarketDataProvider = {
      id: 'fake-private',
      async load() { throw new Error('not used') },
      async loadPrivateAccount(request) {
        return {
          scope: request.scope,
          accountType: 'SPOT',
          canTrade: true,
          retrievedAt: '2026-09-20T10:00:00.000Z',
          balances: [{ asset: 'BTC', free: 0.5, locked: 0.1, total: 0.6 }],
          positions: [],
        }
      },
    }
    registerFinanceTools(ctx, provider)

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'private-account' as never,
      name: 'finance_private_account',
      arguments: { scope: 'spot' },
    })

    expect(result.isError).toBe(false)
    expect(textOf(result)).toContain('spot: SPOT, 1 non-zero balance, 0 positions')
  })

  it('maps futures totals, positions, and optional order timestamps', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    registerFinanceTools(ctx, {
      id: 'fake-private',
      async load() { throw new Error('not used') },
      async loadPrivateAccount() {
        return {
          scope: 'usdm',
          accountType: 'USD_M_FUTURES',
          canTrade: true,
          canWithdraw: false,
          retrievedAt: '2026-09-20T10:00:00.000Z',
          totalWalletBalance: 1_000,
          totalUnrealizedProfit: 25,
          balances: [],
          positions: [{
            symbol: 'BTCUSDT', side: 'long', quantity: 0.5, entryPrice: 60_000,
            markPrice: 61_000, unrealizedPnl: 25, leverage: 3,
          }],
          openOrders: [
            {
              orderId: '1', symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: 60_000,
              quantity: 0.1, executedQuantity: 0, status: 'NEW', time: '2026-09-20T09:00:00.000Z',
            },
            {
              orderId: '2', symbol: 'ETHUSDT', side: 'SELL', type: 'LIMIT', price: 3_000,
              quantity: 1, executedQuantity: 0, status: 'NEW',
            },
          ],
        }
      },
    })

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'private-full' as never,
      name: 'finance_private_account',
      arguments: { scope: 'usdm', symbol: 'btcusdt', include_open_orders: true },
    })

    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({
      can_withdraw: false,
      total_wallet_balance: 1_000,
      total_unrealized_profit: 25,
      positions: [{ side: 'long', unrealized_pnl: 25 }],
      open_orders: [{ order_id: '1', time: '2026-09-20T09:00:00.000Z' }, { order_id: '2' }],
    })
    expect(textOf(result)).toContain('2 open orders')
  })
})
