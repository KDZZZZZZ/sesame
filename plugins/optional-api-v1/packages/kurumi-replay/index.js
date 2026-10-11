import { readFileSync } from 'node:fs';
import { ReplayService, getService, setService, removeService, assert } from './service.js';
import { registerProviders } from './providers.js';
import { publishReport, exportReplay } from './report.js';
import { publishMarkers } from './markers.js';
import { disposeNative } from './native-engine.js';
const definitions = JSON.parse(readFileSync(new URL('./tools.json', import.meta.url), 'utf8'));
const playerNames = new Set(['kurumi_observe','kurumi_decide']);

export async function activate(host) {
  assert(host.agents?.submit && host.inference?.models, '久留美插件需要 Sesame >=0.2.2 的真实Agent接口', 'HOST_INCOMPATIBLE');
  const service = new ReplayService(host); await service.initialize(); setService(host, service);
  const unregister = registerProviders(host, service);
  return {
    beforeDeactivate() { assert(!service.getDocument()?.control.active, '先暂停并核对角色任务结束再停用/升级', 'RUN_ACTIVE'); },
    async dispose() { await service.dispose(); await disposeNative(host.storage.directory); await unregister(); removeService(host); },
  };
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
  const provider = { pluginId: host.plugin.id, providerId: 'market' };
  const binding = await host.providers.bind(provider, {}, signal);
  try {
    const symbol = service.getData().chapters[state.chapter].symbol;
    const found = await host.providers.call(binding.bindingId,'searchInstruments',{query:symbol,page:{limit:10}},{signal});
    const item = found.data.items.find(row => row.symbol === symbol); assert(item, '当前章品种未被provider揭示');
    const detail = await host.providers.call(binding.bindingId,'describeInstrument',{instrument:item.ref},{signal});
    const exact = { provider, connection: binding.connection, instrument: detail.data.ref,
      spec: { timeframe:'1h', priceBasis:'bid', adjustment:'none',session:'all',calendarRevision:detail.data.calendar } };
    const layout = await host.layout.inspect(), id = 'kurumi-h1';
    const existing = (layout.charts ?? []).find(c => c.id === id);
    const applied = await host.layout.apply({command_id:`kurumi_display_${state.id}_${state.chapter}_${layout.version}`, expected_version:layout.version,
      operations:[{op:existing?'update':'add',id,chart:{binding:exact,symbol:`${symbol} · 久留美模拟`,style:'candles',volume:false,markers:true,width:800,height:480}},{op:'panels',panels:{account:true,agents:true}}]});
    const audience=await publishMarkers(host,service,{operationId:`kurumi_markers_${state.id}_${state.chapter}_${state.version}`});
    const scriptLayout=await host.layout.inspect();
    const chart=scriptLayout.charts?.find(c=>c.id===id);
    assert(chart,'图表已被用户移除；未挂载指标','CHART_NOT_FOUND');
    const saved=host.storage.get('ui','audience-overlay',true);
    const ids=chart.script_ids??[];
    const scripts=(scriptLayout.scripts??[]).filter(s=>ids.includes(s.id));
    // Saved ownership is not authority: inspect the live chart and instance.
    const owned=scripts.find(s=>s.id===saved?.scriptId&&saved.chartId===id&&
      s.artifact?.id===saved.artifact?.id&&s.artifact?.digest===saved.artifact?.digest);
    const recovered=scripts.filter(s=>s.artifact?.id===audience.ref.id&&s.artifact?.digest===audience.ref.digest);
    assert(owned||recovered.length<=1,'存在多个相同指标实例；不猜测或覆盖用户指标','AMBIGUOUS_INSTANCE');
    const scriptId=owned?.id??recovered[0]?.id;
    const mounted=await host.layout.script({action:'put',command_id:`kurumi_overlay_${state.id}_${state.version}_${scriptLayout.version}`,
      expected_version:scriptLayout.version,chart_id:id,...(scriptId?{script_id:scriptId}:{}),artifact:audience.ref,parameters:{}});
    const resultChart=mounted.charts?.find(c=>c.id===id);
    const added=(resultChart?.script_ids??[]).filter(x=>!ids.includes(x));
    const actualId=added.length===1?added[0]:undefined;
    const verified=await host.layout.inspect();
    assert(actualId&&verified.charts?.find(c=>c.id===id)?.script_ids?.includes(actualId)&&verified.scripts?.some(s=>s.id===actualId),
      '宿主未返回并确认当前图表的真实指标实例；不声明挂载成功','INDICATOR_INSTANCE_NOT_FOUND');
    host.storage.transaction(()=>host.storage.put('ui',{id:'audience-overlay',chartId:id,scriptId:actualId,artifact:audience.ref,runId:state.id}));
    return {layout:verified,overlay:mounted,instanceId:actualId,audience,binding:exact,account:{connectionId:'kurumi-simulation',accountId:state.id},simulated:true,
      note:'行情与指标实例已保存并经inspect核对；尚须当前版本客户端rendered回执确认显示。账户页选择久留美模拟账户。静态标记推进后display刷新；资金不重置。'};
  } finally { await host.providers.unbind(binding.bindingId); }
}
export function createTools(host) {
  // Factory names must match the manifest in every scope. The host request
  // allowlist exposes only two player tools; controller handlers deny non-main.
  return definitions.map(def => {
    const properties = Object.fromEntries(Object.entries(def.parameters.properties).map(([key,schema]) => [key, def.parameters.required.includes(key)?schema:host.tools.Type.Optional(schema)]));
    return host.tools.define(def.name, def.description, properties, async (args, signal) => {
      if (!playerNames.has(def.name)) assert(host.scope.kind === 'main','观众控制工具仅主Agent可用','SCOPE_DENIED');
      const service = getService(host);
      switch(def.name) {
        case 'kurumi_prepare': return args.action === 'clear' ? service.clear(signal) : service.prepare(signal);
        case 'kurumi_status': return service.status();
        case 'kurumi_recover': return service.recover(args,signal);
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
  });
}
