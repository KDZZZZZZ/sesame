/** Opt-in actual Sesame API1 installation/storage test; never uses native QMT. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createService} from '../packages/qmt/service.js';
const root=process.env.SESAME_HOST_ROOT;
test('actual HostContext installs seven QMT tools and preserves unknown trade intent across Runtime restart without replay', {skip:!root,timeout:60000},async()=>{
  const {Store}=await import(pathToFileURL(join(root,'modules/agent/store.js')));
  const {Runtime}=await import(pathToFileURL(join(root,'modules/agent/runtime.js')));
  const {createHostContext}=await import(pathToFileURL(join(root,'modules/plugins/context.js')));
  const dir=await mkdtemp(join(tmpdir(),'qmt-host-restart-'));let store,runtime,service;
  const open=async()=>{store=new Store(join(dir,'app'));runtime=new Runtime(store,{piDir:join(dir,'pi'),officialPluginsDirectory:join(dir,'empty')});await runtime.init()};
  const close=async()=>{await service?.dispose();service=null;await runtime?.close();runtime=null;store?.close();store=null};
  try{
    await open();const draft=join(runtime.workspaces.root('conv_main'),'draft');await cp(fileURLToPath(new URL('../packages/qmt',import.meta.url)),draft,{recursive:true});
    const checked=await runtime.plugins.manager.test('conv_main',{path:draft});assert.equal(checked.passed,true,JSON.stringify(checked));
    const installed=await runtime.plugins.manager.install('conv_main',{path:draft,digest:checked.digest});assert.equal(installed.runtime_status,'ready');runtime.plugins.activate('conv_main',installed.id);
    const host=createHostContext(runtime,runtime.plugins.entry('sesame/qmt'),'conv_main');assert.equal(host.scope.kind,'main');
    assert.equal(runtime.plugins.definitions({conversationId:'conv_main'}).filter(x=>x.name.startsWith('qmt_')).length,7);
    host.storage.put('configuration',{id:'local',version:2,connection_id:'fixture',python_path:join(dir,'nonexecuted-python'),account_id:'00123',userdata_directory:dir});
    const args={operation_id:'durable-unknown',user_authorized:true,account_id:'00123',connection_revision:'2',symbol:'600000.SH',side:'buy',shares:'100',price:'10'};let calls=0;
    service=createService(host,{platform:'win32',request:async()=>{calls++;throw Object.assign(Error('Injected transport outcome unknown'),{code:'SOURCE_UNAVAILABLE'})}});
    await assert.rejects(service.command('order',args),{code:'SOURCE_UNAVAILABLE'});assert.equal(calls,1);assert.equal(host.storage.get('qmt_commands',args.operation_id).status,'outcome_unknown');
    await close();await open();const restored=createHostContext(runtime,runtime.plugins.entry('sesame/qmt'),'conv_main');
    service=createService(restored,{platform:'win32',request:async()=>{calls++;throw Error('Must not replay native command')}});
    assert.equal((await service.command('order',args)).status,'outcome_unknown');assert.equal(calls,1);
    assert.equal(service.commandRecord(args.operation_id,{kind:'main'}).status,'outcome_unknown');assert.equal(calls,1);
    assert.equal(runtime.plugins.entry('sesame/qmt').runtime_status,'ready');
  }finally{await close();await rm(dir,{recursive:true,force:true})}
});
