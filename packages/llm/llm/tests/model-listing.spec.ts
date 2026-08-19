import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enrichDiscoveredModels, fetchOpenAiCompatibleModels, userAgent } from '../src/index.ts'

const servers: Server[] = []

afterEach(async () => {
  // A no-op when the test never stubbed `fetch`; only the body-read abort case
  // installs one.
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

interface ListingServer {
  url: string
  paths: string[]
  headers: IncomingMessage['headers'][]
}

/**
 * A stand-in provider that answers one scripted `GET /models`. `chunks` writes
 * without a declared length, which is how a real streamed reply arrives.
 */
async function listingServer(behavior: {
  status?: number
  body?: string
  chunks?: string[]
  holdOpenMs?: number
}): Promise<ListingServer> {
  const paths: string[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    paths.push(request.url ?? '')
    headers.push(request.headers)
    if (behavior.chunks !== undefined) {
      // No declared length: the ceiling has to hold on what is read.
      response.writeHead(behavior.status ?? 200, { 'content-type': 'application/json' })
      for (const chunk of behavior.chunks) response.write(chunk)
      if (behavior.holdOpenMs === undefined) { response.end(); return }
      // Left open so a caller's cancellation lands while the body is still
      // being read rather than after it completed.
      setTimeout(() => { response.end() }, behavior.holdOpenMs)
      return
    }
    const body = behavior.body ?? '{}'
    response.writeHead(behavior.status ?? 200, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    })
    response.end(body)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, paths, headers }
}

describe('fetchOpenAiCompatibleModels', () => {
  it('reads an OpenAI-compatible listing and keeps the capacities it discloses', async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [
          { id: 'acme-large', display_name: 'Acme Large', context_length: 65_536, max_output_tokens: 4096 },
          { id: 'acme-small' },
        ],
      }),
    })

    const models = await fetchOpenAiCompatibleModels({ baseURL: `${server.url}/v1`, apiKey: 'probe-key' })

    expect(models).toEqual([
      { id: 'acme-large', name: 'Acme Large', contextWindow: 65_536, maxTokens: 4096 },
      { id: 'acme-small' },
    ])
    expect(server.paths).toEqual(['/v1/models'])
    expect(server.headers[0]?.authorization).toBe('Bearer probe-key')
    expect(server.headers[0]?.accept).toBe('application/json')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  })

  it('keeps a deployment path instead of resolving it away', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'behind-gateway' }] }) })

    await fetchOpenAiCompatibleModels({ baseURL: `${server.url}/openai/v1/` })

    // Trailing slashes collapse; interior segments survive.
    expect(server.paths).toEqual(['/openai/v1/models'])
  })

  it('offers no credential when the request names none', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'open' }] }) })

    await fetchOpenAiCompatibleModels({ baseURL: server.url })

    expect(server.headers[0]?.authorization).toBeUndefined()
  })

  it('drops unusable rows rather than failing the whole listing', async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [{ id: 'good' }, { name: 'no id' }, { id: '' }, null, { id: 'also-good' }],
      }),
    })

    const models = await fetchOpenAiCompatibleModels({ baseURL: server.url })

    expect(models.map(model => model.id)).toEqual(['good', 'also-good'])
  })

  it('points at the credential for a refused probe, and only then', async () => {
    const denied = await listingServer({ status: 401, body: '{}' })
    await expect(fetchOpenAiCompatibleModels({ baseURL: denied.url, apiKey: 'wrong' }))
      .rejects.toThrow(/answered 401; check the API key/)

    const broken = await listingServer({ status: 500, body: '{}' })
    await expect(fetchOpenAiCompatibleModels({ baseURL: broken.url }))
      .rejects.toThrow(/answered 500$/)
  })

  it('reports a reply that is not a model listing', async () => {
    const noData = await listingServer({ body: JSON.stringify({ models: [] }) })
    await expect(fetchOpenAiCompatibleModels({ baseURL: noData.url }))
      .rejects.toThrow(/has no "data" array/)

    const notJson = await listingServer({ body: '<html>gateway login</html>' })
    await expect(fetchOpenAiCompatibleModels({ baseURL: notJson.url }))
      .rejects.toThrow(/did not answer with JSON/)
  })

  it('refuses an oversized reply, whether its length is declared or streamed', async () => {
    const declared = await listingServer({
      body: JSON.stringify({ data: [{ id: 'x', name: 'y'.repeat(5 * 1024 * 1024) }] }),
    })
    await expect(fetchOpenAiCompatibleModels({ baseURL: declared.url }))
      .rejects.toThrow(/more than \d+ bytes/)

    const streamed = await listingServer({
      chunks: ['{"data":[', `{"id":"x","name":"${'y'.repeat(5 * 1024 * 1024)}"}`, ']}'],
    })
    await expect(fetchOpenAiCompatibleModels({ baseURL: streamed.url }))
      .rejects.toThrow(/more than \d+ bytes/)
  })

  it('names the endpoint when the body read fails for a non-listing reason', async () => {
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
      start(stream) { stream.error(new TypeError('terminated')) },
    })))

    await expect(fetchOpenAiCompatibleModels({ baseURL: 'https://flaky.example/v1' }))
      .rejects.toThrow(/could not read the model listing from https:\/\/flaky\.example\/v1\/models/)
  })

  it('admits a reply of exactly the ceiling and counts multibyte bytes', async () => {
    const MAX = 4 * 1024 * 1024
    const shell = '{"data":[{"id":"x","name":""}]}'
    const exact = shell.replace('""', `"${'a'.repeat(MAX - shell.length)}"`)
    if (Buffer.byteLength(exact) !== MAX) throw new Error('fixture mis-sized')
    const atLimit = await listingServer({ body: exact })
    await expect(fetchOpenAiCompatibleModels({ baseURL: atLimit.url }))
      .resolves.toHaveLength(1)

    // Four mebibytes of two-byte characters is under the char count a
    // length-in-chars check would see, yet over the byte ceiling.
    const multibyte = await listingServer({ chunks: ['{"data":[', `{"id":"x","name":"${'é'.repeat(2 * 1024 * 1024 + 1)}"}`, ']}'] })
    await expect(fetchOpenAiCompatibleModels({ baseURL: multibyte.url }))
      .rejects.toThrow(/more than \d+ bytes/)
  })

  it('reports an unreachable endpoint instead of an empty catalog', async () => {
    // Port 9 (discard) accepts nothing on a loopback test host.
    await expect(fetchOpenAiCompatibleModels({ baseURL: 'http://127.0.0.1:9/v1' }))
      .rejects.toThrow(/could not reach/)
  })

  it('refuses a request with no baseURL before building a URL', async () => {
    await expect(fetchOpenAiCompatibleModels({}))
      .rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
    await expect(fetchOpenAiCompatibleModels({ baseURL: '' }))
      .rejects.toThrow(/needs a baseURL/)
  })

  it('reports cancellation during the body read as an abort, not a raw reason', async () => {
    const controller = new AbortController()
    const bodyRead = Promise.withResolvers<undefined>()
    vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit) => {
      const signal = init?.signal
      if (signal === undefined || signal === null) throw new Error('expected a discovery signal')
      return new Response(new ReadableStream<Uint8Array>({
        pull(stream) {
          bodyRead.resolve(undefined)
          return new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
              stream.error(signal.reason)
              resolve()
            }, { once: true })
          })
        },
      }))
    })
    const probe = fetchOpenAiCompatibleModels({
      baseURL: 'https://slow.example/v1',
      signal: controller.signal,
    })
    await bodyRead.promise
    controller.abort('test cancellation')

    await expect(probe).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('honors caller cancellation before the request goes out', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'never' }] }) })
    const controller = new AbortController()
    controller.abort()

    await expect(fetchOpenAiCompatibleModels({ baseURL: server.url, signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ABORTED' })
    expect(server.paths).toEqual([])
  })

  it('reports an illegal probe key as a credential fault, not an unreachable endpoint', async () => {
    await expect(fetchOpenAiCompatibleModels({ baseURL: 'http://127.0.0.1:9/v1', apiKey: 'sk-😀' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
    await expect(fetchOpenAiCompatibleModels({ baseURL: 'http://127.0.0.1:9/v1', apiKey: 'sk-😀' }))
      .rejects.toThrow(/no HTTP header can carry/)
  })

  it('reports a blank probe key as a credential fault too', async () => {
    await expect(fetchOpenAiCompatibleModels({ baseURL: 'http://127.0.0.1:9/v1', apiKey: '   ' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
    await expect(fetchOpenAiCompatibleModels({ baseURL: 'http://127.0.0.1:9/v1', apiKey: '   ' }))
      .rejects.toThrow(/is blank/)
  })

  it('prefers the first spelling when a gateway sends both', async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [{
          id: 'twin',
          name: 'Canonical Name',
          display_name: 'Gateway Rename',
          context_window: 65_536,
          context_length: 32_768,
          max_output_tokens: 4096,
          max_tokens: 2048,
        }],
      }),
    })

    expect(await fetchOpenAiCompatibleModels({ baseURL: server.url })).toEqual([
      { id: 'twin', name: 'Canonical Name', contextWindow: 65_536, maxTokens: 4096 },
    ])
  })
})

describe('enrichDiscoveredModels', () => {
  const known = new Map([
    ['shipped-model', { id: 'shipped-model', name: 'Shipped Model', contextWindow: 1_000_000, maxTokens: 64_000 }],
  ])

  it('fills what a bare listing omitted from adapter-known facts', () => {
    expect(enrichDiscoveredModels([{ id: 'shipped-model' }], known)).toEqual([
      { id: 'shipped-model', name: 'Shipped Model', contextWindow: 1_000_000, maxTokens: 64_000 },
    ])
  })

  it('keeps whatever the endpoint disclosed as authoritative', () => {
    expect(enrichDiscoveredModels(
      [{ id: 'shipped-model', name: 'Gateway Rename', contextWindow: 32_000 }],
      known,
    )).toEqual([{ id: 'shipped-model', name: 'Gateway Rename', contextWindow: 32_000, maxTokens: 64_000 }])
  })

  it('passes ids the catalog does not ship through bare', () => {
    expect(enrichDiscoveredModels([{ id: 'foreign' }], known)).toEqual([{ id: 'foreign' }])
  })

  it('leaves a capacity absent on both sides absent', () => {
    expect(enrichDiscoveredModels(
      [{ id: 'shipped-model' }],
      new Map([['shipped-model', { maxTokens: 64_000 }]]),
    )).toEqual([{ id: 'shipped-model', maxTokens: 64_000 }])
  })
})
