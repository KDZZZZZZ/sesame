import test from 'node:test';
import assert from 'node:assert/strict';
import { writeDailyReport } from '../packages/manual-trading/reports.js';
import { resourceFixture } from '../../api-v1/tests/mt5-resource-fixture.js';

function fixture() {
 const host={context:{pluginId:'sesame/manual-trading',pluginVersion:'test',pluginRevision:'sha256:fixture'}}, resources=resourceFixture(host);
 const run={id:'run',planId:'plan',plan:{id:'plan',title:'Observed account fixture',account:{accountId:'fixture'}},status:'failed',createdAt:1,completedAt:2,tasks:[],reports:[],error:{code:'OBSERVED',message:'Observed failure'}};
 return {host,run,...resources};
}
test('a failed publication retries the same frozen evidence after later checkpoint changes',async()=>{
 const f=fixture(),create=f.host.resources.create;let failed=false;
 f.host.resources.create=async(input,options)=>{if(input.name==='report.html'&&!failed){failed=true;throw new Error('Fixture write interrupted');}return create(input,options);};
 const onSnapshot=value=>{f.run.reportSnapshot=value;};
 await assert.rejects(writeDailyReport(f.host,f.run,{onSnapshot}),/Fixture write interrupted/);
 const frozen=structuredClone(f.run.reportSnapshot);f.run.error.message='Later diagnostic';
 const report=await writeDailyReport(f.host,f.run,{onSnapshot});
 const content=JSON.parse((await f.host.resources.read(report.ref,{part:'content',entry:'run.json'})).content);
 assert.deepEqual(content,frozen);assert.equal(f.artifacts.size,1);assert.equal(f.managed.size,3);
});
test('one report artifact contains escaped HTML and immutable evidence without recursive bookkeeping',async()=>{
 const f=fixture();f.run.reports=[{role:'manager',text:'<script>unsafe()</script>'}];f.run.workflow={id:'controller'};f.run.consumedOutputs=['source:target'];
 const report=await writeDailyReport(f.host,f.run);const manifest=await f.host.resources.read(report.ref,{part:'manifest'});
 assert.equal(manifest.kind,'report');assert.deepEqual(manifest.blobs.map(blob=>blob.path),['run.json','report.html']);
 const snapshot=JSON.parse((await f.host.resources.read(report.ref,{part:'content',entry:'run.json'})).content);
 assert.equal(snapshot.workflow,undefined);assert.equal(snapshot.reportSnapshot,undefined);assert.equal(snapshot.consumedOutputs,undefined);
 const html=(await f.host.resources.read(report.ref,{part:'content',entry:'report.html'})).content;assert.ok(html.includes('&lt;script&gt;unsafe()&lt;/script&gt;'));
 f.run.report=report;f.host.resources.create=()=>assert.fail('Reading a delivered report must not create files');f.host.resources.publish=()=>assert.fail('Reading a delivered report must not republish');
 assert.deepEqual(await writeDailyReport(f.host,f.run),report);
});
