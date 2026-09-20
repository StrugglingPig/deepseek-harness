/** Structured Markdown reports built from deterministic market analysis. */

import { buildIndicatorAnalysis } from './indicators.ts'
import { buildMethodologyAnalysis } from './methodology.ts'
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
  const instrumentLabel = snapshot.instrument.name === snapshot.instrument.symbol
    ? snapshot.instrument.symbol
    : `${snapshot.instrument.name} (${snapshot.instrument.symbol})`
  const signals = analysis.signals
    .map(signal => `- ${signal.name}: ${signal.direction} (weight ${signal.weight}, value ${signal.value})`)
    .join('\n')
  const conflicts = analysis.conflicts.length === 0
    ? 'No directional conflicts across the weighted signals.'
    : `Conflicting signals: ${analysis.conflicts.join(', ')}.`
  const sourceLimitation = snapshot.source.synthetic
    ? '- The initial provider is deterministic fixture data and is not live market data.'
    : `- Snapshot source: ${snapshot.source.provider}; upstream availability, latency, and data quality remain external.`
  const methodology = buildMethodologyAnalysis(snapshot)
  return [
    {
      title: 'Summary',
      content: `${analysis.composite.direction} bias for ${instrumentLabel}. ${analysis.composite.summary}.`,
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
      title: 'Methodology Coverage',
      content: methodology.readings
        .filter(reading => reading.status !== 'requires-input')
        .map(reading => `- ${reading.name}: ${reading.direction}, ${String(reading.confidence)}% confidence, status ${reading.status}. ${reading.note}`)
        .join('\n'),
    },
    {
      title: 'Investor Lenses',
      content: methodology.investors.map(investor => [
        `- ${investor.name} (${investor.school}): ${investor.stance}.`,
        ...investor.evidence.map(item => `  - ${item}`),
        `  - Risk: ${investor.risk}`,
      ].join('\n')).join('\n'),
    },
    {
      title: 'Strategy Gaps',
      content: methodology.catalog
        .filter(entry => entry.status === 'requires-input' || entry.status === 'not-data-backed')
        .map(entry => `- ${entry.name} (${entry.category}): ${entry.status}; requires ${entry.dataRequirements.join(', ')}`)
        .join('\n'),
    },
    {
      title: 'Risk And Limitations',
      content: [
        `- ATR as percent of price: ${analysis.risk.atrPercent.toFixed(4)}%`,
        sourceLimitation,
        '- The report is research automation output, not investment advice.',
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
  return `<!doctype html>
<html lang="en">
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
  <div class="hero"><div><div class="eyebrow">DeepSeek Harness · Finance Research</div><h1>${escapeHtml(title)}</h1><div class="meta">${escapeHtml(snapshot.instrument.symbol)} · ${escapeHtml(snapshot.instrument.currency)} · As of ${escapeHtml(snapshot.asOf)} · Source ${escapeHtml(snapshot.source.provider)}</div></div><div class="pill">${escapeHtml(analysis.composite.direction)} · ${String(analysis.composite.confidence)}% confidence</div></div>
  <div class="cards">
    <div class="card"><span>Price</span><strong>${String(snapshot.quote.price)}</strong></div>
    <div class="card"><span>Change</span><strong class="${snapshot.quote.changePercent >= 0 ? 'positive' : 'negative'}">${snapshot.quote.changePercent.toFixed(2)}%</strong></div>
    <div class="card"><span>Composite</span><strong>${String(analysis.composite.score)}</strong></div>
    <div class="card"><span>ATR</span><strong>${analysis.risk.atrPercent.toFixed(2)}%</strong></div>
  </div>
  <div class="chart-card">
    <div class="chart-toolbar"><strong>Interactive price chart</strong><button type="button" data-range="60">60 bars</button><button type="button" data-range="120">120 bars</button><button type="button" data-range="all">All</button></div>
    <canvas id="price-chart" aria-label="Interactive price chart"></canvas>
  </div>
  <div class="layout"><nav class="nav" aria-label="Report sections">${navigation}</nav><div>${sectionHtml}</div></div>
  <p class="source">Generated by DeepSeek Harness finance research. This is research automation output, not investment advice.</p>
</main>
<div class="tooltip" id="chart-tooltip"></div>
<script id="report-data" type="application/json">${data}</script>
<script>
(() => {
  const payload = JSON.parse(document.getElementById('report-data').textContent);
  const canvas = document.getElementById('price-chart');
  const tooltip = document.getElementById('chart-tooltip');
  const buttons = [...document.querySelectorAll('[data-range]')];
  const sections = [...document.querySelectorAll('.section')];
  const navButtons = [...document.querySelectorAll('[data-target]')];
  const context = canvas.getContext('2d');
  let bars = payload.bars;
  let points = [];
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
  const show = index => { const point=points[index]; if(!point) return; tooltip.style.display='block'; tooltip.style.left=Math.min(window.innerWidth-190,point.x+12)+'px'; tooltip.style.top=Math.max(8,point.y-12)+'px'; tooltip.innerHTML='<strong>'+point.bar.time+'</strong><br>Close '+point.bar.close+'<br>Volume '+point.bar.volume; };
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
  const label = snapshot.instrument.name === snapshot.instrument.symbol
    ? snapshot.instrument.symbol
    : `${snapshot.instrument.name} (${snapshot.instrument.symbol})`
  const title = `${label} research report`
  const markdown = `# ${title}\n\n${sections
    .map(section => `## ${section.title}\n\n${section.content}`)
    .join('\n\n')}\n`
  return {
    symbol: snapshot.instrument.symbol,
    asOf: snapshot.asOf,
    title,
    markdown,
    html: reportHtml(title, snapshot, analysis, sections),
    sections,
    evidence: [{
      source: snapshot.source.provider,
      asOf: snapshot.asOf,
      url: `fixture://${snapshot.instrument.symbol}`,
    }],
  }
}
