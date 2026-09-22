/** Structured Markdown and interactive HTML reports built from deterministic market analysis. */

import { buildIndicatorAnalysis } from './indicators.ts'
import { buildMethodologyAnalysis, type MethodologyAnalysis } from './methodology.ts'
import { REPORT_COPY, formatCopy, type ReportBlockCopy, type ReportCategoryCopy, type ReportCopy } from './report-copy.ts'
import type { ReportLanguage } from './report-language.ts'
import { REPORT_TYPES, defaultReportType, reportTypeById, type ReportSectionId, type ReportTypeDefinition } from './report-types.ts'
import type { AssetMetric, AssetMetricGroup } from './asset-context.ts'
import type { MacroCategory } from './macro-catalog.ts'
import type { MacroSeries } from './macro.ts'
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
    case 'industry-landscape':
      return metricBlock(context, id, ['industry'])
    case 'competitive-position':
      return metricBlock(context, id, ['competition'])
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
): string {
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
.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}.card{border:1px solid var(--border);border-radius:14px;padding:14px;background:var(--card)}
.card span{display:block;color:var(--muted);font-size:12px}.card strong{display:block;margin-top:5px;font-size:20px}
.chart-card{border:1px solid var(--border);border-radius:16px;padding:12px;background:var(--card);margin:18px 0}.chart-toolbar{display:flex;gap:8px;align-items:center;margin-bottom:8px}
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
  <div class="cards">
    <div class="card"><span>${escapeHtml(copy.html.cardPrice)}</span><strong>${String(snapshot.quote.price)}</strong></div>
    <div class="card"><span>${escapeHtml(copy.html.cardChange)}</span><strong class="${snapshot.quote.changePercent >= 0 ? 'positive' : 'negative'}">${snapshot.quote.changePercent.toFixed(2)}%</strong></div>
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
 * @returns The structured report with Markdown and interactive HTML renderings.
 */
export async function buildResearchReport(
  provider: FinanceMarketDataProvider,
  request: ResearchReportRequest,
  signal?: AbortSignal,
  language: ReportLanguage = 'en',
  macro: readonly MacroSeries[] = [],
  metrics: readonly AssetMetric[] = [],
): Promise<ResearchReport> {
  const copy = REPORT_COPY[language]
  const snapshot = await provider.load(request.symbol, signal)
  const analysis = buildIndicatorAnalysis(snapshot)
  const type = resolveReportType(request, snapshot)
  const sections = sectionsFor(snapshot, analysis, request, language, type, macro, metrics)
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
    html: reportHtml(title, snapshot, analysis, sections, copy, type),
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
