import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createService } from '../packages/financial-research/service.js';
import { createCapabilities } from '../packages/financial-research/index.js';
import { closeRecords, records } from '../packages/financial-research/records.js';
import { nativeHost, hostRoot } from './host-v2-fixture.mjs';

const test = (name, fn) => nodeTest(name, { skip: !hostRoot }, fn);
async function fixture(t, responder) {
  const native = await nativeHost(t), host = native.attach('financial-research', createCapabilities);
  native.onDispose(() => closeRecords(host));
  const calls = [], env = { FMP_API_KEY: 'fixture-research-period-secret', FRED_API_KEY: 'fixture-research-fred-secret' };
  let time = Date.parse('2026-10-18T10:00:00Z');
  const fetch = async address => {
    const url = new URL(address); calls.push(url);
    const value = responder ? responder(url) : [{ symbol: 'AAPL', date: '2026-06-27', period: url.searchParams.get('period') === 'quarter' ? 'Q3' : 'FY', fiscalYear: '2026' }];
    return value instanceof Response ? value : new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  };
  const service = () => createService(host, { env, fetch, now: () => time });
  return { host, calls, env, service, advance: ms => time += ms, time: () => time };
}

test('registered FMP statements expose annual and quarterly source periods', async t => {
  const f = await fixture(t), manifest = JSON.parse(readFileSync(new URL('../packages/financial-research/capabilities.json', import.meta.url)));
  const schema = manifest.capabilities.find(c => c.id === 'financial_research_query').inputSchema;
  assert.deepEqual(schema.properties.period.anyOf.map(item => item.const), ['annual', 'quarter']);
  for (const statement of ['income', 'balance', 'cashflow']) {
    const r = await f.service().query({ kind: 'fundamentals', provider: 'fmp', symbol: 'AAPL', statement, period: 'quarter', limit: 3 });
    assert.equal(f.calls.at(-1).searchParams.get('period'), 'quarter');
    assert.equal(r.rows[0].data.period, 'Q3');
    assert.equal(records(f.host).get('datasets', r.dataset_id).provenance.query.period, 'quarter');
  }
  await f.service().query({ kind: 'fundamentals', provider: 'fmp', symbol: 'AAPL', statement: 'income' });
  assert.equal(f.calls.at(-1).searchParams.get('period'), 'annual');
});

test('historical statement reuse never substitutes quarterly and annual evidence', async t => {
  const f = await fixture(t), base = { kind: 'fundamentals', provider: 'fmp', symbol: 'AAPL', statement: 'cashflow' };
  const annual = await f.service().query(base); f.advance(1000);
  const quarter = await f.service().query({ ...base, period: 'quarter' }); f.advance(1000);
  const as_of = new Date(f.time()).toISOString();
  const annualPast = await f.service().query({ ...base, as_of });
  const quarterPast = await f.service().query({ ...base, period: 'quarter', as_of });
  assert.equal(annualPast.dataset_id, annual.dataset_id);
  assert.equal(annualPast.rows[0].data.period, 'FY');
  assert.equal(quarterPast.dataset_id, quarter.dataset_id);
  assert.equal(quarterPast.rows[0].data.period, 'Q3');
  assert.equal(f.calls.length, 2);
});

test('statement period rejects unsupported combinations before contacting a source', async t => {
  const f = await fixture(t);
  for (const input of [
    { kind: 'fundamentals', provider: 'fmp', symbol: 'AAPL', period: 'monthly' },
    { kind: 'prices', symbol: 'AAPL', period: 'quarter' },
    { kind: 'fundamentals', provider: 'sec', cik: '320193', period: 'quarter' },
  ]) await assert.rejects(f.service().query(input), { code: 'INVALID_ARGUMENT' });
  assert.equal(f.calls.length, 0);
});

test('status separates credential presence from timed endpoint-and-query access evidence', async t => {
  const f = await fixture(t, url => url.pathname.includes('insider-trading')
    ? new Response('subscription restriction', { status: 402 })
    : [{ symbol: 'AAPL', date: '2026-10-16', adjClose: 343.46 }]);
  const prices = { kind: 'prices', symbol: 'AAPL', start: '2026-10-01', end: '2026-10-16', limit: 3 };
  await f.service().query(prices); f.advance(1000);
  await f.service().query({ kind: 'insiders', symbol: 'AAPL', limit: 5 });
  const source = f.service().status().sources.find(item => item.provider === 'fmp');
  assert.equal(source.configured, true);
  const denied = source.last_checks.find(row => row.query.kind === 'insiders');
  const allowed = source.last_checks.find(row => row.query.kind === 'prices');
  assert.equal(denied.status, 'source_unavailable');
  assert.equal(denied.reason, 'SOURCE_HTTP_402');
  assert.equal(denied.query.symbol, 'AAPL');
  assert.equal(denied.query.limit, 5);
  assert.equal(denied.checked_at, '2026-10-18T10:00:01.000Z');
  assert.equal(allowed.status, 'partial');
  assert.equal(allowed.row_count, 1);
  assert.equal(allowed.query.start, prices.start);
  assert.equal(allowed.query.end, prices.end);
  assert.equal(JSON.stringify(source).includes(f.env.FMP_API_KEY), false);
  f.advance(1000);
  await f.service().query({ ...prices, as_of: new Date(f.time()).toISOString() });
  assert.deepEqual(f.service().status().sources.find(item => item.provider === 'fmp').last_checks, source.last_checks);
  assert.equal(f.calls.length, 2);
});


test('FRED metadata is frozen with its own retrieval and update times without inventing observation availability', async t => {
  const f = await fixture(t, url => url.pathname.endsWith('/observations')
    ? { count: 2, observations: [{ date: '2026-10-15', value: '5.1' }, { date: '2026-10-12', value: '.' }] }
    : { seriess: [{ id: 'DGS10', title: '10-Year Treasury Constant Maturity Rate', units: 'Percent', frequency: 'Daily', seasonal_adjustment: 'Not Seasonally Adjusted', last_updated: '2026-10-16 15:16:04-05', realtime_start: '2026-10-18', realtime_end: '2026-10-18' }] });
  const r = await f.service().query({ kind: 'macro', series_id: 'DGS10', limit: 10 });
  assert.equal(r.status, 'ok');
  assert.equal(r.series.status, 'ok');
  assert.equal(r.series.units, 'Percent');
  assert.equal(r.series.frequency, 'Daily');
  assert.equal(r.series.last_updated, '2026-10-16 15:16:04-05');
  assert.equal(r.series.retrieved_at, '2026-10-18T10:00:00.000Z');
  assert.ok(r.rows.every(row => row.available_at === null));
  assert.equal(r.rows[1].data.value, '.');
  assert.equal(r.sources.length, 2);
  assert.equal(r.series.source_url.includes('api_key'), false);
  const saved = f.service().read({ dataset_id: r.dataset_id });
  assert.deepEqual(saved.series, r.series);
  assert.deepEqual(saved.provenance.series, r.series);
  assert.deepEqual(f.service().status().sources.find(source => source.provider === 'fred').last_checks[0].series, r.series);
  assert.equal(f.calls.length, 2);
});

test('FRED series metadata uses the same requested vintage but last_updated is not an observation cutoff', async t => {
  const f = await fixture(t, url => url.pathname.endsWith('/observations')
    ? { count: 1, observations: [{ date: '2026-10-13', value: '5.2' }] }
    : { seriess: [{ id: 'DGS10', title: 'Treasury yield', units: 'Percent', frequency: 'Daily', seasonal_adjustment: 'Not Seasonally Adjusted', last_updated: '2026-10-17 15:16:04-05' }] });
  const r = await f.service().query({ kind: 'macro', series_id: 'DGS10', as_of: '2026-10-16T17:00:00Z' });
  assert.equal(r.total, 1);
  assert.equal(r.rows[0].available_at, '2026-10-16T14:00:00.000Z');
  assert.equal(r.series.last_updated, '2026-10-17 15:16:04-05');
  assert.equal(f.calls[1].pathname, '/fred/series');
  assert.equal(f.calls[1].searchParams.get('realtime_start'), '2026-10-15');
  assert.equal(f.calls[1].searchParams.get('realtime_end'), '2026-10-15');
  assert.match(r.warnings.join(' '), /last_updated.*not.*observation/i);
});

test('FRED metadata failures retain observations as partial and never invent units or leak source error text', async t => {
  const f = await fixture(t, url => url.pathname.endsWith('/observations')
    ? { count: 1, observations: [{ date: '2026-10-15', value: '5.1' }] }
    : new Response('fixture-research-fred-secret subscription error', { status: 403 }));
  const r = await f.service().query({ kind: 'macro', series_id: 'DGS10' });
  assert.equal(r.status, 'partial');
  assert.equal(r.total, 1);
  assert.ok(r.dataset_id);
  assert.equal(r.series.status, 'source_unavailable');
  assert.equal(r.series.reason, 'SOURCE_HTTP_403');
  assert.equal(r.series.units, undefined);
  assert.equal(r.series.checked_at, '2026-10-18T10:00:00.000Z');
  assert.equal(JSON.stringify(r).includes(f.env.FRED_API_KEY), false);
  assert.equal(f.service().read({ dataset_id: r.dataset_id }).rows[0].data.value, '5.1');
});

test('registered CFTC query is anonymous, fixed to futures-only disaggregated reports and preserves source fields', async t => {
  const row = { cftc_contract_market_code: '088691', market_and_exchange_names: 'GOLD - COMMODITY EXCHANGE INC.', report_date_as_yyyy_mm_dd: '2026-10-13T00:00:00.000', contract_units: '(CONTRACTS OF 100 TROY OUNCES)', open_interest_all: '485809', m_money_positions_long_all: '177404', m_money_positions_short_all: '30068', source_extra_field: 'retained' };
  const f = await fixture(t, () => [row]), manifest = JSON.parse(readFileSync(new URL('../packages/financial-research/capabilities.json', import.meta.url)));
  const schema = manifest.capabilities.find(c => c.id === 'financial_research_query').inputSchema;
  assert.ok(schema.properties.kind.anyOf.some(item => item.const === 'cot'));
  assert.ok(schema.properties.provider.anyOf.some(item => item.const === 'cftc'));
  assert.equal(schema.properties.market_code.pattern, '^[A-Za-z0-9]{6}$');
  assert.equal(schema.additionalProperties, false);
  const r = await f.service().query({ kind: 'cot', market_code: '088691', start: '2026-10-01', end: '2026-10-16', limit: 3 });
  const u = f.calls[0];
  assert.equal(u.origin, 'https://publicreporting.cftc.gov');
  assert.equal(u.pathname, '/resource/72hh-3qpy.json');
  assert.equal(u.searchParams.get('cftc_contract_market_code'), '088691');
  assert.equal(u.searchParams.get('$where'), "report_date_as_yyyy_mm_dd >= '2026-10-01T00:00:00' AND report_date_as_yyyy_mm_dd <= '2026-10-16T23:59:59.999'");
  assert.equal(u.searchParams.get('$order'), 'report_date_as_yyyy_mm_dd DESC');
  assert.equal(u.searchParams.get('$limit'), '3');
  assert.equal(u.searchParams.size, 4);
  assert.equal(r.provider, 'cftc');
  assert.deepEqual(r.rows[0].data, row);
  assert.equal(r.rows[0].observed_at, '2026-10-13');
  assert.equal(r.rows[0].available_at, null);
  assert.equal(r.rows[0].content_available_at, '2026-10-18T10:00:00.000Z');
  assert.deepEqual(f.service().read({ dataset_id: r.raw_dataset_id }).rows[0].raw, row);
  const status = f.service().status().sources.find(source => source.provider === 'cftc');
  assert.equal(status.configured, true);
  assert.deepEqual(status.required_environment_names, []);
  assert.equal(status.last_checks[0].query.market_code, '088691');
  assert.match(r.warnings.join(' '), /not.*publication/i);
});

test('CFTC validates market identity and dates without accepting query language or unrelated period parameters', async t => {
  const f = await fixture(t);
  for (const input of [
    { kind: 'cot' }, { kind: 'cot', market_code: '88691' },
    { kind: 'cot', market_code: "088691' OR true" },
    { kind: 'cot', market_code: '088691', period: 'annual' },
    { kind: 'prices', symbol: 'AAPL', market_code: '088691' },
    { kind: 'cot', market_code: '088691', start: '2026-02-30' },
    { kind: 'cot', market_code: '088691', limit: 101 },
  ]) await assert.rejects(f.service().query(input), { code: 'INVALID_ARGUMENT' });
  assert.equal(f.calls.length, 0);
});

test('CFTC historical requests reuse only matching market snapshots already acquired by the cutoff', async t => {
  const f = await fixture(t, u => [{ cftc_contract_market_code: u.searchParams.get('cftc_contract_market_code'), report_date_as_yyyy_mm_dd: '2026-10-13T00:00:00.000' }]);
  const gold = await f.service().query({ kind: 'cot', market_code: '088691' }); f.advance(1000);
  await f.service().query({ kind: 'cot', market_code: '085692' }); f.advance(1000);
  const saved = await f.service().query({ kind: 'cot', market_code: '088691', as_of: new Date(f.time()).toISOString() });
  assert.equal(saved.dataset_id, gold.dataset_id);
  assert.equal(saved.rows[0].data.cftc_contract_market_code, '088691');
  const missing = await f.service().query({ kind: 'cot', market_code: '088691', as_of: '2026-10-16T23:00:00Z' });
  assert.equal(missing.reason, 'HISTORICAL_SNAPSHOT_UNAVAILABLE');
  assert.equal(f.calls.length, 2);
});

test('CFTC access denial and malformed source rows never produce fabricated evidence', async t => {
  let response = new Response('forbidden', { status: 403 });
  const f = await fixture(t, () => response);
  const denied = await f.service().query({ kind: 'cot', market_code: '088691' });
  assert.equal(denied.reason, 'SOURCE_HTTP_403');
  assert.equal(denied.dataset_id, null);
  for (const row of [
    { cftc_contract_market_code: '085692', report_date_as_yyyy_mm_dd: '2026-10-13T00:00:00.000' },
    { cftc_contract_market_code: '088691', report_date_as_yyyy_mm_dd: 'not-a-date' },
  ]) {
    response = [row];
    const invalid = await f.service().query({ kind: 'cot', market_code: '088691' });
    assert.equal(invalid.reason, 'SOURCE_PAYLOAD_INVALID');
    assert.equal(invalid.dataset_id, null);
  }
  assert.deepEqual(records(f.host).list('research_snapshots'), []);
});
