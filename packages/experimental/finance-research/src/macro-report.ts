/** Data-backed macro report: section plan, Markdown composition, and a self-contained HTML view. */

import type { MacroCategory } from './macro-catalog.ts'
import type { MacroSeries } from './macro.ts'
import type { ResearchReport, ResearchReportSection } from './types.ts'

/** Report language for generated copy. */
export type MacroReportLanguage = 'en' | 'zh'

/** One planned section: the categories it reports and whether any series is expected. */
export interface MacroReportPlanEntry {
  readonly id: string
  readonly title: Record<MacroReportLanguage, string>
  readonly categories: readonly MacroCategory[]
}

/** Section plan, in report order. */
export const MACRO_REPORT_PLAN: readonly MacroReportPlanEntry[] = [
  { id: 'growth', title: { en: 'Growth', zh: '增长' }, categories: ['growth'] },
  { id: 'inflation', title: { en: 'Inflation', zh: '通胀' }, categories: ['inflation'] },
  { id: 'employment', title: { en: 'Employment', zh: '就业' }, categories: ['employment'] },
  { id: 'demand', title: { en: 'Consumption And Investment', zh: '消费与投资' }, categories: ['consumption', 'investment'] },
  { id: 'liquidity', title: { en: 'Money And Credit', zh: '货币与信贷' }, categories: ['money-credit', 'policy'] },
  { id: 'fiscal', title: { en: 'Fiscal', zh: '财政' }, categories: ['fiscal'] },
  { id: 'external', title: { en: 'External Sector', zh: '对外部门' }, categories: ['external'] },
  { id: 'transmission', title: { en: 'Market Transmission', zh: '市场传导' }, categories: ['market'] },
]

/** Country labels used by both languages. */
const COUNTRY_LABEL: Readonly<Record<string, Record<MacroReportLanguage, string>>> = {
  cn: { en: 'China', zh: '中国' },
  us: { en: 'United States', zh: '美国' },
  global: { en: 'Global', zh: '全球' },
}

/** Interface the report builder reads from one loaded series. */
export interface MacroReportInput {
  readonly language: MacroReportLanguage
  readonly asOf: string
  readonly series: readonly MacroSeries[]
  /** Indicators the catalog knows but this run could not load, with the upstream reason. */
  readonly failures?: readonly { readonly indicator: string; readonly message: string }[]
}

/**
 * Format one observation value for a report line.
 * @param value - Numeric value.
 * @returns A compact number string.
 */
function number(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString('en-US')
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/**
 * Describe one series as one Markdown bullet in the requested language.
 * @param series - Loaded series.
 * @param language - Report language.
 * @returns The bullet line.
 */
function bullet(series: MacroSeries, language: MacroReportLanguage): string {
  const zh = language === 'zh'
  const name = zh ? series.nameZh : series.name
  const country = COUNTRY_LABEL[series.country]?.[language] ?? series.country
  const timing = zh
    ? { leading: '领先', coincident: '同步', lagging: '滞后' }[series.timing]
    : series.timing
  const projection = series.latest.projection === true ? (zh ? '（预测值）' : ' (projection)') : ''
  const previous = series.previous
  const change = previous === undefined ? undefined : series.latest.value - previous.value
  const head = zh
    ? `- **${country} · ${name}**：${number(series.latest.value)} ${series.unit}（${series.latest.date}，${timing}，来源 ${series.source}）${projection}`
    : `- **${country} · ${name}**: ${number(series.latest.value)} ${series.unit} (${series.latest.date}, ${timing}, source ${series.source})${projection}`
  const tail = change === undefined || change === 0
    ? ''
    : zh
      ? `，较上期${change > 0 ? '上升' : '下降'} ${number(Math.abs(change))} ${series.unit}`
      : `, ${change > 0 ? 'up' : 'down'} ${number(Math.abs(change))} ${series.unit}`
  return `${head}${tail}${zh ? '。' : '.'}`
}

/**
 * Compose the macro report sections.
 * @param input - Loaded series, language, and failures.
 * @returns Report sections in plan order.
 */
export function buildMacroSections(input: MacroReportInput): ResearchReportSection[] {
  const sections: ResearchReportSection[] = []
  const zh = input.language === 'zh'
  const byCategory = (categories: readonly MacroCategory[]): MacroSeries[] =>
    input.series.filter(series => categories.includes(series.category))

  const overview = byCategory(['growth', 'inflation', 'money-credit'])
  sections.push({
    title: zh ? '概览' : 'Overview',
    content: [
      zh
        ? `本报告覆盖中国、美国与全球的宏观序列，共 ${String(input.series.length)} 条，数据截至 ${input.asOf}。`
        : `This report covers Chinese, US, and global macro series: ${String(input.series.length)} indicators as of ${input.asOf}.`,
      ...overview.slice(0, 6).map(series => bullet(series, input.language)),
    ].join('\n'),
  })

  for (const entry of MACRO_REPORT_PLAN) {
    const matched = byCategory(entry.categories)
    sections.push({
      title: entry.title[input.language],
      content: matched.length === 0
        ? (zh ? '本次运行没有取到该组序列。' : 'No series in this group were loaded by this run.')
        : matched.map(series => bullet(series, input.language)).join('\n'),
    })
  }

  const failures = input.failures ?? []
  sections.push({
    title: zh ? '数据覆盖与缺口' : 'Coverage And Gaps',
    content: [
      zh
        ? `成功加载 ${String(input.series.length)} 条序列；未加载 ${String(failures.length)} 条。`
        : `${String(input.series.length)} series loaded; ${String(failures.length)} not loaded.`,
      ...failures.map(failure => `- ${failure.indicator}: ${failure.message}`),
      zh
        ? '- 观测值保持上游原始口径，季度与年度序列未做重采样；预测值以“（预测值）”标注。'
        : '- Observations stay upstream-as-published; quarterly and annual series are not resampled, and projections are labelled.',
    ].join('\n'),
  })
  return sections
}

/** Turn Markdown emphasis into HTML after escaping, so bullets keep their bold labels. */
function emphasis(value: string): string {
  return value.replace(/\*\*(.+?)\*\*/gu, '<strong>$1</strong>')
}

/**
 * Render the macro report as self-contained HTML.
 * @param title - Report title.
 * @param asOf - Data timestamp.
 * @param sections - Composed sections.
 * @returns A standalone HTML document.
 */
export function macroReportHtml(
  title: string,
  asOf: string,
  sections: readonly ResearchReportSection[],
): string {
  const escape = (value: string): string => value.replace(/[&<>"]/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  })[character] as string)
  const body = sections.map(section => [
    `<section><h2>${escape(section.title)}</h2>`,
    `<ul>${section.content.split('\n').filter(Boolean).map(line => `<li>${emphasis(escape(line.replace(/^- /u, '')))}</li>`).join('')}</ul>`,
    '</section>',
  ].join('')).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem auto;max-width:960px;line-height:1.6;color:#111827}h1{font-size:1.6rem}h2{font-size:1.1rem;margin-top:1.6rem;border-bottom:1px solid #e5e7eb;padding-bottom:.3rem}li{margin:.25rem 0}.meta{color:#6b7280;font-size:.85rem}</style>
</head><body><h1>${escape(title)}</h1><p class="meta">as of ${escape(asOf)}</p>${body}</body></html>`
}

/**
 * Build one macro report from loaded series.
 * @param input - Loaded series, language, and failures.
 * @param title - Optional report title override.
 * @returns The report value consumed by the tools.
 */
export function buildMacroReport(input: MacroReportInput, title?: string): ResearchReport {
  const defaultTitle = input.language === 'zh'
    ? `中美与全球宏观经济报告（${input.asOf.slice(0, 10)}）`
    : `China, US, and Global Macro Report (${input.asOf.slice(0, 10)})`
  const resolvedTitle = title ?? defaultTitle
  const sections = buildMacroSections(input)
  const markdown = [`# ${resolvedTitle}`, '', ...sections.map(section => `## ${section.title}\n\n${section.content}\n`)].join('\n')
  return {
    symbol: 'MACRO:CN-US-GLOBAL',
    asOf: input.asOf,
    title: resolvedTitle,
    markdown,
    html: macroReportHtml(resolvedTitle, input.asOf, sections),
    reportType: 'macro-deep-dive',
    sections,
    evidence: input.series.map(series => ({
      source: series.source,
      asOf: series.latest.date,
      url: '',
    })),
  }
}
