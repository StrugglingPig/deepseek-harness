import { describe, expect, it } from 'vitest'
import { FinanceDataError } from '../src/error.ts'
import {
  MACRO_INDICATORS, macroIndicatorById, macroIndicatorsMatching, macroSourcesOf, type MacroIndicator,
} from '../src/macro-catalog.ts'
import {
  SettingsFinanceMacroDataProvider, buildMacroSeries, normalizeObservations,
  type MacroObservation, type MacroSeriesLoader, type MacroSeriesQuery,
} from '../src/macro.ts'
import {
  CftcMacroLoader, EiaMacroLoader, FredMacroLoader, ImfMacroLoader, WorldBankMacroLoader,
  type MacroHttpTransport,
} from '../src/macro-http.ts'
import { AkshareMacroLoader } from '../src/macro-akshare.ts'
import type { FinanceJsonValue } from '../src/types.ts'

const cpi = macroIndicatorById('us-cpi') as MacroIndicator
const pmi = macroIndicatorById('cn-pmi') as MacroIndicator
const worldGrowth = macroIndicatorById('global-gdp-growth') as MacroIndicator
const crudeStocks = macroIndicatorById('eia-crude-stocks') as MacroIndicator
const goldPositioning = macroIndicatorById('cftc-gold-net') as MacroIndicator

function query(indicator: MacroIndicator, patch: Partial<MacroSeriesQuery> = {}): MacroSeriesQuery {
  return { indicator, country: indicator.country, ...patch }
}

function transport(payload: FinanceJsonValue, capture?: (request: unknown) => void): MacroHttpTransport {
  return {
    async request(request) {
      capture?.(request)
      return {
        provider: 'http',
        base: request.base,
        method: 'GET' as const,
        path: request.path,
        status: 200,
        data: payload,
      }
    },
  }
}

function loader(id: MacroSeriesLoader['id'], observations: readonly MacroObservation[], fail?: string): MacroSeriesLoader {
  return {
    id,
    async load() {
      if (fail !== undefined) throw new FinanceDataError(fail, 'MACRO_SOURCE_FAILED')
      return observations
    },
  }
}

describe('macro catalog', () => {
  it('looks indicators up by id and lists their upstreams', () => {
    expect(macroIndicatorById('us-cpi')?.name).toBe('US CPI')
    expect(macroIndicatorById('missing')).toBeUndefined()
    expect(macroSourcesOf(cpi)).toEqual(['akshare', 'fred', 'worldbank', 'imf'])
    expect(macroSourcesOf(pmi)).toEqual(['akshare'])
    expect(macroIndicatorById('us-10y-yield')?.sources.fred?.seriesId).toBe('DGS10')
  })

  it('filters by category, country, and source', () => {
    expect(macroIndicatorsMatching({}).length).toBe(MACRO_INDICATORS.length)
    expect(macroIndicatorsMatching({ country: 'global' }).every(entry => entry.country === 'global')).toBe(true)
    expect(macroIndicatorsMatching({ category: 'market' }).every(entry => entry.category === 'market')).toBe(true)
    expect(macroIndicatorsMatching({ source: 'imf' }).every(entry => entry.sources.imf !== undefined)).toBe(true)
    expect(macroIndicatorsMatching({ category: 'market', source: 'akshare' })).toEqual([])
    expect(macroIndicatorsMatching({ country: 'cn', category: 'policy' }).map(entry => entry.id))
      .toEqual(['cn-policy-rate', 'cn-reserve-requirement'])
  })
})

describe('macro normalization', () => {
  it('de-duplicates, drops blanks, filters the range, and keeps the newest window', () => {
    const observations = [
      { date: '2026-03', value: 3 },
      { date: '2026-01', value: 1 },
      { date: '2026-02', value: 2 },
      { date: '2026-02', value: 2.5 },
      { date: '2026-04', value: Number.NaN },
    ]
    expect(normalizeObservations(observations)).toEqual([
      { date: '2026-01', value: 1 },
      { date: '2026-02', value: 2.5 },
      { date: '2026-03', value: 3 },
    ])
    expect(normalizeObservations(observations, { startDate: '2026-02', endDate: '2026-03' })).toEqual([
      { date: '2026-02', value: 2.5 },
      { date: '2026-03', value: 3 },
    ])
    expect(normalizeObservations(observations, { limit: 1 })).toEqual([{ date: '2026-03', value: 3 }])
    expect(normalizeObservations(observations, { limit: 40 })).toHaveLength(3)
  })

  it('rejects an empty series and reports the latest change', () => {
    expect(() => buildMacroSeries(query(cpi), 'fred', [])).toThrow(FinanceDataError)
    const single = buildMacroSeries(query(cpi), 'fred', [{ date: '2026-01', value: 1 }], () => new Date(0))
    expect(single.previous).toBeUndefined()
    expect(single.retrievedAt).toBe('1970-01-01T00:00:00.000Z')
    const series = buildMacroSeries(query(cpi), 'fred', [
      { date: '2026-01', value: 1 },
      { date: '2026-02', value: 3 },
    ])
    expect(series.latest).toEqual({ date: '2026-02', value: 3 })
    expect(series.previous).toEqual({ date: '2026-01', value: 1 })
    expect(series.nameZh).toBe('美国 CPI')
  })

  it('reports the latest outcome as latest and keeps trailing projections in the series', () => {
    const series = buildMacroSeries(query(cpi), 'imf', [
      { date: '2024', value: 1 },
      { date: '2025', value: 2 },
      { date: '2030', value: 8, projection: true },
      { date: '2031', value: 9, projection: true },
    ])
    expect(series.latest).toEqual({ date: '2025', value: 2 })
    expect(series.previous).toEqual({ date: '2024', value: 1 })
    expect(series.observations).toHaveLength(4)
  })

  it('falls back to the newest projected period when an upstream publishes nothing else', () => {
    const series = buildMacroSeries(query(cpi), 'imf', [{ date: '2031', value: 9, projection: true }])
    expect(series.latest).toEqual({ date: '2031', value: 9, projection: true })
    expect(series.previous).toBeUndefined()
  })
})

describe('macro provider routing', () => {
  it('lets the serving loader override the catalog unit', async () => {
    const override: MacroSeriesLoader = {
      id: 'akshare',
      unit: () => '% (MoM)',
      async load() { return [{ date: '2026-01', value: 0.3 }] },
    }
    const matching: MacroSeriesLoader = {
      id: 'akshare',
      unit: () => cpi.unit,
      async load() { return [{ date: '2026-01', value: 1 }] },
    }
    const provider = new SettingsFinanceMacroDataProvider([loader('akshare', [{ date: '2026-01', value: 2 }])])
    // No loader override: the catalog unit stands.
    await expect(provider.load(query(pmi))).resolves.toMatchObject({ unit: 'index' })

    const overridden = new SettingsFinanceMacroDataProvider([override])
    await expect(overridden.load(query(pmi, { source: 'akshare' }))).resolves.toMatchObject({ unit: '% (MoM)' })

    // A loader that agrees with the catalog leaves the catalog unit in place.
    const same = new SettingsFinanceMacroDataProvider([matching])
    await expect(same.load(query(cpi, { source: 'akshare' }))).resolves.toMatchObject({ unit: 'index' })
  })

  it('serves an explicit source and rejects an unbound one', async () => {
    const provider = new SettingsFinanceMacroDataProvider([loader('akshare', [{ date: '2026-01', value: 2 }])])
    await expect(provider.load(query(pmi, { source: 'akshare' }))).resolves.toMatchObject({
      source: 'akshare',
      latest: { value: 2 },
    })
    await expect(provider.load(query(pmi, { source: 'fred' }))).rejects.toMatchObject({ code: 'MACRO_SOURCE_UNAVAILABLE' })
    await expect(provider.load(query(pmi, { source: 'fred' }))).rejects.toThrow(FinanceDataError)
  })

  it('rejects an indicator without bindings and a source missing from the composition', async () => {
    const bare: MacroIndicator = { ...pmi, sources: {} }
    const provider = new SettingsFinanceMacroDataProvider([])
    await expect(provider.load(query(bare))).rejects.toThrow(/has no upstream binding/)
    await expect(provider.load(query(pmi, { source: 'akshare' }))).rejects.toThrow(/not available in this composition/)
  })

  it('loads every bound upstream on auto and reports every failure', async () => {
    const provider = new SettingsFinanceMacroDataProvider([
      loader('fred', [], 'fred exploded'),
      loader('akshare', [{ date: '2026-02', value: 5 }]),
    ])
    await expect(provider.load(query(cpi))).resolves.toMatchObject({ source: 'akshare', latest: { value: 5 } })

    const failing = new SettingsFinanceMacroDataProvider([
      loader('fred', [], 'fred exploded'),
      loader('akshare', [], 'akshare exploded'),
    ])
    await expect(failing.load(query(cpi))).rejects.toThrow(/fred exploded; akshare: akshare exploded/)
  })

  it('breaks an auto tie with the documented source order when loaders arrive later', async () => {
    const provider = new SettingsFinanceMacroDataProvider([loader('worldbank', [{ date: '2026-01', value: 1 }])])
    provider.addLoader(loader('akshare', [{ date: '2026-01', value: 2 }]))
    provider.addLoader(loader('fred', [{ date: '2026-01', value: 3 }]))
    // All three publish the same period, so the documented order decides.
    await expect(provider.load(query(cpi))).resolves.toMatchObject({ source: 'fred' })

    const replacing = new SettingsFinanceMacroDataProvider([loader('fred', [{ date: '2026-01', value: 1 }])])
    replacing.addLoader(loader('fred', [{ date: '2026-01', value: 9 }]))
    await expect(replacing.load(query(cpi))).resolves.toMatchObject({ latest: { value: 9 } })
  })

  it('keeps the upstream publishing the latest period, not the catalog order', async () => {
    const provider = new SettingsFinanceMacroDataProvider([
      loader('fred', [{ date: '2025-12', value: 1 }]),
      loader('akshare', [{ date: '2026-02', value: 2 }]),
    ])
    await expect(provider.load(query(cpi))).resolves.toMatchObject({ source: 'akshare', latest: { value: 2 } })
  })

  it('ignores projected periods when picking the freshest upstream', async () => {
    const provider = new SettingsFinanceMacroDataProvider([
      loader('fred', [{ date: '2025-12', value: 1 }, { date: '2031', value: 9, projection: true }]),
      loader('akshare', [{ date: '2026-02', value: 2 }]),
    ])
    await expect(provider.load(query(cpi))).resolves.toMatchObject({ source: 'akshare' })
  })

  it('falls back to the published label when every observation is a projection', async () => {
    const provider = new SettingsFinanceMacroDataProvider([
      loader('fred', [{ date: '2030', value: 1, projection: true }]),
      loader('akshare', [{ date: '2031', value: 2, projection: true }]),
    ])
    await expect(provider.load(query(cpi))).resolves.toMatchObject({ source: 'akshare', latest: { value: 2 } })
  })

  it('prefers the widest coverage when the request names a date range', async () => {
    const provider = new SettingsFinanceMacroDataProvider([
      loader('akshare', [{ date: '2026-01', value: 1 }, { date: '2026-04', value: 4 }]),
      loader('worldbank', [{ date: '2026-01', value: 1 }, { date: '2026-02', value: 2 }, { date: '2026-03', value: 3 }]),
    ])
    await expect(provider.load(query(cpi))).resolves.toMatchObject({ source: 'akshare' })
    await expect(provider.load(query(cpi, { startDate: '2026-01-01', endDate: '2026-03-31' })))
      .resolves.toMatchObject({ source: 'worldbank', latest: { value: 3 } })
  })

  it('ranks mixed period granularities against each other', async () => {
    const sourceFor = async (left: string, right: string): Promise<string> => {
      const provider = new SettingsFinanceMacroDataProvider([
        loader('akshare', [{ date: left, value: 1 }]),
        loader('worldbank', [{ date: right, value: 2 }]),
      ])
      return (await provider.load(query(cpi))).source
    }
    await expect(sourceFor('2026-08', '2026-08-15')).resolves.toBe('worldbank')
    await expect(sourceFor('2026-08', '2026-Q3')).resolves.toBe('akshare')
    await expect(sourceFor('2026-Q4', '2026-Q3')).resolves.toBe('akshare')
    await expect(sourceFor('2026', '2026-01')).resolves.toBe('akshare')
    await expect(sourceFor('2026-QX', '2026')).resolves.toBe('akshare')
    await expect(sourceFor('nope', '2026-01')).resolves.toBe('worldbank')
  })

  it('skips a loader the requested indicator is not bound to and stringifies non-Error failures', async () => {
    const provider = new SettingsFinanceMacroDataProvider([
      loader('fred', [{ date: '2026-01', value: 1 }]),
      loader('akshare', [{ date: '2026-02', value: 2 }]),
    ])
    // cn-pmi has no FRED binding, so the FRED loader is skipped rather than tried.
    await expect(provider.load(query(pmi))).resolves.toMatchObject({ source: 'akshare', latest: { value: 2 } })

    const thrown = new SettingsFinanceMacroDataProvider([{
      id: 'akshare',
      async load() { throw 'string failure' },
    }])
    await expect(thrown.load(query(pmi))).rejects.toThrow(/akshare: string failure/)
  })

  it('stops walking when the caller aborts', async () => {
    const controller = new AbortController()
    const provider = new SettingsFinanceMacroDataProvider([{
      id: 'fred',
      async load() {
        controller.abort()
        throw new FinanceDataError('fred exploded', 'MACRO_SOURCE_FAILED')
      },
    }])
    await expect(provider.load(query(cpi), controller.signal)).rejects.toMatchObject({ code: 'ABORTED' })
  })
})

describe('FRED loader', () => {
  it('reads observations and skips blank cells', async () => {
    const seen: unknown[] = []
    const fred = new FredMacroLoader(transport({ observations: [
      { date: '2026-01-01', value: '3.4' },
      { date: '2026-02-01', value: '.' },
      { date: '2026-03-01', value: 'not-a-number' },
      { date: '2026-04-01', value: 4 },
      { date: '2026-05-01', value: Number.NaN },
      { date: 'missing-value' },
    ] }, request => seen.push(request)), () => true)
    await expect(fred.load(query(cpi, { startDate: '2026-01-01', endDate: '2026-04-01' }))).resolves.toEqual([
      { date: '2026-01-01', value: 3.4 },
      { date: '2026-04-01', value: 4 },
    ])
    expect(seen[0]).toMatchObject({
      base: 'fred',
      path: '/fred/series/observations',
      query: { series_id: 'CPIAUCSL', file_type: 'json', observation_start: '2026-01-01', observation_end: '2026-04-01' },
      auth: 'api-key',
    })
  })

  it('rejects an unbound indicator, a disabled switch, and a malformed body', async () => {
    const enabled = new FredMacroLoader(transport({}), () => true)
    await expect(enabled.load(query(pmi))).rejects.toThrow(/has no FRED series/)

    const disabled = new FredMacroLoader(transport({}), () => false)
    await expect(disabled.load(query(cpi))).rejects.toMatchObject({ code: 'MACRO_SOURCE_DISABLED' })

    const malformed = new FredMacroLoader(transport({ observations: 'nope' }), () => true)
    await expect(malformed.load(query(cpi))).rejects.toThrow(/no observation array/)

    const scalarBody = new FredMacroLoader(transport('nope'), () => true)
    await expect(scalarBody.load(query(cpi))).rejects.toThrow(/no observation array/)
  })
})

describe('EIA loader', () => {
  it('reads the seriesid route, reorders newest-first rows, and skips blank periods', async () => {
    const seen: unknown[] = []
    const eia = new EiaMacroLoader(transport({
      // EIA answers newest first, so the loader has to reorder before the
      // provider decides which observation is current.
      response: { data: [
        { period: '2026-09-11', value: '' },
        { period: '2026-09-04', value: 415_000 },
        { period: '2026-08-28', value: 424_460 },
        { period: 7, value: 1 },
      ] },
    }, request => seen.push(request)), () => true)
    await expect(eia.load(query(crudeStocks))).resolves.toEqual([
      { date: '2026-08-28', value: 424_460 },
      { date: '2026-09-04', value: 415_000 },
    ])
    expect(seen[0]).toMatchObject({
      base: 'eia',
      path: '/seriesid/PET.WCESTUS1.W',
      auth: 'api-key',
    })
  })

  it('rejects an unbound indicator, a disabled switch, and a malformed body', async () => {
    await expect(new EiaMacroLoader(transport({}), () => true).load(query(pmi))).rejects.toThrow(/has no EIA series/)
    await expect(new EiaMacroLoader(transport({}), () => false).load(query(crudeStocks)))
      .rejects.toMatchObject({ code: 'MACRO_SOURCE_DISABLED' })
    await expect(new EiaMacroLoader(transport({ response: { data: 'nope' } }), () => true).load(query(crudeStocks)))
      .rejects.toThrow(/no data rows/)
    await expect(new EiaMacroLoader(transport({}), () => true).load(query(crudeStocks)))
      .rejects.toThrow(/no data rows/)
  })
})

describe('CFTC loader', () => {
  it('reads the weekly non-commercial net position in date order', async () => {
    const seen: unknown[] = []
    const cftc = new CftcMacroLoader(transport([
      { report_date_as_yyyy_mm_dd: '2026-09-15T00:00:00.000', noncomm_positions_long_all: '258059', noncomm_positions_short_all: '27721' },
      { report_date_as_yyyy_mm_dd: '2026-09-08T00:00:00.000', noncomm_positions_long_all: 240_000, noncomm_positions_short_all: 20_000 },
      { report_date_as_yyyy_mm_dd: '2026-09-01T00:00:00.000' },
    ], request => seen.push(request)))
    await expect(cftc.load(query(goldPositioning))).resolves.toEqual([
      { date: '2026-09-08', value: 220_000 },
      { date: '2026-09-15', value: 230_338 },
    ])
    expect(seen[0]).toMatchObject({
      base: 'cftc',
      path: '/resource/6dca-aqww.json',
      query: {
        $where: "market_and_exchange_names='GOLD - COMMODITY EXCHANGE INC.'",
        $order: 'report_date_as_yyyy_mm_dd DESC',
        $limit: '26',
      },
    })
  })

  it('rejects an unbound indicator and a malformed body', async () => {
    await expect(new CftcMacroLoader(transport([])).load(query(pmi))).rejects.toThrow(/has no CFTC market/)
    const scalar = new CftcMacroLoader(transport({ rows: [] }))
    await expect(scalar.load(query(goldPositioning))).rejects.toThrow(/no report rows/)
  })
})

describe('World Bank loader', () => {
  it('reads the second envelope element and passes a year range', async () => {
    const seen: unknown[] = []
    const bank = new WorldBankMacroLoader(transport([
      { page: 1 },
      [{ date: '2025', value: 5 }, { date: '2026', value: null }, { date: '2027', value: 6.5 }],
    ], request => seen.push(request)))
    await expect(bank.load(query(worldGrowth, { startDate: '2025-01-01', endDate: '2027-12-31' }))).resolves.toEqual([
      { date: '2025', value: 5 },
      { date: '2027', value: 6.5 },
    ])
    expect(seen[0]).toMatchObject({
      base: 'worldbank',
      path: `/v2/country/WLD/indicator/${worldGrowth.sources.worldbank?.indicator as string}`,
      query: { format: 'json', per_page: '200', date: '2025:2027' },
    })
  })

  it('rejects an unbound indicator and malformed envelopes', async () => {
    await expect(new WorldBankMacroLoader(transport([])).load(query(pmi))).rejects.toThrow(/has no World Bank indicator/)
    await expect(new WorldBankMacroLoader(transport({})).load(query(worldGrowth))).rejects.toThrow(/unexpected envelope/)
    await expect(new WorldBankMacroLoader(transport([{}, 'nope'])).load(query(worldGrowth))).rejects.toThrow(/no observation rows/)
    const unbounded = new WorldBankMacroLoader(transport([{}, []]))
    await expect(unbounded.load(query(worldGrowth))).resolves.toEqual([])

    // A one-sided window still sends a World Bank date range, on either side.
    const seen: unknown[] = []
    const oneSided = new WorldBankMacroLoader(transport([{}, []], request => seen.push(request)))
    await oneSided.load(query(worldGrowth, { startDate: '2025-01-01' }))
    await oneSided.load(query(worldGrowth, { endDate: '2026-12-31' }))
    expect(seen[0]).toMatchObject({ query: { date: '2025:' } })
    expect(seen[1]).toMatchObject({ query: { date: ':2026' } })
  })
})

describe('IMF loader', () => {
  it('reads one country out of the DataMapper payload', async () => {
    const imf = new ImfMacroLoader(transport({
      values: { NGDP_RPCH: { USA: { 2024: 2.8, 2025: 'n/a' }, CHN: { 2024: 5 } } },
    }))
    await expect(imf.load(query(postGrowth()))).resolves.toEqual([{ date: '2024', value: 2.8 }])
  })

  it('rejects an unbound indicator and a missing country series', async () => {
    await expect(new ImfMacroLoader(transport({})).load(query(pmi))).rejects.toThrow(/has no IMF indicator/)
    await expect(new ImfMacroLoader(transport({ values: {} })).load(query(worldGrowth))).rejects.toThrow(/no WEOWORLD series/)
  })
})

/** The US entry of the IMF-bound growth indicator. */
function postGrowth(): MacroIndicator {
  return macroIndicatorById('us-gdp-growth') as MacroIndicator
}

describe('AKShare macro loader', () => {
  it('reads observations from the Python bridge', async () => {
    const seen: unknown[] = []
    const loaderUnderTest = new AkshareMacroLoader({
      async run(request) {
        seen.push(request)
        return { function: 'macro_china_pmi', observations: [{ date: '2026-01', value: 50.2 }] }
      },
    }, () => true)
    await expect(loaderUnderTest.load(query(pmi))).resolves.toEqual([{ date: '2026-01', value: 50.2 }])
    expect(seen[0]).toEqual({ action: 'macro_series', function: 'macro_china_pmi' })
  })

  it('rejects an unbound indicator, a disabled switch, and an empty frame', async () => {
    const bridge = { run: async () => ({ function: 'x', observations: [] }) }
    await expect(new AkshareMacroLoader(bridge, () => true).load(query(macroIndicatorById('us-10y-yield') as MacroIndicator)))
      .rejects.toThrow(/has no AKShare macro function/)
    await expect(new AkshareMacroLoader(bridge, () => false).load(query(pmi))).rejects.toMatchObject({ code: 'MACRO_SOURCE_DISABLED' })
    await expect(new AkshareMacroLoader(bridge, () => true).load(query(pmi))).rejects.toMatchObject({ code: 'MACRO_EMPTY' })
  })

  it('marks IMF projections beyond the current year and leaves outcomes unflagged', async () => {
    const imf = new ImfMacroLoader(
      transport({ values: { NGDP_RPCH: { USA: { 2025: 2.1, 2030: 1.8 } } } }),
      () => new Date(Date.UTC(2026, 8, 21)),
    )
    await expect(imf.load(query(postGrowth()))).resolves.toEqual([
      { date: '2025', value: 2.1 },
      { date: '2030', value: 1.8, projection: true },
    ])
  })

  it('passes catalog parameters and the value column through to the bridge', async () => {
    const withParams: MacroIndicator = {
      ...pmi,
      sources: { akshare: { function: 'macro_china_pmi', params: { year: '2026' }, column: '制造业-指数' } },
    }
    const seen: unknown[] = []
    const loaderUnderTest = new AkshareMacroLoader({
      async run(request) {
        seen.push(request)
        return { function: 'macro_china_pmi', observations: [{ date: '2026-01', value: 1 }] }
      },
    }, () => true)
    await loaderUnderTest.load(query(withParams))
    expect(seen[0]).toEqual({
      action: 'macro_series',
      function: 'macro_china_pmi',
      params: { year: '2026' },
      column: '制造业-指数',
    })
  })
})
