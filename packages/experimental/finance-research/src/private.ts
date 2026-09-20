/** Binance private account payload validation and normalized read models. */

import { z as zod } from 'zod'
import type {
  FinanceJsonValue,
  FinancePrivateAccountRequest,
  FinancePrivateAccountSnapshot,
  FinancePrivateBalance,
  FinancePrivateOpenOrder,
  FinancePrivatePosition,
} from './types.ts'

const numeric = zod.coerce.number()
const balanceSchema = zod.object({
  asset: zod.string(),
  free: numeric.default(0),
  locked: numeric.default(0),
}).loose()
const spotAccountSchema = zod.object({
  accountType: zod.string().default('SPOT'),
  canTrade: zod.boolean().default(false),
  canWithdraw: zod.boolean().optional(),
  balances: zod.array(balanceSchema).default([]),
}).loose()
const futuresAssetSchema = zod.object({
  asset: zod.string(),
  walletBalance: numeric.default(0),
  availableBalance: numeric.default(0),
}).loose()
const futuresAccountSchema = zod.object({
  totalWalletBalance: numeric.default(0),
  totalUnrealizedProfit: numeric.default(0),
  assets: zod.array(futuresAssetSchema).default([]),
}).loose()
const positionSchema = zod.object({
  symbol: zod.string(),
  positionAmt: numeric.default(0),
  entryPrice: numeric.default(0),
  markPrice: numeric.default(0),
  unRealizedProfit: numeric.default(0),
  leverage: numeric.default(0),
  positionSide: zod.string().default('BOTH'),
}).loose()
const openOrderSchema = zod.object({
  orderId: zod.union([zod.string(), zod.number()]),
  symbol: zod.string(),
  side: zod.string(),
  type: zod.string(),
  price: numeric.default(0),
  origQty: numeric.default(0),
  executedQty: numeric.default(0),
  status: zod.string(),
  time: numeric.optional(),
}).loose()

function isoFromMilliseconds(value: number | undefined): string | undefined {
  if (value === undefined) return undefined
  return new Date(value).toISOString()
}

function balanceTotal(balance: { readonly free: number; readonly locked: number }): number {
  return balance.free + balance.locked
}

function normalizeBalances(
  balances: readonly { readonly asset: string; readonly free: number; readonly locked: number }[],
): FinancePrivateBalance[] {
  return balances
    .map(balance => ({ ...balance, total: balanceTotal(balance) }))
    .filter(balance => balance.total !== 0)
}

function normalizeOrders(orders: readonly zod.infer<typeof openOrderSchema>[]): FinancePrivateOpenOrder[] {
  return orders.map((order) => {
    const time = isoFromMilliseconds(order.time)
    return {
      orderId: String(order.orderId),
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      price: order.price,
      quantity: order.origQty,
      executedQuantity: order.executedQty,
      status: order.status,
      ...time === undefined ? {} : { time },
    }
  })
}

function positionSide(positionAmt: number, positionSide: string): FinancePrivatePosition['side'] {
  if (positionSide === 'LONG') return 'long'
  if (positionSide === 'SHORT') return 'short'
  return positionAmt > 0 ? 'long' : 'short'
}

/**
 * Normalize a Spot account response and optional open orders.
 * @param payload - Upstream Spot account JSON.
 * @param openOrders - Optional upstream open-order JSON.
 * @param now - Retrieval timestamp.
 * @returns Normalized read-only Spot account data.
 */
export function normalizeSpotAccount(
  payload: FinanceJsonValue,
  openOrders: FinanceJsonValue | undefined,
  now: Date,
): FinancePrivateAccountSnapshot {
  const account = spotAccountSchema.parse(payload)
  const orders = openOrders === undefined ? [] : zod.array(openOrderSchema).parse(openOrders)
  return {
    scope: 'spot',
    accountType: account.accountType,
    canTrade: account.canTrade,
    ...account.canWithdraw === undefined ? {} : { canWithdraw: account.canWithdraw },
    retrievedAt: now.toISOString(),
    balances: normalizeBalances(account.balances),
    positions: [],
    ...orders.length === 0 ? {} : { openOrders: normalizeOrders(orders) },
  }
}

/**
 * Normalize a USD-M or COIN-M account response with position risk.
 * @param scope - USD-M or COIN-M account family.
 * @param accountPayload - Upstream futures account JSON.
 * @param positionsPayload - Upstream position-risk JSON.
 * @param openOrders - Optional upstream open-order JSON.
 * @param now - Retrieval timestamp.
 * @returns Normalized read-only futures account data.
 */
export function normalizeFuturesAccount(
  scope: 'usdm' | 'coinm',
  accountPayload: FinanceJsonValue,
  positionsPayload: FinanceJsonValue,
  openOrders: FinanceJsonValue | undefined,
  now: Date,
): FinancePrivateAccountSnapshot {
  const account = futuresAccountSchema.parse(accountPayload)
  const positions = zod.array(positionSchema).parse(positionsPayload)
  const orders = openOrders === undefined ? [] : zod.array(openOrderSchema).parse(openOrders)
  return {
    scope,
    accountType: scope === 'usdm' ? 'USD_M_FUTURES' : 'COIN_M_FUTURES',
    canTrade: true,
    retrievedAt: now.toISOString(),
    totalWalletBalance: account.totalWalletBalance,
    totalUnrealizedProfit: account.totalUnrealizedProfit,
    balances: account.assets.map(asset => ({
      asset: asset.asset,
      free: asset.availableBalance,
      locked: Math.max(0, asset.walletBalance - asset.availableBalance),
      total: asset.walletBalance,
    })).filter(balance => balance.total !== 0),
    positions: positions.flatMap((position) => {
      const quantity = position.positionAmt
      if (quantity === 0) return []
      return [{
        symbol: position.symbol,
        side: positionSide(quantity, position.positionSide),
        quantity: Math.abs(quantity),
        entryPrice: position.entryPrice,
        markPrice: position.markPrice,
        unrealizedPnl: position.unRealizedProfit,
        leverage: position.leverage,
      }]
    }),
    ...orders.length === 0 ? {} : { openOrders: normalizeOrders(orders) },
  }
}

/**
 * Whether a request scope uses Binance futures account normalization.
 * @param scope - Binance private account scope.
 * @returns Whether the scope is USD-M or COIN-M.
 */
export function isFuturesScope(scope: FinancePrivateAccountRequest['scope']): scope is 'usdm' | 'coinm' {
  return scope === 'usdm' || scope === 'coinm'
}
