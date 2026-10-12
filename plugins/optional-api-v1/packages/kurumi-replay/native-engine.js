import { validateNativeOrderABI } from './native-order-abi.js';
import { isDeepStrictEqual } from 'node:util';
import { getExperimentProfile, assertNativeRules, ROUND2_PROFILE_ID } from './experiment-profiles.js';
// Awaitable native adapter. The service must CAS the returned state after await;
// this module never commits a run store. Only explicit prepareNative installs private dependencies.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReferenceRun as referenceCreate, validateReferenceDecision as referenceValidate, snapshotReference as referenceSnapshot } from './engine.js';
const here = dirname(fileURLToPath(import.meta.url));
const copy = x => JSON.parse(JSON.stringify(x));
const HOUR = 3600000;
const PROFILES = getExperimentProfile().content.chapterRules;
function fail(code,message) { const error=new Error(message);error.code=code;throw error; }
export function createRun(runId,chapters,dataDigests,{profileId}={}) {
  const profile=getExperimentProfile(profileId);
  const s=referenceCreate(runId,chapters,dataDigests);
  s.rules={...s.rules,engine:'nautilus-trader',engineVersion:'1.231.0',model:'native-quote-tick-v1',leverage:null,stopout:null,
    formalExecution:true,fxMaxAgeMs:60000,chapterRules:copy(profile.content.chapterRules),h1Role:'view-and-decision-only',liquidityAssumption:'unbounded_top_of_book',accounting:'exact-adapter-ledger'};
  if(profileId)s.rules.experimentProfile=profile;
  s.nativeJournal=[];s.lastQuote=null;s.bankrupt=false;s.nativeReceipt=null;
  return s;
}
export function validateDecision(state,decision) {
  if(state.rules?.engine!=='nautilus-trader') fail('ENGINE_MISMATCH','Formal adapter requires native createRun state, not H1 reference state');
  assertNativeRules(state);
  const result=referenceValidate(state,decision);
  if(!result.duplicate&&decision.stop!==null){
    const stop=d(decision.stop),tick=d(state.chapters[state.chapter].tickSize ?? (state.chapters[state.chapter].symbol.endsWith('JPY')?'0.001':'0.00001')),scale=Math.max(stop.s,tick.s);
    if((stop.n*10n**BigInt(scale-stop.s))%(tick.n*10n**BigInt(scale-tick.s))!==0n)fail('UNSUPPORTED_STOP_PRECISION','Stop must be an exact instrument tick multiple; no silent native rounding');
  }
  return result;
}
function invoke(request,options) {
  return new Promise((resolvePromise,reject)=>{
    const python=options.pythonPath ?? process.env.KURUMI_NATIVE_PYTHON;
    if(!python){reject(Object.assign(new Error('Explicit verified private Python path required; no implicit author environment'),{code:'NATIVE_NOT_PREPARED'}));return;}
    const child=spawn(python,[resolve(here,'native-engine.py')],{stdio:['pipe','pipe','pipe'],signal:options.signal,
      env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let output='',diagnostic='',oversized=false;
    child.stdout.on('data',chunk=>{output+=chunk;if(Buffer.byteLength(output)>64*1024*1024){oversized=true;child.kill();}});
    child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-50000);});
    child.on('error',reject);child.stdin.on('error',()=>{});
    child.on('close',(exitCode)=>{
      if(oversized){const e=new Error('Native checkpoint exceeded 64 MiB output budget');e.code='CHECKPOINT_TOO_LARGE';reject(e);return;}
      try {
        const result=JSON.parse(output);
        if(exitCode!==0 || !result.ok){const e=new Error(result.message ?? diagnostic ?? 'Native process failed');e.code=result.code ?? 'NATIVE_FAILURE';reject(e);return;}
        resolvePromise(result.state);
      } catch(e) {if(!e.code)e.code='NATIVE_FAILURE';reject(e);}
    });
    child.stdin.end(JSON.stringify(request));
  });
}
export async function decideAndAdvance(state,decision,frames,options={}) {
  const validation=validateDecision(state,decision);
  if(validation.duplicate)return copy(state);
  const current=frames?.[state.index],next=frames?.[state.index+1];
  if(!Array.isArray(frames)||!current||!next||!Number.isSafeInteger(current.time)||!Number.isSafeInteger(next.time)||current.time%HOUR||next.time%HOUR||
     (state.revealedFrameTime!==null&&state.revealedFrameTime!==current.time)) {
    const s=copy(state);s.status='missing_data';s.missingData={code:'INVALID_DATA',message:'Missing/misaligned current or next H1 metadata',chapter:s.chapter,index:s.index,nextIndex:s.index+1};return s;
  }
  const step={decision:copy(decision),previousTime:current.time,from:next.time,to:next.time+HOUR,
    ticks:options.quoteTicks ?? next.quoteTicks ?? [],coverage:options.coverage ?? next.coverage ?? {}};
  if(options.stepRef){delete step.ticks;step.ticksRef=options.stepRef;}
  try {const result=await (options.invokeImpl ?? invoke)({state,step,storageRoot:options.storageRoot,persistent:!!options.persistent},options);validateNativeOrderABI(result);return result;}
  catch(e){
    if(e.code==='INVALID_DATA') {const s=copy(state);s.status='missing_data';s.missingData={code:e.code,message:e.message,chapter:s.chapter,index:s.index,nextIndex:s.index+1};return s;}
    throw e;
  }
}
// Exact decimal helpers solely for converting the reference display margin from
// /25 to fixed native chapter leverage. No Number financial arithmetic.
function d(v){const negative=v.startsWith('-');const [a,b='']=(negative?v.slice(1):v).split('.');return {n:BigInt(a+b)*(negative?-1n:1n),s:b.length};}
function str(v){while(v.s&&v.n%10n===0n){v.n/=10n;v.s--;}const negative=v.n<0n;let t=(negative?-v.n:v.n).toString().padStart(v.s+1,'0');if(v.s)t=t.slice(0,-v.s)+'.'+t.slice(-v.s);return(negative?'-':'')+t;}
function minus(a,b){a=d(a);b=d(b);const s=Math.max(a.s,b.s);return str({n:a.n*10n**BigInt(s-a.s)-b.n*10n**BigInt(s-b.s),s});}
export function snapshot(state,frame) {
  if(state.rules?.engine!=='nautilus-trader')fail('ENGINE_MISMATCH','Native state required');
  const profile=assertNativeRules(state), chapterRule=profile.content.chapterRules[state.chapter];
  if(state.revealedFrameTime!==null&&frame?.time!==state.revealedFrameTime)fail('INVALID_DATA','snapshot requires current revealed frame metadata');
  const actual=state.lastQuote;
  const flatBook=p=>({open:p,high:p,low:p,close:p});
  const selected=actual ? {time:Math.floor(actual.time/HOUR)*HOUR,bid:flatBook(actual.bid),ask:flatBook(actual.ask),
    ...(actual.fx?{fx:{bid:flatBook(actual.fx.bid),ask:flatBook(actual.fx.ask)}}:{})} : frame;
  const s=referenceSnapshot({...state,revealedFrameTime:null},selected,{allowUnpricedFlat:true});
  // Reference display uses /25. Exact finite correction, never Number money.
  const m=d(s.margin),factor=chapterRule.leverage==='500'?{n:5n,s:2}:chapterRule.leverage==='50'?{n:5n,s:1}:{n:1n,s:0};
  s.margin=str({n:m.n*factor.n,s:m.s+factor.s});
  s.freeMargin=minus(s.equity,s.margin);
  s.engine='nautilus-trader';s.engineVersion='1.231.0';s.leverage=chapterRule.leverage;s.stopout=chapterRule.stopout;s.experimentProfile=profile;
  s.bankrupt=state.bankrupt;s.nativeReceipt=copy(state.nativeReceipt);
  if(actual?.fx){s.fxAsOfTime=actual.fx.time;s.fxAgeMs=actual.time-actual.fx.time;s.fxMaxAgeMs=60000;}
  if(actual?.fxUnavailable){s.fxStatus='not_required_zero_exposure';s.fxUnavailable=copy(actual.fxUnavailable);}
  if(actual){s.time=actual.time;s.frameTime=state.revealedFrameTime;s.priceSource='last-consumed-quote';}
  else{s.priceSource='already-revealed-H1-close';}
  return s; // no journal, interval tick array or future OHLC exposed
}


const FIXED_DEPENDENCIES = {
  nautilus_trader:'1.231.0',click:'8.5.0',fsspec:'2026.2.0',msgspec:'0.22.0',numpy:'2.5.4',pandas:'3.0.6',
  portion:'2.6.3',pyarrow:'26.0.0',pytz:'2026.5',tqdm:'4.70.1',tzdata:'2026.5',uvloop:'0.22.1',
  'python-dateutil':'2.9.0.post0',sortedcontainers:'2.4.0',six:'1.17.0'
};
const digest = bytes => 'sha256:'+createHash('sha256').update(bytes).digest('hex');
const workers = new Map(), queues = new Map(), lifecycleEpochs = new Map();
const aborted = signal => {if(signal?.aborted){const e=new Error('Native operation cancelled; no run state committed');e.name='AbortError';e.code='CANCELLED';throw e;}};
const pythonAt = root => process.platform==='win32'?join(root,'venv','Scripts','python.exe'):join(root,'venv','bin','python');
async function ownedRoot(storageDirectory,create=false) {
  if(typeof storageDirectory!=='string'||!storageDirectory)fail('INVALID_STORAGE','Plugin-private storageDirectory required');
  const base=resolve(storageDirectory),root=join(base,'kurumi-native');
  if(create)await fs.mkdir(root,{recursive:true});
  try {const st=await fs.lstat(root);if(!st.isDirectory()||st.isSymbolicLink())fail('UNSAFE_PATH','Owned native directory cannot be a symlink');}
  catch(e){if(e.code==='ENOENT'&&!create)return root;throw e;}
  return root;
}
function command(argv,{signal,cwd,stdin,timeout=300000}={}) {
  aborted(signal);
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(argv[0],argv.slice(1),{cwd,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    let out='',err='',failure;
    const cancel=()=>{failure=new Error('Native operation cancelled');failure.code='CANCELLED';failure.name='AbortError';child.kill('SIGKILL');};
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    const timer=setTimeout(()=>{failure=new Error(`Native command timeout (${argv[0]} ${argv[1] ?? ''})`);failure.code='NATIVE_TIMEOUT';child.kill('SIGKILL');},timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data',b=>{out+=b;if(Buffer.byteLength(out)>8*1024*1024){failure=new Error('Command output exceeded budget');failure.code='OUTPUT_LIMIT';child.kill('SIGKILL');}});
    child.stderr.on('data',b=>{err=(err+b).slice(-50000);});child.stdin.on('error',()=>{});
    child.on('error',e=>{failure=e;});child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(failure){reject(failure);return;}if(code){const e=new Error(`Native command failed (${code}): ${err.slice(-3000)}`);e.code='NATIVE_PREPARE_FAILED';reject(e);return;}resolvePromise(out.trim());});
    child.stdin.end(stdin ?? '');
  });
}
const probeCode=`import sys,json,importlib.metadata as m;from nautilus_trader.backtest.engine import BacktestEngine;print(json.dumps({'version':m.version('nautilus_trader'),'python':sys.version.split()[0],'prefix':sys.prefix,'basePrefix':sys.base_prefix,'dependencies':{n:m.version(n) for n in ${JSON.stringify(Object.keys(FIXED_DEPENDENCIES))}}}))`;
export async function nativeStatus(storageDirectory,{signal}={}) {
  aborted(signal);const root=await ownedRoot(storageDirectory);const python=pythonAt(root);
  try {
    let receipt,receiptSource='receipt.json';try{receipt=JSON.parse(await fs.readFile(join(root,receiptSource),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;receiptSource='environment.json';receipt=JSON.parse(await fs.readFile(join(root,receiptSource),'utf8'));}
    if(receiptSource==='receipt.json'){const cfg=await fs.readFile(join(here,'native-dependencies.json'));if(receipt.configDigest!==digest(cfg))return {status:'manifest_mismatch',ready:false,engine:'nautilus-trader',directory:root};}
    if((receipt.engineVersion??receipt.version)!=='1.231.0')return{status:'version_mismatch',ready:false,engine:'nautilus-trader',directory:root};
    const check=JSON.parse(await command([python,'-I','-c',probeCode],{signal,timeout:120000}));
    if(check.prefix===check.basePrefix||resolve(check.prefix)!==await fs.realpath(join(root,'venv')))return{status:'unsafe_environment',ready:false,engine:'nautilus-trader',directory:root,prefix:check.prefix,basePrefix:check.basePrefix};
    if(check.version!=='1.231.0'||Object.entries(FIXED_DEPENDENCIES).some(([k,v])=>check.dependencies[k]!==v))return{status:'version_mismatch',ready:false,engine:'nautilus-trader',directory:root};
    return {status:'ready',ready:true,engine:'nautilus-trader',engineVersion:check.version,python:check.python,pythonPath:python,directory:root,dependencies:check.dependencies,dependencyReceipt:receipt,receiptSource};
  }catch(e){if(e.code==='CANCELLED')throw e;return{status:'not_prepared',ready:false,engine:'nautilus-trader',directory:root,reason:e.code ?? 'IMPORT_FAILED',message:e.message};}
}
/** Only this explicit operation may create a venv or download/install wheels. */
export async function prepareNative(storageDirectory,{signal,pythonPath,sourceWheelCache}={}) {
  aborted(signal);const ready=await nativeStatus(storageDirectory,{signal});if(ready.ready)return ready;
  const root=await ownedRoot(storageDirectory,true);const lock=join(root,'prepare.lock');
  let fd;try{fd=await fs.open(lock,'wx');}catch(e){if(e.code==='EEXIST')fail('NATIVE_BUSY','Native prepare lock exists; no automatic replay');throw e;}
  try {
    let basePython;
    for(const candidate of [pythonPath,process.env.KURUMI_BASE_PYTHON,'/opt/homebrew/bin/python3.13','python3.13','python3.12','python3.14','python3'].filter(Boolean)) {
      aborted(signal);try{const minor=JSON.parse(await command([candidate,'-c','import sys,json;print(json.dumps(list(sys.version_info[:2])))'],{signal,timeout:10000}));if(minor[0]===3&&minor[1]>=12&&minor[1]<=14){basePython=candidate;break;}}
      catch(e){if(e.code==='CANCELLED')throw e;}
    }
    if(!basePython)fail('PYTHON_UNAVAILABLE','Nautilus 1.231.0 requires an existing compatible Python 3.12..3.14; system Python is untouched');
    const python=pythonAt(root);
    try{if((await fs.lstat(join(root,'venv'))).isSymbolicLink())fail('UNSAFE_ENVIRONMENT','Private venv cannot be a directory symlink');}catch(e){if(e.code!=='ENOENT')throw e;}
    try{await fs.access(python);}catch{await command([basePython,'-m','venv',join(root,'venv')],{signal,timeout:180000});}
    const prefix=JSON.parse(await command([python,'-c','import sys,json;print(json.dumps([sys.prefix,sys.base_prefix]))'],{signal,timeout:10000}));
    if(prefix[0]===prefix[1]||resolve(prefix[0])!==await fs.realpath(join(root,'venv')))fail('UNSAFE_ENVIRONMENT','Refuse to install outside the owned private virtual environment');
    const cache=join(root,'wheels');await fs.mkdir(cache,{recursive:true});
    const receipts=[];
    const reusable=sourceWheelCache ?? resolve(here,'../../../../.data/plugin-envs/kurumi-replay-nautilus/wheel-cache');
    for(const [name,version]of Object.entries(FIXED_DEPENDENCIES)) {
      aborted(signal);const metadataPath=join(cache,`${name}-${version}.pypi.json`);
      await command(['curl','-fsSL','--retry','2','--max-time','60','-o',metadataPath,`https://pypi.org/pypi/${name}/${version}/json`],{signal,timeout:90000});
      const metadata=JSON.parse(await fs.readFile(metadataPath,'utf8'));
      const chooser=`import json,sys;from pip._vendor.packaging.tags import sys_tags;from pip._vendor.packaging.utils import parse_wheel_filename;t={x:i for i,x in enumerate(sys_tags())};out=[]
for f in json.load(sys.stdin):
 if not f['filename'].endswith('.whl') or f.get('yanked'):continue
 try:tags=parse_wheel_filename(f['filename'])[3]
 except Exception:continue
 rank=min((t[x] for x in tags if x in t),default=999999)
 if rank<999999:out.append((rank,f))
print(json.dumps(min(out,key=lambda x:x[0])[1] if out else None))`;
      const wheel=JSON.parse(await command([python,'-c',chooser],{signal,stdin:JSON.stringify(metadata.urls),timeout:10000}));
      if(!wheel)fail('NO_COMPATIBLE_WHEEL',`No verified ${name} ${version} wheel for this OS/Python; no system installation or silent version downgrade`);
      const final=join(cache,wheel.filename),expected='sha256:'+wheel.digests.sha256;
      let valid=false;try{valid=digest(await fs.readFile(final))===expected;}catch(e){if(e.code!=='ENOENT')throw e;}
      if(!valid) {
        const partial=final+'.part';let reused=false;
        try{const bytes=await fs.readFile(join(reusable,wheel.filename));if(digest(bytes)===expected){await fs.writeFile(partial,bytes);reused=true;}}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e;}
        if(!reused)await command(['curl','-fsSL','--retry','2','--max-time','240','-C','-','-o',partial,wheel.url],{signal,timeout:300000});
        aborted(signal);if(digest(await fs.readFile(partial))!==expected)fail('DEPENDENCY_HASH_MISMATCH','Downloaded wheel digest mismatch');await fs.rename(partial,final);
      }
      receipts.push({name,version,filename:wheel.filename,digest:expected,url:wheel.url});
    }
    await command([python,'-m','pip','--isolated','--disable-pip-version-check','install','--no-index','--no-deps','--find-links',cache,...receipts.map(r=>join(cache,r.filename))],{signal,timeout:300000});
    const check=JSON.parse(await command([python,'-I','-c',probeCode],{signal,timeout:120000}));
    if(check.version!=='1.231.0')fail('NATIVE_VERSION_MISMATCH','Installed native engine version differs from fixed contract');
    const receipt={schemaVersion:1,engine:'nautilus-trader',engineVersion:'1.231.0',python:check.python,privateDirectory:root,wheels:receipts};
    await fs.writeFile(join(root,'environment.json.tmp'),JSON.stringify(receipt,null,2));aborted(signal);await fs.rename(join(root,'environment.json.tmp'),join(root,'environment.json'));
    const finalStatus=await nativeStatus(storageDirectory,{signal});if(!finalStatus.ready)fail('NATIVE_PREPARE_FAILED','Private environment did not pass final native import/version validation');return finalStatus;
  }finally{await fd?.close();await fs.unlink(lock).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
function persistentInvoke(request,{storageRoot,pythonPath,signal,timeoutMs=300000}) {
  aborted(signal);
  return new Promise((resolvePromise,reject)=>{
    let worker=workers.get(storageRoot);
    if(!worker) {
      const child=spawn(pythonPath,[join(here,'native-engine.py'),'--worker'],{stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
      worker={child,buffer:'',stderr:'',pending:null};workers.set(storageRoot,worker);
      // Streaming decoding preserves Chinese text across OS pipe chunk boundaries.
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data',b=>{
        worker.buffer+=b;if(Buffer.byteLength(worker.buffer)>64*1024*1024){const e=new Error('Native worker output budget exceeded');e.code='OUTPUT_LIMIT';worker.pending?.reject(e);child.kill('SIGKILL');return;}
        const i=worker.buffer.indexOf('\n');if(i<0)return;
        const line=worker.buffer.slice(0,i);worker.buffer=worker.buffer.slice(i+1);const pending=worker.pending;worker.pending=null;
        if(!pending){child.kill('SIGKILL');return;}
        try{const result=JSON.parse(line);if(!result.ok){const e=new Error(result.message);e.code=result.code;pending.reject(e);}else pending.resolve(result.state);}catch(e){pending.reject(e);}
      });
      child.stderr.on('data',b=>{worker.stderr=(worker.stderr+b).slice(-50000);});child.stdin.on('error',()=>{});
      const lost=e=>{if(workers.get(storageRoot)===worker)workers.delete(storageRoot);worker.pending?.reject(e);worker.pending=null;};
      child.on('error',lost);child.on('close',code=>{const e=new Error(`Native worker exited (${code}); no run state committed`);e.code='NATIVE_FAILURE';lost(e);});
    }
    if(worker.pending){reject(Object.assign(new Error('Native worker must be serialized'),{code:'NATIVE_BUSY'}));return;}
    const child=worker.child;child.ref();child.stdin.ref?.();child.stdout.ref?.();child.stderr.ref?.();
    let settled=false;
    const finish=(f,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);child.unref();child.stdin.unref?.();child.stdout.unref?.();child.stderr.unref?.();f(value);};
    const cancel=()=>{const e=new Error('Native quote execution cancelled; no state committed');e.code='CANCELLED';e.name='AbortError';if(workers.get(storageRoot)===worker)workers.delete(storageRoot);worker.pending=null;child.kill('SIGKILL');finish(reject,e);};
    const timer=setTimeout(()=>{const e=new Error('Native worker exceeded explicit processing budget');e.code='NATIVE_TIMEOUT';if(workers.get(storageRoot)===worker)workers.delete(storageRoot);worker.pending=null;child.kill('SIGKILL');finish(reject,e);},timeoutMs);
    worker.pending={resolve:value=>finish(resolvePromise,value),reject:e=>finish(reject,e)};
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}
    child.stdin.write(JSON.stringify({...request,persistent:true,storageRoot})+'\n');
  });
}
async function immutableTicks(root,rows,signal) {
  aborted(signal);const bytes=Buffer.from(JSON.stringify(rows));if(bytes.length>128*1024*1024)fail('QUOTE_BUDGET','Single immutable quote step exceeds 128 MiB');
  const sha=digest(bytes),directory=join(root,'steps'),file=join(directory,sha.slice(7)+'.json');await fs.mkdir(directory,{recursive:true});
  try{await fs.writeFile(file,bytes,{flag:'wx'});await fs.chmod(file,0o444);}catch(e){if(e.code!=='EEXIST')throw e;const old=await fs.readFile(file);if(digest(old)!==sha)fail('HASH_MISMATCH','Existing immutable quote file differs');}
  aborted(signal);return{path:file,digest:sha,rowCount:rows.length,bytes:bytes.length,sourceTimeBasis:'UTC milliseconds'};
}
/** Stable as-of join. Same-ms ordering is retained independently within each source stream. */
export function joinAsOfQuotes(mainRows,fxRows,{fxMaxAgeMs=60000,zeroExposure=false,supplementalRows=[]}={}) {
  if(fxMaxAgeMs!==60000)fail('INVALID_FX_POLICY','Fixed challenge FX maximum age is 60000 ms, not a role-selectable rate');
  const output=[];let i=0,last=null,previous=-Infinity,fxPrevious=-Infinity,si=0,supplement=null,sp=-Infinity;
  for(const r of supplementalRows){if(!Number.isSafeInteger(r.time)||r.time<sp)fail('INVALID_DATA','Supplementary FX is not chronological UTC ms');sp=r.time;}
  for(const r of fxRows ?? []){if(!Number.isSafeInteger(r.time)||r.time<fxPrevious)fail('INVALID_DATA','FX source is not stable chronological UTC ms');fxPrevious=r.time;}
  for(let index=0;index<mainRows.length;index++){
    const r=mainRows[index];if(!Number.isSafeInteger(r.time)||r.time<previous)fail('INVALID_DATA','Main quotes are not stable chronological UTC ms');previous=r.time;
    while(i<(fxRows?.length ?? 0)&&fxRows[i].time<=r.time)last=fxRows[i++];
    while(si<supplementalRows.length&&supplementalRows[si].time<=r.time)supplement=supplementalRows[si++];
    const t={...copy(r),sourceSequence:index};
    if(fxRows){
      const originalFresh=last&&r.time-last.time<=fxMaxAgeMs;
      const selected=originalFresh?last:(supplement&&r.time-supplement.time<=fxMaxAgeMs?supplement:null);
      if(!selected){
        if(zeroExposure!==true)fail('INVALID_DATA','No last-known CHFJPY within 60000 ms; no future interpolation');
        // No conversion is performed. Retain the gap explicitly; never install
        // a stale/future/synthetic quote in the native conversion input.
        delete t.fx;delete t.fxAgeMs;
        t.fxUnavailable={reason:last?'stale':'no_asof_quote',lastKnownTime:last?.time??null,ageMs:last?r.time-last.time:null};
      }else{t.fx=copy(selected);t.fxAgeMs=r.time-selected.time;if(!originalFresh)t.fxSupplement={provider:selected.provider,originalLastKnownTime:last?.time??null,originalAgeMs:last?r.time-last.time:null};}
    }
    output.push(t);
  }
  return output;
}
/** Formal service API: prepared private env -> verified slice -> native worker -> candidate state.
 * Only the service's subsequent atomic CAS commits/reveals this candidate.
 */
export async function advanceNative(storageDirectory,state,decision,data,{signal,loadExecutionSlice:loader,loadFxSupplement:supplementLoader,timeoutMs}={}) {
  aborted(signal);const v=validateDecision(state,decision);if(v.duplicate)return copy(state);
  const root=await ownedRoot(storageDirectory);const key=root,epoch=lifecycleEpochs.get(root)??0;const guard=()=>{aborted(signal);if((lifecycleEpochs.get(root)??0)!==epoch)fail('CANCELLED','Native lifecycle disposed; no queued work or candidate may commit');};
  const previous=queues.get(key) ?? Promise.resolve();
  const operation=previous.catch(()=>{}).then(async()=>{
    guard();const status=await nativeStatus(storageDirectory,{signal});if(!status.ready)fail('NATIVE_NOT_PREPARED','Call explicit prepareNative; advance never installs/downloads dependencies');
    const f=data.frames?.[state.chapter];const chapter=state.chapters[state.chapter];const next=f?.[state.index+1];
    if(!next)return await decideAndAdvance(state,decision,f,{signal,pythonPath:status.pythonPath});
    const from=next.time,to=from+HOUR-1;
    const read=loader ?? (await import('./data.js')).loadExecutionSlice;
    let rows,fxRows,sources,kind,supplementalRows=[];
    try {
      const main=await read(storageDirectory,{chapterId:chapter.id,symbol:chapter.symbol,from,to,maxRows:500000});aborted(signal);
      if(main.symbol!==chapter.symbol||main.chapterId!==chapter.id||main.from!==from||main.to!==to||main.rangeConvention!=='inclusive UTC milliseconds')fail('SOURCE_MISMATCH','Execution slice identity or range differs from the exact requested instrument');
      kind=main.kind;if(kind!=='ticks')fail('UNSUPPORTED_DATA_KIND','Formal backend requires observed quote ticks; M1 OHLC is not tick data');rows=main.rows;sources=main.sources;
      if(chapter.symbol.endsWith('CHF')){
        const minimum=Math.max(Date.parse(chapter.playFrom ?? chapter.from ?? new Date(from-60000).toISOString()),from-60000);
        const fx=await read(storageDirectory,{chapterId:chapter.id,symbol:chapter.fxSymbol ?? 'CHFJPY',from:minimum,to,maxRows:500000});aborted(signal);
        if(fx.symbol!==(chapter.fxSymbol ?? 'CHFJPY')||fx.chapterId!==chapter.id||fx.from!==minimum||fx.to!==to)fail('SOURCE_MISMATCH','CHFJPY slice identity/range mismatch');
        if(fx.kind!=='ticks')fail('UNSUPPORTED_DATA_KIND','CHFJPY must also use actual quote ticks');fxRows=fx.rows;sources=[...sources,...fx.sources];
        if(supplementLoader||!loader){
          const load=supplementLoader??(state.rules.experimentProfile?.id===ROUND2_PROFILE_ID?(await import('./experiment-fx.js')).loadExperimentFx:(await import('./fx-supplement.js')).loadFxSupplement);
          const supplement=await load(storageDirectory,{runId:state.id,from,to,snapshotDigest:main.snapshotDigest,configDigest:main.configDigest});
          supplementalRows=supplement.rows;sources=[...sources,...supplement.sources];
        }
      }
      rows=joinAsOfQuotes(rows,fxRows,{zeroExposure:state.position===null&&decision.target==='0'&&decision.stop===null,supplementalRows});
    }catch(e){if(['INVALID_DATA','MISSING_DATA','NO_QUOTES','ENOENT','TIME_MISMATCH','SLICE_LIMIT'].includes(e.code)){const s=copy(state);s.status='missing_data';s.missingData={code:e.code,message:e.message,chapter:s.chapter,index:s.index,nextIndex:s.index+1};return s;}throw e;}
    const ref=await immutableTicks(root,rows,signal);
    const result=await decideAndAdvance(state,decision,f,{signal,pythonPath:status.pythonPath,storageRoot:root,persistent:true,stepRef:ref,quoteTicks:rows,
      coverage:{complete:true,from,to:from+HOUR,dataKind:'quote_ticks',liquidityAssumption:'unbounded_top_of_book',sources,
        historicalGaplessnessCertified:false,completeMeaning:'all actual returned rows of the verified local slice; not proof of gapless history'},
      invokeImpl:(request,options)=>{guard();return persistentInvoke(request,{...options,timeoutMs});}});
    guard();
    // A terminal interval may have stopped before its last quote. Persist ONLY
    // consumed rows in its durable journal; never expose an unconsumed suffix.
    for(const item of result.nativeJournal ?? [])if(item.ticks){item.ticksRef=await immutableTicks(root,item.ticks,signal);delete item.ticks;}
    if(result.nativeReceipt){result.nativeReceipt.journalBytes=Buffer.byteLength(JSON.stringify(result.nativeJournal));result.nativeReceipt.quoteFileBytes=result.nativeJournal.reduce((n,x)=>n+(x.ticksRef?.bytes ?? 0),0);}
    return result;
  });
  queues.set(key,operation);try{return await operation;}finally{if(queues.get(key)===operation)queues.delete(key);}
}

/** Kill only this module's registered child for the exact plugin-private root.
 * No filesystem creation, PID search, broad process kill or automatic restart. */
export async function disposeNative(storageDirectory) {
 if(typeof storageDirectory!=='string'||!storageDirectory)fail('INVALID_STORAGE','Plugin-private storageDirectory required');
 const root=join(resolve(storageDirectory),'kurumi-native');lifecycleEpochs.set(root,(lifecycleEpochs.get(root)??0)+1);const worker=workers.get(root);if(!worker)return{disposed:true,killed:false};workers.delete(root);
 const e=Object.assign(new Error('Native worker disposed; no candidate committed'),{code:'CANCELLED'});worker.pending?.reject(e);worker.pending=null;const child=worker.child;if(child.exitCode!==null||child.signalCode!==null)return{disposed:true,killed:false};
 await new Promise((resolvePromise,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');},1500);const hard=setTimeout(()=>{cleanup();reject(Object.assign(new Error('Owned native worker did not close after cancellation'),{code:'NATIVE_DISPOSE_TIMEOUT'}));},5000);const done=()=>{cleanup();resolvePromise();};const cleanup=()=>{clearTimeout(timer);clearTimeout(hard);child.removeListener('close',done);};child.once('close',done);child.kill('SIGTERM');});return{disposed:true,killed:true};
}

/** Read only the last actually consumed interval. This bridge never reads an execution slice. */
export async function consumedInterval(storageDirectory,engine,{signal}={}) {
  aborted(signal);const item=engine.nativeJournal?.at(-1);if(!item)return {ticks:[],interval:null};
  let ticks=item.ticks,rawBytes;
  if(item.ticksRef){
    const root=join(resolve(storageDirectory),'kurumi-native','steps'),file=resolve(item.ticksRef.path);
    if(!file.startsWith(root+'/')||await fs.realpath(file)!==file||(await fs.lstat(file)).isSymbolicLink())fail('UNSAFE_PATH','Consumed tick ref must be an owned ordinary immutable steps file');
    const bytes=await fs.readFile(file);if(bytes.length>128*1024*1024||digest(bytes)!==item.ticksRef.digest)fail('HASH_MISMATCH','Consumed quote bytes changed');
    rawBytes=bytes;ticks=JSON.parse(bytes);if(ticks.length!==item.ticksRef.rowCount)fail('HASH_MISMATCH','Consumed quote row count changed');
  }
  if(!Array.isArray(ticks)||!ticks.length)fail('INVALID_DATA','Committed native interval lacks consumed quote evidence');
  const entry=engine.decisions?.at(-1),chapter=entry?.executedChapter,index=entry?.executedIndex;
  const info=engine.lastConsumedInterval??{chapter,index,from:item.from,toExclusive:item.to,lastTime:ticks.at(-1).time,complete:!engine.bankrupt,rowCount:ticks.length};
  if(info.chapter!==chapter||info.index!==index||info.rowCount!==ticks.length||info.lastTime!==ticks.at(-1).time||info.from!==item.from||info.toExclusive!==item.to)fail('INVALID_DATA','Consumed interval/checkpoint mismatch');
  let previous=item.from-1;for(const t of ticks){if(!Number.isSafeInteger(t.time)||t.time<previous||t.time<item.from||t.time>=item.to||t.time>info.lastTime)fail('INVALID_DATA','Unconsumed/future tick in checkpoint');previous=t.time;}
  if(info.complete!==!engine.bankrupt)fail('INVALID_DATA','Terminal partial interval cannot be marked complete');
  return {ticks:copy(ticks),interval:copy(info),bytes:rawBytes};
}
