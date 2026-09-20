import { describe, expect, it } from 'vitest'
import {
  classifyAsset,
  FixtureFinanceMarketDataProvider,
  fixtureProvider,
  loadFixtureSnapshot,
} from '../src/data.ts'

describe('fixture finance market data', () => {
  it('classifies prediction, crypto, and equity symbols', () => {
    expect(classifyAsset('PREDICTION:FED-CUT')).toBe('prediction')
    expect(classifyAsset('BTC')).toBe('crypto')
    expect(classifyAsset('ETH')).toBe('crypto')
    expect(classifyAsset('AAPL')).toBe('equity')
    expect(classifyAsset('TSLA')).toBe('equity')
  })

  it('rejects an empty symbol', () => {
    expect(() => loadFixtureSnapshot('   ')).toThrow('symbol must be a non-empty string')
  })

  it('loads deterministic equity, crypto, and prediction snapshots', async () => {
    const apple = loadFixtureSnapshot('aapl')
    const appleAgain = loadFixtureSnapshot('AAPL')
    expect(apple).toEqual(appleAgain)
    expect(apple.instrument).toEqual({
      symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'equity', currency: 'USD',
    })
    expect(apple.prediction).toBeUndefined()
    expect(apple.bars).toHaveLength(80)

    const bitcoin = await fixtureProvider.load('BTC')
    expect(bitcoin.instrument.name).toBe('Bitcoin')
    expect(bitcoin.bars).toHaveLength(80)

    const ether = loadFixtureSnapshot('ETH')
    expect(ether.instrument.name).toBe('Ether')

    const prediction = loadFixtureSnapshot('PREDICTION:FED-CUT')
    expect(prediction.instrument).toMatchObject({
      symbol: 'PREDICTION:FED-CUT', name: 'FED-CUT', assetClass: 'prediction', currency: 'PROB',
    })
    expect(prediction.prediction).toBeDefined()
    expect(prediction.prediction?.impliedProbability).toBeGreaterThan(0)
    expect(prediction.prediction?.impliedProbability).toBeLessThan(1)
    expect(prediction.prediction?.ask).toBeGreaterThan(prediction.prediction?.bid ?? 0)

    const fallback = loadFixtureSnapshot('TSLA')
    expect(fallback.instrument.name).toBe('TSLA')
    expect(fallback.instrument.assetClass).toBe('equity')

    const provider = new FixtureFinanceMarketDataProvider()
    expect(provider.id).toBe('fixture')
    await expect(provider.load('TSLA')).resolves.toMatchObject({ instrument: { symbol: 'TSLA' } })
  })
})
