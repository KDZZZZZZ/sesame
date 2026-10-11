import { readFileSync } from 'node:fs';
import { assert } from './service.js';
const read = p => readFileSync(new URL(p,import.meta.url),'utf8');
import { auditLedger } from './ledger.js';
export { auditLedger } from './ledger.js';
export function reportRows(service) {
  const state=service.getState(),data=service.getData(),doc=service.getDocument();assert(state&&data,'尚无可报告的已揭示挑战');
  const audit=auditLedger(state),view=service.observe();
  const rows=[{type:'summary',...audit,markedEquity:view.account.equity,runId:state.id,version:state.version,status:state.status,chapter:state.chapter+1,goalJPY:'20000000',initialJPY:'300000',outcome:state.outcome,decisionCount:state.decisions.length,fillCount:state.fills.length,model:doc.model,asOf:new Date(view.asOf).toISOString(),controlPhase:doc.control.phase}];
  for(let chapter=0;chapter<3;chapter++) {
    const c=data.chapters[chapter],revealed=chapter<state.chapter?c.endIndex:chapter===state.chapter?state.index:-1;
    const ending=state.history.find(h=>h.type==='chapter_end'&&h.chapter===chapter),starting=state.history.find(h=>h.type==='chapter_start'&&h.chapter===chapter);
    rows.push({type:'chapter',chapter:chapter+1,symbol:c.symbol,status:chapter<state.chapter?'已结算':chapter===state.chapter?(state.bankrupt?'破产终止（章未完成）':state.status==='complete'?'已结算':'进行中'):'未揭示',startBalance:chapter===0?'300000':starting?.balance??null,endBalance:ending?.balance??null,from:c.from??null,to:c.to??null,revealedCount:Math.max(0,revealed+1)});
    for(let i=0;i<=revealed;i++) {const f=data.frames[chapter][i];if(chapter===state.chapter&&f.time+3600000>view.asOf)continue;rows.push({type:'bar',chapter:chapter+1,index:i,time:new Date(f.time+3600000).toISOString(),symbol:c.symbol,...f.bid,askOpen:f.ask.open,askClose:f.ask.close,fxBid:f.fx?.bid.close??null,fxAsk:f.fx?.ask.close??null});}
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
 reportKit.render('#report',{title:'久留美 · 三章连续挑战',eyebrow:'Research · 非官方二创 · 模拟账户',subtitle:'真实历史行情、真实角色 Agent；不是漫画逐笔记录，也不是券商成交',meta:[{label:'已揭示至',value:s.asOf},{label:'模型',value:s.model.provider+'/'+s.model.id}],
 verdict:{tone:s.outcome==='victory'?'positive':'caution',headline:complete?(s.outcome==='victory'?'空仓结算达成目标。':'三章结算尚未达成目标。'):'挑战仍在进行，当前不能判定胜利。',detail:'当前仅为小步功能验收，不能评价交易能力；资金不补款，历史可成交深度未重建。'},
 metrics:[{label:'已结算余额',value:s.balance,unit:'JPY'},{label:'当前可结算估值',value:s.markedEquity,unit:'JPY'},{label:'胜利目标',value:s.goalJPY,unit:'JPY'},{label:'最大观测回撤',value:s.maxDrawdownPct,unit:'%'},{label:'角色决定',value:s.decisionCount},{label:'成交笔数',value:s.fillCount}],
 sections:[{title:'三个副本，一条资金线',takeaway:'每章结束空仓结算，下一章只继承实际余额。',blocks:[{type:'table',columns:[{key:'chapter',label:'章'},{key:'symbol',label:'品种'},{key:'status',label:'状态'},{key:'startBalance',label:'起始余额 JPY'},{key:'endBalance',label:'结算余额 JPY'},{key:'revealedCount',label:'已揭示H1'}],rows:chapters},{type:'findings',items:[{claim:'禁止外部补款；跳过的月份不产生收益。',evidence:[{label:'初始资金',value:s.initialJPY,unit:'JPY'},{label:'外部入金',value:s.externalFunding,unit:'JPY'},{label:'目标资产倍数',value:s.targetFactor,unit:'倍'}]}]}]},
 {title:'权益与已揭示行情',takeaway:'曲线只包含已经消费的H1区间，未揭示章不画未来价格。',blocks:[{type:'chart',kind:'line',title:'权益轨迹',caption:'含已发生模拟成本；跨章月份不记收益；UTC，JPY',data:of('equity'),x:'time',y:'equity',xType:'time',unit:'JPY'},{type:'custom',render(el){const select=document.createElement('select');select.setAttribute('aria-label','选择已揭示章节');for(const c of chapters){const o=document.createElement('option');o.value=c.chapter;o.textContent=c.symbol+' · '+c.status;select.append(o);}const chart=document.createElement('div');el.append(select,chart);function redraw(){reportKit.destroy(chart);const bars=of('bar').filter(r=>r.chapter===Number(select.value));if(!bars.length){chart.textContent='本章尚未揭示';return;}reportKit.chart(chart,{kind:'line',title:'已揭示H1 bid收盘',caption:'UTC；不是成交价，原始bid/ask可在明细核对',data:bars,x:'time',y:'close',xType:'time',unit:bars[0].symbol.endsWith('JPY')?'JPY':'CHF'});}select.addEventListener('change',redraw);redraw();}}]},
 {title:'久留美的决定',takeaway:'角色工具的提交才会推进，短句和理由与成交账本逐步关联。',blocks:[{type:'table',columns:[{key:'time',label:'执行时间 UTC'},{key:'chapter',label:'章'},{key:'target',label:'目标基础币数量'},{key:'stop',label:'止损'},{key:'reason',label:'理由'},{key:'utterance',label:'原创角色短句'}],rows:of('decision'),limit:8}]},
 {title:'角色请求与有效决定',takeaway:'任务完成不等于已经提交决定；失败请求也保留核对证据。',blocks:[{type:'table',columns:[{key:'createdAt',label:'请求时间 UTC'},{key:'status',label:'任务终态'},{key:'decided',label:'已提交有效决定'},{key:'turns',label:'实际轮次'}],rows:of('agentTask'),limit:8}]},
 {title:'保存决定的显式恢复',takeaway:'只重放已保存的真实角色决定，不重新请求模型；原失败工具与恢复记录分别保留。',blocks:[{type:'table',columns:[{key:'originalTaskId',label:'原角色任务'},{key:'decisionId',label:'原决定ID'},{key:'status',label:'恢复状态'},{key:'balance',label:'恢复后余额 JPY'}],rows:of('recoveryEvidence')}]},
 {title:'成交与成本对账',takeaway:'余额由每笔已实现损益减手续费和模拟融资精确得到，负余额不被归零。',blocks:[{type:'metrics',items:[{label:'已实现损益',value:s.realized,unit:'JPY'},{label:'手续费',value:s.commission,unit:'JPY'},{label:'模拟融资',value:s.financing,unit:'JPY'},{label:'净结算损益',value:s.netProfit,unit:'JPY'}]},{type:'table',columns:[{key:'time',label:'UTC'},{key:'instrument',label:'品种'},{key:'signedQuantity',label:'买正卖负·基础币'},{key:'price',label:'模拟成交价'},{key:'reason',label:'原因'},{key:'realizedJpy',label:'已实现JPY'},{key:'commission',label:'手续费JPY'},{key:'balanceAfter',label:'成交后余额JPY'}],rows:of('fill'),limit:8},{type:'table',columns:[{key:'ledgerType',label:'账本类型'},{key:'time',label:'UTC'},{key:'realizedJpy',label:'已实现JPY'},{key:'commission',label:'手续费JPY'},{key:'financing',label:'融资JPY'},{key:'balanceAfter',label:'余额JPY'}],rows:of('ledger'),limit:8}]}],
 method:{steps:['角色仅看已收盘H1；下一个H1区间首个真实细报价才可执行，买ask卖bid；不重复扣点差。实际撮合版本和成本以冻结规则与引擎验收为准。','正式撮合由成熟引擎处理真实bid/ask细数据；缺失依赖/报价/同步CHFJPY则暂停，不回退H1极值。CHF损益按本步已知换汇，正收益bid、负收益ask。','三章固定杠杆/强平分别500/20%、25/50%、25/30%；每侧每1000基础单位手续费3JPY、每UTC跨日融资10JPY，均为挑战假设而非历史券商条款。','账本逐行精确核对；显示比率截断到8位小数，图形坐标可用Number但不参与结算。'],limits:['模型预训练可能记得历史；即使不给未来输入，也不能称严格盲测。','真实quote tick仍不能重建当时券商可成交深度、网络延迟和订单簿；如果数据明确为M1，则不能当作真实逐tick路径。','原剧情余额、补款与反算价只供开发者理解，不参与挑战资金或行情。'],sources:[{label:'真实数据与哈希',value:JSON.stringify(source.provenance)+' '+JSON.stringify(source.digests)},{label:'模拟规则与正式执行',value:JSON.stringify(source.rules)+' '+JSON.stringify(source.execution)+' '+JSON.stringify(source.nativeEnvironment)},{label:'模型配置描述符（非权重版本认证）',value:JSON.stringify(s.model)},{label:'角色任务证据',value:JSON.stringify({tasks:of('agentTask'),decisions:of('agentEvidence'),recoveries:of('recoveryEvidence')})}]}});
 }
 window.report.track(initialize()).catch(error=>{document.getElementById('report').textContent=error.message;});
 </script></body></html>`;
}
export async function exportReplay(host,service,operationId,signal) {
 signal?.throwIfAborted(); assert(host.scope?.kind==='main','观众数据导出仅主Agent可用','SCOPE_DENIED');
 const rows=reportRows(service),state=service.getState();
 // Persist matching/role evidence and all committed state, never the internal
 // full future market arrays or the player authorization token.
 const checkpoint={engine:state,roleTasks:service.getDocument().roleTasks??[],roleEvidence:service.getDocument().roleEvidence??[],recoveries:service.getDocument().recoveries??[],nativeEnvironment:service.nativeEnvironment??null};
 const origin={kind:service.getData().provenance?.kind==='demo'?'demo':'derived',references:[]};
 const sourceBlob=host.artifacts.blob(JSON.stringify({provenance:service.getData().provenance,digests:service.getData().digests,checkpoint}));
 const source=await host.artifacts.publish({operationId:operationId+':source',manifest:{kind:'resource',schemaVersion:'1.0.0',content:{type:'kurumi-revealed-simulation-checkpoint',path:'source.json',provenance:origin},dependencies:[],blobs:[{...sourceBlob,path:'source.json',mediaType:'application/json'}],provenance:origin}});
 const provenance={kind:origin.kind,references:[source]},blob=host.artifacts.blob(JSON.stringify(rows));
 const data=await host.artifacts.publish({operationId:operationId+':data',manifest:{kind:'data',schemaVersion:'1.0.0',content:{format:'json-rows',path:'rows.json',rowCount:rows.length,columns:[...new Set(rows.flatMap(r=>Object.keys(r)))],provenance},dependencies:[source],blobs:[{...blob,path:'rows.json',mediaType:'application/json'}],provenance}});
 return {data,source,rowCount:rows.length,runId:state.id,engineVersion:state.version,asOf:service.observe().asOf,note:'固定已揭示数据与原生成交/角色证据；主Agent可直接复用现有reports插件解说，未复制未来行情数组。'};
}
export async function publishReport(host,service,operationId,signal) {
 const frozen=await exportReplay(host,service,operationId,signal),{data,source}=frozen,state=service.getState();
 const provenanceKind=service.getData().provenance?.kind==='demo'?'demo':'derived';
 const html=host.artifacts.blob(reportHTML()),title='久留美 · 三章连续挑战',summary=state.status==='complete'?(state.outcome==='victory'?'空仓结算达成目标。':'三章结算未达成目标。'):'真实角色模拟挑战进行中；当前尚不能判定胜利。';
 const ref=await host.artifacts.publish({operationId,manifest:{kind:'report',schemaVersion:'1.0.0',content:{schemaVersion:'1.0.0',title,summary,entry:'index.html',runtime:'sesame-report/1',runtimeRevision:'1.0.0',data:[{id:'replay',ref:data,usage:'已揭示行情、精确模拟成交/费用/权益、角色提交与模型任务证据'}],related:[{role:'source',artifact:source}],features:['interactive','trade_details'],locale:'zh-CN',provenance:{kind:provenanceKind,references:[data,source]}},dependencies:[data,source],blobs:[{...html,path:'index.html',mediaType:'text/html'}],provenance:{kind:'derived',references:[data,source]}}});
 const receipt=await host.artifacts.inspect(ref,signal);return {...frozen,ref,receipt};
}
