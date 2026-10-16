import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayMarketProvider, ReplayAccountProvider, marketDescriptor, accountDescriptor } from '../providers.js';

const H = 3600000, T = Date.UTC(2010, 0, 1);
const spec = basis => ({ timeframe: '1h', priceBasis: basis ?? 'bid', adjustment: 'none', session: 'all', calendarRevision: { status: 'unknown' } });
const range = (from, to) => ({ from: { basis: 'utc', unixMs: from }, to: { basis: 'utc', unixMs: to } });
const book = x => ({ open: x, high: x, low: x, close: x });
function fixture() {
  const chapters = ['USDJPY', 'GBPJPY', 'EURCHF'].map((symbol, ci) => ({ id: String(ci), symbol, startIndex: 1, endIndex: 3 }));
  const frames = chapters.map((_, ci) => Array.from({ length: 4 }, (_, i) => ({ time: T + (ci * 10 + i) * H, bid: book('100.000000000000000001'), ask: book('100.000000000000000002'), ...(ci === 2 ? { fx: { time: T + (ci * 10 + i) * H, bid: book('150.1'), ask: book('150.2') } } : {}) })));
  const state = { id: 'run-a', version: 1, chapter: 0, index: 2, balance: '300000', position: null, fills: [], orders: [], history: [], decisions: [], equity: [], currency: 'JPY', status: 'paused' };
  const listeners = new Set();
  let reads = 0;
  const service = { getState: () => state, getData: () => ({ chapters, frames, digests: { fixture: 'safe' }, provenance: { fixture: true } }), observe: () => { reads++; return { account: { currency: 'JPY', equity: state.balance, unrealizedPnl: '0' } }; }, subscribe: f => { listeners.add(f); return () => listeners.delete(f); } };
  const market = new ReplayMarketProvider({}, service), account = new ReplayAccountProvider({}, service), context = { bindingId: 'binding-a' };
  market.bind({}, context); account.bind({}, context);
  const instrument = symbol => ({ sourceId: 'kurumi:' + state.id, instrumentId: symbol });
  const ref = () => ({ connectionId: 'kurumi-simulation', accountId: state.id });
  const query = (symbol = 'USDJPY') => ({ instrument: instrument(symbol), spec: spec(), range: range(T + H, T + (state.chapter * 10 + state.index + 1) * H), page: { limit: 1 }, includeForming: false, direction: 'forward' });
  return { state, chapters, frames, service, market, account, context, instrument, ref, query, listeners, emit: () => { for (const f of [...listeners]) f(); }, observerReads: () => reads };
}
const code = c => e => e.code === c;

test('provider projections are explicit and private lifecycle disposal is idempotent', () => {
  const f=fixture();
  assert.deepEqual([marketDescriptor.contract,accountDescriptor.contract],['sesame.market','sesame.account']);
  for(const provider of [f.market,f.account]){provider.dispose();provider.dispose();assert.throws(()=>provider.bind({},f.context),code('CONNECTION_CHANGED'));}
});

test('exact simulation identities and SIMULATED account, currency and missing money stay honest', async () => {
  const f = fixture(), binding = f.market.bind({}, { bindingId: 'restored' });
  assert.deepEqual(binding.connection, { id: 'kurumi-simulation', revision: 'run-a' });
  assert.deepEqual(binding.sourceIds, ['kurumi:run-a']);
  assert.throws(() => f.market.bind({ connection: { id: 'kurumi-simulation', revision: 'other' } }, f.context), code('CONNECTION_CHANGED'));
  const detail = await f.market.describeInstrument({ instrument: f.instrument('USDJPY') }, f.context);
  assert.equal(detail.data.quantity.unit, 'USD'); assert.equal(detail.data.volume.hasReal, false); assert.equal(detail.data.volume.hasTick, false);
  assert.deepEqual(detail.data.features.timeframes, ['1h']);
  const list = await f.account.listAccounts({}, f.context);
  assert.equal(list.data.items[0].mode, 'demo'); assert.match(list.data.items[0].broker, /SIMULATED/);
  const snap = await f.account.snapshot({ account: f.ref() }, f.context);
  assert.deepEqual(snap.data.balance, { status: 'value', value: { value: '300000', currency: 'JPY' } });
  assert.equal(snap.data.available.status, 'unknown'); assert.equal(snap.data.margin.used.status, 'unknown'); assert.equal(snap.data.buyingPower.status, 'unsupported');
  assert.equal(snap.data.asOf.unixMs, T + 3 * H); assert.equal(snap.meta.origin, 'demo'); assert.equal(snap.meta.sourceTime.basis, 'utc');
  f.state.balance = '0'; assert.equal((await f.account.snapshot({ account: f.ref() }, f.context)).data.balance.value.value, '0');
  await assert.rejects(f.account.snapshot({ account: { connectionId: 'real', accountId: 'run-a' } }, f.context), code('ACCOUNT_MISMATCH'));
  await assert.rejects(f.market.queryBars({ ...f.query(), instrument: { sourceId: 'other', instrumentId: 'USDJPY' } }, f.context), code('INSTRUMENT_MISMATCH'));
});

test('closed bid/ask H1 history, precise decimals and genuine frozen pagination', async () => {
  const f = fixture(), input = f.query(), first = await f.market.queryBars(input, f.context);
  const b = first.data.page.items[0]; assert.equal(b.close, '100.000000000000000001'); assert.equal(b.isClosed, true); assert.equal(b.closure, 'source'); assert.equal(b.endTime.unixMs - b.openTime.unixMs, H);
  assert.equal(b.volume.default, 'none'); assert.equal(b.volume.real.status, 'unknown'); assert.equal(b.turnover.status, 'unknown');
  assert.ok(first.data.coverage.observedRange); assert.equal(first.data.coverage.complete, false);
  const ask = await f.market.queryBars({ ...input, spec: spec('ask') }, f.context); assert.equal(ask.data.page.items[0].close, '100.000000000000000002');
  // Replacing an already revealed input must not change a retained page.
  f.frames[0][2].bid = book('101'); f.state.index = 3;
  const second = await f.market.queryBars({ ...input, page: { limit: 10, cursor: first.data.page.nextCursor } }, f.context);
  assert.equal(second.data.page.snapshotId, first.data.page.snapshotId); assert.equal(second.data.page.items[0].close, '100.000000000000000001'); assert.equal(second.data.page.nextCursor, null);
  assert.equal(second.meta.sourceTime.unixMs, first.meta.sourceTime.unixMs);
  await assert.rejects(f.market.queryBars({ ...input, spec: spec('ask'), page: { cursor: first.data.page.nextCursor } }, f.context), code('INVALID_CURSOR'));
  f.market.bind({}, { bindingId: 'other-binding' });
  await assert.rejects(f.market.queryBars({ ...input, page: { cursor: first.data.page.nextCursor } }, { bindingId: 'other-binding' }), code('INVALID_CURSOR'));
  await assert.rejects(f.market.queryBars({ ...input, page: { cursor: Buffer.from(JSON.stringify({ id: first.data.page.snapshotId, offset: 1 })).toString('base64url') } }, f.context), code('INVALID_CURSOR'));
  await assert.rejects(f.market.queryBars({ ...input, page: { limit: 0 } }, f.context));
  await assert.rejects(f.market.queryBars({ ...input, spec: { ...spec(), timeframe: 'H1' } }, f.context), code('UNSUPPORTED_CAPABILITY'));
});

test('backward page windows are newest first across pages but ascending inside each page', async () => {
  const f = fixture(); f.state.index = 3; const input = { ...f.query(), direction: 'backward', page: { limit: 2 } };
  const a = await f.market.queryBars(input, f.context); assert.deepEqual(a.data.page.items.map(x => x.openTime.unixMs), [T + 2 * H, T + 3 * H]);
  const b = await f.market.queryBars({ ...input, page: { limit: 2, cursor: a.data.page.nextCursor } }, f.context); assert.equal(b.data.page.items[0].openTime.unixMs, T + H);
});

test('all ranges require UTC and future upper bounds are rejected even for completed chapters', async () => {
  const f = fixture();
  await assert.rejects(f.market.queryBars({ ...f.query(), range: range(T, T + 3 * H + 1) }, f.context), code('FUTURE_DATA_FORBIDDEN'));
  await assert.rejects(f.market.queryBars({ ...f.query(), range: { from: { basis: 'wall', authority: 'UTC', value: '2010-01-01T00:00:00' }, to: { basis: 'utc', unixMs: T + 3 * H } } }, f.context), code('UNSUPPORTED_CAPABILITY'));
  await assert.rejects(f.market.queryBars(f.query('EURCHF'), f.context), code('FUTURE_DATA_FORBIDDEN'));
  f.state.chapter = 1; f.state.index = 1;
  const completed = await f.market.queryBars({ ...f.query(), page: { limit: 20 } }, f.context);
  assert.equal(completed.data.page.items.length, 3);
  await assert.rejects(f.market.queryBars({ ...f.query('USDJPY'), range: range(T, T + 13 * H) }, f.context), code('FUTURE_DATA_FORBIDDEN'));
  const catalogue = await f.market.searchInstruments({ page: { limit: 1 } }, f.context);
  f.state.chapter = 0; f.state.index = 1;
  await assert.rejects(f.market.searchInstruments({ page: { limit: 1, cursor: catalogue.data.nextCursor } }, f.context), code('INVALID_CURSOR'));
});

test('future frame properties are never read and CHFJPY is synchronized/revealed only in EURCHF', async () => {
  const f = fixture();
  Object.defineProperty(f.frames[0], 3, { get() { throw Error('FUTURE FRAME READ'); }, configurable: true });
  assert.equal((await f.market.queryBars(f.query(), f.context)).data.page.items.length, 1);
  assert.deepEqual((await f.market.searchInstruments({}, f.context)).data.items.map(x => x.symbol), ['USDJPY']);
  await assert.rejects(f.market.describeInstrument({ instrument: f.instrument('CHFJPY') }, f.context), code('FUTURE_DATA_FORBIDDEN'));
  delete f.frames[0][3]; f.frames[0][3] = { time: T + 3 * H, bid: book('100'), ask: book('101') };
  f.state.chapter = 2; f.state.index = 2;
  const query = { ...f.query('CHFJPY'), range: range(T + 21 * H, T + 23 * H), page: { limit: 20 } };
  const result = await f.market.queryBars(query, f.context); assert.deepEqual(result.data.page.items.map(b => b.close), ['150.1', '150.1']);
  assert.deepEqual(result.data.page.items.map(b => b.openTime.unixMs), [f.frames[2][1].time, f.frames[2][2].time]);
  const ask = await f.market.queryBars({ ...query, spec: spec('ask') }, f.context); assert.equal(ask.data.page.items[0].close, '150.2');
});

test('bars subscriptions ready handshake, gap catch-up, pause/complete preservation and no chapter leak', async () => {
  const f = fixture(), events = [];
  const stream = await f.market.subscribeBars({ instrument: f.instrument('USDJPY'), spec: spec(), tailLimit: 2, includeForming: true }, f.context);
  assert.equal(stream.position.seq, '0'); assert.equal(stream.snapshot.bars.length, 2); assert.equal(f.listeners.size, 1);
  f.state.index = 3; f.emit(); assert.equal(events.length, 0);
  stream.ready(e => events.push(e)); assert.equal(events.length, 1); assert.equal(events[0].type, 'bars.upsert'); assert.equal(events[0].seq, '1'); assert.equal(events[0].streamId, stream.position.streamId); assert.equal(events[0].epoch, stream.position.epoch); assert.equal(events[0].schemaVersion, '1.0.0');
  f.state.status = 'paused'; f.emit(); f.state.status = 'complete'; f.emit(); assert.equal(events.length, 1); assert.equal(f.listeners.size, 1);
  f.state.chapter = 1; f.state.index = 1; f.emit(); assert.equal(events.length, 1); // old USDJPY stream stops at completed chapter, still subscribed
  await stream.close(); await stream.close(); assert.equal(f.listeners.size, 0);
});

test('subscription unbind, dispose, abort and connection restart release listeners', async () => {
  const f = fixture(), controller = new AbortController();
  const input = { instrument: f.instrument('USDJPY'), spec: spec(), tailLimit: 2 };
  const a = await f.market.subscribeBars(input, { ...f.context, signal: controller.signal }); a.ready(() => {}); controller.abort(); assert.equal(f.listeners.size, 0);
  const b = await f.market.subscribeBars(input, f.context); const events = []; b.ready(e => events.push(e)); f.state.id = 'new-run'; f.emit(); assert.equal(events[0].type, 'stream.gap'); assert.equal(events[0].payload.code, 'CONNECTION_CHANGED'); assert.equal(f.listeners.size, 0);
  f.state.id = 'run-a'; const c = await f.market.subscribeBars(input, f.context); f.market.unbind(f.context); assert.equal(f.listeners.size, 0); await c.close();
  await assert.rejects(f.market.queryBars(f.query(), f.context), code('CONNECTION_CHANGED'));
});

function addLedger(f) {
  const time = T + 2 * H;
  f.state.position = { id: 'p1', symbol: 'USDJPY', side: 'long', quantity: '1000', averagePrice: '100.000000000000000001', time };
  f.state.orders = [{ id: 'o1', symbol: 'USDJPY', side: 'buy', quantity: '1000', filledQuantity: '1000', remainingQuantity: '0', status: 'filled', time }];
  f.state.fills = [{ id: 'f1', orderId: 'o1', symbol: 'USDJPY', side: 'buy', quantity: '1000', price: '100.000000000000000001', time }];
  f.state.history = [{ id: 'h1', kind: 'fee', amount: '-3.000000000000000001', time, currency: 'JPY', relatedFillIds: ['f1'] }, { id: 'h2', kind: 'adjustment', amount: '5', time, currency: 'JPY' }];
}

test('account positions/orders/fills/history faithfully mapped with Decimal/unit/UTC and isolated cursors', async () => {
  const f = fixture(); addLedger(f); const account = f.ref(), input = { account, range: range(T, T + 3 * H), page: { limit: 1 } };
  const p = await f.account.queryPositions({ account }, f.context); assert.equal(p.data.items[0].quantity.unit, 'USD'); assert.equal(p.data.items[0].markPrice.status, 'unknown');
  const o = await f.account.queryOrders({ ...input, scope: 'history' }, f.context); assert.equal(o.data.page.items[0].status, 'filled'); assert.equal(o.data.page.items[0].remainingQuantity.value.value, '0');
  const fills = await f.account.queryFills(input, f.context); assert.equal(fills.data.page.items[0].fees.status, 'unknown'); assert.equal(fills.data.page.items[0].time.basis, 'utc');
  const a = await f.account.queryHistory(input, f.context); assert.equal(a.data.page.items[0].amount.value, '-3.000000000000000001');
  f.state.history[1].amount = '500'; f.state.history.push({ id: 'h3', kind: 'adjustment', amount: '9', currency: 'JPY', time: T + 2 * H });
  const b = await f.account.queryHistory({ ...input, page: { limit: 1, cursor: a.data.page.nextCursor } }, f.context); assert.equal(b.data.page.items[0].amount.value, '5'); assert.equal(b.data.page.nextCursor, null);
  await assert.rejects(f.account.queryFills({ ...input, page: { cursor: a.data.page.nextCursor } }, f.context), code('INVALID_CURSOR'));
  await assert.rejects(f.account.queryHistory({ ...input, kinds: ['fee'], page: { cursor: a.data.page.nextCursor } }, f.context), code('INVALID_CURSOR'));
  for (const method of ['snapshot', 'queryPositions', 'queryOrders', 'queryFills', 'queryHistory']) await assert.rejects(f.account[method]({ account, ...(method === 'queryOrders' ? { scope: 'all' } : {}), range: range(T, T + 3 * H + 1) }, f.context), code('FUTURE_DATA_FORBIDDEN'));
  f.state.history = undefined; await assert.rejects(f.account.queryHistory(input, f.context), code('SOURCE_UNAVAILABLE'));
});

test('account subscriptions retain account/balance across chapter change; removals require authoritative snapshot', async () => {
  const f = fixture(), events = [], account = f.ref();
  const stream = await f.account.subscribeAccount({ account, topics: ['snapshot', 'positions', 'orders', 'fills', 'history'] }, f.context); stream.ready(e => events.push(e));
  f.emit(); assert.equal(events.length, 0);
  addLedger(f); f.state.version++; f.state.balance = '299997'; f.emit(); assert.ok(events.some(e => e.type === 'positions.upsert'));
  assert.deepEqual(events.map(e => e.seq), events.map((_, i) => String(i + 1)));
  f.state.chapter = 1; f.state.index = 1; f.state.version++; f.emit();
  const snapshots = events.filter(e => e.type === 'account.snapshot'); assert.deepEqual(snapshots.at(-1).payload.account.ref, account); assert.equal(snapshots.at(-1).payload.balance.value.value, '299997');
  f.state.position = null; f.emit(); assert.equal(events.at(-1).type, 'stream.gap'); assert.equal(events.at(-1).payload.code, 'SNAPSHOT_REQUIRED'); assert.equal(f.listeners.size, 0);
});

test('portable reference fixture adapter uses only monetary ledger, exact signed fills, JPY metrics and real order deltas', async () => {
  const { createReferenceRun:createRun, decideReferenceAndAdvance:decideAndAdvance, snapshotReference:snapshot } = await import('../engine.js');
  const f = fixture(); f.chapters.forEach(c => { c.startIndex = 0; });
  let state = createRun('engine-run', f.chapters, { fixture: 'safe' });
  const service = { ...f.service, getState: () => state, observe: () => ({ account: snapshot(state, f.frames[state.chapter][state.index]) }) };
  const provider = new ReplayAccountProvider(service), context = { bindingId: 'engine' }; provider.bind({}, context);
  const account = { connectionId: 'kurumi-simulation', accountId: state.id };
  const decide = target => { state = decideAndAdvance(state, { id: 'decision-' + state.version, runId: state.id, stepId: `${state.id}:${state.chapter}:${state.index}`, expectedVersion: state.version, target, stop: null, reason: 'portable test', utterance: 'test' }, f.frames[state.chapter]); };
  decide('-1000');
  const snap = await provider.snapshot({ account }, context); assert.equal(snap.data.account.baseCurrency.value, 'JPY'); assert.equal(snap.data.equity.value.value, snapshot(state, f.frames[0][state.index]).equity); assert.equal(snap.data.margin.used.status, 'value');
  const p = await provider.queryPositions({ account }, context); assert.equal(p.data.items[0].side, 'short'); assert.equal(p.data.items[0].quantity.value, '1000'); assert.equal(p.data.items[0].quantity.unit, 'USD');
  const input = () => ({ account, range: range(T, T + (state.index + 1) * H), page: { limit: 100 } });
  const fill = await provider.queryFills(input(), context); assert.equal(fill.data.page.items[0].side, 'sell'); assert.equal(fill.data.page.items[0].fees.value[0].value, '-3'); assert.equal(fill.data.page.items[0].realizedPnl.value.value, '0');
  const orders = await provider.queryOrders({ ...input(), scope: 'all' }, context); assert.equal(orders.data.page.items[0].quantity.value, '1000'); assert.equal(orders.data.page.items[0].filledQuantity.value, '1000');
  const ledger = await provider.queryHistory(input(), context); assert.equal(ledger.data.page.items.length, 2); assert.deepEqual(ledger.data.page.items.map(x => x.kind).sort(), ['adjustment', 'fee']); assert.ok(ledger.data.page.items.every(x => !x.description.includes('step')));
  decide('-1000'); const held = await provider.queryOrders({ ...input(), scope: 'all' }, context); assert.equal(held.data.page.items.length, 1, 'holding is not a fake zero order');
  decide('1000'); // full settlement at chapter end plus chapter transition
  const after = await provider.snapshot({ account }, context); assert.deepEqual(after.data.account.ref, account); assert.equal(after.data.balance.value.value, state.balance);
  const history = await provider.queryHistory({ account, range: range(T, T + 11 * H), page: { limit: 100 } }, context); assert.ok(history.data.page.items.length > ledger.data.page.items.length);
});

test('final closed-boundary ledger events remain queryable without an illegal future range', async () => {
  const f = fixture();
  f.state.status = 'complete';
  f.state.fills = [{ id: 'final', symbol: 'USDJPY', time: T + 3 * H, side: 'sell', quantity: '1000', price: '100' }];
  f.state.history = [{ id: 'final-fee', time: T + 3 * H, kind: 'fee', amount: '-3', currency: 'JPY' }];
  const input = { account: f.ref(), range: range(T, T + 3 * H) };
  assert.equal((await f.account.queryFills(input, f.context)).data.page.items.length, 1);
  assert.equal((await f.account.queryHistory(input, f.context)).data.page.items.length, 1);
  await assert.rejects(f.account.queryFills({ ...input, range: range(T, T + 3 * H + 1) }, f.context), code('FUTURE_DATA_FORBIDDEN'));
});

test('future instrument/time parameters, malformed OHLC and asynchronous FX are rejected', async () => {
  const f = fixture();
  await assert.rejects(f.account.queryPositions({ account: f.ref(), instruments: [f.instrument('EURCHF')] }, f.context), code('FUTURE_DATA_FORBIDDEN'));
  await assert.rejects(f.account.snapshot({ account: f.ref(), asOf: { basis: 'utc', unixMs: T + 100 * H } }, f.context), code('INVALID_ARGUMENT'));
  f.frames[0][1].bid.high = '99'; await assert.rejects(f.market.queryBars(f.query(), f.context), code('SOURCE_DATA_INVALID'));
  f.state.chapter = 2; f.state.index = 1; f.frames[2][1].fx.time++;
  await assert.rejects(f.market.queryBars({ ...f.query('CHFJPY'), range: range(T + 21 * H, T + 22 * H) }, f.context), code('SOURCE_DATA_INVALID'));
});

test('rebind invalidates old cursors; engine digest changes are not silently accepted', async () => {
  const f = fixture(), input = f.query(), first = await f.market.queryBars(input, f.context);
  f.market.bind({}, f.context);
  await assert.rejects(f.market.queryBars({ ...input, page: { cursor: first.data.page.nextCursor } }, f.context), code('INVALID_CURSOR'));
  f.state.dataDigests = { fixture: 'different' };
  await assert.rejects(f.market.queryBars(input, f.context), code('CONNECTION_CHANGED'));
});

test('snapshot-only account subscriptions stay active on pause, chapter change and completion', async () => {
  const f = fixture(), events = [];
  const stream = await f.account.subscribeAccount({ account: f.ref(), topics: ['snapshot'] }, f.context); stream.ready(e => events.push(e));
  f.emit(); assert.equal(events.length, 0);
  f.state.balance = '299997'; f.state.version++; f.emit();
  f.state.chapter = 1; f.state.index = 1; f.state.version++; f.emit();
  f.state.status = 'complete'; f.emit();
  assert.equal(f.listeners.size, 1); assert.ok(events.every(e => e.type === 'account.snapshot')); assert.ok(events.every(e => e.payload.account.ref.accountId === 'run-a'));
  assert.equal(events.at(-1).payload.balance.value.value, '299997');
  await stream.close(); assert.equal(f.listeners.size, 0);
});

// Opt-in only: launch Node with the matching public SDK loader supplied by the
// host (node --import="$SESAME_PLUGIN_SDK_LOADER" --test this-file). This does
// not copy/import private host code and never prepares or installs an environment.
test('actual public SDK Read/financial contracts (opt-in matching host loader)', { skip: !process.env.SESAME_PLUGIN_SDK_LOADER }, async () => {
  const { validateRead, validateFinancialData } = await import('@sesame/plugin-sdk/protocol');
  const f = fixture(); addLedger(f);
  const account = f.ref(), input = { account, range: range(T, T + 3 * H), page: { limit: 100 } };
  const results = [
    [marketDescriptor, await f.market.searchInstruments({}, f.context)],
    [marketDescriptor, await f.market.describeInstrument({ instrument: f.instrument('USDJPY') }, f.context)],
    [marketDescriptor, await f.market.queryBars(f.query(), f.context)],
    [accountDescriptor, await f.account.listAccounts({}, f.context)],
    [accountDescriptor, await f.account.snapshot({ account }, f.context)],
    [accountDescriptor, await f.account.queryPositions({ account }, f.context)],
    [accountDescriptor, await f.account.queryOrders({ ...input, scope: 'all' }, f.context)],
    [accountDescriptor, await f.account.queryFills(input, f.context)],
    [accountDescriptor, await f.account.queryHistory(input, f.context)],
  ];
  for (const [descriptor, result] of results) { validateFinancialData(result.data); validateRead(result, { ...descriptor, pluginId: 'sesame/kurumi-replay' }, 'portable-opt-in'); }
});
test('initial Dashboard includes real pre-play warmup while never reading unrevealed next frame',async()=>{const f=fixture();f.state.index=f.chapters[0].startIndex;Object.defineProperty(f.frames[0],2,{get(){throw Error('FUTURE BAR MUST NOT BE READ');},configurable:true});const read=await f.market.queryBars({...f.query(),range:range(T,T+2*H),page:{limit:20}},f.context);assert.deepEqual(read.data.page.items.map(x=>x.openTime.unixMs),[T,T+H]);});


test('warmup CHFJPY is genuine synchronized data; trimmed arrays do not invent missing prehistory', async () => {
  const f = fixture(); f.state.chapter = 2; f.state.index = f.chapters[2].startIndex;
  Object.defineProperty(f.frames[2], 2, { get() { throw Error('UNREVEALED EURCHF FRAME'); }, configurable: true });
  const query = { ...f.query('CHFJPY'), range: range(T + 20 * H, T + 22 * H), page: { limit: 20 } };
  const bid = await f.market.queryBars(query, f.context);
  assert.deepEqual(bid.data.page.items.map(b => b.openTime.unixMs), [T + 20 * H, T + 21 * H]);
  assert.ok(bid.data.page.items.every(b => b.close === '150.1' && b.isClosed));
  const ask = await f.market.queryBars({ ...query, spec: spec('ask') }, f.context);
  assert.ok(ask.data.page.items.every(b => b.close === '150.2'));
  const trimmed = fixture(); trimmed.frames[0] = trimmed.frames[0].slice(1);
  const local = await trimmed.market.queryBars({ ...trimmed.query(), range: range(T, T + 3 * H), page: { limit: 20 } }, trimmed.context);
  assert.deepEqual(local.data.page.items.map(b => b.openTime.unixMs), [T + H, T + 2 * H]);
});
