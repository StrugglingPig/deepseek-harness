import { describe, expect, it } from 'vitest'
import { barFromRow, DASHBOARD_MARKET_PATH } from '../src/shared.ts'

describe('finance dashboard wire contract', () => {
  it('publishes one route path for both halves', () => {
    expect(DASHBOARD_MARKET_PATH).toBe('/api/finance-dashboard/market')
  })

  it('maps complete numeric rows and rejects short or non-numeric rows', () => {
    expect(barFromRow([1_700_000_000_000, '100', '110', '95', '105', '12'])).toEqual({
      time: 1_700_000_000_000, open: 100, high: 110, low: 95, close: 105, volume: 12,
    })
    expect(barFromRow([1, '2', '3'])).toBeUndefined()
    expect(barFromRow([1, '2', '3', '4', '5', 'bad'])).toBeUndefined()
  })
})
