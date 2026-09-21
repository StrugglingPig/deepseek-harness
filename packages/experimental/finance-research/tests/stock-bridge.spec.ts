import { describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { FinanceStockSubprocessBridge } from '../src/stock.ts'

function reader(text: string) {
  return { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) }
}

function bench(options: {
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode?: number | null
  readonly resolveError?: Error
  readonly doneError?: Error
  readonly delayRejectMs?: number
  readonly missingStreams?: boolean
} = {}) {
  const spec = vi.fn((_request: SubprocessSpawnSpec) => undefined)
  const handle = {
    collected: options.missingStreams === true ? {} : {
      stdout: reader(options.stdout ?? '{"ok":true,"data":{"value":1}}'),
      stderr: reader(options.stderr ?? ''),
    },
    done: options.delayRejectMs !== undefined
      ? new Promise((_, reject) => setTimeout(() => { reject(new Error('delayed child failure')) }, options.delayRejectMs))
      : options.doneError === undefined
        ? Promise.resolve({ exitCode: options.exitCode ?? 0, signal: null })
        : Promise.reject(options.doneError),
  } as unknown as SubprocessHandle
  const subprocess = {
    resolveExecutable: vi.fn(async () => {
      if (options.resolveError !== undefined) throw options.resolveError
      return '/usr/bin/python3'
    }),
    spawn: vi.fn((request: SubprocessSpawnSpec) => { spec(request); return handle }),
  } as unknown as SubprocessRuntime
  const bridge = new FinanceStockSubprocessBridge({
    subprocess,
    pythonExecutable: 'python3',
    resolveCredential: async ref => ref === 'FINANCE_IFIND_USER'
      ? 'user'
      : ref === 'FINANCE_IFIND_REFRESH_TOKEN' ? 'refresh-token' : 'password',
  })
  return { bridge, spec, subprocess }
}

describe('finance macro bridge requests', () => {
  it('runs an AKShare macro action through the same subprocess bridge', async () => {
    const seen: SubprocessSpawnSpec[] = []
    const handle = {
      collected: {
        stdout: reader(JSON.stringify({ ok: true, data: { function: 'macro_china_pmi', observations: [{ date: '2026-01', value: 50 }] } })),
        stderr: reader(''),
      },
      done: Promise.resolve({ exitCode: 0, signal: null }),
    } as unknown as SubprocessHandle
    const subprocess = {
      resolveExecutable: vi.fn(async () => '/usr/bin/python3'),
      spawn: vi.fn((request: SubprocessSpawnSpec) => { seen.push(request); return handle }),
    } as unknown as SubprocessRuntime
    const bridge = new FinanceStockSubprocessBridge({
      subprocess,
      pythonExecutable: 'python3',
      resolveCredential: async () => undefined,
    })

    await expect(bridge.run({ action: 'macro_series', function: 'macro_china_pmi' })).resolves.toEqual({
      function: 'macro_china_pmi',
      observations: [{ date: '2026-01', value: 50 }],
    })
    expect(JSON.parse((seen[0]?.stdio?.stdin as { data: string }).data)).toEqual({
      action: 'macro_series',
      function: 'macro_china_pmi',
    })
  })
})

describe('FinanceStockSubprocessBridge', () => {
  it('spawns the bundled bridge with bounded stdio', async () => {
    const { bridge, spec } = bench()
    await expect(bridge.run({ action: 'stock_history', provider: 'akshare', symbol: '600519' }))
      .resolves.toEqual({ value: 1 })
    const request = spec.mock.calls[0]?.[0] as SubprocessSpawnSpec
    expect(request.argv.slice(0, 1)).toEqual(['/usr/bin/python3'])
    expect(request.argv[1]).toContain('finance_stock_bridge.py')
    expect(request.stdio.stdin).toEqual({
      data: JSON.stringify({ action: 'stock_history', provider: 'akshare', symbol: '600519' }),
    })
  })

  it('reads runtime options before each invocation', async () => {
    const specs: SubprocessSpawnSpec[] = []
    const resolveExecutable = vi.fn(async (command: string) => `/usr/bin/${command}`)
    const handle = {
      collected: {
        stdout: reader('{"ok":true,"data":{"value":1}}'),
        stderr: reader(''),
      },
      done: Promise.resolve({ exitCode: 0, signal: null }),
    } as unknown as SubprocessHandle
    let runtime = {
      pythonExecutable: 'python3',
      timeoutMs: 1_000,
      maxOutputBytes: 10,
      ifindBaseUrl: 'https://one.test',
    }
    const bridge = new FinanceStockSubprocessBridge({
      subprocess: {
        resolveExecutable,
        spawn: (request: SubprocessSpawnSpec) => {
          specs.push(request)
          return handle
        },
      } as unknown as SubprocessRuntime,
      pythonExecutable: 'initial-python',
      readRuntimeOptions: () => runtime,
      resolveCredential: async ref => ref === 'FINANCE_IFIND_REFRESH_TOKEN' ? 'token' : undefined,
    })
    await bridge.run({ action: 'stock_quote', provider: 'ifind', transport: 'http', symbols: ['600519'] })
    runtime = {
      pythonExecutable: 'python3.12',
      timeoutMs: 2_000,
      maxOutputBytes: 20,
      ifindBaseUrl: 'https://two.test',
    }
    await bridge.run({ action: 'stock_quote', provider: 'ifind', transport: 'http', symbols: ['600519'] })
    expect(resolveExecutable.mock.calls.map(call => call[0])).toEqual(['python3', 'python3.12'])
    expect(specs[0]?.env?.IFIND_BASE_URL).toBe('https://one.test')
    expect(specs[1]?.env?.IFIND_BASE_URL).toBe('https://two.test')
    expect(specs[1]?.stdio.stdout).toEqual({ maxBytes: 20 })
  })

  it('forwards iFinD credentials through explicit child environment only', async () => {
    const { bridge, spec } = bench()
    await bridge.run({ action: 'stock_quote', provider: 'ifind', transport: 'local', symbols: ['600519'] })
    expect(spec.mock.calls[0]?.[0].env).toEqual({
      PYTHONIOENCODING: 'utf-8',
      IFIND_BASE_URL: 'https://quantapi.51ifind.com',
      IFIND_USER: 'user',
      IFIND_PASSWORD: 'password',
    })
  })

  it('forwards the iFinD HTTP refresh token and base URL', async () => {
    const { bridge, spec } = bench()
    await bridge.run({ action: 'stock_quote', provider: 'ifind', transport: 'http', symbols: ['600519'] })
    expect(spec.mock.calls[0]?.[0].env).toEqual({
      PYTHONIOENCODING: 'utf-8',
      IFIND_BASE_URL: 'https://quantapi.51ifind.com',
      IFIND_REFRESH_TOKEN: 'refresh-token',
    })
  })

  it('maps timeout, cancellation, missing streams, and null-exit invalid responses', async () => {
    const timeout = bench({ delayRejectMs: 20 })
    const timedBridge = new FinanceStockSubprocessBridge({
      subprocess: timeout.subprocess,
      pythonExecutable: 'python3',
      timeoutMs: 1,
      resolveCredential: async () => undefined,
    })
    await expect(timedBridge.run({ action: 'stock_history', provider: 'akshare', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'STOCK_BRIDGE_TIMEOUT' })

    const controller = new AbortController()
    controller.abort()
    await expect(bench({ delayRejectMs: 5 }).bridge.run(
      { action: 'stock_history', provider: 'akshare', symbol: '600519' },
      controller.signal,
    )).rejects.toMatchObject({ code: 'ABORTED' })

    await expect(bench({ missingStreams: true }).bridge.run({ action: 'stock_history', provider: 'akshare', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'STOCK_BRIDGE_FAILED' })
    await expect(bench({ stdout: '{"ok":true}', exitCode: null }).bridge.run({ action: 'stock_history', provider: 'akshare', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'STOCK_BRIDGE_INVALID_RESPONSE' })
  })

  it('maps missing Python, missing output, invalid JSON, bridge errors, and structured failures', async () => {
    await expect(bench({ resolveError: new Error('missing') }).bridge.run({ action: 'stock_history', provider: 'akshare', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'STOCK_PYTHON_NOT_FOUND' })
    await expect(bench({ stdout: '' }).bridge.run({ action: 'stock_history', provider: 'akshare', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'STOCK_BRIDGE_FAILED' })
    await expect(bench({ stdout: '', stderr: 'bridge failed' }).bridge.run({ action: 'stock_history', provider: 'akshare', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'STOCK_BRIDGE_FAILED' })
    await expect(bench({ stdout: 'not-json' }).bridge.run({ action: 'stock_history', provider: 'akshare', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'STOCK_BRIDGE_INVALID_JSON' })
    await expect(bench({ stdout: '{"ok":true}' }).bridge.run({ action: 'stock_history', provider: 'akshare', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'STOCK_BRIDGE_INVALID_RESPONSE' })
    await expect(bench({ stdout: '{"ok":true}', exitCode: 1 }).bridge.run({ action: 'stock_history', provider: 'akshare', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'STOCK_BRIDGE_INVALID_RESPONSE' })
    await expect(bench({ stdout: '{"ok":false,"error":{"code":"AKSHARE_NOT_INSTALLED","message":"missing"}}' })
      .bridge.run({ action: 'stock_history', provider: 'akshare', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'AKSHARE_NOT_INSTALLED' })
    await expect(bench({ doneError: new Error('child failed') }).bridge.run({ action: 'stock_history', provider: 'akshare', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'STOCK_BRIDGE_FAILED' })
  })

  it('requires the selected iFinD credentials before spawning', async () => {
    const { subprocess } = bench()
    const bridge = new FinanceStockSubprocessBridge({
      subprocess,
      pythonExecutable: 'python3',
      resolveCredential: async () => undefined,
    })
    await expect(bridge.run({ action: 'stock_history', provider: 'ifind', transport: 'http', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'IFIND_AUTH_REQUIRED' })
    await expect(bridge.run({ action: 'stock_history', provider: 'ifind', transport: 'local', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'IFIND_AUTH_REQUIRED' })
    await expect(bridge.run({ action: 'stock_history', provider: 'ifind', symbol: '600519' }))
      .rejects.toMatchObject({ code: 'INVALID_STOCK_TRANSPORT' })
  })
})
