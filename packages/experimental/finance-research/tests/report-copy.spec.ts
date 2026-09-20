import { describe, expect, it } from 'vitest'
import { fixtureProvider } from '../src/data.ts'
import { buildMethodologyAnalysis } from '../src/methodology.ts'
import { REPORT_COPY, formatCopy } from '../src/report-copy.ts'

describe('finance report copy', () => {
  it('translates every catalog name, category, and data requirement', async () => {
    const snapshot = await fixtureProvider.load('AAPL')
    const { catalog } = buildMethodologyAnalysis(snapshot)
    expect(catalog.length).toBeGreaterThan(0)
    for (const entry of catalog) {
      expect(REPORT_COPY.zh.catalogNames[entry.id]).toBeDefined()
      expect(REPORT_COPY.zh.categories[entry.category]).toBeDefined()
      for (const requirement of entry.dataRequirements) {
        expect(REPORT_COPY.zh.requirements[requirement]).toBeDefined()
      }
    }
  })

  it('keeps reading notes and investor lenses aligned across languages', async () => {
    const snapshot = await fixtureProvider.load('AAPL')
    const methodology = buildMethodologyAnalysis(snapshot)
    expect(Object.keys(REPORT_COPY.zh.notes).sort()).toEqual(Object.keys(REPORT_COPY.en.notes).sort())
    expect(Object.keys(REPORT_COPY.zh.lenses).sort()).toEqual(Object.keys(REPORT_COPY.en.lenses).sort())
    for (const reading of methodology.readings) {
      const key = REPORT_COPY.en.notes[reading.id] === undefined ? 'gap' : reading.id
      expect(REPORT_COPY.zh.notes[key]).toBeDefined()
    }
    for (const investor of methodology.investors) {
      expect(REPORT_COPY.zh.lenses[investor.id]?.questions).toHaveLength(REPORT_COPY.en.lenses[investor.id]?.questions.length ?? 0)
    }
  })

  it('interpolates known placeholders and keeps unknown ones', () => {
    expect(formatCopy('{a}/{b}', { a: 1 })).toBe('1/{b}')
    expect(formatCopy('plain', {})).toBe('plain')
  })
})
