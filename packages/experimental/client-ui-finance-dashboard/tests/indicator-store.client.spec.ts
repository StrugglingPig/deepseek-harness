// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INDICATOR_PERSIST_KEY, createIndicatorStore, setIndicatorParameter, toggleIndicator } from '../src/client/indicator-store.ts'
import { DEFAULT_INDICATOR_IDS } from '../src/client/indicators.ts'

beforeEach(() => { localStorage.clear() })

describe('finance dashboard indicator preferences', () => {
  it('starts from the default selection and toggles indicators in catalog order', () => {
    const store = createIndicatorStore()
    expect(store.getSnapshot().enabled).toEqual([...DEFAULT_INDICATOR_IDS])

    store.set(toggleIndicator(store.getSnapshot(), 'kdj'))
    expect(store.getSnapshot().enabled).toEqual(['sma', 'ema', 'volume', 'rsi', 'macd', 'kdj'])

    store.set(toggleIndicator(store.getSnapshot(), 'ema'))
    expect(store.getSnapshot().enabled).toEqual(['sma', 'volume', 'rsi', 'macd', 'kdj'])
  })

  it('keeps the parameter overrides it is given', () => {
    const store = createIndicatorStore()
    store.set(setIndicatorParameter(store.getSnapshot(), 'boll', 'period', 10))
    store.set(setIndicatorParameter(store.getSnapshot(), 'boll', 'multiplier', 3))
    expect(store.getSnapshot().parameters.boll).toEqual({ period: 10, multiplier: 3 })
  })

  it('rehydrates the selection and overrides from browser storage', () => {
    const store = createIndicatorStore()
    store.set(toggleIndicator(store.getSnapshot(), 'kdj'))
    store.set(setIndicatorParameter(store.getSnapshot(), 'kdj', 'period', 12))

    const rehydrated = createIndicatorStore()
    expect(rehydrated.getSnapshot().enabled).toContain('kdj')
    expect(rehydrated.getSnapshot().parameters.kdj).toEqual({ period: 12 })
    expect(localStorage.getItem(INDICATOR_PERSIST_KEY)).toContain('kdj')
  })

  it('notifies subscribers and survives a storage that refuses to write', () => {
    const store = createIndicatorStore()
    const listener = vi.fn()
    const off = store.subscribe(listener)
    store.set(toggleIndicator(store.getSnapshot(), 'boll'))
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    store.set(toggleIndicator(store.getSnapshot(), 'boll'))
    expect(listener).toHaveBeenCalledTimes(1)

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => { store.set(toggleIndicator(store.getSnapshot(), 'kdj')) }).not.toThrow()
    setItem.mockRestore()
  })
})
