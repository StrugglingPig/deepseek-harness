import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, PANEL_ID } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

async function bench(initialServed: boolean) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  let served = initialServed
  const listeners = new Set<() => void>()
  const ensure = vi.fn(async () => undefined)
  const describeSettings = {
    getSnapshot: () => ({
      view: served
        ? { writable: true, hasDocument: true, namespaces: [{ ns: 'finance-research', schema: {}, value: {}, applies: 'live', secrets: [], revision: 1 }] }
        : undefined,
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    ensure,
  }
  const scope = { getSnapshot: () => ({ value: {} }), subscribe: vi.fn(() => () => {}) }
  ctx.provide('settingsScope', {
    describe: () => describeSettings,
    bind: () => scope,
  } as never)
  return {
    ctx,
    slots: ctx.get('slots') as SlotRegistry,
    ensure,
    setServed: (value: boolean) => { served = value; for (const listener of listeners) listener() },
  }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      main: { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('finance dashboard browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the browser services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'settingsScope'])
  })

  it('registers the dashboard only while the finance namespace is served', async () => {
    const { ctx, slots, ensure, setServed } = await bench(true)
    declare(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(slots.entries('main')).toHaveLength(1) })
    const main = slots.entries('main')[0]!
    const sidebar = slots.entries('sidebar.panellist')[0]!
    expect(main.options).toMatchObject({ key: PANEL_ID })
    expect(sidebar.options).toMatchObject({ id: PANEL_ID })
    expect(resolveSlotLabel(sidebar.options.label)).toBe('Finance dashboard')
    const face = (main.inject as unknown as () => ReturnType<typeof import('../src/client/controller.ts').FinanceDashboardController.prototype.inject>)()
    face.ensure()
    expect(ensure).toHaveBeenCalled()
    ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(ensure).toHaveBeenCalledTimes(2) })
    setServed(false)
    expect(slots.entries('main')).toHaveLength(0)
    expect(slots.entries('sidebar.panellist')).toHaveLength(0)
    await fiber.dispose()
  })

  it('does not register when finance settings are absent', async () => {
    const { ctx, slots } = await bench(false)
    declare(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await Promise.resolve()
    expect(slots.entries('main')).toHaveLength(0)
    await fiber.dispose()
  })
})
