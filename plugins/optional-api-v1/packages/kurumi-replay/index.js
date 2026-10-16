import { records, closeRecords } from './records.js';
import { readFileSync } from 'node:fs';
import { ReplayService, getService, setService, removeService, assert } from './service.js';
import { initializeSources, disposeSources, createSourceCapabilities } from './source-capabilities.js';
import { execute as executeNative } from './runtime-adapter.js';
import { publishReport, exportReplay } from './report.js';
import { publishMarkers } from './markers.js';
import { disposeNative } from './native-engine.js';
const definitions=JSON.parse(readFileSync(new URL('./capabilities.json',import.meta.url),'utf8')).capabilities.filter(item=>item.id.startsWith('kurumi_'));
const playerNames = new Set(['kurumi_observe','kurumi_decide']);

async function initialize(host) {
  const service=new ReplayService(host);await service.initialize();initializeSources(host,service);setService(host,service);return {active:true};
}
const displayJobs = new WeakMap();
export function display(host, service, signal) {
  const prior=displayJobs.get(service); if(prior)return prior;
  const job=displayOnce(host,service,signal);displayJobs.set(service,job);
  // Both completion paths are observed; no detached rejecting finally Promise.
  job.then(()=>displayJobs.delete(service),()=>displayJobs.delete(service));
  return job;
}
async function displayOnce(host, service, signal) {
  const state = service.getState(); assert(state && service.getData(), '先准备并开始挑战');
  const source=(await host.data.sources({providerId:`${host.context.pluginId}#market`})).items.find(item=>item.available!==false)?.ref;
  assert(source,'Declared replay market source unavailable','SOURCE_UNAVAILABLE');
  {
    const symbol = service.getData().chapters[state.chapter].symbol;
    const found = await host.data.query({source,operation:'searchInstruments',input:{query:symbol},limit:10},{signal});
    const item = found.items.find(row => row.symbol === symbol); assert(item, '当前章品种未被provider揭示');
    const detail = await host.data.query({source,operation:'describeInstrument',input:{instrument:item.ref}},{signal});
    const exact = { source, instrument: detail.items[0].ref,
      spec: { timeframe:'1h', priceBasis:'bid', adjustment:'none',session:'all',calendarRevision:detail.items[0].calendar } };
    const layout = await host.views.inspect({surface:'canvas'}), id = 'kurumi-h1';
    const existing = (layout.charts ?? []).find(c => c.id === id);
    await host.views.apply({surface:'canvas',commandId:`kurumi_display_${state.id}_${state.chapter}_${layout.version}`, expectedVersion:layout.version,
      operations:[{op:existing?'update':'add',id,chart:{binding:exact,symbol:`${symbol} · 久留美模拟`,style:'candles',volume:false,markers:true,width:800,height:480}},{op:'panels',panels:{account:true,agents:true}}]});
    const audience=await publishMarkers(host,service,{operationId:`kurumi_markers_${state.id}_${state.chapter}_${state.version}`});
    const scriptLayout=await host.views.inspect({surface:'canvas'});
    const chart=scriptLayout.charts?.find(c=>c.id===id);
    assert(chart,'图表已被用户移除；未挂载指标','CHART_NOT_FOUND');
    const saved=records(host).get('ui','audience-overlay',true);
    const ids=chart.script_ids??[];
    const scripts=(scriptLayout.scripts??[]).filter(s=>ids.includes(s.id));
    // Saved ownership is not authority: inspect the live chart and instance.
    const owned=scripts.find(s=>s.id===saved?.scriptId&&saved.chartId===id&&
      s.artifact?.id===saved.artifact?.id&&s.artifact?.digest===saved.artifact?.digest);
    const recovered=scripts.filter(s=>s.artifact?.id===audience.ref.id&&s.artifact?.digest===audience.ref.digest);
    assert(owned||recovered.length<=1,'存在多个相同指标实例；不猜测或覆盖用户指标','AMBIGUOUS_INSTANCE');
    const scriptId=owned?.id??recovered[0]?.id;
    const mounted=await host.views.apply({surface:'indicator',action:'put',commandId:`kurumi_overlay_${state.id}_${state.version}_${scriptLayout.version}`,
      expectedVersion:scriptLayout.version,chartId:id,...(scriptId?{scriptId}:{}),artifact:audience.ref,parameters:{}});
    const resultChart=mounted.charts?.find(c=>c.id===id);
    const added=(resultChart?.script_ids??[]).filter(x=>!ids.includes(x));
    const actualId=added.length===1?added[0]:scriptId;
    const verified=await host.views.inspect({surface:'canvas'});
    assert(actualId&&verified.charts?.find(c=>c.id===id)?.script_ids?.includes(actualId)&&verified.scripts?.some(s=>s.id===actualId),
      '宿主未返回并确认当前图表的真实指标实例；不声明挂载成功','INDICATOR_INSTANCE_NOT_FOUND');
    records(host).transaction(()=>records(host).put('ui',{id:'audience-overlay',chartId:id,scriptId:actualId,artifact:audience.ref,runId:state.id}));
    // 当时布局/版本与指标素材归档（原始证据；渲染回执须由当前版本客户端另行确认）。
    const stamp=`${state.id}_${state.chapter}_${state.version}`;
    await service.archiveFileSafe(`markers/markers-${stamp}.js`,audience.bundle?.files?.['markers.js']??'');
    await service.archiveFileSafe(`markers/markers-${stamp}.snapshot.json`,JSON.stringify(audience.bundle?.snapshot??null));
    await service.archiveFileSafe(`layout/layout-${stamp}.json`,JSON.stringify(verified));
    await service.archiveSafe('display_layout',{layoutVersionBefore:layout.version,layoutVersionAfter:verified.version,chartId:id,instanceId:actualId,audience:audience.ref,binding:exact,markerSnapshotDigest:audience.bundle?.snapshotDigest??null,note:'当时布局与版本、指标代码/输入/计算结果已文件化归档；渲染回执须由当前版本客户端另行确认'});
    const dynamic=service.presentationEnabled?await service.refreshPresentation(host,{chart_id:id},signal):null;
    return {layout:verified,overlay:mounted,instanceId:actualId,audience,dynamic,binding:exact,account:{connectionId:'kurumi-simulation',accountId:state.id},simulated:true,
      note:'行情与指标实例已保存并经inspect核对；尚须当前版本客户端rendered回执确认显示。账户页选择久留美模拟账户。新实验可主会话refresh_presentation消费待办；服务侧每H1持久化展示/周报冻结，自动主会话布局/客户端回执仍须验收；资金不重置。'};
  }
}
export function createCapabilities(host) {
  const controls=definitions.map(def=>({name:def.id,execute:async(args,signal,execution)=>{
      if(!playerNames.has(def.id))assert(host.context.kind==='main','观众控制工具仅主Agent可用','SCOPE_DENIED');
      const service=getService(host);
      return service.invocation.run({...execution,signal,host},async()=>{
      switch(def.id) {
        case 'kurumi_prepare': return args.action === 'clear' ? service.clear(signal) : service.prepare(signal);
        case 'kurumi_status': return service.status();
        case 'kurumi_archive_terminal': return service.archiveTerminal(args,signal);
        case 'kurumi_audience': return service.audienceControl(host,args,signal);
        case 'kurumi_recording': return service.recordingControl(args,signal);
        case 'kurumi_experience': return service.experienceControl(host,args,signal);
        case 'kurumi_method_workflow': return service.methodWorkflow(host,args,signal);
        case 'kurumi_narration': return service.narrationControl(host,args,signal);
        case 'kurumi_new_experiment': return service.createExperiment(args,signal);
        case 'kurumi_weekly': return service.weeklyControl(args,signal);
        case 'kurumi_refresh_presentation': return service.refreshPresentation(host,args,signal);
        case 'kurumi_experiment_history': return service.experimentHistory();
        case 'kurumi_retry_committed_hooks': return service.retryCommittedHooks(args,signal);
        case 'kurumi_bind_experiment_fx': return service.bindExperimentFx(args,signal);
        case 'kurumi_import_fx_supplement': return service.importFxSupplement(args,signal);
        case 'kurumi_configure': return service.configure(args, signal);
        case 'kurumi_recover': return service.recover(args,signal);
        case 'kurumi_repair_checkpoint_text': return service.repairCheckpointText(args,signal);
        case 'kurumi_start': case 'kurumi_continue': return service.start(args, signal);
        case 'kurumi_step': return service.start({...args,max_steps:1},signal);
        case 'kurumi_pause': return service.pause(args,signal);
        case 'kurumi_reconcile': return service.reconcile(args,signal);
        case 'kurumi_display': return display(host,service,signal);
        case 'kurumi_export': return exportReplay(host,service,args.operation_id,signal);
        case 'kurumi_report': return publishReport(host,service,args.operation_id,signal);
        case 'kurumi_observe': return service.playerObserve(host);
        case 'kurumi_decide': return service.playerDecide(host,args,signal);
        default: throw new Error('Unknown tool');
      }
      });
    }}));
  return [...controls,...createSourceCapabilities(host),
    {name:'activate',execute:()=>initialize(host)},
    {name:'before_deactivate',execute:()=>{assert(!getService(host).getDocument()?.control.active,'先暂停并核对角色任务结束再停用/升级','RUN_ACTIVE');return {accepted:true};}},
    {name:'before_run_release',execute:async input=>{const service=getService(host);const protection=await service.protectArtifacts(input.runId,host);await service.cleanupRun(input.runId,protection);return protection;}},
    {name:'native_run',execute:(input,signal,execution)=>{assert(execution.provenance?.caller?.pluginId===host.context.pluginId,'Replay native work must originate from its owning plugin','SCOPE_DENIED');return executeNative({...input,storageDirectory:host.context.storageRoot},{signal,pythonPath:host.context.pythonPath});}},
    {name:'dispose',execute:async()=>{let service;try{service=getService(host);}catch{return {disposed:true};}try{await service.dispose(host);disposeSources(service);await disposeNative(host.context.storageRoot);}finally{removeService(host);closeRecords(host);}return {disposed:true};}},
  ];
}
