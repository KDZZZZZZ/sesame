// Per-install portable recorder selection. Legacy archives are never guessed/moved.
import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import { join,resolve,isAbsolute,sep } from 'node:path';
import { canonical } from './experiment-profiles.js';
const fail=(code,m)=>{throw Object.assign(new Error(m),{code});};
async function exists(p){try{return await fs.lstat(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function plainDirectory(p){let q=resolve(p);while(true){const st=await exists(q);if(st&&(st.isSymbolicLink()||!st.isDirectory()))fail('UNSAFE_PATH','Recorder selection path has link/non-directory ancestry');const next=resolve(q,'..');if(next===q)break;q=next;}}
async function digest(p){const h=createHash('sha256');for await(const c of createReadStream(p))h.update(c);return 'sha256:'+h.digest('hex');}
export async function recordingSelection(directory,{mirrorRoot,acknowledgeExisting=false}={}){
 if(!isAbsolute(directory))fail('INVALID_STORAGE','Actual plugin-private directory required');
 await plainDirectory(directory);const file=join(directory,'recording-selection.json'),primary=join(directory,'recording'),saved=await exists(file);
 if(saved){if(!saved.isFile()||saved.isSymbolicLink())fail('UNSAFE_PATH','Recorder selection must be an ordinary file');const record=JSON.parse(await fs.readFile(file,'utf8'));if(record.schemaVersion!==1||!['private','explicit'].includes(record.mode))fail('RECORDING_SELECTION_INVALID','Unknown persisted recorder selection');const path=record.mode==='private'?join(directory,'recording-mirror'):record.path;if(mirrorRoot&&resolve(mirrorRoot)!==resolve(path))fail('RECORDING_SELECTION_CONFLICT','Existing install is pinned; never silently move old recording');await plainDirectory(path);return {record,mirrorRoot:path,persisted:true};}
 const old=await exists(primary),entries=old?await fs.readdir(primary):[],hasPrior=entries.some(x=>x!=='private');
 if(hasPrior&&(!mirrorRoot||acknowledgeExisting!==true))fail('MIRROR_SELECTION_REQUIRED','Existing legacy recording requires explicit verified mirror pin; no author path guess or silent relocation');
 const record=mirrorRoot?{schemaVersion:1,mode:'explicit',path:resolve(mirrorRoot)}:{schemaVersion:1,mode:'private',relativePath:'recording-mirror'};
 const path=record.mode==='private'?join(directory,'recording-mirror'):record.path;
 if(!isAbsolute(path)||resolve(path)===resolve(primary)||resolve(path).startsWith(resolve(primary)+sep)||resolve(primary).startsWith(resolve(path)+sep))fail('INVALID_MIRROR','Dual copy mirror must be outside primary archive');await plainDirectory(path);
 if(hasPrior){const a=join(primary,'journal.ndjson'),b=join(path,'journal.ndjson'),as=await exists(a),bs=await exists(b);if(!as?.isFile()||!bs?.isFile()||as.isSymbolicLink()||bs.isSymbolicLink()||as.size!==bs.size||await digest(a)!==await digest(b))fail('ARCHIVE_MIRROR_MISMATCH','Explicit legacy mirror must match complete primary journal bytes; preserve old files');}
 if(!hasPrior){const stray=await exists(join(path,'journal.ndjson'));if(stray&&(!stray.isFile()||stray.isSymbolicLink()||stray.size>0))fail('ARCHIVE_MIRROR_MISMATCH','Fresh primary cannot silently adopt an unrelated/nonempty mirror journal');}
 await fs.mkdir(directory,{recursive:true});const body=Buffer.from(canonical(record)+'\n'),tmp=file+'.stage-'+randomUUID();const fd=await fs.open(tmp,'wx',0o600);try{await fd.writeFile(body);await fd.sync();}finally{await fd.close();}
 try{await fs.link(tmp,file);}catch(e){if(e.code!=='EEXIST')throw e;if(!(await fs.readFile(file)).equals(body))fail('RECORDING_SELECTION_CONFLICT','Concurrent different installation selection');}finally{await fs.unlink(tmp);}
 return {record,mirrorRoot:path,persisted:true};
}
