import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { CoinMarketCapWebSocketStreamProvider } from '../src/stream.ts'

class FakeSocket extends EventEmitter {
  readonly send = vi.fn()
  readonly close = vi.fn()
}

function bench(options: {
  readonly enabled?: boolean
  readonly apiKey?: string | null
} = {}) {
  const socket = new FakeSocket()
  const factory = vi.fn((_url: string, _options?: { readonly headers?: Readonly<Record<string, string>> }) => socket)
  const provider = new CoinMarketCapWebSocketStreamProvider({
    baseUrl: 'wss://pro-stream.test/v1',
    resolveApiKey: async () => options.apiKey === null ? undefined : options.apiKey ?? 'cmc-key',
    enabled: () => options.enabled ?? true,
    createSocket: factory,
    now: () => new Date('2026-09-20T10:00:00.000Z'),
    timeoutMs: 1_000,
    maxEvents: 1,
  })
  return { socket, factory, provider }
}

describe('CoinMarketCap WebSocket stream provider', () => {
  it('authenticates, subscribes to latest prices, and returns data frames', async () => {
    const { socket, factory, provider } = bench()
    const pending = provider.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1, 1027] })
    await vi.waitFor(() => { expect(factory).toHaveBeenCalled() })

    expect(factory).toHaveBeenCalledWith('wss://pro-stream.test/v1', {
      headers: { 'X-CMC_PRO_API_KEY': 'cmc-key' },
    })
    socket.emit('open')
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({
      id: 1,
      method: 'subscribe',
      channel: 'market@crypto_latest_price',
      params: { crypto_ids: [1, 1027] },
    }))
    socket.emit('message', JSON.stringify({
      type: 'data',
      channel: 'market@crypto_latest_price',
      data: { cid: 1, p: 60_000, p24h: 2.5 },
      ts: 1_700_000_000_000,
    }))

    await expect(pending).resolves.toEqual([{
      provider: 'coinmarketcap',
      stream: 'market@crypto_latest_price',
      receivedAt: '2026-09-20T10:00:00.000Z',
      data: { cid: 1, p: 60_000, p24h: 2.5 },
    }])
  })

  it('rejects disabled, missing-key, and missing-id requests before connecting', async () => {
    const disabled = bench({ enabled: false })
    await expect(disabled.provider.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1] }))
      .rejects.toMatchObject({ code: 'AUTH_DISABLED' })
    expect(disabled.factory).not.toHaveBeenCalled()

    const missingKey = bench({ apiKey: null })
    await expect(missingKey.provider.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1] }))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(missingKey.factory).not.toHaveBeenCalled()

    const missingIds = bench()
    await expect(missingIds.provider.collect({ provider: 'coinmarketcap', streams: [] }))
      .rejects.toMatchObject({ code: 'INVALID_STREAM' })
    expect(missingIds.factory).not.toHaveBeenCalled()
  })

  it('rejects malformed, invalid, and unexpected messages', async () => {
    const malformed = bench()
    const malformedPending = malformed.provider.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1] })
    await vi.waitFor(() => { expect(malformed.socket.listenerCount('open')).toBe(1) })
    malformed.socket.emit('message', 'not-json')
    await expect(malformedPending).rejects.toMatchObject({ code: 'STREAM_INVALID' })

    const invalid = bench()
    const invalidPending = invalid.provider.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1] })
    await vi.waitFor(() => { expect(invalid.socket.listenerCount('open')).toBe(1) })
    invalid.socket.emit('message', JSON.stringify({ hello: 'world' }))
    await expect(invalidPending).rejects.toMatchObject({ code: 'STREAM_INVALID' })

    const unexpected = bench()
    const unexpectedPending = unexpected.provider.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1] })
    await vi.waitFor(() => { expect(unexpected.socket.listenerCount('open')).toBe(1) })
    unexpected.socket.emit('message', JSON.stringify({ type: 'data', channel: 'other', data: {} }))
    await expect(unexpectedPending).rejects.toMatchObject({ code: 'STREAM_INVALID' })
  })

  it('handles timeout, pre-abort, abort, socket errors, and default clocks', async () => {
    vi.useFakeTimers()
    const timeout = bench()
    const timeoutPending = timeout.provider.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1], timeoutMs: 10 })
    const timeoutExpectation = expect(timeoutPending).rejects.toMatchObject({ code: 'STREAM_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(10)
    await timeoutExpectation
    vi.useRealTimers()

    const aborted = bench()
    const preAborted = new AbortController()
    preAborted.abort()
    await expect(aborted.provider.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1] }, preAborted.signal))
      .rejects.toMatchObject({ code: 'ABORTED' })

    const controller = new AbortController()
    const abortedPending = aborted.provider.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1] }, controller.signal)
    await vi.waitFor(() => { expect(aborted.socket.listenerCount('open')).toBe(1) })
    controller.abort()
    await expect(abortedPending).rejects.toMatchObject({ code: 'ABORTED' })

    const errored = bench()
    const errorPending = errored.provider.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1] })
    await vi.waitFor(() => { expect(errored.socket.listenerCount('error')).toBe(1) })
    errored.socket.emit('error', new Error('socket failed'))
    await expect(errorPending).rejects.toMatchObject({ code: 'STREAM_FAILED' })

    const socket = new FakeSocket()
    const defaultClock = new CoinMarketCapWebSocketStreamProvider({
      baseUrl: 'wss://pro-stream.test/v1',
      resolveApiKey: async () => 'cmc-key',
      enabled: () => true,
      createSocket: () => socket,
      maxEvents: 1,
    })
    const defaultPending = defaultClock.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1] })
    await vi.waitFor(() => { expect(socket.listenerCount('open')).toBe(1) })
    socket.emit('open')
    socket.emit('message', JSON.stringify({ type: 'data', channel: 'market@crypto_latest_price', data: { cid: 1 } }))
    const defaultEvents = await defaultPending
    expect(typeof defaultEvents[0]?.receivedAt).toBe('string')
  })

  it('uses the default error message and wraps non-data failures', async () => {
    const fallback = bench()
    const fallbackPending = fallback.provider.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1] })
    await vi.waitFor(() => { expect(fallback.socket.listenerCount('open')).toBe(1) })
    fallback.socket.emit('message', JSON.stringify({ type: 'error' }))
    await expect(fallbackPending).rejects.toMatchObject({ code: 'CMC_STREAM_ERROR' })

    const socket = new FakeSocket()
    const clockFailure = new CoinMarketCapWebSocketStreamProvider({
      baseUrl: 'wss://pro-stream.test/v1',
      resolveApiKey: async () => 'cmc-key',
      enabled: () => true,
      createSocket: () => socket,
      now: () => { throw new Error('clock failed') },
    })
    const clockPending = clockFailure.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1] })
    await vi.waitFor(() => { expect(socket.listenerCount('open')).toBe(1) })
    socket.emit('message', JSON.stringify({ type: 'data', channel: 'market@crypto_latest_price', data: { cid: 1 } }))
    await expect(clockPending).rejects.toMatchObject({ code: 'STREAM_FAILED' })
  })

  it('reports an early close', async () => {
    const { socket, provider } = bench()
    const pending = provider.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1] })
    await vi.waitFor(() => { expect(socket.listenerCount('open')).toBe(1) })
    socket.emit('close')
    await expect(pending).rejects.toMatchObject({ code: 'STREAM_CLOSED' })
  })

  it('surfaces CoinMarketCap error envelopes', async () => {
    const { socket, provider } = bench()
    const pending = provider.collect({ provider: 'coinmarketcap', streams: [], cryptoIds: [1] })
    await vi.waitFor(() => { expect(socket.listenerCount('open')).toBe(1) })
    socket.emit('open')
    socket.emit('message', JSON.stringify({
      type: 'error',
      id: 1,
      status: { error_code: 1001, category: 'AUTH', error_message: 'This API Key is invalid.' },
    }))
    await expect(pending).rejects.toMatchObject({ code: 'CMC_STREAM_ERROR' })
  })
})
