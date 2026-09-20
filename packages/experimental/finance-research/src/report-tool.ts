/** Shared parameters, output schema, and value mapping for the report tools. */

import type { ExportedResearchReport } from './export.ts'
import type { ResearchReport, ResearchReportRequest } from './types.ts'

/** Arguments every report tool accepts besides its symbol. */
export interface ReportToolArguments {
  readonly symbol: string
  readonly question?: string
  readonly horizon?: string
  readonly report_type?: string
}

/** Request fields shared by the normalized and stock report tools. */
export const REPORT_REQUEST_PARAMETERS = {
  question: { type: 'string', description: 'Research question to include in the report.' },
  horizon: { type: 'string', description: 'Requested research horizon.' },
  report_type: { type: 'string', description: 'Report type id from finance_report_types, such as equity-deep-dive; defaults to the instrument family deep dive.' },
} as const

/** Section array every report tool returns. */
export const REPORT_SECTIONS_PROPERTY = {
  type: 'array',
  required: true,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', required: true },
      content: { type: 'string', required: true },
    },
  },
} as const

/** Evidence array every report tool returns. */
export const REPORT_EVIDENCE_PROPERTY = {
  type: 'array',
  required: true,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      source: { type: 'string', required: true },
      as_of: { type: 'string', required: true },
      url: { type: 'string', required: true },
    },
  },
} as const

/** Report fields shared by the report and export tools. */
export const REPORT_SUMMARY_PROPERTIES = {
  title: { type: 'string', required: true },
  report_type: { type: 'string', required: true },
} as const

/**
 * Build the report request shared by every report tool.
 * @param args - Tool arguments carrying the symbol and optional report fields.
 * @returns The report request for the provider.
 */
export function reportRequest(args: ReportToolArguments): ResearchReportRequest {
  return {
    symbol: args.symbol,
    ...args.question === undefined ? {} : { question: args.question },
    ...args.horizon === undefined ? {} : { horizon: args.horizon },
    ...args.report_type === undefined ? {} : { reportType: args.report_type },
  }
}

/** Normalized report tool result. */
export interface ReportToolValue {
  readonly symbol: string
  readonly as_of: string
  readonly title: string
  readonly report_type: string
  readonly markdown: string
  readonly html: string
  readonly sections: { readonly title: string; readonly content: string }[]
  readonly evidence: { readonly source: string; readonly as_of: string; readonly url: string }[]
}

/** Exported report tool result. */
export interface ReportExportToolValue {
  readonly symbol: string
  readonly as_of: string
  readonly title: string
  readonly report_type: string
  readonly markdown_path: string
  readonly html_path: string
}

/**
 * Render one report as the normalized tool result.
 * @param report - Built report.
 * @returns The tool result value.
 */
export function reportValue(report: ResearchReport): ReportToolValue {
  return {
    symbol: report.symbol,
    as_of: report.asOf,
    title: report.title,
    report_type: report.reportType,
    markdown: report.markdown,
    html: report.html,
    sections: report.sections.map(section => ({ title: section.title, content: section.content })),
    evidence: report.evidence.map(item => ({
      source: item.source,
      as_of: item.asOf,
      url: item.url,
    })),
  }
}

/**
 * Render one exported report pair as the normalized tool result.
 * @param report - Built report.
 * @param files - Written report paths.
 * @returns The tool result value.
 */
export function reportExportValue(report: ResearchReport, files: ExportedResearchReport): ReportExportToolValue {
  return {
    symbol: report.symbol,
    as_of: report.asOf,
    title: report.title,
    report_type: report.reportType,
    markdown_path: files.markdown,
    html_path: files.html,
  }
}
