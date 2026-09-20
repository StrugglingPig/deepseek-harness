import { EventEmitter } from 'node:events'
import { WebSocketServer } from 'ws'
import { describe, expect, it, vi } from 'vitest'
import { BinanceWebSocketStreamProvider } from '../src/stream.ts'

class FakeSocket extends EventEmitter {
  readonly close = vi.fn()
  readonly send = vi.fn()
  emitMessage(value: unknown): void { this.emit('message', Buffer.from(JSON.stringify(value))) }
}

function bench() {
  const socket = new FakeSocket()
  const factory = vi.fn(() => socket)
  const provider = new BinanceWebSocketStreamProvider({
    baseUrl: 'wss://stream.test:9443',
    createSocket: factory,
    timeoutMs: 1_000,
    maxEvents: 2,
    now: () => new Date('2026-09-20T10:00:00.000Z'),
  })
  return { socket, factory, provider }
}

describe('Binance WebSocket stream provider', () => {
  it('collects parsed combined-stream events until the event cap', async () => {
    const { socket, factory, provider } = bench()
    const pending = provider.collect({ streams: ['btcusdt@miniTicker', 'ethusdt@miniTicker'] })

    expect(factory).toHaveBeenCalledWith('wss://stream.test:9443/stream?streams=btcusdt@miniTicker/ethusdt@miniTicker')
    socket.emitMessage({ stream: 'btcusdt@miniTicker', data: { c: '60000' } })
    socket.emitMessage({ stream: 'ethusdt@miniTicker', data: { c: '3000' } })

    await expect(pending).resolves.toEqual([
      { provider: 'binance', stream: 'btcusdt@miniTicker', receivedAt: '2026-09-20T10:00:00.000Z', data: { c: '60000' } },
      { provider: 'binance', stream: 'ethusdt@miniTicker', receivedAt: '2026-09-20T10:00:00.000Z', data: { c: '3000' } },
    ])
    expect(socket.close).toHaveBeenCalledOnce()
  })

  it('rejects an empty stream list', async () => {
    const { provider } = bench()
    await expect(provider.collect({ streams: [] })).rejects.toMatchObject({
      code: 'INVALID_STREAM',
    })
  })

  it('rejects without any event when the stream times out', async () => {
    vi.useFakeTimers()
    const { provider } = bench()
    const expectation = expect(provider.collect({ streams: ['btcusdt@miniTicker'], timeoutMs: 50 }))
      .rejects.toMatchObject({ code: 'STREAM_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(50)
    await expectation
    vi.useRealTimers()
  })

  it('returns collected events when the stream timeout expires', async () => {
    vi.useFakeTimers()
    const { socket, provider } = bench()
    const pending = provider.collect({ streams: ['btcusdt@miniTicker'], timeoutMs: 50 })
    socket.emitMessage({ stream: 'btcusdt@miniTicker', data: { c: '60000' } })
    await vi.advanceTimersByTimeAsync(50)
    await expect(pending).resolves.toHaveLength(1)
    vi.useRealTimers()
  })

  it('rejects socket failures and early closes', async () => {
    const first = bench()
    const errorPending = first.provider.collect({ streams: ['btcusdt@miniTicker'] })
    first.socket.emit('error', new Error('socket failed'))
    await expect(errorPending).rejects.toMatchObject({ code: 'STREAM_FAILED' })

    const second = bench()
    const closePending = second.provider.collect({ streams: ['btcusdt@miniTicker'] })
    second.socket.emit('close')
    await expect(closePending).rejects.toMatchObject({ code: 'STREAM_CLOSED' })
  })

  it('rejects immediately when the caller signal is already aborted', async () => {
    const { provider } = bench()
    const controller = new AbortController()
    controller.abort()
    await expect(provider.collect({ streams: ['btcusdt@miniTicker'] }, controller.signal))
      .rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('rejects an abort that arrives after collection starts', async () => {
    const { provider } = bench()
    const controller = new AbortController()
    const pending = provider.collect({ streams: ['btcusdt@miniTicker'] }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('rejects malformed JSON, malformed messages, and clock failures', async () => {
    const malformedJson = bench()
    const jsonPending = malformedJson.provider.collect({ streams: ['btcusdt@miniTicker'] })
    malformedJson.socket.emit('message', 'not-json')
    await expect(jsonPending).rejects.toMatchObject({ code: 'STREAM_INVALID' })

    const malformedMessage = bench()
    const messagePending = malformedMessage.provider.collect({ streams: ['btcusdt@miniTicker'] })
    malformedMessage.socket.emitMessage({ bad: true })
    await expect(messagePending).rejects.toMatchObject({ code: 'STREAM_INVALID' })

    const socket = new FakeSocket()
    const provider = new BinanceWebSocketStreamProvider({
      baseUrl: 'wss://stream.test/',
      createSocket: () => socket,
      now: () => { throw new Error('clock failed') },
    })
    const clockPending = provider.collect({ streams: ['btcusdt@miniTicker'] })
    socket.emitMessage({ stream: 'btcusdt@miniTicker', data: { c: '60000' } })
    await expect(clockPending).rejects.toMatchObject({ code: 'STREAM_FAILED' })
  })

  it('accepts string, buffer, array-buffer, and coerced message carriers', async () => {
    for (const [carrier, code] of [
      [JSON.stringify({ stream: 'btcusdt@miniTicker', data: { c: '60000' } }), undefined],
      [Buffer.from(JSON.stringify({ stream: 'btcusdt@miniTicker', data: { c: '60000' } })), undefined],
      [new TextEncoder().encode(JSON.stringify({ stream: 'btcusdt@miniTicker', data: { c: '60000' } })).buffer, undefined],
      [123, 'STREAM_INVALID'],
    ] as const) {
      const socket = new FakeSocket()
      const provider = new BinanceWebSocketStreamProvider({
        baseUrl: 'wss://stream.test',
        createSocket: () => socket,
        maxEvents: 1,
        now: () => new Date('2026-09-20T10:00:00.000Z'),
      })
      const pending = provider.collect({ streams: ['btcusdt@miniTicker'] })
      socket.emit('message', carrier)
      if (code === undefined) await expect(pending).resolves.toHaveLength(1)
      else await expect(pending).rejects.toMatchObject({ code })
    }
  })

  it('uses the real ws factory by default without a clock override', async () => {
    const server = new WebSocketServer({ port: 0 })
    await new Promise<void>(resolve => server.once('listening', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server has no port')
    server.on('connection', (socket) => {
      socket.send(JSON.stringify({ stream: 'btcusdt@miniTicker', data: { c: '60000' } }))
    })
    const provider = new BinanceWebSocketStreamProvider({
      baseUrl: `ws://127.0.0.1:${String(address.port)}/`,
      maxEvents: 1,
    })
    const events = await provider.collect({ streams: ['btcusdt@miniTicker'] })
    expect(events).toHaveLength(1)
    expect(events[0]?.receivedAt).toMatch(/T/)
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  })
})
