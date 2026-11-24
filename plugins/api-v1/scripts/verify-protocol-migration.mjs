import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPackageDirectory} from '../../protocol/directory.mjs';

// Freeze the last committed public source before the protocol migration. The
// November 21 orchestration prototype in the working tree was never a release.
const baseline='e652bed561a83deb7649ba1be8fb165bbfec686c';
const root=process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../../../',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
const declaration=(dir,file)=>JSON.parse(git('show',baseline+':'+dir+'/'+file));
const rename=path=>path==='prompt.md'?'instructions.md':path;
const without=(obj,names)=>Object.fromEntries(Object.entries(obj).filter(([key])=>!names.includes(key)));
const ids=new Set();
let toolCount=0,hostCount=0;
for (const profile of ['api-v1','optional-api-v1']) {
  const source='plugins/'+profile+'/packages/';
  const names=git('ls-tree','--name-only',baseline+':'+source.slice(0,-1)).trim().split('\n');
  const current=readdirSync(join(root,source)).filter(name=>name!=='plugin-optimizer').sort();
  assert.deepEqual(current,names.sort(),profile+' migrated set');
  for(const name of names) {
    const dir=source+name, previous=declaration(dir,'plugin.json'), old=declaration(dir,'capabilities.json');
    const pkg=readPackageDirectory(join(root,dir));
    assert.equal(pkg.manifest.id,previous.id);
    assert.ok(!ids.has(previous.id),'Duplicate '+previous.id); ids.add(previous.id);
    toolCount+=pkg.tools.length;
    hostCount+=pkg.capabilities.capabilities.filter(cap=>!cap.consumers.includes('agent')).length;
    if(name==='orchestration') {
      assert.deepEqual(pkg.tools.map(tool=>tool.name).sort(),['workflow_plan','workflow_status','workflow_step']);
      assert.deepEqual(pkg.manifest.permissions,{scopes:['workflows.navigate'],calls:[]});
      assert.deepEqual(pkg.capabilities.stateCollections,[]);
      continue;
    }
    const workflow=['auto-factor-mining','strategy-development'].includes(name);
    const expectedManifest={...previous,prompts:[...new Set([...(previous.prompts??[]),...old.knowledge.filter(k=>k.kind==='prompt').map(k=>k.path)].map(rename))]};
    assert.deepEqual(without(pkg.manifest,workflow?['description']:[]),without(expectedManifest,workflow?['description']:[]),previous.id+' manifest');
    const expectedKnowledge=old.knowledge.filter(k=>!(workflow && k.path==='references/workflow.yaml')).map(k=>({...k,path:rename(k.path)}));
    const expected={...old,knowledge:expectedKnowledge};
    if(name==='financial-research') {
      for (const id of ['financial_research_status','financial_research_configure']) {
        const before=expected.capabilities.find(cap=>cap.id===id);
        const after=pkg.capabilities.capabilities.find(cap=>cap.id===id);
        assert.equal(after.outputSchema.properties.plugin_id.const,previous.id);
        assert.deepEqual(Object.values(after.outputSchema.properties.credentials.properties).map(schema=>schema.type),Array(5).fill('boolean'));
        before.outputSchema=after.outputSchema;
      }
    }
    assert.deepEqual(pkg.capabilities,expected,previous.id+' bindings, schemas, permissions and contributions');
    if(workflow) assert.ok(pkg.workflows.length,previous.id+' requires a workflow definition');
  }
}
assert.equal(ids.size,59);
assert.equal(toolCount,293);
assert.equal(hostCount,127);
console.log(JSON.stringify({baseline,migratedPackages:ids.size,publicTools:toolCount,hostOnly:hostCount}));
