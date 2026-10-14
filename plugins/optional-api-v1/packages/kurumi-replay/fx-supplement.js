// Explicit local import of observed direct CHFJPY quotes. No network or account writes.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { storage, safePath, readBounded, hash, fail, Budget } from './scripts/data-core.mjs';

const MAX_CSV = 100 * 1024 * 1024;
const checked = (ok, message) => { if (!ok) fail('INVALID_FX_SUPPLEMENT', message); };
const runPath = id => { checked(/^kurumi-[a-f0-9-]{36}$/.test(id), 'Invalid bound run ID'); return `fx-supplements/${id}`; };
const ref = (name, bytes) => ({path:name, bytes:bytes.length, digest:hash(bytes)});
async function verified(root, item, max) {
  const bytes = await readBounded(root, item.path, max);
  checked(bytes.length === item.bytes && hash(bytes) === item.digest, 'Supplement source bytes/hash changed');
  return bytes;
}
export function parseHistDataCSV(bytes, {from, toExclusive, source}) {
  checked(Number.isSafeInteger(from) && Number.isSafeInteger(toExclusive) && from < toExclusive && toExclusive-from <= 31*3600000, 'Supplement window must be explicit and bounded');
  const rows=[]; let previous='', lineNumber=0;
  const lower = new Date(from-60000-5*3600000).toISOString().slice(0,19).replace(/[-:T]/g, c=>c==='T'?' ':'')+'000';
  const upper = new Date(toExclusive-5*3600000).toISOString().slice(0,19).replace(/[-:T]/g, c=>c==='T'?' ':'')+'000';
  for (const line of bytes.toString('ascii').split(/\r?\n/)) {
    lineNumber++; if (!line) continue;
    const fields=line.split(','), stamp=fields[0];
    checked(fields.length===4 && /^\d{8} \d{9}$/.test(stamp) && stamp>=previous, 'Malformed or unordered HistData CSV'); previous=stamp;
    if (stamp<lower || stamp>=upper) continue;
    const date=Date.UTC(+stamp.slice(0,4),+stamp.slice(4,6)-1,+stamp.slice(6,8),+stamp.slice(9,11),+stamp.slice(11,13),+stamp.slice(13,15),+stamp.slice(15,18));
    const normalized=new Date(date).toISOString().replace(/[-:TZ.]/g,'');
    checked(normalized===stamp.replace(' ',''), 'Invalid calendar timestamp');
    const time=date+5*3600000; // HistData documents fixed EST, never US DST.
    checked(time>=from-60000 && time<toExclusive, 'Timestamp outside declared window');
    checked(/^\d+\.\d{3}000$/.test(fields[1]) && /^\d+\.\d{3}000$/.test(fields[2]), 'Lossless three-decimal CHFJPY precision required');
    const bid=fields[1].slice(0,-3), ask=fields[2].slice(0,-3);
    checked(BigInt(bid.replace('.',''))>0n && BigInt(ask.replace('.',''))>=BigInt(bid.replace('.','')), 'Invalid observed bid/ask');
    rows.push({time,bid,ask,source,sourceLine:lineNumber,provider:'HistData.com',originalTimestamp:stamp});
    checked(rows.length<=500000, 'Supplement exceeds row budget');
  }
  checked(rows.length>0,'No observed quotes in requested window'); return rows;
}
export async function prepareFxSupplement(bundleDirectory, expected) {
  checked(path.isAbsolute(bundleDirectory), 'Absolute local source bundle required');
  const stat=await fs.lstat(bundleDirectory);
  checked(stat.isDirectory()&&!stat.isSymbolicLink(),'Source bundle must be an ordinary directory');
  const root=await fs.realpath(bundleDirectory), bytes=await readBounded(root,'source.json',65536), m=JSON.parse(bytes);
  checked(m.schemaVersion===1 && m.provider==='HistData.com' && m.symbol==='CHFJPY' && m.format==='generic_ascii_ticks' && m.timezone==='EST_UTC_MINUS_05_NO_DST','Unsupported direct-quote source contract');
  checked(m.runId===expected.runId && m.snapshotDigest===expected.snapshotDigest && m.configDigest===expected.configDigest,'Supplement belongs to another run or frozen snapshot');
  checked(Number.isSafeInteger(m.from) && m.from>=expected.from && m.toExclusive<=expected.toExclusive,'Supplement must only cover uncommitted hours');
  checked(m.download?.url==='https://www.histdata.com/get.php' && m.download?.httpStatus===200 && m.download?.tlsAuthenticated===true && Number.isFinite(Date.parse(m.download?.observedAt)),'Missing authenticated source download receipt');
  checked(m.raw.path==='quotes.csv' && m.zip.path==='download.zip','Unexpected raw source filenames');
  const raw=await verified(root,m.raw,MAX_CSV), zip=await verified(root,m.zip,32*1024*1024);
  const key=hash(bytes).slice(7), base=`${runPath(m.runId)}/${key}`;
  const rows=parseHistDataCSV(raw,{...m,source:`${base}/quotes.csv`});
  const projection=Buffer.from(JSON.stringify(rows)+'\n');
  const index={schemaVersion:1,runId:m.runId,from:m.from,toExclusive:m.toExclusive,snapshotDigest:m.snapshotDigest,configDigest:m.configDigest,
    manifest:ref(`${base}/source.json`,bytes),raw:ref(`${base}/quotes.csv`,raw),zip:ref(`${base}/download.zip`,zip),quotes:ref(`${base}/quotes.json`,projection),
    policy:'Original direct quote first when age <=60000ms; only otherwise use latest observed supplementary direct quote at or before event time, age <=60000ms; no interpolation'};
  return {index,files:[[index.manifest,bytes],[index.raw,raw],[index.zip,zip],[index.quotes,projection]],rowCount:rows.length};
}
export async function publishFxSupplement(storageDirectory, prepared) {
  const root=await storage(storageDirectory,false), pointer=`${runPath(prepared.index.runId)}/active.json`;
  let old; try {old=JSON.parse(await readBounded(root,pointer,65536));} catch(e){if(e.code!=='ENOENT')throw e;}
  if(old){checked(isDeepStrictEqual(old,prepared.index),'An existing supplement cannot be silently replaced');return {reused:true,index:old};}
  const budget=await Budget.create(root);
  for(const [item,bytes] of prepared.files){
    let prior;try{prior=await readBounded(root,item.path,MAX_CSV);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(prior)checked(prior.equals(bytes),'Immutable supplement object conflicts');else await budget.write(item.path,bytes);
  }
  const file=await safePath(root,pointer,true), body=JSON.stringify(prepared.index)+'\n';
  // Publish atomically only once. Unpublished immutable objects are safe to retry.
  const temporary=file+'.staging-'+process.pid;
  await fs.writeFile(temporary,body,{flag:'wx',mode:0o600});
  try{await fs.link(temporary,file);}finally{await fs.unlink(temporary);}
  return {reused:false,index:prepared.index};
}
export async function loadFxSupplement(storageDirectory, {runId,from,to,snapshotDigest,configDigest}) {
  const root=await storage(storageDirectory,false), pointer=`${runPath(runId)}/active.json`;
  let index; try{index=JSON.parse(await readBounded(root,pointer,65536));}catch(e){if(e.code==='ENOENT')return {rows:[],sources:[]};throw e;}
  checked(index.schemaVersion===1 && index.runId===runId && index.snapshotDigest===snapshotDigest && index.configDigest===configDigest,'Supplement binding changed');
  if(from<index.from || to>=index.toExclusive)return {rows:[],sources:[]};
  const manifest=JSON.parse(await verified(root,index.manifest,65536));
  await verified(root,index.raw,MAX_CSV);
  const rows=JSON.parse(await verified(root,index.quotes,64*1024*1024));
  checked(rows.length<=500000,'Supplement row budget exceeded');
  return {rows:rows.filter(r=>r.time>=from-60000&&r.time<=to),sources:[{...index.raw,url:manifest.download.url,observedAt:manifest.download.observedAt,transportScheme:'https',tlsAuthenticated:true,
    provider:manifest.provider,symbol:'CHFJPY',supplement:true,manifestDigest:index.manifest.digest,projectionDigest:index.quotes.digest,originalZip:index.zip,policy:index.policy}]};
}
