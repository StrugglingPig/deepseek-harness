# @deepseek-ai/dsh-client-hmr

English | [中文](README.zh.md)

Hot reload for script-loaded client plugins. The web bundle mounts the row unconditionally; without a rebuild watcher (`pnpm run dev:web`) rewriting client bundles, the poll observes no changes and the chain stays idle.

The browser half subscribes to the system SSE channel (`GET /plugins/events`) and reloads one plugin per `rebuilt` frame through a serialized queue. The sequence per frame — `invalidate`, `prefetch` (load and register the new bundle while the old fiber still serves), `registry.delete` (before the fiber: a bare fiber dispose trips the vendored Loader's self-dispose branch, which would mark the entry disabled), drain the old fiber, delete `entry.fiber`, remove owned `<style data-plugin>` tags, `entry.refresh()` re-imports and remounts, `fiber.await()` rethrows startup failures loud. Dependents reload through cordis itself: a fiber's activation epoch strings its service providers' uids, so replacing a provider's fiber cascades every dependent with zero client-side graph analysis. The node half detects rebuilds with one interval that stat-polls each graph bundle from a synchronous baseline, immediately re-hashes after adding a row, retains missing rows as dirty, and broadcasts only real rev changes; any tsdown watch process producing the bundle therefore triggers HMR with no builder→host channel.

Entry-set changes — a plugin row appearing or disappearing on the host, for example a market install recomposing the profile bundle layer live — cannot ride that in-place swap, so the node half also subscribes to the client table's `onGraphChanged` and writes a fresh `graph` frame to every connected event client on each change (content-only rebuilds keep riding `rebuilt`). The browser half compares each frame's id set against the page's boot manifest (`window.__DSH_BOOT__`): an identical set cancels any pending reload, a differing set schedules one full page reload after a short debounce, re-checked at fire time and cancelled when a later frame restores the boot set, so the fresh manifest materializes the install or uninstall. A page without a boot manifest never reloads on frames.

## Model Experience

None, as the reload driver is browser-side machinery; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Reload is coarse by design** — a fresh fiber and fresh components; React state inside the reloaded plugin is lost while the data layer (connection/runtime fibers, Session objects) is untouched. react-refresh-grade state preservation conflicts with "re-executing the bundle re-runs the factory" and is deliberately out.
- **No failure rollback** — a reload that fails leaves the entry FAILED and visible in the loader status projection; the previous bundle is not restored automatically.
- **Graph rev is not refreshed by rebuilt frames** — the stale rev is harmless because the bundle endpoint serves no-cache; only reconnect refreshes it.
- **Entry-set changes reload the whole page** — a live install/uninstall loses in-page plugin state exactly like a manual refresh; incremental mount/unmount without reload is a later extension of the same `graph` frame protocol.
