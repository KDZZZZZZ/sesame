import test from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceRun as createRun, decideReferenceAndAdvance as decideAndAdvance, snapshotReference as snapshot, validateReferenceDecision as validateDecision } from '../engine.js';
const H = 3600000;
const T = Date.UTC(2024,0,8,10);
const cp = x => JSON.parse(JSON.stringify(x));
function book(open='100', high=open, low=open, close=open) { return {open,high,low,close}; }
function frame(time=T, bid=book(), ask=book('100.02'), fx) { return {time,bid,ask,...(fx ? {fx} : {})}; }
function frames(n=5, base=T) { return Array.from({length:n},(_,i)=>frame(base+i*H)); }
function run(end=4, symbol='USDJPY', extra={}) { return createRun('r',[{symbol,startIndex:0,endIndex:end,...extra},{symbol:'USDJPY',startIndex:0,endIndex:1},{symbol:'USDJPY',startIndex:0,endIndex:1}],{market:'sha256:test-fixture'}); }
function decision(s,target='1000',stop=null,id=`d${s.version}`) { return {id,runId:s.id,stepId:`${s.id}:${s.chapter}:${s.index}`,expectedVersion:s.version,target,stop,reason:'test choice',utterance:'模拟测试决定'}; }
function advance(s,f,target='1000',stop=null) { return decideAndAdvance(s,decision(s,target,stop),f); }
function frozen(o) { if(o && typeof o==='object') { Object.freeze(o); for(const v of Object.values(o)) frozen(v); } return o; }
// Independent exact reconciliation helper, not the engine's arithmetic.
function scaled(v) { const [a,b=''] = v.replace('-','').split('.'); assert.ok(b.length<=18); return BigInt(a+b.padEnd(18,'0'))*(v.startsWith('-')?-1n:1n); }
function reconcile(s) { let balance=scaled('300000'); for(const row of s.ledger) {balance+=scaled(row.realizedJpy)-scaled(row.commission)-scaled(row.financing); assert.equal(balance,scaled(row.balanceAfter));} assert.equal(balance,scaled(s.balance)); }
const code = expected => e => e.code===expected;

test('JSON state, fixed capital/rules, defensive clone, only three chapters',()=>{
  const c=[{symbol:'USDJPY',startIndex:2,endIndex:4},{symbol:'EURCHF',startIndex:10,endIndex:12},{symbol:'EURJPY',startIndex:0,endIndex:1}];
  const d={one:'sha256:a'}; const s=createRun('id',c,d); c[0].startIndex=99; d.one='modified';
  assert.equal(s.index,2); assert.equal(s.balance,'300000'); assert.equal(s.version,1); assert.equal(s.position,null);
  assert.equal(s.rules.targetFactor,'66.6666667'); assert.equal(s.dataDigests.one,'sha256:a'); assert.deepEqual(JSON.parse(JSON.stringify(s)),s);
  assert.throws(()=>createRun('r',[],{}),code('INVALID_CHAPTERS'));
  assert.throws(()=>run(4,'EURUSD'),code('INVALID_CHAPTERS'));
});

test('long JPY actual ask open, bid exit, exactly one tick and one commission per side',()=>{
  const f=frames(); const s=advance(run(),f); assert.equal(s.fills[0].price,'100.021'); assert.equal(s.balance,'299997');
  assert.equal(s.fills[0].time,f[1].time); assert.equal(s.fills[0].index,1);
  const snap=snapshot(s,f[1]); assert.equal(snap.unrealizedJpy,'-21'); assert.equal(snap.equity,'299976'); assert.equal(snap.margin,'4000.8');
  const closed=advance(s,f,'0'); assert.equal(closed.fills[1].price,'99.999'); assert.equal(closed.fills[1].realizedJpy,'-22');
  assert.equal(closed.balance,'299972'); assert.equal(closed.position,null); reconcile(closed);
});

test('short JPY sells bid, covers ask',()=>{
  let s=advance(run(),frames(),'-1000'); assert.equal(s.fills[0].price,'99.999'); assert.equal(s.position.quantity,'-1000');
  s=advance(s,frames(),'0'); assert.equal(s.fills[1].price,'100.021'); assert.equal(s.balance,'299972'); reconcile(s);
});

test('CHF losses converted at synchronous ask, never fixed 150',()=>{
  const f=Array.from({length:5},(_,i)=>frame(T+i*H,book('1'),book('1.0002'),{time:T+i*H,bid:book('160'),ask:book('160.2')}));
  let s=advance(run(4,'EURCHF'),f); assert.equal(s.position.entry,'1.00021');
  assert.equal(snapshot(s,f[1]).unrealizedJpy,'-33.642');
  s=advance(s,f,'0'); assert.equal(s.fills[1].realizedJpy,'-35.244'); assert.equal(s.balance,'299958.756');
  assert.equal(s.fills[1].closedLots[0].conversionRate,'160.2'); reconcile(s);
});

test('CHF long profit at bid; short profit also bid, short loss ask',()=>{
  const f=Array.from({length:5},(_,i)=>frame(T+i*H,book('1'),book('1.0002'),{bid:book('160'),ask:book('160.2')}));
  let s=advance(run(4,'EURCHF'),f);
  f[2]=frame(T+2*H,book('1.01'),book('1.0102'),{bid:book('160'),ask:book('160.2')});
  s=advance(s,f,'0'); assert.equal(s.fills[1].realizedJpy,'1564.8'); assert.equal(s.balance,'301558.8'); reconcile(s);
  f[2]=frame(T+2*H,book('0.99'),book('0.9902'),{bid:book('160'),ask:book('160.2')});
  s=advance(run(4,'EURCHF'),f,'-1000'); s=advance(s,f,'0'); assert.equal(s.fills[1].realizedJpy,'1564.8'); reconcile(s);
  f[2]=frame(T+2*H,book('1.01'),book('1.0102'),{bid:book('160'),ask:book('160.2')});
  s=advance(run(4,'EURCHF'),f,'-1000'); s=advance(s,f,'0'); assert.equal(s.fills[1].realizedJpy,'-1637.244'); reconcile(s);
});

test('H1 stops fill adverse interval extreme + tick, not trigger, long and short',()=>{
  const f=frames(); f[1]=frame(T+H,book('100','102','90','100'),book('100.02','102.02','90.02','100.02'));
  let s=advance(run(),f,'1000','95'); assert.equal(s.fills[0].price,'100.021'); assert.equal(s.fills[1].price,'89.999');
  assert.equal(s.fills[1].reason,'stop'); assert.equal(s.fills[1].mode,'extreme'); assert.equal(s.fills[1].time,f[1].time+H); assert.equal(s.balance,'289972'); reconcile(s);
  f[1]=frame(T+H,book('100','110','98','100'),book('100.02','110.02','98.02','100.02'));
  s=advance(run(),f,'-1000','105'); assert.equal(s.fills[1].price,'110.021'); assert.equal(s.balance,'289972'); reconcile(s);
});

test('CHF conservative interval conversion uses bid.low profit / ask.high loss',()=>{
  const f=Array.from({length:5},(_,i)=>frame(T+i*H,book('1'),book('1.0002'),{bid:book('160'),ask:book('160.2')}));
  f[1]=frame(T+H,book('1','1.02','0.98','1'),book('1.0002','1.0202','0.9802','1.0002'),{bid:book('160','170','150','160'),ask:book('160.2','170.2','150.2','160.2')});
  let s=advance(run(4,'EURCHF'),f,'1000','0.99'); assert.equal(s.fills[1].price,'0.97999'); assert.equal(s.fills[1].realizedJpy,'-3441.444'); assert.equal(s.fills[1].closedLots[0].conversionRate,'170.2'); reconcile(s);
  // Protected profitable exit after a favorable opening gap, but a stop touched later.
  f[1]=frame(T+H,book('1.03'),book('1.0302'),{bid:book('160'),ask:book('160.2')});
  f[2]=frame(T+2*H,book('1.04','1.05','1.035','1.04'),book('1.0402','1.0502','1.0352','1.0402'),{bid:book('160','170','150','160'),ask:book('160.2','170.2','150.2','160.2')});
  s=advance(run(4,'EURCHF'),f); s=advance(s,f,'1000','1.036');
  assert.equal(s.fills[1].reason,'stop'); assert.equal(s.fills[1].closedLots[0].conversionRate,'150'); assert.equal(s.fills[1].realizedJpy,'717'); reconcile(s);
});

test('opening gap honors EXISTING stop before requested stop removal or target adjustment',()=>{
  const f=frames(); let s=advance(run(),f,'1000','95'); f[2]=frame(T+2*H,book('90'),book('90.02'));
  s=advance(s,f,'1000',null); assert.equal(s.fills[1].mode,'open'); assert.equal(s.fills[1].price,'89.999'); assert.equal(s.fills.length,2);
  assert.equal(s.orders[1].status,'risk_blocked'); assert.equal(s.position,null); assert.equal(s.balance,'289972'); reconcile(s);
});

test('25x margin rejects unaffordable increase without fees or phantom fills',()=>{
  let s=advance(run(),frames(),'10000000'); assert.equal(s.balance,'300000'); assert.equal(s.fills.length,0); assert.equal(s.orders[0].rejection,'insufficient_margin'); assert.equal(s.index,1);
  s=advance(s,frames(),'50000'); assert.equal(s.position.quantity,'50000'); assert.equal(snapshot(s,frames()[2]).margin,'200040'); reconcile(s);
});

test('intrabar stopout keeps negative balance, no reset/recharge, cannot open after insolvency',()=>{
  const f=frames(); f[1]=frame(T+H,book('100','100','90','95'),book('100.02','100.02','90.02','95.02'));
  let s=advance(run(),f,'50000'); assert.equal(s.balance,'-201400'); assert.equal(s.position,null); assert.equal(s.fills[1].reason,'stopout');
  s=advance(s,f,'1000'); assert.equal(s.balance,'-201400'); assert.equal(s.orders[1].status,'rejected'); assert.equal(s.fills.length,2); reconcile(s);
});

test('opening gap stopout uses real open and blocks reopening in same interval',()=>{
  const f=frames(); let s=advance(run(),f,'50000'); f[2]=frame(T+2*H,book('90'),book('90.02'));
  s=advance(s,f,'50000'); assert.equal(s.fills[1].reason,'stopout'); assert.equal(s.fills[1].mode,'open'); assert.equal(s.balance,'-201400'); assert.equal(s.position,null); reconcile(s);
});

test('UTC midnight financing is simulated JPY, not spread or historical broker data',()=>{
  const f=frames(5,Date.UTC(2024,0,8,22)); let s=advance(run(),f);
  assert.equal(s.balance,'299987'); assert.equal(s.ledger[1].financing,'10'); assert.equal(s.ledger[1].simulated,true);
  s=advance(s,f); assert.equal(s.balance,'299987'); assert.equal(s.orders[1].status,'held'); assert.equal(s.decisions.length,2); reconcile(s);
});

test('explicit Fri22 -> Sun22 accepted, weekday gaps never swallowed, weekend financing retained',()=>{
  const fri21=Date.UTC(2024,0,12,21); const f=[frame(fri21),frame(fri21+H),frame(fri21+49*H),frame(fri21+50*H),frame(fri21+51*H)];
  let s=advance(run(4,'USDJPY',{weekendGaps:[{from:fri21+H,to:fri21+49*H}]}),f); s=advance(s,f);
  assert.equal(s.index,2); assert.equal(s.balance,'299977'); assert.equal(s.ledger.find(l=>l.phase==='gap').days,2); reconcile(s);
  const denied=advance(advance(run(),f),f); assert.equal(denied.status,'missing_data'); assert.equal(denied.index,1);
  const bad=frames(); bad[1].time+=H; const m=advance(run(4,'USDJPY',{allowWeekendGap:true}),bad); assert.equal(m.status,'missing_data'); assert.equal(m.fills.length,0);
});

test('missing data, CHF timestamp mismatch, crossed quotes, bad OHLC pause atomically and repair retries',()=>{
  const initial=run(); const d=decision(initial); const missing=decideAndAdvance(initial,d,[frame()]);
  assert.equal(missing.status,'missing_data'); assert.equal(missing.version,1); assert.equal(missing.index,0); assert.equal(missing.balance,'300000'); assert.deepEqual(missing.decisions,[]);
  const repaired=decideAndAdvance(missing,d,frames()); assert.equal(repaired.version,2); assert.equal(repaired.status,'paused');
  for(const mutate of [f=>{f[1].time++;}, f=>{f[1].time+=2*H;}, f=>{f[1].bid.low='101';}, f=>{f[1].ask.open='99';}, f=>{f[1].bid.open=100;}, f=>{f[1].bid.open='1e2';}]) {
    const f=frames(); mutate(f); const s=advance(initial,f); assert.equal(s.status,'missing_data'); assert.deepEqual(s.fills,[]); assert.equal(s.version,1);
  }
  const f=Array.from({length:5},(_,i)=>frame(T+i*H,book('1'),book('1.0002'),{time:T+i*H,bid:book('160'),ask:book('160.2')}));
  delete f[1].fx; let s=advance(run(4,'EURCHF'),f); assert.equal(s.status,'missing_data'); assert.equal(s.index,0);
  f[1].fx={time:T+2*H,bid:book('160'),ask:book('160.2')}; s=advance(run(4,'EURCHF'),f); assert.equal(s.status,'missing_data');
  // Existing position must not accrue fees, financing or a partial close when FX is absent.
  f[1].fx.time=T+H; s=advance(run(4,'EURCHF'),f); delete f[2].fx;
  const old=cp(s); s=advance(s,f,'0'); assert.equal(s.balance,old.balance); assert.deepEqual(s.position,old.position); assert.deepEqual(s.fills,old.fills); assert.equal(s.index,old.index);
});

test('strict decisions: canonical 1000-unit target, bounds, step, run, version, stop, unknown fields',()=>{
  const s=run(); const base=decision(s); assert.deepEqual(validateDecision(s,base),{valid:true,duplicate:false});
  for(const target of ['1001','10001000','-10001000','01','-0','1000.0','1e3',1000]) assert.throws(()=>validateDecision(s,{...base,target}),code('INVALID_TARGET'));
  for(const [field,value,error] of [['runId','other','RUN_MISMATCH'],['stepId','r:0:1','STEP_MISMATCH'],['expectedVersion',2,'VERSION_MISMATCH'],['expectedVersion',1.5,'INVALID_DECISION'],['stop','-1','INVALID_DATA'],['reason','','INVALID_DECISION']])
    assert.throws(()=>validateDecision(s,{...base,[field]:value}),code(error));
  assert.throws(()=>validateDecision(s,{...base,balance:'999999999'}),code('INVALID_DECISION'));
  assert.equal(validateDecision(s,{...base,target:'10000000'}).valid,true); assert.equal(validateDecision(s,{...base,target:'-10000000'}).valid,true);
});

test('idempotency validates payload; same ID/content never replays fills or version, including old steps',()=>{
  const s=run(); const d=decision(s); const one=decideAndAdvance(s,d,frames()); const two=decideAndAdvance(one,d,[]); assert.deepEqual(two,one); assert.notEqual(two,one);
  assert.throws(()=>decideAndAdvance(one,{...d,target:'2000'},frames()),code('ID_CONFLICT'));
  const later=advance(one,frames(),'0'); assert.deepEqual(decideAndAdvance(later,d,null),later);
  assert.throws(()=>validateDecision(one,{...decision(one),expectedVersion:1}),code('VERSION_MISMATCH'));
});

test('full-array indices, forced chapter close and capital continuity with no skipped-month returns',()=>{
  const chapters=[{symbol:'USDJPY',startIndex:1,endIndex:2},{symbol:'EURCHF',startIndex:2,endIndex:3},{symbol:'EURJPY',startIndex:0,endIndex:1}];
  let s=createRun('r',chapters,{data:'frozen'}); const f=frames(); s=advance(s,f);
  assert.equal(s.chapter,1); assert.equal(s.index,2); assert.equal(s.position,null); assert.equal(s.balance,'299972');
  assert.equal(s.fills[1].reason,'chapter_end'); assert.equal(s.fills[1].mode,'close'); assert.equal(s.fills[1].time,f[2].time+H);
  const chf=Array.from({length:4},(_,i)=>frame(Date.UTC(2024,5,10,10)+i*H,book('1'),book('1.0002'),{bid:book('160'),ask:book('160.2')}));
  s=advance(s,chf,'0'); assert.equal(s.chapter,2); assert.equal(s.balance,'299972'); assert.equal(s.position,null);
  s=advance(s,frames(2,Date.UTC(2025,0,10,10)),'0'); assert.equal(s.status,'complete'); assert.equal(s.balance,'299972'); assert.equal(s.outcome,'not_reached'); reconcile(s);
  assert.throws(()=>advance(s,frames(),'0'),code('RUN_COMPLETE'));
});

test('victory only at final flat settlement >= 20000000, factor is 66.6666667 not 100',()=>{
  const f=frames(3); f[2]=frame(T+2*H,book('500'),book('500.02'));
  let s=advance(run(2),f,'50000'); s=advance(s,f,'50000'); assert.equal(s.balance,'20298600'); assert.equal(s.outcome,null); assert.equal(s.position,null);
  s=advance(s,frames(2),'0'); assert.equal(s.outcome,null);
  s=advance(s,frames(2),'0'); assert.equal(s.status,'complete'); assert.equal(s.outcome,'victory'); assert.equal(s.position,null); assert.equal(s.rules.targetFactor,'66.6666667'); reconcile(s);
});

test('FIFO partial reduction / add / reversal reconcile exact lots and per-side commission',()=>{
  const f=frames(7); let s=advance(run(6),f,'2000');
  f[2]=frame(T+2*H,book('101'),book('101.02')); s=advance(s,f,'3000'); assert.equal(s.position.lots.length,2);
  assert.equal(s.position.entry,'100.354333333333333333');
  f[3]=frame(T+3*H,book('102'),book('102.02')); s=advance(s,f,'1000'); assert.equal(s.fills.at(-1).realizedJpy,'3956'); assert.equal(s.position.entry,'101.021');
  s=advance(s,f,'-1000'); assert.equal(s.position.quantity,'-1000'); assert.equal(s.fills.at(-2).closedQuantity,'1000'); assert.equal(s.fills.at(-1).openedQuantity,'1000');
  s=advance(s,f,'0'); assert.equal(s.position,null); reconcile(s);
});

test('decimal > Number precision and fractional yen remain exact, not binary floats',()=>{
  const f=frames(); for(const v of f) {v.bid=book('100.000000000000000001');v.ask=book('100.020000000000000001');}
  let s=advance(run(),f); assert.equal(s.fills[0].price,'100.021000000000000001');
  s=advance(s,f,'0'); assert.equal(s.fills[1].price,'99.999000000000000001'); assert.equal(s.balance,'299972'); reconcile(s);
});

test('no input mutation, deterministic output, later unrevealed bars irrelevant to current execution',()=>{
  const state=frozen(run()); const f=frozen(frames()); const d=frozen(decision(state)); const saved=JSON.stringify({state,f,d});
  const result=decideAndAdvance(state,d,f); assert.equal(JSON.stringify({state,f,d}),saved); assert.deepEqual(result,decideAndAdvance(state,d,f));
  const different=cp(f); different[4]=frame(T+100*H,book('900'),book('901'));
  assert.deepEqual(result,decideAndAdvance(state,d,different)); const before=JSON.stringify(result); snapshot(result,f[1]); assert.equal(JSON.stringify(result),before);
});


test('final goal threshold is exact and cannot be decided from interim or unrealized equity',()=>{
  for(const [bid,ask,expectedBalance,outcome] of [['19800.028','19800.048','20000000','victory'],['19800.027999','19800.047999','19999999.999','not_reached']]) {
    const f=frames(3); f[2]=frame(T+2*H,book(bid),book(ask));
    let s=advance(run(2),f); s=advance(s,f); assert.equal(s.balance,expectedBalance); assert.equal(s.outcome,null);
    s=advance(s,frames(2),'0'); s=advance(s,frames(2),'0'); assert.equal(s.outcome,outcome); reconcile(s);
  }
});

test('recharge/tampered balance, negative costs and mismatched revealed time are rejected',()=>{
  const initial=run(); const altered=cp(initial); altered.balance='999999999';
  assert.throws(()=>validateDecision(altered,decision(altered)),code('INVALID_STATE'));
  const s=advance(initial,frames()); const corrupt=cp(s); corrupt.ledger[0].commission='-3';
  assert.throws(()=>validateDecision(corrupt,decision(corrupt)),code('INVALID_STATE'));
  assert.throws(()=>snapshot(s,frames()[2]),code('INVALID_DATA'));
  const f=frames(); f[1].time-=H; const m=advance(s,f); assert.equal(m.status,'missing_data'); assert.equal(m.index,s.index); assert.deepEqual(m.fills,s.fills);
});

test('hold is a decision, stop updates apply at next open after old-stop gap handling',()=>{
  const f=frames(); let s=advance(run(),f,'1000','95'); s=advance(s,f,'1000','98');
  assert.equal(s.version,3); assert.equal(s.decisions.length,2); assert.equal(s.position.stop,'98'); assert.equal(s.fills.length,1); assert.equal(s.orders[1].status,'held'); reconcile(s);
});

test('risk checks long bid / short ask, not midpoint or favorable side',()=>{
  const f=frames(); f[1]=frame(T+H,book('100','100','94.999','100'),book('100.02','100.02','95.019','100.02'));
  let s=advance(run(),f,'1000','95'); assert.equal(s.position,null); assert.equal(s.fills[1].price,'94.998');
  f[1]=frame(T+H,book('100','104.99','100','100'),book('100.02','105.01','100.02','100.02'));
  s=advance(run(),f,'-1000','105'); assert.equal(s.position,null); assert.equal(s.fills[1].price,'105.011'); reconcile(s);
});


test('weekendGaps metadata accepts exact Friday/Sunday 48..50h only, summer/winter endpoints',()=>{
 for(const [from,to] of [[Date.UTC(2024,5,14,20),Date.UTC(2024,5,16,21)],[Date.UTC(2024,0,12,21),Date.UTC(2024,0,14,22)],[Date.UTC(2024,0,12,22),Date.UTC(2024,0,14,22)],[Date.UTC(2024,0,12,20),Date.UTC(2024,0,14,22)]]){
  const chapters=[{symbol:'USDJPY',startIndex:0,endIndex:2,weekendGaps:[{from,to}]},{symbol:'EURCHF',startIndex:0,endIndex:2},{symbol:'EURJPY',startIndex:0,endIndex:2}];
  assert.equal(createRun('g',chapters,{}).chapters[0].weekendGaps[0].to,to);
 }
 const base=[{symbol:'USDJPY',startIndex:0,endIndex:2},{symbol:'EURCHF',startIndex:0,endIndex:2},{symbol:'EURJPY',startIndex:0,endIndex:2}];
 for(const gap of [{from:Date.UTC(2024,0,9,22),to:Date.UTC(2024,0,11,22)},{from:Date.UTC(2024,0,12,19),to:Date.UTC(2024,0,14,22)},{from:Date.UTC(2024,0,12,22)+1,to:Date.UTC(2024,0,14,22)},null,{from:Date.UTC(2024,0,12,22),to:Date.UTC(2024,0,14,22),extra:true}]){
  const chapters=structuredClone(base);chapters[0].weekendGaps=[gap];assert.throws(()=>createRun('g',chapters,{}));
 }
 const chapters=structuredClone(base),g={from:Date.UTC(2024,0,12,22),to:Date.UTC(2024,0,14,22)};chapters[0].weekendGaps=[g,g];assert.throws(()=>createRun('g',chapters,{}));
});
