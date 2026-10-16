import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ORIGINAL_REFERENCES, buildMarkerSnapshot, compute, createMarkerIndicator, publishMarkers } from '../markers.js';
import { ReplayMarketProvider } from '../providers.js';
import { createReferenceRun as createRun, decideReferenceAndAdvance as decideAndAdvance, snapshotReference as engineSnapshot } from '../engine.js';

const H = 3600000, T = Date.UTC(2010, 0, 1);
const utc = unixMs => ({ basis: 'utc', unixMs });
const error = code => e => e.code === code;
const book = p => ({ open: p, high: p, low: p, close: p });
function fixture() {
  const chapters = ['AUDJPY', 'USDJPY', 'EURCHF'].map((symbol, i) => ({ symbol, startIndex: 1, endIndex: 3, id: 'chapter-' + i }));
  const frames = chapters.map((c, ci) => Array.from({ length: 4 }, (_, i) => ({ time: T + (ci * 10 + i) * H, bid: book(ci === 2 ? '1.2' : '100.001'), ask: book(ci === 2 ? '1.20001' : '100.002'), ...(ci === 2 ? { fx: { time: T + (ci * 10 + i) * H, bid: book('120'), ask: book('120.001') } } : {}) })));
  const state = { id: 'test-run', version: 1, chapter: 0, index: 2, status: 'paused', balance: '300000', fills: [], orders: [], decisions: [], history: [], ledger: [], equity: [] };
  let observes = 0, subscribes = 0;
  const service = { getState: () => state, getData: () => ({ chapters, frames }), observe: () => { observes++; return { roleSecret: 'NEVER_INCLUDE', account: {} }; }, subscribe: () => { subscribes++; return () => {}; } };
  const bar = i => ({ id: 'bar-' + i, openTime: utc(T + i * H), endTime: utc(T + (i + 1) * H), isClosed: true, close: '100.001' });
  const bars = [bar(1), bar(2)];
  const fill = (id, signedQuantity, at = T + 2 * H) => ({ id, time: at, instrument: 'AUDJPY', chapter: 0, index: 2, signedQuantity, price: '100.123456789012345678901', realizedJpy: '0', commission: '3', reason: 'decision' });
  const interval = (id = 'window', overrides = {}) => ({ id, symbol: 'AUDJPY', kind: 'interval', from: T + H, to: T + 3 * H, evidence: 'fitted', text: '95.610, 500000 AUD, 811600 JPY are comparison-only', ...overrides });
  return { chapters, frames, state, service, bar, bars, fill, interval, counts: () => ({ observes, subscribes }) };
}
const evaluate = (f, rows, bars = f.bars) => compute({ parameters:{label_mode:'events'}, inputs: { price: { rows: bars }, overlay: { rows } } });
const markers = result => result.series.flatMap(s => s.markers);
const series = (result, id) => result.series.find(s => s.seriesId === id).markers;
async function sourceCompute(source) { const sourceURL='data:text/javascript;base64,' + Buffer.from(source).toString('base64'); return (await import(sourceURL)).compute; }

test('native definition matches host artifact validation and compiled compute is standalone', async () => {
  const f = fixture(); f.state.fills.push(f.fill('buy', '1000'), f.fill('sell', '-1000', T + 3 * H - 1));
  const bundle = createMarkerIndicator(f.service, { originals: [f.interval()] });
  const {validateArtifact}=await import(new URL('../../../../../../mt5agent/modules/plugins/artifact-schema.js',import.meta.url));
  validateArtifact({}, {kind:'indicator',content:bundle.definition,dependencies:[],blobs:Object.entries(bundle.files).map(([path,content])=>({path,size:Buffer.byteLength(content),mediaType:'text/javascript'}))});
  assert.equal(bundle.definition.inputs[0].forming, 'closed_only');
  const computeCompiled = await sourceCompute(bundle.files['markers.js']);
  const output = computeCompiled({ parameters:{label_mode:'events'}, inputs: { price: { rows: f.bars } } });
  assert.deepEqual(output, evaluate(f, bundle.snapshot.rows));
  assert.deepEqual(series(output, 'actual-buy')[0], { key: 'actual:test-run:buy', time: utc(T + 2 * H), position: 'at_price', price: '100.123456789012345678901', shape: 'arrow_up', color: '#238b62', text: '真实成交时刻 2010-01-01T02:00:00.000Z；H1显示锚 2010-01-01T02:00:00.000Z（非成交时点） · SIMULATED 实际买 1000 AUD @ 100.123456789012345678901 · decision' });
  assert.equal(series(output, 'actual-sell')[0].shape, 'arrow_down');
  assert.equal(series(output, 'actual-sell')[0].time.unixMs,T+2*H);
  assert.match(series(output, 'actual-sell')[0].text,/02:59:59\.999Z/);
  for (const m of markers(output)) { assert.ok(['above', 'below', 'at_price'].includes(m.position)); assert.ok(['circle', 'arrow_up', 'arrow_down'].includes(m.shape)); assert.equal(m.time.basis, 'utc'); }
});

test('Actual fill projections preserve exact Decimal, side, base units and final-boundary fills, never held decisions', () => {
  const f = fixture(); f.state.fills.push(f.fill('buy', '1000'), f.fill('forced-close', '-1000', T + 3 * H));
  f.state.orders.push({ id: 'pending', status: 'pending' }); f.state.decisions.push({ target: '0', reason: 'held' });
  const snapshot = buildMarkerSnapshot(f.service, { originals: [] });
  assert.equal(snapshot.rows.length, 2); assert.deepEqual(snapshot.rows.map(r => r.side), ['buy', 'sell']);
  assert.deepEqual(snapshot.rows.map(r => r.unit), ['AUD', 'AUD']); assert.equal(snapshot.rows[1].time.unixMs, snapshot.range.to.unixMs);
  assert.equal(snapshot.rows[0].price, f.state.fills[0].price); assert.ok(snapshot.rows.every(r => r.simulated));
  assert.ok(!Object.hasOwn(snapshot, 'balance')); assert.equal(snapshot.originalSource.digest, 'sha256:892e56f645853c81a0bd81a31b48b2155053c3160d5dc5930d25937d895f5495');
});

test('original intervals are textual display bounds, not invented original trade times/prices', () => {
  const f = fixture(), s = buildMarkerSnapshot(f.service, { originals: [f.interval()] }), result = evaluate(f, s.rows);
  const originals = series(result, 'original-intervals'); assert.equal(originals.length, 2);
  for (const m of originals) { assert.equal(m.shape, 'circle'); assert.equal(m.position, 'above'); assert.ok(!Object.hasOwn(m, 'price')); assert.match(m.text, /非成交时点/); assert.match(m.text, /二创拟合/); }
  assert.equal(originals[0].time.unixMs, T + H); assert.equal(originals[1].time.unixMs, T + 2 * H);
  assert.ok(!Object.hasOwn(s.rows[0], 'time')); assert.equal(s.rows[0].timePrecision, 'interval_only');
});

test('no output for unresolved overlapping original windows; future values/text do not enter artifact', () => {
  const f = fixture(), future = f.interval('future', { to: T + 4 * H, text: 'UNREVEALED_ORIGINAL_OUTCOME' });
  const bundle = createMarkerIndicator(f.service, { originals: [future] });
  assert.equal(bundle.snapshot.rows.length, 0); assert.ok(!JSON.stringify(bundle).includes('UNREVEALED_ORIGINAL_OUTCOME'));
  f.state.index = 3; assert.equal(buildMarkerSnapshot(f.service, { originals: [future] }).rows.length, 1);
});

test('ranges strictly reject future to including completed-chapter queries and wall-time', () => {
  const f = fixture();
  assert.throws(() => buildMarkerSnapshot(f.service, { to: T + 3 * H + 1 }), error('FUTURE_DATA_FORBIDDEN'));
  assert.throws(() => buildMarkerSnapshot(f.service, { to: { basis: 'wall', value: '2010-01-01T01:00:00', authority: 'fake' } }), error('UNSUPPORTED_CAPABILITY'));
  assert.throws(() => buildMarkerSnapshot(f.service, { from: T + 3 * H, to: T + 3 * H }), error('INVALID_ARGUMENT'));
  f.state.chapter = 1; f.state.index = 2;
  const past = buildMarkerSnapshot(f.service, { instrument: 'AUDJPY', originals: [] }); assert.equal(past.range.to.unixMs, T + 4 * H);
  assert.throws(() => buildMarkerSnapshot(f.service, { instrument: 'AUDJPY', to: T + 13 * H + 1 }), error('FUTURE_DATA_FORBIDDEN'));
  assert.throws(() => buildMarkerSnapshot(f.service, { instrument: { sourceId: 'kurumi:another-run', instrumentId: 'AUDJPY' } }), error('INSTRUMENT_MISMATCH'));
  assert.throws(() => buildMarkerSnapshot(f.service, { instrument: 'EURCHF' }), error('FUTURE_DATA_FORBIDDEN'));
});

test('projection accesses no future frame/resource and does not observe, subscribe, or change role snapshots', () => {
  const f = fixture(), before = structuredClone(f.state);
  Object.defineProperty(f.frames[0], 3, { get() { throw new Error('future current frame read'); } });
  Object.defineProperty(f.frames, 1, { get() { throw new Error('future chapter read'); } });
  Object.defineProperty(f.frames, 2, { get() { throw new Error('future chapter read'); } });
  createMarkerIndicator(f.service, { originals: [f.interval()] });
  assert.deepEqual(f.state, before); assert.deepEqual(f.counts(), { observes: 0, subscribes: 0 });
});

test('frozen indicator stays immutable as simulation progresses, and rewind chart input reveals no newer markers', async () => {
  const f = fixture(); f.state.fills.push(f.fill('first', '1000'));
  const bundle = createMarkerIndicator(f.service, { originals: [] }), compile = await sourceCompute(bundle.files['markers.js']);
  f.state.fills[0].price = '999'; f.state.fills.push(f.fill('later', '-1000', T + 3 * H)); f.state.index = 3;
  const normal = compile({ inputs: { price: { rows: [...f.bars, f.bar(3)] } } }); assert.equal(markers(normal).length, 1); assert.equal(markers(normal)[0].price, '100.123456789012345678901');
  const rewind = compile({ inputs: { price: { rows: [{ ...f.bar(1), endTime: utc(T + H + H / 2) }] } } }); assert.equal(markers(rewind).length, 0);
});

test('forming bars and no bars do not provide disclosure or invented zeros', () => {
  const f = fixture(), rows = [f.interval()];
  assert.equal(evaluate(f, rows, []).status, 'not_ready');
  assert.equal(evaluate(f, rows, f.bars.map(b => ({ ...b, isClosed: false }))).status, 'not_ready');
  const s = buildMarkerSnapshot(f.service, { originals: [] }); assert.equal(evaluate(f, s.rows).status, 'ready'); assert.equal(markers(evaluate(f, s.rows)).length, 0);
  assert.ok(!JSON.stringify(evaluate(f, rows, [])).includes('"value":"0"'));
});

test('exact historical calendar events remain explicitly not transactions, unknown original exact trade rejected', () => {
  const f = fixture(), event = { id: 'calendar', symbol: 'AUDJPY', kind: 'historical_event', at: T + 2 * H + 30 * 60000, evidence: 'attachment_event', text: 'Documentary calendar anchor; not a trade' };
  const snapshot = buildMarkerSnapshot(f.service, { originals: [event] }), output = evaluate(f, snapshot.rows);
  assert.equal(series(output, 'original-events')[0].time.unixMs, T + 2 * H); assert.match(series(output, 'original-events')[0].text, new RegExp(new Date(event.at).toISOString().replaceAll('.', '\\.'))); assert.match(series(output, 'original-events')[0].text, /H1显示锚/); assert.match(series(output, 'original-events')[0].text, /非成交/); assert.ok(!Object.hasOwn(series(output, 'original-events')[0], 'price'));
  assert.throws(() => buildMarkerSnapshot(f.service, { originals: [{ ...event, evidence: 'fitted' }] }), error('INVALID_ARGUMENT'));
  assert.throws(() => buildMarkerSnapshot(f.service, { originals: [{ ...event, evidence: 'official_event' }] }), error('INVALID_ARGUMENT'));
  assert.throws(() => buildMarkerSnapshot(f.service, { originals: [{ ...f.interval(), kind: 'exact_trade' }] }), error('INVALID_ARGUMENT'));
  const future = { ...event, at: T + 3 * H + 1, text: 'HIDDEN_FUTURE_EVENT' }; assert.equal(buildMarkerSnapshot(f.service, { originals: [future] }).rows.length, 0);
});

test('chapter completion/pause does not reset account; uncertain recap includes only clipped revealed display period', () => {
  const f = fixture(); f.state.chapter = 2; f.state.index = 3; f.state.status = 'complete'; f.state.balance = '-12345';
  const original = f.interval('recap', { symbol: 'EURCHF', from: T + 20 * H, to: T + 30 * H, release: 'chapter_complete', text: 'RECAP_ONLY_COMPARISON' });
  const before = structuredClone(f.state), snap = buildMarkerSnapshot(f.service, { originals: [original] });
  assert.equal(snap.rows[0].from.unixMs, T + 21 * H); assert.equal(snap.rows[0].to.unixMs, T + 24 * H);
  assert.deepEqual(f.state, before); assert.equal(f.state.balance, '-12345');
  f.state.status = 'paused'; assert.equal(buildMarkerSnapshot(f.service, { originals: [original] }).rows.length, 0);
});

test('missing prices/side/time are errors, never zero or invented orders', () => {
  const f = fixture(); f.state.fills.push(f.fill('broken', '1000')); delete f.state.fills[0].price;
  assert.throws(() => buildMarkerSnapshot(f.service), error('SOURCE_DATA_INVALID'));
  f.state.fills[0].price = '100.1'; f.state.fills[0].signedQuantity = '0'; assert.throws(() => buildMarkerSnapshot(f.service), error('SOURCE_DATA_INVALID'));
  f.state.fills[0].signedQuantity = '1000'; f.state.fills[0].time = T + 3 * H + 1; assert.throws(() => buildMarkerSnapshot(f.service), error('FUTURE_DATA_FORBIDDEN'));
});

test('publication helper uses actual managed resources; source/evidence blobs are fixed, main-only, no display claim', async () => {
  const f = fixture(); f.state.fills.push(f.fill('buy', '1000'));
  const ref = { id: 'indicator-1', revision: '1', digest: 'sha256:' + 'a'.repeat(64), kind: 'indicator', schemaVersion: '1.0.0' }, calls = [], bodies = [];
  let serial=0;
  const host={context:{kind:'main'},resources:{
    create:async input=>{if(input.source)bodies.push(input.source.content);return {id:`resource-${++serial}`,kind:input.kind,version:1};},
    publish:async(resource,manifest)=>{calls.push({resource,manifest});return {ref};},
  }};
  const before = structuredClone(f.state), result = await publishMarkers(host, f.service, { operationId: 'marker_publication_0001', originals: [f.interval()] });
  assert.deepEqual(result.ref, ref); assert.equal(result.static, true); assert.equal(result.audienceOnly, true); assert.ok(!Object.hasOwn(result, 'rendered'));
  assert.equal(calls[0].manifest.kind, 'indicator'); assert.equal(calls[0].manifest.provenance.kind, 'demo'); assert.equal(calls[0].manifest.blobs.length, 2); assert.deepEqual(calls[0].manifest.dependencies, []);
  assert.ok(bodies.every(b => !b.includes('NEVER_INCLUDE'))); assert.deepEqual(f.state, before); assert.deepEqual(f.counts(), { observes: 0, subscribes: 0 });
  await assert.rejects(publishMarkers({ ...host, context: { kind: 'subagent' } }, f.service, { operationId: 'marker_publication_0002' }), error('SCOPE_DENIED'));
  assert.equal(calls.length, 1); await assert.rejects(publishMarkers(host, f.service, { operationId: 'short' }), error('INVALID_ARGUMENT'));
});

test('default comparisons separate original claims/calculations/fits and never store fitted minute timestamps', () => {
  assert.ok(Object.isFrozen(ORIGINAL_REFERENCES)); assert.ok(ORIGINAL_REFERENCES.every(Object.isFrozen));
  assert.ok(ORIGINAL_REFERENCES.filter(r => r.kind === 'interval').every(r => !Object.hasOwn(r, 'at') && !Object.hasOwn(r, 'price')));
  assert.match(ORIGINAL_REFERENCES.find(r => r.id === 'aud-original-entry').text, /不是挑战/);
  assert.match(ORIGINAL_REFERENCES.find(r => r.id === 'eur-fitted-settlement').text, /反算拟合价/);
  const nfp = ORIGINAL_REFERENCES.find(r => r.id === 'nfp-calendar-anchor'), snb = ORIGINAL_REFERENCES.find(r => r.id === 'snb-calendar-anchor');
  assert.equal(new Date(nfp.at).toISOString(), '2014-12-05T13:30:00.000Z'); assert.equal(new Date(snb.at).toISOString(), '2015-01-15T09:30:00.000Z');
  assert.equal(nfp.evidence, 'attachment_event'); assert.equal(snb.evidence, 'attachment_event');
});

test('bounded code source rejects excessive history rather than silently dropping data', () => {
  const f = fixture(); for (let i = 0; i < 500; i++) f.state.fills.push(f.fill('fill-' + i, '1000'));
  assert.throws(() => createMarkerIndicator(f.service, { originals: [] }), error('RESOURCE_EXHAUSTED'));
});

test('reference engine fixture + provider closed H1 rows feed compiled indicator; publishing cannot affect player DTO/account', async () => {
  const f = fixture(); let state = createRun('engine-markers', f.chapters, { fixture: 'independent-markers-test' });
  const service = { getState: () => state, getData: () => ({ chapters: f.chapters, frames: f.frames, digests: state.dataDigests }), observe: () => engineSnapshot(state, f.frames[state.chapter][state.index]), subscribe: () => () => {} };
  const provider = new ReplayMarketProvider({}, service), ctx = { bindingId: 'engine-marker-binding' }; provider.bind({}, ctx);
  const decision = { id: 'decision-1', runId: state.id, expectedVersion: state.version, stepId: `${state.id}:0:1`, target: '1000', stop: null, reason: 'independent test decision', utterance: '模拟测试' };
  state = decideAndAdvance(state, decision, f.frames[0]);
  const before = engineSnapshot(state, f.frames[0][state.index]), bundle = createMarkerIndicator(service, { originals: [] });
  const rows = await provider.queryBars({ instrument: bundle.snapshot.instrument, spec: { timeframe: '1h', priceBasis: 'bid', adjustment: 'none', session: 'all', calendarRevision: { status: 'unknown' } }, range: bundle.snapshot.range, includeForming: false, page: { limit: 10 }, direction: 'forward' }, ctx);
  const execute = await sourceCompute(bundle.files['markers.js']), result = execute({ inputs: { price: { rows: rows.data.page.items } } });
  assert.equal(series(result, 'actual-buy').length, 1); assert.equal(series(result, 'actual-buy')[0].price, state.fills[0].price);
  assert.deepEqual(engineSnapshot(state, f.frames[0][state.index]), before);
  assert.ok(!JSON.stringify(before).includes('原剧情')); provider.dispose();
});


test('saved original overlays do not reveal later outcomes on rewind or bounded historical to', async () => {
  const f = fixture();
  const bundle = createMarkerIndicator(f.service, { originals: [f.interval('original', { text: 'LATER_OUTCOME' })] });
  const run = await sourceCompute(bundle.files['markers.js']);
  const rewind = run({ inputs: { price: { rows: [f.bar(1)] } } });
  assert.equal(series(rewind, 'original-intervals').length, 0);
  assert.ok(!JSON.stringify(rewind).includes('LATER_OUTCOME'));
  f.state.chapter = 1; f.state.index = 2;
  const oldChapterBeforeComplete = buildMarkerSnapshot(f.service, { instrument: 'AUDJPY', to: T + 2 * H, originals: [f.interval('recap', { release: 'chapter_complete', text: 'LATER_CHAPTER_OUTCOME' })] });
  assert.equal(oldChapterBeforeComplete.rows.length, 0);
});

test('changed data identity, nonpositive actual prices and duplicate fill identities fail closed', () => {
  const f = fixture(); f.state.dataDigests = { exact: 'old' };
  assert.throws(() => buildMarkerSnapshot(f.service), error('CONNECTION_CHANGED'));
  delete f.state.dataDigests;
  f.state.fills.push(f.fill('same-id', '1000'), f.fill('same-id', '-1000'));
  assert.throws(() => buildMarkerSnapshot(f.service), error('INVALID_ARGUMENT'));
  f.state.fills.pop(); f.state.fills[0].price = '0'; assert.throws(() => buildMarkerSnapshot(f.service), error('SOURCE_DATA_INVALID'));
  f.state.fills[0].price = '-100.1'; assert.throws(() => buildMarkerSnapshot(f.service), error('SOURCE_DATA_INVALID'));
});


test('no-price event and fractional interval anchors always name a loaded closed H1, never a gap/next bar', () => {
  const f = fixture(), at = T + 2.5 * H;
  const event = { id: 'inside', symbol: 'AUDJPY', kind: 'historical_event', at, evidence: 'attachment_event', text: 'calendar, not trade' };
  const s = buildMarkerSnapshot(f.service, { originals: [event, f.interval('fractional', { from: T + 1.5 * H, to: T + 2.75 * H })] });
  const output = evaluate(f, s.rows);
  const events = series(output, 'original-events');
  assert.equal(s.rows.find(r => r.kind === 'original-event').time.unixMs, at, 'frozen documentary time is unchanged');
  assert.ok(events[0].text.includes(new Date(at).toISOString()));
  assert.ok(events[0].text.includes(new Date(T + 2 * H).toISOString()));
  assert.deepEqual(series(output, 'original-intervals').map(m => m.time.unixMs), [T + H, T + 2 * H]);
  for (const m of markers(output)) assert.ok(f.bars.some(b => b.openTime.unixMs === m.time.unixMs));
  assert.equal(series(evaluate(f, s.rows, [f.bar(1), { ...f.bar(2), isClosed: false }, f.bar(3)]), 'original-events').length, 0, 'forming containing bar is not a display anchor');
  assert.equal(series(evaluate(f, s.rows, [f.bar(1), f.bar(3)]), 'original-events').length, 0, 'a calendar event in a real gap is not shifted to an edge');
  const edge = buildMarkerSnapshot(f.service, { originals: [{ ...event, at: T + 3 * H }] });
  assert.equal(series(evaluate(f, edge.rows), 'original-events').length, 0, 'event at last endTime belongs to a missing next H1, not the previous candle');
});

// Optional genuine browser regression, using only the explicitly supplied host
// checkout's production frontend components + existing Vite/Playwright/LWC.
// No application source edits, module substitutes, plugin installation or
// fixture results presented as actual challenge executions. Vite's cache lives
// in a disposable temp directory, not in the host checkout.
// SESAME_PRICE_CHART_APP=/path/to/host node --test this-file
// Optional KURUMI_MARKER_UI_OUTPUT_DIR preserves screenshots/test receipt.
test('production frontend: NFP/SNB half-hour circles and subhour actual arrows really draw from initial provider warmup', {
  skip: !process.env.SESAME_PRICE_CHART_APP, timeout: 90000,
}, async () => {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const path = await import('node:path');
  const { mkdtemp, rm, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const app = path.resolve(process.env.SESAME_PRICE_CHART_APP), req = createRequire(path.join(app, 'package.json'));
  const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
  const { default: react } = await import(pathToFileURL(req.resolve('@vitejs/plugin-react')).href);
  const { chromium } = req('playwright');
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'kurumi-marker-ui-'));
  const cases = [];
  for (const [name, symbol, iso] of [['NFP', 'USDJPY', '2014-12-05T13:30:00Z'], ['SNB', 'EURCHF', '2015-01-15T09:30:00Z']]) {
    const f = fixture(), at = Date.parse(iso), anchor = at - H / 2;
    f.chapters[0] = { id: name, symbol, startIndex: 7, endIndex: 8 };
    f.frames[0] = Array.from({ length: 9 }, (_, i) => ({ time: anchor + (i - 7) * H,
      bid: { open: '100.120', high: '100.125', low: '100.115', close: '100.121' },
      ask: { open: '100.121', high: '100.126', low: '100.116', close: '100.122' } }));
    f.state.id = 'browser-' + name; f.state.index = 7;
    Object.defineProperty(f.frames[0], 8, { get() { throw Error('UNREVEALED FRAME ACCESSED'); }, configurable: true });
    f.state.fills = [
      { id: 'buy', instrument: symbol, chapter: 0, index: 7, time: anchor + H / 8, signedQuantity: '1000', price: '100.123456789012345678901' },
      { id: 'sell', instrument: symbol, chapter: 0, index: 7, time: anchor + H / 4, signedQuantity: '-1000', price: '100.116' },
    ];
    const provider = new ReplayMarketProvider({}, f.service), context = { bindingId: 'browser-' + name };
    provider.bind({}, context);
    const instrument = { sourceId: 'kurumi:' + f.state.id, instrumentId: symbol };
    const stream = await provider.subscribeBars({ instrument, spec: { timeframe: '1h', priceBasis: 'bid', adjustment: 'none', session: 'all', calendarRevision: { status: 'unknown' } }, tailLimit: 100, includeForming: false }, context);
    const bars = stream.snapshot.bars; await stream.close(); provider.dispose();
    assert.equal(bars.length, 8, 'initial chart contains seven real warmup bars plus the current closed bar');
    assert.equal(bars[0].openTime.unixMs, anchor - 7 * H);
    const bundle = createMarkerIndicator(f.service, { instrument, originals: [
      { id: name, symbol, kind: 'historical_event', at, evidence: 'attachment_event', text: name + ' calendar, not execution' },
      { id: name + '-window', symbol, kind: 'interval', from: anchor, to: anchor + 0.75 * H, evidence: 'fitted', text: 'uncertain interval, not execution' },
    ] });
    cases.push({ name, at, anchor, bars, definition: bundle.definition, source: bundle.files['markers.js'] });
  }
  // Observe, don't replace, the real chart and marker-plugin APIs. The browser
  // subsequently uses real screenshot pixels to check that circles/arrows draw.
  const realChart = path.join(app, 'node_modules/lightweight-charts/dist/lightweight-charts.development.mjs');
  const wrapper = `
    import * as actual from ${JSON.stringify('/@fs/' + realChart)};
    export * from ${JSON.stringify('/@fs/' + realChart)};
    window.realCharts = []; window.realMarkerPlugins = [];
    export function createChart(...args) {
      const chart = actual.createChart(...args), series = [];
      window.realCharts.push({ chart, series });
      const add = chart.addSeries.bind(chart);
      chart.addSeries = (...args) => { const item = add(...args); series.push(item); return item; };
      return chart;
    }
    export function createSeriesMarkers(...args) {
      const api = actual.createSeriesMarkers(...args);
      window.realMarkerPlugins.push({ series: args[0], api }); return api;
    }
  `;
  // Browser-only fixture imports the supplied host checkout's existing UI dependencies;
  // it is not a native plugin runtime module or a bundled React dependency.
  const entry = readFileSync(new URL('./fixtures/markers-browser.jsx',import.meta.url),'utf8')
    .replace('/*__CASE_IMPORTS__*/',cases.map((c,i)=>`import { compute as compute${i} } from ${JSON.stringify('virtual:kurumi-compute-'+i)};`).join('\n'))
    .replace('/*__CASES__*/[]',JSON.stringify(cases.map(({source,...c})=>c)));
  const root = path.join(app, 'modules/frontend');
  let server, browser;
  try {
    server = await createServer({ configFile: false, root, cacheDir, logLevel: 'error',
      resolve: { alias: { '@': path.join(root, 'src') } },
      server: { host: '127.0.0.1', port: 0, hmr: false },
      optimizeDeps: { exclude: ['lightweight-charts'] },
      plugins: [react(), { name: 'kurumi-marker-render-regression', enforce: 'pre',
        resolveId(id) { if (id === 'lightweight-charts') return '\0kurumi-observed-charts'; if (id === 'virtual:kurumi-ui' || id.startsWith('virtual:kurumi-compute-')) return '\0' + id; },
        load(id) { if (id === '\0kurumi-observed-charts') return wrapper; if (id === '\0virtual:kurumi-ui') return entry; if (id.startsWith('\0virtual:kurumi-compute-')) return cases[Number(id.split('-').at(-1))].source; },
        configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
          if (request.url !== '/') return next();
          response.setHeader('Content-Type', 'text/html');
          response.end(await vite.transformIndexHtml('/', '<!doctype html><html><head><style>html,body{margin:0;background:white}.test-grid{display:grid;grid-template-columns:1fr 1fr}.trading-chart{width:100%;height:580px}</style></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:kurumi-ui"></script></body></html>'));
        }); },
      }],
    });
    await server.listen(); browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 800 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.waitForFunction(() => window.realCharts?.length === 2 && window.realCharts.every(c => c.series.length === 8));
    await page.evaluate(async () => { await document.fonts.ready; for (const c of window.realCharts) c.chart.timeScale().fitContent(); await window.settle(); });
    const good = await page.evaluate(() => window.inspectPixels());
    for (const [i, receipt] of good.entries()) {
      assert.equal(receipt.initialBars, 8);
      assert.deepEqual(receipt.eventPoints.map(p => p.time), [cases[i].anchor / 1000]);
      assert.ok(receipt.anchorX > 0);
      assert.ok(receipt.counts.event > 8, 'actual canvas contains historical-event color, not merely a setMarkers call');
      assert.ok(receipt.nearMarker.event > 30, 'historical-event circle has colored pixels around its H1 anchor, not just its label');
      assert.ok(receipt.nearMarker.buy > 30, 'actual native buy arrow has pixels around its subhour execution anchor');
      assert.ok(receipt.nearMarker.sell > 30, 'actual native sell arrow has pixels around its subhour execution anchor');
      assert.ok(receipt.counts.buy > 8, 'actual native buy arrow is painted');
      assert.ok(receipt.counts.sell > 8, 'actual native sell arrow is painted');
      assert.equal(receipt.buyPoints[0].time, (cases[i].anchor + H / 8) / 1000, 'actual execution remains subhour');
      assert.equal(receipt.buyPoints[0].value, Number('100.123456789012345678901'));
      assert.equal(receipt.sellPoints[0].time, (cases[i].anchor + H / 4) / 1000);
      assert.ok(receipt.intervalPoints.every(p => cases[i].bars.some(b => p.time === b.openTime.unixMs / 1000)));
      const eventMarker = receipt.markers.flat().find(m => m.shape === 'circle' && m.color === '#956d32');
      assert.equal(eventMarker.time, cases[i].anchor / 1000);
      assert.ok(eventMarker.text.includes(new Date(cases[i].at).toISOString()));
      assert.match(eventMarker.text, /H1显示锚.*非成交时点/);
      const buyMarker = receipt.markers.flat().find(m => m.color === '#238b62');
      assert.equal(buyMarker.shape, 'arrowUp'); assert.equal(buyMarker.position, 'atPriceMiddle');
    }
    const outputDir = process.env.KURUMI_MARKER_UI_OUTPUT_DIR;
    if (outputDir) { await mkdir(outputDir, { recursive: true }); await page.screenshot({ path: path.join(outputDir, 'kurumi-h1-markers-corrected.png'), fullPage: true }); }
    // Negative control reproduces exactly the reviewed bug on the unmodified
    // production frontend. The off-grid circle must produce NO series point or
    // pixels. This makes the regression prove the actual drawing requirement.
    await page.evaluate(async () => { window.setBroken(true); await window.settle(); });
    const broken = await page.evaluate(() => window.inspectPixels());
    for (const receipt of broken) {
      assert.deepEqual(receipt.eventPoints, []);
      assert.equal(receipt.counts.event, 0, 'unanchored half-hour event really is invisible');
      assert.ok(receipt.counts.interval > 8, 'corrected interval marker also really draws');
    }
    if (outputDir) await page.screenshot({ path: path.join(outputDir, 'kurumi-h1-markers-negative-control.png'), fullPage: true });
    await page.evaluate(async () => { window.setBroken(false); await window.settle(); });
    const restored = await page.evaluate(() => window.inspectPixels());
    assert.ok(restored.every(r => r.eventPoints.length === 1 && r.counts.event > 8));
    assert.deepEqual(errors, [], 'production chart and native markers emit no browser errors');
    const receipt = { kind: 'production-frontend-fixture-regression', simulated: true, frontendModified: false, corrected: good, negativeControl: broken, errors };
    if (outputDir) await writeFile(path.join(outputDir, 'kurumi-h1-markers-render-receipt.json'), JSON.stringify(receipt, null, 2));
    console.log('PASS real frontend drawing: ' + JSON.stringify(good.map(({ name, initialBars, eventRealAt, eventDisplayAnchor, counts, nearMarker }, i) => ({ name, initialBars, eventRealAt, eventDisplayAnchor, pixels: counts, markerPixels: nearMarker, negativeControlEventPixels: broken[i].counts.event }))));
  } finally {
    await browser?.close(); await server?.close(); await rm(cacheDir, { recursive: true, force: true });
  }
});
