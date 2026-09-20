import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as FinanceResearch from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(configLines: readonly string[] = []): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-finance-research-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-experimental-finance-research'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-experimental-finance-research', FinanceResearch],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return ctx
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('finance research real Loader composition', () => {
  it('registers and executes the finance tools', async () => {
    const ctx = await boot()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'finance_market_snapshot', 'finance_technical_analysis', 'finance_research_report',
      'finance_methodology_analysis', 'finance_strategy_catalog',
      'finance_provider_describe', 'finance_provider_request', 'finance_private_account',
      'finance_coinmarketcap_quotes', 'finance_coinmarketcap_ohlcv',
      'finance_realtime_stream', 'finance_monitor_plan',
    ])

    const snapshot = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-snapshot' as never,
      name: 'finance_market_snapshot',
      arguments: { symbol: 'AAPL' },
    })
    expect(snapshot.isError).toBe(false)
    expect(textOf(snapshot)).toContain('AAPL')

    const predictionSnapshot = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-prediction-snapshot' as never,
      name: 'finance_market_snapshot',
      arguments: { symbol: 'PREDICTION:FED-CUT' },
    })
    expect(predictionSnapshot.isError).toBe(false)
    expect(textOf(predictionSnapshot)).toContain('PREDICTION:FED-CUT')

    const analysis = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-analysis' as never,
      name: 'finance_technical_analysis',
      arguments: { symbol: 'BTC' },
    })
    expect(analysis.isError).toBe(false)
    expect(textOf(analysis)).toContain('BTC')

    const defaultReport = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-default-report' as never,
      name: 'finance_research_report',
      arguments: { symbol: 'AAPL' },
    })
    expect(defaultReport.isError).toBe(false)
    expect(defaultReport.content.some(block => block.type === 'text' && block.text.includes('## Investor Lenses'))).toBe(true)

    const methodology = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-methodology' as never,
      name: 'finance_methodology_analysis',
      arguments: { symbol: 'AAPL' },
    })
    expect(methodology.isError, textOf(methodology)).toBe(false)
    expect(textOf(methodology)).toContain('Warren Buffett')

    const catalog = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-strategy-catalog' as never,
      name: 'finance_strategy_catalog',
      arguments: { category: 'momentum' },
    })
    expect(catalog.isError).toBe(false)
    expect(textOf(catalog)).toContain('Momentum')
    const emptyCatalog = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-strategy-catalog-empty' as never,
      name: 'finance_strategy_catalog',
      arguments: { status: 'not-data-backed' },
    })
    expect(emptyCatalog.isError).toBe(false)

    const report = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-report' as never,
      name: 'finance_research_report',
      arguments: { symbol: 'PREDICTION:FED-CUT', question: 'What is priced?', horizon: '1m' },
    })
    expect(report.isError).toBe(false)
    expect(textOf(report)).toContain('#')
  }, 30_000)

  it('selects the HTTP provider and exposes generic provider tools', async () => {
    const ctx = await boot(['    provider: http'])
    expect(ctx.tools.schemas()).toHaveLength(12)
    const described = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-provider-describe' as never,
      name: 'finance_provider_describe',
      arguments: {},
    })
    expect(described.isError).toBe(false)
    expect(textOf(described)).toContain('binance-spot')

    const invalidRequest = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-provider-request' as never,
      name: 'finance_provider_request',
      arguments: { base: 'missing', path: '/api/v3/ping' },
    })
    expect(invalidRequest.isError).toBe(true)
    expect(textOf(invalidRequest)).toContain('unknown provider base')
  })

  it('renders a successful generic provider request', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    FinanceResearch.registerFinanceTools(ctx, {
      id: 'fake',
      async load() { throw new Error('load is not used') },
      describe: () => ({ id: 'fake', displayName: 'Fake', bases: [], notes: [] }),
      request: async request => ({
        provider: 'fake',
        base: request.base,
        method: request.method ?? 'GET',
        path: request.path,
        status: 200,
        data: { ok: true },
      }),
    })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-provider-request-success' as never,
      name: 'finance_provider_request',
      arguments: {
        base: 'fake-base',
        path: '/fake/path',
        method: 'POST',
        query: { page: 1 },
        body: { symbol: 'BTCUSDT' },
      },
    })
    expect(result.isError).toBe(false)
    expect(textOf(result)).toContain('HTTP 200 POST fake-base/fake/path')
  })

  it('turns an aborted execution into an error result', async () => {
    const ctx = await boot()
    const controller = new AbortController()
    controller.abort()
    for (const [name, argumentsValue] of [
      ['finance_market_snapshot', { symbol: 'AAPL' }],
      ['finance_technical_analysis', { symbol: 'AAPL' }],
      ['finance_research_report', { symbol: 'AAPL' }],
    ] as const) {
      const result = await ctx.tools.execute({
        signal: controller.signal,
        callId: `aborted-${name}` as never,
        name,
        arguments: argumentsValue,
      })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain('aborted')
    }
  }, 30_000)

  it('removes all registered tools when the finance entry is disposed', async () => {
    const ctx = await boot()
    expect(ctx.tools.schemas()).toHaveLength(12)
    const entry = [...ctx.loader.entries()].find(
      candidate => candidate.options.name === '@deepseek-ai/dsh-experimental-finance-research',
    )
    expect(entry?.fiber).toBeDefined()
    await entry!.fiber!.dispose()
    expect(ctx.tools.schemas()).toHaveLength(0)
  })
  it('exports Markdown and HTML when the filesystem service is available', async () => {
    const ctx = await boot()
    const writes = new Map<string, string>()
    ctx.provide('fs', {
      resolve: async (path: string) => ({ targetKey: path, displayPath: path }),
      writeText: async (target: { displayPath: string }, content: string) => {
        writes.set(target.displayPath, content)
        return { operation: 'create', version: 'v', after: content }
      },
    } as never)
    await vi.waitFor(() => { expect(ctx.tools.schemas().map(schema => schema.name)).toContain('finance_report_export') })
    const exported = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-export' as never,
      name: 'finance_report_export',
      arguments: { symbol: 'AAPL', question: 'What matters?', horizon: '1w', output_dir: 'reports', basename: 'aapl' },
    })
    expect(exported.isError).toBe(false)
    expect(textOf(exported)).toContain('reports/aapl.md')
    expect(writes.has('reports/aapl.md')).toBe(true)
    expect(writes.has('reports/aapl.html')).toBe(true)
    const defaults = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-export-defaults' as never,
      name: 'finance_report_export',
      arguments: { symbol: 'AAPL' },
    })
    expect(defaults.isError).toBe(false)
    expect([...writes.keys()].some(path => path.startsWith('.artifacts/finance-reports/'))).toBe(true)
  })

})
