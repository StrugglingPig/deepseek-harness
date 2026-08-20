/**
 * Live profile-manifest recomposition of `dsh-app-boot`: `reloadProfileLayers`
 * re-resolves bundle layers per generation, `watchProfileManifest` re-applies
 * the full stack to the boot include when a package manager rewrites the
 * profile `package.json` (bounded retry over not-yet-installed bundles), and
 * the bundle-layer guard plus reconciliation make ephemeral hot-mount subtrees
 * yield to the durable bundle layer in both orderings.
 */

import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import Hmr from '@deepseek-ai/cordis-plugin-hmr'
import { type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Loader, { type Entry, type EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import { createScope } from '@deepseek-ai/dsh-scope'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import {
  boot,
  disposeDuplicateSubtreeEntries,
  duplicateSubtreeEntry,
  installBundleLayerGuard,
  reloadProfileLayers,
  watchProfileManifest,
} from '../src/index.ts'

const NAME = 'dsh-test-bin'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'dsh-manifest-watch-'))

async function eventually(test: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!test()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

const settleChokidarChangeThrottle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 75))

/**
 * Stage one bundle package under a profile's node_modules: manifest plus patch
 * layer. The inserted row's module name is relative, so the loader resolves it
 * against the ROOT config directory — the caller stages the module file there.
 */
function stageBundle(profileDir: string, name: string, rowId: string, moduleName: string): void {
  const bundleDir = join(profileDir, 'node_modules', name)
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(join(bundleDir, 'package.json'), JSON.stringify({
    name,
    version: '0.0.0',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(bundleDir, 'cordis.patch.yml'), `- insert:\n    - id: ${rowId}\n      name: ./${moduleName}\n`)
}

/** Stage the row's plugin module where the root include resolves relative names. */
function stageRootModule(rootDir: string, moduleName: string, rowName: string): void {
  writeFileSync(join(rootDir, moduleName), [
    `export const name = ${JSON.stringify(rowName)}`,
    'export function apply(_ctx, _config) {}',
    '',
  ].join('\n'))
}

/** Stage a profile directory under a fresh home with the given bundle list. */
function stageProfile(name: string, bundles: string[]): { home: string; profileDir: string; manifestPath: string } {
  const home = tmp()
  const profileDir = join(home, 'profiles', name)
  mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
  const manifestPath = join(profileDir, 'package.json')
  writeFileSync(manifestPath, JSON.stringify({ name: `dsh-profile-${name}`, dsh: { profile: { bundles } } }))
  return { home, profileDir, manifestPath }
}

const hasRow = (ctx: Context, id: string): boolean =>
  [...ctx.loader.entries()].some(entry => entry.options.id === id)

describe('reloadProfileLayers', () => {
  it('re-reads the manifest per call, skips the user layer, and fails loud on uninstalled bundles', () => {
    const { home, manifestPath } = stageProfile('demo', ['bundle-a'])
    stageBundle(join(home, 'profiles', 'demo'), 'bundle-a', 'row-a', 'a.mjs')
    const anchor = join(tmp(), 'package.json')
    writeFileSync(anchor, JSON.stringify({ name: 'dsh-app', dependencies: {} }))

    const first = reloadProfileLayers(NAME, 'demo', anchor, home)
    expect(first.layers.map(layer => layer.packageName)).toEqual(['bundle-a'])
    expect(first.patches).toEqual([])

    writeFileSync(manifestPath, JSON.stringify({ name: 'dsh-profile-demo', dsh: { profile: { bundles: ['bundle-a', 'bundle-b'] } } }))
    stageBundle(join(home, 'profiles', 'demo'), 'bundle-b', 'row-b', 'b.mjs')
    const second = reloadProfileLayers(NAME, 'demo', anchor, home)
    expect(second.layers.map(layer => layer.packageName)).toEqual(['bundle-a', 'bundle-b'])

    writeFileSync(manifestPath, JSON.stringify({ name: 'dsh-profile-demo', dsh: { profile: { bundles: ['bundle-ghost'] } } }))
    expect(() => reloadProfileLayers(NAME, 'demo', anchor, home)).toThrow('cannot resolve profile bundle')
  })

  it('treats a manifest without a bundles list as an empty layer list', () => {
    const home = tmp()
    const profileDir = join(home, 'profiles', 'demo')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'dsh-profile-demo' }))
    const anchor = join(tmp(), 'package.json')
    writeFileSync(anchor, JSON.stringify({ name: 'dsh-app', dependencies: {} }))
    expect(reloadProfileLayers(NAME, 'demo', anchor, home).layers).toEqual([])
  })
})

describe('watchProfileManifest', () => {
  it('re-composes bundle layers live, retries a torn generation, and reconciles hot subtrees', { timeout: 30_000 }, async () => {
    const { home, profileDir, manifestPath } = stageProfile('demo', ['bundle-a'])
    stageBundle(profileDir, 'bundle-a', 'row-a', 'a.mjs')
    const rootDir = tmp()
    writeFileSync(join(rootDir, 'cordis.yml'), '[]\n')
    stageRootModule(rootDir, 'a.mjs', 'row-a-plugin')
    const compose = (): PatchOptions[] =>
      reloadProfileLayers(NAME, 'demo', join(profileDir, 'package.json'), home)
        .layers.flatMap(layer => layer.patches)
    const ctx = await boot(NAME, join(rootDir, 'cordis.yml'), compose())
    await ctx.plugin(Timer)
    await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    installBundleLayerGuard(ctx, NAME)
    const afterUpdate = { count: 0 }
    const dispose = await watchProfileManifest(ctx, {
      binName: NAME,
      filename: manifestPath,
      compose,
      afterUpdate: async () => {
        afterUpdate.count += 1
        await disposeDuplicateSubtreeEntries(ctx, NAME)
      },
      retry: { attempts: 50, delayMs: 100 },
    })
    try {
      expect(hasRow(ctx, 'row-a')).toBe(true)

      // Install: a new bundle in the manifest mounts without a restart.
      stageBundle(profileDir, 'bundle-b', 'row-b', 'b.mjs')
      stageRootModule(rootDir, 'b.mjs', 'row-b-plugin')
      writeFileSync(manifestPath, JSON.stringify({ name: 'dsh-profile-demo', dsh: { profile: { bundles: ['bundle-a', 'bundle-b'] } } }))
      await eventually(() => hasRow(ctx, 'row-b'), 'installed bundle row did not mount live')
      await eventually(() => afterUpdate.count >= 1, 'afterUpdate reconciliation did not run')

      // Uninstall: removing the bundle disposes its rows transactionally.
      // Space the write past the previous event's delivery window — a change
      // landing on the heels of the last one is dropped by the native watcher.
      await settleChokidarChangeThrottle()
      writeFileSync(manifestPath, JSON.stringify({ name: 'dsh-profile-demo', dsh: { profile: { bundles: ['bundle-a'] } } }))
      await eventually(() => !hasRow(ctx, 'row-b'), 'removed bundle row did not dispose live')
      expect(hasRow(ctx, 'row-a')).toBe(true)
      await settleChokidarChangeThrottle()

      // Torn generation: the manifest names a bundle pnpm has not materialized
      // yet; the bounded retry self-heals once the package lands, no new event.
      writeFileSync(manifestPath, JSON.stringify({ name: 'dsh-profile-demo', dsh: { profile: { bundles: ['bundle-a', 'bundle-c'] } } }))
      await settleChokidarChangeThrottle()
      stageBundle(profileDir, 'bundle-c', 'row-c', 'c.mjs')
      stageRootModule(rootDir, 'c.mjs', 'row-c-plugin')
      await eventually(() => hasRow(ctx, 'row-c'), 'torn generation did not self-heal through the bounded retry')
      expect(hasRow(ctx, 'row-a')).toBe(true)
    } finally {
      await dispose()
      await ctx.fiber.dispose()
    }
  })

  it('flags only nested rows duplicating a live durable row', () => {
    const otherTree = {} as EntryTree
    const mkEntry = (name: string, live = true, disabled = false, ctx: Context = new Context()) =>
      ({
        parent: { tree: otherTree },
        options: { id: `id-${name}`, name },
        ctx,
        ...live ? { fiber: {} } : {},
        disabled,
      }) as unknown as Entry
    const rootRow = mkEntry('bundle-a')
    const offRow = mkEntry('bundle-off', false)
    const disabledRow = mkEntry('bundle-dis', true, true)
    // The durable layer is the root include subtree's top-level store.
    const durable = { store: { a: rootRow, b: offRow, c: disabledRow } } as unknown as EntryTree

    // Disposal-half fibers (vendored Cordis nulls uid before emitting the
    // disposal event) and entry-less fibers are never flagged.
    expect(duplicateSubtreeEntry(durable, { uid: null, entry: rootRow })).toBeUndefined()
    expect(duplicateSubtreeEntry(durable, { entry: rootRow })).toBeUndefined()
    expect(duplicateSubtreeEntry(durable, { uid: 1 })).toBeUndefined()
    // Durable rows never yield.
    expect(duplicateSubtreeEntry(durable, { uid: 1, entry: rootRow })).toBeUndefined()
    // A nested row whose name no live durable row carries stays (client-only shims).
    expect(duplicateSubtreeEntry(durable, { uid: 1, entry: mkEntry('unrelated') })).toBeUndefined()
    // Names carried only by a fiberless or disabled durable row do not count.
    expect(duplicateSubtreeEntry(durable, { uid: 1, entry: mkEntry('bundle-off') })).toBeUndefined()
    expect(duplicateSubtreeEntry(durable, { uid: 1, entry: mkEntry('bundle-dis') })).toBeUndefined()
    // The hot-mount shape: nested, created, duplicating a live durable row.
    const hot = mkEntry('bundle-a')
    expect(duplicateSubtreeEntry(durable, { uid: 1, entry: hot })).toBe(hot)
    // A scoped per-session composition (agent preset) keeps same-named rows.
    const scope = createScope(new Context(), { preset: 'unit' })
    const scoped = mkEntry('bundle-a', true, false, scope.ctx)
    expect(duplicateSubtreeEntry(durable, { uid: 1, entry: scoped })).toBeUndefined()
  })

  it('the guard removes a flagged creation and contains a failing removal', { timeout: 20_000 }, async () => {
    const { home, profileDir } = stageProfile('demo', ['bundle-a'])
    stageBundle(profileDir, 'bundle-a', 'row-a', 'shared.mjs')
    const rootDir = tmp()
    writeFileSync(join(rootDir, 'cordis.yml'), '[]\n')
    stageRootModule(rootDir, 'shared.mjs', 'row-a')
    const compose = (): PatchOptions[] =>
      reloadProfileLayers(NAME, 'demo', join(profileDir, 'package.json'), home)
        .layers.flatMap(layer => layer.patches)
    const ctx = await boot(NAME, join(rootDir, 'cordis.yml'), compose())
    try {
      installBundleLayerGuard(ctx, NAME)
      const removed: string[] = []
      const otherTree = {} as EntryTree
      const hotFiber = (id: string, fail: boolean) => ({
        uid: 1,
        // The loader's own lifecycle listener reads fiber.parent first.
        parent: {},
        entry: {
          parent: {
            tree: otherTree,
            remove: async (removedId: string): Promise<void> => {
              if (fail) throw new Error('boom')
              removed.push(removedId)
            },
          },
          options: { id, name: './shared.mjs' },
          ctx: new Context(),
        } as unknown as Entry,
      }) as unknown as Fiber
      // A flagged creation is removed through the entry's own group.
      ctx.emit('internal/plugin', hotFiber('hot-ok', false))
      await eventually(() => removed.length === 1, 'guard did not remove the flagged creation')
      // A failing removal is contained: the guard warns instead of escaping.
      ctx.emit('internal/plugin', hotFiber('hot-bad', true))
      await eventually(() => removed.length === 1, 'failed removal must not remove')
      await new Promise(resolve => setTimeout(resolve, 20))
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('re-composes live without a retry budget and self-heals a torn generation through one', { timeout: 30_000 }, async () => {
    const { home, profileDir, manifestPath } = stageProfile('demo', ['bundle-a'])
    stageBundle(profileDir, 'bundle-a', 'row-a', 'a.mjs')
    const rootDir = tmp()
    writeFileSync(join(rootDir, 'cordis.yml'), '[]\n')
    stageRootModule(rootDir, 'a.mjs', 'row-a-plugin')
    const compose = (): PatchOptions[] =>
      reloadProfileLayers(NAME, 'demo', join(profileDir, 'package.json'), home)
        .layers.flatMap(layer => layer.patches)

    // No retry budget: the plain refresh path.
    const plain = await boot(NAME, join(rootDir, 'cordis.yml'), compose())
    await plain.plugin(Timer)
    await plain.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    const disposePlain = await watchProfileManifest(plain, { binName: NAME, filename: manifestPath, compose })
    try {
      stageBundle(profileDir, 'bundle-b', 'row-b', 'b.mjs')
      stageRootModule(rootDir, 'b.mjs', 'row-b-plugin')
      writeFileSync(manifestPath, JSON.stringify({ name: 'dsh-profile-demo', dsh: { profile: { bundles: ['bundle-a', 'bundle-b'] } } }))
      await eventually(() => hasRow(plain, 'row-b'), 'installed bundle row did not mount without a retry budget')
    } finally {
      await disposePlain()
      await plain.fiber.dispose()
    }

    // Bounded retry over a non-Error failure: the first refresh throws a raw
    // string (torn generation shape), the loop wraps it and self-heals on the
    // same event once the compose succeeds.
    writeFileSync(manifestPath, JSON.stringify({ name: 'dsh-profile-demo', dsh: { profile: { bundles: ['bundle-a'] } } }))
    const retried = await boot(NAME, join(rootDir, 'cordis.yml'), compose())
    await retried.plugin(Timer)
    await retried.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    let failOnce = true
    const guardedCompose = (): PatchOptions[] => {
      if (failOnce) {
        failOnce = false
        // A raw string: the retry loop must wrap non-Error throws too.
        throw 'torn-generation'
      }
      return compose()
    }
    const disposeRetried = await watchProfileManifest(retried, {
      binName: NAME,
      filename: manifestPath,
      compose: guardedCompose,
      retry: { attempts: 5, delayMs: 20 },
    })
    try {
      writeFileSync(manifestPath, JSON.stringify({ name: 'dsh-profile-demo', dsh: { profile: { bundles: ['bundle-a', 'bundle-b'] } } }))
      await eventually(() => hasRow(retried, 'row-b'), 'torn generation did not self-heal through the retry')
    } finally {
      await disposeRetried()
      await retried.fiber.dispose()
    }
  })

  it('returns a no-op disposer when the tree is disposed while the watcher opens', async () => {
    // A surface can dispose the whole tree while registerConfig's effect
    // registration is still in flight (the HMR effect then fails with
    // INACTIVE_EFFECT); the app is exiting exactly as asked, so the watcher
    // must not crash the process. The stub makes the race deterministic —
    // the live-teardown ordering itself is not stageable.
    const { manifestPath } = stageProfile('demo', [])
    const rootDir = tmp()
    writeFileSync(join(rootDir, 'cordis.yml'), '[]\n')
    const ctx = await boot(NAME, join(rootDir, 'cordis.yml'), [])
    try {
      const teardown = Object.assign(new Error('cannot create effect on inactive context'), { code: 'INACTIVE_EFFECT' })
      ctx.provide('hmr', { registerConfig: () => Promise.reject(teardown) })
      const dispose = await watchProfileManifest(ctx, { binName: NAME, filename: manifestPath, compose: () => [] })
      await expect(dispose()).resolves.toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('surfaces an exhausted retry budget loudly and propagates registration failures', { timeout: 20_000 }, async () => {
    const { home, profileDir, manifestPath } = stageProfile('demo', ['bundle-a'])
    stageBundle(profileDir, 'bundle-a', 'row-a', 'a.mjs')
    const rootDir = tmp()
    writeFileSync(join(rootDir, 'cordis.yml'), '[]\n')
    stageRootModule(rootDir, 'a.mjs', 'row-a-plugin')
    const compose = (): PatchOptions[] =>
      reloadProfileLayers(NAME, 'demo', join(profileDir, 'package.json'), home)
        .layers.flatMap(layer => layer.patches)
    const broken = (): PatchOptions[] => { throw new Error('still torn') }
    const ctx = await boot(NAME, join(rootDir, 'cordis.yml'), compose())
    await ctx.plugin(Timer)
    await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    const failures: Error[] = []
    const offFailure = ctx.on('hmr/config-update-failed', (_filename, error) => { failures.push(error) })
    const dispose = await watchProfileManifest(ctx, {
      binName: NAME,
      filename: manifestPath,
      compose: broken,
      retry: { attempts: 2, delayMs: 10 },
    })
    try {
      // Exhausted budget: the generation fails loud through the HMR broadcast
      // and the last good tree keeps running.
      writeFileSync(manifestPath, JSON.stringify({ name: 'dsh-profile-demo', dsh: { profile: { bundles: ['bundle-a'] } } }))
      await eventually(() => failures.length >= 1, 'exhausted retry did not surface through hmr/config-update-failed')
      expect(hasRow(ctx, 'row-a')).toBe(true)
      // Not a teardown race: a second registration of the same path propagates.
      await expect(watchProfileManifest(ctx, {
        binName: NAME, filename: manifestPath, compose: broken, retry: { attempts: 2, delayMs: 10 },
      })).rejects.toThrow('already registered')
    } finally {
      offFailure()
      await dispose()
      await ctx.fiber.dispose()
    }
  })

  it('reconciliation disposes a nested duplicate and contains a failing removal', { timeout: 20_000 }, async () => {
    const { home, profileDir } = stageProfile('demo', ['bundle-a'])
    stageBundle(profileDir, 'bundle-a', 'row-a', 'shared.mjs')
    const rootDir = tmp()
    writeFileSync(join(rootDir, 'cordis.yml'), '[]\n')
    stageRootModule(rootDir, 'shared.mjs', 'row-a')
    // A market-style nested include one level deeper in the forest, mounting
    // the same module name the durable layer carries.
    const marketDir = tmp()
    writeFileSync(join(marketDir, 'cordis.yml'), '- id: hot\n  name: ./shared.mjs\n')
    writeFileSync(join(marketDir, 'shared.mjs'), 'export const name = \'hot\'\nexport function apply() {}\n')
    const compose = (): PatchOptions[] =>
      reloadProfileLayers(NAME, 'demo', join(profileDir, 'package.json'), home)
        .layers.flatMap(layer => layer.patches)
    const ctx = await boot(NAME, join(rootDir, 'cordis.yml'), compose())
    try {
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(marketDir, 'cordis.yml')).href } })
      expect(hasRow(ctx, 'hot')).toBe(true)
      // The removal itself succeeds; a throwing observer on the dispose
      // notification must not escape the reconciliation.
      const off = ctx.on('loader/partial-dispose', () => { throw new Error('observer boom') })
      await disposeDuplicateSubtreeEntries(ctx, NAME)
      off()
      expect(hasRow(ctx, 'hot')).toBe(false)
      expect(hasRow(ctx, 'row-a')).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('disposeDuplicateSubtreeEntries leaves root rows untouched when nothing duplicates', { timeout: 20_000 }, async () => {
    const { home, profileDir } = stageProfile('demo', ['bundle-a'])
    stageBundle(profileDir, 'bundle-a', 'row-a', 'shared.mjs')
    const rootDir = tmp()
    writeFileSync(join(rootDir, 'cordis.yml'), '[]\n')
    stageRootModule(rootDir, 'shared.mjs', 'row-a')
    const compose = (): PatchOptions[] =>
      reloadProfileLayers(NAME, 'demo', join(profileDir, 'package.json'), home)
        .layers.flatMap(layer => layer.patches)
    const ctx = await boot(NAME, join(rootDir, 'cordis.yml'), compose())
    try {
      await disposeDuplicateSubtreeEntries(ctx, NAME)
      expect(hasRow(ctx, 'row-a')).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('disposeDuplicateSubtreeEntries is a no-op before boot and the guard requires the root Include', async () => {
    const bare = new Context()
    bare.baseUrl = pathToFileURL(`${tmp()}/`).href
    await expect(disposeDuplicateSubtreeEntries(bare, NAME)).resolves.toBeUndefined()
    expect(() => installBundleLayerGuard(bare, NAME)).toThrow('requires the root Include entry')
  })

  it('requires HMR and the root Include', async () => {
    const { home, profileDir, manifestPath } = stageProfile('demo', ['bundle-a'])
    stageBundle(profileDir, 'bundle-a', 'row-a', 'a.mjs')
    const withoutHmrDir = tmp()
    writeFileSync(join(withoutHmrDir, 'cordis.yml'), '[]\n')
    const compose = (): PatchOptions[] => []
    const withoutHmr = await boot(NAME, join(withoutHmrDir, 'cordis.yml'), compose())
    await expect(watchProfileManifest(withoutHmr, { binName: NAME, filename: manifestPath, compose }))
      .rejects.toThrow('requires the Cordis HMR service')
    await withoutHmr.fiber.dispose()

    const withoutInclude = new Context()
    withoutInclude.baseUrl = pathToFileURL(`${tmp()}/`).href
    await withoutInclude.plugin(Loader)
    await withoutInclude.plugin(Timer)
    await withoutInclude.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    await expect(watchProfileManifest(withoutInclude, { binName: NAME, filename: manifestPath, compose }))
      .rejects.toThrow('requires the root Include entry')
    await withoutInclude.fiber.dispose()
    void home
  })
})

describe('watchProfileManifest stat backstop', () => {
  it('reconciles missed writes, contains poll-path failures, and survives manifest removal', { timeout: 20_000 }, async () => {
    const { home, profileDir, manifestPath } = stageProfile('demo', ['bundle-a'])
    stageBundle(profileDir, 'bundle-a', 'row-a', 'a.mjs')
    const rootDir = tmp()
    writeFileSync(join(rootDir, 'cordis.yml'), '[]\n')
    stageRootModule(rootDir, 'a.mjs', 'row-a-plugin')
    const compose = (): PatchOptions[] =>
      reloadProfileLayers(NAME, 'demo', join(profileDir, 'package.json'), home)
        .layers.flatMap(layer => layer.patches)
    const ctx = await boot(NAME, join(rootDir, 'cordis.yml'), compose())
    // A fake HMR seam that registers but never delivers events: only the stat
    // backstop can observe writes, exactly the real-world dropped-event shape
    // (package-manager churn under FSEvents queue pressure).
    ctx.provide('hmr', { registerConfig: () => Promise.resolve(async () => {}) })
    const warned = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    let throwMode: 'string' | 'error' | undefined
    const guardedCompose = (): PatchOptions[] => {
      if (throwMode === 'string') throw 'torn-string'
      if (throwMode === 'error') throw new Error('torn-error')
      return compose()
    }
    const dispose = await watchProfileManifest(ctx, {
      binName: NAME,
      filename: manifestPath,
      compose: guardedCompose,
      pollMs: 20,
    })
    const writeBundles = (bundles: string[]): void => {
      writeFileSync(manifestPath, JSON.stringify({ name: 'dsh-profile-demo', dsh: { profile: { bundles } } }))
    }
    try {
      // The backstop alone mounts a live install.
      stageBundle(profileDir, 'bundle-b', 'row-b', 'b.mjs')
      stageRootModule(rootDir, 'b.mjs', 'row-b-plugin')
      writeBundles(['bundle-a', 'bundle-b'])
      await eventually(() => hasRow(ctx, 'row-b'), 'stat backstop did not reconcile the missed rewrite')
      expect(hasRow(ctx, 'row-a')).toBe(true)

      // Poll-path failures are contained and normalized, last good tree kept.
      throwMode = 'string'
      writeBundles(['bundle-a', 'bundle-b'])
      await eventually(() => warned.mock.calls.length >= 1, 'string throw on the poll path was not contained')
      throwMode = 'error'
      writeBundles(['bundle-a', 'bundle-b'])
      await eventually(() => warned.mock.calls.length >= 2, 'Error throw on the poll path was not contained')
      expect(hasRow(ctx, 'row-a')).toBe(true)

      // Recovery after failures, then a removed manifest is a quiet no-op tick.
      throwMode = undefined
      writeBundles(['bundle-a'])
      await eventually(() => !hasRow(ctx, 'row-b'), 'recovery generation did not apply')
      unlinkSync(manifestPath)
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(hasRow(ctx, 'row-a')).toBe(true)
    } finally {
      await dispose()
      await ctx.fiber.dispose()
    }
  })

  it('applies a write that lands mid-generation through a coalesced re-run', { timeout: 20_000 }, async () => {
    const { home, profileDir, manifestPath } = stageProfile('demo', ['bundle-a'])
    stageBundle(profileDir, 'bundle-a', 'row-a', 'a.mjs')
    stageBundle(profileDir, 'bundle-b', 'row-b', 'b.mjs')
    const rootDir = tmp()
    writeFileSync(join(rootDir, 'cordis.yml'), '[]\n')
    stageRootModule(rootDir, 'a.mjs', 'row-a-plugin')
    stageRootModule(rootDir, 'b.mjs', 'row-b-plugin')
    const compose = (): PatchOptions[] =>
      reloadProfileLayers(NAME, 'demo', join(profileDir, 'package.json'), home)
        .layers.flatMap(layer => layer.patches)
    const ctx = await boot(NAME, join(rootDir, 'cordis.yml'), compose())
    // The test, not the OS, schedules requests: capture the event callback.
    let onConfig: (() => void) | undefined
    ctx.provide('hmr', {
      registerConfig: (_file: string, callback: () => void) => {
        onConfig = callback
        return Promise.resolve(async () => {})
      },
    })
    // The first generation reads the manifest, then holds mid-flight so the
    // second write lands while it is running; only a coalesced re-run (the
    // poll stays out of the race) can then apply it.
    let releaseFirst: (() => void) | undefined
    let held = false
    const gatedCompose = async (): Promise<PatchOptions[]> => {
      const patches = compose()
      if (releaseFirst === undefined) {
        held = true
        await new Promise<void>((resolve) => { releaseFirst = resolve })
      }
      return patches
    }
    const dispose = await watchProfileManifest(ctx, {
      binName: NAME,
      filename: manifestPath,
      compose: gatedCompose,
      pollMs: 60_000,
    })
    const writeBundles = (bundles: string[]): void => {
      writeFileSync(manifestPath, JSON.stringify({ name: 'dsh-profile-demo', dsh: { profile: { bundles } } }))
    }
    try {
      writeBundles(['bundle-a'])
      onConfig?.()
      await eventually(() => held, 'first generation did not reach the gate')
      writeBundles(['bundle-a', 'bundle-b'])
      onConfig?.()
      releaseFirst?.()
      await eventually(() => hasRow(ctx, 'row-b'), 'mid-generation write was lost: no coalesced re-run applied it')
      expect(hasRow(ctx, 'row-a')).toBe(true)
    } finally {
      await dispose()
      await ctx.fiber.dispose()
    }
  })
})
