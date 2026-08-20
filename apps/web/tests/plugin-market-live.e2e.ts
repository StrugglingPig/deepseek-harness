/**
 * Published dsh web, keyless: a profile manifest rewrite (what `dsh plugin
 * add/remove` produces after pnpm materializes the package) recomposes the
 * bundle layer of the RUNNING host — the new client row is served and the
 * browser applies the entry-set change with an automatic reload, no restart
 * and no manual refresh.
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
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
      const match = pattern.exec(output)
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

/** Read-modify-write the profile manifest's bundle list, like the dsh CLI reconcile. */
async function setBundles(profileDir: string, bundles: string[]): Promise<void> {
  const manifestPath = join(profileDir, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
  }
  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  manifest.dsh.profile.bundles = bundles
  await writeFile(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
}

const FIXTURE = 'dsh-fixture-live'
const SHADOW = '@deepseek-ai/dsh-client-ui-theme'

/**
 * A profile-hoisted copy of an in-box client package, exactly what a pnpm
 * hoisted install leaves beside out-of-tree plugins: the client table must
 * keep serving the installation's own bundle, and pruning this copy (an
 * uninstall side effect) must never dangle the served path.
 */
async function stageInBoxShadow(profileDir: string): Promise<void> {
  const dir = join(profileDir, 'node_modules', ...SHADOW.split('/'))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: SHADOW,
    version: '0.0.0',
    type: 'module',
    dsh: { client: { platform: 'web' } },
    exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
  }))
  await writeFile(join(dir, 'index.js'), 'export const name = \'shadow-theme\'\nexport function apply() {}\n')
  await writeFile(join(dir, 'client.js'), [
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(SHADOW)}, factory: () => {`,
    'const exports = {}',
    'exports.name = \'shadow-theme\'',
    'exports.apply = () => {}',
    'exports.marker = \'SHADOW-MARKER\'',
    'return exports',
    '} })',
    '',
  ].join('\n'))
}

/**
 * Stage one market-shaped bundle package under the profile's node_modules:
 * a dual-face plugin whose patch row names the package itself — the host
 * Loader imports the node half through the root export while the client scan
 * registers the browser half from `./client`, exactly what `dsh plugin add`
 * materializes for a published client plugin.
 */
async function stageFixture(profileDir: string): Promise<void> {
  const bundleDir = join(profileDir, 'node_modules', FIXTURE)
  await mkdir(bundleDir, { recursive: true })
  await writeFile(join(bundleDir, 'package.json'), JSON.stringify({
    name: FIXTURE,
    version: '0.0.0',
    type: 'module',
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web' },
    },
    exports: {
      '.': './index.js',
      './client': './client.js',
      './package.json': './package.json',
    },
  }))
  await writeFile(join(bundleDir, 'cordis.patch.yml'), `- insert:\n    - id: fixture-live\n      name: ${FIXTURE}\n`)
  // Node half: the client scan qualifies only entries with a live fiber.
  await writeFile(join(bundleDir, 'index.js'), 'export const name = \'fixture-live\'\nexport function apply() {}\n')
  // Browser half: the closure-factory handoff the module system expects from
  // a classic script; exports an apply-only plugin so the entry settles active.
  await writeFile(join(bundleDir, 'client.js'), [
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(FIXTURE)}, factory: () => {`,
    'const exports = {}',
    `exports.name = ${JSON.stringify(FIXTURE)}`,
    'exports.apply = () => {}',
    'return exports',
    '} })',
    '',
  ].join('\n'))
}

it('recomposes a live install/uninstall without restarting or refreshing', async () => {
  const world = await mkdtemp(join(tmpdir(), 'dsh-web-market-world-'))
  const binPath = join(REPO_ROOT, 'apps/cli/lib/bin.js')
  if (!existsSync(binPath)) throw new Error('market-live browser test needs the built dsh bin; run pnpm run build first')
  const subprocessCtx = new Context()
  let subprocessFiber: Fiber | undefined
  let host: SubprocessHandle | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const failures: unknown[] = []
  try {
    subprocessFiber = await subprocessCtx.plugin(LocalSubprocessRuntime)
    // Pre-create the profile so the hoisted in-box shadow exists BEFORE boot:
    // the resolution order under test is decided at first resolve.
    const profileDir = join(world, '.dsh', 'profiles', 'web')
    await mkdir(join(profileDir, 'node_modules'), { recursive: true })
    await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    }, undefined, 2)}\n`)
    await stageInBoxShadow(profileDir)
    host = subprocessCtx.subprocess.spawn(spawnSpec(
      [process.execPath, binPath, 'web', '--port', '0'],
      world,
      {
        DEEPSEEK_API_KEY: 'keyless-market-no-call',
        DSH_HOME: join(world, '.dsh'),
      },
    ))
    const baseUrl = await waitForOutput(host, /dsh web: (http:\/\/[^\s]+)/, 'built dsh web')
    browser = await chromium.launch()
    const page = await browser.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(String(error)))
    await page.goto(baseUrl, { waitUntil: 'load' })
    // The boot manifest is the page's entry-set identity; a window marker
    // proves a reload happened without any manual refresh.
    await page.waitForFunction(() => (window as { __DSH_BOOT__?: unknown }).__DSH_BOOT__ !== undefined, undefined, { timeout: 15_000 })

    // The hoisted in-box shadow is ignored: the served bundle is the
    // installation's own, and pruning the shadow cannot dangle the path.
    const themeUrl = `/plugins/${SHADOW}/client.js`
    const servedBefore = await page.evaluate(async (url: string) => {
      const response = await fetch(url)
      return { status: response.status, body: await response.text() }
    }, themeUrl)
    expect(servedBefore.status).toBe(200)
    expect(servedBefore.body).not.toContain('SHADOW-MARKER')
    await rm(join(profileDir, 'node_modules', ...SHADOW.split('/')), { recursive: true, force: true })
    await page.waitForFunction(async (url: string) => {
      const response = await fetch(url)
      return response.status === 200 && !(await response.text()).includes('SHADOW-MARKER')
    }, themeUrl, { timeout: 10_000 })

    await page.evaluate(() => {
      Object.defineProperty(window, '__marketPageIdentity', { value: 'pre-install', configurable: true })
      const frames: string[] = []
      ;(window as unknown as { __sseFrames: string[] }).__sseFrames = frames
      const source = new EventSource('/plugins/events')
      source.onmessage = (event: MessageEvent<string>) => { frames.push(event.data) }
    })

    // Install: stage the package, then rewrite the manifest like the CLI would.
    await stageFixture(profileDir)
    const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    await setBundles(profileDir, [...manifest.dsh?.profile?.bundles ?? [], FIXTURE])

    // Host side: the new client row is served without a restart.
    try {
      await page.waitForFunction(async () => {
        const response = await fetch('/plugins/dsh-fixture-live/client.js')
        return response.status === 200
      }, undefined, { timeout: 30_000 })
    } catch (error) {
      throw new Error(`host did not serve the new row: ${String(error)}`)
    }
    // Browser side: the entry-set change triggers the automatic reload.
    try {
      await page.waitForFunction((id: string) => {
        const boot = (window as { __DSH_BOOT__?: { entries?: Array<{ id: string }> } }).__DSH_BOOT__
        return boot?.entries?.some(entry => entry.id === id) === true
      }, FIXTURE, { timeout: 30_000 })
    } catch (error) {
      const frames = await page.evaluate(() => (window as unknown as { __sseFrames?: string[] }).__sseFrames ?? [])
      const reloaded = await page.evaluate(() => (window as { __marketPageIdentity?: string }).__marketPageIdentity)
      throw new Error(`browser did not gain the new entry; identity=${String(reloaded)}; frames=${JSON.stringify(frames.slice(0, 4))}; ${String(error)}`)
    }
    expect(await page.evaluate(() => (window as { __marketPageIdentity?: string }).__marketPageIdentity))
      .toBeUndefined() // the pre-install page identity is gone: a reload happened

    // Uninstall: the row leaves the served graph and the page reloads again.
    await page.evaluate(() => {
      Object.defineProperty(window, '__marketPageIdentity', { value: 'pre-uninstall', configurable: true })
    })
    const afterInstall = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    await setBundles(profileDir, (afterInstall.dsh?.profile?.bundles ?? []).filter(name => name !== FIXTURE))
    await page.waitForFunction(async () => {
      const response = await fetch('/plugins/dsh-fixture-live/client.js')
      return response.status === 404
    }, undefined, { timeout: 30_000 })
    await page.waitForFunction((id: string) => {
      const boot = (window as { __DSH_BOOT__?: { entries?: Array<{ id: string }> } }).__DSH_BOOT__
      return boot?.entries?.some(entry => entry.id === id) === false
    }, FIXTURE, { timeout: 30_000 })
    expect(await page.evaluate(() => (window as { __marketPageIdentity?: string }).__marketPageIdentity))
      .toBeUndefined()
    expect(pageErrors).toEqual([])
  } catch (error) {
    failures.push(error)
  } finally {
    if (host !== undefined) await stopTree(host).catch((error: unknown) => failures.push(error))
    await browser?.close().catch((error: unknown) => failures.push(error))
    await subprocessFiber?.dispose().catch((error: unknown) => failures.push(error))
    await rm(world, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
  }
  if (failures.length > 0) throw new AggregateError(failures, 'market-live browser test or cleanup failed')
}, 180_000)
