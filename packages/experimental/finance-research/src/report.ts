/** Structured Markdown and interactive HTML reports built from deterministic market analysis. */

import { buildIndicatorAnalysis } from './indicators.ts'
import { buildMethodologyAnalysis } from './methodology.ts'
import { REPORT_COPY, formatCopy, type ReportCopy } from './report-copy.ts'
import type { ReportLanguage } from './report-language.ts'
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

function sectionsFor(
  snapshot: MarketSnapshot,
  analysis: IndicatorAnalysis,
  request: ResearchReportRequest,
  language: ReportLanguage,
): ResearchReportSection[] {
  const copy = REPORT_COPY[language]
  const direction = (value: string): string => word(copy.directions, value)
  const status = (value: string): string => word(copy.statuses, value)
  const category = (value: string): string => word(copy.categories, value)
  const requirement = (value: string): string => copy.requirements[value] ?? value
  const question = request.question ?? copy.labels.defaultQuestion
  const horizon = request.horizon ?? copy.labels.defaultHorizon
  const instrumentLabel = snapshot.instrument.name === snapshot.instrument.symbol
    ? snapshot.instrument.symbol
    : `${snapshot.instrument.name} (${snapshot.instrument.symbol})`
  const signals = analysis.signals
    .map(signal => formatCopy(copy.templates.signal, {
      name: word(copy.signals, signal.name),
      direction: direction(signal.direction),
      weight: signal.weight,
      value: signal.value,
    }))
    .join('\n')
  const conflicts = analysis.conflicts.length === 0
    ? copy.labels.noConflicts
    : `${copy.labels.conflicts}${analysis.conflicts.map(item => word(copy.signals, item)).join(', ')}.`
  const sourceLimitation = snapshot.source.synthetic
    ? `- ${copy.labels.fixtureLimitation}`
    : `- ${formatCopy(copy.labels.snapshotLimitation, { provider: snapshot.source.provider })}`
  const methodology = buildMethodologyAnalysis(snapshot, language)
  const aligned = analysis.signals.length - analysis.conflicts.length
  return [
    {
      title: copy.sections.summary,
      content: formatCopy(copy.templates.summary, {
        direction: direction(analysis.composite.direction),
        label: instrumentLabel,
        aligned,
      }),
    },
    {
      title: copy.sections.researchQuestion,
      content: `${question}\n\n${copy.labels.horizon}${horizon}`,
    },
    {
      title: copy.sections.marketSnapshot,
      content: [
        `- ${copy.labels.asOf}${snapshot.asOf}`,
        `- ${copy.labels.price}${snapshot.quote.price} ${snapshot.instrument.currency}`,
        `- ${copy.labels.change}${snapshot.quote.changePercent.toFixed(2)}%`,
        `- ${copy.labels.bars}${snapshot.bars.length}`,
        `- ${copy.labels.source}${snapshot.source.provider}${snapshot.source.synthetic ? copy.labels.syntheticSuffix : ''}`,
      ].join('\n'),
    },
    {
      title: copy.sections.technicalIndicators,
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
      title: copy.sections.synthesis,
      content: [
        signals,
        '',
        `${copy.labels.compositeScore}${analysis.composite.score}`,
        `${copy.labels.confidence}${analysis.composite.confidence}%`,
        conflicts,
      ].join('\n'),
    },
    ...predictionSection(snapshot, copy),
    {
      title: copy.sections.methodologyCoverage,
      content: methodology.readings
        .filter(reading => reading.status !== 'requires-input')
        .map(reading => formatCopy(copy.templates.reading, {
          name: reading.name,
          direction: direction(reading.direction),
          confidence: reading.confidence,
          status: status(reading.status),
          note: reading.note,
        }))
        .join('\n'),
    },
    {
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
    },
    {
      title: copy.sections.strategyGaps,
      content: methodology.catalog
        .filter(entry => entry.status === 'requires-input' || entry.status === 'not-data-backed')
        .map(entry => formatCopy(copy.templates.gap, {
          name: entry.name,
          category: category(entry.category),
          status: status(entry.status),
          requirements: entry.dataRequirements.map(requirement).join(', '),
        }))
        .join('\n'),
    },
    {
      title: copy.sections.riskAndLimitations,
      content: [
        `- ${copy.labels.atrPercent}${analysis.risk.atrPercent.toFixed(4)}%`,
        sourceLimitation,
        `- ${copy.labels.notAdvice}`,
      ].join('\n'),
    },
  ]
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] as string)
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
): string {
  const data = safeJson({
    symbol: snapshot.instrument.symbol,
    name: snapshot.instrument.name,
    currency: snapshot.instrument.currency,
    asOf: snapshot.asOf,
    source: snapshot.source.provider,
    bars: snapshot.bars.map(bar => ({
      time: bar.timestamp, close: bar.close, open: bar.open, high: bar.high, low: bar.low, volume: bar.volume,
    })),
  })
  const sectionHtml = sections.map((section, index) => `
    <article class="section" data-section="${String(index)}">
      <h2>${escapeHtml(section.title)}</h2>
      <pre>${escapeHtml(section.content)}</pre>
    </article>`).join('')
  const navigation = sections.map((section, index) =>
    `<button type="button" data-target="${String(index)}">${escapeHtml(section.title)}</button>`).join('')
  const meta = formatCopy(copy.templates.htmlMeta, {
    symbol: snapshot.instrument.symbol,
    currency: snapshot.instrument.currency,
    asOf: snapshot.asOf,
    provider: snapshot.source.provider,
  })
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
.section{border:1px solid var(--border);border-radius:14px;padding:18px;background:var(--card);margin-bottom:14px}.section h2{margin:0 0 10px;font-size:18px}.section pre{margin:0;white-space:pre-wrap;font-family:inherit;color:inherit}
.positive{color:var(--up)}.negative{color:var(--down)}.hidden{display:none}.source{color:var(--muted);font-size:12px}
@media(max-width:820px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.layout{grid-template-columns:1fr}.nav{position:static;flex-direction:row;flex-wrap:wrap}.hero{display:block}}
</style>
</head>
<body>
<main>
  <div class="hero"><div><div class="eyebrow">${escapeHtml(copy.html.eyebrow)}</div><h1>${escapeHtml(title)}</h1><div class="meta">${escapeHtml(meta)}</div></div><div class="pill">${escapeHtml(pill)}</div></div>
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
 * Build one deterministic report through a market-data provider.
 * @param provider - Market-data provider used to load the report snapshot.
 * @param request - Symbol, optional question, and optional horizon.
 * @param signal - Optional cancellation forwarded to the provider.
 * @param language - Report language; defaults to English.
 * @returns The structured report with Markdown and interactive HTML renderings.
 */
export async function buildResearchReport(
  provider: FinanceMarketDataProvider,
  request: ResearchReportRequest,
  signal?: AbortSignal,
  language: ReportLanguage = 'en',
): Promise<ResearchReport> {
  const copy = REPORT_COPY[language]
  const snapshot = await provider.load(request.symbol, signal)
  const analysis = buildIndicatorAnalysis(snapshot)
  const sections = sectionsFor(snapshot, analysis, request, language)
  const label = snapshot.instrument.name === snapshot.instrument.symbol
    ? snapshot.instrument.symbol
    : `${snapshot.instrument.name} (${snapshot.instrument.symbol})`
  const title = `${label} ${copy.titleSuffix}`
  const markdown = `# ${title}\n\n${sections
    .map(section => `## ${section.title}\n\n${section.content}`)
    .join('\n\n')}\n`
  return {
    symbol: snapshot.instrument.symbol,
    asOf: snapshot.asOf,
    title,
    markdown,
    html: reportHtml(title, snapshot, analysis, sections, copy),
    sections,
    evidence: [{
      source: snapshot.source.provider,
      asOf: snapshot.asOf,
      url: `fixture://${snapshot.instrument.symbol}`,
    }],
  }
}
