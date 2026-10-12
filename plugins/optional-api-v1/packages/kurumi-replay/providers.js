import { readConsumedView, readSpectatorCheckpoint, consumedBars, observedH1Limitations } from './replay-presentation.js';
import { revealedCutoff } from './reveal-cutoff.js';
import { createHash, randomUUID } from 'node:crypto';

// Public HostContext provider patterns: Sesame AKShare provider and MT5
// backend/providers.js + contract-mapping.js. No terminal, private host import,
// resource loader, timers, dependency installation or trade execution occurs here.
const HOUR = 3600000;
const CONNECTION = 'kurumi-simulation';
const copy = x => structuredClone(x);
const canonical = x => x === undefined ? 'null' : x === null || typeof x !== 'object' ? JSON.stringify(x) : Array.isArray(x) ? `[${x.map(canonical).join(',')}]` : `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
const hash = x => createHash('sha256').update(canonical(x)).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const check = (ok, message, code = 'INVALID_ARGUMENT') => { if (!ok) fail(code, message); };
const present = x => x !== undefined && x !== null && x !== '';
const first = (...xs) => xs.find(present);
const value = value => ({ status: 'value', value });
const unknown = (reason = 'The simulation did not report this field') => ({ status: 'unknown', reason });
const na = () => ({ status: 'not_applicable' });
const unsupported = reason => ({ status: 'unsupported', reason });
function decimal(x) {
  check(present(x) && typeof x !== 'boolean', 'Missing decimal', 'SOURCE_DATA_INVALID');
  let s = String(x);
  if (typeof x === 'number') check(Number.isFinite(x), 'Non-finite decimal', 'SOURCE_DATA_INVALID');
  if (/e/i.test(s)) {
    const m = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s);
    check(m && Math.abs(Number(m[4])) <= 1000, 'Invalid decimal exponent', 'SOURCE_DATA_INVALID');
    const [, sign, whole, fraction = '', power] = m, digits = whole + fraction, p = whole.length + Number(power);
    s = sign + (p <= 0 ? '0.' + '0'.repeat(-p) + digits : p >= digits.length ? digits + '0'.repeat(p - digits.length) : digits.slice(0, p) + '.' + digits.slice(p));
  }
  check(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s) && s.length <= 2048, 'Invalid decimal', 'SOURCE_DATA_INVALID');
  return s;
}
function compare(a, b) {
  const parts = x => { const s = decimal(x), [w, f = ''] = s.replace(/^-/, '').split('.'); return { sign: s.startsWith('-') ? -1n : 1n, w, f }; };
  const x = parts(a), y = parts(b), n = Math.max(x.f.length, y.f.length);
  const i = p => p.sign * BigInt(p.w + p.f.padEnd(n, '0'));
  return i(x) < i(y) ? -1 : i(x) > i(y) ? 1 : 0;
}
const dv = x => present(x) ? value(decimal(x?.value ?? x)) : unknown();
const money = (x, currency) => present(x) && present(x?.currency ?? currency) ? value({ value: decimal(x?.value ?? x), currency: String(x?.currency ?? currency) }) : unknown();
const negDecimal = x => { const d = decimal(x); return compare(d, '0') === 0 ? '0' : d.startsWith('-') ? d.slice(1) : '-' + d; };
const absDecimal = x => decimal(x).replace(/^-/, '');
const quantity = (x, unit) => { const v = decimal(x?.value ?? x); check(compare(v, '0') >= 0, 'Negative quantity', 'SOURCE_DATA_INVALID'); check(!x?.unit || x.unit === unit, 'Quantity must use the instrument base currency', 'SOURCE_DATA_INVALID'); return { value: v, unit }; };
const qv = (x, unit) => present(x) ? value(quantity(x, unit)) : unknown();
const utc = unixMs => { check(Number.isSafeInteger(unixMs) && Number.isFinite(new Date(unixMs).getTime()), 'Expected UTC milliseconds', 'SOURCE_DATA_INVALID'); return { basis: 'utc', unixMs }; };
const eventTime = x => { if (x?.basis) { check(x.basis === 'utc', 'Ledger timestamps must be UTC', 'SOURCE_DATA_INVALID'); return utc(x.unixMs); } return utc(x); };
const identity = (state, symbol) => ({ sourceId: `kurumi:${state.id}`, instrumentId: symbol });
const accountRef = state => ({ connectionId: CONNECTION, accountId: state.id });
const symbolOf = chapter => first(chapter.symbol, chapter.pair, chapter.instrument?.instrumentId, typeof chapter.instrument === 'string' ? chapter.instrument : undefined, /^[A-Z]{6}$/.test(chapter.id ?? '') ? chapter.id : undefined);
const side = (raw, position = false) => { const s = String(raw).toLowerCase(); check(['buy', 'sell', 'long', 'short'].includes(s), 'Missing trade side', 'SOURCE_DATA_INVALID'); return position ? ['buy', 'long'].includes(s) ? 'long' : 'short' : ['buy', 'long'].includes(s) ? 'buy' : 'sell'; };

// Exact adapter-only arithmetic; never changes the challenge ledger.
const addDecimal=(a,b)=>{const part=x=>{const s=decimal(x),[w,f='']=s.replace(/^-/,'').split('.');return {n:BigInt(w+f)*(s.startsWith('-')?-1n:1n),s:f.length};};const x=part(a),y=part(b),scale=Math.max(x.s,y.s),n=x.n*10n**BigInt(scale-x.s)+y.n*10n**BigInt(scale-y.s);let t=(n<0n?-n:n).toString().padStart(scale+1,'0');if(scale)t=t.slice(0,-scale)+'.'+t.slice(-scale);return (n<0n?'-':'')+t.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');};
export const nativeOrderKey=fill=>{check(present(fill.nativeClientOrderId)&&Number.isSafeInteger(fill.chapter),'Native order identity is missing','SOURCE_DATA_INVALID');return `native:${fill.chapter}:${fill.nativeClientOrderId}`;};
/** Native fills share a decision attribution, NOT an order identity. Partition
 * by actual nativeClientOrderId+chapter. Old decisions are never rewritten.
 * If only fills survive, requested/working/terminal order facts remain unknown;
 * the required quantity is explicitly a fill-backed executed projection. */
export function nativeOrderTraceAt(state,asOfMs){
 let rows=state.nativeOrderTrace??[];check(Array.isArray(rows),'Native trace must be array','SOURCE_DATA_INVALID');
 const c=state.nativeOrderTraceCoverage;if(Number.isSafeInteger(asOfMs)&&c?.engineVersion===state.version&&c.asOfMs===asOfMs&&Number.isSafeInteger(c.eventCount)){check(c.eventCount>=0&&c.eventCount<=rows.length,'Actual native lifecycle prefix count invalid','SOURCE_DATA_INVALID');rows=rows.slice(0,c.eventCount);}
 return Number.isSafeInteger(asOfMs)?rows.filter(t=>{check(Number.isSafeInteger(t.time),'Native trace source clock missing','SOURCE_DATA_INVALID');return t.time<=asOfMs;}):rows;
}
export function nativeOrderCoverageAt(state,asOfMs){const c=state.nativeOrderTraceCoverage;return c?.complete===true&&c.engineVersion===state.version&&c.asOfMs===asOfMs&&Number.isSafeInteger(c.eventCount)&&nativeOrderTraceAt(state,asOfMs).length===c.eventCount;}
export function projectNativeOrders(state,{asOfMs}={}){
 const groups=new Map();for(const f of state.fills.filter(f=>!Number.isSafeInteger(asOfMs)||f.time<=asOfMs)){const key=nativeOrderKey(f),group=groups.get(key)??[];group.push(f);groups.set(key,group);}
 const traces=new Map();for(const t of nativeOrderTraceAt(state,asOfMs)){check(Number.isSafeInteger(t.time)&&['buy','sell'].includes(t.side)&&present(t.quantity),'Native trace needs real time/side/requested quantity','SOURCE_DATA_INVALID');const key=nativeOrderKey(t);const prev=traces.get(key);check(!prev||t.time>=prev.time,'Native order trace chronology invalid','SOURCE_DATA_INVALID');traces.set(key,t);}
 const keys=new Set([...groups.keys(),...traces.keys()]),result=[];
 for(const id of keys){const fills=groups.get(id)??[],trace=traces.get(id),firstFill=fills[0],lastFill=fills.at(-1);let total='0';for(const f of fills)total=addDecimal(total,absDecimal(f.signedQuantity));
  const direction=trace?.side??(firstFill?.signedQuantity.startsWith('-')?'sell':'buy');check(fills.every(f=>(f.signedQuantity.startsWith('-')?'sell':'buy')===direction),'One native order has conflicting directions','SOURCE_DATA_INVALID');
  if(present(trace?.filledQuantity))check(compare(trace.filledQuantity,total)===0,'Native cache filled quantity and exact viewer fill prefix disagree','SOURCE_MISMATCH');
  const quantity=trace?.quantity??total;check(compare(quantity,total)>=0,'Native order fills exceed actual native request','SOURCE_DATA_INVALID');
  const row={id,nativeClientOrderId:trace?.nativeClientOrderId??firstFill.nativeClientOrderId,clientId:trace?.nativeClientOrderId??firstFill.nativeClientOrderId,instrument:trace?.instrument??firstFill.instrument,chapter:trace?.chapter??firstFill.chapter,time:trace?.createdAt??firstFill?.time??trace.time,updatedAt:Math.max(trace?.time??0,lastFill?.time??0),side:direction,quantity,filledQuantity:total,remainingQuantity:trace?.remainingQuantity,status:trace?.status??'unknown',orderType:trace?.orderType??(fills.every(f=>f.reason==='stop')?'stop':'market'),stopPrice:trace?.stopPrice,
    nativeStatus:trace?.nativeStatus,sourceClassification:trace?'actual-native-order-trace':'actual-native-fill-backed-executed-quantity; requested/working/terminal-status unknown',decisionIds:[...new Set(fills.map(f=>f.orderId))],parentDecisionIds:[...new Set([trace?.parentDecisionId,...(trace?.parentDecisionIds??[]),...fills.map(f=>f.parentDecisionId??f.orderId)].filter(present))],executionReasons:[...new Set(fills.map(f=>f.reason??f.mode).filter(present))],rawFillIds:fills.map(f=>f.id),nativeTradeIds:fills.map(f=>f.nativeTradeId??null)};
  check(Number.isSafeInteger(row.time),'Native order has no known time','SOURCE_DATA_INVALID');result.push(row);
 }
 return result;
}

export const marketDescriptor = { id: 'market', contract: 'sesame.market', versions: ['1.0.0'], capabilities: ['instruments.search', 'instruments.describe', 'bars.history', 'bars.subscribe'], connection: { required: false }, priceBases: ['bid', 'ask'], adjustments: ['none'], sessions: ['all'] };
export const accountDescriptor = { id: 'account', contract: 'sesame.account', versions: ['1.0.0'], capabilities: ['accounts.list', 'account.snapshot', 'positions.query', 'orders.query', 'fills.query', 'history.query', 'account.subscribe'], connection: { required: false }, liveTopics: ['snapshot', 'positions', 'orders', 'fills', 'history'] };

class ReplayProvider {
  constructor(host, service) {
    // Also allow new ReplayMarketProvider(service) in portable tests.
    this.host = service ? host : null; this.service = service ?? host;
    check(['getState', 'getData', 'observe', 'subscribe'].every(k => typeof this.service?.[k] === 'function'), 'Replay service interface is incomplete');
    this.bindings = new Map(); this.snapshots = new Map(); this.cursors = new Map(); this.streams = new Set(); this.closed = false;
  }
  revealed() {
    const committed=this.service.getSpectatorState?.()??this.service.getState(),spectator=readSpectatorCheckpoint(this.host,committed?.id);
    const state = spectator?.engine ?? committed, data = this.service.getData();
    check(state && data && typeof state.id === 'string' && state.id.length > 0, 'No active simulation', 'SOURCE_UNAVAILABLE');
    check(Array.isArray(data.chapters) && data.chapters.length > 0, 'Missing chapters', 'SOURCE_DATA_INVALID');
    if (state.dataDigests) check(canonical(state.dataDigests) === canonical(data.digests), 'Replay data no longer matches engine digests', 'CONNECTION_CHANGED');
    const ci = Number.isInteger(state.chapter) ? state.chapter : data.chapters.findIndex(c => c.id === (state.chapter?.id ?? state.chapter));
    check(ci >= 0 && ci < data.chapters.length && Number.isSafeInteger(state.index), 'Invalid revealed chapter/index', 'SOURCE_DATA_INVALID');
    const chapter = data.chapters[ci];
    check(Number.isSafeInteger(chapter.startIndex) && Number.isSafeInteger(chapter.endIndex) && chapter.startIndex <= chapter.endIndex && state.index >= chapter.startIndex && state.index <= chapter.endIndex, 'Index outside current chapter', 'SOURCE_DATA_INVALID');
    const frame = this.frame(data, ci, state.index);
    check(frame, 'Current revealed frame is missing', 'SOURCE_DATA_INVALID');
    const consumedView = this.service.getReplayPresentation?.() ?? readConsumedView(this.host,state.id);
    const round2 = this.service.presentationEnabled === true || state.experimentProfile?.round === 2 || state.experiment?.round === 2 || state.rules?.experimentProfile?.id === 'informed-replay-50x-v1';
    check(!round2 || consumedView, 'Round2 consumed-tick bridge not ready; missing data remains paused', 'CONSUMED_TICKS_REQUIRED');
    check(!consumedView || consumedView.commitVersion===state.version, 'Presentation/account commit not atomic yet; refresh snapshot', 'SNAPSHOT_REQUIRED');
    const endTime = consumedView?.cutoffMs ?? revealedCutoff(state,frame);
    return { state, data, ci, chapter, frame, endTime, consumedView };
  }
  frameRows(data, ci) {
    const c = data.chapters[ci], symbol = symbolOf(c);
    const rows = Array.isArray(data.frames) ? data.frames[ci] : data.frames?.[symbol] ?? data.frames?.[c.id] ?? data.frames?.[String(ci)] ?? data.frames?.[symbol?.toLowerCase()];
    check(Array.isArray(rows), 'Missing chapter frame array', 'SOURCE_DATA_INVALID');
    return rows;
  }
  frame(data, ci, index) {
    const c = data.chapters[ci], rows = this.frameRows(data, ci);
    // Full arrays contain already historical pre-playFrom warmup at index 0.
    // A trimmed chapter-local array cannot manufacture missing prehistory.
    const full = rows.length > c.endIndex, offset = full ? index : index - c.startIndex;
    check(offset >= 0 && index >= (full ? 0 : c.startIndex) && index <= c.endIndex, 'Invalid chapter frame index', 'SOURCE_DATA_INVALID');
    return rows[offset];
  }
  bind(input = {}, context) {
    check(!this.closed && context?.bindingId, 'Provider disposed or binding missing', 'CONNECTION_CHANGED'); context.signal?.throwIfAborted();
    const r = this.revealed(), connection = { id: CONNECTION, revision: r.state.id };
    check(!input.connection || canonical(input.connection) === canonical(connection), 'Simulation connection changed', 'CONNECTION_CHANGED');
    check(!input.configuration || Object.keys(input.configuration).length === 0, 'No provider configuration is supported');
    if (this.bindings.has(context.bindingId)) this.unbind(context);
    this.bindings.set(context.bindingId, r.state.id);
    return { connection, sourceIds: [`kurumi:${r.state.id}`], accounts: [accountRef(r.state)], health: 'ready', timeBasis: { kind: 'utc' } };
  }
  bound(context, account, instrument) {
    context?.signal?.throwIfAborted();
    const r = this.revealed();
    check(!this.closed && this.bindings.get(context?.bindingId) === r.state.id, 'Binding no longer refers to this simulation', 'CONNECTION_CHANGED');
    if (context.connection) check(canonical(context.connection) === canonical({ id: CONNECTION, revision: r.state.id }), 'Connection changed', 'CONNECTION_CHANGED');
    if (account) check(canonical(account) === canonical(accountRef(r.state)), 'Account does not belong to this SIMULATED connection', 'ACCOUNT_MISMATCH');
    if (instrument) check(instrument.sourceId === `kurumi:${r.state.id}`, 'Wrong replay source', 'INSTRUMENT_MISMATCH');
    return r;
  }
  validateInput(input, keys) {
    check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(k => keys.includes(k)), 'Unsupported provider input field');
  }
  allowedSymbol(symbol, r) {
    return r.data.chapters.slice(0, r.ci + 1).some(c => symbolOf(c) === symbol) || (symbol === 'CHFJPY' && symbolOf(r.chapter) === 'EURCHF');
  }
  range(range, r, required = true) {
    if (!range && !required) return null;
    check(range?.from?.basis === 'utc' && range?.to?.basis === 'utc', 'Ranges must use UTC', 'UNSUPPORTED_CAPABILITY');
    const from = utc(range.from.unixMs).unixMs, to = utc(range.to.unixMs).unixMs;
    check(from < to, 'Range must be ascending');
    check(to <= r.endTime, 'Range exceeds the currently revealed endTime', 'FUTURE_DATA_FORBIDDEN');
    return { from, to };
  }
  meta(r) {
    return { observedAt: Date.now(), freshness: 'unknown', origin: 'demo', consistency: 'atomic', sourceTime: utc(r.endTime), warnings: ['SIMULATED replay data. This is not a broker account, executable price or live market feed.', r.consumedView ? 'Disclosed mixed source: observed native closed H1 preheat is NOT execution ticks; later consumed-only quote aggregation has forming bounded by revealedThrough; historical gaplessness unverified.' : 'Legacy closed H1 bars only; numeric engine inputs may already contain binary floating-point rounding.'], source: { ...(Array.isArray(r.state.ledger)?{costs:{commission:r.state.ledger.reduce((s,row)=>addDecimal(s,row.commission),'0'),financing:r.state.ledger.reduce((s,row)=>addDecimal(s,row.financing),'0'),currency:'JPY',classification:'exact recorded ledger sums'}}:{}), ...((r.state.rules?.engine==='nautilus-trader'||Array.isArray(r.state.nativeOrderTrace)||r.state.fills?.some(f=>present(f.nativeClientOrderId)))?{orderMapping:r.state.fills.filter(f=>f.time<=r.endTime).map(f=>({fillId:f.id,nativeOrderKey:nativeOrderKey(f),nativeClientOrderId:f.nativeClientOrderId,queryOrderId:`kurumi:${r.state.id}:order:${nativeOrderKey(f)}`,decisionId:f.orderId,parentDecisionId:f.parentDecisionId??f.orderId,executionReason:f.reason??f.mode??null,nativeTradeId:f.nativeTradeId??null})),orderCoverage:{complete:nativeOrderCoverageAt(r.state,r.endTime),reason:'Native fills identify executions, not unfilled/cancelled/working stop order states without nativeOrderTrace'}}:{}), ...(Array.isArray(r.state.nativeOrderTrace)?{nativeOrderParentLinks:nativeOrderTraceAt(r.state,r.endTime).map(t=>({nativeOrderKey:nativeOrderKey(t),nativeClientOrderId:t.nativeClientOrderId,parentDecisionId:t.parentDecisionId??null,parentDecisionIds:t.parentDecisionIds??null,nativeStatus:t.nativeStatus??null,event:t.event??null,nativeEventNs:t.nativeEventNs??null,internalOrderingOnly:t.internalOrderingOnly??null,sourceSequence:t.sourceSequence??null,nativeInstrumentId:t.nativeInstrumentId??null,quantity:t.quantity,filledQuantity:t.filledQuantity??null,remainingQuantity:t.remainingQuantity??null,stopPrice:t.stopPrice??null,reduceOnly:t.reduceOnly??null,source:'actual-native-order-trace'}))}:{}), simulationId: r.state.id, simulationVersion: String(r.state.version), revealedThrough: utc(r.endTime) } };
  }
  page(method, input, context, load) {
    const { page = {}, ...filters } = input, limit = page.limit ?? 100;
    check(Number.isSafeInteger(limit) && limit > 0 && limit <= 2000, 'page.limit must be 1..2000');
    check(Object.keys(page).every(k => ['limit', 'cursor'].includes(k)), 'Unknown pagination field');
    const revealedEndTime = this.bound(context).endTime;
    const key = hash([method, context.bindingId, filters]);
    let snapshot, offset = 0;
    if (page.cursor !== undefined) {
      check(typeof page.cursor === 'string', 'Invalid cursor', 'INVALID_CURSOR');
      const c = this.cursors.get(page.cursor); snapshot = c && this.snapshots.get(c.id); offset = c?.offset;
      check(snapshot && snapshot.expires > Date.now() && snapshot.key === key && snapshot.revealedEndTime <= revealedEndTime, 'Cursor expired or belongs to another binding/query', 'INVALID_CURSOR');
    } else {
      const data = load();
      check(Array.isArray(data.items) && data.items.length <= 100000 && Buffer.byteLength(JSON.stringify(data)) <= 16 * 1024 * 1024, 'Snapshot exceeds budget', 'RESOURCE_EXHAUSTED');
      for (const [id, s] of this.snapshots) if (s.expires <= Date.now()) this.dropSnapshot(id);
      while (this.snapshots.size >= 32) this.dropSnapshot(this.snapshots.keys().next().value);
      snapshot = { ...copy(data), id: randomUUID(), key, bindingId: context.bindingId, expires: Date.now() + 300000, revealedEndTime };
      this.snapshots.set(snapshot.id, snapshot);
    }
    const end = Math.min(snapshot.items.length, offset + limit);
    let nextCursor = null;
    if (end < snapshot.items.length) {
      snapshot.tokens ??= new Map();
      nextCursor = snapshot.tokens.get(end);
      if (!nextCursor) { nextCursor = randomUUID(); snapshot.tokens.set(end, nextCursor); this.cursors.set(nextCursor, { id: snapshot.id, offset: end }); }
    }
    const { items, id, key: _key, bindingId: _binding, expires, tokens, revealedEndTime: _endTime, ...extra } = snapshot;
    return { ...copy(extra), page: { items: copy(items.slice(offset, end)), snapshotId: id, consistency: 'snapshot', nextCursor } };
  }
  dropSnapshot(id) { const s = this.snapshots.get(id); for (const token of s?.tokens?.values() ?? []) this.cursors.delete(token); this.snapshots.delete(id); }
  unbind({ bindingId }) { this.bindings.delete(bindingId); for (const [id, s] of this.snapshots) if (s.bindingId === bindingId) this.dropSnapshot(id); for (const s of [...this.streams]) if (s.bindingId === bindingId) void s.close(); }
  dispose() { this.closed = true; for (const s of [...this.streams]) void s.close(); this.bindings.clear(); this.snapshots.clear(); this.cursors.clear(); }
  stream(snapshot, read, events, context) {
    check(Buffer.byteLength(JSON.stringify(snapshot)) <= 1024 * 1024, 'Subscription snapshot exceeds 1 MiB; use fewer topics or smaller tail', 'RESOURCE_EXHAUSTED');
    const position = { streamId: randomUUID(), epoch: randomUUID(), seq: '0' };
    let closed = false, started = false, emit, seq = 0n, previous = copy(snapshot);
    const send = e => { check(Buffer.byteLength(JSON.stringify(e)) <= 1024 * 1024 - 1024, 'Stream event exceeds 1 MiB', 'RESOURCE_EXHAUSTED'); emit({ ...position, seq: String(++seq), eventId: `${position.epoch}:${seq}`, schemaVersion: '1.0.0', observedAt: Date.now(), ...copy(e) }); };
    const refresh = () => {
      if (closed || !started) return;
      try { const next = read(); for (const event of events(previous, next)) { if (closed) break; send(event); } previous = copy(next); }
      catch (error) { if (!closed) send({ type: 'stream.gap', payload: { code: error.code ?? 'SOURCE_UNAVAILABLE', message: error.message, recovery: 'snapshot' } }); void handle.close(); }
    };
    // Observe service notifications, never poll the clock or install resources.
    const unsubscribe = this.service.subscribe(refresh);
    check(typeof unsubscribe === 'function', 'service.subscribe must return unsubscribe', 'SOURCE_DATA_INVALID');
    const abort = () => void handle.close();
    const handle = { snapshot: copy(snapshot), position, consistency: 'atomic', recovery: 'snapshot', resumeToken: null, bindingId: context.bindingId,
      ready: listener => { if (started || closed) return; check(typeof listener === 'function', 'ready requires an event listener'); emit = listener; started = true; refresh(); },
      close: async () => { if (closed) return; closed = true; unsubscribe(); context.signal?.removeEventListener('abort', abort); this.streams.delete(handle); } };
    this.streams.add(handle); context.signal?.addEventListener('abort', abort, { once: true }); if (context.signal?.aborted) void handle.close();
    return handle;
  }
  coverage(range, rows, time = x => x.openTime, end = x => x.endTime ?? time(x)) {
    // Complete only relative to the bounded revealed engine records, not proof
    // of continuous exchange history (weekend/source gaps remain unverified).
    return { requested: copy(range), observedRange: rows.length ? { from: time(rows[0]), to: end(rows.at(-1)) } : null, complete: false, gaps: [{ range: copy(range), reason: 'not_available' }] };
  }
}

export class ReplayMarketProvider extends ReplayProvider {
  catalog(r) {
    const list = [];
    for (let ci = 0; ci <= r.ci; ci++) { const symbol = symbolOf(r.data.chapters[ci]); check(typeof symbol === 'string' && /^[A-Z]{6}$/.test(symbol), 'Chapter must name an FX symbol', 'SOURCE_DATA_INVALID'); list.push({ symbol, ci, fx: false }); }
    if (symbolOf(r.chapter) === 'EURCHF') list.push({ symbol: 'CHFJPY', ci: r.ci, fx: true });
    return list;
  }
  selected(r, instrument) { check(instrument && typeof instrument.instrumentId === 'string', 'Instrument reference is required'); const item = this.catalog(r).find(x => x.symbol === instrument.instrumentId); check(item, 'Instrument is not revealed in this chapter', 'FUTURE_DATA_FORBIDDEN'); return item; }
  detail(r, item) {
    return { ref: identity(r.state, item.symbol), symbol: item.symbol, name: `${item.symbol} — SIMULATED`, assetClass: 'fx', venue: unknown('No exchange/broker venue'), currency: value(item.symbol.slice(3)), price: { tickSize: unknown('No execution tick rule'), displayDecimals: item.symbol.endsWith('JPY') ? 3 : 5 }, quantity: { unit: item.symbol.slice(0, 3), min: unknown(), max: unknown(), step: unknown(), contractMultiplier: unknown() }, volume: { realUnit: unknown('No volume in replay frames'), hasReal: false, hasTick: false }, timeBasis: { kind: 'utc' }, calendar: unknown('No pinned market calendar'), features: { timeframes: ['1h'], priceBases: ['bid', 'ask'], adjustments: ['none'] }, native: { symbol: item.symbol, simulated: true } };
  }
  async searchInstruments(input, context) {
    this.validateInput(input, ['query', 'page', 'assetClasses', 'venues']);
    const r = this.bound(context); check(String(input.query ?? '').length <= 200, 'Query is too long');
    const result = this.page('searchInstruments', input, context, () => ({ items: this.catalog(r).map(x => this.detail(r, x)).filter(x => (!input.query || `${x.symbol} ${x.name}`.toLowerCase().includes(input.query.toLowerCase())) && (!input.assetClasses?.length || input.assetClasses.includes('fx')) && !input.venues?.length), meta: this.meta(r) }));
    return { data: result.page, meta: result.meta };
  }
  async describeInstrument(input, context) { this.validateInput(input, ['instrument']); const r = this.bound(context, null, input.instrument); return { data: this.detail(r, this.selected(r, input.instrument)), meta: this.meta(r) }; }
  spec(spec) { check(spec?.timeframe === '1h' && ['bid', 'ask'].includes(spec.priceBasis) && spec.adjustment === 'none' && spec.session === 'all' && spec.calendarRevision?.status === 'unknown', 'Only 1h bid/ask, none adjustment, all session, unknown calendar is supported', 'UNSUPPORTED_CAPABILITY'); }
  bars(r, instrument, spec, includeForming = false) {
    this.spec(spec); const item = this.selected(r, instrument), c = r.data.chapters[item.ci], last = item.ci < r.ci ? c.endIndex : r.state.index;
    const seriesId = `kurumi-series-${hash([instrument, spec]).slice(0, 24)}`, bars = [];
    if(r.consumedView) {
      const view=observedH1Limitations(r.consumedView,r.data);
      return {seriesId,instrument:copy(instrument),spec:copy(spec),bars:consumedBars(view,item.symbol,spec.priceBasis,seriesId,includeForming)};
    }
    let previousTime = -Infinity;
    // Warmup is real data before the first decision, not future revelation.
    const firstIndex = this.frameRows(r.data, item.ci).length > c.endIndex ? 0 : c.startIndex;
    for (let i = firstIndex; i <= last; i++) {
      const f = this.frame(r.data, item.ci, i); check(f, 'Revealed frame missing', 'SOURCE_DATA_INVALID');
      const openTime = utc(f.time), endTime = utc(f.time + HOUR);
      if(endTime.unixMs>r.endTime)continue;
      check(f.time > previousTime, 'Invalid revealed bar timestamp', 'SOURCE_DATA_INVALID'); previousTime = f.time;
      if (item.fx && f.fx?.time !== undefined) check(f.fx.time === f.time, 'CHFJPY frame must be synchronous', 'SOURCE_DATA_INVALID');
      const prices = (item.fx ? f.fx : f)?.[spec.priceBasis];
      check(prices, 'Revealed frame lacks requested price basis', 'SOURCE_DATA_INVALID');
      const ohlc = Object.fromEntries(['open', 'high', 'low', 'close'].map(k => [k, decimal(prices[k])]));
      check(compare(ohlc.low, ohlc.high) <= 0 && ['open', 'close'].every(k => compare(ohlc[k], ohlc.low) >= 0 && compare(ohlc[k], ohlc.high) <= 0), 'OHLC is inconsistent', 'SOURCE_DATA_INVALID');
      const body = { id: `${seriesId}:${f.time}`, openTime, endTime, ...ohlc, isClosed: true, closure: 'source', volume: { default: 'none', real: unknown('No real volume in replay input'), tick: unknown('No tick volume in replay input') }, turnover: unknown('No turnover in replay input') };
      check(Number.isSafeInteger(r.state.version)&&r.state.version>=0,'Actual unsigned engine revision required','SOURCE_REVISION_REQUIRED');
      bars.push({ ...body, revision: String(r.state.version) });
    }
    return { seriesId, instrument: copy(instrument), spec: copy(spec), bars };
  }
  async queryBars(input, context) {
    this.validateInput(input, ['instrument', 'spec', 'range', 'page', 'includeForming', 'direction']);
    const r = this.bound(context, null, input.instrument), range = this.range(input.range, r); this.spec(input.spec); this.selected(r, input.instrument);
    check(['forward', 'backward'].includes(input.direction ?? 'forward'), 'Invalid direction');
    const result = this.page('queryBars', input, context, () => { const { bars, ...data } = this.bars(r, input.instrument, input.spec, input.includeForming===true), items = bars.filter(b => b.openTime.unixMs >= range.from && b.openTime.unixMs < range.to && (b.isClosed ? b.endTime.unixMs <= range.to : input.includeForming===true && b.native.revealedThrough.unixMs <= range.to)); return { ...data, items: input.direction === 'backward' ? items.toReversed() : items, coverage: this.coverage(input.range, items, b=>b.openTime, b=>b.isClosed?b.endTime:b.native.revealedThrough), meta: this.meta(r) }; });
    result.page.items.sort((a, b) => a.openTime.unixMs - b.openTime.unixMs);
    const { meta, ...data } = result; return { data, meta };
  }
  async subscribeBars(input, context) {
    this.validateInput(input, ['instrument', 'spec', 'tailLimit', 'includeForming', 'resumeToken', 'range']);
    check(!input.resumeToken, 'Replay subscriptions require a fresh snapshot', 'RESUME_EXPIRED');
    check(Number.isSafeInteger(input.tailLimit) && input.tailLimit > 0 && input.tailLimit <= 2000, 'tailLimit must be 1..2000');
    const fixed = copy(input);
    const read = () => { const r = this.bound(context, null, fixed.instrument); if (fixed.range) this.range(fixed.range, r); const data = this.bars(r, fixed.instrument, fixed.spec, fixed.includeForming===true); data.bars = data.bars.slice(-fixed.tailLimit); const range = { from: data.bars[0]?.openTime ?? utc(r.endTime - HOUR), to: utc(r.endTime) }; return { ...data, coverage: this.coverage(range, data.bars, b=>b.openTime, b=>b.isClosed?b.endTime:b.native.revealedThrough) }; };
    return this.stream(read(), read, (old, next) => { const prior = new Map(old.bars.map(b => [b.id, b.revision])); const changed = next.bars.filter(b => b.revision !== prior.get(b.id)); return changed.length ? [{ type: 'bars.upsert', payload: { seriesId: next.seriesId, bars: changed } }] : []; }, context);
  }
}

export class ReplayAccountProvider extends ReplayProvider {
  observed(r) {
    // The engine's public observer computes snapshot(state,currentFrame). Never
    // import/read a future frame to mark an account, or modify its ledger.
    const spectator=readSpectatorCheckpoint(this.host,r.state.id);
    const observation = spectator ? {account:{...spectator.account,id:r.state.id,version:r.state.version,time:spectator.account.quoteTimeMs??spectator.cutoffMs}} : this.service.getSpectatorState&&this.service.accountSnapshot ? {account:this.service.accountSnapshot(r.state,r.frame)} : this.service.observe();
    check(observation && typeof observation === 'object', 'No revealed observation', 'SOURCE_UNAVAILABLE');
    const account = observation.account ?? {};
    if (present(account.id)) check(account.id === r.state.id, 'Observation belongs to another simulation', 'ACCOUNT_MISMATCH');
    if (present(account.version)) check(account.version === r.state.version, 'Observation version is stale', 'SOURCE_UNAVAILABLE');
    const time = first(account.time, account.asOf?.basis === 'utc' ? account.asOf.unixMs : undefined);
    if (present(time)) check(utc(time).unixMs <= r.endTime, 'Observation reveals a future account state', 'FUTURE_DATA_FORBIDDEN');
    return account;
  }
  currency(r, observed = {}) { return first(observed.currency, observed.baseCurrency?.value, r.state.currency, r.state.accountCurrency, present(observed.unrealizedJpy) || present(r.state.rules?.commissionJpyPer1000PerSide) ? 'JPY' : undefined); }
  summary(r, observed = {}) { return { ref: accountRef(r.state), name: `Kurumi SIMULATED ${r.state.id}`, broker: 'SIMULATED — no broker', server: value('kurumi-simulation'), nativeLogin: na(), mode: 'demo', baseCurrency: present(this.currency(r, observed)) ? value(this.currency(r, observed)) : unknown('Account currency not reported'), positionMode: 'netting' }; }
  accountSnapshot(r) {
    const o = this.observed(r), currency = this.currency(r, o), amount = key => money(first(o[key]?.status === 'value' ? o[key].value : o[key]?.status ? undefined : o[key], !Array.isArray(r.state[key]) ? r.state[key] : undefined), currency);
    return { account: this.summary(r, o), snapshotId: `kurumi-${hash([r.state.id, r.state.version, r.state.chapter, r.state.index, r.state.balance, o]).slice(0, 32)}`, asOf: utc(r.endTime), balance: money(r.state.balance, currency), equity: amount('equity'), available: money(first(o.available?.status === 'value' ? o.available.value : o.available?.status ? undefined : o.available, o.freeMargin), currency), buyingPower: unsupported('Not a broker buying-power model'), unrealizedPnl: money(first(o.unrealizedPnl?.status === 'value' ? o.unrealizedPnl.value : o.unrealizedPnl?.status ? undefined : o.unrealizedPnl, o.unrealizedJpy), currency), realizedPnl: Array.isArray(r.state.ledger)?money(r.state.ledger.reduce((sum,row)=>addDecimal(sum,row.realizedJpy),'0'),currency):amount('realizedPnl'), margin: { used: money(typeof o.margin === 'string' ? o.margin : undefined, currency), free: money(o.freeMargin, currency), levelRatio: unknown(), maintenance: unknown() }, restrictions: [{ code: 'SIMULATED', description: 'Historical simulation only; no broker or live trading authority', observedAt: Date.now() }] };
  }
  async listAccounts(input, context) { this.validateInput(input, ['page', 'range']); const r = this.bound(context); if (input.range) this.range(input.range, r); const result = this.page('listAccounts', input, context, () => ({ items: [this.summary(r, this.observed(r))], meta: this.meta(r) })); return { data: result.page, meta: result.meta }; }
  async snapshot(input, context) { this.validateInput(input, ['account', 'range']); check(input.account, 'Account reference is required'); const r = this.bound(context, input.account); if (input.range) this.range(input.range, r); return { data: this.accountSnapshot(r), meta: this.meta(r) }; }
  rowId(kind, row, r) { check(present(row.id), `${kind} ledger row needs stable id`, 'SOURCE_DATA_INVALID'); return `kurumi:${r.state.id}:${kind}:${row.id}`; }
  revision(body,r) { const revision=r.consumedView?.revision??r.state.version;check(Number.isSafeInteger(revision)&&revision>=0,'Actual unsigned account source revision required','SOURCE_REVISION_REQUIRED');return { ...body, revision: String(revision) }; }
  instrument(row, r) { const symbol = first(row.symbol, row.instrument?.instrumentId, typeof row.instrument === 'string' ? row.instrument : undefined, row.pair); check(typeof symbol === 'string' && /^[A-Z]{6}$/.test(symbol), 'Ledger row needs FX symbol', 'SOURCE_DATA_INVALID'); check(this.allowedSymbol(symbol, r), 'Ledger instrument belongs to an unrevealed chapter', 'FUTURE_DATA_FORBIDDEN'); return identity(r.state, symbol); }
  time(row, r, key = 'time') { const t = eventTime(row[key]); check(t.unixMs <= r.endTime, 'Ledger contains unrevealed event', 'FUTURE_DATA_FORBIDDEN'); return t; }
  position(row, r, currency) {
    const instrument = this.instrument(row, r), unit = instrument.instrumentId.slice(0, 3);
    const opened = first(row.openedAt, row.time, row.openTime);
    return this.revision({ id: this.rowId('position', row, r), account: accountRef(r.state), instrument, nativeId: value(String(row.id)), side: side(row.side, true), quantity: quantity(first(row.quantity, row.units), unit), availableQuantity: qv(row.availableQuantity, unit), averagePrice: dv(first(row.averagePrice, row.entryPrice, row.price)), markPrice: dv(row.markPrice), unrealizedPnl: money(row.unrealizedPnl, currency), realizedPnl: money(row.realizedPnl, currency), openedAt: present(opened) ? value(this.time({ time: opened }, r)) : unknown(), strategyRunId: unknown('Not a native strategy run') },r);
  }
  order(row, r) {
    const instrument = this.instrument(row, r), unit = instrument.instrumentId.slice(0, 3), createdAt = this.time({ time: first(row.createdAt, row.time) }, r), updatedAt = this.time({ time: first(row.updatedAt, row.createdAt, row.time) }, r);
    check(['pending', 'working', 'partially_filled', 'filled', 'cancel_pending', 'cancelled', 'rejected', 'expired', 'unknown'].includes(row.status), 'Unsupported order status', 'SOURCE_DATA_INVALID');
    const orderType = row.orderType ?? 'market'; check(['market', 'limit', 'stop', 'stop_limit', 'other'].includes(orderType), 'Invalid order type', 'SOURCE_DATA_INVALID');
    return this.revision({ id: this.rowId('order', row, r), account: accountRef(r.state), instrument, nativeId: value(String(row.nativeClientOrderId??row.id)), clientId: present(row.clientId) ? value(String(row.clientId)) : unknown(), side: side(row.side), positionEffect: present(row.positionEffect) ? value(row.positionEffect) : unknown(), orderType, quantity: quantity(first(row.quantity, row.units), unit), filledQuantity: quantity(row.filledQuantity, unit), remainingQuantity: qv(row.remainingQuantity, unit), limitPrice: ['limit', 'stop_limit'].includes(orderType) ? dv(row.limitPrice) : na(), stopPrice: ['stop', 'stop_limit'].includes(orderType) ? dv(row.stopPrice) : na(), timeInForce: present(row.timeInForce) ? value(row.timeInForce) : unknown(), status: row.status, nativeStatus: row.nativeStatus??row.sourceClassification??row.status, createdAt, updatedAt, expiresAt: present(row.expiresAt) ? value(this.time({ time: row.expiresAt }, r)) : na(), rejectReason: present(row.rejectReason) ? value(row.rejectReason) : unknown(), correlation: unknown('No native execution trace') },r);
  }
  fill(row, r, currency) {
    const instrument = this.instrument(row, r), orderId = present(row.orderId) ? value(this.rowId('order', { id: row.orderId }, r)) : unknown();
    return this.revision({ id: this.rowId('fill', row, r), account: accountRef(r.state), instrument, nativeId: String(row.nativeTradeId??row.id), orderId, nativeOrderId: present(row.nativeClientOrderId??row.orderId) ? value(String(row.nativeClientOrderId??row.orderId)) : unknown(), time: this.time(row, r), side: side(row.side), quantity: quantity(first(row.quantity, row.units), instrument.instrumentId.slice(0, 3)), price: decimal(row.price), positionEffect: present(row.positionEffect) ? value(row.positionEffect) : unknown(), fees: Array.isArray(row.fees) ? value(row.fees.map(f => { check(present(f.currency ?? currency), 'Fee currency missing', 'SOURCE_DATA_INVALID'); return { value: decimal(f.value ?? f.amount), currency: f.currency ?? currency }; })) : unknown(), realizedPnl: money(row.realizedPnl, row.currency ?? currency), correlation: unknown('Simulation ledger, not broker execution'), correction: na() },r);
  }
  ledger(row, r, currency) {
    check(['deposit', 'withdrawal', 'fee', 'dividend', 'funding', 'adjustment', 'other'].includes(row.kind), 'History kind must map to a real ledger entry (trade PnL may use adjustment)', 'SOURCE_DATA_INVALID');
    check(present(row.amount?.currency ?? row.currency ?? currency), 'History amount currency missing', 'SOURCE_DATA_INVALID');
    return this.revision({ id: this.rowId('history', row, r), account: accountRef(r.state), time: this.time(row, r), kind: row.kind, amount: { value: decimal(row.amount?.value ?? row.amount), currency: row.amount?.currency ?? row.currency ?? currency }, description: String(row.description ?? row.kind), nativeId: String(row.id), relatedFillIds: (row.relatedFillIds ?? []).map(id => this.rowId('fill', { id }, r)) },r);
  }
  engineRows(topic, raw, r) {
    // Exact adapter for the portable engine.js ledger. Do not change its state.
    // All quantities below are base-currency units, never lots or target notionals.
    if (topic === 'positions') return raw.map(p => {
      const q = BigInt(p.quantity); check(q !== 0n, 'Zero position must be null', 'SOURCE_DATA_INVALID');
      let running = 0n, opening;
      for (const f of r.state.fills) if (f.chapter === r.ci) {
        const next = running + BigInt(f.signedQuantity);
        if (next !== 0n && (running === 0n || (next > 0n) !== (running > 0n))) opening = f;
        running = next;
      }
      check(opening, 'Position has no opening fill', 'SOURCE_DATA_INVALID');
      const o = this.observed(r);
      return { ...p, id: opening.id, side: q > 0n ? 'long' : 'short', quantity: absDecimal(p.quantity), averagePrice: p.entry, markPrice: r.state.lastQuote ? (q>0n?r.state.lastQuote.bid:r.state.lastQuote.ask) : r.consumedView ? r.consumedView.bars.filter(b=>b.symbol===p.instrument).at(-1)?.[q>0n?'bid':'ask']?.close : (q > 0n ? r.frame.bid : r.frame.ask).close, openedAt: opening.time, unrealizedPnl: o.unrealizedJpy };
    });
    if (topic === 'fills') return raw.map(f => {
      const q = BigInt(f.signedQuantity);
      return { ...f, ...(present(f.nativeClientOrderId)?{orderId:nativeOrderKey(f),decisionId:f.orderId,parentDecisionId:f.parentDecisionId??f.orderId}:{}), side: q > 0n ? 'buy' : 'sell', quantity: absDecimal(f.signedQuantity), realizedPnl: f.realizedJpy, currency: 'JPY', fees: present(f.commission) ? [{ value: negDecimal(f.commission), currency: 'JPY' }] : undefined, positionEffect: BigInt(f.closedQuantity) > 0n && BigInt(f.openedQuantity) > 0n ? 'reversal' : BigInt(f.closedQuantity) > 0n ? 'close' : 'open' };
    });
    if (topic === 'orders') {
      if(r.state.rules?.engine==='nautilus-trader'||r.state.fills.some(f=>present(f.nativeClientOrderId)))return projectNativeOrders(r.state,{asOfMs:r.endTime});
      const result = [];
      for (const row of raw) {
        // 'held' is a decision without an order. Preserve rejection as rejection.
        if (row.status === 'held') continue;
        let before = 0n;
        for (const f of r.state.fills) if (f.chapter === row.chapter && (f.index < row.index || (f.index === row.index && f.mode === 'open' && f.orderId !== row.id))) before += BigInt(f.signedQuantity);
        const delta = BigInt(row.target) - before;
        const executed = r.state.fills.filter(f => f.orderId === row.id);
        const filled = executed.reduce((n, f) => n + (BigInt(f.signedQuantity) < 0n ? -BigInt(f.signedQuantity) : BigInt(f.signedQuantity)), 0n);
        if (delta === 0n && filled === 0n) continue;
        const requested = delta < 0n ? -delta : delta;
        check(filled <= requested, 'Order fills exceed requested quantity', 'SOURCE_DATA_INVALID');
        result.push({ ...row, instrument: symbolOf(r.data.chapters[row.chapter]), side: delta > 0n ? 'buy' : 'sell', quantity: requested.toString(), filledQuantity: filled.toString(), remainingQuantity: (requested - filled).toString(), status: row.status === 'risk_blocked' ? 'rejected' : row.status, rejectReason: row.rejection ?? row.riskAtOpen });
      }
      // Forced risk/chapter settlement executions are fill-backed engine orders,
      // not user decisions. Preserve their actual engine orderId and quantity.
      const represented = new Set(raw.map(row => row.id));
      const groups = new Map();
      for (const f of r.state.fills) if (!represented.has(f.orderId)) {
        check(present(f.orderId), 'Engine fill orderId missing', 'SOURCE_DATA_INVALID');
        const group = groups.get(f.orderId) ?? []; group.push(f); groups.set(f.orderId, group);
      }
      for (const [id, fills] of groups) {
        const direction = BigInt(fills[0].signedQuantity) > 0n;
        check(fills.every(f => (BigInt(f.signedQuantity) > 0n) === direction), 'Conflicting fill-backed order directions', 'SOURCE_DATA_INVALID');
        const total = fills.reduce((n, f) => n + (BigInt(f.signedQuantity) < 0n ? -BigInt(f.signedQuantity) : BigInt(f.signedQuantity)), 0n).toString();
        result.push({ id, instrument: fills[0].instrument, time: fills[0].time, updatedAt: fills.at(-1).time, side: direction ? 'buy' : 'sell', quantity: total, filledQuantity: total, remainingQuantity: '0', status: 'filled', positionEffect: 'close' });
      }
      return result;
    }
    const result = [];
    // state.history holds narrative events (many have no timestamps/amounts).
    // Only actual balance-affecting ledger rows are monetary account history.
    for (const row of r.state.ledger) {
      const parts = row.type === 'fill' ? [['realizedJpy', 'adjustment', 'realized PnL'], ['commission', 'fee', 'simulated commission']] : row.type === 'financing' ? [['financing', 'funding', 'simulated financing']] : [];
      check(parts.length, 'Unknown engine monetary ledger row', 'SOURCE_DATA_INVALID');
      for (const [field, kind, description] of parts) {
        check(present(row[field]), 'Engine ledger amount missing', 'SOURCE_DATA_INVALID');
        // An explicitly recorded zero is kept; missing fields are not zero.
        result.push({ id: `${row.id}:${field}`, time: row.time, kind, amount: field === 'realizedJpy' ? row[field] : negDecimal(row[field]), currency: 'JPY', description: `SIMULATED ${description}`, relatedFillIds: row.type === 'fill' ? [row.id] : [] });
      }
    }
    return result;
  }
  rows(topic, r) {
    const currency = this.currency(r, this.observed(r));
    let raw;
    if (topic === 'positions') { check(r.state.position !== undefined, 'Position state is unknown', 'SOURCE_UNAVAILABLE'); raw = r.state.position === null ? [] : Array.isArray(r.state.position) ? r.state.position : [r.state.position]; }
    else { raw = r.state[topic]; check(Array.isArray(raw), `${topic} ledger is unavailable`, 'SOURCE_UNAVAILABLE'); }
    if (Array.isArray(r.state.ledger) && present(r.state.rules?.commissionJpyPer1000PerSide)) raw = this.engineRows(topic, raw, r);
    const map = { positions: x => this.position(x, r, currency), orders: x => this.order(x, r), fills: x => this.fill(x, r, currency), history: x => this.ledger(x, r, currency) }[topic];
    const items = raw.map(map); check(new Set(items.map(x => x.id)).size === items.length, 'Duplicate ledger identity', 'SOURCE_DATA_INVALID'); return items;
  }
  async query(topic, method, input, context, requiredRange = false) {
    const fields = { positions: ['account', 'instruments', 'page', 'range'], orders: ['account', 'scope', 'range', 'instruments', 'page'], fills: ['account', 'range', 'instruments', 'orderIds', 'page'], history: ['account', 'range', 'kinds', 'page'] }[topic];
    this.validateInput(input, fields);
    check(input.account, 'Account reference is required');
    const r = this.bound(context, input.account), range = this.range(input.range, r, requiredRange);
    if (input.instruments) for (const ref of input.instruments) { check(ref.sourceId === `kurumi:${r.state.id}`, 'Wrong filter source', 'INSTRUMENT_MISMATCH'); check(this.allowedSymbol(ref.instrumentId, r), 'Instrument filter requests unrevealed chapter', 'FUTURE_DATA_FORBIDDEN'); }
    const result = this.page(method, input, context, () => {
      let items = this.rows(topic, r);
      if (topic === 'orders') { check(['working', 'history', 'all'].includes(input.scope), 'Order scope is required'); const working = x => ['pending', 'working', 'partially_filled', 'cancel_pending'].includes(x.status); items = items.filter(x => input.scope === 'all' || (input.scope === 'working' ? working(x) : !working(x))); }
      const time = x => x.time ?? x.createdAt ?? (x.openedAt?.status === 'value' ? x.openedAt.value : undefined);
      if (range) items = items.filter(x => { const t = time(x); check(t, 'No timestamp for bounded query', 'SOURCE_DATA_INVALID'); // Account events stamped exactly at the disclosed closed-bar boundary
        // are known facts, including final settlement. At this frontier only,
        // include the endpoint: no future `to` is needed to read final fills.
        return t.unixMs >= range.from && (t.unixMs < range.to || (t.unixMs === range.to && range.to === r.endTime)); });
      if (input.instruments?.length) items = items.filter(x => input.instruments.some(i => canonical(i) === canonical(x.instrument)));
      if (input.orderIds?.length) items = items.filter(x => x.orderId?.status === 'value' && input.orderIds.includes(x.orderId.value));
      if (input.kinds?.length) items = items.filter(x => input.kinds.includes(x.kind));
      items.sort((a, b) => (time(a)?.unixMs ?? 0) - (time(b)?.unixMs ?? 0) || a.id.localeCompare(b.id));
      return { items, ...(range ? { coverage: this.coverage(input.range, items, time, time) } : {}), meta: this.meta(r) };
    });
    const { meta, page, ...extra } = result;
    return { data: topic === 'positions' ? page : { page, ...extra }, meta };
  }
  queryPositions(input, context) { return this.query('positions', 'queryPositions', input, context); }
  queryOrders(input, context) { check(input.scope === 'working' || input.range, 'Historical orders require a UTC range'); return this.query('orders', 'queryOrders', input, context, input.scope !== 'working'); }
  queryFills(input, context) { return this.query('fills', 'queryFills', input, context, true); }
  queryHistory(input, context) { return this.query('history', 'queryHistory', input, context, true); }
  async subscribeAccount(input, context) {
    this.validateInput(input, ['account', 'topics', 'resumeToken', 'range']);
    check(!input.resumeToken, 'Replay account subscription requires a fresh snapshot', 'RESUME_EXPIRED');
    check(Array.isArray(input.topics) && input.topics.length > 0 && new Set(input.topics).size === input.topics.length && input.topics.every(x => accountDescriptor.liveTopics.includes(x)), 'Unsupported account topics', 'UNSUPPORTED_CAPABILITY');
    check(input.account, 'Account reference is required');
    const fixed = copy(input), read = () => { const r = this.bound(context, fixed.account); if (fixed.range) this.range(fixed.range, r); const result = { account: copy(fixed.account), coverage: fixed.topics.map(topic => ({ topic, complete: topic==='orders'&&r.state.rules?.engine==='nautilus-trader'?nativeOrderCoverageAt(r.state,r.endTime):true })) }; for (const topic of fixed.topics) result[topic] = topic === 'snapshot' ? this.accountSnapshot(r) : this.rows(topic, r); return result; };
    return this.stream(read(), read, (old, next) => {
      const events = [];
      for (const topic of fixed.topics) {
        if (topic === 'snapshot') { if (old.snapshot.snapshotId !== next.snapshot.snapshotId) events.push({ type: 'account.snapshot', payload: next.snapshot }); }
        else {
          // Do not invent an undeclared remove-event dialect. The public MT5
          // contract requires a fresh snapshot on current-row disappearance.
          if (old[topic].some(row => !next[topic].some(x => x.id === row.id))) fail('SNAPSHOT_REQUIRED', 'A simulation position/order disappeared; refresh the authoritative account snapshot');
          const prior = new Map(old[topic].map(x => [x.id, x.revision])); const changed = next[topic].filter(x => prior.get(x.id) !== x.revision);
          if (changed.length) events.push({ type: `${topic}.upsert`, payload: { items: changed } });
        }
      }
      return events;
    }, context);
  }
}

export function registerProviders(host, service) {
  const market = new ReplayMarketProvider(host, service), account = new ReplayAccountProvider(host, service), disposers = [];
  try { disposers.push(host.providers.register(marketDescriptor, market)); disposers.push(host.providers.register(accountDescriptor, account)); }
  catch (error) { for (const dispose of disposers.reverse()) dispose(); market.dispose(); account.dispose(); throw error; }
  let disposed = false;
  return () => { if (disposed) return; disposed = true; market.dispose(); account.dispose(); for (const dispose of disposers.reverse()) dispose(); };
}
