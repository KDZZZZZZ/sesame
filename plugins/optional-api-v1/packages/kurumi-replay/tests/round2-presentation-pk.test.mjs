import test from'node:test';import assert from'node:assert/strict';
import {onReplayCommitted,onPKBoundary,consumePKCommentary,generatePKCommentary,recoverPKArchives,reconcilePKNativeDelivery,readConsumedView}from'../replay-presentation.js';
import {fixture,T,H}from'./round2-presentation-fixtures.test.mjs';
function c(f,extra={}){const before={...structuredClone(f.engine),version:1};f.engine={...f.engine,version:2};return {engine:structuredClone(f.engine),previousEngine:before,runId:f.engine.id,replayCutoffMs:T+H,consumedTicks:f.batch({commitVersion:2,cutoffMs:T+H,intervalComplete:true}),chapter:0,decisionBoundary:true,account:{engineVersion:2,asOfMs:T+H,balance:'300000',equity:'300000',margin:'0',freeMargin:'300000',unrealizedJpy:'0'},...extra};}
async function pk(f,extra={}){const ctx=c(f,extra);await onReplayCommitted(f.host,f.service,ctx);const job=await onPKBoundary(f.host,f.service,ctx);return {ctx,job};}

test('PK hook fixed asof goal pressure with claim refs; no per-tick model, duplicate H1 one job, original future refused',async()=>{
 const f=fixture(),{ctx,job}=await pk(f);const j=f.host.storage.get('round2-pk',job.id);assert.equal(j.input.asOf.unixMs,readConsumedView(f.host,f.engine.id).cutoffMs);assert.equal(j.input.account.asOfMs,j.input.asOf.unixMs);assert.equal(j.input.goal.initialTargetFactor,'66.66666666');assert.equal(j.input.goal.remainingJPY,'19700000');assert.match(j.text,/约66.7倍/);assert.match(j.text,/A1/);assert.match(j.text,/没有新成交/);assert.equal(f.calls.inference.length,0);assert.equal(f.calls.agent.length,0);assert.equal((await onPKBoundary(f.host,f.service,ctx)).duplicate,true);assert.equal(f.host.storage.list('round2-pk').length,1);
 const forming={...ctx,previousEngine:ctx.engine};assert.equal((await onPKBoundary(f.host,f.service,forming)).status,'skipped');
 const g=fixture(),x=c(g,{originalComparison:[{knownAt:{unixMs:T+H+1},text:'FUTURE'}]});await onReplayCommitted(g.host,g.service,x);await assert.rejects(onPKBoundary(g.host,g.service,x),{code:'FUTURE_DATA_FORBIDDEN'});
});

test('PK account/price mismatch rejected; cap keeps input but skips commentary instead of per-tick generation',async()=>{
 const f=fixture(),ctx=c(f);await onReplayCommitted(f.host,f.service,ctx);await assert.rejects(onPKBoundary(f.host,f.service,{...ctx,account:{...ctx.account,asOfMs:T+H+1}}),{code:'SOURCE_MISMATCH'});
 f.host.storage.put('round2-pk',{id:'pk_prior',runId:f.engine.id,chapter:0,revision:1,status:'ready'});const capped=await onPKBoundary(f.host,f.service,{...ctx,maxCommentariesPerChapter:1});assert.equal(capped.status,'cadence_capped');assert.ok(f.host.storage.get('round2-pk',capped.id).input);assert.equal(f.calls.inference.length,0);
});

test('PK full input/output archive failure retains todo; restart never resubmits an unknown narrator',async()=>{
 const f=fixture(),ctx=c(f);await onReplayCommitted(f.host,f.service,ctx);const archive=f.service.archiveFileSafe;let fail=true;f.service.archiveFileSafe=async(...a)=>{if(fail){fail=false;throw Error('synthetic PK archive failure');}return archive(...a);};await assert.rejects(onPKBoundary(f.host,f.service,ctx),/archive failure/);const retry=await onPKBoundary(f.host,f.service,ctx);assert.equal(retry.status,'ready');
 await assert.rejects(generatePKCommentary(f.host,f.service,retry.id,{}),{code:'GENERATION_NOT_AUTHORIZED'});f.host.inference.complete=async r=>{f.calls.inference.push(r);throw Error('synthetic unknown narrator reply');};await assert.rejects(generatePKCommentary(f.host,f.service,retry.id,{authorizeGeneration:true,model:f.model}),{code:'NATIVE_MAIN_REPLY_REQUIRED'});const saved=f.host.storage.get('round2-pk',retry.id);f.host.storage.put('round2-pk',{...saved,status:'generating'});await recoverPKArchives(f.host,f.service);assert.equal(f.calls.inference.length,0);assert.equal(f.host.storage.get('round2-pk',retry.id).status,'unknown');
});

test('main native-chat consumer pending without public delivery/verifier; synthetic adapter once-only and unknown evidence-only recovery',async()=>{
 const f=fixture(),{job}=await pk(f);const pending=await consumePKCommentary(f.host,f.service);assert.equal(pending.items[0].status,'pending');assert.match(pending.items[0].diagnostic,/no private session/);
 let calls=0;const options={deliverNativeChat:async packet=>{calls++;assert.equal(packet.asOf.unixMs,T+H);return {classification:'SYNTHETIC NO REAL CHAT',packet};},verifyNativeChatReceipt:async(raw,expected)=>({status:'displayed',evidence:{classification:'synthetic-fixture-only',expected}})};await consumePKCommentary(f.host,f.service,options);await consumePKCommentary(f.host,f.service,options);assert.equal(calls,1);
 const g=fixture(),x=await pk(g);let attempts=0;await assert.rejects(consumePKCommentary(g.host,g.service,{deliverNativeChat:async()=>{attempts++;throw Error('synthetic lost chat reply');},verifyNativeChatReceipt:options.verifyNativeChatReceipt}),/lost chat/);await consumePKCommentary(g.host,g.service,options);assert.equal(attempts,1);const j=g.host.storage.get('round2-pk',x.job.id);await reconcilePKNativeDelivery(g.host,j.id,j.revision,{classification:'synthetic'},options.verifyNativeChatReceipt);assert.equal(g.host.storage.get('round2-pk',j.id).deliveryStatus,'displayed');
});

test('separate narrator inference disabled: use actual main normal response public read/ack, never pay an additional model',async()=>{
 const f=fixture(),{job}=await pk(f);await assert.rejects(generatePKCommentary(f.host,f.service,job.id,{authorizeGeneration:true,model:f.model}),{code:'NATIVE_MAIN_REPLY_REQUIRED'});assert.equal(f.calls.inference.length,0);assert.equal(f.calls.agent.length,0);assert.equal(f.host.storage.get('round2-pk',job.id).status,'ready');
});

test('normal main public claim/full-output/actual ack survives duplicate pause-resume; background summary or missing verifier is not delivery',async()=>{
 const {claimPKNativeReply,recordPKNativeReply,acknowledgePKNativeReply}=await import('../replay-presentation.js');const f=fixture(),{job}=await pk(f);const claim=claimPKNativeReply(f.host,f.service,job.id,{claimId:'stable-main-consumer'});assert.deepEqual(claimPKNativeReply(f.host,f.service,job.id,{claimId:'stable-main-consumer'}),claim);assert.throws(()=>claimPKNativeReply(f.host,f.service,job.id,{claimId:'other'}),{code:'RECONCILIATION_REQUIRED'});
 const out=await recordPKNativeReply(f.host,f.service,job.id,{token:claim.token,text:claim.text});assert.ok(out.ref);assert.equal((await recordPKNativeReply(f.host,f.service,job.id,{token:claim.token,text:claim.text})).ref.id,out.ref.id);await assert.rejects(acknowledgePKNativeReply(f.host,f.service,job.id,{token:claim.token,rawReceipt:{summary:'background'}}),{code:'NATIVE_CHAT_PENDING'});
 let ack=0;const x={token:claim.token,rawReceipt:{classification:'synthetic no actual main message'},verifyNativeMessage:async(raw,e)=>{ack++;assert.equal(e.outputRef.id,out.ref.id);return {status:'displayed',evidence:{classification:'SYNTHETIC fixture NOT actual native receipt',expected:e}};}};await acknowledgePKNativeReply(f.host,f.service,job.id,x);await acknowledgePKNativeReply(f.host,f.service,job.id,x);assert.equal(ack,1);assert.equal(f.calls.agent.length+f.calls.inference.length,0);
});
