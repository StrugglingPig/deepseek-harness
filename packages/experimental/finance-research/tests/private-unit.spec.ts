import { describe, expect, it } from 'vitest'
import { isFuturesScope, normalizeFuturesAccount, normalizeSpotAccount } from '../src/private.ts'

const NOW = new Date('2026-09-20T10:00:00.000Z')

describe('private account normalization', () => {
  it('omits optional Spot fields and empty order collections', () => {
    const account = normalizeSpotAccount({
      balances: [{ asset: 'BTC', free: '0.1', locked: '0' }],
    }, undefined, NOW)
    expect(account).toEqual({
      scope: 'spot',
      accountType: 'SPOT',
      canTrade: false,
      retrievedAt: NOW.toISOString(),
      balances: [{ asset: 'BTC', free: 0.1, locked: 0, total: 0.1 }],
      positions: [],
    })
  })

  it('normalizes every futures position side and COIN-M account variant', () => {
    const account = normalizeFuturesAccount('coinm', {
      totalWalletBalance: '5',
      totalUnrealizedProfit: '-1',
      assets: [
        { asset: 'BTC', walletBalance: '5', availableBalance: '4' },
        { asset: 'ETH', walletBalance: '0', availableBalance: '0' },
      ],
    }, [
      { symbol: 'BTCUSD_PERP', positionAmt: '1', entryPrice: '1', markPrice: '2', unRealizedProfit: '1', leverage: '1', positionSide: 'LONG' },
      { symbol: 'ETHUSD_PERP', positionAmt: '-2', entryPrice: '2', markPrice: '1', unRealizedProfit: '2', leverage: '2', positionSide: 'SHORT' },
      { symbol: 'BCHUSD_PERP', positionAmt: '-3', entryPrice: '3', markPrice: '3', unRealizedProfit: '0', leverage: '3', positionSide: 'BOTH' },
      { symbol: 'XRPUSD_PERP', positionAmt: '4', entryPrice: '4', markPrice: '4', unRealizedProfit: '0', leverage: '4', positionSide: 'BOTH' },
      { symbol: 'ZEROUSD_PERP', positionAmt: '0', entryPrice: '0', markPrice: '0', unRealizedProfit: '0', leverage: '1', positionSide: 'BOTH' },
    ], [
      { orderId: 1, symbol: 'BTCUSD_PERP', side: 'BUY', type: 'LIMIT', price: '1', origQty: '1', executedQty: '0', status: 'NEW' },
    ], NOW)

    expect(account).toMatchObject({
      scope: 'coinm',
      accountType: 'COIN_M_FUTURES',
      balances: [{ asset: 'BTC', free: 4, locked: 1, total: 5 }],
      openOrders: [{ orderId: '1' }],
      positions: [
        { symbol: 'BTCUSD_PERP', side: 'long', quantity: 1 },
        { symbol: 'ETHUSD_PERP', side: 'short', quantity: 2 },
        { symbol: 'BCHUSD_PERP', side: 'short', quantity: 3 },
        { symbol: 'XRPUSD_PERP', side: 'long', quantity: 4 },
      ],
    })
  })

  it('classifies futures scopes only', () => {
    expect(isFuturesScope('usdm')).toBe(true)
    expect(isFuturesScope('coinm')).toBe(true)
    expect(isFuturesScope('spot')).toBe(false)
  })
})
