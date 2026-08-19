import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { userAgent } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import LlmRuntime from '@deepseek-ai/dsh-llm'

const NS = settingsNamespace('llm-deepseek')
const KEY_REF = credentialRef('DEEPSEEK_API_KEY')

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-llm-discovery-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

interface ListingServer {
  url: string
  paths: string[]
  headers: IncomingMessage['headers'][]
}

/** A stand-in proxy that answers one scripted `GET /models`. */
async function listingServer(behavior: { status?: number; body?: string }): Promise<ListingServer> {
  const paths: string[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    paths.push(request.url ?? '')
    headers.push(request.headers)
    const body = behavior.body ?? '{}'
    response.writeHead(behavior.status ?? 200, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    })
    response.end(body)
  })
  cleanups.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, paths, headers }
}

/**
 * Real composition: llm + settings-file + credentials-local + llm-deepseek
 * over one temp harness home, mirroring the dynamic-config harness.
 */
async function boot(dir: string, config: object): Promise<Context> {
  vi.stubEnv('DSH_HOME', dir)
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(LlmDeepSeek, config)
  return ctx
}

describe('llm-deepseek model discovery', () => {
  it('answers from the live catalog for the provider route, with no network call', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'from-the-endpoint' }] }) })
    const dir = await home()
    const ctx = await boot(dir, { baseURL: server.url })

    const models = await ctx.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official' })

    expect(models).toEqual([
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 1_000_000, maxTokens: 384_000 },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000, maxTokens: 384_000 },
    ])
    expect(server.paths).toEqual([])
  })

  it('reflects a settings-edited catalog without re-registration', async () => {
    const dir = await home()
    const ctx = await boot(dir, {})

    await ctx.settings.update(NS, {
      models: [{ id: 'gateway-only', name: 'Gateway Only', contextWindow: 65_536, maxTokens: 4096 }],
    })

    const models = await ctx.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official' })
    expect(models).toEqual([
      { id: 'gateway-only', name: 'Gateway Only', contextWindow: 65_536, maxTokens: 4096 },
    ])
  })

  it('interrogates the endpoint when the draft names a baseURL', async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [
          { id: 'proxied', display_name: 'Proxied', context_length: 131_072 },
          // A bare id the live catalog ships: the name and capacities are
          // inherited so an adopted row matches the shipped one.
          { id: 'deepseek-v4-pro' },
        ],
      }),
    })
    const dir = await home()
    const ctx = await boot(dir, {})

    const models = await ctx.llm.discoverModels('llm-deepseek', {
      provider: 'deepseek-official',
      baseURL: `${server.url}/v1`,
      apiKey: 'probe-key',
    })

    expect(models).toEqual([
      { id: 'proxied', name: 'Proxied', contextWindow: 131_072 },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000, maxTokens: 384_000 },
    ])
    expect(server.paths).toEqual(['/v1/models'])
    expect(server.headers[0]?.authorization).toBe('Bearer probe-key')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  })

  it('prefers the typed key over the stored one, and falls back to storage', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    const dir = await home()
    await writeFile(join(dir, '.credentials.yaml'), 'DEEPSEEK_API_KEY: sk-stored\n', { mode: 0o600 })
    const ctx = await boot(dir, {})

    await ctx.llm.discoverModels('llm-deepseek', { baseURL: server.url, apiKey: 'typed' })
    expect(server.headers[0]?.authorization).toBe('Bearer typed')

    await ctx.llm.discoverModels('llm-deepseek', { baseURL: server.url })
    expect(server.headers[1]?.authorization).toBe('Bearer sk-stored')
  })

  it('probes unauthenticated when no key is stored anywhere', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'open' }] }) })
    const dir = await home()
    const ctx = await boot(dir, {})

    await ctx.llm.discoverModels('llm-deepseek', { baseURL: server.url })

    expect(server.headers[0]?.authorization).toBeUndefined()
  })

  it('refuses a stored key no header can carry as INVALID_CREDENTIAL', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const dir = await home()
    const ctx = await boot(dir, {})
    await ctx.credentials.set(KEY_REF, 'sk-😀')

    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: 'http://127.0.0.1:9/v1' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  })

  it('reports a refusal, an unreachable endpoint, and a non-listing body', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const denied = await listingServer({ status: 401, body: '{}' })
    const dir = await home()
    const ctx = await boot(dir, {})

    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: denied.url }))
      .rejects.toThrow(/answered 401; check the API key/)
    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: 'http://127.0.0.1:9/v1' }))
      .rejects.toThrow(/could not reach/)

    const notJson = await listingServer({ body: '<html>login</html>' })
    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: notJson.url }))
      .rejects.toThrow(/did not answer with JSON/)
  })

  it('enriches market-common ids from the facts table, configured ids winning', async () => {
    const server = await listingServer({
      body: JSON.stringify({ data: [{ id: 'k3' }, { id: 'gpt-5.5' }, { id: 'deepseek-v4-pro' }] }),
    })
    const dir = await home()
    const ctx = await boot(dir, {
      modelFacts: [
        { id: 'k3', contextWindow: 1_048_576, maxTokens: 131_072 },
        { id: 'deepseek-v4-pro', maxTokens: 2048 },
      ],
    })

    const models = await ctx.llm.discoverModels('llm-deepseek', { baseURL: server.url })

    expect(models).toEqual([
      // The configured fact fills a proxy-only id the built-in table lacks.
      { id: 'k3', contextWindow: 1_048_576, maxTokens: 131_072 },
      // A built-in entry still applies beside the configured ones.
      { id: 'gpt-5.5', contextWindow: 1_050_000, maxTokens: 128_000 },
      // Configuration wins over the live catalog; the catalog keeps the rest.
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000, maxTokens: 2048 },
    ])
  })

  it('honors caller cancellation', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'never' }] }) })
    const dir = await home()
    const ctx = await boot(dir, {})
    const controller = new AbortController()
    controller.abort()

    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: server.url, signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ABORTED' })
    expect(server.paths).toEqual([])
  })

  it('says where a foreign provider must get its models', async () => {
    const dir = await home()
    const ctx = await boot(dir, {})

    await expect(ctx.llm.discoverModels('llm-deepseek', { provider: 'acme-gateway' }))
      .rejects.toThrow(/owns provider "deepseek-official", not "acme-gateway"/)
  })

  it('is offered for the namespace and withdraws when the plugin unloads', async () => {
    vi.stubEnv('DSH_HOME', await home())
    const ctx = new Context()
    cleanups.push(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(LlmRuntime)
    const pluginFiber = await ctx.plugin(LlmDeepSeek, {})

    await expect(ctx.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official' }))
      .resolves.not.toHaveLength(0)

    await pluginFiber.dispose()
    await expect(ctx.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official' }))
      .rejects.toMatchObject({ code: 'NO_DISCOVERY' })
  })
})
