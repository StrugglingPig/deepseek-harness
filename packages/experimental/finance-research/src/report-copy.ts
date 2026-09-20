/** Localized copy for finance research reports. */

import type { ReportLanguage } from './report-language.ts'
import type { MethodologyCategory } from './methodology.ts'

/** Section titles owned by the report writer. */
export type ReportSectionKey =
  | 'summary' | 'researchQuestion' | 'marketSnapshot' | 'technicalIndicators' | 'synthesis'
  | 'predictionMarket' | 'methodologyCoverage' | 'investorLenses' | 'strategyGaps' | 'riskAndLimitations'

/** Line labels owned by the report writer. */
export type ReportLabelKey =
  | 'asOf' | 'price' | 'change' | 'bars' | 'source' | 'syntheticSuffix' | 'horizon' | 'compositeScore'
  | 'confidence' | 'noConflicts' | 'conflicts' | 'impliedProbability' | 'bidAsk' | 'spread' | 'volume'
  | 'openInterest' | 'resolution' | 'rules' | 'atrPercent' | 'fixtureLimitation' | 'snapshotLimitation'
  | 'notAdvice' | 'defaultQuestion' | 'defaultHorizon'

/** Interpolated line templates owned by the report writer. */
export type ReportTemplateKey =
  | 'summary' | 'signal' | 'reading' | 'investor' | 'investorRisk' | 'gap' | 'htmlMeta' | 'htmlPill'
  | 'htmlRange' | 'htmlTooltip'

/** Chrome labels of the interactive HTML report. */
export type ReportHtmlKey =
  | 'eyebrow' | 'cardPrice' | 'cardChange' | 'cardComposite' | 'cardAtr' | 'chartTitle' | 'chartAria'
  | 'rangeAll' | 'navAria' | 'footer'

/** Per-lens copy rendered in the investor lens section. */
export interface LensCopy {
  readonly school: string
  readonly questions: readonly string[]
  readonly risk: string
}

/** Localized copy consumed by the report writer. */
export interface ReportCopy {
  readonly htmlLang: string
  readonly titleSuffix: string
  readonly sections: Readonly<Record<ReportSectionKey, string>>
  readonly labels: Readonly<Record<ReportLabelKey, string>>
  readonly templates: Readonly<Record<ReportTemplateKey, string>>
  readonly html: Readonly<Record<ReportHtmlKey, string>>
  /** Reading and strategy-gap notes keyed by methodology id; `{placeholders}` are interpolated. */
  readonly notes: Readonly<Record<string, string>>
  /** Investor lens copy keyed by lens id. */
  readonly lenses: Readonly<Record<string, LensCopy>>
  /** Localized direction words; absent entries keep the canonical token. */
  readonly directions: Readonly<Record<string, string>>
  /** Localized weighted-signal names; absent entries keep the canonical token. */
  readonly signals: Readonly<Record<string, string>>
  /** Localized execution statuses; absent entries keep the canonical token. */
  readonly statuses: Readonly<Record<string, string>>
  /** Localized methodology categories; absent entries keep the canonical token. */
  readonly categories: Partial<Record<MethodologyCategory, string>>
  /** Localized catalog entry names keyed by entry id; absent entries keep the canonical name. */
  readonly catalogNames: Readonly<Record<string, string>>
  /** Localized data requirements keyed by the canonical requirement; absent entries keep the canonical text. */
  readonly requirements: Readonly<Record<string, string>>
}

const EN: ReportCopy = {
  htmlLang: 'en',
  titleSuffix: 'research report',
  sections: {
    summary: 'Summary',
    researchQuestion: 'Research Question',
    marketSnapshot: 'Market Snapshot',
    technicalIndicators: 'Technical Indicators',
    synthesis: 'Multi-Indicator Synthesis',
    predictionMarket: 'Prediction Market',
    methodologyCoverage: 'Methodology Coverage',
    investorLenses: 'Investor Lenses',
    strategyGaps: 'Strategy Gaps',
    riskAndLimitations: 'Risk And Limitations',
  },
  labels: {
    asOf: 'As-of: ',
    price: 'Price: ',
    change: 'Change: ',
    bars: 'Bars: ',
    source: 'Source: ',
    syntheticSuffix: ' (synthetic fixture)',
    horizon: 'Horizon: ',
    compositeScore: 'Composite score: ',
    confidence: 'Confidence: ',
    noConflicts: 'No directional conflicts across the weighted signals.',
    conflicts: 'Conflicting signals: ',
    impliedProbability: 'Implied probability: ',
    bidAsk: 'Bid/ask: ',
    spread: 'spread ',
    volume: 'Volume: ',
    openInterest: 'Open interest: ',
    resolution: 'Resolution: ',
    rules: 'Rules: ',
    atrPercent: 'ATR as percent of price: ',
    fixtureLimitation: 'The initial provider is deterministic fixture data and is not live market data.',
    snapshotLimitation: 'Snapshot source: {provider}; upstream availability, latency, and data quality remain external.',
    notAdvice: 'The report is research automation output, not investment advice.',
    defaultQuestion: 'Assess the current research setup.',
    defaultHorizon: 'swing',
  },
  templates: {
    summary: '{direction} bias for {label}. {direction} composite with {aligned} aligned signals.',
    signal: '- {name}: {direction} (weight {weight}, value {value})',
    reading: '- {name}: {direction}, {confidence}% confidence, status {status}. {note}',
    investor: '- {name} ({school}): {stance}.',
    investorRisk: '  - Risk: {risk}',
    gap: '- {name} ({category}): {status}; requires {requirements}',
    htmlMeta: '{symbol} · {currency} · As of {asOf} · Source {provider}',
    htmlPill: '{direction} · {confidence}% confidence',
    htmlRange: '{count} bars',
    htmlTooltip: '<strong>{time}</strong><br>Close {close}<br>Volume {volume}',
  },
  html: {
    eyebrow: 'DeepSeek Harness · Finance Research',
    cardPrice: 'Price',
    cardChange: 'Change',
    cardComposite: 'Composite',
    cardAtr: 'ATR',
    chartTitle: 'Interactive price chart',
    chartAria: 'Interactive price chart',
    rangeAll: 'All',
    navAria: 'Report sections',
    footer: 'Generated by DeepSeek Harness finance research. This is research automation output, not investment advice.',
  },
  notes: {
    'ma-trend': 'EMA12 {ema12} vs EMA26 {ema26}',
    donchian: '{window}-day range {low}–{high}',
    adx: 'ADX {adx}',
    supertrend: 'ATR-band trend direction',
    roc: '20-bar rate of change',
    macd: 'MACD histogram direction',
    rsi: 'RSI14 {rsi}',
    'rsi-reversion': 'RSI extreme state',
    bollinger: 'Bollinger z-score',
    kdj: 'K/D cross and level',
    'volume-price': 'Volume {volume} vs 20-period mean {mean}',
    obv: 'OBV vs 20-bar average',
    vwap: 'Rolling 20-bar VWAP proxy',
    'volume-profile': 'OHLCV bucket profile, not intraday footprint',
    chan: 'Simplified structure proxy; full Chan segmentation requires dedicated analysis',
    dow: 'Confirmed swing structure',
    'price-action': 'SMA/price structure proxy',
    'volatility-breakout': 'Latest range versus ATR',
    cycle: 'Autocorrelation cycle proxy',
    elliott: 'Wave counts require validated labeling; no automatic count is claimed',
    wyckoff: 'Accumulation/distribution requires footprint and event context',
    gap: 'Requires: {requirements}',
  },
  lenses: {
    buffett: { school: 'Value and quality', questions: ['Does the business have a durable moat?', 'Is free cash flow durable?', 'Is the price sensible versus intrinsic value?'], risk: 'Quality and valuation inputs are absent from the current snapshot.' },
    graham: { school: 'Deep value', questions: ['Is there a margin of safety?', 'Are earnings and assets stable?'], risk: 'Fundamental and balance-sheet inputs are absent.' },
    munger: { school: 'Quality compounding', questions: ['Can the business compound for a decade?', 'What can permanently impair it?'], risk: 'Business quality is not represented by price and volume alone.' },
    lynch: { school: 'Growth at a reasonable price', questions: ['Is growth visible and understandable?', 'Is the valuation reasonable?'], risk: 'Growth and earnings estimates are absent.' },
    soros: { school: 'Reflexivity and macro', questions: ['What belief is changing?', 'Where is the trend self-reinforcing?'], risk: 'Macro positioning and reflexivity inputs are absent.' },
    dalio: { school: 'Macro and risk balance', questions: ['What regime are we in?', 'Is risk balanced across drivers?'], risk: 'Macro regime and portfolio data are absent.' },
    simons: { school: 'Quantitative signals', questions: ['Is the signal statistically robust?', 'What is the turnover and cost?'], risk: 'No backtest, cost model, or out-of-sample validation is present.' },
    livermore: { school: 'Trend following', questions: ['Is the trend confirmed?', 'Where is the stop?'], risk: 'Position sizing and execution assumptions are absent.' },
    marks: { school: 'Cycle and risk', questions: ['Where are we in the cycle?', 'What is priced in?'], risk: 'Cycle position cannot be established from one asset alone.' },
    taleb: { school: 'Tail risk and convexity', questions: ['What is the worst plausible path?', 'Is the payoff convex?'], risk: 'Tail distribution and option data are absent.' },
  },
  directions: {},
  signals: {},
  statuses: {},
  categories: {},
  catalogNames: {},
  requirements: {},
}

const ZH: ReportCopy = {
  htmlLang: 'zh',
  titleSuffix: '研究报告',
  sections: {
    summary: '摘要',
    researchQuestion: '研究问题',
    marketSnapshot: '行情快照',
    technicalIndicators: '技术指标',
    synthesis: '多指标综合',
    predictionMarket: '预测市场',
    methodologyCoverage: '方法论覆盖',
    investorLenses: '投资大师视角',
    strategyGaps: '策略缺口',
    riskAndLimitations: '风险与限制',
  },
  labels: {
    asOf: '截至：',
    price: '价格：',
    change: '涨跌幅：',
    bars: 'K 线数：',
    source: '数据来源：',
    syntheticSuffix: '（合成 fixture 数据）',
    horizon: '周期：',
    compositeScore: '综合评分：',
    confidence: '置信度：',
    noConflicts: '加权信号之间没有方向冲突。',
    conflicts: '冲突信号：',
    impliedProbability: '隐含概率：',
    bidAsk: '买/卖价：',
    spread: '价差 ',
    volume: '成交量：',
    openInterest: '未平仓量：',
    resolution: '结算规则：',
    rules: '规则：',
    atrPercent: 'ATR 占价格比例：',
    fixtureLimitation: '初始 Provider 为确定性 fixture 数据，不是实时行情。',
    snapshotLimitation: '快照来源：{provider}；上游可用性、延迟与数据质量仍属外部因素。',
    notAdvice: '本报告是研究自动化输出，不构成投资建议。',
    defaultQuestion: '评估当前研究环境。',
    defaultHorizon: '波段',
  },
  templates: {
    summary: '{label} 呈{direction}。{aligned} 个信号与综合方向一致。',
    signal: '- {name}：{direction}（权重 {weight}，数值 {value}）',
    reading: '- {name}：{direction}，置信度 {confidence}%，状态 {status}。{note}',
    investor: '- {name}（{school}）：{stance}。',
    investorRisk: '  - 风险：{risk}',
    gap: '- {name}（{category}）：{status}；需要 {requirements}',
    htmlMeta: '{symbol} · {currency} · 截至 {asOf} · 来源 {provider}',
    htmlPill: '{direction} · 置信度 {confidence}%',
    htmlRange: '{count} 根',
    htmlTooltip: '<strong>{time}</strong><br>收盘 {close}<br>成交量 {volume}',
  },
  html: {
    eyebrow: 'DeepSeek Harness · Finance Research',
    cardPrice: '最新价',
    cardChange: '涨跌幅',
    cardComposite: '综合评分',
    cardAtr: 'ATR',
    chartTitle: '交互式价格图',
    chartAria: '交互式价格图',
    rangeAll: '全部',
    navAria: '报告章节',
    footer: '由 DeepSeek Harness 金融研究生成。本报告是研究自动化输出，不构成投资建议。',
  },
  notes: {
    'ma-trend': 'EMA12 {ema12} 对比 EMA26 {ema26}',
    donchian: '{window} 日区间 {low}–{high}',
    adx: 'ADX {adx}',
    supertrend: 'ATR 通道趋势方向',
    roc: '20 根 K 线变化率',
    macd: 'MACD 柱状图方向',
    rsi: 'RSI14 {rsi}',
    'rsi-reversion': 'RSI 极值状态',
    bollinger: '布林带 z-score',
    kdj: 'K/D 交叉与位置',
    'volume-price': '成交量 {volume} 对比 20 期均值 {mean}',
    obv: 'OBV 对比 20 根均值',
    vwap: '20 根滚动 VWAP 代理',
    'volume-profile': 'OHLCV 分桶筹码分布，不是日内足迹',
    chan: '简化结构代理；完整缠论分段需要专门分析',
    dow: '已确认的摆动结构',
    'price-action': 'SMA/价格结构代理',
    'volatility-breakout': '最新振幅对比 ATR',
    cycle: '自相关周期代理',
    elliott: '波浪计数需要经验证的标注，本报告不声称自动计数',
    wyckoff: '吸筹/派发判断需要足迹与事件背景',
    gap: '需要：{requirements}',
  },
  lenses: {
    buffett: { school: '价值与质量', questions: ['这家企业是否有持久的护城河？', '自由现金流是否可持续？', '价格相对内在价值是否合理？'], risk: '当前快照缺少质量与估值输入。' },
    graham: { school: '深度价值', questions: ['是否存在安全边际？', '盈利与资产是否稳定？'], risk: '缺少基本面与资产负债表输入。' },
    munger: { school: '优质复利', questions: ['这家企业能否复利十年？', '什么会永久损害它？'], risk: '仅凭价格与成交量无法代表企业质量。' },
    lynch: { school: '合理价格的成长', questions: ['成长是否可见且可理解？', '估值是否合理？'], risk: '缺少成长与盈利预测。' },
    soros: { school: '反身性与宏观', questions: ['正在变化的是什么信念？', '趋势在哪里自我强化？'], risk: '缺少宏观仓位与反身性输入。' },
    dalio: { school: '宏观与风险平衡', questions: ['我们处在什么状态？', '风险是否在各驱动因素间平衡？'], risk: '缺少宏观状态与组合数据。' },
    simons: { school: '量化信号', questions: ['信号是否统计稳健？', '换手与成本是多少？'], risk: '缺少回测、成本模型与样本外验证。' },
    livermore: { school: '趋势跟随', questions: ['趋势是否得到确认？', '止损位在哪里？'], risk: '缺少仓位管理与执行假设。' },
    marks: { school: '周期与风险', questions: ['我们处在周期的什么位置？', '价格已经反映了什么？'], risk: '仅凭单一资产无法判断周期位置。' },
    taleb: { school: '尾部风险与凸性', questions: ['最坏的可信路径是什么？', '收益结构是否凸性？'], risk: '缺少尾部分布与期权数据。' },
  },
  signals: {
    trend: '趋势',
    momentum: '动量',
    macd: 'MACD',
    'mean-reversion': '均值回归',
    participation: '参与度',
  },
  directions: {
    bullish: '看涨',
    bearish: '看跌',
    neutral: '中性',
    'insufficient-data': '数据不足',
    constructive: '偏积极',
    cautious: '偏谨慎',
  },
  statuses: {
    available: '可计算',
    partial: '部分可计算',
    'requires-input': '需要额外输入',
    'not-data-backed': '无数据支撑',
  },
  categories: {
    breakout: '突破',
    trend: '趋势',
    momentum: '动量',
    'mean-reversion': '均值回归',
    'statistical-arbitrage': '统计套利',
    'price-volume': '价量',
    'market-structure': '市场结构',
    'wave-cycle': '波浪与周期',
    factor: '因子',
    fundamental: '基本面',
    'event-driven': '事件驱动',
    'machine-learning': '机器学习',
    microstructure: '微观结构',
  },
  catalogNames: {
    turtle: '海龟交易法',
    'ma-trend': '均线趋势',
    donchian: '唐奇安通道',
    adx: 'ADX 趋势',
    supertrend: 'SuperTrend',
    momentum: '动量',
    roc: 'ROC',
    macd: 'MACD',
    rsi: 'RSI',
    'relative-strength': '相对强弱',
    'rsi-reversion': 'RSI 均值回归',
    bollinger: '布林带均值回归',
    kdj: 'KDJ',
    grid: '网格',
    pairs: '配对交易',
    'volume-price': '量价关系',
    obv: 'OBV',
    vwap: 'VWAP',
    'volume-profile': '筹码分布',
    chan: '缠论',
    dow: '道氏理论',
    'price-action': '价格行为',
    wyckoff: '威科夫',
    elliott: '艾略特波浪',
    cycle: '周期分析',
    'opening-range': '开盘区间突破',
    'volatility-breakout': '波动率突破',
    'market-neutral': '市场中性',
    'pca-arb': 'PCA 套利',
    value: '价值因子',
    'factor-momentum': '动量因子',
    quality: '质量因子',
    'low-vol': '低波因子',
    size: '小市值因子',
    'multi-factor': '多因子',
    dcf: 'DCF 估值',
    'financial-quality': '财务质量',
    'industry-rotation': '行业轮动',
    earnings: '财报策略',
    'dividend-buyback': '分红与回购',
    'merger-arb': '并购套利',
    'index-rebalance': '指数调仓',
    forest: '随机森林',
    'boosted-trees': 'XGBoost / LightGBM',
    'sequence-model': 'LSTM / Transformer',
    reinforcement: '强化学习',
    'market-making': '做市',
    'order-flow': '订单流',
    execution: 'VWAP / TWAP 执行',
    'order-book': '订单簿失衡',
  },
  requirements: {
    'daily OHLCV': '日线 OHLCV',
    'account risk budget': '账户风险预算',
    OHLC: 'OHLC',
    'price history': '价格历史',
    'benchmark series': '基准序列',
    'peer universe': '同业标的池',
    'range bounds': '区间边界',
    'grid step': '网格步长',
    'capital budget': '资金预算',
    'paired asset history': '配对资产历史',
    OHLCV: 'OHLCV',
    'intraday volume and price': '日内成交量与价格',
    'intraday distribution': '日内分布',
    'structural validation': '结构验证',
    'swing confirmation': '摆动确认',
    'discretionary confirmation': '主观确认',
    'volume footprint': '成交量足迹',
    'event context': '事件背景',
    'validated wave labeling': '经验证的波浪标注',
    'sufficient history': '足够的历史数据',
    'cycle validation': '周期验证',
    'intraday bars': '日内 K 线',
    'session definition': '交易时段定义',
    'multi-asset universe': '多资产标的池',
    'hedge ratio': '对冲比率',
    'cross-sectional panel': '横截面面板数据',
    'fundamental data': '基本面数据',
    'asset universe': '资产标的池',
    'financial statements': '财务报表',
    'cross-sectional history': '横截面历史',
    'market-cap universe': '市值标的池',
    'fundamental and price panel': '基本面与价格面板',
    'cash-flow forecasts': '现金流预测',
    'discount rate': '折现率',
    'macro and industry data': '宏观与行业数据',
    estimates: '盈利预测',
    events: '事件数据',
    'corporate actions': '公司行为',
    'deal terms': '交易条款',
    probability: '概率估计',
    'index events': '指数事件',
    features: '特征',
    labels: '标签',
    validation: '验证集',
    'long sequence history': '长序列历史',
    simulator: '模拟器',
    'reward design': '奖励设计',
    'order book': '订单簿',
    'queue data': '排队数据',
    latency: '延迟数据',
    'tick and order-flow data': '逐笔与订单流数据',
    'order size': '订单规模',
    'market impact model': '市场冲击模型',
    'level-2 order book': 'Level-2 订单簿',
  },
}

/** Report copy for every shipped report language. */
export const REPORT_COPY: Record<ReportLanguage, ReportCopy> = { en: EN, zh: ZH }

/**
 * Interpolate one copy template.
 * @param template - Copy text carrying `{name}` placeholders.
 * @param params - Values keyed by placeholder name.
 * @returns The rendered copy.
 */
export function formatCopy(template: string, params: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([a-zA-Z0-9_-]+)\}/gu, (match, key: string) => {
    const value = params[key]
    return value === undefined ? match : String(value)
  })
}
