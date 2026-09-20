import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
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
  it('registers and executes the three finance tools', async () => {
    const ctx = await boot()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'finance_market_snapshot', 'finance_technical_analysis', 'finance_research_report',
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

    const report = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-report' as never,
      name: 'finance_research_report',
      arguments: { symbol: 'PREDICTION:FED-CUT', question: 'What is priced?', horizon: '1m' },
    })
    expect(report.isError).toBe(false)
    expect(textOf(report)).toContain('#')
  }, 30_000)

  it('selects the HTTP provider and exposes its raw query tool without making a request', async () => {
    const ctx = await boot(['    provider: http'])
    expect(ctx.tools.schemas()).toHaveLength(4)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-capabilities' as never,
      name: 'finance_provider_query',
      arguments: { operation: 'capabilities' },
    })
    expect(result.isError).toBe(false)
    expect(textOf(result)).toContain('binance.spot.exchange_info')

    const withParameters = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'finance-capabilities-parameters' as never,
      name: 'finance_provider_query',
      arguments: { operation: 'capabilities', parameters: {} },
    })
    expect(withParameters.isError).toBe(false)
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
    expect(ctx.tools.schemas()).toHaveLength(3)
    const entry = [...ctx.loader.entries()].find(
      candidate => candidate.options.name === '@deepseek-ai/dsh-experimental-finance-research',
    )
    expect(entry?.fiber).toBeDefined()
    await entry!.fiber!.dispose()
    expect(ctx.tools.schemas()).toHaveLength(0)
  })
})
