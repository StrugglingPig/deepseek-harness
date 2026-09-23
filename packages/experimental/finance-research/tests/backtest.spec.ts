import { describe, expect, it } from 'vitest'
import {
  NO_BACKTEST, summarizeBacktest, validationLabel, type BacktestObservation, type ValuationValidation,
} from '../src/backtest.ts'

/** A passing backtest: the model lands on the outcome while the control misses by 20% either way. */
function passingObservations(count: number): readonly BacktestObservation[] {
  return Array.from({ length: count }, (_unused, index) => {
    const exitPrice = 100
    const direction = index % 2 === 0 ? 1 : -1
    return {
      valuePerShare: exitPrice,
      entryPrice: exitPrice * (1 + direction * 0.2),
      exitPrice,
    }
  })
}

/** A validation record around one summary. */
function record(summary: ValuationValidation['summary']): ValuationValidation {
  return { asOf: '2026-09-23', symbols: 8, horizonMonths: 12, summary }
}

describe('backtest scoring', () => {
  it('scores the model against the unchanged-price control', () => {
    const observations: readonly BacktestObservation[] = [
      // The model is 5% under while the control is 25% under.
      { valuePerShare: 95, entryPrice: 75, exitPrice: 100 },
      // The model is 10% over while the control is 10% under, so the control wins this one.
      { valuePerShare: 110, entryPrice: 90, exitPrice: 100 },
    ]
    const summary = summarizeBacktest(observations, 12)
    expect(summary).toMatchObject({
      samples: 2,
      horizonMonths: 12,
      modelMaePercent: 7.5,
      controlMaePercent: 17.5,
      modelHitRate: 0.5,
      modelBiasPercent: 2.5,
    })
    // The model's squared errors are smaller, so the loss differential averages below zero.
    expect(summary?.dmStatistic).toBeLessThan(0)
  })

  it('reports nothing when no observation was scored', () => {
    expect(summarizeBacktest([], 12)).toBeUndefined()
  })

  it('widens the variance for overlapping horizons', () => {
    // The loss differential runs in blocks, so overlapping horizons share a positive covariance.
    const observations: readonly BacktestObservation[] = Array.from({ length: 24 }, (_unused, index) =>
      Math.floor(index / 6) % 2 === 0
        ? { valuePerShare: 100, entryPrice: 104, exitPrice: 100 }
        : { valuePerShare: 103.74, entryPrice: 100, exitPrice: 100 })
    const overlapping = summarizeBacktest(observations, 12, 12)
    const independent = summarizeBacktest(observations, 12, 1)
    // Adding the shared-horizon covariance widens the variance, so the statistic moves toward zero.
    expect(overlapping?.dmStatistic).toBeLessThan(0)
    expect(Math.abs(overlapping?.dmStatistic as number)).toBeLessThan(Math.abs(independent?.dmStatistic as number))
    // A single sample cannot carry an autocovariance term, so the lag is bounded by the sample size.
    expect(summarizeBacktest(observations.slice(0, 1), 12, 12)?.samples).toBe(1)
  })

  it('reads a larger loss differential as stronger evidence', () => {
    const strong = summarizeBacktest(passingObservations(60), 12)
    const weak = summarizeBacktest(
      Array.from({ length: 60 }, () => ({ valuePerShare: 99, entryPrice: 101, exitPrice: 100 })),
      12,
    )
    expect(strong?.dmStatistic).toBeLessThan(weak?.dmStatistic as number)
    expect(strong?.dmPValue).toBeLessThan(weak?.dmPValue as number)
    // A model that is exactly as accurate as the control carries no evidence either way.
    const tied = summarizeBacktest(
      Array.from({ length: 60 }, () => ({ valuePerShare: 105, entryPrice: 105, exitPrice: 100 })),
      12,
    )
    expect(tied?.dmStatistic).toBe(0)
    expect(tied?.dmPValue).toBeCloseTo(1, 6)
  })
})

describe('validation label', () => {
  it('stays a model reference value until a passing backtest is recorded', () => {
    expect(validationLabel(NO_BACKTEST)).toBe('reference')
    const strong = summarizeBacktest(passingObservations(60), 12)
    expect(validationLabel(record(strong as ValuationValidation['summary']))).toBe('target')
    // The sample floor alone blocks a result that would otherwise pass.
    const thin = summarizeBacktest(passingObservations(10), 12)
    expect(validationLabel(record(thin as ValuationValidation['summary']))).toBe('reference')
  })

  it('stays a model reference value when the model does not beat the control', () => {
    const worse = summarizeBacktest(
      Array.from({ length: 60 }, (_unused, index) => ({
        valuePerShare: index % 2 === 0 ? 80 : 120, entryPrice: 100, exitPrice: 100,
      })),
      12,
    )
    expect(validationLabel(record(worse as ValuationValidation['summary']))).toBe('reference')
  })

  it('stays a model reference value when the accuracy difference is noise', () => {
    // The model wins a little on average, but the losses swing widely enough that the difference
    // between the two forecasts is not distinguishable from noise.
    const noisy = summarizeBacktest(
      Array.from({ length: 60 }, (_unused, index) => ({
        valuePerShare: index % 2 === 0 ? 100 : 102.9,
        entryPrice: index % 2 === 0 ? 103 : 100.4,
        exitPrice: 100,
      })),
      12,
    )
    expect(noisy?.modelMaePercent).toBeLessThan(noisy?.controlMaePercent as number)
    expect(noisy?.dmPValue).toBeGreaterThan(0.05)
    expect(validationLabel(record(noisy as ValuationValidation['summary']))).toBe('reference')
  })
})
