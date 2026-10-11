// Financial expectations independently use actual quote side, spread, Decimal FX and fees; no fixed one-tick penalty.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createRun,decideAndAdvance,snapshot,validateDecision,prepareNative,nativeStatus,advanceNative,joinAsOfQuotes,disposeNative} from '../native-engine.js';
const H=3600000,T=Date.UTC(2024,0,8,10);
const copy=x=>JSON.parse(JSON.stringify(x));
function state(end=3,extra={}) {return createRun('native',[{symbol:'USDJPY',startIndex:0,endIndex:end,...extra},{symbol:'EURCHF',startIndex:0,endIndex:1},{symbol:'EURJPY',startIndex:0,endIndex:1}],{kind:'synthetic-native-fixture'});}
const frames=(n=5,base=T)=>Array.from({length:n},(_,i)=>({time:base+i*H}));
const decision=(s,target='1000',stop=null)=>({id:`d${s.version}`,runId:s.id,stepId:`${s.id}:${s.chapter}:${s.index}`,expectedVersion:s.version,target,stop,reason:'native fixture',utterance:'真实调用成熟撮合器的合成测试，不是历史行情'});
const tick=(time,bid='100',ask='100.02',fx)=>({time,bid,ask,...(fx?{fx}:{})});
function options(f,s,ticks) {return {quoteTicks:ticks,coverage:{from:f[s.index+1].time,to:f[s.index+1].time+H,complete:true,dataKind:'quote_ticks',liquidityAssumption:'unbounded_top_of_book',provenance:'synthetic-fixture'}};}
async function advance(s,f,ticks,target='1000',stop=null) {return decideAndAdvance(s,decision(s,target,stop),f,options(f,s,ticks));}
function amount(v){const neg=v.startsWith('-');const[a,b='']=(neg?v.slice(1):v).split('.');assert.ok(b.length<=18);return BigInt(a+b.padEnd(18,'0'))*(neg?-1n:1n);}
function reconcile(s){let bal=amount('300000');for(const r of s.ledger){bal+=amount(r.realizedJpy)-amount(r.commission)-amount(r.financing);assert.equal(bal,amount(r.balanceAfter));}assert.equal(bal,amount(s.balance));}
const error=code=>e=>e.code===code;

test('native engine tag, fixed chapter hypotheses, no target tuning',()=>{
 const s=state();assert.equal(s.rules.engine,'nautilus-trader');assert.deepEqual(s.rules.chapterRules,[{leverage:'500',stopout:'0.2'},{leverage:'25',stopout:'0.5'},{leverage:'25',stopout:'0.3'}]);assert.equal(s.rules.targetFactor,'66.6666667');
});

test('real BacktestEngine QuoteTick market BUY/SELL fills exactly ask/bid without extra tick; explicit fee model',async()=>{
 const f=frames();let s=state();s=await advance(s,f,[tick(f[1].time),tick(f[1].time+1000)]);
 assert.equal(s.balance,'299997');assert.equal(s.fills[0].price,'100.02');assert.equal(s.fills[0].commission,'3');assert.ok(s.fills[0].nativeTradeId);assert.equal(s.nativeReceipt.version,'1.231.0');assert.equal(s.nativeReceipt.barExecution,false);
 const snap=snapshot(s,f[1]);assert.equal(snap.margin,'200.04');assert.equal(snap.unrealizedJpy,'-20');assert.equal(snap.engine,'nautilus-trader');
 s=await advance(s,f,[tick(f[2].time),tick(f[2].time+1000)],'0');assert.equal(s.fills[1].price,'100');assert.equal(s.balance,'299974');assert.equal(s.position,null);reconcile(s);
});

test('native short sells bid, stop gap buys actual ask rather than trigger or H1 high',async()=>{
 const f=frames();let s=await advance(state(),f,[tick(f[1].time),tick(f[1].time+1000)],'-1000','105');
 assert.equal(s.fills[0].price,'100');
 s=await advance(s,f,[tick(f[2].time,'110','110.02'),tick(f[2].time+1000,'110','110.02')],'-1000',null);
 assert.equal(s.fills[1].reason,'stop');assert.equal(s.fills[1].price,'110.02');assert.equal(s.fills[1].time,f[2].time);assert.equal(s.orders[1].status,'risk_blocked');assert.equal(s.position,null);reconcile(s);
});

test('native long STOP_MARKET gap uses current quote, old stop before target removal',async()=>{
 const f=frames();let s=await advance(state(),f,[tick(f[1].time),tick(f[1].time+1000)],'1000','95');
 s=await advance(s,f,[tick(f[2].time,'90','90.02'),tick(f[2].time+1000,'90','90.02')],'1000',null);
 assert.equal(s.fills[1].price,'90');assert.equal(s.fills[1].reason,'stop');assert.equal(s.balance,'289974');assert.equal(s.position,null);assert.equal(s.orders[1].status,'risk_blocked');reconcile(s);
});

test('stop triggers only on consumed quote, H1 extremes are not matcher data',async()=>{
 const f=frames();f[1].bid={open:'100',high:'200',low:'1',close:'100'};f[1].ask={open:'100.02',high:'200.02',low:'1.02',close:'100.02'};
 let s=await advance(state(),f,[tick(f[1].time),tick(f[1].time+12345,'94','94.02')],'1000','95');
 assert.equal(s.fills[0].price,'100.02');assert.equal(s.fills[1].price,'94');assert.equal(s.fills[1].time,f[1].time+12345);assert.equal(s.fills[1].mode,'quote_tick');reconcile(s);
});

test('bankruptcy halts on actual quote, preserves negative balance, drops unconsumed future quotes',async()=>{
 const f=frames();const q=[tick(f[1].time),tick(f[1].time+1000,'99.7','99.72'),tick(f[1].time+2000,'80','80.02')];
 const s=await advance(state(),f,q,'1000000');assert.equal(s.balance,'-26000');assert.equal(s.bankrupt,true);assert.equal(s.status,'complete');assert.equal(s.outcome,'bankrupt');assert.equal(s.position,null);
 assert.equal(s.fills[1].reason,'stopout');assert.equal(s.fills[1].price,'99.7');assert.equal(s.nativeReceipt.processedQuotes,2);assert.equal(s.nativeJournal[0].ticks.length,2);assert.equal(s.lastQuote.time,q[1].time);
 const snap=snapshot(s,f[1]);assert.equal(snap.time,q[1].time);assert.ok(!('nativeJournal' in snap));assert.ok(!('quoteTicks' in snap));assert.equal(snap.balance,'-26000');
 await assert.rejects(()=>advance(s,f,[tick(f[2].time)],'0'),error('RUN_COMPLETE'));reconcile(s);
});

test('JPY/CHF CurrencyPair and JPY FeeModel; CHF realized losses at synchronous ask',async()=>{
 let s=state(1);let f=frames(2);s=await advance(s,f,[tick(f[1].time),tick(f[1].time+1000)],'0');assert.equal(s.chapter,1);
 f=frames(2,Date.UTC(2024,5,10,10));const fx=t=>({time:t,bid:'160',ask:'160.2'});s=await advance(s,f,[tick(f[1].time,'1','1.0002',fx(f[1].time)),tick(f[1].time+1000,'1','1.0002',fx(f[1].time+1000))]);
 assert.equal(s.fills[0].price,'1.0002');assert.equal(s.fills[1].price,'1');assert.equal(s.fills[1].closedLots[0].conversionRate,'160.2');assert.equal(s.fills[1].realizedJpy,'-32.04');assert.equal(s.balance,'299961.96');assert.equal(s.chapter,2);assert.equal(s.position,null);reconcile(s);
});

test('CHF profit converted at exact quote bid; no fixed rate or future fx',async()=>{
 let s=state(1);let f=frames(2);s=await advance(s,f,[tick(f[1].time)],'0');f=frames(2,Date.UTC(2024,5,10,10));
 s=await advance(s,f,[tick(f[1].time,'1','1.0002',{time:f[1].time,bid:'160',ask:'160.2'}),tick(f[1].time+1000,'1.01','1.0102',{time:f[1].time+1000,bid:'170',ask:'170.2'})]);
 assert.equal(s.fills[1].closedLots[0].conversionRate,'170');assert.equal(s.fills[1].realizedJpy,'1666');assert.equal(s.balance,'301660');reconcile(s);
});

test('chapter1 margin uses 500, chapter2 uses 25 and blocks oversized CHF exposure',async()=>{
 const f=frames();let s=await advance(state(),f,[tick(f[1].time)],'1000000');assert.equal(s.position.quantity,'1000000');assert.equal(snapshot(s,f[1]).margin,'200040');
 s=state(1);s=await advance(s,frames(2),[tick(T+H)],'0');const fx={time:T+H,bid:'160',ask:'160.2'};
 s=await advance(s,frames(2),[tick(T+H,'1','1.0002',fx)],'50000');assert.equal(s.orders[1].status,'rejected');assert.equal(s.fills.length,0);assert.equal(s.balance,'300000');reconcile(s);
});

test('fixed data-module summer/winter 49h weekend endpoints work; exact endpoint required',async()=>{
 for(const start of [Date.UTC(2024,5,14,20),Date.UTC(2024,0,12,21)]){
  const f=[{time:start-H},{time:start},{time:start+49*H},{time:start+50*H}];
  let s=state(3,{weekendGaps:[{from:start,to:start+49*H}]});s=await advance(s,f,[tick(start)]);s=await advance(s,f,[tick(start+49*H)]);
  assert.equal(s.index,2);assert.equal(s.balance,'299977');assert.equal(s.ledger.find(x=>x.type==='financing').days,2);reconcile(s);
  let denied=await advance(state(),f,[tick(start)]);denied=await advance(denied,f,[tick(start+49*H)]);assert.equal(denied.status,'missing_data');assert.equal(denied.index,1);assert.equal(denied.decisions.length,1);
 }
});

test('native missing quote coverage or CHF alignment cannot create partial fills or decisions',async()=>{
 const s=state(),f=frames();const d=decision(s);let r=await decideAndAdvance(s,d,f,options(f,s,[]));assert.equal(r.status,'missing_data');assert.equal(r.version,1);assert.deepEqual(r.ledger,[]);assert.deepEqual(r.decisions,[]);
 const opts=options(f,s,[tick(f[1].time)]);opts.coverage.complete=false;r=await decideAndAdvance(s,d,f,opts);assert.equal(r.status,'missing_data');assert.equal(r.balance,'300000');
 let chf=state(1);chf=await advance(chf,frames(2),[tick(T+H)],'0');r=await advance(chf,frames(2),[tick(T+H,'1','1.0002',{time:T+H+1,bid:'160',ask:'160.2'})]);assert.equal(r.status,'missing_data');assert.equal(r.version,chf.version);assert.deepEqual(r.ledger,chf.ledger);
});

test('H1/M1 OHLC cannot masquerade as quote ticks; unsupported liquidity stated explicitly',async()=>{
 const s=state(),f=frames(),opts=options(f,s,[tick(f[1].time)]);opts.coverage.dataKind='h1';await assert.rejects(()=>decideAndAdvance(s,decision(s),f,opts),error('UNSUPPORTED_DATA_KIND'));
 opts.coverage.dataKind='quote_ticks';delete opts.coverage.liquidityAssumption;await assert.rejects(()=>decideAndAdvance(s,decision(s),f,opts),error('UNSUPPORTED_LIQUIDITY'));
});

test('native same ID/content idempotent without subprocess, strict CAS version and conflict',async()=>{
 const f=frames(),s=state(),d=decision(s);const next=await decideAndAdvance(s,d,f,options(f,s,[tick(f[1].time)]));
 assert.deepEqual(await decideAndAdvance(next,d,null,{pythonPath:'/not-used'}),next);
 assert.throws(()=>validateDecision(next,{...d,target:'2000'}),error('ID_CONFLICT'));
 assert.throws(()=>validateDecision(next,{...decision(next),expectedVersion:1}),error('VERSION_MISMATCH'));
 const corrupt=copy(next);corrupt.position.lots[0].entry='99';await assert.rejects(()=>advance(corrupt,f,[tick(f[2].time)]),error('CHECKPOINT_MISMATCH'));
});

test('all three chapters settle native quote flat, carry capital, final victory only',async()=>{
 let s=state(1);let f=frames(2);s=await advance(s,f,[tick(f[1].time),tick(f[1].time+1000)]);assert.equal(s.balance,'299974');assert.equal(s.position,null);assert.equal(s.fills.at(-1).reason,'chapter_end');assert.equal(s.fills.at(-1).time,f[1].time+1000);
 f=frames(2,Date.UTC(2024,5,10,10));s=await advance(s,f,[tick(f[1].time,'1','1.0002',{time:f[1].time,bid:'160',ask:'160.2'})],'0');assert.equal(s.chapter,2);assert.equal(s.balance,'299974');
 f=frames(2,Date.UTC(2025,0,10,10));s=await advance(s,f,[tick(f[1].time)],'0');assert.equal(s.status,'complete');assert.equal(s.outcome,'not_reached');assert.equal(s.balance,'299974');reconcile(s);
});

test('native adapter leaves caller state, decision and quote array unchanged',async()=>{
 const s=state(),f=frames(),d=decision(s),opts=options(f,s,[tick(f[1].time)]);const before=JSON.stringify({s,f,d,opts});await decideAndAdvance(s,d,f,opts);assert.equal(JSON.stringify({s,f,d,opts}),before);
});


test('same-ms main quotes keep observed order and raw millisecond fill time',async()=>{
 const f=frames();const ms=f[1].time;
 const q=[tick(ms),tick(ms,'94','94.02'),tick(ms,'93','93.02')];
 const s=await advance(state(),f,q,'1000','95');assert.equal(s.fills[1].price,'94');assert.equal(s.fills[1].time,ms);assert.equal(s.lastQuote.bid,'93');assert.equal(s.nativeReceipt.processedQuotes,3);
 assert.equal(s.fills[0].nativeEventNs,String(BigInt(ms)*1000000n));assert.equal(s.fills[1].nativeEventNs,String(BigInt(ms)*1000000n+1n));reconcile(s);
});

test('FX as-of join never selects a future quote, stable same-ms FX ordering, fixed age',()=>{
 const ms=T+H,main=[tick(ms,'1','1.0002'),tick(ms+1000,'1.01','1.0102')];
 const fx=[tick(ms-500,'160','160.2'),tick(ms-500,'161','161.2'),tick(ms+500,'170','170.2'),tick(ms+1500,'999','999.2')];
 const q=joinAsOfQuotes(main,fx);assert.equal(q[0].fx.bid,'161');assert.equal(q[0].fx.time,ms-500);assert.equal(q[1].fx.bid,'170');assert.equal(q[1].fx.time,ms+500);assert.equal(q[1].fxAgeMs,500);
 assert.throws(()=>joinAsOfQuotes(main,[tick(ms+1,'160','160.2')]),error('INVALID_DATA'));
 assert.throws(()=>joinAsOfQuotes(main,[tick(ms-60001,'160','160.2')]),error('INVALID_DATA'));
 assert.equal(joinAsOfQuotes([main[0]],[tick(ms-60000,'160','160.2')])[0].fxAgeMs,60000);
});

test('native CHFJPY uses actual asynchronous FX source time and bid/ask conversion evidence',async()=>{
 let s=await advance(state(1),frames(2),[tick(T+H)],'0');const f=frames(2),ms=f[1].time;
 const q=joinAsOfQuotes([tick(ms,'1','1.0002'),tick(ms+1000,'1.01','1.0102')],[tick(ms-500,'160','160.2'),tick(ms+500,'170','170.2'),tick(ms+1500,'999','999.2')]);
 s=await advance(s,f,q);assert.equal(s.fills[1].realizedJpy,'1666');assert.equal(s.fills[1].closedLots[0].conversionTimeMs,ms+500);assert.equal(s.fills[1].closedLots[0].conversionAgeMs,500);assert.equal(s.balance,'301660');reconcile(s);
});

// Stable owned test storage keeps the costly pinned venv reusable across test runs.
const storage=new URL('../../../../../.data/plugin-envs/kurumi-replay-formal-tests/',import.meta.url).pathname;
const fixtureLoader=(all,fx)=>async(_storage,{chapterId,symbol,from,to})=>({symbol,chapterId,from,to,rangeConvention:'inclusive UTC milliseconds',kind:'ticks',rows:(symbol==='CHFJPY'?fx:all).filter(x=>x.time>=from&&x.time<=to),sources:[{kind:'synthetic-fixture',timeBasis:'UTC milliseconds'}],historicalGaplessnessCertified:false});
const dataFor=(s,f)=>({chapters:s.chapters,frames:[f,f,f],digests:s.dataDigests});

test('service-facing production exports: explicit private prepare, immutable refs, persistent native CAS candidate',async()=>{
 const publicEngine=await import('../engine.js');assert.equal(publicEngine.createRun('x',state().chapters,{}).rules.engine,'nautilus-trader');assert.equal(publicEngine.snapshot,snapshot);
 const ac=new AbortController();ac.abort();await assert.rejects(()=>prepareNative(storage,{signal:ac.signal}),error('CANCELLED'));
 const ready=await prepareNative(storage);assert.equal(ready.ready,true);assert.ok(ready.pythonPath.startsWith(ready.directory));assert.equal((await nativeStatus(storage)).engineVersion,'1.231.0');
 const f=frames();let s=state();const all=[tick(f[1].time),tick(f[1].time+1),tick(f[2].time),tick(f[2].time+1)];
 const load=fixtureLoader(all);s=await advanceNative(storage,s,decision(s),dataFor(s,f),{loadExecutionSlice:load});assert.ok(s.nativeJournal[0].ticksRef.digest.startsWith('sha256:'));assert.ok(!('ticks' in s.nativeJournal[0]));
 assert.equal(s.nativeReceipt.cacheReused,false);const before=copy(s);s=await advanceNative(storage,s,decision(s,'0'),dataFor(s,f),{loadExecutionSlice:load});assert.equal(s.nativeReceipt.cacheReused,true);assert.equal(s.nativeReceipt.replayedStepsThisCall,0);assert.equal(s.balance,'299974');reconcile(s);
 // A rejected service CAS can submit the OLD checkpoint: cache mismatch rebuilds,
 // rather than trusting the tentative worker's newer balance or charging twice.
 const retry=await advanceNative(storage,before,decision(before,'0'),dataFor(before,f),{loadExecutionSlice:load});assert.equal(retry.balance,s.balance);assert.equal(retry.nativeReceipt.cacheReused,false);assert.deepEqual(retry.ledger,s.ledger);
 const missing=await advanceNative(storage,before,decision(before),dataFor(before,f),{loadExecutionSlice:fixtureLoader([])});assert.equal(missing.status,'missing_data');assert.equal(missing.version,before.version);assert.deepEqual(missing.ledger,before.ledger);
});

test('formal native worker crosses all chapters and asynchronous FX without ENGINE_MISMATCH',async()=>{
 await prepareNative(storage);let s=state(1),f=frames(2);s.chapters[1].id='chapter2';
 s=await advanceNative(storage,s,decision(s),dataFor(s,f),{loadExecutionSlice:fixtureLoader([tick(f[1].time),tick(f[1].time+1)])});assert.equal(s.chapter,1);
 f=frames(2,Date.UTC(2024,5,10,10));const fx=[tick(f[1].time-500,'160','160.2'),tick(f[1].time+500,'170','170.2')];const main=[tick(f[1].time,'1','1.0002'),tick(f[1].time+1000,'1.01','1.0102')];
 s=await advanceNative(storage,s,decision(s),dataFor(s,f),{loadExecutionSlice:fixtureLoader(main,fx)});assert.equal(s.chapter,2);assert.equal(s.balance,'301634');assert.equal(s.nativeReceipt.cacheReused,true);
 f=frames(2,Date.UTC(2025,0,10,10));s=await advanceNative(storage,s,decision(s,'0'),dataFor(s,f),{loadExecutionSlice:fixtureLoader([tick(f[1].time)])});assert.equal(s.status,'complete');assert.equal(s.outcome,'not_reached');assert.equal(s.nativeReceipt.cacheReused,true);reconcile(s);
});

test('formal bankruptcy journal retains only consumed prefix, cancel kills worker without state commit',async()=>{
 await prepareNative(storage);const f=frames(),initial=state();const q=[tick(f[1].time),tick(f[1].time+1,'99.7','99.72'),tick(f[1].time+2,'80','80.02')];
 const done=await advanceNative(storage,initial,decision(initial,'1000000'),dataFor(initial,f),{loadExecutionSlice:fixtureLoader(q)});assert.equal(done.balance,'-26000');assert.equal(done.nativeJournal[0].ticksRef.rowCount,2);assert.ok(!('ticks' in done.nativeJournal[0]));
 const quotes=Array.from({length:100000},(_,i)=>tick(f[1].time+i));const controller=new AbortController();const unchanged=JSON.stringify(initial);const timer=setTimeout(()=>controller.abort(),1200);
 try{await assert.rejects(()=>advanceNative(storage,initial,decision(initial),dataFor(initial,f),{signal:controller.signal,loadExecutionSlice:fixtureLoader(quotes)}),error('CANCELLED'));}finally{clearTimeout(timer);}
 assert.equal(JSON.stringify(initial),unchanged);const next=await advanceNative(storage,initial,decision(initial),dataFor(initial,f),{loadExecutionSlice:fixtureLoader([tick(f[1].time)])});assert.equal(next.balance,'299997');assert.equal(next.nativeReceipt.cacheReused,false);
});

test('measured native persistent-prefix benchmark: actual engine calls, linear quote-file/journal footprint',async t=>{
 await prepareNative(storage);let s=state(4);const f=frames(6);const perStep=3000;const rows=Array.from({length:3},(_,step)=>Array.from({length:perStep},(_,i)=>tick(f[step+1].time+i*100))).flat();const loader=fixtureLoader(rows);
 const metrics=[];for(let i=0;i<3;i++){const start=performance.now();s=await advanceNative(storage,s,decision(s),dataFor(s,f),{loadExecutionSlice:loader});metrics.push({step:i+1,wallMs:Math.round(performance.now()-start),engineMs:s.nativeReceipt.elapsedMs,reused:s.nativeReceipt.cacheReused,processedQuotes:s.nativeReceipt.processedQuotes,journalBytes:s.nativeReceipt.journalBytes,quoteFileBytes:s.nativeReceipt.quoteFileBytes});}
 assert.equal(metrics[1].reused,true);assert.equal(metrics[2].reused,true);assert.ok(metrics[2].journalBytes<6000);assert.equal(s.nativeReceipt.processedQuotes,perStep*3);assert.ok(metrics[2].quoteFileBytes>metrics[1].quoteFileBytes);reconcile(s);t.diagnostic(JSON.stringify({fixture:'synthetic 3000 observed-style quote rows/H1; not historical liquidity',metrics}));
});


test('native fixed chapter2 0.5 and chapter3 0.3 stopout are applied by explicit adapter',async()=>{
 let s=await advance(state(1),frames(2),[tick(T+H)],'0');let f=frames(2,Date.UTC(2024,5,10,10));const fx=t=>({time:t,bid:'160',ask:'160.2'});
 s=await advance(s,f,[tick(f[1].time,'1','1.0002',fx(f[1].time)),tick(f[1].time+1000,'0.97','0.9702',fx(f[1].time+1000))],'40000');assert.equal(s.fills.at(-1).reason,'stopout');assert.equal(s.balance,'106238.4');assert.equal(s.chapter,2);reconcile(s);
 f=frames(2,Date.UTC(2025,0,10,10));s=await advance(s,f,[tick(f[1].time),tick(f[1].time+1000,'98.5','98.52')],'20000');assert.equal(s.fills.at(-1).reason,'chapter_end');assert.equal(s.outcome,'not_reached');reconcile(s);
 let fresh=await advance(state(1),frames(2),[tick(T+H)],'0');fresh=await advance(fresh,frames(2,Date.UTC(2024,5,10,10)),[tick(Date.UTC(2024,5,10,11),'1','1.0002',{time:Date.UTC(2024,5,10,11),bid:'160',ask:'160.2'})],'0');
 fresh=await advance(fresh,f,[tick(f[1].time),tick(f[1].time+1000,'95','95.02')],'50000');assert.equal(fresh.fills.at(-1).reason,'stopout');assert.equal(fresh.balance,'48700');reconcile(fresh);
});

test('native simulated financing only between consumed quote timestamps, never artificial interval end',async()=>{
 const f=frames(5,Date.UTC(2024,0,8,22));let s=await advance(state(),f,[tick(f[1].time),tick(f[1].time+1000)]);assert.equal(s.balance,'299997');assert.equal(s.ledger.length,1);
 s=await advance(s,f,[tick(f[2].time)]);assert.equal(s.balance,'299987');const row=s.ledger.find(x=>x.type==='financing');assert.equal(row.simulated,true);assert.equal(row.financing,'10');assert.equal(row.time,f[2].time);assert.equal(row.from,f[1].time+1000);assert.equal(row.days,1);reconcile(s);
});


test('native FIFO add, partial reduce and reversal retain lots and reconcile each actual fill',async()=>{
 const f=frames(6);let s=state(5);s=await advance(s,f,[tick(f[1].time)]);s=await advance(s,f,[tick(f[2].time,'110','110.02')],'2000');assert.equal(s.position.entry,'105.02');assert.equal(s.position.lots.length,2);
 s=await advance(s,f,[tick(f[3].time,'120','120.02')],'1000');assert.equal(s.fills[2].closedLots[0].entry,'100.02');assert.equal(s.fills[2].realizedJpy,'19980');assert.equal(s.position.lots[0].entry,'110.02');assert.equal(s.balance,'319971');
 s=await advance(s,f,[tick(f[4].time,'90','90.02')],'-1000');assert.equal(s.position.quantity,'-1000');assert.equal(s.position.entry,'90');assert.equal(s.fills[3].realizedJpy,'-20020');assert.equal(s.fills[4].commission,'3');assert.equal(s.balance,'299945');reconcile(s);
});


test('frozen native 300000 JPY cannot override challenge equity or block an admitted larger position',async()=>{
 const f=frames();let s=await advance(state(),f,[tick(f[1].time)],'1000000');assert.equal(s.nativeReceipt.nativeFrozenBalanceJpy,'300000');assert.equal(s.balance,'297000');
 s=await advance(s,f,[tick(f[2].time,'200','200.02')],'2000000');assert.equal(s.orders[1].status,'filled');assert.equal(s.position.quantity,'2000000');assert.equal(s.balance,'294000');assert.equal(snapshot(s,f[2]).margin,'800080');assert.equal(s.nativeReceipt.nativeFrozenBalanceJpy,'300000');reconcile(s);
});


test('native stop must exactly align with tick; invalid precision never silently rounded or charged',async()=>{
 const s=state(),f=frames();const d=decision(s,'1000','95.0001');assert.throws(()=>validateDecision(s,d),error('UNSUPPORTED_STOP_PRECISION'));await assert.rejects(()=>decideAndAdvance(s,d,f,{pythonPath:'/not-invoked'}),error('UNSUPPORTED_STOP_PRECISION'));assert.equal(s.balance,'300000');assert.equal(s.ledger.length,0);
});

test('native lifecycle disposal closes only the registered private worker and prevents queued restart',async()=>{await prepareNative(storage);let s=state(4),f=frames(6);const load=fixtureLoader([tick(f[1].time),tick(f[2].time),tick(f[3].time)]);s=await advanceNative(storage,s,decision(s),dataFor(s,f),{loadExecutionSlice:load});assert.equal((await disposeNative(storage+'unused-other')).killed,false);s=await advanceNative(storage,s,decision(s),dataFor(s,f),{loadExecutionSlice:load});assert.equal(s.nativeReceipt.cacheReused,true);const before=copy(s);assert.equal((await disposeNative(storage)).killed,true);assert.deepEqual(s,before);s=await advanceNative(storage,s,decision(s),dataFor(s,f),{loadExecutionSlice:load});assert.equal(s.nativeReceipt.cacheReused,false);reconcile(s);});
after(()=>disposeNative(storage));
