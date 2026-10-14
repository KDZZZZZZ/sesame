// Read-only frozen observed quote COPY, isolated Python process/cache/cwd.
// Synthetic fixed decision on 2361 USDJPY quotes; NOT host, roles, OOS or performance evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun,decideAndAdvance,snapshot } from '../native-engine.js';
import { ROUND2_PROFILE_ID,sha256 } from '../experiment-profiles.js';
const root=dirname(fileURLToPath(new URL('../package.json',import.meta.url)));
const source=process.env.KURUMI_CORE_TEST_QUOTES;
const digest='sha256:010bc1d3e5232f51220a23ce9c4fc1f812b3c5e01525d4d5a4063c9f0ed0dafd';
const python=process.env.KURUMI_CORE_TEST_PYTHON;
assert.ok(python&&source,'Explicit KURUMI_CORE_TEST_PYTHON and KURUMI_CORE_TEST_QUOTES required; no author paths');
test('real frozen USDJPY copy: native50 margin and snapshot agree, original bytes unchanged',async()=>{
 const directory=await fs.mkdtemp(join(root,'.round2-core-realcopy-evidence-')),bytes=await fs.readFile(source);assert.equal(sha256(bytes),digest);await fs.writeFile(join(directory,'observed-quotes.json'),bytes,{flag:'wx'});
 const rows=JSON.parse(await fs.readFile(join(directory,'observed-quotes.json')));assert.equal(rows.length,2361);assert.ok(rows.every(r=>r.source.endsWith('USDJPY-20141205T1900.bi5')));
 const H=3600000,from=Math.floor(rows[0].time/H)*H,f=[{time:from-H},{time:from},{time:from+H}],s=createRun('kurumi-00000000-0000-0000-0000-000000000004',['USDJPY','AUDJPY','EURCHF'].map(symbol=>({symbol,startIndex:0,endIndex:2})),{frozenCopy:digest},{profileId:ROUND2_PROFILE_ID});
 const decision={id:'fixed-real-copy-fixture',runId:s.id,stepId:s.id+':0:0',expectedVersion:1,target:'100000',stop:null,reason:'New50x margin acceptance on copied real quote rows',utterance:'固定决定fixture，无角色/模型'};
 const invokeImpl=async request=>{await fs.writeFile(join(directory,'stdin.json'),JSON.stringify(request),{flag:'wx'});return new Promise((resolve,reject)=>{let out='',err='';const c=spawn(python,[join(root,'native-engine.py')],{cwd:directory,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe']});c.stdout.setEncoding('utf8');c.stderr.setEncoding('utf8');c.stdout.on('data',x=>out+=x);c.stderr.on('data',x=>err+=x);c.on('error',reject);c.on('close',async code=>{try{await fs.writeFile(join(directory,'stdout.json'),out,{flag:'wx'});await fs.writeFile(join(directory,'stderr.log'),err,{flag:'wx'});const r=JSON.parse(out);if(code||!r.ok)throw Object.assign(Error(r.message),{code:r.code});resolve(r.state);}catch(e){reject(e);}});c.stdin.end(JSON.stringify(request));});};
 const next=await decideAndAdvance(s,decision,f,{invokeImpl,quoteTicks:rows,coverage:{from,to:from+H,complete:true,dataKind:'quote_ticks',liquidityAssumption:'unbounded_top_of_book',sources:[{path:source,digest,classification:'frozen observed copy'}]}}),account=snapshot(next,f[1]);
 assert.equal(next.nativeReceipt.processedQuotes,2361);assert.equal(account.margin,'242818');assert.equal(next.equity.at(-1).margin,account.margin);assert.equal(account.leverage,'50');assert.equal(account.balance,'299700');assert.equal(account.unrealizedJpy,'-6100');assert.equal(account.equity,'293600');assert.equal(account.freeMargin,'50782');assert.equal(sha256(await fs.readFile(source)),digest);
 const receipt={classification:'real_quote_copy_native50_with_fixed_fixture_decision',source,digest,rows:2361,from,toExclusive:from+H,margin:account.margin,equity:account.equity,fees:next.fills[0].commission,realHostPassed:false,evidence:directory};await fs.writeFile(join(directory,'receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify(receipt));
});
