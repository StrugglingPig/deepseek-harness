/**
 * Published dsh web, keyless: a profile-hoisted STALE copy of an in-box host
 * package that the app anchor alone does not carry (the 2026-08-20 outage
 * shape) must never load — the anchor closure (app plus bundles) resolves the
 * installation's own copy, so the host boots and session creation works. A
 * resolution regression loads the stale copy and the boot fails loud.
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { REPO_ROOT } from './support.ts'

function spawnSpec(argv: readonly string[], cwd: string, env?: Record<string, string>): SubprocessSpawnSpec {
  return {
    argv,
    cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: 5_000,
    ...env === undefined ? {} : { env },
  }
}

function waitForOutput(child: SubprocessHandle, pattern: RegExp, label: string): Promise<string> {
  return new Promise((resolveReady, reject) => {
    let output = ''
    let settled = false
    const cleanup = (): void => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
    }
    const resolveOnce = (value: string): void => {
      if (settled) return
      settled = true
      cleanup()
      resolveReady(value)
    }
    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onData = (chunk: Buffer): void => {
      output += chunk.toString()
      const match = output.match(pattern)
      if (match === null) return
      resolveOnce(match[1] ?? match[0])
    }
    const timer = setTimeout(() => { rejectOnce(new Error(`${label} not ready:\n${output}`)) }, 60_000)
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    void child.done.then((outcome) => {
      rejectOnce(new Error(`${label} exited before ready (${JSON.stringify(outcome)}):\n${output}`))
    }, (error: unknown) => {
      rejectOnce(new Error(`${label} failed before ready:\n${output}`, { cause: error }))
    })
  })
}

async function stopTree(child: SubprocessHandle): Promise<void> {
  child.terminate()
  const stopped = await child.waitForExit(AbortSignal.timeout(15_000))
  if (!stopped) throw new Error(`process tree ${String(child.pid)} did not stop after termination escalation`)
  await child.done
}

/** An RPC envelope over the served HTTP uplink, mirroring the browser carrier. */
async function rpc(baseUrl: string, method: string, payload: unknown): Promise<unknown> {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `e2e-${method}`, method, payload }),
  })
  const envelope = await response.json() as { result: unknown }
  return envelope.result
}

// Not in the app anchor's dependency closure, but a web-app bundle row: the
// single-anchor shape silently fell through to the config-directory walk for
// exactly this name and loaded a stale hoisted copy (module identity split,
// session creation failed process-wide). Its stale copy here throws at
// import, so loading it fails the boot loud instead of splitting silently.
const STALE = '@deepseek-ai/dsh-agent-presets'

async function stageStaleHostShadow(profileDir: string): Promise<void> {
  const dir = join(profileDir, 'node_modules', ...STALE.split('/'))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: STALE,
    version: '0.0.0-stale',
    type: 'module',
    main: './index.js',
  }))
  await writeFile(join(dir, 'index.js'), 'throw new Error(\'stale hoisted in-box copy loaded: resolution order regressed\')\n')
}

it('boots and creates sessions despite a stale hoisted copy of a bundle-only in-box package', async () => {
  const world = await mkdtemp(join(tmpdir(), 'dsh-web-stale-shadow-world-'))
  const binPath = join(REPO_ROOT, 'apps/cli/lib/bin.js')
  if (!existsSync(binPath)) throw new Error('stale-shadow browser test needs the built dsh bin; run pnpm run build first')
  const subprocessCtx = new Context()
  let subprocessFiber: Fiber | undefined
  let host: SubprocessHandle | undefined
  const failures: unknown[] = []
  try {
    subprocessFiber = await subprocessCtx.plugin(LocalSubprocessRuntime)
    // The shadow exists BEFORE boot: the resolution order under test is
    // decided at first resolve.
    const profileDir = join(world, '.dsh', 'profiles', 'web')
    await mkdir(join(profileDir, 'node_modules'), { recursive: true })
    await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    }, undefined, 2)}\n`)
    await stageStaleHostShadow(profileDir)
    const workspaceDir = join(world, 'workspace')
    await mkdir(workspaceDir, { recursive: true })
    host = subprocessCtx.subprocess.spawn(spawnSpec(
      [process.execPath, binPath, 'web', '--port', '0'],
      world,
      {
        DEEPSEEK_API_KEY: 'keyless-stale-shadow-no-call',
        DSH_HOME: join(world, '.dsh'),
      },
    ))
    const baseUrl = await waitForOutput(host, /dsh web: (http:\/\/[^\s]+)/, 'built dsh web')

    // The incident's exact failing surface: workspace pick then blank-session
    // create through the Host uplink. A loaded stale copy would have failed
    // the boot itself; a regressed preset subtree would fail the create.
    const created = await rpc(baseUrl, 'workspace.create', { path: workspaceDir }) as {
      ok: boolean
      value?: { workspace: { workspaceId: string } }
    }
    expect(created.ok).toBe(true)
    const workspaceId = created.value?.workspace.workspaceId
    expect(workspaceId).toBeDefined()
    const session = await rpc(baseUrl, 'session.create', { workspaceId }) as {
      ok: boolean
      value?: { sessionId: string; agentPreset: string }
      error?: { message: string }
    }
    expect(session.error?.message).toBeUndefined()
    expect(session.ok).toBe(true)
    expect(session.value?.agentPreset).toBe('standard')
  } catch (error) {
    failures.push(error)
  } finally {
    if (host !== undefined) await stopTree(host).catch((error: unknown) => failures.push(error))
    await subprocessFiber?.dispose().catch((error: unknown) => failures.push(error))
    await rm(world, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
  }
  if (failures.length > 0) throw new AggregateError(failures, 'stale-shadow live e2e failed')
}, 180_000)
