import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readPackageDirectory} from '../../protocol/directory.mjs';

const hostRoot=process.env.SESAME_HOST_ROOT;
test('all locked packages have the declared session surface and reject malformed calls before a business handler',{skip:!hostRoot,timeout:240000},async t=>{
  const load=name=>import(pathToFileURL(join(hostRoot,name)));
  const {Runtime}=await load('modules/agent/runtime.js'), {Store}=await load('modules/agent/store.js');
  const {createSessionMCP}=await load('modules/agent/plugin-system/mcp-server.js');
  const root=await mkdtemp(join(tmpdir(),'sesame-session-surface-')),bundle=join(root,'bundle');
  const plugins=fileURLToPath(new URL('../../',import.meta.url));
  const official=[];
  await mkdir(bundle);
  let store,runtime;
  t.after(async()=>{try {await runtime?.close();} finally {store?.close(); await rm(root,{recursive:true,force:true,maxRetries:4});}});
  for(const profile of ['api-v1','optional-api-v1']){
    const directory=join(plugins,profile);
    const lock=JSON.parse(await readFile(join(directory,'official-plugins.lock.json')));
    assert.ok(lock.packages.length,profile);
    for(const pkg of lock.packages){
      const src=join(directory,'packages',pkg.directory);
      for(const file of pkg.files) {
        const to=join(bundle,pkg.directory,file.path);
        await cp(join(src,file.path),to);
      }
      official.push(pkg);
    }
  }
  await writeFile(join(bundle,'official-plugins.lock.json'),JSON.stringify({schemaVersion:1,apiVersion:'2',channel:'development',packages:official}));
  store=new Store(join(root,'state'));
  runtime=new Runtime(store,{piDir:join(root,'empty-models'),officialPluginsDirectory:bundle});
  await runtime.init();
  const session=createSessionMCP(runtime,'conv_main'),meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
  let seq=0;
  const request=(method,params={})=>session({jsonrpc:'2.0',id:++seq,method,params:{...params,_meta:meta}});
  const visibleExpected=new Set(),hidden=new Set();
  for(const item of official){
    runtime.plugins.activate('conv_main',item.id);
    const entry=runtime.plugins.entry(item.id);
    assert.notEqual(entry.runtime_status,'failed',item.id);
    const declared=readPackageDirectory(join(bundle,item.directory)).capabilities.capabilities;
    for(const cap of declared){
      if(cap.consumers.includes('agent')) visibleExpected.add(cap.id);
      else hidden.add(item.id+'#'+cap.id);
    }
  }
  const listed=new Set();
  let cursor,pages=0;
  do {
    const response=await request('tools/list',cursor?{cursor}:{});
    assert.ok(response.result,JSON.stringify(response.error));
    for(const tool of response.result.tools){assert.ok(!listed.has(tool.name)); listed.add(tool.name);}
    cursor=response.result.nextCursor;pages++;
    assert.ok(pages<20,'pagination must terminate');
  } while(cursor);
  assert.ok(pages>=3);
  assert.deepEqual([...visibleExpected].filter(name=>!listed.has(name)),[]);
  assert.deepEqual([...hidden].map(id=>id.split('#')[1]).filter(name=>!visibleExpected.has(name) && listed.has(name)),[]);
  for(const item of official) {
    const entry=runtime.plugins.entry(item.id),tool=entry.protocolTools[0]?.name??'no_tool_in_knowledge_package';
    const response=await request('tools/call',{name:tool,arguments:[]});
    assert.equal(response.error?.data?.code,'tool_unavailable',item.id+': '+JSON.stringify(response));
  }
  t.diagnostic(JSON.stringify({packages:official.length,visible:visibleExpected.size,hostOnly:hidden.size,malformedCalls:official.length,pages}));
});
