// Opt-in read-only broker-data/native Tester acceptance. It never mounts an EA.
// Inputs are explicit local receipts/configuration; credentials are never logged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installation } from '../../optional-api-v1/packages/mt5/backend/native.js';
import { Tester } from '../../optional-api-v1/packages/mt5/backend/tester.js';
import { MT5MCP } from '../../optional-api-v1/packages/mt5/backend/mcp.js';

test('native Tester loads frozen EX5 from short owned runner and collects real SDK output', {skip:process.env.MT5AGENT_NATIVE_TESTER_TESTS!=='1',timeout:300000},async t=>{
  for(const key of ['SESAME_TESTER_PASS_JSON','SESAME_TESTER_CONNECTION_JSON','SESAME_TESTER_EX5'])assert.ok(process.env[key],`${key} must point to an explicit local acceptance input`);
  const directory=await fs.mkdtemp(join(tmpdir(),'sesame-tester-test-'));
  const native=installation();assert.ok(native);
  if(process.env.SESAME_TESTER_CACHE_DIRECTORY)native.dataDirectory=process.env.SESAME_TESTER_CACHE_DIRECTORY;
  const pass=JSON.parse(await fs.readFile(process.env.SESAME_TESTER_PASS_JSON,'utf8'));
  pass.id='pass_test_'+crypto.randomUUID();delete pass.owner_run_id;delete pass.temporary_paths;pass.status='queued';
  const config=JSON.parse(await fs.readFile(process.env.SESAME_TESTER_CONNECTION_JSON,'utf8'));
  const client=new MT5MCP({...config.servers.terminal,server:'terminal'}),rows=new Map([[pass.id,pass]]),datasets=[];
  const secrets=[config.account.password,...Object.values(config.servers).map(v=>v.token)].filter(Boolean);
  const redact=value=>secrets.reduce((text,secret)=>text.split(secret).join('[redacted]'),value);
  const storage={directory,get:(_kind,id)=>structuredClone(rows.get(id)),put:(_kind,row)=>{rows.set(row.id,structuredClone(row));return row},transaction:fn=>fn()};
  const target=join(directory,'mt5/builds',pass.build_id,'Experts');await fs.mkdir(target,{recursive:true});await fs.copyFile(process.env.SESAME_TESTER_EX5,join(target,'Strategy.ex5'));
  const tester=new Tester({native,storage,official:{config,client:()=>client,redact},host:{datasets:{register:value=>datasets.push(value)}}});
  let preserve=false;
  t.after(async()=>{client.close();if(!preserve)await fs.rm(directory,{recursive:true,force:true});});
  try { await tester.execute(pass,AbortSignal.timeout(240000)); } catch(error) { preserve=error.code==='runtime_cleanup_failed'; throw error; }
  const result=rows.get(pass.id);assert.equal(result.status,'succeeded');assert.equal(result.process_cleanup.confirmed,true);assert.equal(result.process_cleanup.activeProcesses,0);assert.equal(result.native_paths.before.digest,pass.artifact_digest);assert.equal(result.native_paths.after.digest,pass.artifact_digest);assert.ok(result.native_paths.expertPathLength<240);assert.equal(result.actual_inputs.Product_RunId,pass.id);assert.notEqual(result.actual_inputs.Product_EnableLive,'true');assert.deepEqual(datasets.map(d=>d.role),['summary','equity','deals','trace']);await assert.rejects(fs.stat(result.temporary_paths.tester_runner),{code:'ENOENT'});
});
