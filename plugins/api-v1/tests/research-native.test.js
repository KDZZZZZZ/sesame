import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createCapabilities } from '../packages/data-access/research-tools.js';
import { digest } from '../packages/data-access/capture.js';
import { resourceHost } from './core-v2-fixture.mjs';

async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'research-v2-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=resourceHost({workspaceRoot:root}),input={id:'fixed',rows:[{value:'2'},{value:'3'}],provenance:{kind:'demo'}},executions=new Map();
 f.host.data={query:async request=>request.source.providerId==='host#executions'?{items:[executions.get(request.input.executionId)]}:{items:input.rows,metadata:{id:input.id,provenance:input.provenance}}};
 f.host.capabilities={invoke:async(id,args)=>{assert.equal(id,'sesame/workspace#write');const path=join(root,args.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,args.content);return{type:'result',value:{path}};}};
 const tools=new Map(createCapabilities(f.host).map(c=>[c.name,c.execute]));
 return{...f,root,input,executions,call:(name,args)=>tools.get(name)(args)};
}
test('data_read writes actual registered inputs to the execution directory',async t=>{
 const f=await fixture(t),result=await f.call('data_read',{datasetId:'fixed'});
 assert.equal(result.path,join(f.root,'inputs','fixed.json'));assert.deepEqual(JSON.parse(await readFile(result.path)),f.input.rows);assert.equal(result.rowCount,2);
});
test('research publishes frozen output and rejects changed input, absent recipe or escaped output',async t=>{
 const f=await fixture(t),path=join(f.root,'output.json');await writeFile(path,'[{"sum":999}]');
 const execution={id:'execution-1',conversation_id:'main',status:'completed',workspace_path:f.root,code:{'inputs/fixed.json':digest(JSON.stringify(f.input.rows))},source_files:{'compute.py':Buffer.from('sum(values)').toString('base64')},files:{'output.json':Buffer.from('[{"sum":5}]').toString('base64')}};
 f.executions.set(execution.id,execution);
 const args={operationId:'actual',executionId:execution.id,path,inputIds:['fixed'],recipePaths:['compute.py'],title:'Demo sum',description:'Frozen fixture'};
 const result=await f.call('research_register',args);assert.deepEqual(f.rows(result.ref),[{sum:5}]);assert.equal(result.provenance.kind,'demo');
 await assert.rejects(f.call('research_register',{...args,operationId:'escape',path:join(f.root,'..','outside.json')}),/inside the frozen/);
 await assert.rejects(f.call('research_register',{...args,operationId:'recipe',recipePaths:['not-frozen.py']}),/frozen execution/);
 f.input.rows[0].value='100';await assert.rejects(f.call('research_register',{...args,operationId:'changed'}),/exact registered/);
});
test('fixed DataRef inputs bind actual frozen bytes and become evidence dependencies',async t=>{
 const f=await fixture(t),raw=await f.host.resources.create({kind:'file',source:{content:'[{"x":"1.01"}]'}});
 const ref=(await f.host.resources.publish(raw,{kind:'data',schemaVersion:'1.0.0',content:{path:'rows.json',provenance:{kind:'observed'}},blobs:[{path:'rows.json'}]})).ref;
 const input=await f.call('data_read',{ref}),bytes=await readFile(input.path);
 f.executions.set('e',{id:'e',conversation_id:'main',status:'completed',workspace_path:f.root,code:{['inputs/'+ref.id+'.json']:digest(bytes)},files:{'out.json':Buffer.from('[{"answer":"2.02"}]').toString('base64')}});
 const result=await f.call('research_register',{operationId:'fixed-ref',executionId:'e',path:'out.json',inputRefs:[ref],title:'Result',description:'Exact input'});
 assert.deepEqual(f.artifacts.get(result.evidence.id).manifest.dependencies,[ref]);assert.deepEqual(f.rows(result.ref),[{answer:'2.02'}]);
});
