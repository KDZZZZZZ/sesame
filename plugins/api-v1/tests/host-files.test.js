import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Check } from '@sesame/plugin-sdk/schema/value';
import { createCapabilities } from '../packages/workspace/host-files.js';
import { resourceHost } from './core-v2-fixture.mjs';

test('host file capabilities are explicitly declared and import immutable actual bytes', async t => {
 const root=await mkdtemp(join(tmpdir(),'host-file-v2-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=resourceHost({workspaceRoot:root,filePolicy:{protectedRoots:[],readRoots:[root],writeRoots:[root]}}), tools=createCapabilities(f.host);
 const declarations=JSON.parse(await readFile(new URL('../packages/workspace/capabilities.json',import.meta.url),'utf8')).capabilities.filter(c=>c.id.startsWith('host_files_'));
 assert.deepEqual(tools.map(t=>t.name).sort(),declarations.map(c=>c.id).sort());assert.equal(tools.length,9);
 const source=join(root,'source.txt');await writeFile(source,'actual imported bytes');
 const result=await tools.find(t=>t.name==='host_files_import').execute({path:source});await writeFile(source,'changed later');
 assert.equal((await f.host.resources.read(result.ref,{part:'content'})).content,'actual imported bytes');assert.equal(result.provenance.bytes,21);
 const remove=declarations.find(c=>c.id==='host_files_remove').inputSchema;assert.equal(Check(remove,{path:source,recursive:true}),false);
});
test('argv including empty arguments, cwd, environment and cancellation route through process Run',async()=>{
 const calls=[],signal=new AbortController().signal,host={context:{filePolicy:{protectedRoots:[],readRoots:[],writeRoots:[tmpdir()]}},capabilities:{invoke:async(...args)=>{calls.push(args);return{type:'run',run:{id:'run-1'}};}},runs:{wait:async()=>({reason:'settled',run:{id:'run-1',status:'completed',output:{exitCode:0,output:'actual'}}})}};
 const argv=['python','-c','print("literal $value")',''], input={argv,cwd:tmpdir(),timeout:3,env:{FIXTURE:'value'}};
 const result=await createCapabilities(host).find(t=>t.name==='host_files_run').execute(input,signal);
 assert.deepEqual(calls[0][1],{argv,cwd:await realpath(tmpdir()),timeoutMs:3000,env:input.env});assert.equal(calls[0][2].signal,signal);assert.equal(result.run.id,'run-1');
});
