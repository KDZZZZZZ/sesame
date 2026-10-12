import { readFileSync } from 'node:fs';
const assert=(ok,message,code='INVALID_ARGUMENT')=>{if(!ok)throw Object.assign(new Error(message),{code});};
const read = p => readFileSync(new URL(p,import.meta.url),'utf8');
import { auditLedger } from './ledger.js';
import { weeklyProvenanceKind } from './report-provenance.js';
export { auditLedger } from './ledger.js';
export function reportRows(service) {
  const state=service.getState(),data=service.getData(),doc=service.getDocument();assert(state&&data,'尚无可报告的已揭示挑战');
  const audit=auditLedger(state),view=service.observe(),consumed=service.getReplayPresentation?.();
  const rows=[{type:'summary',...audit,markedEquity:view.account.equity,runId:state.id,version:state.version,status:state.status,chapter:state.chapter+1,goalJPY:'20000000',initialJPY:state.experimentProfile?.initialJPY??'300000',profile:state.experimentProfile??state.profile??state.rules,informReplay:state.experimentProfile?.round===2||state.rules?.experimentProfile?.id==='informed-replay-50x-v1',outcome:state.outcome,decisionCount:state.decisions.length,fillCount:state.fills.length,model:doc.model,asOf:new Date(view.asOf).toISOString(),controlPhase:doc.control.phase}];
  for(let chapter=0;chapter<3;chapter++) {
    const c=data.chapters[chapter],revealed=chapter<state.chapter?c.endIndex:chapter===state.chapter?state.index:-1;
    const ending=state.history.find(h=>h.type==='chapter_end'&&h.chapter===chapter),starting=state.history.find(h=>h.type==='chapter_start'&&h.chapter===chapter);
    rows.push({type:'chapter',chapter:chapter+1,symbol:c.symbol,status:chapter<state.chapter?'已结算':chapter===state.chapter?(state.bankrupt?'破产终止（章未完成）':state.status==='complete'?'已结算':'进行中'):'未揭示',startBalance:chapter===0?'300000':starting?.balance??null,endBalance:ending?.balance??null,from:c.from??null,to:c.to??null,revealedCount:Math.max(0,revealed+1)});
    if(consumed) {for(const b of consumed.bars.filter(b=>b.chapter===chapter)){rows.push({type:'bar',chapter:chapter+1,time:new Date(b.isClosed?b.toExclusive:b.asOf).toISOString(),symbol:c.symbol,...b.bid,askOpen:b.ask.open,askClose:b.ask.close,isClosed:b.isClosed,asOf:b.asOf,consumedCount:b.consumedCount});}} else for(let i=0;i<=revealed;i++) {const f=data.frames[chapter][i];if(chapter===state.chapter&&f.time+3600000>view.asOf)continue;rows.push({type:'bar',chapter:chapter+1,index:i,time:new Date(f.time+3600000).toISOString(),symbol:c.symbol,...f.bid,askOpen:f.ask.open,askClose:f.ask.close,fxBid:f.fx?.bid.close??null,fxAsk:f.fx?.ask.close??null});}
  }
  for(const c of rows.filter(r=>r.type==='chapter'))c.revealedCount=rows.filter(r=>r.type==='bar'&&r.chapter===c.chapter).length;
  rows.push(...state.equity.map(e=>({type:'equity',...e,chapter:e.chapter+1,time:new Date(e.time).toISOString()})),...state.fills.map(e=>({type:'fill',...e,chapter:e.chapter+1,time:new Date(e.time).toISOString()})),...state.ledger.map(e=>({...e,type:'ledger',ledgerType:e.type,chapter:e.chapter+1,time:new Date(e.time).toISOString()})),...state.decisions.map(e=>({type:'decision',stepId:e.decision.stepId,chapter:e.executedChapter+1,time:new Date(e.executionTime).toISOString(),target:e.decision.target,stop:e.decision.stop,reason:e.decision.reason,utterance:e.decision.utterance,decisionId:e.decision.id})),...(doc.roleTasks??[]).map(e=>({type:'agentTask',...e})),...(doc.roleEvidence??[]).map(e=>({type:'agentEvidence',...e})),...(doc.recoveries??[]).map(e=>({type:'recoveryEvidence',...e})),{type:'source',provenance:data.provenance,digests:data.digests,rules:state.rules,execution:data.execution?.summary??null,nativeEnvironment:service.nativeEnvironment??null});
  return rows;
}
export function reportHTML() {
 const css=read('./assets/editorial.css'),kit=read('./assets/report-kit.js');
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>久留美 · 连续挑战</title><style>${css}</style></head><body><main id="report"></main><script>${kit}</script><script>
 async function initialize(){
 const rows=await reportKit.rows('replay'),s=rows.find(r=>r.type==='summary'),of=type=>rows.filter(r=>r.type===type),chapters=of('chapter'),source=of('source')[0];
 const complete=s.status==='complete';
 reportKit.render('#report',{title:'久留美 · 三章连续挑战',eyebrow:'Research · 非官方二创 · 模拟账户',subtitle:'真实历史行情、真实角色 Agent；不是漫画逐笔记录，也不是券商成交',meta:[{label:'已揭示至',value:s.asOf},{label:'模型',value:s.model?s.model.provider+'/'+s.model.id:'尚未选择模型'}],
 verdict:{tone:s.outcome==='victory'?'positive':'caution',headline:complete?(s.outcome==='victory'?'空仓结算达成目标。':'三章结算尚未达成目标。'):'挑战仍在进行，当前不能判定胜利。',detail:'当前仅为小步功能验收，不能评价交易能力；资金不补款，历史可成交深度未重建。'},
 metrics:[{label:'已结算余额',value:s.balance,unit:'JPY'},{label:'当前可结算估值',value:s.markedEquity,unit:'JPY'},{label:'胜利目标',value:s.goalJPY,unit:'JPY'},{label:'最大观测回撤',value:s.maxDrawdownPct,unit:'%'},{label:'角色决定',value:s.decisionCount},{label:'成交笔数',value:s.fillCount}],
 sections:[{title:'三个副本，一条资金线',takeaway:'每章结束空仓结算，下一章只继承实际余额。',blocks:[{type:'table',columns:[{key:'chapter',label:'章'},{key:'symbol',label:'品种'},{key:'status',label:'状态'},{key:'startBalance',label:'起始余额 JPY'},{key:'endBalance',label:'结算余额 JPY'},{key:'revealedCount',label:'已揭示H1'}],rows:chapters},{type:'findings',items:[{claim:'禁止外部补款；跳过的月份不产生收益。',evidence:[{label:'初始资金',value:s.initialJPY,unit:'JPY'},{label:'外部入金',value:s.externalFunding,unit:'JPY'},{label:'目标资产倍数',value:s.targetFactor,unit:'倍'}]}]}]},
 {title:'权益与已揭示行情',takeaway:'曲线只包含已经消费的H1区间，未揭示章不画未来价格。',blocks:[{type:'chart',kind:'line',title:'权益轨迹',caption:'含已发生模拟成本；跨章月份不记收益；UTC，JPY',data:of('equity'),x:'time',y:'equity',xType:'time',unit:'JPY'},{type:'custom',render(el){const select=document.createElement('select');select.setAttribute('aria-label','选择已揭示章节');for(const c of chapters){const o=document.createElement('option');o.value=c.chapter;o.textContent=c.symbol+' · '+c.status;select.append(o);}const chart=document.createElement('div');el.append(select,chart);function redraw(){reportKit.destroy(chart);const bars=of('bar').filter(r=>r.chapter===Number(select.value));if(!bars.length){chart.textContent='本章尚未揭示';return;}reportKit.chart(chart,{kind:'line',title:'已揭示H1 bid收盘',caption:'UTC；不是成交价，原始bid/ask可在明细核对',data:bars,x:'time',y:'close',xType:'time',unit:bars[0].symbol.endsWith('JPY')?'JPY':'CHF'});}select.addEventListener('change',redraw);redraw();}}]},
 {title:'久留美的决定',takeaway:'角色工具的提交才会推进，短句和理由与成交账本逐步关联。',blocks:[{type:'table',columns:[{key:'time',label:'执行时间 UTC'},{key:'chapter',label:'章'},{key:'target',label:'目标基础币数量'},{key:'stop',label:'止损'},{key:'reason',label:'理由'},{key:'utterance',label:'原创角色短句'}],rows:of('decision'),limit:8}]},
 {title:'角色请求与有效决定',takeaway:'任务完成不等于已经提交决定；失败请求也保留核对证据。',blocks:[{type:'table',columns:[{key:'createdAt',label:'请求时间 UTC'},{key:'status',label:'任务终态'},{key:'decided',label:'已提交有效决定'},{key:'turns',label:'实际轮次'}],rows:of('agentTask'),limit:8}]},
 {title:'保存决定的显式恢复',takeaway:'只重放已保存的真实角色决定，不重新请求模型；原失败工具与恢复记录分别保留。',blocks:[{type:'table',columns:[{key:'originalTaskId',label:'原角色任务'},{key:'decisionId',label:'原决定ID'},{key:'status',label:'恢复状态'},{key:'balance',label:'恢复后余额 JPY'}],rows:of('recoveryEvidence')}]},
 {title:'成交与成本对账',takeaway:'余额由每笔已实现损益减手续费和模拟融资精确得到，负余额不被归零。',blocks:[{type:'metrics',items:[{label:'已实现损益',value:s.realized,unit:'JPY'},{label:'手续费',value:s.commission,unit:'JPY'},{label:'模拟融资',value:s.financing,unit:'JPY'},{label:'净结算损益',value:s.netProfit,unit:'JPY'}]},{type:'table',columns:[{key:'time',label:'UTC'},{key:'instrument',label:'品种'},{key:'signedQuantity',label:'买正卖负·基础币'},{key:'price',label:'模拟成交价'},{key:'reason',label:'原因'},{key:'realizedJpy',label:'已实现JPY'},{key:'commission',label:'手续费JPY'},{key:'balanceAfter',label:'成交后余额JPY'}],rows:of('fill'),limit:8},{type:'table',columns:[{key:'ledgerType',label:'账本类型'},{key:'time',label:'UTC'},{key:'realizedJpy',label:'已实现JPY'},{key:'commission',label:'手续费JPY'},{key:'financing',label:'融资JPY'},{key:'balanceAfter',label:'余额JPY'}],rows:of('ledger'),limit:8}]}],
 method:{steps:['角色仅看已收盘H1；下一个H1区间首个真实细报价才可执行，买ask卖bid；不重复扣点差。实际撮合版本和成本以冻结规则与引擎验收为准。','正式撮合由成熟引擎处理真实bid/ask细数据；缺失依赖/报价/同步CHFJPY则暂停，不回退H1极值。CHF损益按本步已知换汇，正收益bid、负收益ask。','杠杆/强平以本轮冻结profile和规则为准；新实验全章50x与旧500x/25x/25x分开。每侧手续费及融资保留冻结挑战假设，不是历史券商条款。','账本逐行精确核对；显示比率截断到8位小数，图形坐标可用Number但不参与结算。'],limits:['模型预训练可能记得历史；同历史第二轮是知情重放，不是样本外证据。尚无通过前瞻验证的专属规则。','真实quote tick仍不能重建当时券商可成交深度、网络延迟和订单簿；如果数据明确为M1，则不能当作真实逐tick路径。','原剧情余额、补款与反算价只供开发者理解，不参与挑战资金或行情。'],sources:[{label:'真实数据与哈希',value:JSON.stringify(source.provenance)+' '+JSON.stringify(source.digests)},{label:'模拟规则与正式执行',value:JSON.stringify(source.rules)+' '+JSON.stringify(source.execution)+' '+JSON.stringify(source.nativeEnvironment)},{label:'模型配置描述符（非权重版本认证）',value:JSON.stringify(s.model)},{label:'角色任务证据',value:JSON.stringify({tasks:of('agentTask'),decisions:of('agentEvidence'),recoveries:of('recoveryEvidence')})}]}});
 }
 window.report.track(initialize()).catch(error=>{document.getElementById('report').textContent=error.message;});
 </script></body></html>`;
}
export async function exportReplay(host,service,operationId,signal) {
 signal?.throwIfAborted(); assert(host.scope?.kind==='main','观众数据导出仅主Agent可用','SCOPE_DENIED');
 const state=service.getState(),prepared=service.getData(),doc=service.getDocument(),view=service.observe(),consumed=service.getReplayPresentation?.(),nativeEnvironment=service.nativeEnvironment??null;
 const rows=reportRows({getState:()=>state,getData:()=>prepared,getDocument:()=>doc,observe:()=>view,getReplayPresentation:()=>consumed,nativeEnvironment}),summary=rows[0];
 // Persist matching/role evidence and all committed state, never the internal
 // full future market arrays or the player authorization token.
 const checkpoint={engine:state,roleTasks:doc.roleTasks??[],roleEvidence:doc.roleEvidence??[],recoveries:doc.recoveries??[],nativeEnvironment};
 const origin={kind:prepared.provenance?.kind==='demo'?'demo':'derived',references:[]};
 // Freeze bytes and descriptor before the first await. The service may advance
 // during artifact publication; archives and report metadata must not follow it.
 const sourceText=JSON.stringify({provenance:prepared.provenance,digests:prepared.digests,checkpoint}),rowsText=JSON.stringify(rows);
 const descriptor={rowCount:rows.length,runId:summary.runId,engineVersion:summary.version,asOf:Date.parse(summary.asOf),status:summary.status,outcome:summary.outcome??null};
 const sourceBlob=await host.artifacts.blob(sourceText);
 const source=await host.artifacts.publish({operationId:operationId+':source',manifest:{kind:'resource',schemaVersion:'1.0.0',content:{type:'kurumi-revealed-simulation-checkpoint',path:'source.json',provenance:origin},dependencies:[],blobs:[{...sourceBlob,path:'source.json',mediaType:'application/json'}],provenance:origin}});
 const provenance={kind:origin.kind,references:[source]},blob=await host.artifacts.blob(rowsText);
 const data=await host.artifacts.publish({operationId:operationId+':data',manifest:{kind:'data',schemaVersion:'1.0.0',content:{format:'json-rows',path:'rows.json',rowCount:rows.length,columns:[...new Set(rows.flatMap(r=>Object.keys(r)))],provenance},dependencies:[source],blobs:[{...blob,path:'rows.json',mediaType:'application/json'}],provenance}});
 await service.archiveFileSafe(`exports/export-${operationId}-rows.json`,rowsText);
 await service.archiveFileSafe(`exports/export-${operationId}-checkpoint.json`,sourceText);
 await service.archiveSafe('export_replay',{operationId,data,source,rowCount:rows.length,note:'已揭示行情/账户/账本/角色证据固定导出归档'});
 return {data,source,provenanceKind:origin.kind,...descriptor,note:'固定已揭示数据与原生成交/角色证据；主Agent可直接复用现有reports插件解说，未复制未来行情数组。'};
}
export async function publishReport(host,service,operationId,signal) {
 const frozen=await exportReplay(host,service,operationId,signal),{data,source}=frozen;
 const provenance={kind:frozen.provenanceKind,references:[data,source]};
 const htmlText=reportHTML(),html=await host.artifacts.blob(htmlText),title='久留美 · 三章连续挑战',summary=frozen.status==='complete'?(frozen.outcome==='victory'?'空仓结算达成目标。':'三章结算未达成目标。'):'真实角色模拟挑战进行中；当前尚不能判定胜利。';
 const ref=await host.artifacts.publish({operationId,manifest:{kind:'report',schemaVersion:'1.0.0',content:{schemaVersion:'1.0.0',title,summary,entry:'index.html',runtime:'sesame-report/1',runtimeRevision:'1.0.0',data:[{id:'replay',ref:data,usage:'已揭示行情、精确模拟成交/费用/权益、角色提交与模型任务证据'}],related:[{role:'source',artifact:source}],features:['interactive','trade_details'],locale:'zh-CN',provenance},dependencies:provenance.references,blobs:[{...html,path:'index.html',mediaType:'text/html'}],provenance}});
 const receipt=await host.artifacts.inspect(ref,signal);
 await service.archiveFileSafe(`reports/report-${operationId}.html`,htmlText);
 await service.archiveSafe('report_published',{operationId,ref,receipt,data,source,note:'每版报告HTML/CSS/data与渲染回执归档'});
 return {...frozen,ref,receipt};
}

// Independent weekly renderer: fixed finance baseline plus unrestricted full
// Agent expression. Never supplies a mutable service/market to report HTML.
export function weeklyReportHTML(){
 const css=read('./assets/editorial.css'),kit=read('./assets/report-kit.js');
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>模拟投资周报</title><style>${css}</style></head><body><main id="report"></main><script>${kit}</script><script>
 async function initialize(){
 const rows=await reportKit.rows('weekly'),input=rows.find(r=>r.type==='weekly-input'),output=(await reportKit.rows('agent-output'))[0],p=input.period,f=input.financial,closing=input.closing;
 const show=v=>typeof v==='object'?(v.status==='unknown'?'未知：'+v.reason:JSON.stringify(v)):v;
 reportKit.render('#report',{title:'模拟UTC投资周报',eyebrow:'Research · 原作久留美 vs Sesame实际模拟动作',subtitle:p.partial?'本章不足完整UTC周的部分周':'本章完整UTC周',meta:[{label:'区间 UTC',value:new Date(p.fromMs).toISOString()+' — '+new Date(p.toMs).toISOString()},{label:'截止',value:new Date(closing.cutoffMs).toISOString()},{label:'周区间',value:new Date(p.weekStartMs).toISOString()+' — '+new Date(p.weekEndMs).toISOString()}],
 verdict:{tone:'neutral',headline:'固定截止财务已对账，市场判断与下一周计划保留为模型观点。',detail:'同历史的知情重放不构成独立样本外；原作未知总资产不估算。'},
 metrics:[{label:'期初余额',value:f.openingBalance,unit:'JPY'},{label:'期末余额',value:f.closingBalance,unit:'JPY'},{label:'期末权益',value:show(f.closingEquity),unit:'JPY'},{label:'净余额变化',value:f.netBalanceChangeJpy,unit:'JPY'},{label:'观测最大回撤',value:show(f.maxObservedDrawdownPct),unit:'%'}],
 sections:[{title:'财务基线与成本',takeaway:'净余额变化等于已实现损益减手续费与融资；未实现损益、保证金单列。',blocks:[{type:'table',columns:[{key:'label',label:'口径'},{key:'value',label:'值'}],rows:[{label:'已实现损益 JPY',value:f.realizedJpy},{label:'手续费 JPY',value:f.commissionJpy},{label:'融资 JPY',value:f.financingJpy},{label:'期初权益 JPY',value:show(f.openingEquity)},{label:'未实现损益 JPY',value:show(f.unrealizedJpy)},{label:'保证金 JPY',value:show(f.marginJpy)},{label:'可用保证金 JPY',value:show(f.freeMarginJpy)}]}]},
 {title:'完整投资解读',takeaway:'模型观点与固定财务事实分开，正文不限制分析表达。',blocks:[{type:'custom',render(el){const article=document.createElement('div');article.style.whiteSpace='pre-wrap';article.textContent=output.text??JSON.stringify(output.output??output,null,2);el.append(article);}}]},
 {title:'权益与持仓',takeaway:'曲线只包含本周已经消费的账户标记；没有报价处不补零。',blocks:[{type:'chart',kind:'line',title:'已消费权益标记',caption:'UTC，JPY；不是逐tick最大回撤',data:closing.equity.filter(e=>e.chapter===closing.chapter&&e.time>=p.fromMs&&e.time<=p.toMs).map(e=>({...e,utc:new Date(e.time).toISOString()})),x:'utc',y:'equity',xType:'time',unit:'JPY'},{type:'note',text:'截止持仓：'+JSON.stringify(closing.positions)}]},
 {title:'真实动作与原作区间',takeaway:'Sesame决定、订单、成交来自已提交账本；原作注释仍是有来源的区间或反算声明。',blocks:[{type:'table',columns:['id','instrument','time','signedQuantity','price','reason','commission'],rows:closing.fills.filter(e=>e.time>=p.fromMs&&e.time<=p.toMs),limit:8},{type:'table',columns:['id','time','status','target','stop'],rows:closing.orders.filter(e=>e.time>=p.fromMs&&e.time<=p.toMs),limit:8},{type:'table',columns:['key','actor','evidence','timePrecision','text'],rows:closing.originalComparison,limit:8},{type:'note',text:closing.fills.filter(e=>e.time>p.fromMs&&e.time<=p.toMs).length===0?'本周真实成交数为零；不把决定或原作注释记为交易。':'决定与订单的完整原始关联保留在固定输入中。'}]},
 {title:'方法与采用证据',takeaway:'计划中的插件不算已经采用；只展示具有实际输入输出证据的方法。',blocks:[{type:'table',columns:['pluginId','version','method','status','source'],rows:closing.methods,limit:8}]}],
 method:{steps:['按本章模拟UTC周分组；起始/末尾不足周明确标注。','截止市场/账户/仓位/订单/成交/成本及完整输出分别固定与归档；失败待办保留，不重复请求未知模型。',f.drawdownMethod],limits:closing.restrictions,sources:[{label:'固定profile',value:JSON.stringify(closing.profile)},{label:'插件与方法版本',value:JSON.stringify(closing.plugin)+' '+JSON.stringify(closing.methodVersions)},{label:'真实来源/覆盖',value:JSON.stringify(closing.sourceDigests)+' '+JSON.stringify(closing.sourceCoverage)},{label:'输出元数据',value:JSON.stringify({requestId:output.requestId,model:output.model,inputDigest:output.inputDigest,usage:output.usage})}]}});
 }
 window.report.track(initialize()).catch(error=>{document.getElementById('report').textContent=error.message;});
 </script></body></html>`;
}
export async function publishWeeklyReport(host,service,job,signal){
 signal?.throwIfAborted();assert(job.inputRef&&job.output!==null,'周报必须已有固定DataRef与完整输出');
 const fullOutputRefs=job.output.artifactRefs??[];
 assert(fullOutputRefs.every(r=>r.id&&typeof r.revision==='string'&&/^sha256:[a-f0-9]{64}$/.test(r.digest??'')&&r.kind&&r.schemaVersion==='1.0.0'),'完整Agent输出引用必须固定','SOURCE_DATA_INVALID');
 const provenanceKind=weeklyProvenanceKind(job.input),outputProvenance={kind:provenanceKind,references:[job.inputRef,...fullOutputRefs]};
 const outputRows=[{type:'agent-output',...job.output}],blob=await host.artifacts.blob(JSON.stringify(outputRows));
 const outputRef=await host.artifacts.publish({operationId:job.id+'_output',manifest:{kind:'data',schemaVersion:'1.0.0',content:{format:'json-rows',path:'output.json',rowCount:1,columns:Object.keys(outputRows[0]),provenance:outputProvenance},dependencies:outputProvenance.references,blobs:[{...blob,path:'output.json',mediaType:'application/json'}],provenance:outputProvenance}});
 // Optional Agent-authored presentation is frozen in the job before publish.
 // It may freely change outline/charts/HTML. The mandatory finance/raw evidence
 // bindings remain fixed; future frontend acceptance verifies their visibility.
 const htmlText=job.authoredPresentation?.html??weeklyReportHTML(),html=await host.artifacts.blob(htmlText),partial=job.input.period.partial;
 const assets=[];
 for(const asset of job.authoredPresentation?.assets??[]){
   assert(typeof asset.path==='string'&&!asset.path.startsWith('/')&&!asset.path.split('/').some(p=>p==='..'||p==='.')&&asset.path!=='index.html'&&typeof asset.mediaType==='string'&&typeof asset.content==='string','报告资源必须是安全包内路径/明确媒体类型/固定内容');
   assert(!assets.some(a=>a.path===asset.path),'报告资源路径不可重复');
   const packaged=await host.artifacts.blob(asset.content);assets.push({...packaged,path:asset.path,mediaType:asset.mediaType});
   const archived=await service.archiveFileSafe(`weekly/${job.id}/assets/${asset.path}`,asset.content);assert(archived,'Agent完整自定义资源归档不可用','ARCHIVE_UNAVAILABLE');
 }
 assert(assets.reduce((n,b)=>n+b.size,html.size)<=16*1024*1024,'完整周报资源预算超限，不截断','RESOURCE_EXHAUSTED');
 const provenance={kind:provenanceKind,references:[job.inputRef,outputRef,...fullOutputRefs]};
 const ref=await host.artifacts.publish({operationId:job.id+'_report',manifest:{kind:'report',schemaVersion:'1.0.0',content:{schemaVersion:'1.0.0',title:'模拟UTC投资周报'+(partial?' · 部分周':''),summary:'固定截止财务对账与完整模型观点；同历史知情重放，非样本外。',entry:'index.html',runtime:'sesame-report/1',runtimeRevision:'1.0.0',data:[{id:'weekly',ref:job.inputRef,usage:'精确截止财务、已消费市场、真实订单/成交与方法版本'},{id:'agent-output',ref:outputRef,usage:'完整Agent输出及真实模型描述符'}],related:[{role:'source',artifact:job.inputRef}],features:['interactive','trade_details'],locale:'zh-CN',provenance},dependencies:provenance.references,blobs:[{...html,path:'index.html',mediaType:'text/html'},...assets],provenance}});
 const archive=await service.archiveFileSafe(`weekly/${job.id}/report.html`,htmlText);assert(archive,'周报HTML归档不可用','ARCHIVE_UNAVAILABLE');
 // Real host inspector ONLY. A failed/pending receipt is not relabelled rendered.
 const receipt=await host.artifacts.inspect(ref,signal);
 return {ref,outputRef,inputRef:job.inputRef,receipt,htmlArchive:archive,partial};
}
