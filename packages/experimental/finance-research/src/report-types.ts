/** Report taxonomy: research category crossed with report form. */

/** Research categories owned by the finance report writer. */
export const REPORT_CATEGORIES = [
  'macro', 'industry', 'equity', 'fund', 'fixed-income', 'commodity-fx', 'crypto', 'strategy',
] as const

/** One research category. */
export type ReportCategory = typeof REPORT_CATEGORIES[number]

/** Report forms owned by the finance report writer. */
export const REPORT_FORMS = [
  'flash', 'daily', 'weekly', 'monthly', 'deep-dive', 'thematic', 'event', 'earnings', 'allocation', 'data',
] as const

/** One report form. */
export type ReportForm = typeof REPORT_FORMS[number]

/** Section blocks a report type can compose. */
export const REPORT_SECTION_IDS = [
  'investment-view', 'summary', 'research-question', 'market-snapshot', 'price-action', 'technical-indicators', 'synthesis',
  'methodology-coverage', 'investor-lenses', 'valuation-framework', 'financial-quality', 'earnings-review', 'valuation-range',
  'event-context', 'industry-landscape', 'competitive-position', 'macro-drivers', 'rates-credit',
  'project-and-community', 'ownership-and-insiders',
  'commodity-balance', 'fx-drivers', 'fund-flows', 'onchain-tokenomics', 'allocation', 'scenario-analysis',
  'catalysts', 'monitoring-plan', 'data-requirements', 'strategy-gaps', 'risk-and-limitations',
] as const

/** One report section block. */
export type ReportSectionId = typeof REPORT_SECTION_IDS[number]

/** Composition of one report type. */
export interface ReportTypeDefinition {
  /** Stable id, `<category>-<form>`. */
  readonly id: string
  readonly category: ReportCategory
  readonly form: ReportForm
  /** Ordered section blocks rendered for this type. */
  readonly sections: readonly ReportSectionId[]
}

/** Forms offered per category. */
const CATEGORY_FORMS: Readonly<Record<ReportCategory, readonly ReportForm[]>> = {
  macro: ['daily', 'monthly', 'deep-dive', 'thematic', 'data'],
  industry: ['weekly', 'monthly', 'deep-dive', 'thematic'],
  equity: ['flash', 'deep-dive', 'event', 'earnings'],
  fund: ['weekly', 'monthly', 'deep-dive'],
  'fixed-income': ['daily', 'weekly', 'deep-dive'],
  'commodity-fx': ['daily', 'weekly', 'deep-dive', 'data'],
  crypto: ['flash', 'daily', 'weekly', 'deep-dive', 'data'],
  strategy: ['weekly', 'monthly', 'deep-dive', 'thematic', 'allocation'],
}

/** Category-specific blocks inserted before the form tail. */
const CATEGORY_BLOCKS: Readonly<Record<ReportCategory, readonly ReportSectionId[]>> = {
  macro: ['macro-drivers', 'rates-credit'],
  industry: ['industry-landscape', 'competitive-position'],
  equity: ['industry-landscape', 'valuation-framework', 'valuation-range', 'earnings-review', 'financial-quality', 'competitive-position', 'ownership-and-insiders'],
  fund: ['fund-flows', 'valuation-framework'],
  'fixed-income': ['rates-credit', 'macro-drivers'],
  'commodity-fx': ['commodity-balance', 'fx-drivers'],
  crypto: ['onchain-tokenomics', 'project-and-community', 'fund-flows'],
  strategy: ['allocation', 'industry-landscape'],
}

/**
 * Form-shaped section plans: a head, the category blocks, a body, and a tail.
 * The head opens with the investment view and the macro backdrop, the category
 * blocks carry fundamentals, the body carries the technical read, and the tail
 * carries scenarios and monitoring. `flash` and `daily` stay short, so they omit
 * the macro backdrop and the category blocks.
 */
const FORM_PLANS: Readonly<Record<ReportForm, {
  readonly head: readonly ReportSectionId[]
  readonly body: readonly ReportSectionId[]
  readonly tail: readonly ReportSectionId[]
  readonly categoryBlocks: boolean
}>> = {
  flash: {
    head: ['investment-view', 'summary', 'market-snapshot', 'price-action'],
    body: ['synthesis'],
    tail: ['risk-and-limitations'],
    categoryBlocks: false,
  },
  daily: {
    head: ['investment-view', 'summary', 'market-snapshot', 'price-action'],
    body: ['technical-indicators', 'synthesis'],
    tail: ['monitoring-plan', 'risk-and-limitations'],
    categoryBlocks: false,
  },
  weekly: {
    head: ['investment-view', 'summary', 'research-question', 'macro-drivers', 'market-snapshot', 'price-action'],
    body: ['technical-indicators', 'synthesis', 'methodology-coverage'],
    tail: ['monitoring-plan', 'risk-and-limitations'],
    categoryBlocks: true,
  },
  monthly: {
    head: ['investment-view', 'summary', 'research-question', 'macro-drivers', 'market-snapshot', 'price-action'],
    body: ['technical-indicators', 'synthesis', 'methodology-coverage'],
    tail: ['scenario-analysis', 'monitoring-plan', 'risk-and-limitations'],
    categoryBlocks: true,
  },
  'deep-dive': {
    head: ['investment-view', 'summary', 'research-question', 'macro-drivers', 'market-snapshot', 'price-action'],
    body: ['technical-indicators', 'synthesis', 'methodology-coverage'],
    tail: ['investor-lenses', 'scenario-analysis', 'strategy-gaps', 'risk-and-limitations'],
    categoryBlocks: true,
  },
  thematic: {
    head: ['investment-view', 'summary', 'research-question', 'macro-drivers', 'market-snapshot', 'price-action'],
    body: ['synthesis', 'methodology-coverage'],
    tail: ['scenario-analysis', 'catalysts', 'strategy-gaps', 'risk-and-limitations'],
    categoryBlocks: true,
  },
  event: {
    head: ['investment-view', 'summary', 'macro-drivers', 'market-snapshot', 'price-action'],
    body: ['event-context', 'synthesis'],
    tail: ['catalysts', 'risk-and-limitations'],
    categoryBlocks: true,
  },
  earnings: {
    head: ['investment-view', 'summary', 'macro-drivers', 'market-snapshot', 'price-action'],
    body: ['earnings-review', 'synthesis'],
    tail: ['catalysts', 'risk-and-limitations'],
    categoryBlocks: true,
  },
  allocation: {
    head: ['investment-view', 'summary', 'research-question', 'macro-drivers', 'market-snapshot', 'price-action'],
    body: ['synthesis', 'methodology-coverage'],
    tail: ['allocation', 'scenario-analysis', 'investor-lenses', 'strategy-gaps', 'risk-and-limitations'],
    categoryBlocks: true,
  },
  data: {
    head: ['investment-view', 'summary', 'macro-drivers', 'market-snapshot'],
    body: ['technical-indicators', 'data-requirements'],
    tail: ['monitoring-plan', 'risk-and-limitations'],
    categoryBlocks: false,
  },
}

/** Section plan of one category and form pair. */
function planFor(category: ReportCategory, form: ReportForm): readonly ReportSectionId[] {
  const plan = FORM_PLANS[form]
  const owned = [...plan.head, ...plan.body, ...plan.tail]
  const blocks = plan.categoryBlocks ? CATEGORY_BLOCKS[category].filter(id => !owned.includes(id)) : []
  return [...plan.head, ...blocks, ...plan.body, ...plan.tail]
}

/** Every report type this package can render. */
export const REPORT_TYPES: readonly ReportTypeDefinition[] = REPORT_CATEGORIES.flatMap(category =>
  CATEGORY_FORMS[category].map(form => ({
    id: `${category}-${form}`,
    category,
    form,
    sections: planFor(category, form),
  })))

/**
 * Look one report type up by id.
 * @param id - Report type id such as equity-deep-dive.
 * @returns The matching type, or undefined when the id is unknown.
 */
export function reportTypeById(id: string): ReportTypeDefinition | undefined {
  return REPORT_TYPES.find(type => type.id === id)
}

/** Instrument families the default resolution understands. */
export type ReportAssetClass = 'equity' | 'crypto' | 'prediction'

/**
 * Resolve the default report type for an instrument family.
 * @param assetClass - Instrument family carried by the snapshot.
 * @returns The category deep dive that matches the family.
 */
export function defaultReportType(assetClass: ReportAssetClass): ReportTypeDefinition {
  const category: ReportCategory = assetClass === 'crypto'
    ? 'crypto'
    : assetClass === 'prediction' ? 'strategy' : 'equity'
  return reportTypeById(`${category}-deep-dive`) as ReportTypeDefinition
}
