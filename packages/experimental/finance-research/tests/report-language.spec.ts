import { describe, expect, it, vi } from 'vitest'
import { REPORT_LANGUAGES, resolveReportLanguage, systemReportLanguageTag } from '../src/report-language.ts'

describe('finance report language', () => {
  it('prefers an explicit shipped tag, then the system tag', () => {
    expect(REPORT_LANGUAGES).toEqual(['en', 'zh'])
    expect(resolveReportLanguage()).toBe('en')
    expect(resolveReportLanguage('en')).toBe('en')
    expect(resolveReportLanguage('en-GB')).toBe('en')
    expect(resolveReportLanguage('zh')).toBe('zh')
    expect(resolveReportLanguage('zh-TW')).toBe('zh')
    expect(resolveReportLanguage('zh_Hans')).toBe('zh')
    expect(resolveReportLanguage('zh_CN.UTF-8')).toBe('zh')
    expect(resolveReportLanguage('fr', 'zh-CN')).toBe('zh')
    expect(resolveReportLanguage('fr', 'de-DE')).toBe('en')
    expect(resolveReportLanguage('   ')).toBe('en')
    expect(resolveReportLanguage('', '')).toBe('en')
  })

  it('reads the POSIX environment before the ICU default', () => {
    vi.stubEnv('LC_ALL', 'zh_CN.UTF-8')
    vi.stubEnv('LC_MESSAGES', '')
    vi.stubEnv('LANG', 'en_US.UTF-8')
    expect(systemReportLanguageTag()).toBe('zh_CN')
    expect(resolveReportLanguage(undefined, systemReportLanguageTag())).toBe('zh')
    vi.stubEnv('LC_ALL', 'C')
    expect(systemReportLanguageTag()).toBe('en_US')
    vi.stubEnv('LC_MESSAGES', 'POSIX')
    vi.stubEnv('LANG', '   ')
    expect(systemReportLanguageTag()).toMatch(/^[a-z]{2}/iu)
    vi.unstubAllEnvs()
  })

  it('tolerates an unavailable Intl', () => {
    vi.stubEnv('LC_ALL', 'C')
    vi.stubEnv('LC_MESSAGES', 'POSIX')
    vi.stubEnv('LANG', '')
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('no intl')
    })
    expect(systemReportLanguageTag()).toBeUndefined()
    spy.mockRestore()
    vi.unstubAllEnvs()
  })
})
