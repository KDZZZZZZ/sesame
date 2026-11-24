import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, readFileSync, existsSync, lstatSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readSurfaceFiles, parseYaml, writeYaml, createProtocolFiles, buildSurfaceLock } from '../directory.mjs';
import { readWorkflowDefinitions } from '../workflow/definition.mjs';
import { assert, packageSnapshot, relativeFile, readCase, runCase, sha } from './replay.mjs';
import { sandboxCall } from './sandbox.mjs';

const categories = ['requirement','host','implementation','element','model'];
const slug = (id) => { assert(typeof id === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/.test(id) && !id.endsWith('.'),'Invalid draft or record ID'); return id; };
function inside(root, path) {
  let dir = resolve(root);
  const base=lstatSync(dir);
  assert(base.isDirectory() && !base.isSymbolicLink(), 'Draft root must be an ordinary directory');
  for (const component of relativeFile(path).split('/')) {
    dir = join(dir,component);
    const stat = lstatSync(dir,{throwIfNoEntry:false});
    assert(!stat || !stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile() && stat.nlink === 1),'Draft contains a link or special file');
  }
  return dir;
}
function atomic(path, bytes) {
  mkdirSync(dirname(path),{recursive:true});
  const tmp = path + '.' + randomUUID() + '.tmp';
  try { writeFileSync(tmp,bytes,{flag:'wx'}); renameSync(tmp,path); }
  finally { if (existsSync(tmp)) unlinkSync(tmp); }
}
export function diffSurface(a,b) {
  const left=a.surface.elements,right=b.surface.elements;
  const changes=Object.keys({...left,...right}).sort().filter(id=>left[id]!==right[id]).map(id=>({id,from:left[id]??null,to:right[id]??null}));
  const level=changes.some(c=>!c.to || c.from && /\.(?:input|output)$/.test(c.id))?'major':changes.some(c=>!c.from)?'minor':changes.length?'patch':'none';
  return {from:a.surface.digest,to:b.surface.digest,changes,suggestedBump:level};
}
function ledger(root) {
  mkdirSync(root,{recursive:true,mode:0o700});
  const db=new DatabaseSync(join(root,'optimizer.sqlite'));
  db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT,body TEXT NOT NULL, PRIMARY KEY(kind,id))');
  return {db, get(kind,id){const row=db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind,id);assert(row,'Unknown '+kind+': '+id);return JSON.parse(row.body);},
    list(kind){return db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid').all(kind).map(row=>JSON.parse(row.body));},
    put(kind,row){db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind,row.id,JSON.stringify(row));return row;}};
}
function experiment(a,b,cases,repeats) {
  assert(a.manifest.id===b.manifest.id,'Compare versions of the same plugin');
  assert(Number.isInteger(repeats) && repeats>=1 && repeats<=20,'Invalid number of repetitions');
  const pairs=[];
  for(let i=0;i<repeats;i++) for(const test of cases) {
    const order=i%2?['candidate','baseline']:['baseline','candidate'];
    const results=Object.fromEntries(order.map(lane=>[lane,runCase(lane==='baseline'?a:b,test,sandboxCall)]));
    pairs.push({id:test.doc.id,order,...results});
  }
  const regression=pairs.some(p=>p.baseline.checks.some((c,i)=>c.pass&&!p.candidate.checks[i].pass));
  const improvement=pairs.some(p=>p.baseline.checks.some((c,i)=>!c.pass&&p.candidate.checks[i].pass));
  return {id:randomUUID(),createdAt:new Date().toISOString(),baseline:a.tree,candidate:b.tree,surface:diffSurface(a,b),caseDigests:cases.map(c=>c.digest),repeats,pairs,regression,improvement,verified:improvement&&!regression&&pairs.every(p=>p.candidate.passed===p.candidate.total)};
}
function caseFromRecord(row) {
  assert(sha(JSON.stringify([row.doc,row.fixtures]))===row.digest,'Stored case digest mismatch');
  return row;
}
function changeFile(root,input,command) {
  const path=relativeFile(input.path);
  assert(/^(?:tools\/[a-z][a-z0-9_]*\.yaml|workflows\/[a-z][a-z0-9._-]*\.yaml|instructions\.md|messages\.yaml|skills\/[a-z0-9-]+\/SKILL\.md)$/.test(path),'Not an editable surface source');
  const files=readSurfaceFiles(root), header=parseYaml(files['plugin.yaml']);
  const ext=header['x-sesame'], declaration=ext.contributions;
  assert(command==='surface.add'?!Object.hasOwn(files,path):Object.hasOwn(files,path),'Unexpected draft source state');
  if(command==='surface.rm') delete files[path]; else { assert(typeof input.text==='string' && Buffer.byteLength(input.text)<=2*1024*1024,'Source text required'); files[path]=input.text; }
  if(path.startsWith('tools/') && command!=='surface.set') {
    const ref='tool/'+path.slice(6,-5);
    const caps=declaration.capabilities;
    if(command==='surface.add') caps.push(ref); else { assert(caps.includes(ref),'Missing tool contribution'); caps.splice(caps.indexOf(ref),1); }
    files['plugin.yaml']=writeYaml(header);
  }
  if(command==='surface.rm') {
    declaration.knowledge=(declaration.knowledge??[]).filter(item=>item.path!==path);
    for(const key of ['prompts','resources','skills']) if(ext[key]) ext[key]=ext[key].filter(item=>item!==path);
    if(path.startsWith('skills/') && !Object.keys(files).some(file=>file.endsWith('/SKILL.md'))) ext.skills=[];
  }
  if(command==='surface.add' && path.endsWith('/SKILL.md')) {
    ext.skills=[...new Set([...(ext.skills??[]),'skills'])];
    declaration.knowledge??=[];
    declaration.knowledge.push({kind:'skill',id:path.split('/')[1],path,description:path.split('/')[1]});
  }
  files['plugin.yaml']=writeYaml(header);
  const lock=buildSurfaceLock(files);
  readWorkflowDefinitions(files,header.id);
  const target=inside(root,path);
  if(command==='surface.rm') unlinkSync(target); else atomic(target,files[path]);
  atomic(inside(root,'plugin.yaml'),files['plugin.yaml']);
  atomic(inside(root,'surface.lock.json'),JSON.stringify(lock,null,2)+'\n');
  return {path,surface:lock.digest};
}
// A trusted caller supplies roots and the human decision callback. Arguments from
// agent-visible tools cannot supply either authority or a database destination.
export async function perform(command,input={},env={}) {
  if(command.startsWith('trace.') || command==='findings.inbox') {
    assert(typeof env.query==='function','A session-authorized host connection is required');
    return env.query(command,input);
  }
  assert(typeof env.draftRoot==='string' && typeof env.recordRoot==='string','Optimizer workspace required');
  mkdirSync(env.draftRoot,{recursive:true});
  const draft=id=>inside(env.draftRoot,slug(id));
  const snap=id=>packageSnapshot(draft(id));
  const records=ledger(env.recordRoot);
  records.db.exec('BEGIN IMMEDIATE');
  try {
    let result;
    switch(command) {
      case 'init': {
        const root=draft(input.draft);
        assert(!existsSync(root),'Draft already exists');
        assert(/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(input.id) && typeof input.goal==='string' && input.goal.trim(),'Package identity and goal required');
        const manifest={id:input.id,version:'0.1.0',title:input.title||input.id,description:input.goal,license:'UNLICENSED',engines:{sesame:'>=0.3.0-dev.1 <0.4.0'},default_state:'discoverable',skills:[],prompts:['instructions.md']};
        const files=createProtocolFiles(manifest,{capabilities:[],configSchema:{type:'object'},knowledge:[],sources:[],views:[],hooks:[],services:[],artifactSchemas:[],stateCollections:[]},{'instructions.md':input.goal+'\n','package.json':JSON.stringify({name:input.id.split('/')[1],version:'0.1.0',type:'module',license:'UNLICENSED'},null,2)+'\n','LICENSE':'All rights reserved.\n'});
        mkdirSync(root);for(const [path,bytes] of Object.entries(files)) atomic(inside(root,path),bytes);
        result={id:input.id,draft:input.draft,surface:snap(input.draft).surface.digest};break;
      }
      case 'surface.ls': result=snap(input.draft).surface;break;
      case 'surface.show': {
        const p=snap(input.draft), id=input.element;
        assert(Object.hasOwn(p.surface.elements,id),'Unknown element');
        const key=id.slice(p.manifest.id.length+1), tool=/^tool\/(.+)\.(description|input|output|error\/.*)$/.exec(key);
        let source,value;
        if(tool) {
          source='tools/'+tool[1]+'.yaml'; const doc=parseYaml(p.files[source]);
          value=tool[2]==='input'?doc.inputSchema:tool[2]==='output'?{wire:doc.outputSchema,final:doc['x-sesame']?.finalOutputSchema}:tool[2].startsWith('error/')?doc.errors[tool[2].slice(6)]:{title:doc.title,description:doc.description,annotations:doc.annotations,usage:doc['x-sesame']?.usage};
        } else if(key.startsWith('message/')) {source='messages.yaml';value=p.messages[key.slice(8)];}
        else if(key.startsWith('resource/')) {source=key.slice(9);value=p.files[source].toString();}
        else if(key.startsWith('workflow/')) {const [wf,step]=key.slice(9).split('.step/');source='workflows/'+wf+'.yaml';value=parseYaml(p.files[source]).steps[step];}
        else if(key.startsWith('skill/')) {const name=key.slice(6).split('.')[0];const path=Object.keys(p.files).find(path=>path.endsWith('/'+name+'/SKILL.md'));assert(path,'Skill source missing');source=key.includes('.file/')?path.slice(0,-8)+key.split('.file/')[1]:path;value=p.files[source].toString();}
        else if(key.startsWith('instructions#')) {source=p.manifest.prompts.find(path=>key.startsWith('instructions#'+path+'/'))??'instructions.md';value=p.files[source].toString();}
        else {source='plugin.yaml';value={title:p.manifest.title,description:p.manifest.description};}
        result={id,version:p.surface.elements[id],package:p.tree,source,value};break;
      }
      case 'surface.diff': result=diffSurface(snap(input.baseline),snap(input.candidate));break;
      case 'surface.lock': {const root=draft(input.draft),lock=buildSurfaceLock(readSurfaceFiles(root));atomic(inside(root,'surface.lock.json'),JSON.stringify(lock,null,2)+'\n');result=lock;break;}
      case 'surface.add': case 'surface.set': case 'surface.rm': result=changeFile(draft(input.draft),input,command);break;
      case 'workflow.check': case 'workflow.graph': {const p=snap(input.draft);result={workflows:readWorkflowDefinitions(p.files,p.manifest.id)};break;}
      case 'findings.ls': result={items:records.list('finding').filter(f=>!input.element||f.attribution?.object===input.element)};break;
      case 'findings.add': {
        assert(['agent','program','user','human'].includes(input.source) && typeof input.evidence==='string' && input.evidence.trim() && typeof input.note==='string','Finding source, evidence and note required');
        result=records.put('finding',{id:randomUUID(),source:env.human?input.source:input.source==='program'?'program':'agent',evidence:input.evidence,note:input.note,status:'open'});break;
      }
      case 'findings.triage': {
        const row=records.get('finding',input.id);
        assert(categories.includes(input.category) && typeof input.object==='string' && input.object.trim() && typeof input.reason==='string' && input.reason.trim(),'One attribution object and rationale required');
        result=records.put('finding',{...row,status:'attributed',attribution:{category:input.category,object:input.object,reason:input.reason}});break;
      }
      case 'case.new': {
        const finding=records.get('finding',input.finding);
        assert(finding.status==='attributed','Attribute the finding first');
        const test=readCase(inside(draft(input.draft),relativeFile(input.path)));
        assert(!records.list('case').some(row=>row.id===test.doc.id),'Registered cases are immutable');
        result=records.put('case',{id:test.doc.id,finding:finding.id,...test});break;
      }
      case 'case.run': {const test=input.case?caseFromRecord(records.get('case',input.case)):readCase(inside(draft(input.draft),relativeFile(input.path)));result=runCase(snap(input.draft),test,sandboxCall);break;}
      case 'eval.run': case 'change.verify': {
        const ch=command==='change.verify'?records.get('change',input.id):input;
        assert(Array.isArray(ch.cases) && ch.cases.length,'Register a fixed case set');
        const tests=ch.cases.map(id=>caseFromRecord(records.get('case',id)));
        const a=snap(ch.baseline), b=snap(ch.candidate);
        if(command==='change.verify') assert(a.tree===ch.from && b.tree===ch.to,'Frozen change digest differs');
        const report=experiment(a,b,tests,ch.repeats??1);records.put('experiment',report);result=report;
        if(command==='change.verify') records.put('change',{...ch,status:report.verified?'verified':'rejected',experiment:report.id});
        break;
      }
      case 'change.new': {
        const finding=records.get('finding',input.finding), a=snap(input.baseline), b=snap(input.candidate);
        assert(finding.status==='attributed' && Array.isArray(input.cases) && input.cases.length && input.cases.some(id=>records.get('case',id).finding===finding.id),'An attributed finding and its case are required');
        assert(a.manifest.id===b.manifest.id && a.tree!==b.tree,'Distinct versions of one package required');
        for(const path of new Set([...Object.keys(a.files),...Object.keys(b.files)])) if (/^(?:(?:cases|evals)\/|requirements\.yaml$)/.test(path)) assert(a.files[path]?.equals(b.files[path]??Buffer.alloc(0)),'Candidate changed a case or requirement: '+path);
        result=records.put('change',{id:randomUUID(),finding:finding.id,plugin:a.manifest.id,baseline:input.baseline,candidate:input.candidate,from:a.tree,to:b.tree,cases:input.cases,repeats:input.repeats??1,status:'proposed'});break;
      }
      case 'change.adopt': case 'change.rollback': {
        const ch=records.get('change',input.id),forward=command==='change.adopt';
        assert(ch.status===(forward?'verified':'adopted') && env.human===true && typeof env.confirm==='function','Human decision on a verified change required');
        const current=records.list('selection').find(s=>s.id===ch.plugin);
        assert(forward ? !current || current.tree===ch.from : current?.tree===ch.to,'Selection has changed');
        if(forward) {
          const tests=ch.cases.map(id=>caseFromRecord(records.get('case',id)));
          const check=experiment(snap(ch.baseline),snap(ch.candidate),tests,ch.repeats);
          assert(check.verified && check.baseline===ch.from && check.candidate===ch.to,'Verification changed; re-evaluate before adoption');
          records.put('experiment',check);
        }
        const tree=forward?ch.to:ch.from;
        assert(snap(forward?ch.candidate:ch.baseline).tree===tree,'Selected package digest changed');
        assert(await env.confirm(tree),'Human confirmation did not match the selected digest');
        records.put('selection',{id:ch.plugin,tree,change:ch.id});result=records.put('change',{...ch,status:forward?'adopted':'rolled_back',decisionAt:new Date().toISOString()});break;
      }
      default: throw Error('Unknown optimizer command: '+command);
    }
    records.db.exec('COMMIT');return result;
  } catch(error) {records.db.exec('ROLLBACK');throw error;} finally {records.db.close();}
}
