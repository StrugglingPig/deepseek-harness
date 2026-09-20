/** The finance bundle must carry one parseable finance-owned layer. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('finance research profile bundle', () => {
  it('declares a public parseable layer with only finance-owned rows', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      private?: boolean
      publishConfig?: { access?: string }
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.private).toBeUndefined()
    expect(manifest.publishConfig?.access).toBe('public')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/dsh-experimental-finance-research': 'workspace:^',
      '@deepseek-ai/dsh-schedule': 'workspace:^',
    })

    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    const patches = parsed as {
      id?: string
      disabled?: boolean
      insert?: { id?: string; name?: string }[]
    }[]
    expect(patches.some(patch => patch.id?.startsWith('tool-subagent'))).toBe(false)
    const inserted = patches.flatMap(patch => patch.insert ?? [])
    expect(inserted).toEqual([
      {
        id: 'finance-research',
        name: '@deepseek-ai/dsh-experimental-finance-research',
      },
      {
        id: 'finance-schedule',
        name: '@deepseek-ai/dsh-schedule',
      },
    ])
  })
})
