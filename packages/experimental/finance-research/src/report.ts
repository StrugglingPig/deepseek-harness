/** Structured Markdown reports built from deterministic market analysis. */

import { buildIndicatorAnalysis } from './indicators.ts'
import type {
  FinanceMarketDataProvider,
  IndicatorAnalysis,
  MarketSnapshot,
  ResearchReport,
  ResearchReportRequest,
  ResearchReportSection,
} from './types.ts'

function predictionSection(snapshot: MarketSnapshot): ResearchReportSection[] {
  if (snapshot.prediction === undefined) return []
  const prediction = snapshot.prediction
  const spread = prediction.ask - prediction.bid
  return [{
    title: 'Prediction Market',
    content: [
      `- Implied probability: ${(prediction.impliedProbability * 100).toFixed(2)}%`,
      `- Bid/ask: ${prediction.bid} / ${prediction.ask} (spread ${spread.toFixed(4)})`,
      `- Volume: ${prediction.volume}`,
      `- Open interest: ${prediction.openInterest}`,
      `- Resolution: ${prediction.resolution}`,
      `- Rules: ${prediction.rules}`,
    ].join('\n'),
  }]
}

function sectionsFor(
  snapshot: MarketSnapshot,
  analysis: IndicatorAnalysis,
  request: ResearchReportRequest,
): ResearchReportSection[] {
  const question = request.question ?? 'Assess the current research setup.'
  const horizon = request.horizon ?? 'swing'
  const signals = analysis.signals
    .map(signal => `- ${signal.name}: ${signal.direction} (weight ${signal.weight}, value ${signal.value})`)
    .join('\n')
  const conflicts = analysis.conflicts.length === 0
    ? 'No directional conflicts across the weighted signals.'
    : `Conflicting signals: ${analysis.conflicts.join(', ')}.`
  return [
    {
      title: 'Summary',
      content: `${analysis.composite.direction} bias for ${snapshot.instrument.name} (${snapshot.instrument.symbol}). ${analysis.composite.summary}.`,
    },
    {
      title: 'Research Question',
      content: `${question}\n\nHorizon: ${horizon}`,
    },
    {
      title: 'Market Snapshot',
      content: [
        `- As-of: ${snapshot.asOf}`,
        `- Price: ${snapshot.quote.price} ${snapshot.instrument.currency}`,
        `- Change: ${snapshot.quote.changePercent.toFixed(2)}%`,
        `- Bars: ${snapshot.bars.length}`,
        `- Source: ${snapshot.source.provider}${snapshot.source.synthetic ? ' (synthetic fixture)' : ''}`,
      ].join('\n'),
    },
    {
      title: 'Technical Indicators',
      content: [
        `- SMA 20 / 50: ${analysis.indicators.sma20} / ${analysis.indicators.sma50}`,
        `- EMA 12 / 26: ${analysis.indicators.ema12} / ${analysis.indicators.ema26}`,
        `- RSI 14: ${analysis.indicators.rsi14}`,
        `- MACD / signal / histogram: ${analysis.indicators.macd} / ${analysis.indicators.macdSignal} / ${analysis.indicators.macdHistogram}`,
        `- ATR 14: ${analysis.indicators.atr14}`,
        `- Bollinger bands: ${analysis.indicators.bollingerLower} / ${analysis.indicators.bollingerMiddle} / ${analysis.indicators.bollingerUpper}`,
        `- OBV / 20-bar average: ${analysis.indicators.obv} / ${analysis.indicators.obvSma20}`,
      ].join('\n'),
    },
    {
      title: 'Multi-Indicator Synthesis',
      content: [
        signals,
        '',
        `Composite score: ${analysis.composite.score}`,
        `Confidence: ${analysis.composite.confidence}%`,
        conflicts,
      ].join('\n'),
    },
    ...predictionSection(snapshot),
    {
      title: 'Risk And Limitations',
      content: [
        `- ATR as percent of price: ${analysis.risk.atrPercent.toFixed(4)}%`,
        '- The initial provider is deterministic fixture data and is not live market data.',
        '- The report is research automation output, not investment advice.',
      ].join('\n'),
    },
  ]
}

/**
 * Build one deterministic report through a market-data provider.
 * @param provider - Market-data provider used to load the report snapshot.
 * @param request - Symbol, optional question, and optional horizon.
 * @param signal - Optional cancellation forwarded to the provider.
 * @returns The structured report and its Markdown rendering.
 */
export async function buildResearchReport(
  provider: FinanceMarketDataProvider,
  request: ResearchReportRequest,
  signal?: AbortSignal,
): Promise<ResearchReport> {
  const snapshot = await provider.load(request.symbol, signal)
  const analysis = buildIndicatorAnalysis(snapshot)
  const sections = sectionsFor(snapshot, analysis, request)
  const title = `${snapshot.instrument.name} (${snapshot.instrument.symbol}) research report`
  const markdown = `# ${title}\n\n${sections
    .map(section => `## ${section.title}\n\n${section.content}`)
    .join('\n\n')}\n`
  return {
    symbol: snapshot.instrument.symbol,
    asOf: snapshot.asOf,
    title,
    markdown,
    sections,
    evidence: [{
      source: snapshot.source.provider,
      asOf: snapshot.asOf,
      url: `fixture://${snapshot.instrument.symbol}`,
    }],
  }
}
