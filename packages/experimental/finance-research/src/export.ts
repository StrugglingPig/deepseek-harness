/** Durable Markdown and HTML export for finance research reports. */

import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { ResearchReport } from './types.ts'

/** Paths written for one exported report. */
export interface ExportedResearchReport {
  readonly markdown: string
  readonly html: string
}

function safeName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || 'finance-report'
}

/**
 * Write one report as Markdown and self-contained HTML.
 * @param fs - Session filesystem service.
 * @param report - Complete report value.
 * @param outputDir - Directory that owns the generated pair.
 * @param basename - Optional file stem; defaults to the report title.
 * @param signal - Optional cancellation signal.
 * @returns The two display paths.
 */
export async function exportResearchReport(
  fs: FileSystem,
  report: ResearchReport,
  outputDir: string,
  basename?: string,
  signal?: AbortSignal,
): Promise<ExportedResearchReport> {
  const stem = safeName(basename ?? report.title)
  const directory = outputDir.replace(/\/+$/u, '')
  const resolveOptions = signal === undefined ? {} : { signal }
  const markdownTarget = await fs.resolve(`${directory}/${stem}.md`, resolveOptions)
  const htmlTarget = await fs.resolve(`${directory}/${stem}.html`, resolveOptions)
  await fs.writeText(markdownTarget, report.markdown, undefined, signal)
  await fs.writeText(htmlTarget, report.html, undefined, signal)
  return { markdown: markdownTarget.displayPath, html: htmlTarget.displayPath }
}
