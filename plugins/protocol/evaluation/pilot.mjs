import { mkdirSync,cpSync,writeFileSync,readFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml,writeYaml } from '../directory.mjs';
import { perform } from './index.mjs';
const workspace=resolve(process.argv[2]??'output/protocol-optimization-pilot');
const env={draftRoot:join(workspace,'plugin-drafts'),recordRoot:join(workspace,'.sesame-evaluation')};
const plugins=fileURLToPath(new URL('../../optional-api-v1/packages/',import.meta.url));
const pilots=[
  {name:'abu-breakout',tool:'abu_breakout_analyze',note:'工具发现结果没有说明信号使用的价格与比较窗口的关系。',addition:'比较当前收盘价与此前 lookback 根 K 线的高低点，突破条件只使用当前时点已可见的数据。'},
  {name:'plugin-optimizer',tool:'optimizer_change_verify',note:'工具发现结果没有写明候选通过配对实验的条件。',addition:'通过条件为目标断言改善、所有候选断言通过、每个原已通过的回归断言仍通过。'}
];
mkdirSync(env.draftRoot,{recursive:true});
const reports=[];
for(const {name,tool,note,addition} of pilots) {
  const run=(command,input)=>perform(command,input,env);
  const baseline=name+'-baseline',candidate=name+'-candidate',a=join(env.draftRoot,baseline),b=join(env.draftRoot,candidate);
  cpSync(join(plugins,name),a,{recursive:true,errorOnExist:true,force:false});
  const path='tools/'+tool+'.yaml',base=parseYaml(readFileSync(join(a,path)));
  const index=Object.keys((await run('surface.ls',{draft:baseline})).elements).filter(key=>key.endsWith('.description')&&key.includes(':tool/')).sort().indexOf('sesame/'+name+':tool/'+tool+'.description');
  const check='evals/cases/pilot-description.yaml';
  writeFileSync(join(a,check),writeYaml({id:name+'-pilot-description',environment:{mode:'replay'},steps:[{operation:'tools/list'}],expect:[{step:0,pointer:'/tools/'+index+'/description',contains:addition}]}));
  cpSync(a,b,{recursive:true,errorOnExist:true,force:false});
  const id='sesame/'+name+':tool/'+tool+'.description';
  const finding=await run('findings.add',{source:'program',evidence:id+'@'+(await run('surface.show',{draft:baseline,element:id})).version,note});
  await run('findings.triage',{id:finding.id,category:'element',object:id,reason:note});
  const fixed=await run('case.new',{draft:baseline,path:check,finding:finding.id});
  const previous=await run('case.new',{draft:baseline,path:'evals/cases/discovery.yaml',finding:finding.id});
  await run('surface.set',{draft:candidate,path,text:writeYaml({...base,description:base.description+' '+addition})});
  const change=await run('change.new',{baseline,candidate,finding:finding.id,cases:[fixed.id,previous.id],repeats:2});
  const report=await run('change.verify',{id:change.id});
  if(!report.verified) throw Error('Failed paired evaluation '+name);
  reports.push({name,change:change.id,finding:finding.id,status:'verified',humanDecision:'pending',report});
}
writeFileSync(join(workspace,'pilot-results.json'),JSON.stringify(reports,null,2)+'\n');
console.log(JSON.stringify(reports.map(({name,change,report})=>({name,change,experiment:report.id,baseline:report.baseline,candidate:report.candidate,pairs:report.pairs.length}))));
