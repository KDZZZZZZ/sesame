#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { perform } from './evaluation/index.mjs';
const args=process.argv.slice(2), group=args.shift();
const command=group==='init'?'init':group+'.'+args.shift();
const params={};
let workspace=process.cwd(), recordRoot, journal, session;
try {
  while(args.length) {
    const flag=args.shift(), value=args.shift();
    if (!flag.startsWith('--') || value===undefined) throw Error('Expected --option value');
    if(flag==='--workspace') workspace=resolve(value);
    else if(flag==='--journal') journal=resolve(value);
    else if(flag==='--session') session=value;
    else if(flag==='--record-root') recordRoot=resolve(value);
    else if(flag==='--compare') {params.baseline=value;params.candidate=args.shift();}
    else if(flag==='--json') Object.assign(params,JSON.parse(value));
    else if(flag==='--cases') params.cases=value.split(',');
    else if(flag==='--repeats') params.repeats=Number(value);
    else params[flag.slice(2)]=value;
  }
  function query(command,options) {
    if (!journal || !session) throw Error('Local evidence requires --journal <workspace.sqlite> --session <conversation>');
    const db=new DatabaseSync(journal,{readOnly:true});
    try {
      if(command==='findings.inbox') return {items:db.prepare("SELECT body FROM entities WHERE kind='plugin_finding' AND json_extract(body,'$.location.conversationId')=? ORDER BY id").all(session).map(row=>JSON.parse(row.body))};
      if(command==='trace.show'&&!options.digest) throw Error('A context digest is required');
      const limit=Number(options.limit??50),before=Number(options.cursor??Number.MAX_SAFE_INTEGER);
      if(!Number.isSafeInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(before)||before<1) throw Error('Invalid page');
      const rows=db.prepare('SELECT r.seq,r.at_ms,r.model,r.context_digest,c.elements FROM surface_requests r JOIN surface_contexts c ON c.digest=r.context_digest WHERE session_id=? AND r.seq<? AND (? IS NULL OR r.context_digest=?) ORDER BY r.seq DESC LIMIT ?').all(session,before,options.digest??null,options.digest??null,limit+1);
      const more=rows.length>limit;const items=rows.slice(0,limit).map(({elements,...row})=>options.digest?{...row,elements:JSON.parse(elements)}:row);
      return {items,...(more?{nextCursor:String(items.at(-1).seq)}:{})};
    } finally {db.close();}
  }
  const env={query,draftRoot:join(workspace,'plugin-drafts'),recordRoot:recordRoot??join(workspace,'.sesame-evaluation'),human:Boolean(process.stdin.isTTY && process.stdout.isTTY),
    async confirm(digest) {
      const prompt=createInterface({input:process.stdin,output:process.stderr});
      try {return (await prompt.question('Type the verified package digest to record this decision ('+digest+'): ')).trim()===digest;}
      finally {prompt.close();}
    }};
  process.stdout.write(JSON.stringify(await perform(command,params,env),null,2)+'\n');
} catch(error) {process.stderr.write(error.message+'\n');process.exitCode=1;}
