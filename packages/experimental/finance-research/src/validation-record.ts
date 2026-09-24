/**
 * Recorded out-of-sample evidence for the valuation model.
 *
 * The backtest runner writes this file, and the report reads it before it decides which words its
 * value may carry. A checkout whose backtest has never run carries the no-evidence record, which
 * reads as zero samples: the report then keeps calling its output a model reference value.
 */

import type { ValuationValidation } from './backtest.ts'

/** Latest recorded backtest; the no-evidence record until one has run. */
export const VALUATION_VALIDATION: ValuationValidation = {
  'asOf': '2026-09-24',
  'symbols': 12,
  'horizonMonths': 12,
  'summary': {
    'samples': 63,
    'horizonMonths': 12,
    'modelMaePercent': 58.3524,
    'controlMaePercent': 19.2468,
    'modelHitRate': 0.2063,
    'modelBiasPercent': 3.8116,
    'dmStatistic': 3.5571,
    'dmPValue': 0.000375
  }
}
