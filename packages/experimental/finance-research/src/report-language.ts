/** Report language selection for finance research output. */

/** Report languages shipped by the finance research report writer. */
export const REPORT_LANGUAGES = ['en', 'zh'] as const

/** One shipped report language. */
export type ReportLanguage = typeof REPORT_LANGUAGES[number]

/** Reduce one locale tag to its shipped report language. */
function match(tag: string | undefined): ReportLanguage | undefined {
  if (tag === undefined) return undefined
  const primary = tag.trim().toLowerCase().split(/[-_.]/u)[0]
  if (primary === undefined || primary.length === 0) return undefined
  if (primary === 'zh') return 'zh'
  return primary === 'en' ? 'en' : undefined
}

/**
 * Resolve the report language from an explicit tag, then the host system locale.
 * @param explicit - Locale tag chosen by the user or passed by a caller.
 * @param system - Host system locale tag, usually from {@link systemReportLanguageTag}.
 * @returns The shipped report language, falling back to English.
 */
export function resolveReportLanguage(explicit?: string, system?: string): ReportLanguage {
  return match(explicit) ?? match(system) ?? 'en'
}

/** Locale environment variables consulted before the ICU default. */
const LANGUAGE_ENVIRONMENT_KEYS = ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const

/** One environment value names a language rather than the C or POSIX locale. */
function environmentTag(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const tag = value.split('.')[0]?.trim()
  if (tag === undefined || tag.length === 0) return undefined
  const primary = tag.toLowerCase()
  return primary === 'c' || primary === 'posix' ? undefined : tag
}

/**
 * Read the host system locale.
 * @returns The first usable POSIX locale, then the ICU default, or undefined when neither is available.
 */
export function systemReportLanguageTag(): string | undefined {
  for (const key of LANGUAGE_ENVIRONMENT_KEYS) {
    const tag = environmentTag(process.env[key])
    if (tag !== undefined) return tag
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}
