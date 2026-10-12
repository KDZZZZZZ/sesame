import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {onWeeklyBoundary,freezeWeeklyFrame,weeklyFinancials,weekStartUTC,listWeeklyJobs,drainWeeklyQueue,reconcileWeeklyOutput} from '../weekly-reports.js';
import {weeklyReportHTML,publishWeeklyReport} from '../report.js';
import {weeklyProvenanceKind} from '../report-provenance.js';
import {fixture,H,T,sha} from './round2-presentation-fixtures.test.mjs';
const err=code=>e=>e.code===code,MON=T+2*H,WEEK=7*86400000;
function context(f,cutoff,extras={}){const engine=structuredClone(f.engine);return {engine,runId:engine.id,chapter:engine.chapter,replayCutoffMs:cutoff,account:{engineVersion:engine.version,asOfMs:cutoff,quoteTimeMs:cutoff-1,balance:engine.balance,equity:engine.balance,unrealizedJpy:'0',margin:'0',freeMargin:engine.balance},market:{runId:engine.id,cutoffMs:cutoff,bars:[],sources:[]},methods:[],...extras};}
async function queueOne(f){await onWeeklyBoundary(f.host,f.service,context(f,T));f.engine={...f.engine,version:2};await onWeeklyBoundary(f.host,f.service,context(f,MON));return listWeeklyJobs(f.host)[0];}
function finances(f){f.engine={...f.engine,version:2,balance:'301987.5',fills:[{id:'fill1',chapter:0,time:T+H,signedQuantity:'1000',price:'100',realizedJpy:'0',commission:'3'},{id:'fill2',chapter:0,time:T+H+1,signedQuantity:'-1000',price:'102',realizedJpy:'2000',commission:'3'}],orders:[{id:'order1',chapter:0,time:T+H,status:'filled',target:'1000'}],ledger:[{type:'fill',id:'fill1',chapter:0,time:T+H,realizedJpy:'0',commission:'3',financing:'0',balanceAfter:'299997'},{type:'fill',id:'fill2',chapter:0,time:T+H+1,realizedJpy:'2000',commission:'3',financing:'0',balanceAfter:'301994'},{type:'financing',id:'cost1',chapter:0,time:T+H+2,realizedJpy:'0',commission:'0',financing:'6.5',balanceAfter:'301987.5'}],equity:[{chapter:0,time:T+H,equity:'299997',quantity:'1000',margin:'2000'}]};}

test('observed weekly artifacts preserve frozen classification and the consumed source dependency chain',async()=>{
 const f=fixture(),ref={id:'observed-source',revision:'1',digest:sha('observed source fixture'),kind:'resource',schemaVersion:'1.0.0'};
 const raw={url:'https://example.invalid/consumed-ticks',digest:sha('consumed'),bytes:123};
 f.data.provenance={kind:'derived',inputKind:'observed',sources:['FUTURE_SOURCE'],audienceOnlyAnchors:['FUTURE_STORY']};
 const at=cutoff=>context(f,cutoff,{market:{runId:f.engine.id,cutoffMs:cutoff,bars:[],sources:[{sourceDigest:sha('consumed'),sourceRefs:[ref,raw,ref]}]}});
 await onWeeklyBoundary(f.host,f.service,at(T));f.engine.version=2;await onWeeklyBoundary(f.host,f.service,at(MON));
 const job=listWeeklyJobs(f.host)[0];assert.equal(JSON.stringify(job.input).includes('FUTURE_'),false);
 assert.deepEqual(job.input.closing.sourceProvenance,{kind:'derived',inputKind:'observed'});
 const source=f.artifacts.get(job.id+'_source'),data=f.artifacts.get(job.id+'_data');
 assert.deepEqual(source.request.manifest.dependencies,[ref]);assert.deepEqual(data.request.manifest.dependencies,[source.ref]);
 const sourceEvidence=JSON.parse(f.blobs.get(source.request.manifest.blobs[0].digest));
 assert.deepEqual(sourceEvidence.closing.sources[0].sourceRefs,[ref,raw,ref]);
 // Publication must not relabel a frozen observed week when the service moves.
 f.data.provenance={kind:'demo'};await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model});
 const sealed=listWeeklyJobs(f.host)[0],output=f.artifacts.get(job.id+'_output'),report=f.artifacts.get(job.id+'_report');
 for(const item of [source,data,output,report]){
  assert.equal(item.request.manifest.provenance.kind,'derived');
  assert.deepEqual(item.request.manifest.content.provenance,item.request.manifest.provenance);
  assert.deepEqual(item.request.manifest.dependencies,item.request.manifest.provenance.references);
 }
 assert.deepEqual(output.request.manifest.dependencies,[job.inputRef]);
 assert.deepEqual(report.request.manifest.dependencies,[job.inputRef,sealed.outputRef]);
 const before=f.artifacts.size;await publishWeeklyReport(f.host,f.service,sealed);assert.equal(f.artifacts.size,before);
 assert.equal(f.calls.inference.length,1);
});

test('demo weekly sources, fixed data, output and report remain demo after later observed data',async()=>{
 const f=fixture();const job=await queueOne(f);f.data.provenance={kind:'derived',inputKind:'observed'};
 await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model});
 for(const suffix of ['_source','_data','_output','_report']){
  const {manifest}=f.artifacts.get(job.id+suffix).request;
  assert.equal(manifest.provenance.kind,'demo');assert.deepEqual(manifest.content.provenance,manifest.provenance);
 }
 const input=structuredClone(job.input);input.closing.sourceProvenance={kind:'derived',inputKind:'observed'};
 assert.equal(weeklyProvenanceKind(input),'demo');
});

test('unclassified frozen legacy weekly evidence fails explicitly without model or publication',async()=>{
 const f=fixture();const job=await queueOne(f);delete job.input.opening.sourceProvenance;
 const count=f.calls.publish.length;
 await assert.rejects(publishWeeklyReport(f.host,f.service,{...job,output:{text:'SYNTHETIC'}}),err('PROVENANCE_REQUIRED'));
 assert.equal(f.calls.publish.length,count);assert.equal(f.calls.inference.length,0);
 f.storage.put('round2-weekly',job);
 await assert.rejects(drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model}),err('PROVENANCE_REQUIRED'));
 assert.equal(f.calls.publish.length,count);assert.equal(f.calls.inference.length,0);
 delete f.data.provenance;assert.throws(()=>freezeWeeklyFrame(f.host,f.service,context(f,MON)),err('PROVENANCE_REQUIRED'));
});

test('UTC weeks per chapter: initial partial, full week, final partial including no-action period',async()=>{
 const f=fixture();assert.equal(weekStartUTC(MON),MON);assert.equal(weekStartUTC(T),MON-WEEK);await onWeeklyBoundary(f.host,f.service,context(f,T));
 f.engine={...f.engine,version:2};const first=await onWeeklyBoundary(f.host,f.service,context(f,MON));assert.equal(first.jobs.length,1);assert.equal(first.jobs[0].period.initialPartial,true);assert.equal(first.jobs[0].period.finalPartial,false);assert.equal(first.generationSubmitted,false);assert.equal(f.calls.inference.length,0);
 f.engine={...f.engine,version:3};await onWeeklyBoundary(f.host,f.service,context(f,MON+WEEK));f.engine={...f.engine,version:4};await onWeeklyBoundary(f.host,f.service,context(f,MON+WEEK+H,{chapterEnded:true}));
 const jobs=listWeeklyJobs(f.host);assert.equal(jobs.length,3);assert.equal(jobs[1].input.period.partial,false);assert.equal(jobs[2].input.period.finalPartial,true);assert.equal(jobs[2].input.financial.ledgerRows,0);assert.ok(jobs.every(j=>j.inputRef.kind==='data'));
 const duplicate=await onWeeklyBoundary(f.host,f.service,context(f,MON+WEEK+H,{chapterEnded:true}));assert.equal(duplicate.status,'already_closed');assert.equal(listWeeklyJobs(f.host).length,3);
 f.engine={...f.engine,chapter:1,version:5};await onWeeklyBoundary(f.host,f.service,context(f,MON+2*WEEK+H));f.engine={...f.engine,version:6};await onWeeklyBoundary(f.host,f.service,context(f,MON+2*WEEK+2*H,{terminal:true}));assert.equal(listWeeklyJobs(f.host).at(-1).input.period.chapter,1);assert.equal(listWeeklyJobs(f.host).at(-1).input.period.initialPartial,true);
});

test('financial exact fees/fills/ledger reconcile; drawdown uses disclosed marks, no invented original assets',async()=>{
 const f=fixture(),open=freezeWeeklyFrame(f.host,f.service,context(f,T));await onWeeklyBoundary(f.host,f.service,context(f,T));finances(f);const close=freezeWeeklyFrame(f.host,f.service,context(f,MON));const finance=weeklyFinancials(open,close);assert.equal(finance.realizedJpy,'2000');assert.equal(finance.commissionJpy,'6');assert.equal(finance.financingJpy,'6.5');assert.equal(finance.netBalanceChangeJpy,'1987.5');assert.equal(finance.maxObservedDrawdownPct,'0.001');
 await onWeeklyBoundary(f.host,f.service,context(f,MON));const job=listWeeklyJobs(f.host)[0];assert.equal(job.input.financial.totalCostsJpy,'12.5');assert.equal(job.input.closing.positions,null);assert.deepEqual(job.input.closing.originalComparison,[]);assert.ok(job.input.closing.restrictions.some(x=>/知情重放/.test(x)));
 const bad=structuredClone(close);bad.fills[0].commission='4';assert.throws(()=>weeklyFinancials(open,bad),err('LEDGER_MISMATCH'));bad.fills[0].commission='3';bad.account.balance='300000';assert.throws(()=>weeklyFinancials(open,bad),err('LEDGER_MISMATCH'));
});

test('frozen boundary inputs cannot mix next week data; missing exact boundary fails closed',async()=>{
 const f=fixture();await onWeeklyBoundary(f.host,f.service,context(f,T));f.engine={...f.engine,version:2};await assert.rejects(onWeeklyBoundary(f.host,f.service,context(f,MON+H)),err('BOUNDARY_SNAPSHOT_REQUIRED'));assert.equal(listWeeklyJobs(f.host).length,0);
 const boundary=context(f,MON);await onWeeklyBoundary(f.host,f.service,context(f,MON+H,{boundarySnapshots:[boundary]}));const saved=listWeeklyJobs(f.host)[0];assert.equal(saved.input.closing.cutoffMs,MON);assert.equal(saved.input.closing.account.asOfMs,MON);
 f.engine.balance='9999999';f.engine.fills.push({id:'FUTURE',time:MON+10000});assert.equal(listWeeklyJobs(f.host)[0].input.closing.account.balance,'300000');assert.equal(JSON.stringify(listWeeklyJobs(f.host)[0].input).includes('FUTURE'),false);
 const future=context(f,MON);assert.throws(()=>freezeWeeklyFrame(f.host,f.service,future),err('FUTURE_DATA_FORBIDDEN'));
});

test('account cutoff, method adoption and original release must be explicit known evidence',()=>{
 const f=fixture(),bad=context(f,T);bad.account.asOfMs=T+1;assert.throws(()=>freezeWeeklyFrame(f.host,f.service,bad),err('BOUNDARY_SNAPSHOT_REQUIRED'));
 assert.throws(()=>freezeWeeklyFrame(f.host,f.service,context(f,T,{methods:[{status:'adopted',pluginId:'sesame/ict',version:'1.0.0',method:'never called'}]})),err('METHOD_EVIDENCE_REQUIRED'));
 assert.throws(()=>freezeWeeklyFrame(f.host,f.service,context(f,T,{originalComparison:[{text:'future outcome',knownAt:{unixMs:T+1}}]})),err('FUTURE_DATA_FORBIDDEN'));
 const frame=freezeWeeklyFrame(f.host,f.service,context(f,T,{account:{...context(f,T).account,margin:{status:'unknown',reason:'fixture missing'}}}));assert.equal(frame.account.margin.status,'unknown');assert.equal(frame.sourceCoverage.unresolvedEarlyCHFJPYEvents,327);
});

test('input archive failure remains durable todo; restart/retry does not duplicate period or trade',async()=>{
 const f=fixture();await onWeeklyBoundary(f.host,f.service,context(f,T));f.engine={...f.engine,version:2};const c=context(f,MON),original=f.service.archiveFileSafe;f.service.archiveFileSafe=async()=>{throw Object.assign(Error('fixture archive failure'),{code:'ARCHIVE_FAIL'});};
 await assert.rejects(onWeeklyBoundary(f.host,f.service,c),err('ARCHIVE_FAIL'));assert.equal(listWeeklyJobs(f.host)[0].status,'input_archive_failed');assert.ok(listWeeklyJobs(f.host)[0].input);assert.equal(f.calls.inference.length,0);
 f.service.archiveFileSafe=original;await onWeeklyBoundary(f.host,f.service,c);await onWeeklyBoundary(f.host,f.service,c);assert.equal(listWeeklyJobs(f.host).length,1);assert.equal(listWeeklyJobs(f.host)[0].status,'queued');assert.equal(f.engine.fills.length,0);
});

test('simultaneous duplicate weekly hooks serialize/CAS, same publication DataRef',async()=>{
 const f=fixture();await onWeeklyBoundary(f.host,f.service,context(f,T));f.engine={...f.engine,version:2};await Promise.all([onWeeklyBoundary(f.host,f.service,context(f,MON)),onWeeklyBoundary(f.host,f.service,context(f,MON))]);assert.equal(listWeeklyJobs(f.host).length,1);assert.equal(f.calls.publish.filter(p=>p.manifest.kind==='data').length,1);
 await assert.rejects(onWeeklyBoundary(f.host,f.service,context(f,T)),err('VERSION_CONFLICT'));
});

test('file-backed isolated close/reopen restores pending queue with JSON key reordering; no actual SDK store claim',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'kurumi-weekly-reopen-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const f=fixture();await queueOne(f);const file=join(directory,'queue.json'),reorder=x=>Array.isArray(x)?x.map(reorder):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).reverse().map(k=>[k,reorder(x[k])])):x;
 await writeFile(file,JSON.stringify({classification:'isolated-file-backed-public-port-fixture-not-SDK',records:[...f.storage.map].map(([k,v])=>[k,reorder(v)])}));
 const reopened=fixture(new Map(JSON.parse(await readFile(file,'utf8')).records));reopened.engine={...reopened.engine,version:2};assert.equal(listWeeklyJobs(reopened.host)[0].status,'queued');await onWeeklyBoundary(reopened.host,reopened.service,context(reopened,MON));assert.equal(listWeeklyJobs(reopened.host).length,1);assert.equal(reopened.calls.inference.length,0);
});

test('generation authorization gate: queue never calls paid model; fixture inference archives full output and fixed refs once',async()=>{
 const f=fixture();const job=await queueOne(f);await assert.rejects(drainWeeklyQueue(f.host,f.service,{}),err('GENERATION_NOT_AUTHORIZED'));assert.equal(f.calls.inference.length,0);
 const r=await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model});assert.equal(r.results[0].status,'sealed');assert.equal(r.results[0].receipt.status,'pending');assert.equal(f.calls.inference.length,1);const sealed=listWeeklyJobs(f.host)[0];assert.ok(sealed.output.text.includes('SYNTHETIC'));assert.equal(sealed.reportRef.kind,'report');assert.equal(sealed.outputRef.kind,'data');assert.equal(sealed.inputRef.kind,'data');assert.ok(f.calls.archives.some(x=>x.path.endsWith('/full-output.json')&&x.text.includes('SYNTHETIC')));
 await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model});assert.equal(f.calls.inference.length,1);assert.equal(listWeeklyJobs(f.host)[0].reportRef.id,sealed.reportRef.id);assert.deepEqual(f.calls.inference[0].input.fullEvidenceRef,job.inputRef);assert.deepEqual(f.calls.inference[0].input.financial,job.input.financial);assert.equal(f.calls.inference[0].input.opening.costs,undefined);
});

test('known model failure is failed; unknown result/lost reply remains blocked, never auto-regenerate',async()=>{
 for(const code of ['MODEL_REJECTED','NETWORK_LOST']){const f=fixture();await queueOne(f);f.host.inference.complete=async r=>{f.calls.inference.push(r);throw Object.assign(Error('synthetic failure'),{code});};await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model});const job=listWeeklyJobs(f.host)[0];assert.equal(job.status,code==='MODEL_REJECTED'?'failed':'unknown');await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model});assert.equal(f.calls.inference.length,1);assert.equal(job.output,null);}
});

for(const transport of ['inference','agents'])test(`${transport} request archive failure remains unsubmitted and restarts with the exact frozen request`,async()=>{
 const f=fixture();await queueOne(f);const archive=f.service.archiveFileSafe;
 f.service.archiveFileSafe=async(path,text)=>{
  if(path.endsWith('/request.json')){assert.equal(listWeeklyJobs(f.host)[0].status,'request_archive_pending');throw Object.assign(Error('synthetic request mirror failure'),{code:'ARCHIVE_MIRROR_FAILED'});}
  return archive(path,text);
 };
 const options={authorizeGeneration:true,transport,model:f.model,maxTokens:1234,collectFullAgentOutput:async()=>({complete:true,output:{text:'SYNTHETIC OUTPUT'},artifactRefs:[]})};
 const result=await drainWeeklyQueue(f.host,f.service,options);const saved=listWeeklyJobs(f.host)[0];
 assert.equal(result.results[0].status,'request_archive_pending');assert.equal(saved.status,'request_archive_pending');
 assert.equal(f.calls.inference.length,0);assert.equal(f.calls.agent.length,0);
 const restarted=fixture(new Map(structuredClone([...f.storage.map])));
 await drainWeeklyQueue(restarted.host,restarted.service,{...options,maxTokens:9876});
 const calls=transport==='inference'?restarted.calls.inference:restarted.calls.agent;
 assert.deepEqual(calls,[saved.request]);assert.equal(listWeeklyJobs(restarted.host)[0].status,'sealed');
 assert.ok(restarted.calls.archives.some(r=>r.path.endsWith('/request.json')&&r.text===JSON.stringify(saved.request)));
 await drainWeeklyQueue(restarted.host,restarted.service,options);assert.equal(calls.length,1);
});

test('pre-submit cancellation keeps the frozen weekly request retryable without a model attempt',async()=>{
 const f=fixture();await queueOne(f);const archive=f.service.archiveFileSafe,controller=new AbortController();
 f.service.archiveFileSafe=async(path,text)=>{const receipt=await archive(path,text);if(path.endsWith('/request.json'))controller.abort();return receipt;};
 await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model},controller.signal);
 assert.equal(listWeeklyJobs(f.host)[0].status,'request_archive_pending');assert.equal(f.calls.inference.length,0);
 f.service.archiveFileSafe=archive;await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model});
 assert.equal(f.calls.inference.length,1);assert.equal(listWeeklyJobs(f.host)[0].status,'sealed');
});

test('restart after submitting marks unknown; explicit existing-output reconciliation uses CAS without model replay',async()=>{
 const f=fixture(),job=await queueOne(f);f.host.storage.put('round2-weekly',{...job,revision:job.revision+1,status:'submitting',requestId:job.id+'_generation',transport:'inference'});
 await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model});let current=listWeeklyJobs(f.host)[0];assert.equal(current.status,'unknown');assert.equal(f.calls.inference.length,0);
 assert.throws(()=>reconcileWeeklyOutput(f.host,current.id,current.revision,{requestId:current.requestId,output:{text:'fixture'},evidence:null}),err('RECONCILIATION_REQUIRED'));
 reconcileWeeklyOutput(f.host,current.id,current.revision,{requestId:current.requestId,output:{requestId:current.requestId,text:'SYNTHETIC RECOVERED fixture'},evidence:{classification:'fixture existing receipt'}});await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model});assert.equal(listWeeklyJobs(f.host)[0].status,'sealed');assert.equal(f.calls.inference.length,0);
});

test('full-output archive/publish failure preserves exact output; restart retry no second model/report/trade',async()=>{
 const f=fixture();await queueOne(f);const archive=f.service.archiveFileSafe;let once=true;f.service.archiveFileSafe=async(path,text)=>{if(once&&path.endsWith('/full-output.json')){once=false;throw Error('synthetic full archive failure');}return archive(path,text);};
 await assert.rejects(drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model}),/full archive/);const failed=listWeeklyJobs(f.host)[0];assert.equal(failed.status,'output_archive_failed');assert.ok(failed.output.text.includes('SYNTHETIC'));assert.equal(f.calls.inference.length,1);
 await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model});assert.equal(listWeeklyJobs(f.host)[0].status,'sealed');assert.equal(f.calls.inference.length,1);assert.equal(f.engine.fills.length,0);
 const g=fixture();await queueOne(g);let fail=true;const inspect=g.host.artifacts.inspect;g.host.artifacts.inspect=async(ref,s)=>{if(fail){fail=false;throw Error('synthetic client inspection unknown');}return inspect(ref,s);};await assert.rejects(drainWeeklyQueue(g.host,g.service,{authorizeGeneration:true,model:g.model}),/inspection unknown/);assert.equal(listWeeklyJobs(g.host)[0].status,'publish_failed');await drainWeeklyQueue(g.host,g.service,{authorizeGeneration:true,model:g.model});assert.equal(g.calls.inference.length,1);assert.equal([...g.artifacts.values()].filter(x=>x.ref.kind==='report').length,1);
});

test('Agent path requires complete-output collector; cancellation cancels existing task, no second paid submit',async()=>{
 const f=fixture();await queueOne(f);await assert.rejects(drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model,transport:'agents'}),err('FULL_AGENT_OUTPUT_REQUIRED'));assert.equal(f.calls.agent.length,0);
 const controller=new AbortController();let cancels=0;f.host.agents.wait=async()=>{controller.abort();throw Error('fixture cancel');};f.host.agents.cancel=async()=>{cancels++;return {status:'cancelled'};};
 await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model,transport:'agents',collectFullAgentOutput:async()=>({complete:true,output:'SYNTHETIC',artifactRefs:[]})},controller.signal);assert.equal(listWeeklyJobs(f.host)[0].status,'cancelled');assert.equal(cancels,1);assert.equal(f.calls.agent.length,1);assert.equal(f.calls.agent[0].tools.length,0);
});

test('report HTML uses Sesame reportKit + track fixed bindings and full textContent, not future service or fake receipt',()=>{
 const html=weeklyReportHTML();assert.match(html,/reportKit\.render/);assert.match(html,/window\.report\.track/);assert.match(html,/reportKit\.rows\('weekly'\)/);assert.match(html,/reportKit\.rows\('agent-output'\)/);assert.match(html,/textContent=output\.text/);assert.equal(html.includes('http://localhost'),false);
 for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Function(script[1]));
});

test('publication archive lost reply retains stable inspection receipt, retries archive without another model or inspect',async()=>{
 const f=fixture();await queueOne(f);const archive=f.service.archiveFileSafe;let once=true,inspects=0;f.host.artifacts.inspect=async ref=>({status:'pending',classification:'synthetic receipt',seq:++inspects,ref});f.service.archiveFileSafe=async(path,text)=>{const result=await archive(path,text);if(once&&path.endsWith('/publication.json')){once=false;throw Error('synthetic publication archive lost reply');}return result;};
 await assert.rejects(drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model}),/lost reply/);const saved=listWeeklyJobs(f.host)[0];assert.equal(saved.status,'publish_failed');assert.equal(saved.publication.receipt.seq,1);await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model});assert.equal(inspects,1);assert.equal(f.calls.inference.length,1);const archives=f.calls.archives.filter(x=>x.path.endsWith('/publication.json'));assert.equal(archives[0].text,archives[1].text);
});

test('optional Agent-authored presentation is frozen, keeps mandatory fixed data/output bindings and exact assets',async()=>{
 const f=fixture();const job=await queueOne(f);let renderCount=0;const renderWeeklyHTML=async(input,output)=>{renderCount++;assert.deepEqual(input,job.input);assert.match(output.text,/SYNTHETIC/);return {html:'<!doctype html><html lang="zh-CN"><head><link rel="stylesheet" href="local.css"></head><body><main id="report"></main><script>window.report.track(async()=>{const d=await window.report.readData("weekly");document.getElementById("report").textContent=JSON.stringify(d.rows);});</script></body></html>',assets:[{path:'local.css',mediaType:'text/css',content:'/* synthetic custom asset, no external network */ main{color:var(--foreground)}'}]};};
 await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model,renderWeeklyHTML});const sealed=listWeeklyJobs(f.host)[0];assert.equal(sealed.authoredPresentation.assets[0].path,'local.css');assert.equal(renderCount,1);const report=[...f.artifacts.values()].find(x=>x.ref.kind==='report');assert.ok(report.request.manifest.blobs.some(b=>b.path==='local.css'));assert.deepEqual(report.request.manifest.content.data.map(b=>b.id),['weekly','agent-output']);await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model,renderWeeklyHTML});assert.equal(renderCount,1);assert.ok(f.calls.archives.some(x=>x.path.endsWith('/assets/local.css')));
});

test('native weekly receipt receiver uses actual-shaped public receipts, no opener requirement; immutable historical binding, inspector is not native',async()=>{
 const {consumeNativeWeeklyReports}=await import('../weekly-reports.js');const f=fixture();await queueOne(f);await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,model:f.model});f.host.storage.put('round2-presentation',{id:f.engine.id,runId:f.engine.id,commitVersion:2,cutoffMs:MON,bars:[]});
 const pending=await consumeNativeWeeklyReports(f.host,f.service);assert.equal(pending.items[0].status,'pending');assert.match(pending.items[0].diagnostic,/receipts unavailable/);let opens=0;const options={openNativeReport:async()=>{opens++;throw Error('No public opener exists');}};
 const job=listWeeklyJobs(f.host)[0],receipt={artifact:job.reportRef,renderer:{name:'sesame-report-inspector',version:'1.0.0'},status:'rendered',observedAt:1,viewInstanceId:'fixture-inspector',diagnostics:[]};
 f.host.artifacts.receipts=async ref=>{assert.deepEqual(ref,job.reportRef);return [receipt];};assert.equal((await consumeNativeWeeklyReports(f.host,f.service,options)).items[0].status,'pending');
 receipt.renderer.name='sesame-report';const ready=await consumeNativeWeeklyReports(f.host,f.service,options);assert.equal(ready.items[0].status,'opened');assert.deepEqual(ready.items[0].receipt.raw,[receipt]);assert.equal(ready.items[0].receipt.derivedBinding.period.toMs,MON);assert.equal(ready.items[0].receipt.nativeVisibility.status,'pending');await consumeNativeWeeklyReports(f.host,f.service,options);assert.equal(opens,0);
 // Old frozen report can be confirmed after a later frontier: source/period
 // remains that exact immutable report, not later current market data.
 f.host.storage.put('round2-presentation',{id:f.engine.id,cutoffMs:MON+1});assert.equal((await consumeNativeWeeklyReports(f.host,f.service,options)).items[0].synchronized,false);
});

test('CORE bounded stop freezes honest UTC final partial segment, not a completed week/chapter; duplicate stop no generation',async()=>{
 const {onExperiencePartialBoundary}=await import('../weekly-reports.js'),f=fixture();const opening={engine:structuredClone(f.engine),runId:f.engine.id,chapter:0,replayCutoffMs:T,account:context(f,T).account,market:{runId:f.engine.id,commitVersion:1,cutoffMs:T,bars:[],sources:[]}};
 const close={engine:structuredClone(f.engine),runId:f.engine.id,chapter:0,replayCutoffMs:T+H,account:context(f,T+H).account,market:{runId:f.engine.id,commitVersion:1,cutoffMs:T+H,bars:[],sources:[]},openingContext:opening};await onWeeklyBoundary(f.host,f.service,close);const result=await onExperiencePartialBoundary(f.host,f.service,{...close,experiencePartial:true});assert.equal(result.status,'partial_queued');const j=listWeeklyJobs(f.host)[0];assert.equal(j.input.period.kind,'bounded_partial');assert.equal(j.input.period.toMs,T+H);assert.equal(j.input.experience.chapterComplete,false);assert.equal((await onExperiencePartialBoundary(f.host,f.service,{...close,experiencePartial:true})).status,'empty_or_already_queued');assert.equal(f.calls.inference.length,0);
});

test('full frozen evidence larger than40KB generates bounded agents/inference synopsis, no entire engine, financial facts and full-output preserved',async()=>{
 const {weeklyGenerationInput}=await import('../weekly-reports.js');const f=fixture();await onWeeklyBoundary(f.host,f.service,context(f,T));f.engine.version=2;f.engine.decisions=[{executionTime:T+H,decision:{id:'role1',target:'0',reason:'hold'},fullActorArchive:'SYNTHETIC DATA '.repeat(14000)}];await onWeeklyBoundary(f.host,f.service,context(f,MON));const j=listWeeklyJobs(f.host)[0];assert.ok(JSON.stringify(j.input).length>40000);const compact=weeklyGenerationInput(j);assert.ok(Buffer.byteLength(JSON.stringify(compact))<28000);assert.deepEqual(compact.financial,j.input.financial);assert.equal(compact.fullEvidenceRef.digest,j.inputRef.digest);assert.equal(JSON.stringify(compact).includes('fullActorArchive'),false);
 await drainWeeklyQueue(f.host,f.service,{authorizeGeneration:true,transport:'agents',model:f.model,collectFullAgentOutput:async()=>({complete:true,output:{text:'SYNTHETIC COMPLETE AGENT OUTPUT'},artifactRefs:[]})});assert.ok(Buffer.byteLength(JSON.stringify(f.calls.agent[0]))<40000);assert.equal(f.calls.agent[0].input.evidenceMode,compact.evidenceMode);assert.equal(listWeeklyJobs(f.host)[0].status,'sealed');
});

test('Monday first fill/fee cannot be backfilled into closing UTC week even with matching balance',async()=>{
 const f=fixture();await onWeeklyBoundary(f.host,f.service,context(f,T));const row={id:'monday',chapter:0,time:MON,type:'fill',commission:'3',realizedJpy:'0',financing:'0',balanceAfter:'299997'};f.engine.version=2;f.engine.balance='299997';f.engine.ledger=[row];f.engine.fills=[{...row,signedQuantity:'1000',price:'100'}];await assert.rejects(onWeeklyBoundary(f.host,f.service,context(f,MON)),err('BOUNDARY_SNAPSHOT_REQUIRED'));assert.equal(listWeeklyJobs(f.host).length,0);
});
