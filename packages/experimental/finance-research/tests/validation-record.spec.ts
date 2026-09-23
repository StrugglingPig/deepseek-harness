import { describe, expect, it } from 'vitest'
import { validationLabel } from '../src/backtest.ts'
import { VALUATION_VALIDATION } from '../src/validation-record.ts'

describe('recorded valuation evidence', () => {
  it('carries a summary the label rule reads back to the same wording', () => {
    const { summary } = VALUATION_VALIDATION
    const label = validationLabel(VALUATION_VALIDATION)
    expect(summary.horizonMonths).toBe(VALUATION_VALIDATION.horizonMonths)
    expect(summary.samples).toBeGreaterThanOrEqual(0)
    expect(summary.modelHitRate).toBeGreaterThanOrEqual(0)
    expect(summary.modelHitRate).toBeLessThanOrEqual(1)
    expect(summary.dmPValue).toBeGreaterThanOrEqual(0)
    expect(summary.dmPValue).toBeLessThanOrEqual(1)
    // A target price has to have cleared the sample floor, the error comparison, and the significance test.
    if (label === 'target') {
      expect(summary.samples).toBeGreaterThanOrEqual(50)
      expect(summary.modelMaePercent).toBeLessThan(summary.controlMaePercent)
      expect(summary.dmPValue).toBeLessThan(0.05)
    } else {
      expect(
        summary.samples < 50
        || summary.modelMaePercent >= summary.controlMaePercent
        || summary.dmPValue >= 0.05,
      ).toBe(true)
    }
    // A recorded run names the day it ran and the symbols behind it.
    if (summary.samples > 0) {
      expect(VALUATION_VALIDATION.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
      expect(VALUATION_VALIDATION.symbols).toBeGreaterThan(0)
    }
  })
})
