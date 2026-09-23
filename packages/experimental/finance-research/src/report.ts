/** Structured Markdown and interactive HTML reports built from deterministic market analysis. */

import { buildIndicatorAnalysis } from './indicators.ts'
import { buildMethodologyAnalysis, type MethodologyAnalysis } from './methodology.ts'
import { REPORT_COPY, formatCopy, type ReportBlockCopy, type ReportCategoryCopy, type ReportCopy } from './report-copy.ts'
import type { ReportLanguage } from './report-language.ts'
import { REPORT_TYPES, defaultReportType, reportTypeById, type ReportSectionId, type ReportTypeDefinition } from './report-types.ts'
import type { AssetMetric, AssetMetricGroup, ReportMetricKey } from './asset-context.ts'
import type { MacroCategory } from './macro-catalog.ts'
import type { MacroSeries } from './macro.ts'
import { buildEarningsForecast, type EarningsForecast, type EarningsForecastInput } from './forecast.ts'
import { VALUATION_VALIDATION } from './validation-record.ts'
import type { ValuationValidation } from './backtest.ts'
import {
  buildAssumptions, buildValuation, buildValuationInputs, buildValueBands, VALUATION_PARAMETERS,
  type CashFlowValue, type ValuationAnalysis, type ValuationAssumption, type ValuationBand,
  type ValuationParameters, type ValuationScenario,
} from './valuation.ts'
import type {
  FinanceMarketDataProvider,
  IndicatorAnalysis,
  MarketSnapshot,
  ResearchReport,
  ResearchReportRequest,
  ResearchReportSection,
} from './types.ts'

/** Direction, status, category, and signal words resolved through report copy. */
function word(record: Readonly<Record<string, string | undefined>>, value: string): string {
  return record[value] ?? value
}

/** Round a percent-like value for report display. */
function percent(value: number): string {
  return `${value.toFixed(2)}%`
}

/**
 * Round a plain number for report display, with thousands separators.
 * @param value - Value to render.
 * @param digits - Fixed decimal places.
 * @returns The formatted number.
 */
function number(value: number, digits = 2): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/**
 * Abbreviate a large number the way market data is quoted (1.71T, 37.9B).
 * @param value - Value to render.
 * @returns The abbreviated number.
 */
function compact(value: number): string {
  return value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 })
}

interface SectionContext {
  readonly snapshot: MarketSnapshot
  readonly analysis: IndicatorAnalysis
  readonly methodology: MethodologyAnalysis
  readonly request: ResearchReportRequest
  readonly copy: ReportCopy
  readonly category: ReportCategoryCopy
  readonly type: ReportTypeDefinition
  /** Macro series available to this report; absent when the caller loaded none. */
  readonly macro: readonly MacroSeries[]
  /** Latest quoted price, the anchor for the target-price model. */
  readonly price: number
  /** Earnings path the report prints beside the valuation, when its inputs were available. */
  readonly forecast?: EarningsForecast
  /** Model valuation read, when the report loaded instrument metrics. */
  readonly valuation?: ValuationAnalysis
  /** Instrument metrics available to this report; absent when the caller loaded none. */
  readonly metrics: readonly AssetMetric[]
}

/**
 * Render a metric value with the precision its unit implies.
 * @param metric - Metric to render.
 * @returns The formatted value with its unit.
 */
function metricValue(metric: AssetMetric): string {
  if (metric.text !== undefined) return metric.text
  if (metric.unit === '%') return percent(metric.value)
  if (metric.unit === 'CNY') {
    // Per-share amounts read best in full; market-sized amounts do not.
    return Math.abs(metric.value) >= 1_000_000 ? `${compact(metric.value)} CNY` : `${number(metric.value)} CNY`
  }
  if (metric.unit === 'USD') return `${compact(metric.value)} USD`
  if (metric.unit === '') return compact(metric.value)
  return `${number(metric.value)} ${metric.unit}`
}

/**
 * Render the instrument metrics a category block consumes.
 * @param context - Section context carrying the loaded metrics.
 * @param id - Section being rendered.
 * @param groups - Metric dimensions this block reports.
 * @returns The rendered section, or the missing-input block when no metric matched.
 */
function metricBlock(
  context: SectionContext,
  id: ReportSectionId,
  groups: readonly AssetMetricGroup[],
): ResearchReportSection {
  const matched = context.metrics.filter(metric => groups.includes(metric.group))
  if (matched.length === 0) return inputBlock(context, id)
  const copy = context.copy
  return {
    title: copy.sections[sectionKey(id)],
    content: table(
      [copy.columns.name, copy.columns.value, copy.columns.source],
      matched.map(metric => [
        copy.metrics[metric.key],
        `${metricValue(metric)}${metric.asOf === '' ? '' : `（${metric.asOf}）`}`,
        metric.source,
      ]),
    ),
  }
}

/**
 * Render the macro context a category block consumes.
 * @param context - Section context carrying the loaded macro series.
 * @param categories - Macro categories this block reports.
 * @returns The rendered section, or the missing-input block when no series loaded.
 */
function macroBlock(
  context: SectionContext,
  id: ReportSectionId,
  categories: readonly MacroCategory[],
): ResearchReportSection {
  const matched = macroMatches(context, categories)
  if (matched.length === 0) return inputBlock(context, id)
  return {
    title: context.copy.sections[sectionKey(id)],
    content: macroTable(context.copy, matched),
  }
}

/**
 * Render macro series as one table.
 * @param copy - Report copy carrying the localized column labels and words.
 * @param series - Loaded series to render, in catalog order.
 * @returns The table as Markdown source.
 */
function macroTable(copy: ReportCopy, series: readonly MacroSeries[]): string {
  return table(
    [
      copy.columns.region, copy.columns.name, copy.columns.value,
      copy.columns.date, copy.columns.timing, copy.columns.source,
    ],
    series.map(entry => macroRow(entry, copy)),
  )
}

/**
 * Select the loaded macro series a section consumes.
 * @param context - Section context carrying the loaded series.
 * @param categories - Macro dimensions the section reports.
 * @returns The matching series, in catalog order.
 */
function macroMatches(context: SectionContext, categories: readonly MacroCategory[]): readonly MacroSeries[] {
  return context.macro.filter(series => categories.includes(series.category))
}

/**
 * Render one macro series as a table row in the report's language.
 * @param series - Loaded series with its latest observation.
 * @param copy - Report copy carrying the localized name, unit, and cycle-timing words.
 * @returns The row cells.
 */
function macroRow(series: MacroSeries, copy: ReportCopy): readonly string[] {
  const name = copy.locale === 'zh' ? series.nameZh : series.name
  const unit = copy.units[series.unit] ?? series.unit
  const timing = copy.timings[series.timing] ?? series.timing
  const projection = series.latest.projection === true ? ` ${copy.labels.projection}` : ''
  return [
    series.country.toUpperCase(),
    name,
    `${number(series.latest.value)} ${unit}`,
    `${series.latest.date}${projection}`,
    timing,
    series.source,
  ]
}

/**
 * Read one metric value by key out of the section context.
 * @param context - Section context carrying the loaded metrics.
 * @param key - Metric key to read.
 * @returns The value, or undefined when the snapshot did not publish it.
 */
function metricValueOf(metrics: readonly AssetMetric[], key: ReportMetricKey): number | undefined {
  return metrics.find(metric => metric.key === key && metric.subject === undefined)?.value
}

/**
 * Derive the earnings path inputs from the loaded metrics.
 * @param metrics - Loaded instrument metrics.
 * @param parameters - Resolved valuation parameters; the path converges to the configured terminal rate.
 * @param fromYear - Calendar year the first projection covers.
 * @returns The model inputs, or undefined when a required input is missing.
 */
function forecastInputs(
  metrics: readonly AssetMetric[],
  parameters: ValuationParameters,
  fromYear: number,
): EarningsForecastInput | undefined {
  const eps = metricValueOf(metrics, 'epsTtm') ?? metricValueOf(metrics, 'eps')
  const revenueGrowth = metricValueOf(metrics, 'revenueGrowth')
  if (eps === undefined || revenueGrowth === undefined) return undefined
  return {
    eps,
    revenueGrowth,
    terminalGrowthPercent: parameters.terminalGrowthPercent,
    ...metricValueOf(metrics, 'revenue') === undefined ? {} : { revenue: metricValueOf(metrics, 'revenue') as number },
    ...metricValueOf(metrics, 'netIncome') === undefined ? {} : { netIncome: metricValueOf(metrics, 'netIncome') as number },
    ...metricValueOf(metrics, 'netMargin') === undefined ? {} : { netMargin: metricValueOf(metrics, 'netMargin') as number },
    fromYear,
  }
}

/**
 * Render one assumption value in the unit it is read in.
 * @param row - Assumption row.
 * @param value - Value to render; the row's own value when omitted.
 * @returns The value with its unit.
 */
function assumptionValue(row: ValuationAssumption, value: number = row.value): string {
  if (row.unit === 'percent') return percent(value)
  return number(value, 2).replace(/\.00$/u, '')
}

/** One value rendered as money in the report's instrument currency. */
function money(amount: number, currency: string): string {
  return `${number(amount, 2)} ${currency}`
}

/**
 * Render the model reference range one valuation produced.
 * @param copy - Report copy carrying the range template.
 * @param valuation - Valuation read.
 * @returns The range text, or undefined when no scenario produced a value.
 */
function valuationRangeText(copy: ReportCopy, valuation: ValuationAnalysis): string | undefined {
  const { lowValuePerShare, highValuePerShare } = valuation.value ?? {}
  if (lowValuePerShare === undefined || highValuePerShare === undefined) return undefined
  return formatCopy(copy.valuation.templates.range, {
    low: number(lowValuePerShare, 2),
    high: number(highValuePerShare, 2),
  })
}

/** Width of one text bar in the Markdown football field. */
const FIELD_BAR_WIDTH = 20

/**
 * Read the label of one value band.
 * @param copy - Report copy carrying the method names.
 * @param id - Band identifier.
 * @returns The locale label.
 */
function bandLabel(copy: ReportCopy, id: ValuationBand['id']): string {
  switch (id) {
    case 'dcf':
      return copy.valuation.methods.dcf
    case 'epv':
      return copy.valuation.methods.epv
    case 'sensitivity':
      return copy.valuation.labels.bandSensitivity
  }
}

/**
 * Read the notice the valuation section prints under its range.
 * @param labels - Valuation labels.
 * @param label - Wording the record allows.
 * @param validation - Recorded backtest evidence, whose sample count says whether one ran.
 * @returns The notice, naming the recorded result when a run exists.
 */
function valuationNotice(
  labels: ReportCopy['valuation']['labels'],
  label: ValuationAnalysis['label'],
  validation: ValuationValidation,
): string {
  const { summary } = validation
  if (summary.samples === 0) return labels.modelNotice
  if (label === 'target') {
    return formatCopy(labels.targetNotice, { samples: String(summary.samples), asOf: validation.asOf })
  }
  return formatCopy(labels.failedNotice, {
    samples: String(summary.samples),
    asOf: validation.asOf,
    modelMae: percent(summary.modelMaePercent),
    controlMae: percent(summary.controlMaePercent),
  })
}

/**
 * Draw one value band as a text bar with the current price marked.
 * @param band - Value band to draw.
 * @param low - Lowest value on the shared scale.
 * @param high - Highest value on the shared scale.
 * @param price - Latest quoted price, marked on the same scale.
 * @returns The bar, using `█` for the band, `│` for the price, and `·` for the rest.
 */
function fieldBar(band: ValuationBand, low: number, high: number, price: number): string {
  const span = Math.max(high - low, Number.EPSILON)
  const indexOf = (amount: number): number =>
    Math.min(FIELD_BAR_WIDTH - 1, Math.max(0, Math.round((amount - low) / span * (FIELD_BAR_WIDTH - 1))))
  const start = indexOf(band.low)
  const end = indexOf(band.high)
  const marker = indexOf(price)
  return Array.from({ length: FIELD_BAR_WIDTH }, (_unused, index) => {
    if (index === marker) return '│'
    if (index >= start && index <= end) return '█'
    return '·'
  }).join('')
}

/**
 * Render the value range across methods as a text football field.
 * @param copy - Report copy carrying the labels.
 * @param value - Scenario values the model produced.
 * @param price - Latest quoted price.
 * @returns The table rows, one per method.
 */
function footballFieldRows(
  copy: ReportCopy,
  value: CashFlowValue,
  price: number,
): readonly (readonly string[])[] {
  const bands = buildValueBands(value)
  const low = Math.min(...bands.map(band => band.low), price)
  const high = Math.max(...bands.map(band => band.high), price)
  return bands.map(band => [
    bandLabel(copy, band.id),
    number(band.low, 2),
    number(band.high, 2),
    fieldBar(band, low, high, price),
  ])
}

/** One sourced figure the tearsheet prints. */
interface TearSheetRow {
  readonly label: string
  readonly value: string
  readonly source: string
  readonly asOf: string
}

/**
 * Build the tearsheet of sourced figures the first screen carries.
 * @param copy - Report copy carrying the metric labels.
 * @param context - Section context carrying the valuation inputs and the snapshot.
 * @returns The rows, in the order the report reads them.
 */
function tearsheetRows(copy: ReportCopy, context: SectionContext): readonly TearSheetRow[] {
  const valuation = context.valuation as ValuationAnalysis
  const inputs = valuation.inputs
  const currency = context.snapshot.instrument.currency
  const metric = (label: string, amount: number | undefined): TearSheetRow | undefined =>
    amount === undefined
      ? undefined
      : { label, value: money(amount, currency), source: 'finnhub', asOf: inputs.reportedPeriod }
  const rows: readonly (TearSheetRow | undefined)[] = [
    {
      label: copy.labels.price,
      value: money(context.price, currency),
      source: context.snapshot.source.provider,
      asOf: context.snapshot.asOf,
    },
    metric(copy.metrics.marketCap, inputs.marketCap),
    metric(copy.metrics.revenue, inputs.revenue),
    metric(copy.metrics.grossProfit, inputs.grossProfit),
    metric(copy.metrics.operatingIncome, inputs.operatingIncome),
    metric(copy.metrics.netIncome, inputs.netIncome),
    metric(copy.metrics.operatingCashFlow, inputs.operatingCashFlow),
    metric(copy.metrics.freeCashFlow, inputs.freeCashFlow),
    metric(copy.metrics.totalAssets, inputs.totalAssets),
    metric(copy.metrics.totalDebt, inputs.totalDebt),
    metric(copy.metrics.cash, inputs.cash),
    inputs.riskFreePercent === undefined ? undefined : {
      label: copy.valuation.costComponents.riskFree,
      value: percent(inputs.riskFreePercent),
      source: inputs.riskFreeSource as string,
      asOf: inputs.riskFreeAsOf as string,
    },
  ]
  return rows.flatMap(row => row === undefined ? [] : [row])
}

/**
 * Render the verdict box the first screen carries: what to do, how sure the model is, and where the
 * price sits inside its reference range.
 * @param context - Section context carrying the valuation read and the technical composite.
 * @returns The table as Markdown source, or no rows when no valuation ran.
 */
function valuationTable(context: SectionContext): readonly string[] {
  const valuation = context.valuation
  if (valuation === undefined) return []
  const copy = context.copy
  const labels = copy.valuation.labels
  const composites = context.analysis.composite
  const range = valuationRangeText(copy, valuation)
  const weighted = valuation.value?.weightedValuePerShare
  const currency = context.snapshot.instrument.currency
  const rangeLabel = valuation.label === 'target' ? labels.targetRange : labels.verdictRange
  return [
    '',
    table(
      [copy.columns.item, copy.columns.value],
      [
        [rangeLabel, range === undefined ? labels.notObtained : `${range} ${currency}`],
        ...weighted === undefined ? [] : [[labels.verdictWeighted, money(weighted, currency)]],
        ...valuation.value === undefined ? [] : [[labels.verdictUpsideRange, `${percent(
          (valuation.value.lowValuePerShare / context.price - 1) * 100)} ~ ${percent(
          (valuation.value.highValuePerShare / context.price - 1) * 100)}`]],
        [labels.verdictAction, copy.valuation.actions[valuation.verdict.action]],
        [labels.credibility, valuation.quality.grade ?? labels.notObtained],
        [labels.verdictTradingDirection, word(copy.directions, composites.direction)],
        [trimLabel(copy.labels.viewConfidence), `${String(composites.confidence)}%`],
      ],
    ),
  ]
}

/**
 * Render the model valuation: the reference range, the methods behind it, and every input it read.
 * @param context - Section context carrying the loaded metrics, macro series, and valuation read.
 * @returns The rendered section, or the input-demanding block when no valuation ran.
 */
function valuationSection(context: SectionContext): ResearchReportSection {
  const copy = context.copy
  const labels = copy.valuation.labels
  const id: ReportSectionId = 'valuation-range'
  const title = copy.sections.valuationRange
  const valuation = context.valuation
  if (valuation === undefined) return inputBlock(context, id)
  const action = copy.valuation.actions[valuation.verdict.action]
  if (valuation.verdict.suppressed) {
    return { title, content: [`**${action}**`, '', `- ${labels.suppressedNotice}`].join('\n') }
  }
  const cost = valuation.cost
  const value = valuation.value
  const notObtained = labels.notObtained
  if (cost === undefined || value === undefined) {
    const missing = valuation.ratios
      .filter(reading => reading.value === undefined)
      .map(reading => copy.valuation.ratios[reading.id])
    return inputBlock(context, id, missing.length === 0 ? [] : [`${labels.missingInputs}${missing.join('; ')}`])
  }
  const currency = context.snapshot.instrument.currency
  // The wording follows the recorded backtest evidence: target price only once it passed.
  const rangeLabel = valuation.label === 'target' ? labels.targetRange : labels.verdictRange
  const notice = valuationNotice(labels, valuation.label, valuation.validation)
  // The model emits every scenario it prices, so each lookup below resolves.
  const scenarioOf = (scenarioId: 'bear' | 'base' | 'bull'): ValuationScenario =>
    value.scenarios.find(entry => entry.id === scenarioId) as ValuationScenario
  const upside = (target: number): string => percent((target / context.price - 1) * 100)
  const scenario = (scenarioId: 'bear' | 'base' | 'bull'): string => money(scenarioOf(scenarioId).valuePerShare, currency)
  const base = scenarioOf('base')
  const impliedGrowth = `${percent(value.impliedGrowthPercent)}${value.impliedGrowthAtBound ? ` ${labels.atBound}` : ''}`
  const modelGrowth = percent(base.startingGrowthPercent)
  const gap = percent(base.startingGrowthPercent - value.impliedGrowthPercent)
  const terminal = formatCopy(copy.valuation.templates.terminal, {
    share: percent(value.terminalValueSharePercent),
    multiple: number(value.impliedExitMultiple, 1),
    ceiling: percent(valuation.parameters.terminalValueCeilingPercent),
  })
  const earningsPath = context.forecast === undefined ? [] : [
    '',
    `**${labels.earningsPathTitle}**`,
    table(
      [copy.columns.year, copy.columns.revenue, copy.columns.revenueGrowth, copy.columns.netIncome, copy.columns.eps],
      context.forecast.years.map(year => [
        String(year.year),
        // The cash-flow model this section prints beside requires the reported revenue, so the path always carries it.
        number(year.revenue as number),
        percent(year.revenueGrowth),
        year.netIncome === undefined ? '—' : number(year.netIncome),
        number(year.eps, 2),
      ]),
    ),
    `- ${formatCopy(copy.templates.forecastBase, { growth: percent(context.forecast.startingGrowth) })}`,
    `- ${formatCopy(copy.templates.forecastFade, {
      terminal: percent(valuation.parameters.terminalGrowthPercent),
      years: String(context.forecast.years.length),
    })}`,
  ]
  return {
    title,
    content: [
      `**${action}** · ${labels.credibility}${valuation.quality.grade ?? notObtained}`,
      '',
      table(
        [copy.columns.item, copy.columns.value],
        [
          [rangeLabel, formatCopy(copy.valuation.templates.range, {
            low: money(value.lowValuePerShare, currency),
            high: money(value.highValuePerShare, currency),
          })],
          [labels.verdictWeighted, money(value.weightedValuePerShare, currency)],
          [labels.verdictUpsideRange, `${upside(value.lowValuePerShare)} ~ ${upside(value.highValuePerShare)}`],
          [labels.verdictPrice, money(context.price, currency)],
          [labels.impliedGrowth, impliedGrowth],
          [labels.modelGrowth, modelGrowth],
          [labels.expectationsGap, gap],
        ],
      ),
      '',
      `**${labels.methodsTitle}**`,
      table(
        [
          copy.columns.method, copy.valuation.scenarios.bear, copy.valuation.scenarios.base,
          copy.valuation.scenarios.bull, copy.columns.note,
        ],
        [
          [
            copy.valuation.methods.dcf, scenario('bear'), scenario('base'), scenario('bull'),
            formatCopy(copy.valuation.templates.noteDcf, {
              explicit: String(valuation.parameters.explicitYears),
              fade: String(valuation.parameters.fadeYears),
              terminal: percent(valuation.parameters.terminalGrowthPercent),
            }),
          ],
          [
            copy.valuation.methods.epv,
            money(value.earningsPowerValuePerShare, currency),
            '', '', copy.valuation.templates.noteEpv,
          ],
          [copy.valuation.methods.reverse, impliedGrowth, '', '', copy.valuation.templates.noteReverse],
        ],
      ),
      '',
      `**${labels.footballField}**`,
      table(
        [copy.columns.method, copy.columns.low, copy.columns.high, copy.columns.range],
        footballFieldRows(copy, value, context.price),
      ),
      '',
      `**${labels.assumptions}**`,
      table(
        [copy.columns.parameter, copy.columns.value, copy.columns.versusDefault],
        buildAssumptions(valuation.parameters).map(row => [
          row.configField,
          assumptionValue(row),
          row.value === row.defaultValue
            ? labels.assumptionDefault
            : formatCopy(labels.assumptionAdjusted, { value: assumptionValue(row, row.defaultValue) }),
        ]),
      ),
      `- ${labels.assumptionNote}`,
      '',
      `**${labels.ratiosTitle}**`,
      table(
        [copy.columns.name, copy.columns.value],
        valuation.ratios.map(reading => [
          copy.valuation.ratios[reading.id],
          reading.value === undefined
            ? notObtained
            : reading.unit === '%' ? percent(reading.value) : number(reading.value, 2),
        ]),
      ),
      '',
      `**${labels.qualityTitle}**`,
      table(
        [copy.columns.signal, copy.columns.value],
        valuation.quality.signals.map(signal => [
          copy.valuation.qualitySignals[signal.id],
          signal.value === undefined
            ? notObtained
            : signal.id === 'accrualsRatio' ? percent(signal.value) : number(signal.value, 2),
        ]),
      ),
      '',
      `**${labels.costTitle}**`,
      table(
        [copy.columns.item, copy.columns.value, copy.columns.source, copy.columns.date],
        cost.components.map(component => [
          copy.valuation.costComponents[component.id],
          component.unit === '%' ? percent(component.value) : number(component.value, 2),
          component.source,
          component.asOf,
        ]),
      ),
      '',
      `**${labels.sensitivityTitle}**`,
      table(
        [copy.valuation.costComponents.wacc, copy.columns.value],
        value.sensitivity.map(entry => [
          percent(entry.waccPercent),
          entry.valuePerShare === undefined ? notObtained : money(entry.valuePerShare, currency),
        ]),
      ),
      '',
      `**${labels.terminalTitle}**`,
      `- ${terminal}`,
      `- ${value.terminalValueCeilingBreached ? labels.terminalBreached : labels.terminalWithin}`,
      '',
      `**${labels.tearsheet}**`,
      table(
        [copy.columns.item, copy.columns.value, copy.columns.source, copy.columns.date],
        tearsheetRows(copy, context).map(row => [row.label, row.value, row.source, row.asOf]),
      ),
      ...earningsPath,
      '',
      `- ${notice}`,
      `- ${labels.shareCountNotice}`,
      ...valuation.quality.grade === undefined ? [`- ${labels.noGradeNotice}`] : [],
    ].join('\n'),
  }
}

/**
 * Render the comparable-company table a competitive-position block carries.
 * @param context - Section context carrying the metrics and copy.
 * @returns The table, or undefined when no peer figures loaded.
 */
function comparableTable(context: SectionContext): ResearchReportSection | undefined {
  const copy = context.copy
  const rows = context.metrics.filter(metric => metric.subject !== undefined)
  if (rows.length === 0) return undefined
  const subjects = [...new Set(rows.map(row => row.subject as string))]
  // Columns follow the order the rows arrive in, so the table mirrors the catalog.
  const keys = [...new Set(rows.map(row => row.key))]
  return {
    title: copy.sections.competitivePosition,
    content: table(
      [copy.columns.company, ...keys.map(key => copy.metrics[key])],
      subjects.map(subject => [
        subject,
        ...keys.map((key) => {
          const match = rows.find(row => row.subject === subject && row.key === key)
          return match === undefined ? '—' : metricValue(match)
        }),
      ]),
    ),
  }
}

/**
 * Add the inputs a partially covered block still lacks.
 * @param context - Section context carrying the report copy.
 * @param id - Section being rendered.
 * @param rendered - Block rendered from the data that did load.
 * @param missing - Inputs no loaded source covers.
 * @returns The rendered block, or the input-demanding block when it carried no data.
 */
function partialBlock(
  context: SectionContext,
  id: ReportSectionId,
  rendered: ResearchReportSection,
  missing: readonly string[],
): ResearchReportSection {
  const copy = context.copy
  if (rendered.content.includes(copy.labels.blockMissing) || missing.length === 0) return rendered
  const block = copy.blocks[id] as ReportBlockCopy
  return {
    title: rendered.title,
    content: [
      rendered.content,
      '',
      `- ${copy.labels.partialMissing}${missing.join(', ')}`,
      ...block.checks.map(item => `- ${item}`),
    ].join('\n'),
  }
}

/** Input-demanding block: inputs the snapshot lacks, plus the questions it would answer. */
function inputBlock(context: SectionContext, id: ReportSectionId, extras: readonly string[] = []): ResearchReportSection {
  const copy = context.copy
  const block = copy.blocks[id] as ReportBlockCopy
  return {
    title: copy.sections[sectionKey(id)],
    content: [
      `- ${copy.labels.blockMissing}`,
      ...extras.map(item => `- ${item}`),
      `- ${copy.labels.requiresInputs}${block.requires.join(', ')}`,
      ...block.checks.map(item => `- ${item}`),
    ].join('\n'),
  }
}

/** Copy keys of the composed section blocks. */
const sectionIdKeys: Record<ReportSectionId, keyof ReportCopy['sections']> = {
  'investment-view': 'investmentView',
  'project-and-community': 'projectAndCommunity',
  'ownership-and-insiders': 'ownershipAndInsiders',
  summary: 'summary',
  'research-question': 'researchQuestion',
  'market-snapshot': 'marketSnapshot',
  'price-action': 'priceAction',
  'technical-indicators': 'technicalIndicators',
  synthesis: 'synthesis',
  'methodology-coverage': 'methodologyCoverage',
  'investor-lenses': 'investorLenses',
  'valuation-framework': 'valuationFramework',
  'valuation-range': 'valuationRange',
  'financial-quality': 'financialQuality',
  'earnings-review': 'earningsReview',
  'event-context': 'eventContext',
  'industry-landscape': 'industryLandscape',
  'competitive-position': 'competitivePosition',
  'macro-drivers': 'macroDrivers',
  'rates-credit': 'ratesCredit',
  'commodity-balance': 'commodityBalance',
  'fx-drivers': 'fxDrivers',
  'fund-flows': 'fundFlows',
  'onchain-tokenomics': 'onchainTokenomics',
  allocation: 'allocation',
  'scenario-analysis': 'scenarioAnalysis',
  catalysts: 'catalysts',
  'monitoring-plan': 'monitoringPlan',
  'data-requirements': 'dataRequirements',
  'strategy-gaps': 'strategyGaps',
  'risk-and-limitations': 'riskAndLimitations',
}

/** Map a section id onto its copy key. */
function sectionKey(id: ReportSectionId): keyof ReportCopy['sections'] {
  return sectionIdKeys[id]
}

/** Monitoring cadence each form implies. */
const FORM_CADENCE: Record<ReportTypeDefinition['form'], string> = {
  flash: 'event-driven, within one session of the trigger',
  daily: 'every trading day',
  weekly: 'weekly, with event-driven updates',
  monthly: 'monthly, with event-driven updates',
  'deep-dive': 'quarterly review plus event-driven updates',
  thematic: 'monthly, with catalyst-driven updates',
  event: 'event-driven, one review after the event settles',
  earnings: 'quarterly, on each reporting date',
  allocation: 'weekly for positioning, monthly for allocation',
  data: 'monthly, on each data release',
}

/** Render one section block from the deterministic inputs available here. */
function renderSection(id: ReportSectionId, context: SectionContext): ResearchReportSection {
  const { snapshot, analysis, methodology, request, copy, category, type } = context
  const direction = (value: string): string => word(copy.directions, value)
  const status = (value: string): string => word(copy.statuses, value)
  const instrumentLabel = snapshot.instrument.name === snapshot.instrument.symbol
    ? snapshot.instrument.symbol
    : `${snapshot.instrument.name} (${snapshot.instrument.symbol})`
  switch (id) {
    case 'investment-view': {
      const composite = analysis.composite
      const strongest = [...analysis.signals].sort((left, right) => right.weight - left.weight).slice(0, 1)
      const stance = composite.direction === 'bullish'
        ? copy.labels.stanceAccumulate
        : composite.direction === 'bearish' ? copy.labels.stanceReduce : copy.labels.stanceWatch
      const gaps = category.requirements
      const invalidation = composite.direction === 'bearish'
        ? formatCopy(copy.templates.invalidation, { level: number(analysis.indicators.sma20) })
        : formatCopy(copy.templates.invalidationInverse, { level: number(analysis.indicators.sma20) })
      return {
        title: copy.sections.investmentView,
        content: [
          `**${stance}**`,
          '',
          `- ${copy.labels.compositeScore}${number(composite.score)} · ${copy.labels.viewConfidence}${String(composite.confidence)}%`,
          ...valuationTable(context),
          '',
          `**${copy.labels.viewReasons}**`,
          `- ${formatCopy(copy.templates.viewBreadth, {
            direction: direction(composite.direction),
            aligned: String(analysis.signals.length - analysis.conflicts.length),
            total: String(analysis.signals.length),
          })}`,
          ...strongest.map(signal => `- ${formatCopy(copy.templates.viewStrongest, {
            name: word(copy.signals, signal.name),
            direction: direction(signal.direction),
            weight: String(signal.weight),
          })}`),
          `- ${formatCopy(copy.templates.viewRisk, {
            atr: percent(analysis.risk.atrPercent),
            risk: copy.labels.riskBars,
          })}`,
          '',
          `**${copy.labels.viewInvalidation}**`,
          `- ${invalidation}`,
          '',
          `**${copy.labels.viewGaps}**`,
          `- ${copy.labels.gapCount}${gaps.join('; ')}`,
          '',
          `- ${copy.labels.notAdvice}`,
        ].join('\n'),
      }
    }
    case 'summary': {
      const aligned = analysis.signals.length - analysis.conflicts.length
      return {
        title: copy.sections.summary,
        content: formatCopy(copy.templates.summary, {
          direction: direction(analysis.composite.direction),
          label: instrumentLabel,
          aligned,
        }),
      }
    }
    case 'research-question': {
      const question = request.question ?? copy.labels.defaultQuestion
      const horizon = request.horizon ?? copy.labels.defaultHorizon
      return {
        title: copy.sections.researchQuestion,
        content: [
          question,
          '',
          `${copy.labels.horizon}${horizon}`,
          `${copy.labels.focus}${category.focus.join('; ')}`,
        ].join('\n'),
      }
    }
    case 'market-snapshot':
      return {
        title: copy.sections.marketSnapshot,
        content: table(
          [copy.columns.item, copy.columns.value],
          [
            [trimLabel(copy.labels.asOf), snapshot.asOf],
            [trimLabel(copy.labels.price), `${number(snapshot.quote.price)} ${snapshot.instrument.currency}`],
            [trimLabel(copy.labels.change), percent(snapshot.quote.changePercent)],
            [trimLabel(copy.labels.bars), String(snapshot.bars.length)],
            [
              trimLabel(copy.labels.source),
              `${snapshot.source.provider}${snapshot.source.synthetic ? copy.labels.syntheticSuffix : ''}`,
            ],
          ],
        ),
      }
    case 'price-action': {
      const window = snapshot.bars.slice(-60)
      const closes = window.map(bar => bar.close)
      const high = Math.max(...window.map(bar => bar.high))
      const low = Math.min(...window.map(bar => bar.low))
      const close = snapshot.quote.price
      const span = high - low
      const position = span === 0 ? 50 : (close - low) / span * 100
      const drawdown = (close - high) / Math.max(high, Number.EPSILON) * 100
      const recent = window.slice(-5)
      const recentVolume = recent.reduce((sum, bar) => sum + bar.volume, 0) / Math.max(1, recent.length)
      const meanVolume = window.reduce((sum, bar) => sum + bar.volume, 0) / Math.max(1, window.length)
      const reference = (window.at(-20) as { close: number }).close
      const twenty = (close - reference) / Math.max(Math.abs(reference), Number.EPSILON) * 100
      return {
        title: copy.sections.priceAction,
        content: table(
          [copy.columns.item, copy.columns.value],
          [
            [trimLabel(copy.labels.returnWindow), percent(twenty)],
            [trimLabel(copy.labels.rangePosition), `${percent(position)} (${number(low)} - ${number(high)})`],
            [trimLabel(copy.labels.drawdown), percent(drawdown)],
            [trimLabel(copy.labels.volumeTrend), `${(recentVolume / Math.max(meanVolume, Number.EPSILON)).toFixed(2)}x`],
            [trimLabel(copy.labels.atrPercent), percent(analysis.risk.atrPercent)],
            [trimLabel(copy.labels.bars), String(closes.length)],
          ],
        ),
      }
    }
    case 'technical-indicators': {
      const values = analysis.indicators
      const stack = values.sma20 > values.sma50 ? 'bullish' : values.sma20 < values.sma50 ? 'bearish' : 'neutral'
      const rsiNote = values.rsi14 >= 70
        ? copy.labels.rsiOverbought
        : values.rsi14 <= 30 ? copy.labels.rsiOversold : copy.labels.rsiNeutral
      return {
        title: copy.sections.technicalIndicators,
        content: table(
          [copy.columns.name, copy.columns.value, copy.columns.direction],
          [
            ['SMA 20 / 50', `${number(values.sma20)} / ${number(values.sma50)}`, direction(stack)],
            ['RSI 14', number(values.rsi14, 1), rsiNote],
            ['MACD', `${number(values.macd, 3)} / ${number(values.macdSignal, 3)} (${number(values.macdHistogram, 3)})`,
              values.macdHistogram >= 0 ? copy.labels.macdBullish : copy.labels.macdBearish],
            ['ATR 14', `${number(values.atr14)} (${percent(analysis.risk.atrPercent)})`, ''],
            ['Bollinger', `${number(values.bollingerLower)} / ${number(values.bollingerMiddle)} / ${number(values.bollingerUpper)}`, ''],
            ['EMA 12 / 26', `${number(values.ema12)} / ${number(values.ema26)}`, ''],
            ['OBV', `${compact(values.obv)} (${copy.labels.obvAverage}${compact(values.obvSma20)})`, ''],
          ],
        ),
      }
    }
    case 'synthesis': {
      const conflicts = analysis.conflicts.length === 0
        ? copy.labels.noConflicts
        : `${copy.labels.conflicts}${analysis.conflicts.map(item => word(copy.signals, item)).join(', ')}.`
      return {
        title: copy.sections.synthesis,
        content: [
          table(
            [copy.columns.signal, copy.columns.direction, copy.columns.weight, copy.columns.value],
            analysis.signals.map(signal => [
              word(copy.signals, signal.name),
              direction(signal.direction),
              String(signal.weight),
              String(signal.value),
            ]),
          ),
          '',
          `${copy.labels.compositeScore}${analysis.composite.score}`,
          `${copy.labels.confidence}${analysis.composite.confidence}%`,
          conflicts,
        ].join('\n'),
      }
    }
    case 'methodology-coverage':
      return {
        title: copy.sections.methodologyCoverage,
        content: table(
          [copy.columns.method, copy.columns.direction, copy.columns.confidence, copy.columns.status, copy.columns.note],
          methodology.readings
            .filter(reading => reading.status !== 'requires-input')
            .map(reading => [
              reading.name,
              direction(reading.direction),
              `${String(reading.confidence)}%`,
              status(reading.status),
              reading.note,
            ]),
        ),
      }
    case 'investor-lenses':
      return {
        title: copy.sections.investorLenses,
        content: methodology.investors.map(investor => [
          formatCopy(copy.templates.investor, {
            name: investor.name,
            school: investor.school,
            stance: direction(investor.stance),
          }),
          ...investor.evidence.map(item => `  - ${item}`),
          formatCopy(copy.templates.investorRisk, { risk: investor.risk }),
        ].join('\n')).join('\n'),
      }
    case 'scenario-analysis': {
      const atr = analysis.indicators.atr14
      const close = snapshot.quote.price
      const bull = close + atr * 2
      const bear = close - atr * 2
      return {
        title: copy.sections.scenarioAnalysis,
        content: table(
          [copy.columns.scenario, copy.columns.price, copy.columns.relative],
          [
            [trimLabel(copy.labels.scenarioBull), number(bull), percent((bull - close) / Math.max(close, Number.EPSILON) * 100)],
            [trimLabel(copy.labels.scenarioBase), number(close), ''],
            [trimLabel(copy.labels.scenarioBear), number(bear), percent((bear - close) / Math.max(close, Number.EPSILON) * 100)],
            [trimLabel(copy.labels.atrPercent), percent(analysis.risk.atrPercent), ''],
          ],
        ),
      }
    }
    case 'allocation': {
      // The ATR budget is computable from the price history; the regime, flow, and
      // valuation inputs the section also needs stay listed as missing.
      const atrPercent = analysis.risk.atrPercent
      const size = Math.min(100, 1 / Math.max(atrPercent, 0.0001) * 100)
      return partialBlock(context, id, {
        title: copy.sections.allocation,
        content: table(
          [copy.columns.item, copy.columns.value],
          [
            [trimLabel(copy.labels.riskBudget), '1%'],
            [trimLabel(copy.labels.atrStop), percent(atrPercent)],
            [trimLabel(copy.labels.positionSize), percent(size)],
          ],
        ),
      }, [copy.labels.missingIndexValuation, copy.labels.missingFundFlows, copy.labels.missingMacroRegime])
    }
    case 'catalysts': {
      // Scheduled dates and headlines are what a catalyst block can act on; the
      // category list stays as the standing watch list.
      const scheduled = metricBlock(context, id, ['catalyst'])
      if (scheduled.content.includes(copy.labels.blockMissing)) return scheduled
      return {
        title: copy.sections.catalysts,
        content: [
          scheduled.content,
          '',
          `**${copy.labels.watchFor}**`,
          ...category.catalysts.map(item => `- ${item}`),
        ].join('\n'),
      }
    }
    case 'ownership-and-insiders':
      return metricBlock(context, id, ['insider'])
    case 'commodity-balance': {
      // Benchmarks price the market; inventories and futures positioning show the balance.
      const benchmarks = macroMatches(context, ['commodity'])
      const inventories = macroMatches(context, ['inventory'])
      const balances = macroMatches(context, ['supply-demand'])
      if (benchmarks.length === 0 && inventories.length === 0 && balances.length === 0) return inputBlock(context, id)
      return partialBlock(context, id, {
        title: copy.sections.commodityBalance,
        content: macroTable(copy, [...benchmarks, ...inventories, ...balances]),
      }, [
        ...inventories.length === 0 ? [copy.labels.missingInventories] : [],
        copy.labels.missingCostCurve,
      ])
    }
    case 'fx-drivers': {
      // The currency legs carry the rate differential, positioning carries the crowd,
      // and the external series carry the balance of payments.
      const positioning = macroMatches(context, ['positioning'])
      const legs = [...macroMatches(context, ['currency']), ...positioning, ...macroMatches(context, ['external'])]
      if (legs.length === 0) return inputBlock(context, id)
      return partialBlock(context, id, {
        title: copy.sections.fxDrivers,
        content: macroTable(copy, legs),
      }, positioning.length === 0 ? [copy.labels.missingPositioning] : [])
    }
    case 'monitoring-plan':
      return {
        title: copy.sections.monitoringPlan,
        content: [
          `- ${copy.labels.monitoringCadence}${FORM_CADENCE[type.form]}`,
          `- ${copy.labels.focus}${category.focus.join('; ')}`,
          `- ${copy.labels.requiresInputs}${category.requirements.join(', ')}`,
        ].join('\n'),
      }
    case 'data-requirements':
      return {
        title: copy.sections.dataRequirements,
        content: [
          `- ${copy.labels.requiresInputs}${category.requirements.join(', ')}`,
          `- ${copy.labels.focus}${category.focus.join('; ')}`,
        ].join('\n'),
      }
    case 'event-context': {
      const latest = snapshot.bars.at(-1) as { readonly close: number; readonly volume: number }
      const previous = snapshot.bars.at(-2) as { readonly close: number }
      const change = (latest.close - previous.close) / Math.max(Math.abs(previous.close), Number.EPSILON) * 100
      const reaction = [
        `${copy.labels.change}${percent(change)}`,
        `${copy.labels.volume}${latest.volume}`,
      ]
      // Published headlines and the newest filing stand in for the event record.
      const published = metricBlock(context, id, ['catalyst'])
      if (published.content.includes(copy.labels.blockMissing)) return inputBlock(context, id, reaction)
      return partialBlock(context, id, {
        title: copy.sections.eventContext,
        content: [published.content, '', ...reaction].join('\n'),
      }, [copy.labels.missingEventRecord])
    }
    case 'strategy-gaps':
      return {
        title: copy.sections.strategyGaps,
        content: methodology.catalog
          .filter(entry => entry.status === 'requires-input' || entry.status === 'not-data-backed')
          .map(entry => formatCopy(copy.templates.gap, {
            name: entry.name,
            category: word(copy.categories, entry.category),
            status: status(entry.status),
            requirements: entry.dataRequirements.map(item => copy.requirements[item] ?? item).join(', '),
          }))
          .join('\n'),
      }
    case 'risk-and-limitations': {
      const sourceLimitation = snapshot.source.synthetic
        ? `- ${copy.labels.fixtureLimitation}`
        : `- ${formatCopy(copy.labels.snapshotLimitation, { provider: snapshot.source.provider })}`
      return {
        title: copy.sections.riskAndLimitations,
        content: [
          `- ${copy.labels.atrPercent}${percent(analysis.risk.atrPercent)}`,
          sourceLimitation,
          `- ${copy.labels.notAdvice}`,
        ].join('\n'),
      }
    }
    case 'valuation-framework':
      return metricBlock(context, id, ['valuation'])
    case 'financial-quality':
      return metricBlock(context, id, ['profitability', 'balance', 'cash'])
    case 'earnings-review':
      return metricBlock(context, id, ['growth'])
    case 'valuation-range':
      return valuationSection(context)
    case 'industry-landscape':
      return metricBlock(context, id, ['industry'])
    case 'competitive-position': {
      const comparables = comparableTable(context)
      return comparables ?? metricBlock(context, id, ['competition'])
    }
    case 'onchain-tokenomics':
      return metricBlock(context, id, ['supply', 'development'])
    case 'project-and-community':
      return metricBlock(context, id, ['development', 'community'])
    case 'fund-flows':
      return metricBlock(context, id, ['market'])
    case 'macro-drivers':
      return macroBlock(context, id, ['growth', 'inflation', 'employment', 'consumption', 'investment', 'money-credit', 'fiscal', 'external', 'policy', 'market'])
    case 'rates-credit':
      return macroBlock(context, id, ['market', 'money-credit', 'policy', 'fiscal'])
  }
}

/**
 * Render the verdict box the first screen carries.
 * @param copy - Report copy carrying the labels and the action words.
 * @param snapshot - Loaded market snapshot.
 * @param analysis - Indicator analysis carrying the trading direction and its confidence.
 * @param valuation - Valuation read, when one ran.
 * @returns The verdict box, or an empty block when no valuation ran.
 */
function verdictBoxHtml(
  copy: ReportCopy,
  snapshot: MarketSnapshot,
  analysis: IndicatorAnalysis,
  valuation: ValuationAnalysis | undefined,
): string {
  if (valuation === undefined) return ''
  const labels = copy.valuation.labels
  const currency = snapshot.instrument.currency
  const range = valuationRangeText(copy, valuation)
  const weighted = valuation.value?.weightedValuePerShare
  const entries: readonly (readonly [string, string])[] = [
    [labels.verdictAction, copy.valuation.actions[valuation.verdict.action]],
    [labels.credibility, valuation.quality.grade ?? labels.notObtained],
    [valuation.label === 'target' ? labels.targetRange : labels.verdictRange,
      range === undefined ? labels.notObtained : `${range} ${currency}`],
    [labels.verdictWeighted, weighted === undefined ? labels.notObtained : money(weighted, currency)],
    [labels.verdictUpsideRange, valuation.value === undefined
      ? labels.notObtained
      : `${percent((valuation.value.lowValuePerShare / snapshot.quote.price - 1) * 100)} ~ ${
        percent((valuation.value.highValuePerShare / snapshot.quote.price - 1) * 100)}`],
    [labels.verdictTradingDirection, word(copy.directions, analysis.composite.direction)],
    [trimLabel(copy.labels.viewConfidence), `${String(analysis.composite.confidence)}%`],
  ]
  return `<section class="verdict"><h2>${escapeHtml(copy.sections.investmentView)}</h2><dl>${
    entries.map(([label, value]) =>
      `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')
  }</dl></section>`
}

/**
 * Render the value range across methods as bars scaled to one axis.
 * @param copy - Report copy carrying the labels.
 * @param snapshot - Loaded market snapshot, whose price is marked on the axis.
 * @param valuation - Valuation read, when one ran.
 * @returns The football field, or an empty block when no valuation ran.
 */
function footballFieldHtml(
  copy: ReportCopy,
  snapshot: MarketSnapshot,
  valuation: ValuationAnalysis | undefined,
): string {
  const value = valuation?.value
  if (value === undefined) return ''
  const bands = buildValueBands(value)
  const price = snapshot.quote.price
  const low = Math.min(...bands.map(band => band.low), price)
  const high = Math.max(...bands.map(band => band.high), price)
  const span = Math.max(high - low, Number.EPSILON)
  const offset = (amount: number): number => (amount - low) / span * 100
  const rows = bands.map((band) => {
    const left = offset(band.low)
    const width = Math.max(offset(band.high) - left, 0.5)
    return `<div class="football-row"><span>${escapeHtml(bandLabel(copy, band.id))}</span>`
      + `<div class="football-track"><div class="football-band" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></div></div>`
      + `<span>${escapeHtml(`${number(band.low, 2)} – ${number(band.high, 2)} ${snapshot.instrument.currency}`)}</span></div>`
  }).join('')
  return `<section class="football"><h3>${escapeHtml(copy.valuation.labels.footballField)}</h3>${rows}`
    + '<div class="football-track">'
    + `<div class="football-price-line" style="left:${offset(price).toFixed(2)}%"></div>`
    + `<span class="football-price-label" style="left:${offset(price).toFixed(2)}%">`
    + `${escapeHtml(`${copy.valuation.labels.verdictPrice} ${number(price, 2)}`)}</span></div></section>`
}

/** Prediction-market facts, rendered between synthesis and the category blocks. */
function predictionSection(snapshot: MarketSnapshot, copy: ReportCopy): ResearchReportSection[] {
  if (snapshot.prediction === undefined) return []
  const prediction = snapshot.prediction
  const spread = prediction.ask - prediction.bid
  return [{
    title: copy.sections.predictionMarket,
    content: [
      `- ${copy.labels.impliedProbability}${(prediction.impliedProbability * 100).toFixed(2)}%`,
      `- ${copy.labels.bidAsk}${prediction.bid} / ${prediction.ask} (${copy.labels.spread}${spread.toFixed(4)})`,
      `- ${copy.labels.volume}${prediction.volume}`,
      `- ${copy.labels.openInterest}${prediction.openInterest}`,
      `- ${copy.labels.resolution}${prediction.resolution}`,
      `- ${copy.labels.rules}${prediction.rules}`,
    ].join('\n'),
  }]
}

/** Compose the ordered sections of one report type. */
function sectionsFor(
  snapshot: MarketSnapshot,
  analysis: IndicatorAnalysis,
  request: ResearchReportRequest,
  language: ReportLanguage,
  type: ReportTypeDefinition,
  macro: readonly MacroSeries[],
  metrics: readonly AssetMetric[],
  forecast: EarningsForecast | undefined,
  valuation: ValuationAnalysis | undefined,
): ResearchReportSection[] {
  const copy = REPORT_COPY[language]
  const context: SectionContext = {
    snapshot,
    analysis,
    methodology: buildMethodologyAnalysis(snapshot, language),
    request,
    copy,
    category: copy.reportCategories[type.category] as ReportCategoryCopy,
    type,
    macro,
    metrics,
    price: snapshot.quote.price,
    ...forecast === undefined ? {} : { forecast },
    ...valuation === undefined ? {} : { valuation },
  }
  const sections = type.sections.map(id => renderSection(id, context))
  const prediction = predictionSection(snapshot, copy)
  if (prediction.length === 0) return sections
  const synthesisIndex = type.sections.indexOf('synthesis')
  return [
    ...sections.slice(0, synthesisIndex + 1),
    ...prediction,
    ...sections.slice(synthesisIndex + 1),
  ]
}

/**
 * Trim the trailing separator a label carries when it prefixes a line.
 * @param label - Locale label such as `Price: ` or `价格：`.
 * @returns The label without its trailing colon and spaces.
 */
function trimLabel(label: string): string {
  return label.replace(/[:：]\s*$/u, '').trim()
}

/**
 * Render one Markdown table.
 * @param headers - Column labels.
 * @param rows - Row cells; a cell's own pipe is escaped so the table keeps its columns.
 * @returns The table as Markdown source lines.
 */
function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]): string =>
    `| ${cells.map(cell => cell.replaceAll('|', '\\|')).join(' | ')} |`
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n')
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] as string)
}

/**
 * Render one line of inline emphasis.
 * @param value - Source text that may carry `**emphasis**`.
 * @returns Escaped HTML with emphasis tags.
 */
function renderInline(value: string): string {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/gu, '<strong>$1</strong>')
}

/** One Markdown table row split into cells. */
function tableCells(line: string): readonly string[] {
  return line.slice(2, -2).split(' | ').map(cell => cell.replaceAll('\\|', '|').trim())
}

/**
 * Render the Markdown subset the report writer emits into HTML blocks.
 * @param content - Section content: pipe tables, bullet lists, and paragraphs.
 * @returns The rendered HTML.
 */
function renderContent(content: string): string {
  const lines = content.split('\n')
  const html: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] as string
    if (line.startsWith('| ')) {
      const rows: (readonly string[])[] = []
      while (index < lines.length && (lines[index] as string).startsWith('| ')) {
        const cells = tableCells(lines[index] as string)
        // The separator row carries no data.
        if (!cells.every(cell => /^-{3,}$/u.test(cell))) rows.push(cells)
        index += 1
      }
      // The writer always emits a header row before its separator.
      const [header, ...body] = rows as [readonly string[], ...readonly (readonly string[])[]]
      const head = header.map(cell => `<th>${renderInline(cell)}</th>`).join('')
      const rest = body
        .map(row => `<tr>${row.map(cell => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
        .join('')
      html.push(`<table><thead><tr>${head}</tr></thead><tbody>${rest}</tbody></table>`)
      continue
    }
    if (line.startsWith('- ') || line.startsWith('  - ')) {
      const items: string[] = []
      while (index < lines.length
        && ((lines[index] as string).startsWith('- ') || (lines[index] as string).startsWith('  - '))) {
        const raw = lines[index] as string
        items.push(raw.startsWith('  - ')
          ? `<li class="nested">${renderInline(raw.slice(4))}</li>`
          : `<li>${renderInline(raw.slice(2))}</li>`)
        index += 1
      }
      html.push(`<ul>${items.join('')}</ul>`)
      continue
    }
    if (line.trim() === '') {
      index += 1
      continue
    }
    html.push(`<p>${renderInline(line)}</p>`)
    index += 1
  }
  return html.join('')
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

function reportHtml(
  title: string,
  snapshot: MarketSnapshot,
  analysis: IndicatorAnalysis,
  sections: readonly ResearchReportSection[],
  copy: ReportCopy,
  type: ReportTypeDefinition,
  valuation?: ValuationAnalysis,
): string {
  const rangeCard = valuation === undefined ? undefined : valuationRangeText(copy, valuation)
  const gradeCard = valuation?.quality.grade
  const verdictBox = verdictBoxHtml(copy, snapshot, analysis, valuation)
  const footballField = footballFieldHtml(copy, snapshot, valuation)
  const data = safeJson({
    symbol: snapshot.instrument.symbol,
    name: snapshot.instrument.name,
    currency: snapshot.instrument.currency,
    asOf: snapshot.asOf,
    source: snapshot.source.provider,
    reportType: type.id,
    bars: snapshot.bars.map(bar => ({
      time: bar.timestamp, close: bar.close, open: bar.open, high: bar.high, low: bar.low, volume: bar.volume,
    })),
  })
  const sectionHtml = sections.map((section, index) => `
    <article class="section" data-section="${String(index)}">
      <h2>${escapeHtml(section.title)}</h2>
      <div class="body">${renderContent(section.content)}</div>
    </article>`).join('')
  const navigation = sections.map((section, index) =>
    `<button type="button" data-target="${String(index)}">${escapeHtml(section.title)}</button>`).join('')
  const meta = formatCopy(copy.templates.htmlMeta, {
    symbol: snapshot.instrument.symbol,
    currency: snapshot.instrument.currency,
    asOf: snapshot.asOf,
    provider: snapshot.source.provider,
  })
  const typeName = `${(copy.reportCategories[type.category] as ReportCategoryCopy).name} ${copy.reportForms[type.form]}`
  const pill = formatCopy(copy.templates.htmlPill, {
    direction: word(copy.directions, analysis.composite.direction),
    confidence: analysis.composite.confidence,
  })
  const ranges = [60, 120].map(count =>
    `<button type="button" data-range="${String(count)}">${escapeHtml(formatCopy(copy.templates.htmlRange, { count }))}</button>`).join('')
  return `<!doctype html>
<html lang="${escapeHtml(copy.htmlLang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f8fafc;--card:#fff;--text:#0f172a;--muted:#64748b;--border:#e2e8f0;--accent:#2563eb;--up:#16a34a;--down:#dc2626}
@media(prefers-color-scheme:dark){:root{--bg:#0f172a;--card:#111827;--text:#e5e7eb;--muted:#94a3b8;--border:#334155}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:28px 18px 60px}.hero{display:flex;justify-content:space-between;gap:20px;align-items:start}.eyebrow{color:var(--accent);font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px}
h1{margin:6px 0;font-size:34px;line-height:1.15}.meta{color:var(--muted)}.pill{border:1px solid var(--border);border-radius:999px;padding:6px 10px;background:var(--card)}
.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}.card{border:1px solid var(--border);border-radius:14px;padding:14px;background:var(--card)}.card.accent{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));background:color-mix(in srgb,var(--accent) 6%,var(--card))}
.card span{display:block;color:var(--muted);font-size:12px}.card strong{display:block;margin-top:5px;font-size:20px}
.chart-card{border:1px solid var(--border);border-radius:16px;padding:12px;background:var(--card);margin:18px 0}.chart-toolbar{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.verdict{border:1px solid color-mix(in srgb,var(--accent) 45%,var(--border));border-radius:16px;padding:14px 16px;background:color-mix(in srgb,var(--accent) 6%,var(--card));margin:18px 0}
.verdict h2{margin:0 0 10px;font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.verdict dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 18px;margin:0}
.verdict dt{color:var(--muted);font-size:12px}.verdict dd{margin:2px 0 0;font-size:16px;font-weight:600}
.football{margin:18px 0}.football h3{margin:0 0 8px;font-size:14px;color:var(--muted)}
.football-row{display:grid;grid-template-columns:150px 1fr 190px;gap:10px;align-items:center;margin:6px 0;font-size:13px}
.football-track{position:relative;height:14px;border-radius:7px;background:color-mix(in srgb,var(--muted) 14%,transparent)}
.football-band{position:absolute;top:0;height:14px;border-radius:7px;background:color-mix(in srgb,var(--accent) 70%,transparent)}
.football-price-line{position:absolute;top:-4px;height:22px;border-left:2px solid var(--accent)}
.football-price-label{position:absolute;top:-19px;transform:translateX(-50%);font-size:11px;color:var(--muted);white-space:nowrap}
button{border:1px solid var(--border);border-radius:8px;padding:7px 10px;background:transparent;color:inherit;cursor:pointer}button:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
canvas{display:block;width:100%;height:340px}.tooltip{position:fixed;pointer-events:none;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none}
.layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:18px;margin-top:20px}.nav{display:flex;flex-direction:column;gap:7px;position:sticky;top:18px;align-self:start}.nav button{text-align:left}
.section{border:1px solid var(--border);border-radius:14px;padding:18px;background:var(--card);margin-bottom:14px}.section h2{margin:0 0 12px;font-size:18px}
.section:first-of-type{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));background:color-mix(in srgb,var(--accent) 7%,var(--card))}
.section .body{font-size:14.5px}.section p{margin:8px 0}.section p:first-child{margin-top:0}
.section ul{margin:8px 0;padding-left:20px}.section li{margin:4px 0}.section li.nested{list-style:circle;color:var(--muted);margin-left:12px}
.section table{width:100%;border-collapse:collapse;margin:4px 0;font-size:14px}
.section th{text-align:left;font-weight:600;font-size:12px;color:var(--muted);padding:7px 10px;border-bottom:1px solid var(--border);text-transform:none;letter-spacing:.02em}
.section td{padding:8px 10px;border-bottom:1px solid color-mix(in srgb,var(--border) 60%,transparent);vertical-align:top}
.section tbody tr:last-child td{border-bottom:0}.section tbody tr:hover td{background:color-mix(in srgb,currentColor 4%,transparent)}
.section td:nth-child(2),.section td:nth-child(3){font-variant-numeric:tabular-nums}
.positive{color:var(--up)}.negative{color:var(--down)}.hidden{display:none}.source{color:var(--muted);font-size:12px}
@media(max-width:820px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.layout{grid-template-columns:1fr}.nav{position:static;flex-direction:row;flex-wrap:wrap}.hero{display:block}}
</style>
</head>
<body data-report-type="${escapeHtml(type.id)}">
<main>
  <div class="hero"><div><div class="eyebrow">${escapeHtml(copy.html.eyebrow)} · ${escapeHtml(typeName)}</div><h1>${escapeHtml(title)}</h1><div class="meta">${escapeHtml(meta)}</div></div><div class="pill">${escapeHtml(pill)}</div></div>
  ${verdictBox}
  ${footballField}
  <div class="cards">
    <div class="card"><span>${escapeHtml(copy.html.cardPrice)}</span><strong>${String(snapshot.quote.price)}</strong></div>
    <div class="card"><span>${escapeHtml(copy.html.cardChange)}</span><strong class="${snapshot.quote.changePercent >= 0 ? 'positive' : 'negative'}">${snapshot.quote.changePercent.toFixed(2)}%</strong></div>
    ${rangeCard === undefined ? '' : `<div class="card accent"><span>${escapeHtml(copy.html.cardRange)}</span><strong>${escapeHtml(rangeCard)}</strong></div>`}
    ${gradeCard === undefined ? '' : `<div class="card accent"><span>${escapeHtml(copy.html.cardGrade)}</span><strong>${escapeHtml(gradeCard)}</strong></div>`}
    <div class="card"><span>${escapeHtml(copy.html.cardComposite)}</span><strong>${String(analysis.composite.score)}</strong></div>
    <div class="card"><span>${escapeHtml(copy.html.cardAtr)}</span><strong>${analysis.risk.atrPercent.toFixed(2)}%</strong></div>
  </div>
  <div class="chart-card">
    <div class="chart-toolbar"><strong>${escapeHtml(copy.html.chartTitle)}</strong>${ranges}<button type="button" data-range="all">${escapeHtml(copy.html.rangeAll)}</button></div>
    <canvas id="price-chart" aria-label="${escapeHtml(copy.html.chartAria)}"></canvas>
  </div>
  <div class="layout"><nav class="nav" aria-label="${escapeHtml(copy.html.navAria)}">${navigation}</nav><div>${sectionHtml}</div></div>
  <p class="source">${escapeHtml(copy.html.footer)}</p>
</main>
<div class="tooltip" id="chart-tooltip"></div>
<script id="report-data" type="application/json">${data}</script>
<script>
(() => {
  const payload = JSON.parse(document.getElementById('report-data').textContent);
  const canvas = document.getElementById('price-chart');
  const tooltip = document.getElementById('chart-tooltip');
  const tooltipTemplate = ${safeJson(copy.templates.htmlTooltip)};
  const buttons = [...document.querySelectorAll('[data-range]')];
  const sections = [...document.querySelectorAll('.section')];
  const navButtons = [...document.querySelectorAll('[data-target]')];
  const context = canvas.getContext('2d');
  let bars = payload.bars;
  let points = [];
  const fill = (template, values) => Object.entries(values).reduce((text, entry) => text.split('{'+entry[0]+'}').join(entry[1]), template);
  const resize = () => { const ratio = window.devicePixelRatio || 1; canvas.width = canvas.clientWidth * ratio; canvas.height = canvas.clientHeight * ratio; context.setTransform(ratio,0,0,ratio,0,0); draw(); };
  const draw = () => {
    if (!context || bars.length === 0) return;
    const width = canvas.clientWidth, height = canvas.clientHeight, padding = 26;
    context.clearRect(0,0,width,height);
    const min = Math.min(...bars.map(bar => bar.low)), max = Math.max(...bars.map(bar => bar.high)), range = max - min || 1;
    const x = index => padding + index / Math.max(1, bars.length - 1) * (width - padding * 2);
    const y = value => padding + (max - value) / range * (height - padding * 2);
    context.strokeStyle = 'rgba(148,163,184,.25)'; context.lineWidth = 1;
    for (let i=0;i<=4;i++){ const gy=padding+i/4*(height-padding*2); context.beginPath(); context.moveTo(padding,gy); context.lineTo(width-padding,gy); context.stroke(); }
    const gradient=context.createLinearGradient(0,0,0,height); gradient.addColorStop(0,'rgba(37,99,235,.25)'); gradient.addColorStop(1,'rgba(37,99,235,0)');
    context.beginPath(); bars.forEach((bar,i)=>{ const px=x(i), py=y(bar.close); if(i===0) context.moveTo(px,py); else context.lineTo(px,py); });
    context.lineTo(x(bars.length-1),height-padding); context.lineTo(x(0),height-padding); context.closePath(); context.fillStyle=gradient; context.fill();
    context.beginPath(); bars.forEach((bar,i)=>{ const px=x(i), py=y(bar.close); if(i===0) context.moveTo(px,py); else context.lineTo(px,py); }); context.strokeStyle='#2563eb'; context.lineWidth=2; context.stroke();
    points = bars.map((bar,i)=>({ x:x(i), y:y(bar.close), bar }));
  };
  const show = index => { const point=points[index]; if(!point) return; tooltip.style.display='block'; tooltip.style.left=Math.min(window.innerWidth-190,point.x+12)+'px'; tooltip.style.top=Math.max(8,point.y-12)+'px'; tooltip.innerHTML=fill(tooltipTemplate,{time:point.bar.time,close:point.bar.close,volume:point.bar.volume}); };
  canvas.addEventListener('mousemove', event => { const rect=canvas.getBoundingClientRect(), px=event.clientX-rect.left; let best=0; for(let i=1;i<points.length;i++) if(Math.abs(points[i].x-px)<Math.abs(points[best].x-px)) best=i; show(best); });
  canvas.addEventListener('mouseleave', () => { tooltip.style.display='none'; });
  buttons.forEach(button => button.addEventListener('click', () => { const range=button.dataset.range; bars=range==='all'?payload.bars:payload.bars.slice(-Number(range)); draw(); }));
  navButtons.forEach(button => button.addEventListener('click', () => { const target=Number(button.dataset.target); sections.forEach((section,index)=>section.classList.toggle('hidden',index!==target)); }));
  window.addEventListener('resize', resize); resize();
})();
</script>
</body>
</html>`
}

/**
 * Resolve the report type for one request.
 * @param request - Report request carrying an optional type id.
 * @param snapshot - Loaded snapshot whose instrument family selects the default.
 * @returns The requested type, or the family default when the id is absent or unknown.
 */
export function resolveReportType(request: ResearchReportRequest, snapshot: MarketSnapshot): ReportTypeDefinition {
  const requested = request.reportType === undefined ? undefined : reportTypeById(request.reportType)
  return requested ?? defaultReportType(snapshot.instrument.assetClass)
}

/**
 * Build one deterministic report through a market-data provider.
 * @param provider - Market-data provider used to load the report snapshot.
 * @param request - Symbol, optional question, horizon, and report type.
 * @param signal - Optional cancellation forwarded to the provider.
 * @param language - Report language; defaults to English.
 * @param macro - Macro series rendered as the report precondition; empty when none loaded.
 * @param metrics - Instrument metrics rendered into the fundamental blocks; empty when none loaded.
 * @param parameters - Resolved valuation parameters the model runs with.
 * @param validation - Recorded backtest evidence that decides whether the value is a target price.
 * @returns The structured report with Markdown and interactive HTML renderings.
 */
export async function buildResearchReport(
  provider: FinanceMarketDataProvider,
  request: ResearchReportRequest,
  signal?: AbortSignal,
  language: ReportLanguage = 'en',
  macro: readonly MacroSeries[] = [],
  metrics: readonly AssetMetric[] = [],
  parameters: ValuationParameters = VALUATION_PARAMETERS,
  validation: ValuationValidation = VALUATION_VALIDATION,
): Promise<ResearchReport> {
  const copy = REPORT_COPY[language]
  const snapshot = await provider.load(request.symbol, signal)
  const analysis = buildIndicatorAnalysis(snapshot)
  const type = resolveReportType(request, snapshot)
  const inputs = forecastInputs(metrics, parameters, new Date(snapshot.asOf).getUTCFullYear())
  const forecast = inputs === undefined ? undefined : buildEarningsForecast(inputs)
  const valuation = metrics.length === 0
    ? undefined
    : buildValuation(buildValuationInputs(metrics, macro, snapshot.quote.price), parameters, validation)
  const sections = sectionsFor(snapshot, analysis, request, language, type, macro, metrics, forecast, valuation)
  const label = snapshot.instrument.name === snapshot.instrument.symbol
    ? snapshot.instrument.symbol
    : `${snapshot.instrument.name} (${snapshot.instrument.symbol})`
  const title = formatCopy(copy.templates.reportTitle, {
    label,
    category: (copy.reportCategories[type.category] as ReportCategoryCopy).name,
    form: copy.reportForms[type.form] as string,
  })
  const markdown = `# ${title}\n\n${sections
    .map(section => `## ${section.title}\n\n${section.content}`)
    .join('\n\n')}\n`
  return {
    symbol: snapshot.instrument.symbol,
    asOf: snapshot.asOf,
    title,
    reportType: type.id,
    markdown,
    html: reportHtml(title, snapshot, analysis, sections, copy, type, valuation),
    sections,
    evidence: [{
      source: snapshot.source.provider,
      asOf: snapshot.asOf,
      url: `fixture://${snapshot.instrument.symbol}`,
    }],
  }
}

/** Report types available to callers. */
export { REPORT_TYPES }
