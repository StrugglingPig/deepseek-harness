/** The finance example must stay Team-aware and parse as a preset composition. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const root = resolve(import.meta.dirname, '..')
const example = resolve(root, 'config/examples/finance-research')

describe('finance research preset example', () => {
  it('parses and omits legacy subagent rows', () => {
    const parsed = yaml.load(
      readFileSync(resolve(example, 'agent.cordis.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    const rows = parsed as { id?: string; name?: string; group?: boolean; config?: unknown }[]
    const ids = rows.flatMap(row =>
      row.group === true && Array.isArray(row.config)
        ? (row.config as { id?: string }[]).map(child => child.id)
        : [row.id],
    )
    expect(ids).not.toContain('tool-subagent')
    expect(ids).not.toContain('tool-subagent-fork')
    expect(ids).not.toContain('tool-subagent-control')
    expect(ids).not.toContain('tool-subagent-list-agents')
    expect(ids).toContain('tool-workflow')
    expect(ids).toContain('tool-web')
    expect(ids).toContain('present')
  })

  it('ships a live-provider patch that selects the HTTP provider', () => {
    const parsed = yaml.load(
      readFileSync(resolve(example, 'live.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    expect(parsed).toEqual([{
      id: 'finance-research',
      config: { provider: 'http' },
    }])
  })

  it('ships the finance research skill', () => {
    const skill = readFileSync(
      resolve(example, 'skills/finance-research/SKILL.md'),
      'utf8',
    )
    expect(skill).toContain('finance_market_snapshot')
    expect(skill).toContain('finance_technical_analysis')
    expect(skill).toContain('finance_research_report')
    expect(skill).toContain('Never calculate RSI')
  })
})
