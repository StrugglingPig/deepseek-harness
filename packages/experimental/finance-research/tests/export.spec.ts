import { describe, expect, it, vi } from 'vitest'
import { exportResearchReport } from '../src/export.ts'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { ResearchReport } from '../src/types.ts'

function report(title = 'Test report'): ResearchReport {
  return {
    symbol: 'TEST',
    asOf: '2026-09-20T00:00:00.000Z',
    title,
    markdown: '# Test report\n',
    html: '<!doctype html><title>Test report</title>',
    sections: [],
    evidence: [],
  }
}

function bench() {
  const writes = new Map<string, string>()
  const resolve = vi.fn(async (path: string) => ({ targetKey: path, displayPath: path }) as unknown as FsTarget)
  const writeText = vi.fn(async (target: FsTarget, content: string) => {
    writes.set(target.displayPath, content)
    return { operation: 'create', version: 'v', after: content }
  })
  const fs = { resolve, writeText } as unknown as FileSystem
  return { fs, resolve, writes }
}

describe('finance report export', () => {
  it('writes Markdown and HTML with a sanitized report name', async () => {
    const { fs, writes } = bench()
    const result = await exportResearchReport(fs, report('Bad / name'), 'reports/')
    expect(result).toEqual({ markdown: 'reports/Bad-name.md', html: 'reports/Bad-name.html' })
    expect(writes.get(result.markdown)).toBe('# Test report\n')
    expect(writes.get(result.html)).toContain('<title>Test report</title>')
  })

  it('falls back to a safe stem and forwards cancellation', async () => {
    const { fs, resolve } = bench()
    const signal = new AbortController().signal
    const result = await exportResearchReport(fs, report('***'), 'reports', undefined, signal)
    expect(result.markdown).toBe('reports/finance-report.md')
    expect(resolve).toHaveBeenCalledWith('reports/finance-report.md', { signal })
  })
})
