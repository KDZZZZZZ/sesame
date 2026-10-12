// Explicit, full eligible-window binding for NEW experiments. Never copies an old pointer.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseHistDataCSV } from './fx-supplement.js';
import { canonical, sha256 } from './experiment-profiles.js';
const check=(ok,m)=>{if(!ok)throw Object.assign(new Error(m),{code:'INVALID_FX_SUPPLEMENT'});};
const H=3600000;
const runPath=id=>{check(/^kurumi-[a-f0-9-]{36}$/.test(id),'Invalid new run binding');return `fx-supplements/${id}`;};
const ref=(p,b)=>({path:p,bytes:b.length,digest:sha256(b)});
async function ordinary(p,max){const st=await fs.lstat(p);check(st.isFile()&&!st.isSymbolicLink()&&st.size<=max&&await fs.realpath(p)===path.resolve(p),'Ordinary bounded file required');return fs.readFile(p);}
async function verified(root,r,max){check(typeof r?.path==='string'&&!path.isAbsolute(r.path)&&!r.path.split('/').includes('..'),'Source path escape');const b=await ordinary(path.join(root,r.path),max);check(b.length===r.bytes&&sha256(b)===r.digest,'Source bytes/hash changed');return b;}
export async function prepareExperimentFx(bundleDirectory,expected) {
  check(path.isAbsolute(bundleDirectory),'Absolute source bundle required');const st=await fs.lstat(bundleDirectory);check(st.isDirectory()&&!st.isSymbolicLink(),'Ordinary source directory required');
  const root=await fs.realpath(bundleDirectory),bytes=await ordinary(path.join(root,'source.json'),65536),m=JSON.parse(bytes);
  check(m.schemaVersion===2&&m.provider==='HistData.com'&&m.symbol==='CHFJPY'&&m.format==='generic_ascii_ticks'&&m.timezone==='EST_UTC_MINUS_05_NO_DST','New full-window manifest schema2 required');
  check(m.runId===expected.runId&&m.snapshotDigest===expected.snapshotDigest&&m.configDigest===expected.configDigest,'Explicit source manifest must bind exact NEW run/snapshot');
  check(m.from===expected.from&&m.toExclusive===expected.toExclusive&&m.from%H===0&&m.toExclusive%H===0&&m.from<m.toExclusive&&m.toExclusive-m.from<=31*24*H,'Full legal eligible chapter window required; partial old24H bundle rejected');
  check(m.download?.url==='https://www.histdata.com/get.php'&&m.download.httpStatus===200&&m.download.tlsAuthenticated===true&&Number.isFinite(Date.parse(m.download.observedAt)),'Authenticated original download receipt required');
  check(m.raw.path==='quotes.csv'&&m.zip.path==='download.zip','Fixed source filenames required');
  const raw=await verified(root,m.raw,100*1024*1024),zip=await verified(root,m.zip,32*1024*1024),base=`${runPath(m.runId)}/${sha256(bytes).slice(7)}`;
  const rows=[];for(let from=m.from;from<m.toExclusive;from+=24*H){const toExclusive=Math.min(from+24*H,m.toExclusive);
    let parsed;try{parsed=parseHistDataCSV(raw,{from,toExclusive,source:`${base}/quotes.csv`});}catch(e){if(e.code==='INVALID_FX_SUPPLEMENT'&&e.message==='No observed quotes in requested window')parsed=[];else throw e;}
    for(const r of parsed)if(r.time>=(from===m.from?from-60000:from))rows.push(r);check(rows.length<=5000000,'Full-window quote budget exceeded');}
  check(rows.length>0,'No observed quotes in full legal window');
  const projection=Buffer.from(canonical(rows)+'\n');check(projection.length<=128*1024*1024,'Full-window projection byte budget exceeded');
  const index={schemaVersion:2,runId:m.runId,from:m.from,toExclusive:m.toExclusive,snapshotDigest:m.snapshotDigest,configDigest:m.configDigest,
    manifest:ref(`${base}/source.json`,bytes),raw:ref(`${base}/quotes.csv`,raw),zip:ref(`${base}/download.zip`,zip),quotes:ref(`${base}/quotes.json`,projection),
    coverage:{windowBound:true,gaplessnessCertified:false,completeForArbitraryExposure:false,note:'Actual observed quotes only; FX60s gaps remain hard missing-data gates'},
    policy:'Original fresh direct quote first; otherwise observed supplemental last-known <=event and age<=60000ms; no interpolation'};
  return {index,rowCount:rows.length,files:[[index.manifest,bytes],[index.raw,raw],[index.zip,zip],[index.quotes,projection]]};
}
async function immutable(file,bytes){await fs.mkdir(path.dirname(file),{recursive:true});check(await fs.realpath(path.dirname(file))===path.resolve(path.dirname(file)),'Supplement path symlink ancestry');try{const old=await fs.readFile(file);check(old.equals(bytes),'Immutable supplemental object conflicts');return;}catch(e){if(e.code!=='ENOENT')throw e;}
  const tmp=file+'.stage-'+process.pid;const fd=await fs.open(tmp,'wx',0o600);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
  try{await fs.link(tmp,file);}catch(e){if(e.code!=='EEXIST')throw e;check((await fs.readFile(file)).equals(bytes),'Immutable publication conflict');}finally{await fs.unlink(tmp);}}
export async function publishExperimentFx(storageDirectory,prepared){
  const root=path.join(storageDirectory,'kurumi-data-v1');check((await fs.lstat(root)).isDirectory()&&await fs.realpath(root)===path.resolve(root),'Owned data root required');
  const pointer=path.join(root,runPath(prepared.index.runId),'active.json');let old;try{old=JSON.parse(await fs.readFile(pointer,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(old){check(isDeepStrictEqual(old,prepared.index),'Existing new-run supplement differs; no silent replacement');return {reused:true};}
  for(const[r,b]of prepared.files)await immutable(path.join(root,r.path),b);await immutable(pointer,Buffer.from(canonical(prepared.index)+'\n'));return {reused:false};
}
export async function loadExperimentFx(storageDirectory,{runId,from,to,snapshotDigest,configDigest}) {
  const root=path.join(storageDirectory,'kurumi-data-v1');let index;try{index=JSON.parse(await ordinary(path.join(root,runPath(runId),'active.json'),65536));}catch(e){if(e.code==='ENOENT')return {rows:[],sources:[]};throw e;}
  check(index.schemaVersion===2&&index.runId===runId&&index.snapshotDigest===snapshotDigest&&index.configDigest===configDigest,'New-run FX binding changed');
  if(from<index.from||to>=index.toExclusive)return {rows:[],sources:[]};
  const m=JSON.parse(await verified(root,index.manifest,65536));await verified(root,index.raw,100*1024*1024);await verified(root,index.zip,32*1024*1024);
  const all=JSON.parse(await verified(root,index.quotes,128*1024*1024));check(all.length<=5000000,'Quote budget exceeded');const rows=all.filter(r=>r.time>=from-60000&&r.time<=to);check(rows.length<=500000,'H1 slice quote budget exceeded');
  return {rows,sources:[{...index.raw,provider:m.provider,url:m.download.url,observedAt:m.download.observedAt,tlsAuthenticated:true,symbol:'CHFJPY',supplement:true,manifestDigest:index.manifest.digest,projectionDigest:index.quotes.digest,policy:index.policy,runId}]};
}
