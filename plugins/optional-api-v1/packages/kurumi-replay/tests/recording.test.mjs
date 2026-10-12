// Independent acceptance tests; never changes the real challenge or app state.
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const source=process.argv[2]??new URL('../recording.js',import.meta.url).pathname;
const {Recorder}=await import(pathToFileURL(source));
const root=await mkdtemp(join(tmpdir(),'sesame-recording-acceptance-'));
const outcomes=[];
async function check(name,fn){try{await fn();outcomes.push({name,passed:true});}catch(e){outcomes.push({name,passed:false,error:e.message});}}
function assert(ok,message){if(!ok)throw new Error(message);}
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x===undefined?null:x);
const sha=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
await check('concurrent appends have a single contiguous hash chain',async()=>{
 const storage=join(root,'concurrency');const mirror=join(root,'concurrency-mirror');
 const r=new Recorder(storage,{mirrorRoot:mirror});
 await Promise.all(Array.from({length:24},(_,i)=>r.append('probe',{i},{simClockMs:1000+i})));
 const raw=await readFile(join(storage,'recording','journal.ndjson'),'utf8');
 const rows=raw.trim().split('\n').map(JSON.parse);
 assert(rows.length===24,'some concurrent records were lost');
 rows.forEach((row,i)=>{assert(row.seq===i+1,'duplicate/out of order sequence at '+i);if(i)assert(row.prevDigest===rows[i-1].digest,'broken hash link at '+i);});
 assert(raw===await readFile(join(mirror,'journal.ndjson'),'utf8'),'mirror differs');
});
await check('oversize role logs fail instead of being silently omitted',async()=>{
 const r=new Recorder(join(root,'budget'),{mirrorRoot:join(root,'budget-mirror')});
 const src=join(root,'budget-source');await mkdir(src);await writeFile(join(src,'session.jsonl'),'complete role transcript');
 let failed=false;try{await r.copyTree(src,'role',{maxFileBytes:1});}catch{failed=true;}
 assert(failed,'oversize session was silently skipped');
});
await check('clock and sequence metadata are covered by the record digest',async()=>{
 const r=new Recorder(join(root,'metadata'),{mirrorRoot:join(root,'metadata-mirror')});
 const row=await r.append('probe',{input:'real'},{simClockMs:1234});
 const {digest,...body}=row;
 const coversAll=sha(Buffer.from(canonical(body)))===digest;
 assert(coversAll,'digest does not cover the entire record including sequence and clocks');
});
await check('restart validates earlier records instead of trusting only the tail',async()=>{
 const storage=join(root,'tamper');const mirror=join(root,'tamper-mirror');
 const r=new Recorder(storage,{mirrorRoot:mirror});await r.append('first',{a:1});await r.append('second',{a:2});
 const file=join(storage,'recording','journal.ndjson');const text=await readFile(file,'utf8');
 await writeFile(file,text.replace('"a":1','"a":9'));
 let failed=false;try{await new Recorder(storage,{mirrorRoot:mirror}).initialize();}catch{failed=true;}
 assert(failed,'tampered earlier record was accepted');
});
await check('mirror failure never creates duplicate sequence numbers on retry',async()=>{
 const storage=join(root,'mirror-failure');const mirror=join(root,'mirror-failure-mirror');
 const r=new Recorder(storage,{mirrorRoot:mirror});await r.initialize();
 await mkdir(join(mirror,'journal.ndjson'));
 for(let i=0;i<2;i++)try{await r.append('probe',{i});}catch{}
 const rows=(await readFile(join(storage,'recording','journal.ndjson'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 assert(new Set(rows.map(x=>x.seq)).size===rows.length,'retry duplicated a sequence in authoritative journal');
});
await check('successful mirror repair continues after the already-durable primary record',async()=>{
 const storage=join(root,'mirror-repair');const mirror=join(root,'mirror-repair-copy');
 const r=new Recorder(storage,{mirrorRoot:mirror});await r.initialize();await mkdir(join(mirror,'journal.ndjson'));
 try{await r.append('before-repair',{n:1});}catch{}
 await rm(join(mirror,'journal.ndjson'),{recursive:true});
 await r.append('after-repair',{n:2});
 const text=await readFile(join(storage,'recording','journal.ndjson'),'utf8');const rows=text.trim().split('\n').map(JSON.parse);
 assert(rows.length===2&&rows[0].seq===1&&rows[1].seq===2,'repaired recorder reused an already-committed sequence');
 assert(rows[1].prevDigest===rows[0].digest,'repaired recorder linked to an outdated digest');
 assert(await readFile(join(mirror,'journal.ndjson'),'utf8')===text,'repaired copies differ');
});
await check('restart repairs or rejects a shorter mirror before another append',async()=>{
 const storage=join(root,'restart-mirror');const mirror=join(root,'restart-mirror-copy');
 const r=new Recorder(storage,{mirrorRoot:mirror});await r.append('one',{});await r.append('two',{});
 const file=join(mirror,'journal.ndjson');const text=await readFile(file,'utf8');await writeFile(file,text.split('\n')[0]+'\n');
 let rejected=false;try{await new Recorder(storage,{mirrorRoot:mirror}).append('three',{});}catch{rejected=true;}
 if(!rejected)assert(await readFile(file,'utf8')===await readFile(join(storage,'recording','journal.ndjson'),'utf8'),'restart silently left a gap in the mirror');
});
await check('streamed UTF-8 journal reload and multi-chunk mirror recovery preserve exact bytes',async()=>{
 const storage=join(root,'streamed'),mirror=join(root,'streamed-mirror');const r=new Recorder(storage,{mirrorRoot:mirror});
 await r.append('one',{text:'久留美🙂'.repeat(110000)});const first=await readFile(join(mirror,'journal.ndjson'));
 await r.append('two',{text:'历史行情与账户记录'.repeat(150000)});
 const primary=await readFile(join(storage,'recording','journal.ndjson'));
 await writeFile(join(mirror,'journal.ndjson'),first);
 const restarted=new Recorder(storage,{mirrorRoot:mirror});await restarted.initialize();
 assert(restarted.seq===2,'streamed tail lost records');assert(primary.equals(await readFile(join(mirror,'journal.ndjson'))),'multi-chunk mirror recovery changed bytes');
 await writeFile(join(mirror,'journal.ndjson'),primary.subarray(0,primary.length-1));
 let rejected=false;try{await new Recorder(storage,{mirrorRoot:mirror}).initialize();}catch{rejected=true;}
 assert(rejected,'partial final record was silently repaired');
});
await check('SQLite snapshot and session bytes are sealed identically in both copies',async()=>{
 const storage=join(root,'seal');const mirror=join(root,'seal-mirror');const src=join(root,'task');
 await mkdir(join(src,'sessions'),{recursive:true});const transcript='{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"'+ 'x'.repeat(20000)+'"}]}}\n';
 await writeFile(join(src,'sessions','role.jsonl'),transcript);
 const db=new DatabaseSync(join(src,'runtime.sqlite'));db.exec('PRAGMA journal_mode=WAL;CREATE TABLE events(seq INTEGER,body TEXT);');db.prepare('INSERT INTO events VALUES(?,?)').run(1,JSON.stringify({type:'message.delta',data:{delta:'visible output'}}));
 const r=new Recorder(storage,{mirrorRoot:mirror});await r.protectRun('run_acceptance',src,{simClockMs:123});
 db.close();
 const bases=[join(storage,'recording','runs','run_acceptance'),join(mirror,'runs','run_acceptance')];
 const a=await readFile(join(bases[0],'runtime.sqlite'));const b=await readFile(join(bases[1],'runtime.sqlite'));assert(a.equals(b),'two SQLite snapshots differ');
 assert(await readFile(join(bases[0],'task-files','sessions','role.jsonl'),'utf8')===transcript,'session truncated');
 const copy=new DatabaseSync(join(bases[0],'runtime.sqlite'),{readOnly:true});assert(copy.prepare('SELECT COUNT(*) AS n FROM events').get().n===1,'SQLite WAL data lost');copy.close();
 await rm(join(bases[1],'task-files','sessions','role.jsonl'));
 let failed=false;try{await r.protectRun('run_acceptance',src);}catch{failed=true;}
 let recovered=false;try{recovered=await readFile(join(bases[1],'task-files','sessions','role.jsonl'),'utf8')===transcript;}catch{}
 assert(failed||recovered,'sealed marker accepted a missing mirror transcript');
});
console.log(JSON.stringify({source,auditRoot:root,passed:outcomes.filter(x=>x.passed).length,total:outcomes.length,outcomes},null,2));
process.exitCode=outcomes.every(x=>x.passed)?0:1;
