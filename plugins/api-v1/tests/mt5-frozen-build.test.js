import test from 'node:test';import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateSource } from '@sesame/plugin-sdk/svl';
import { NativeRunObserver } from '../../optional-api-v1/packages/mt5/backend/run-observer.js';
import { mt5ConnectionRef } from '../../optional-api-v1/packages/mt5/backend/contract-mapping.js';
import { MT5AccountProvider, accountDescriptor } from '../../optional-api-v1/packages/mt5/backend/providers.js';
import { digest, canonical } from '@sesame/plugin-sdk/protocol';
const bytes=Buffer.from('frozen EX5 fixture'),translation={id:'translation',revision:'1',kind:'strategy.translation',schemaVersion:'1.0.0',digest:digest('translation')};
const build={id:'build-fixed',status:'succeeded',conversation_id:'child',owner_run_id:'child-run',ex5_sha256:digest(bytes),manifest_digest:digest('manifest'),translation};const manifest={compiler_sha256:digest('compiler'),files:{}};
function fixture(version='1.1.5'){const rows=new Map(),artifacts=new Map(),requests=new Map(),blobs=new Map();let published=0;const host={plugin:{id:'sesame/mt5',version,digest:digest(version)},records:{list:()=>[]},artifacts:{blob:b=>{const ref={digest:digest(b),size:Buffer.byteLength(b)};blobs.set(ref.digest,Buffer.from(b));return ref;},readBlob:ref=>{const b=blobs.get(ref.digest);assert.equal(digest(b),ref.digest);return b;},read:ref=>{const a=artifacts.get(ref.id);assert.equal(canonical(a.ref),canonical(ref));return structuredClone(a);},list:({offset,limit})=>({items:[...artifacts.values()].slice(offset,offset+limit).map(a=>({ref:a.ref,producer:a.producer})),hasMore:offset+limit<artifacts.size}),publish:input=>{const key=host.plugin.id+input.operationId,fingerprint=digest(input),prior=requests.get(key);if(prior){assert.equal(prior.fingerprint,fingerprint,'host idempotency conflict');return prior.ref;}const ref={id:'artifact-'+(++published),revision:'1',kind:input.manifest.kind,schemaVersion:'1.0.0',digest:digest(input.manifest)};artifacts.set(ref.id,{ref,producer:structuredClone(host.plugin),manifest:structuredClone(input.manifest)});requests.set(key,{fingerprint,ref});return ref;}}};const storage={get:(kind,id)=>rows.get(kind+id),put:(kind,row)=>{rows.set(kind+row.id,structuredClone(row));return row;}};return{host,mt5:{storage},rows,artifacts,requests,observer:()=>new NativeRunObserver(host,{storage}),get published(){return published;}};}
test('repeated runs and plugin upgrade reuse one frozen content reference',()=>{const f=fixture(),first=f.observer().frozenBuild(build,manifest,translation,bytes);assert.deepEqual(f.observer().frozenBuild(build,manifest,translation,bytes),first);f.host.plugin={...f.host.plugin,version:'1.1.6',digest:digest('upgraded')};assert.deepEqual(f.observer().frozenBuild(build,manifest,translation,bytes),first);assert.equal(f.published,1);});
test('pre-index child build survives finalized archive metadata and main-session reuse',()=>{const f=fixture('1.1.3'),old=f.observer().artifact('native-build-'+build.id,'resource',{format:'sesame.mt5.build/1',build,manifest},[translation],{'Strategy.ex5':bytes});f.host.plugin={...f.host.plugin,version:'1.1.6',digest:digest('upgrade')};const archived={...build,archived_artifact:{id:'child-archive'},intermediate_files_removed:true};assert.deepEqual(f.observer().frozenBuild(archived,manifest,translation,bytes),old);assert.deepEqual(f.observer().frozenBuild({...archived,archived_manifest:'retained'},manifest,translation,bytes),old);assert.equal(f.published,1);assert.equal(f.rows.size,3);});
test('changed immutable build, manifest, translation or EX5 cannot silently reuse or create another reference',()=>{for(const change of [()=>[{...build,source_digest:'changed'},manifest,translation,bytes],()=>[build,{...manifest,compiler_sha256:digest('different')},translation,bytes],()=>[build,manifest,{...translation,revision:'2'},bytes],()=>[build,manifest,translation,Buffer.from('different EX5')]]){const f=fixture();f.observer().frozenBuild(build,manifest,translation,bytes);assert.throws(()=>f.observer().frozenBuild(...change()),/冻结构建/);assert.equal(f.published,1);}});
test('legacy candidate with changed immutable bytes is rejected before migration publication',()=>{const f=fixture();f.observer().artifact('native-build-'+build.id,'resource',{format:'sesame.mt5.build/1',build,manifest},[translation],{'Strategy.ex5':Buffer.from('tampered')});assert.throws(()=>f.observer().frozenBuild({...build,intermediate_files_removed:true},manifest,translation,bytes),/EX5/);assert.equal(f.published,1);});
test('legacy migration rejects missing EX5, different translation dependency and conflicting references',()=>{for(const mutate of [a=>a.manifest.blobs=[],a=>a.manifest.dependencies=[{...translation,revision:'different'}]]){const f=fixture();const ref=f.observer().artifact('native-build-'+build.id,'resource',{format:'sesame.mt5.build/1',build,manifest},[translation],{'Strategy.ex5':bytes});mutate(f.artifacts.get(ref.id));assert.throws(()=>f.observer().frozenBuild(build,manifest,translation,bytes),/冻结构建/);assert.equal(f.published,1);}const f=fixture();f.observer().artifact('native-build-'+build.id,'resource',{format:'sesame.mt5.build/1',build,manifest},[translation],{'Strategy.ex5':bytes});f.observer().artifact('another-fixed-ref','resource',{format:'sesame.mt5.build/1',build,manifest},[translation],{'Strategy.ex5':bytes});assert.throws(()=>f.observer().frozenBuild(build,manifest,translation,bytes),/不同冻结引用/);assert.equal(f.published,2);});
test('migration retains original producer identity and indexed foreign references are rejected',()=>{const f=fixture('1.1.3');const ref=f.observer().artifact('native-build-'+build.id,'resource',{format:'sesame.mt5.build/1',build,manifest},[translation],{'Strategy.ex5':bytes});f.host.plugin={...f.host.plugin,version:'1.1.6',digest:digest('upgraded')};f.observer().frozenBuild(build,manifest,translation,bytes);assert.equal(f.artifacts.get(ref.id).producer.version,'1.1.3');f.artifacts.get(ref.id).producer.id='foreign/plugin';assert.throws(()=>f.observer().frozenBuild(build,manifest,translation,bytes),/引用身份/);assert.equal(f.published,1);});

test('foreign producer with the same build ID is never adopted as MT5 evidence',()=>{const f=fixture(),ours=f.host.plugin;f.host.plugin={...ours,id:'foreign/plugin'};const foreign=f.observer().artifact('native-build-'+build.id,'resource',{format:'sesame.mt5.build/1',build,manifest},[translation],{'Strategy.ex5':bytes});f.host.plugin=ours;const actual=f.observer().frozenBuild(build,manifest,translation,bytes);assert.notEqual(actual.id,foreign.id);assert.equal(f.artifacts.get(actual.id).producer.id,'sesame/mt5');});

test('legacy resource scan occurs once across new builds and observer restart',()=>{const f=fixture();let reads=0,lists=0;const read=f.host.artifacts.read,list=f.host.artifacts.list;f.host.artifacts.read=(...a)=>{reads++;return read(...a);};f.host.artifacts.list=(...a)=>{lists++;return list(...a);};for(let i=0;i<25;i++)f.observer().artifact('unrelated-'+i,'resource',{format:'other'},[],{});const legacy={...build,id:'legacy-second'};const ref=f.observer().artifact('native-build-'+legacy.id,'resource',{format:'sesame.mt5.build/1',build:legacy,manifest},[translation],{'Strategy.ex5':bytes});f.observer().frozenBuild(build,manifest,translation,bytes);assert.equal(lists,1);assert.equal(reads,26);for(let i=0;i<20;i++)f.observer().frozenBuild({...build,id:'new-'+i},manifest,translation,bytes);assert.equal(lists,1);assert.equal(reads,26);assert.deepEqual(f.observer().frozenBuild(legacy,manifest,translation,bytes),ref);assert.equal(lists,1);assert.equal(reads,27);});

test('interrupted migration is retried and publication survives index-write failure',()=>{const f=fixture();const legacy=f.observer().artifact('native-build-'+build.id,'resource',{format:'sesame.mt5.build/1',build,manifest},[translation],{'Strategy.ex5':bytes});const read=f.host.artifacts.read;f.host.artifacts.read=()=>{throw Error('read interrupted');};assert.throws(()=>f.observer().frozenBuild(build,manifest,translation,bytes),/interrupted/);assert.equal(f.mt5.storage.get('native_build_migrations','legacy-build-resources-v1'),undefined);f.host.artifacts.read=read;assert.deepEqual(f.observer().frozenBuild(build,manifest,translation,bytes),legacy);const next={...build,id:'new-write-failure'},put=f.mt5.storage.put;let fail=true;f.mt5.storage.put=(kind,row)=>{if(kind==='native_build_inputs'&&fail){fail=false;throw Error('index interrupted');}return put(kind,row);};assert.throws(()=>f.observer().frozenBuild(next,manifest,translation,bytes),/index interrupted/);const count=f.published;f.observer().frozenBuild(next,manifest,translation,bytes);assert.equal(f.published,count);});

test('one-time migration filters foreign list metadata before reading resource content',()=>{const f=fixture(),ours=f.host.plugin;f.host.plugin={...ours,id:'foreign/plugin'};const foreign=f.observer().artifact('unrelated','resource',{format:'other'},[],{});f.host.plugin=ours;const read=f.host.artifacts.read;f.host.artifacts.read=ref=>{assert.notEqual(ref.id,foreign.id);return read(ref);};f.observer().frozenBuild(build,manifest,translation,bytes);});


test('new live run definitions use the same stable MT5 connection as providers', async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mt5-run-connection-'));
  try{
    const source=JSON.parse(readFileSync(new URL('../packages/strategy-authoring/examples/close-threshold.svl.json',import.meta.url))),checked=validateSource(source),sourceBytes=Buffer.from(JSON.stringify(source));
    const ex5=Buffer.from('stable run connection ex5'),build={id:'build-run-connection',project_id:'project',revision:1,ex5_sha256:digest(ex5),manifest_digest:digest('manifest')},manifest={compiler_sha256:digest('compiler'),files:{}};
    await mkdir(join(directory,'mt5/builds',build.id,'Experts'),{recursive:true});
    await writeFile(join(directory,'mt5/builds',build.id,'Experts/Strategy.ex5'),ex5);
    await writeFile(join(directory,'mt5/builds',build.id,'manifest.json'),JSON.stringify(manifest));
    const ref=(id,kind)=>({id,kind,revision:'1',schemaVersion:'1.0.0',digest:digest(id)}),sourceRef=ref('source','strategy.source'),targetRef=ref('target','strategy.target'),translationRef=ref('translation','strategy.translation');
    const artifacts=new Map([
      [sourceRef.id,{ref:sourceRef,producer:{id:'sesame/mt5'},manifest:{content:{sourcePath:'strategy.svl.json',sourceDigest:checked.sourceDigest},blobs:[{path:'strategy.svl.json',digest:digest(sourceBytes),size:sourceBytes.length}]}}],
      [targetRef.id,{ref:targetRef,producer:{id:'sesame/mt5'},manifest:{content:{id:'sesame.mt5.mql5',svl:{versions:['1.0.0'],events:['bar.closed']}}}}],
      [translationRef.id,{ref:translationRef,producer:{id:'sesame/mt5'},manifest:{content:{source:sourceRef,target:targetRef,nativeParameterMap:{instrument:{binding:'instrument'},threshold:{nativeInput:'Threshold'}},environment:{}}}}],
    ]),blobs=new Map([[digest(sourceBytes),sourceBytes]]),records=new Map([['mt5_build/'+build.id,build],['mt5_revision/project:1',{translation:translationRef}]]);
    const storage={directory,get:(kind,id,optional=false)=>{const row=records.get(`${kind}/${id}`);assert.ok(optional||row,`missing ${kind}/${id}`);return row&&structuredClone(row);},put:(kind,row)=>{records.set(`${kind}/${row.id}`,structuredClone(row));return row;},idempotent:(_id,_fingerprint,action)=>action()};
    const host={plugin:{id:'sesame/mt5',version:'fixture',digest:digest('plugin')},records:{list:()=>[]},artifacts:{blob:b=>{const buf=Buffer.isBuffer(b)?b:Buffer.from(b),out={digest:digest(buf),size:buf.length};blobs.set(out.digest,buf);return out;},readBlob:blob=>blobs.get(blob.digest),read:ref=>structuredClone(artifacts.get(ref.id)),list:()=>({items:[],hasMore:false}),publish:input=>{const out=ref('artifact-'+artifacts.size,input.manifest.kind);artifacts.set(out.id,{ref:out,producer:{id:'sesame/mt5'},manifest:structuredClone(input.manifest)});return out;}}};
    const endpoint='http://127.0.0.1:22346/mcp',mt5={storage,official:{config:{version:7,servers:{terminal:{url:endpoint}},account:{server:'Fixture-Demo',login:'7001'}}}};
    const body=new NativeRunObserver(host,mt5).definition('deployment',{id:'deploy-run-connection',build_id:build.id,server:'Fixture-Demo',login:'7001',symbol:'EURUSD',period:'M1',parameters:{Threshold:'101.25'},conversation_id:'conv'});
    const expected=mt5ConnectionRef('Fixture-Demo','7001',endpoint);
    assert.deepEqual(body.accounts[0].connection,expected);
    assert.deepEqual(host.artifacts.read(body.environment).manifest.content.connection,expected);
    const provider=new MT5AccountProvider({...mt5,options:{},market:{read:async()=>{throw Error('bind should not read native')}}}),bound=provider.bind({connection:body.accounts[0].connection},{bindingId:'bind',signal:new AbortController().signal});
    assert.deepEqual(bound.connection,expected);
    mt5.official.config.version++;
    assert.equal(provider.binding({bindingId:'bind'}).account.accountId,body.accounts[0].account.accountId);
    mt5.official.config.account.login='7002';
    assert.throws(()=>provider.binding({bindingId:'bind'}),{code:'CONNECTION_CHANGED'});
    provider.dispose();
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('saved native run definitions are returned without rewriting legacy numeric connections',()=>{
  const legacy={accounts:[{connection:{id:'mt5-terminal',revision:'7'}}]};
  const storage={get:(kind,id)=>kind==='native_run_inputs'&&id==='mt5-deployment-old'?{body:legacy}:undefined,put:()=>assert.fail('must not rewrite saved body')};
  const body=new NativeRunObserver({plugin:{id:'sesame/mt5'},records:{list:()=>[]}}, {storage}).definition('deployment',{id:'old'});
  assert.deepEqual(body,legacy);
});

test('tester run definitions keep numeric connection_version without requiring live account identity', async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mt5-tester-connection-'));
  try{
    const source=JSON.parse(readFileSync(new URL('../packages/strategy-authoring/examples/close-threshold.svl.json',import.meta.url))),checked=validateSource(source),sourceBytes=Buffer.from(JSON.stringify(source));
    const ex5=Buffer.from('tester run connection ex5'),build={id:'build-tester-connection',project_id:'project',revision:1,ex5_sha256:digest(ex5),manifest_digest:digest('manifest')},manifest={compiler_sha256:digest('compiler'),files:{}};
    await mkdir(join(directory,'mt5/builds',build.id,'Experts'),{recursive:true});
    await writeFile(join(directory,'mt5/builds',build.id,'Experts/Strategy.ex5'),ex5);
    await writeFile(join(directory,'mt5/builds',build.id,'manifest.json'),JSON.stringify(manifest));
    const ref=(id,kind)=>({id,kind,revision:'1',schemaVersion:'1.0.0',digest:digest(id)}),sourceRef=ref('source','strategy.source'),targetRef=ref('target','strategy.target'),translationRef=ref('translation','strategy.translation');
    const artifacts=new Map([
      [sourceRef.id,{ref:sourceRef,producer:{id:'sesame/mt5'},manifest:{content:{sourcePath:'strategy.svl.json',sourceDigest:checked.sourceDigest},blobs:[{path:'strategy.svl.json',digest:digest(sourceBytes),size:sourceBytes.length}]}}],
      [targetRef.id,{ref:targetRef,producer:{id:'sesame/mt5'},manifest:{content:{id:'sesame.mt5.mql5',svl:{versions:['1.0.0'],events:['bar.closed']}}}}],
      [translationRef.id,{ref:translationRef,producer:{id:'sesame/mt5'},manifest:{content:{source:sourceRef,target:targetRef,nativeParameterMap:{instrument:{binding:'instrument'},threshold:{nativeInput:'Threshold'}},environment:{}}}}],
    ]),blobs=new Map([[digest(sourceBytes),sourceBytes]]),records=new Map([['mt5_build/'+build.id,build],['mt5_revision/project:1',{translation:translationRef}]]);
    const storage={directory,get:(kind,id,optional=false)=>{const row=records.get(`${kind}/${id}`);assert.ok(optional||row,`missing ${kind}/${id}`);return row&&structuredClone(row);},put:(kind,row)=>{records.set(`${kind}/${row.id}`,structuredClone(row));return row;},idempotent:(_id,_fingerprint,action)=>action()};
    const host={plugin:{id:'sesame/mt5',version:'fixture',digest:digest('plugin')},records:{list:()=>[]},artifacts:{blob:b=>{const buf=Buffer.isBuffer(b)?b:Buffer.from(b),out={digest:digest(buf),size:buf.length};blobs.set(out.digest,buf);return out;},readBlob:blob=>blobs.get(blob.digest),read:ref=>structuredClone(artifacts.get(ref.id)),list:()=>({items:[],hasMore:false}),publish:input=>{const out=ref('artifact-'+artifacts.size,input.manifest.kind);artifacts.set(out.id,{ref:out,producer:{id:'sesame/mt5'},manifest:structuredClone(input.manifest)});return out;}}};
    const mt5={storage,official:{config:{version:99,servers:{terminal:{url:'http://127.0.0.1:22346/mcp'}},account:{server:'Current-Demo',login:'9999'}}}};
    const body=new NativeRunObserver(host,mt5).definition('tester',{id:'pass-tester-connection',build_id:build.id,connection_version:7,config:{symbol:'EURUSD',period:'M1',parameters:{Threshold:'101.25'}},conversation_id:'conv',owner_run_id:'run'});
    assert.deepEqual(body.accounts,[]);
    assert.deepEqual(host.artifacts.read(body.environment).manifest.content.connection,{id:'mt5-terminal',revision:'7'});
  }finally{await rm(directory,{recursive:true,force:true});}
});
