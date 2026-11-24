import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,cp,rm,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

const hostRoot=process.env.SESAME_HOST_ROOT;
test('installed Kurumi pins its private recorder and reopens its original SQLite receipt after a host restart',{skip:!hostRoot,timeout:120000},async t=>{
  const load=name=>import(pathToFileURL(join(hostRoot,name)));
  const {Runtime}=await load('modules/agent/runtime.js'),{Store}=await load('modules/agent/store.js');
  const {createHostContextV2}=await load('modules/plugins/host-v2/context.js'), {invokeValue}=await load('modules/plugins/capabilities.js');
  const root=await realpath(await mkdtemp(join(tmpdir(),'kurumi-recording-host-')));
  const id='sesame/kurumi-replay',command='pin-private-fixture';
  let store,runtime;
  const open=async()=>{
    store=new Store(join(root,'state'));
    runtime=await new Runtime(store,{piDir:join(root,'pi'),officialPluginsDirectory:join(root,'empty')}).init();
    return createHostContextV2(runtime,runtime.capabilities.hostEntry,'conv_main');
  };
  const close=async()=>{await runtime?.close();runtime=null;store?.close();store=null;};
  t.after(async()=>{await close();await rm(root,{recursive:true,force:true,maxRetries:3});});
  let main=await open();
  const draft=join(runtime.workspaces.root('conv_main'),'kurumi');
  await cp(new URL('../packages/kurumi-replay/',import.meta.url),draft,{recursive:true,filter:path=>!path.includes('.core-sqlite-roundtrip')&&!path.includes('__pycache__')});
  await main.plugins.install({path:draft});
  const enable=()=>main.plugins.setEnabled(id,true,{scope:'session'});
  await enable();
  const entry=runtime.plugins.entry(id),pluginHost=createHostContextV2(runtime,entry,'conv_main');
  const storage=await realpath(pluginHost.context.storageRoot);
  const within=relative(root,storage);assert.ok(within&&!within.startsWith('..')&&!isAbsolute(within));
  const record=args=>invokeValue(main,id+'#kurumi_recording',args);
  const first=await record({action:'pin',command_id:command});
  assert.equal(first.pinned,true);
  assert.equal(first.selection.mode,'private');
  assert.equal(first.engineUnchanged,true);
  assert.equal(first.mirror,join(storage,'recording-mirror'));
  await close();
  const db=new DatabaseSync(join(storage,'replay.sqlite'),{readOnly:true});
  try {
    const rows=db.prepare('SELECT value FROM records WHERE collection=? AND id=?').all('recording-commands',command);
    assert.equal(rows.length,1);
    assert.deepEqual(JSON.parse(rows[0].value).result,first);
  } finally {db.close();}
  main=await open();await enable();
  assert.deepEqual(await record({action:'pin',command_id:command}),first);
  const state=await record({action:'status'});
  assert.equal(state.selection.record.mode,'private');
  assert.equal(state.selection.mirrorRoot,first.mirror);
  assert.equal(runtime.runs.list().filter(run=>run.kind==='agent'||run.kind==='process').length,0);
  t.diagnostic(JSON.stringify({package:id,version:entry.version,persistedReceipts:1,reopened:true,idempotent:true,modelOrProcessRuns:0}));
});
