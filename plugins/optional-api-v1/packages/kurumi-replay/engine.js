// Portable deterministic replay engine. No host, I/O, clock, model or binary-float money.
const HOUR = 3600000;
const DAY = 86400000;
const INITIAL = '300000';
const GOAL = '20000000';
const clone = value => JSON.parse(JSON.stringify(value));
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
const pow10 = n => 10n ** BigInt(n);
// Arbitrary-scale decimal arithmetic. Division is only needed for finite /25 and
// a display-only weighted entry; the FIFO lots retain exact prices for accounting.
function dec(v) {
  if (typeof v !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v))
    fail('INVALID_DECIMAL', 'Expected a plain decimal string');
  const negative = v.startsWith('-'); const [whole, fraction = ''] = (negative ? v.slice(1) : v).split('.');
  return norm({ n: BigInt(whole + fraction) * (negative ? -1n : 1n), s: fraction.length });
}
function norm(d) { while (d.s && d.n % 10n === 0n) { d.n /= 10n; d.s--; } return d; }
function text(d) {
  d = norm({ ...d }); const negative = d.n < 0n; let digits = (negative ? -d.n : d.n).toString();
  if (d.s) { digits = digits.padStart(d.s + 1, '0'); digits = digits.slice(0, -d.s) + '.' + digits.slice(-d.s); }
  return (negative ? '-' : '') + digits;
}
function add(a, b) { const s = Math.max(a.s, b.s); return norm({ n: a.n * pow10(s-a.s) + b.n * pow10(s-b.s), s }); }
function neg(a) { return { n: -a.n, s: a.s }; }
function sub(a, b) { return add(a, neg(b)); }
function mul(a, b) { return norm({ n: a.n*b.n, s: a.s+b.s }); }
function cmp(a,b) { const d = sub(a,b); return d.n < 0n ? -1 : d.n > 0n ? 1 : 0; }
const D = dec;
const absQ = q => q < 0n ? -q : q;
const qty = q => D(q.toString());
const divide25 = d => mul(d, D('0.04'));
function average(total, q) {
  // Round display entry HALF_UP to 18 decimal places; never use it for P&L.
  const sign = total.n < 0n ? -1n : 1n;
  const numerator = absQ(total.n) * pow10(18); const denominator = q * pow10(total.s);
  return text(norm({ n: sign * ((numerator + denominator/2n) / denominator), s: 18 }));
}
function quantity(v) {
  if (typeof v !== 'string' || !/^(?:0|-?[1-9]\d*)$/.test(v) || v.length > 9)
    fail('INVALID_TARGET', 'target must be a canonical signed integer string');
  const q = BigInt(v);
  if (absQ(q) > 10000000n || q % 1000n !== 0n) fail('INVALID_TARGET', 'target must be a multiple of 1000 with absolute value <= 10000000');
  return q;
}
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function positive(v) { if (cmp(D(v),D('0')) <= 0) fail('INVALID_DATA', 'Prices must be positive decimals'); }
function chapterOf(s) { return s.chapters[s.chapter]; }
function quoteCurrency(chapter) { return chapter.symbol.slice(-3); }
function tick(chapter) { return D(chapter.tickSize ?? (quoteCurrency(chapter) === 'JPY' ? '0.001' : '0.00001')); }
function validateWeekendGaps(chapter, code='INVALID_CHAPTERS') {
  if (chapter.weekendGaps === undefined) return;
  if (!Array.isArray(chapter.weekendGaps)) fail(code,'weekendGaps must be a fixed array of exact {from,to} UTC endpoints');
  const seen=new Set();
  for (const gap of chapter.weekendGaps) {
    if (!gap || Object.keys(gap).some(k=>!Object.keys({from:0,to:0}).includes(k)) || !Number.isSafeInteger(gap.from) || !Number.isSafeInteger(gap.to) || gap.from<0 || gap.from%HOUR || gap.to%HOUR ||
        gap.to-gap.from<48*HOUR || gap.to-gap.from>50*HOUR || new Date(gap.from).getUTCDay()!==5 || new Date(gap.to).getUTCDay()!==0)
      fail(code,'Each weekendGaps entry must be exact UTC Friday-to-Sunday H1 endpoints, 48..50 hours apart');
    const key=gap.from+':'+gap.to;if(seen.has(key))fail(code,'Duplicate weekend gap');seen.add(key);
  }
}
function validateState(s) {
  if (!s || typeof s.id !== 'string' || !Number.isSafeInteger(s.version) || s.version < 1 || !Number.isInteger(s.chapter) || s.chapter < 0 || s.chapter > 2)
    fail('INVALID_STATE', 'Invalid run identity/version/chapter');
  if (!Array.isArray(s.chapters) || s.chapters.length !== 3 || !Number.isSafeInteger(s.index) || s.index < chapterOf(s).startIndex || s.index > chapterOf(s).endIndex)
    fail('INVALID_STATE', 'Invalid chapter/index');
  for (const chapter of s.chapters) validateWeekendGaps(chapter,'INVALID_STATE');
  D(s.balance);
  for (const k of ['fills','orders','history','decisions','equity','ledger']) if (!Array.isArray(s[k])) fail('INVALID_STATE', `Missing ${k} array`);
  let accounted = D(INITIAL);
  for (const row of s.ledger) {
    if (!row || !['fill','financing'].includes(row.type)) fail('INVALID_STATE','Invalid ledger row');
    if (cmp(D(row.commission),D('0')) < 0 || cmp(D(row.financing),D('0')) < 0) fail('INVALID_STATE','Negative costs are forbidden');
    accounted = sub(sub(add(accounted,D(row.realizedJpy)),D(row.commission)),D(row.financing));
    if (cmp(accounted,D(row.balanceAfter)) !== 0) fail('INVALID_STATE','Ledger running balance mismatch');
  }
  if (cmp(accounted,D(s.balance)) !== 0) fail('INVALID_STATE','Balance must reconcile to initial capital plus engine ledger; recharge is forbidden');
  if (s.position) {
    const q = quantity(s.position.quantity);
    if (!q || s.position.instrument !== chapterOf(s).symbol || !Array.isArray(s.position.lots) || !s.position.lots.length) fail('INVALID_STATE', 'Invalid position');
    let total = 0n;
    for (const lot of s.position.lots) { const lq = quantity(lot.quantity); positive(lot.entry); if (!lq || (lq > 0n) !== (q > 0n)) fail('INVALID_STATE','Invalid FIFO lot'); total += lq; }
    if (total !== q) fail('INVALID_STATE','FIFO quantity mismatch');
    positive(s.position.entry); if (s.position.stop !== null) positive(s.position.stop);
  }
}
function ohlc(book) {
  if (!book || typeof book !== 'object') fail('INVALID_DATA','Missing bid/ask OHLC');
  for (const k of ['open','high','low','close']) positive(book[k]);
  if (cmp(D(book.low),D(book.high)) > 0 || ['open','close'].some(k => cmp(D(book[k]),D(book.low)) < 0 || cmp(D(book[k]),D(book.high)) > 0))
    fail('INVALID_DATA','Inconsistent OHLC bounds');
}
function bookPair(frame) {
  ohlc(frame.bid); ohlc(frame.ask);
  for (const k of ['open','high','low','close']) if (cmp(D(frame.bid[k]),D(frame.ask[k])) > 0) fail('INVALID_DATA','Crossed bid/ask');
}
function validateFrame(frame, chapter, requireFx = true) {
  if (!frame || !Number.isSafeInteger(frame.time) || frame.time < 0 || frame.time % HOUR !== 0)
    fail('INVALID_DATA','Missing/alignment error: frame.time must be UTC H1 open milliseconds');
  bookPair(frame);
  if (quoteCurrency(chapter) === 'CHF' && requireFx) {
    if (!frame.fx) fail('INVALID_DATA','CHF settlement requires synchronous CHFJPY bid/ask');
    if (frame.fx.time !== undefined && frame.fx.time !== frame.time) fail('INVALID_DATA','CHFJPY timestamp mismatch');
    bookPair(frame.fx);
  }
}
function validateNext(previous, next, chapter) {
  validateFrame(previous, chapter); validateFrame(next, chapter);
  const dt = next.time - previous.time;
  if (dt === HOUR) return;
  if (Array.isArray(chapter.weekendGaps) && chapter.weekendGaps.some(g=>g.from===previous.time&&g.to===next.time) &&
      new Date(previous.time).getUTCDay()===5 && new Date(next.time).getUTCDay()===0 && dt>=48*HOUR && dt<=50*HOUR) return;
  fail('INVALID_DATA','Unexpected H1 time gap; requires an exact fixed weekendGaps entry, UTC Friday to Sunday, 48..50 hours');
}
function mark(frame, long, mode) { return D(long ? frame.bid[mode === 'extreme' ? 'low' : mode] : frame.ask[mode === 'extreme' ? 'high' : mode]); }
function fxConvert(pnl, frame, chapter, mode) {
  if (quoteCurrency(chapter) === 'JPY') return pnl;
  const positivePnl = pnl.n >= 0n;
  const side = positivePnl ? frame.fx.bid : frame.fx.ask;
  return mul(pnl, D(side[mode === 'extreme' ? (positivePnl ? 'low' : 'high') : mode]));
}
function pnlAt(position, price, frame, chapter, mode) {
  // Convert each realized FIFO lot separately: profit uses bid, loss uses ask.
  let total = D('0');
  for (const lot of position.lots) total = add(total, fxConvert(mul(sub(price,D(lot.entry)),qty(BigInt(lot.quantity))),frame,chapter,mode));
  return total;
}
function marginFor(q, frame, chapter, mode) {
  let notional = mul(qty(absQ(q)),D(frame.ask[mode === 'extreme' ? (q > 0n ? 'low' : 'high') : mode]));
  if (quoteCurrency(chapter) === 'CHF') notional = mul(notional,D(frame.fx.ask[mode === 'extreme' ? 'high' : mode]));
  return divide25(notional);
}
function metrics(s, frame, mode) {
  const chapter = chapterOf(s); const q = s.position ? BigInt(s.position.quantity) : 0n;
  const unrealized = s.position ? pnlAt(s.position,mark(frame,q > 0n,mode),frame,chapter,mode) : D('0');
  const equity = add(D(s.balance),unrealized); const margin = q===0n ? D('0') : marginFor(q,frame,chapter,mode);
  return { balance:s.balance, unrealizedJpy:text(unrealized), equity:text(equity), margin:text(margin), freeMargin:text(sub(equity,margin)) };
}

export function createReferenceRun(runId, chapters, dataDigests) {
  if (typeof runId !== 'string' || !runId.trim()) fail('INVALID_RUN','runId is required');
  if (!Array.isArray(chapters) || chapters.length !== 3) fail('INVALID_CHAPTERS','Exactly three chapter metadata objects are required');
  for (const c of chapters) {
    if (!c || !/^[A-Z]{3}(JPY|CHF)$/.test(c.symbol) || !Number.isSafeInteger(c.startIndex) || !Number.isSafeInteger(c.endIndex) || c.startIndex < 0 || c.endIndex <= c.startIndex)
      fail('INVALID_CHAPTERS','symbol and inclusive full-array startIndex/endIndex are required');
    if (c.allowWeekendGap !== undefined && typeof c.allowWeekendGap !== 'boolean') fail('INVALID_CHAPTERS','allowWeekendGap must be boolean');
    if (c.tickSize !== undefined) positive(c.tickSize);
    validateWeekendGaps(c);
  }
  if (!dataDigests || typeof dataDigests !== 'object') fail('INVALID_DIGESTS','dataDigests must be a JSON object or array supplied by the data module');
  return { id:runId, version:1, chapter:0, index:chapters[0].startIndex, status:'paused', balance:INITIAL, position:null,
    chapters:clone(chapters), dataDigests:clone(dataDigests), fills:[], orders:[], history:[], decisions:[], equity:[], ledger:[],
    rules:{ engine:'reference-h1-only', formalExecution:false, leverage:'25', stopout:'0.5', commissionJpyPer1000PerSide:'3', simulatedFinancingJpyPer1000UtcDay:'10', initialBalance:INITIAL, victoryBalance:GOAL, targetFactor:'66.6666667', model:'conservative-H1-extreme-v1' }, outcome:null, missingData:null, revealedFrameTime:null };
}

export function validateReferenceDecision(state, decision) {
  validateState(state);
  if (!decision || typeof decision !== 'object') fail('INVALID_DECISION','Decision object required');
  const required = ['id','runId','stepId','expectedVersion','target','stop','reason','utterance'], optional = ['continuationOf'];
  if (Object.keys(decision).some(k => ![...required,...optional].includes(k)) || required.some(k => !(k in decision))) fail('INVALID_DECISION','Decision must contain exactly the documented fields');
  if ('continuationOf' in decision && decision.continuationOf !== null && typeof decision.continuationOf !== 'string') fail('INVALID_DECISION','continuationOf must be the original role decision id marking this bar as an automatic extension');
  for (const k of ['id','runId','stepId','reason','utterance']) if (typeof decision[k] !== 'string' || !decision[k].trim()) fail('INVALID_DECISION',`${k} is required`);
  quantity(decision.target); if (decision.stop !== null) positive(decision.stop);
  if (!Number.isSafeInteger(decision.expectedVersion) || decision.expectedVersion < 1) fail('INVALID_DECISION','expectedVersion must be a positive integer');
  const existing = state.decisions.find(d => d.decision.id === decision.id);
  if (existing) {
    if (stable(existing.decision) !== stable(decision)) fail('ID_CONFLICT','The decision id is already bound to different content');
    return { valid:true, duplicate:true };
  }
  if (state.status === 'complete') fail('RUN_COMPLETE','The run is complete');
  if (!['paused','ready','missing_data'].includes(state.status)) fail('INVALID_STATE','Run is not decision-ready');
  if (decision.runId !== state.id) fail('RUN_MISMATCH','Decision belongs to a different run');
  if (decision.stepId !== `${state.id}:${state.chapter}:${state.index}`) fail('STEP_MISMATCH','Decision step does not match the revealed index');
  if (decision.expectedVersion !== state.version) fail('VERSION_MISMATCH','Stale or future expectedVersion');
  return { valid:true, duplicate:false };
}

function rebuild(position) {
  if (!position.lots.length) return null;
  let q = 0n; let weighted = D('0');
  for (const lot of position.lots) { const lq = BigInt(lot.quantity); q += lq; weighted = add(weighted,mul(D(lot.entry),qty(absQ(lq)))); }
  return { ...position, quantity:q.toString(), entry:average(weighted,absQ(q)) };
}
function execute(s, delta, frame, mode, reason, orderId) {
  if (delta === 0n) return;
  const chapter = chapterOf(s); const buying = delta > 0n;
  const book = buying ? frame.ask : frame.bid;
  const raw = D(book[mode === 'extreme' ? (buying ? 'high' : 'low') : mode]);
  const price = add(raw,buying ? tick(chapter) : neg(tick(chapter)));
  if (price.n <= 0n) fail('INVALID_DATA','Slipped execution price must be positive');
  const commission = mul(qty(absQ(delta)),D('0.003'));
  let realized = D('0'); let closeQ = 0n; let remaining = absQ(delta); const closedLots = [];
  const oldQ = s.position ? BigInt(s.position.quantity) : 0n;
  if (oldQ && (oldQ > 0n) !== buying) {
    for (const lot of s.position.lots) {
      const lq = BigInt(lot.quantity); const take = remaining < absQ(lq) ? remaining : absQ(lq);
      if (!take) break;
      const signed = lq > 0n ? take : -take;
      const quotePnl = mul(sub(price,D(lot.entry)),qty(signed));
      const jpyPnl = fxConvert(quotePnl,frame,chapter,mode);
      const conversionRate = quoteCurrency(chapter) === 'JPY' ? '1' : (quotePnl.n >= 0n ? frame.fx.bid : frame.fx.ask)[mode === 'extreme' ? (quotePnl.n >= 0n ? 'low' : 'high') : mode];
      closedLots.push({ quantity:signed.toString(), entry:lot.entry, exit:text(price), realizedQuote:text(quotePnl), conversionRate, realizedJpy:text(jpyPnl) });
      realized = add(realized,jpyPnl);
      closeQ += take; remaining -= take; lot.quantity = (lq-signed).toString();
    }
    s.position.lots = s.position.lots.filter(l => l.quantity !== '0'); s.position = rebuild(s.position);
  }
  if (remaining) {
    if (!s.position) s.position = { quantity:'0', entry:text(price), stop:null, instrument:chapter.symbol, lots:[] };
    s.position.lots.push({ quantity:(buying ? remaining : -remaining).toString(), entry:text(price) }); s.position = rebuild(s.position);
  }
  s.balance = text(sub(add(D(s.balance),realized),commission));
  const time = frame.time + (mode === 'open' ? 0 : HOUR);
  const fill = { id:`${s.id}:fill:${s.fills.length+1}`, orderId, chapter:s.chapter, index:s.index, instrument:chapter.symbol, time,
    signedQuantity:delta.toString(), closedQuantity:closeQ.toString(), openedQuantity:remaining.toString(), rawPrice:text(raw), price:text(price), slippage:text(tick(chapter)),
    quoteCurrency:quoteCurrency(chapter), closedLots, realizedJpy:text(realized), commission:text(commission), financing:'0', reason, mode, atIntervalEnd:mode !== 'open', balanceAfter:s.balance };
  s.fills.push(fill); s.ledger.push({ ...fill, type:'fill' });
}
function financing(s, from, to, frame, phase) {
  if (!s.position) return;
  const days = Math.floor(to/DAY)-Math.floor(from/DAY);
  if (!days) return;
  const amount = mul(mul(qty(absQ(BigInt(s.position.quantity))),D('0.01')),D(String(days)));
  s.balance = text(sub(D(s.balance),amount));
  s.ledger.push({ type:'financing', id:`${s.id}:ledger:${s.ledger.length+1}`, chapter:s.chapter, index:s.index, time:to, from, to, days, quantity:s.position.quantity,
    realizedJpy:'0', commission:'0', financing:text(amount), balanceAfter:s.balance, phase, simulated:true });
}
function risk(s, frame, mode) {
  if (!s.position) return null;
  const q = BigInt(s.position.quantity); const m = metrics(s,frame,mode); const price = mark(frame,q > 0n,mode);
  let reason = null;
  if (cmp(D(m.equity),mul(D(m.margin),D('0.5'))) <= 0) reason = 'stopout';
  else if (s.position.stop !== null && (q > 0n ? cmp(price,D(s.position.stop)) <= 0 : cmp(price,D(s.position.stop)) >= 0)) reason = 'stop';
  if (reason) {
    s.history.push({ type:'risk', chapter:s.chapter, index:s.index, time:frame.time+(mode==='open'?0:HOUR), mode, reason, metrics:m, stop:s.position.stop });
    execute(s,-q,frame,mode,reason,`${s.id}:risk:${s.version}:${s.index}:${mode}`);
  }
  return reason;
}

export function decideReferenceAndAdvance(state, decision, frames) {
  if(state.rules?.engine!=='reference-h1-only') fail('ENGINE_MISMATCH','H1 reference cannot execute or relabel a native checkpoint');
  const validation = validateReferenceDecision(state,decision);
  if (validation.duplicate) return clone(state);
  const chapter = chapterOf(state); const previous = frames?.[state.index]; const next = frames?.[state.index+1];
  // Validate all data needed for this step before ANY mutation, fee, fill or advance.
  try {
    if (!Array.isArray(frames) || state.index+1 > chapter.endIndex) fail('INVALID_DATA','Missing next in-chapter frame');
    validateNext(previous,next,chapter);
    if (state.revealedFrameTime !== null && state.revealedFrameTime !== previous.time) fail('INVALID_DATA','Previously revealed frame timestamp changed');
    if (cmp(D(next.bid.low),tick(chapter)) <= 0) fail('INVALID_DATA','Bid low must exceed execution tick');
  } catch (e) {
    if (!['INVALID_DATA','INVALID_DECIMAL'].includes(e.code)) throw e;
    const missing = clone(state); missing.status = 'missing_data'; missing.missingData = { code:e.code, message:e.message, chapter:state.chapter, index:state.index, nextIndex:state.index+1 };
    return missing;
  }
  const s = clone(state); s.status = 'ready'; s.missingData = null; s.index++;
  // Charge only held-position weekend/gap midnights not previously consumed.
  financing(s,previous.time+HOUR,next.time,next,'gap');
  const blocked = risk(s,next,'open');
  const target = quantity(decision.target); const current = s.position ? BigInt(s.position.quantity) : 0n;
  let orderStatus = blocked ? 'risk_blocked' : target === current ? 'held' : 'filled';
  let rejection = null;
  if (!blocked) {
    // Reductions/flat settle are always allowed. Close before any reversal increase.
    if (current && (target === 0n || (target > 0n) !== (current > 0n))) execute(s,-current,next,'open','target_close',decision.id);
    else if (absQ(target) < absQ(current)) execute(s,target-current,next,'open','target_reduce',decision.id);
    const remainingQ = s.position ? BigInt(s.position.quantity) : 0n;
    const increase = target-remainingQ;
    if (increase) {
      const proposed = clone(s);
      execute(proposed,increase,next,'open','target_open',decision.id);
      const m = metrics(proposed,next,'open');
      if (cmp(D(m.equity),D(m.margin)) >= 0 && cmp(D(m.equity),D('0')) > 0) Object.assign(s,proposed);
      else { orderStatus = 'rejected'; rejection = 'insufficient_margin'; }
    }
    if (s.position) s.position.stop = decision.stop === null ? null : text(D(decision.stop));
  }
  s.orders.push({ id:decision.id, chapter:s.chapter, index:s.index, time:next.time, target:decision.target, stop:decision.stop, status:orderStatus, rejection,
    resultingQuantityAtOpen:s.position?.quantity ?? '0', riskAtOpen:blocked });
  financing(s,next.time,next.time+HOUR,next,'interval');
  risk(s,next,'extreme');
  const executedChapter = s.chapter;
  if (s.index === chapter.endIndex) {
    if (s.position) execute(s,-BigInt(s.position.quantity),next,'close','chapter_end',`${s.id}:chapter_end:${s.chapter}`);
    s.history.push({ type:'chapter_end', chapter:s.chapter, index:s.index, time:next.time+HOUR, balance:s.balance });
  }
  s.equity.push({ chapter:s.chapter, index:s.index, time:next.time+HOUR, ...metrics(s,next,'close'), quantity:s.position?.quantity ?? '0' });
  s.decisions.push({ decision:clone(decision), executedChapter, executedIndex:s.index, executionTime:next.time, resultingVersion:s.version+1 });
  s.history.push({ type:'step', chapter:s.chapter, index:s.index, decisionId:decision.id, balance:s.balance });
  s.version++; s.status = 'paused'; s.revealedFrameTime = next.time;
  if (s.index === chapter.endIndex) {
    if (s.chapter === 2) { s.status = 'complete'; s.outcome = cmp(D(s.balance),D(GOAL)) >= 0 ? 'victory' : 'not_reached'; }
    else { s.chapter++; s.index = chapterOf(s).startIndex; s.revealedFrameTime = null; s.history.push({ type:'chapter_start', chapter:s.chapter, index:s.index, balance:s.balance }); }
  }
  return s;
}

export function snapshotReference(state, frame, {allowUnpricedFlat=false} = {}) {
  validateState(state); validateFrame(frame,chapterOf(state), !(allowUnpricedFlat===true && state.position===null));
  if (state.revealedFrameTime !== null && state.revealedFrameTime !== frame.time) fail('INVALID_DATA','snapshot requires the current revealed frame, not a past/future frame');
  return { id:state.id, version:state.version, chapter:state.chapter, index:state.index, stepId:`${state.id}:${state.chapter}:${state.index}`, status:state.status,
    symbol:chapterOf(state).symbol, time:frame.time+HOUR, frameTime:frame.time, position:clone(state.position), ...metrics(state,frame,'close'), outcome:state.outcome,
    victoryBalance:GOAL, targetFactor:'66.6666667', ledgerCount:state.ledger.length, missingData:clone(state.missingData) };
}

// Production entry points use immutable legacy or explicitly selected experiment
// profiles, with native quote matching; the reference H1 model is not equivalence evidence.
export {createRun,validateDecision,decideAndAdvance,snapshot} from './native-engine.js';
