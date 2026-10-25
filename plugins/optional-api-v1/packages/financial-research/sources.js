export const SOURCE_KINDS = Object.freeze({ sec: ['filings', 'fundamentals'], fmp: ['prices', 'fundamentals', 'news', 'analyst', 'insiders'], fred: ['macro'], reddit: ['sentiment'], cftc: ['cot'] });
export const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && dateOnly(value.slice(0, 10)) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export const dateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
// Date-only sources do not supply an intraday timezone. UTC-14 is a conservative
// end-of-day bound; do not silently turn a filing date into midnight publication.
export const dayUpper = value => dateOnly(value) ? new Date(Date.parse(`${value}T00:00:00Z`) + 38 * 3600000).toISOString() : null;

export function selectProvider(args) {
  return args.provider ?? (args.kind === 'cot' ? 'cftc' : args.kind === 'macro' ? 'fred' : args.kind === 'sentiment' ? 'reddit' : args.kind === 'filings' || (args.kind === 'fundamentals' && (!args.statement || args.statement === 'companyfacts')) ? 'sec' : 'fmp');
}

function url(origin, path, params = {}) {
  const value = new URL(path, origin);
  for (const [key, input] of Object.entries(params)) if (input !== undefined && input !== null) value.searchParams.set(key, String(input));
  return value;
}

function candidate(data, response, { observed, available = null, basis = 'unknown', contentAvailable = response.source.retrieved_at, source = response.source.url } = {}) {
  return { data, source_url: source, observed_at: observed ?? null, available_at: available, availability: basis, content_available_at: contentAvailable, retrieved_at: response.source.retrieved_at };
}

function columns(rows) {
  if (!rows || !Array.isArray(rows.accessionNumber)) return [];
  return rows.accessionNumber.map((_, i) => Object.fromEntries(Object.entries(rows).filter(([, values]) => Array.isArray(values)).map(([key, values]) => [key, values[i] ?? null])));
}

const defaultConcepts = new Set(['Assets', 'Liabilities', 'StockholdersEquity', 'CashAndCashEquivalentsAtCarryingValue', 'Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'NetIncomeLoss', 'EarningsPerShareDiluted', 'NetCashProvidedByUsedInOperatingActivities']);

async function sec(args, context) {
  const headers = { 'User-Agent': context.credential('sec_user_agent_env'), Accept: 'application/json' };
  const get = address => context.get(address, { headers, maxBytes: 16 * 1024 * 1024 });
  let cik = args.cik;
  const warnings = [];
  if (!cik) {
    if (args.as_of) return { candidates: [], warnings: ['Historical SEC queries require cik; current ticker mappings cannot establish historical identity.'], limited: true };
    const tickers = await get(new URL('https://www.sec.gov/files/company_tickers.json'));
    const match = Object.values(tickers.data).find(row => row?.ticker?.toUpperCase() === args.symbol.toUpperCase());
    if (!match) return { candidates: [], warnings: ['The SEC current ticker map has no matching company; supply a CIK.'], limited: true };
    cik = String(match.cik_str);
    warnings.push('Company identity was resolved using the current SEC ticker map.');
  }
  const padded = cik.padStart(10, '0');
  const filingURL = (accession, document = '') => /^\d{10}-\d{2}-\d{6}$/.test(accession ?? '')
    ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/${document && /^[A-Za-z0-9._-]+$/.test(document) ? document : `${accession}-index.html`}` : undefined;

  if (args.kind === 'filings') {
    const response = await get(new URL(`https://data.sec.gov/submissions/CIK${padded}.json`));
    if (!response.data?.filings?.recent) throw Object.assign(new Error('Unexpected SEC submissions payload.'), { code: 'SOURCE_PAYLOAD_INVALID' });
    const batches = [{ rows: columns(response.data?.filings?.recent), response }];
    const end = (args.as_of ?? args.end ?? '9999-12-31').slice(0, 10);
    const files = (response.data?.filings?.files ?? []).filter(file => typeof file.name === 'string' && /^CIK\d{10}-submissions-\d+\.json$/.test(file.name) && (!args.start || file.filingTo >= args.start) && file.filingFrom <= end);
    for (const file of files.slice(0, 3)) {
      const older = await get(new URL(`https://data.sec.gov/submissions/${file.name}`));
      batches.push({ rows: columns(older.data), response: older });
    }
    const candidates = batches.flatMap(batch => batch.rows.map(row => {
      const available = timestamp(row.acceptanceDateTime) ?? dayUpper(row.filingDate);
      return candidate({ cik: padded, ...row }, batch.response, { observed: row.filingDate, available, basis: timestamp(row.acceptanceDateTime) ? 'filing_acceptance' : available ? 'filing_day_upper_bound' : 'unknown', contentAvailable: available ?? batch.response.source.retrieved_at, source: filingURL(row.accessionNumber, row.primaryDocument) ?? batch.response.source.url });
    }));
    warnings.push('Filing metadata and document links are returned; document bodies have not been downloaded or independently verified.');
    if (files.length > 3) warnings.push('Older submission files exceed the bounded three-file history scan; narrow the date range.');
    return { candidates, warnings, limited: files.length > 3 };
  }

  const response = await get(new URL(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`));
  if (!response.data?.facts || typeof response.data.facts !== 'object') throw Object.assign(new Error('Unexpected SEC facts payload.'), { code: 'SOURCE_PAYLOAD_INVALID' });
  const candidates = [];
  for (const [taxonomy, facts] of Object.entries(response.data?.facts ?? {})) {
    for (const [concept, fact] of Object.entries(facts ?? {})) {
      if (args.metric ? args.metric !== concept && args.metric !== `${taxonomy}:${concept}` : !defaultConcepts.has(concept)) continue;
      for (const [unit, values] of Object.entries(fact.units ?? {})) for (const row of values) {
        const available = dayUpper(row.filed);
        candidates.push(candidate({ cik: padded, taxonomy, concept, unit, ...row }, response, { observed: row.end, available, basis: available ? 'filing_day_upper_bound' : 'unknown', contentAvailable: available ?? response.source.retrieved_at, source: filingURL(row.accn) ?? response.source.url }));
      }
    }
  }
  warnings.push('SEC facts retain accession numbers and filing dates; later filings and amendments stay separate. This is the current SEC extraction of those filings, not an archived API payload from the filing day.');
  if (!args.metric) warnings.push('Default company-facts selection covers common concepts only; request metric for another concept.');
  return { candidates, warnings, limited: !args.metric };
}

async function fmp(args, context) {
  const paths = { prices: 'historical-price-eod/non-split-adjusted', fundamentals: { income: 'income-statement', balance: 'balance-sheet-statement', cashflow: 'cash-flow-statement' }[args.statement ?? 'income'], news: 'news/stock', analyst: 'grades', insiders: 'insider-trading/search' };
  const params = { [args.kind === 'news' ? 'symbols' : 'symbol']: args.symbol, apikey: context.credential('fmp_key_env') };
  if (args.start) params.from = args.start;
  if (args.end) params.to = args.end;
  if (args.kind !== 'prices') params.limit = args.limit;
  if (args.kind === 'fundamentals') params.period = args.period;
  if (['news', 'insiders'].includes(args.kind)) params.page = 0;
  const response = await context.get(url('https://financialmodelingprep.com', `/stable/${paths[args.kind]}`, params));
  if (!Array.isArray(response.data)) throw Object.assign(new Error('Unexpected FMP payload.'), { code: 'SOURCE_PAYLOAD_INVALID' });
  const candidates = response.data.map(row => {
    const published = row.acceptedDate ?? row.publishedDate ?? row.filingDate;
    const available = timestamp(published);
    return candidate(row, response, { observed: row.date ?? row.transactionDate ?? row.publishedDate ?? null, available, basis: available ? 'source_timestamp_current_version' : 'unknown', source: typeof row.url === 'string' ? context.publicURL(row.url) ?? response.source.url : response.source.url });
  });
  return { candidates, limited: true, warnings: [args.kind === 'prices' ? 'Unadjusted daily prices are for research; exchange timezone, release latency and historical corrections are not supplied. These are not executable quotes.' : 'This endpoint exposes the current source version. Publication/filing dates do not prove that its present content existed then.', ...(args.kind === 'fundamentals' ? [`Requested ${args.period} statements; source fiscalYear, period and date are preserved. Quarterly statements are not TTM; availability times may be unknown.`] : []), 'Single bounded source page; an empty or truncated sample does not establish absence.'] };
}

async function fred(args, context) {
  // FRED vintage parameters have day precision. Choose a whole day already over
  // in every timezone before the requested instant, rather than claiming a
  // same-day release was already known at market open.
  const vintage = args.as_of ? new Date(Date.parse(args.as_of) - 38 * 3600000).toISOString().slice(0, 10) : null;
  const params = { series_id: args.series_id, api_key: context.credential('fred_key_env'), file_type: 'json', sort_order: 'desc', limit: args.limit, observation_start: args.start, observation_end: args.end, realtime_start: vintage, realtime_end: vintage };
  const response = await context.get(url('https://api.stlouisfed.org', '/fred/series/observations', params));
  if (!Array.isArray(response.data?.observations)) throw Object.assign(new Error('Unexpected FRED payload.'), { code: 'SOURCE_PAYLOAD_INVALID' });
  let series;
  try {
    const metadata = await context.get(url('https://api.stlouisfed.org', '/fred/series', { series_id: args.series_id, api_key: context.credential('fred_key_env'), file_type: 'json', realtime_start: vintage, realtime_end: vintage }));
    const row = Array.isArray(metadata.data?.seriess) && metadata.data.seriess.find(item => item.id === args.series_id);
    if (!row || !['title', 'units', 'frequency', 'seasonal_adjustment', 'last_updated'].every(key => typeof row[key] === 'string')) throw Object.assign(new Error('Unexpected FRED series metadata.'), { code: 'SOURCE_PAYLOAD_INVALID' });
    const fields = ['id', 'title', 'units', 'units_short', 'frequency', 'frequency_short', 'seasonal_adjustment', 'seasonal_adjustment_short', 'last_updated', 'realtime_start', 'realtime_end', 'observation_start', 'observation_end'];
    series = { status: 'ok', ...Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, row[key]])), source_url: metadata.source.url, retrieved_at: metadata.source.retrieved_at };
  } catch (error) {
    const reason = /^SOURCE_(?:HTTP_\d{3}|CREDENTIAL_MISSING|TOO_LARGE|PAYLOAD_INVALID|ADDRESS_REJECTED|TIMEOUT)$/.test(error?.code ?? '') ? error.code : 'SOURCE_REQUEST_FAILED';
    series = { status: 'source_unavailable', id: args.series_id, reason, checked_at: new Date(context.now()).toISOString() };
  }
  return {
    candidates: response.data.observations.map(row => candidate({ series_id: args.series_id, ...row }, response, { observed: row.date, available: vintage ? dayUpper(vintage) : null, basis: vintage ? 'fred_vintage_day_upper_bound' : 'unknown', contentAvailable: vintage ? dayUpper(vintage) : response.source.retrieved_at })),
    series,
    limited: series.status !== 'ok' || Number(response.data.count) > response.data.observations.length,
    warnings: [vintage ? `FRED vintage ${vintage}; date precision uses a conservative end-of-day bound, not an intraday publication time.` : 'Current FRED values may be revised. Use as_of for a historical vintage; observation date is not release date.', 'FRED missing-value marker "." is preserved; it is not zero.', 'Series last_updated is the official metadata update time, not an observation publication time. Series retrieval has its own timestamp.', ...(series.status !== 'ok' ? ['Series metadata is unavailable; retained observations are partial evidence. Do not infer their units, frequency or seasonal adjustment.'] : [])],
  };
}

async function reddit(args, context) {
  const address = url('https://oauth.reddit.com', `/r/${args.subreddit ?? 'stocks'}/search`, { q: args.symbol, restrict_sr: 'on', sort: 'new', t: 'all', limit: args.limit, raw_json: 1 });
  const response = await context.get(address, { headers: { Authorization: `Bearer ${context.credential('reddit_token_env')}`, 'User-Agent': context.credential('reddit_user_agent_env') } });
  if (!Array.isArray(response.data?.data?.children)) throw Object.assign(new Error('Unexpected Reddit payload.'), { code: 'SOURCE_PAYLOAD_INVALID' });
  return {
    candidates: response.data.data.children.map(({ data: row }) => {
      const published = typeof row.created_utc === 'number' && Number.isFinite(row.created_utc) ? new Date(row.created_utc * 1000).toISOString() : null;
      const data = { id: row.id, title: row.title, selftext: row.selftext, subreddit: row.subreddit, created_utc: row.created_utc, edited: row.edited, score: row.score, num_comments: row.num_comments, upvote_ratio: row.upvote_ratio, permalink: row.permalink };
      const source = typeof row.permalink === 'string' && /^\/r\/[A-Za-z0-9_]+\/comments\//.test(row.permalink) ? `https://www.reddit.com${row.permalink}` : response.source.url;
      return candidate(data, response, { observed: published, available: published, basis: published ? 'post_creation_current_version' : 'unknown', source });
    }),
    limited: Boolean(response.data.data.after),
    warnings: ['This is a subreddit search sample, not a calibrated sentiment score or market-wide trend. Text, votes and comment counts are current mutable values. Deleted posts and unindexed discussions are absent.'],
  };
}

async function cftc(args, context) {
  const dates = [];
  if (args.start) dates.push(`report_date_as_yyyy_mm_dd >= '${args.start}T00:00:00'`);
  if (args.end) dates.push(`report_date_as_yyyy_mm_dd <= '${args.end}T23:59:59.999'`);
  const response = await context.get(url('https://publicreporting.cftc.gov', '/resource/72hh-3qpy.json', { cftc_contract_market_code: args.market_code, '$where': dates.length ? dates.join(' AND ') : undefined, '$order': 'report_date_as_yyyy_mm_dd DESC', '$limit': args.limit }));
  if (!Array.isArray(response.data) || response.data.some(row => row?.cftc_contract_market_code !== args.market_code || typeof row?.report_date_as_yyyy_mm_dd !== 'string' || !dateOnly(row.report_date_as_yyyy_mm_dd.slice(0, 10)))) throw Object.assign(new Error('Unexpected CFTC disaggregated report payload.'), { code: 'SOURCE_PAYLOAD_INVALID' });
  return {
    candidates: response.data.map(row => candidate(row, response, { observed: row.report_date_as_yyyy_mm_dd.slice(0, 10) })),
    limited: response.data.length >= args.limit,
    warnings: ['CFTC dataset 72hh-3qpy is Disaggregated Futures Only. Original contract units, positions, percentages and trader counts are preserved; do not combine them as one unit or add futures-and-options reports.', 'Report date identifies the position observation, not publication or availability time. available_at is unknown; this fetched version is known only from retrieval onward.', 'Weekly bounded market sample; trader categories do not establish motives, future direction or absence of positions when records are missing.'],
  };
}

export async function querySource(provider, args, context) {
  return ({ sec, fmp, fred, reddit, cftc })[provider](args, context);
}
