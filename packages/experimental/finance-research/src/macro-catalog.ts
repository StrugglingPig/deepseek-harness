/**
 * Macro indicator catalog: the growth, inflation, employment, policy, and
 * transmission series a macro report reads. Every entry names the upstream
 * bindings that can serve it, using identifiers verified against the live
 * upstream catalogs (FRED series, World Bank indicators, IMF DataMapper ids,
 * AKShare macro functions).
 */

/** Upstreams that can serve a macro series. */
export const MACRO_SOURCES = ['akshare', 'fred', 'worldbank', 'imf'] as const
/** One macro upstream. */
export type MacroSourceId = typeof MACRO_SOURCES[number]

/** Macro framework categories. */
export const MACRO_CATEGORIES = [
  'growth', 'inflation', 'employment', 'consumption', 'investment',
  'money-credit', 'fiscal', 'external', 'policy', 'market',
] as const
/** One macro category. */
export type MacroCategory = typeof MACRO_CATEGORIES[number]

/** Economies the catalog covers directly; `global` aggregates use World Bank and IMF panels. */
export const MACRO_COUNTRIES = ['cn', 'us', 'global'] as const
/** One catalog country. */
export type MacroCountry = typeof MACRO_COUNTRIES[number]

/** Publication frequency of one series. */
export type MacroFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'

/** Where one series sits in the cycle. */
export type MacroTiming = 'leading' | 'coincident' | 'lagging'

/** One upstream binding for a catalog indicator. */
export interface MacroSourceBindings {
  /** AKShare macro function plus any fixed arguments the bridge must pass. */
  readonly akshare?: {
    readonly function: string
    readonly params?: Readonly<Record<string, string>>
    /** Value column to read when the function publishes several series. */
    readonly column?: string
    /**
     * Unit this binding actually reports. AKShare's event tables publish release
     * values (a monthly change, a headline count, a trade balance in billions)
     * under an indicator whose other bindings report a level or an index.
     */
    readonly unit?: string
  }
  /** FRED series id. */
  readonly fred?: { readonly seriesId: string }
  /** World Bank indicator id and ISO3 country code. */
  readonly worldbank?: { readonly indicator: string; readonly country: string }
  /** IMF DataMapper indicator id and country code. */
  readonly imf?: { readonly indicator: string; readonly country: string }
}

/** One macro indicator. */
export interface MacroIndicator {
  readonly id: string
  readonly name: string
  readonly nameZh: string
  readonly category: MacroCategory
  readonly country: MacroCountry
  readonly unit: string
  readonly frequency: MacroFrequency
  readonly timing: MacroTiming
  /** How the reading transmits to prices; written for a research reader, not for the model to recompute. */
  readonly reading: string
  readonly affectedAssets: readonly string[]
  readonly sources: MacroSourceBindings
}

/**
 * Build one catalog entry.
 * @param id - Stable indicator id.
 * @param name - English name.
 * @param nameZh - Chinese name.
 * @param category - Framework category.
 * @param country - Covered economy.
 * @param unit - Reported unit.
 * @param frequency - Publication frequency.
 * @param timing - Cycle position.
 * @param reading - Transmission reading.
 * @param affectedAssets - Asset classes the series moves.
 * @param sources - Upstream bindings.
 * @returns The catalog entry.
 */
function indicator(
  id: string,
  name: string,
  nameZh: string,
  category: MacroCategory,
  country: MacroCountry,
  unit: string,
  frequency: MacroFrequency,
  timing: MacroTiming,
  reading: string,
  affectedAssets: readonly string[],
  sources: MacroSourceBindings,
): MacroIndicator {
  return { id, name, nameZh, category, country, unit, frequency, timing, reading, affectedAssets, sources }
}

/** Every macro indicator this package can read. */
export const MACRO_INDICATORS: readonly MacroIndicator[] = [
  // Growth
  indicator('cn-gdp-growth', 'China GDP growth (YoY)', '中国 GDP 同比', 'growth', 'cn', '%', 'quarterly', 'lagging',
    'Above-trend growth supports cyclicals, commodities, and CNY; a slowdown shifts the policy anchor toward easing.',
    ['CN equities', 'industrial metals', 'CNY'],
    { akshare: { function: 'macro_china_gdp_yearly' }, worldbank: { indicator: 'NY.GDP.MKTP.KD.ZG', country: 'CHN' }, imf: { indicator: 'NGDP_RPCH', country: 'CHN' } }),
  indicator('us-gdp-growth', 'US real GDP growth (annualized QoQ)', '美国实际 GDP 环比折年率', 'growth', 'us', '%', 'quarterly', 'lagging',
    'Growth surprises set the earnings and rate path; a hot print lifts yields and can pressure long-duration equities.',
    ['US equities', 'USTs', 'USD'],
    { fred: { seriesId: 'A191RL1Q225SBEA' }, akshare: { function: 'macro_usa_gdp_monthly' }, worldbank: { indicator: 'NY.GDP.MKTP.KD.ZG', country: 'USA' }, imf: { indicator: 'NGDP_RPCH', country: 'USA' } }),
  indicator('global-gdp-growth', 'World GDP growth (annual %)', '全球 GDP 增速', 'growth', 'global', '%', 'annual', 'lagging',
    'The global growth baseline separates country-specific shocks from a common cycle.',
    ['global equities', 'cyclicals'],
    { worldbank: { indicator: 'NY.GDP.MKTP.KD.ZG', country: 'WLD' }, imf: { indicator: 'NGDP_RPCH', country: 'WEOWORLD' } }),
  indicator('cn-industrial-production', 'China industrial production (YoY)', '中国工业增加值同比', 'growth', 'cn', '%', 'monthly', 'coincident',
    'Industry carries the export and capex cycle; strong readings tighten capacity and support industrial metals.',
    ['industrial metals', 'CN cyclicals'],
    { akshare: { function: 'macro_china_industrial_production_yoy' } }),
  indicator('us-industrial-production', 'US industrial production index', '美国工业生产指数', 'growth', 'us', 'index', 'monthly', 'coincident',
    'Production confirms or contradicts the survey data and feeds capacity-utilisation pricing power.',
    ['US cyclicals', 'industrial metals'],
    { fred: { seriesId: 'INDPRO' }, akshare: { function: 'macro_usa_industrial_production' } }),
  indicator('cn-pmi', 'China manufacturing PMI', '中国制造业 PMI', 'growth', 'cn', 'index', 'monthly', 'leading',
    'The first monthly read on the Chinese cycle; the 50 line and the new-orders component drive cyclical positioning.',
    ['CN equities', 'commodities', 'CNY'],
    { akshare: { function: 'macro_china_pmi' } }),
  indicator('cn-services-pmi', 'China non-manufacturing PMI', '中国非制造业 PMI', 'growth', 'cn', 'index', 'monthly', 'leading',
    'Services carry the consumption leg of the Chinese economy after the property downturn.',
    ['CN consumer equities'],
    { akshare: { function: 'macro_china_non_man_pmi' } }),
  indicator('us-pmi', 'US ISM manufacturing PMI', '美国 ISM 制造业 PMI', 'growth', 'us', 'index', 'monthly', 'leading',
    'A leading growth read that historically turns before the equity cycle and the Fed path.',
    ['US equities', 'USTs', 'USD'],
    { akshare: { function: 'macro_usa_ism_pmi' } }),
  indicator('us-services-pmi', 'US ISM services PMI', '美国 ISM 服务业 PMI', 'growth', 'us', 'index', 'monthly', 'leading',
    'Services dominate US output, so this print moves the rates market more than manufacturing.',
    ['US equities', 'USTs'],
    { akshare: { function: 'macro_usa_ism_non_pmi' } }),

  // Inflation
  indicator('cn-cpi', 'China CPI (YoY)', '中国 CPI 同比', 'inflation', 'cn', '%', 'monthly', 'lagging',
    'Food and energy dominate the headline; services CPI is the demand signal worth separating.',
    ['CNY', 'CN bonds'],
    { akshare: { function: 'macro_china_cpi', column: '全国-同比增长' }, worldbank: { indicator: 'FP.CPI.TOTL.ZG', country: 'CHN' }, imf: { indicator: 'PCPIPCH', country: 'CHN' } }),
  indicator('cn-ppi', 'China PPI (YoY)', '中国 PPI 同比', 'inflation', 'cn', '%', 'monthly', 'leading',
    'Factory-gate prices lead corporate margins and commodity demand; negative PPI signals industrial deflation.',
    ['industrial metals', 'CN cyclicals'],
    { akshare: { function: 'macro_china_ppi', column: '当月同比增长' } }),
  indicator('us-cpi', 'US CPI', '美国 CPI', 'inflation', 'us', 'index', 'monthly', 'lagging',
    'The print that moves the front end of the curve; shelter and services stickiness decide the Fed reaction function.',
    ['USTs', 'USD', 'US equities'],
    { fred: { seriesId: 'CPIAUCSL' }, akshare: { function: 'macro_usa_cpi_yoy', unit: '% (YoY)' }, worldbank: { indicator: 'FP.CPI.TOTL.ZG', country: 'USA' }, imf: { indicator: 'PCPIPCH', country: 'USA' } }),
  indicator('us-core-cpi', 'US core CPI', '美国核心 CPI', 'inflation', 'us', 'index', 'monthly', 'lagging',
    'Strips food and energy to expose underlying services inflation.',
    ['USTs', 'USD'],
    { fred: { seriesId: 'CPILFESL' }, akshare: { function: 'macro_usa_core_cpi_monthly', unit: '% (MoM)' } }),
  indicator('us-pce', 'US PCE price index', '美国 PCE 物价指数', 'inflation', 'us', 'index', 'monthly', 'lagging',
    'The Fed policy target family; broader coverage than CPI.',
    ['USTs', 'USD'],
    { fred: { seriesId: 'PCEPI' } }),
  indicator('us-core-pce', 'US core PCE price index', '美国核心 PCE 物价指数', 'inflation', 'us', 'index', 'monthly', 'lagging',
    'The single most important inflation series for the Fed reaction function.',
    ['USTs', 'USD', 'US equities'],
    { fred: { seriesId: 'PCEPILFE' }, akshare: { function: 'macro_usa_core_pce_price', unit: '% (YoY)' } }),
  indicator('us-ppi', 'US PPI (all commodities)', '美国 PPI', 'inflation', 'us', 'index', 'monthly', 'leading',
    'Pipeline prices lead consumer inflation and signal margin pressure.',
    ['US equities', 'USTs'],
    { fred: { seriesId: 'PPIACO' }, akshare: { function: 'macro_usa_ppi', unit: '% (MoM)' } }),
  indicator('global-inflation', 'World inflation (annual %)', '全球通胀率', 'inflation', 'global', '%', 'annual', 'lagging',
    'The global inflation baseline for cross-country real-rate comparison.',
    ['global rates', 'EM assets'],
    { worldbank: { indicator: 'FP.CPI.TOTL.ZG', country: 'WLD' }, imf: { indicator: 'PCPIPCH', country: 'WEOWORLD' } }),

  // Employment
  indicator('us-unemployment-rate', 'US unemployment rate', '美国失业率', 'employment', 'us', '%', 'monthly', 'lagging',
    'The demand-side anchor: a rising rate pulls forward easing expectations.',
    ['USTs', 'USD', 'US equities'],
    { fred: { seriesId: 'UNRATE' }, akshare: { function: 'macro_usa_unemployment_rate', unit: '%' }, worldbank: { indicator: 'SL.UEM.TOTL.ZS', country: 'USA' }, imf: { indicator: 'LUR', country: 'USA' } }),
  indicator('us-nonfarm-payrolls', 'US nonfarm payrolls', '美国非农就业人数', 'employment', 'us', 'thousand persons', 'monthly', 'coincident',
    'The headline labour print; the revision and the wage component usually matter more than the first estimate.',
    ['USTs', 'USD', 'US equities'],
    { fred: { seriesId: 'PAYEMS' }, akshare: { function: 'macro_usa_non_farm', unit: 'thousand persons (change)' } }),
  indicator('us-adp-employment', 'US ADP employment change', '美国 ADP 就业人数', 'employment', 'us', 'thousand persons', 'monthly', 'leading',
    'A private-sector preview that leads the official payroll print.',
    ['USTs', 'USD'],
    { akshare: { function: 'macro_usa_adp_employment' } }),
  indicator('cn-unemployment-rate', 'China urban survey unemployment', '中国城镇调查失业率', 'employment', 'cn', '%', 'monthly', 'lagging',
    'The policy-relevant labour read; youth unemployment is published separately.',
    ['CN equities', 'CNY'],
    { akshare: { function: 'macro_china_urban_unemployment' } }),
  indicator('global-unemployment', 'World unemployment rate', '全球失业率', 'employment', 'global', '%', 'annual', 'lagging',
    'Cross-country labour slack for global cycle comparison.',
    ['global equities'],
    { worldbank: { indicator: 'SL.UEM.TOTL.ZS', country: 'WLD' }, imf: { indicator: 'LUR', country: 'WEOWORLD' } }),

  // Consumption
  indicator('cn-retail-sales', 'China retail sales of consumer goods', '中国社会消费品零售总额', 'consumption', 'cn', '100M CNY', 'monthly', 'coincident',
    'The consumption leg of Chinese demand and the read on the property wealth effect.',
    ['CN consumer equities'],
    { akshare: { function: 'macro_china_consumer_goods_retail' } }),
  indicator('us-retail-sales', 'US retail sales', '美国零售销售', 'consumption', 'us', 'M USD', 'monthly', 'coincident',
    'Consumer resilience feeds services inflation and the growth nowcast.',
    ['US consumer equities', 'USTs'],
    { fred: { seriesId: 'RSAFS' }, akshare: { function: 'macro_usa_retail_sales', unit: '% (MoM)' } }),
  indicator('us-real-consumer-spending', 'US real consumer spending', '美国实际消费支出', 'consumption', 'us', 'B USD', 'monthly', 'coincident',
    'Inflation-adjusted consumption separates volume growth from price effects.',
    ['US equities'],
    { akshare: { function: 'macro_usa_real_consumer_spending', unit: '% (MoM)' } }),
  indicator('us-consumer-sentiment', 'US consumer sentiment (Michigan)', '美国密歇根消费者信心指数', 'consumption', 'us', 'index', 'monthly', 'leading',
    'Sentiment and inflation expectations lead spending and the Fed narrative.',
    ['US equities', 'USTs'],
    { fred: { seriesId: 'UMCSENT' }, akshare: { function: 'macro_usa_michigan_consumer_sentiment' } }),
  indicator('us-consumer-confidence', 'US consumer confidence (Conference Board)', '美国谘商会消费者信心指数', 'consumption', 'us', 'index', 'monthly', 'leading',
    'A second sentiment gauge; divergences with Michigan usually reflect labour vs price concerns.',
    ['US equities'],
    { akshare: { function: 'macro_usa_cb_consumer_confidence' } }),

  // Investment and property
  indicator('cn-real-estate-investment', 'China real estate development investment', '中国房地产开发投资', 'investment', 'cn', '100M CNY', 'monthly', 'coincident',
    'Property is the collateral layer of Chinese credit; its trend drives local-government finance and materials demand.',
    ['CN equities', 'industrial metals', 'CNY'],
    { akshare: { function: 'macro_china_real_estate' } }),
  indicator('cn-new-house-price', 'China new house price index', '中国新建住宅价格指数', 'investment', 'cn', 'index', 'monthly', 'leading',
    'Price momentum in new homes leads transaction volume and developer cash flow.',
    ['CN property equities', 'CNY'],
    { akshare: { function: 'macro_china_new_house_price' } }),
  indicator('us-housing-starts', 'US housing starts', '美国新屋开工', 'investment', 'us', 'thousand units', 'monthly', 'leading',
    'Rate-sensitive construction leads the US investment cycle.',
    ['US homebuilders', 'USTs'],
    { fred: { seriesId: 'HOUST' } }),
  indicator('us-building-permits', 'US building permits', '美国营建许可', 'investment', 'us', 'thousand units', 'monthly', 'leading',
    'Permits lead starts and are the least rate-sensitive edge of the housing pipeline.',
    ['US homebuilders', 'rates'],
    { fred: { seriesId: 'PERMIT' }, akshare: { function: 'macro_usa_building_permits', unit: 'thousand units' } }),

  // Money and credit
  indicator('cn-money-supply', 'China money supply (M0/M1/M2)', '中国货币供应量', 'money-credit', 'cn', '100M CNY', 'monthly', 'coincident',
    'M1 growth is the transaction-demand signal that leads nominal activity.',
    ['CN equities', 'CNY'],
    { akshare: { function: 'macro_china_money_supply' } }),
  indicator('cn-m2', 'China M2 (YoY)', '中国 M2 同比', 'money-credit', 'cn', '%', 'monthly', 'coincident',
    'The broad money baseline; its spread over nominal GDP frames financial conditions.',
    ['CN equities', 'CN bonds'],
    { akshare: { function: 'macro_china_money_supply', column: '货币和准货币(M2)-同比增长' } }),
  indicator('cn-social-financing', 'China total social financing', '中国社会融资规模', 'money-credit', 'cn', '100M CNY', 'monthly', 'coincident',
    'The widest credit measure and the best single read on Chinese liquidity transmission.',
    ['CN equities', 'industrial metals', 'CNY'],
    { akshare: { function: 'macro_china_shrzgm' } }),
  indicator('cn-new-credit', 'China new RMB loans', '中国新增人民币贷款', 'money-credit', 'cn', '100M CNY', 'monthly', 'coincident',
    'Bank credit is the transmission channel from policy to activity in China.',
    ['CN equities', 'CNY'],
    { akshare: { function: 'macro_china_new_financial_credit' } }),
  indicator('us-m2', 'US M2 money stock', '美国 M2 货币供应量', 'money-credit', 'us', 'B USD', 'monthly', 'coincident',
    'Broad liquidity; the direction of the series frames the risk-asset multiple.',
    ['US equities', 'USTs'],
    { fred: { seriesId: 'M2SL' } }),
  indicator('us-fed-balance-sheet', 'Federal Reserve total assets', '美联储总资产', 'money-credit', 'us', 'M USD', 'weekly', 'coincident',
    'Balance-sheet expansion or runoff is the quantity side of US policy.',
    ['USTs', 'USD', 'US equities'],
    { fred: { seriesId: 'WALCL' } }),

  // Policy
  indicator('cn-policy-rate', 'China policy interest rate', '中国政策利率（LPR/MLF）', 'policy', 'cn', '%', 'monthly', 'coincident',
    'The administered price of credit; moves signal the easing or tightening stance.',
    ['CN bonds', 'CNY', 'CN equities'],
    { akshare: { function: 'macro_china_lpr', column: 'LPR1Y' } }),
  indicator('cn-reserve-requirement', 'China reserve requirement ratio', '中国存款准备金率', 'policy', 'cn', '%', 'monthly', 'coincident',
    'Quantity easing tool; cuts signal the liquidity stance before activity data turns.',
    ['CN equities', 'CN bonds'],
    { akshare: { function: 'macro_china_reserve_requirement_ratio' } }),
  indicator('us-fed-funds-rate', 'US effective federal funds rate', '美国联邦基金有效利率', 'policy', 'us', '%', 'daily', 'coincident',
    'The realised policy rate; the path relative to inflation sets real rates across assets.',
    ['USTs', 'USD', 'US equities'],
    { fred: { seriesId: 'DFF' }, akshare: { function: 'macro_bank_usa_interest_rate' } }),

  // Fiscal
  indicator('cn-fiscal-revenue', 'China national tax receipts', '中国全国税收收入', 'fiscal', 'cn', '100M CNY', 'monthly', 'lagging',
    'Revenue tracks activity and frames the room for fiscal stimulus.',
    ['CN equities', 'CN bonds'],
    { akshare: { function: 'macro_china_national_tax_receipts' } }),
  indicator('cn-macro-leverage', 'China macro leverage ratio', '中国宏观杠杆率', 'fiscal', 'cn', '%', 'quarterly', 'lagging',
    'Total debt over GDP; the constraint on credit-led stimulus.',
    ['CN equities', 'CNY'],
    { akshare: { function: 'macro_cnbs' } }),
  indicator('us-federal-debt', 'US central government debt (% of GDP)', '美国政府债务占 GDP', 'fiscal', 'us', '%', 'annual', 'lagging',
    'Debt stock frames the term premium and fiscal risk pricing.',
    ['USTs', 'USD'],
    { worldbank: { indicator: 'GC.DOD.TOTL.GD.ZS', country: 'USA' }, imf: { indicator: 'GGXWDG_NGDP', country: 'USA' } }),
  indicator('cn-government-debt', 'China central government debt (% of GDP)', '中国政府债务占 GDP', 'fiscal', 'cn', '%', 'annual', 'lagging',
    'The formal debt ratio; augment with the leverage ratio for the full picture.',
    ['CN bonds', 'CNY'],
    // The World Bank publishes no Chinese central-government debt rows (all null), so this
    // series is bound to the IMF panel only.
    { imf: { indicator: 'GGXWDG_NGDP', country: 'CHN' } }),
  indicator('global-government-debt', 'World central government debt (% of GDP)', '全球政府债务占 GDP', 'fiscal', 'global', '%', 'annual', 'lagging',
    'Cross-country fiscal space comparison.',
    ['global rates'],
    { worldbank: { indicator: 'GC.DOD.TOTL.GD.ZS', country: 'WLD' }, imf: { indicator: 'GGXWDG_NGDP', country: 'WEOWORLD' } }),

  // External
  indicator('cn-exports', 'China exports (YoY)', '中国出口同比', 'external', 'cn', '%', 'monthly', 'coincident',
    'Export momentum is the external-demand read and a CNY support.',
    ['CNY', 'CN equities', 'global cyclicals'],
    { akshare: { function: 'macro_china_exports_yoy' } }),
  indicator('cn-imports', 'China imports (YoY)', '中国进口同比', 'external', 'cn', '%', 'monthly', 'coincident',
    'Import growth tracks domestic demand and commodity buying.',
    ['industrial metals', 'CN equities'],
    { akshare: { function: 'macro_china_imports_yoy' } }),
  indicator('cn-trade-balance', 'China trade balance', '中国贸易差额', 'external', 'cn', 'USD', 'monthly', 'coincident',
    'Surplus flow supports the currency and reserves.',
    ['CNY', 'CN bonds'],
    { akshare: { function: 'macro_china_trade_balance' } }),
  indicator('cn-fx-reserves', 'China foreign exchange reserves', '中国外汇储备', 'external', 'cn', 'USD', 'monthly', 'lagging',
    'Reserve changes mix valuation effects with intervention.',
    ['CNY', 'global rates'],
    { akshare: { function: 'macro_china_fx_reserves_yearly' } }),
  indicator('us-trade-balance', 'US goods and services trade balance', '美国贸易差额', 'external', 'us', 'M USD', 'monthly', 'coincident',
    'The trade gap feeds net exports and the dollar narrative.',
    ['USD', 'USTs'],
    { fred: { seriesId: 'BOPGSTB' }, akshare: { function: 'macro_usa_trade_balance', unit: 'USD billion' } }),
  indicator('global-current-account', 'World current account balance (% of GDP)', '全球经常账户占 GDP', 'external', 'global', '%', 'annual', 'lagging',
    'Global imbalances frame capital flows and currency pressure.',
    ['global rates', 'EM assets'],
    { imf: { indicator: 'BCA_NGDPD', country: 'WEOWORLD' } }),
  indicator('global-trade-openness', 'World trade (% of GDP)', '全球贸易占 GDP', 'external', 'global', '%', 'annual', 'lagging',
    'Trade intensity tracks globalisation and supply-chain regime.',
    ['global equities', 'shipping'],
    { worldbank: { indicator: 'NE.TRD.GNFS.ZS', country: 'WLD' } }),

  // Market transmission
  indicator('us-10y-yield', 'US 10-year Treasury yield', '美国 10 年期国债收益率', 'market', 'us', '%', 'daily', 'coincident',
    'The global discount rate; its direction prices growth and duration assets.',
    ['USTs', 'US equities', 'USD', 'gold'],
    { fred: { seriesId: 'DGS10' } }),
  indicator('us-2y-yield', 'US 2-year Treasury yield', '美国 2 年期国债收益率', 'market', 'us', '%', 'daily', 'coincident',
    'The front end tracks the expected policy path.',
    ['USTs', 'USD'],
    { fred: { seriesId: 'DGS2' } }),
  indicator('us-yield-curve-10y2y', 'US 10y-2y Treasury spread', '美国 10Y-2Y 期限利差', 'market', 'us', '%', 'daily', 'leading',
    'Inversion has preceded US recessions; re-steepening carries its own signal.',
    ['USTs', 'US equities', 'banks'],
    { fred: { seriesId: 'T10Y2Y' } }),
  indicator('us-real-yield-10y', 'US 10-year real yield (TIPS)', '美国 10 年期实际利率', 'market', 'us', '%', 'daily', 'coincident',
    'Real yields are the cleanest driver of gold and long-duration equity valuations.',
    ['gold', 'US equities', 'USD'],
    { fred: { seriesId: 'DFII10' } }),
  indicator('us-hy-credit-spread', 'US high-yield credit spread (OAS)', '美国高收益债信用利差', 'market', 'us', '%', 'daily', 'leading',
    'Widening spreads are the earliest stress signal in the credit channel.',
    ['credit', 'US equities'],
    { fred: { seriesId: 'BAMLH0A0HYM2' } }),
  indicator('us-ig-credit-spread', 'US investment-grade credit spread (OAS)', '美国投资级信用利差', 'market', 'us', '%', 'daily', 'leading',
    'Investment-grade spreads separate rate-driven from credit-driven moves.',
    ['credit', 'US equities'],
    { fred: { seriesId: 'BAMLC0A0CM' } }),
  indicator('us-dollar-index', 'US dollar index (broad, goods and services)', '美元指数（广义）', 'market', 'us', 'index', 'weekly', 'coincident',
    'Dollar strength tightens global financial conditions and pressures EM and commodities.',
    ['EM assets', 'commodities', 'gold'],
    { fred: { seriesId: 'DTWEXBGS' } }),
  indicator('wti-crude', 'WTI crude oil price', 'WTI 原油价格', 'market', 'us', 'USD/barrel', 'daily', 'leading',
    'Energy is the fastest inflation pass-through and a geopolitics thermometer.',
    ['energy equities', 'inflation', 'CAD', 'NOK'],
    { fred: { seriesId: 'DCOILWTICO' } }),
]

const BY_ID = new Map<string, MacroIndicator>(MACRO_INDICATORS.map(entry => [entry.id, entry]))

/**
 * Look one indicator up by id.
 * @param id - Catalog id.
 * @returns The entry, or undefined when the id is unknown.
 */
export function macroIndicatorById(id: string): MacroIndicator | undefined {
  return BY_ID.get(id)
}

/**
 * Select catalog entries.
 * @param filter - Optional category, country, and source narrowing.
 * @returns Matching entries in catalog order.
 */
export function macroIndicatorsMatching(filter: {
  readonly category?: MacroCategory
  readonly country?: MacroCountry
  readonly source?: MacroSourceId
}): readonly MacroIndicator[] {
  return MACRO_INDICATORS.filter(entry =>
    (filter.category === undefined || entry.category === filter.category)
    && (filter.country === undefined || entry.country === filter.country)
    && (filter.source === undefined || entry.sources[filter.source] !== undefined))
}

/**
 * List the upstreams one entry can be served from.
 * @param entry - Catalog entry.
 * @returns Available source ids in catalog order.
 */
export function macroSourcesOf(entry: MacroIndicator): readonly MacroSourceId[] {
  return MACRO_SOURCES.filter(source => entry.sources[source] !== undefined)
}
