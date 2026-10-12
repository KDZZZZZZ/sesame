// UI-owned public 0.2.2 receiver. Pure projections, NOT a host/SDK/client probe.
// Never synthesize operationId/asOf/visible keys in a raw frontend receipt.
const canonical=x=>x===undefined?'null':x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const copy=x=>structuredClone(x);
export function chartRuntimeReceipt(raw,expected){
 const scene=raw.inspect,chart=scene?.charts?.find(c=>c.id===expected.chartId),instance=scene?.scripts?.find(s=>s.id===expected.instanceId);
 const base={expected:copy(expected),raw:copy(raw),nativeVisibility:{status:'pending',level:'pixel',reason:'Inspect chart status is not per-point or pixel visibility'},availableLevel:'none'};
 if(scene?.version!==expected.layoutVersion||!chart?.script_ids?.includes(expected.instanceId)||!instance||!same(instance.artifact,expected.artifact)||!same(chart.binding,expected.binding))return {...base,status:'pending',reason:'Current layout version/binding/exact instance/artifact mismatch'};
 if(expected.generation!==undefined&&!same(instance.generation,expected.generation))return {...base,status:'pending',reason:'Current host generation changed'};
 const matching=(scene.rendering??[]).filter(r=>r.version===scene.version&&r.charts?.some(c=>c.id===chart.id));
 const records=matching.map(r=>({receipt:r,chart:r.charts.find(c=>c.id===chart.id)}));
 if(!records.length)return {...base,status:'pending',availableLevel:'exact_mount',reason:'No current-version target-chart client receipt yet'};
 const bad=records.find(r=>r.chart.status!=='rendered');
 if(bad)return {...base,status:bad.chart.status==='failed'?'failed':'pending',availableLevel:'chart_runtime',reason:'Current-version target chart has non-rendered diagnostics',evidence:{kind:'public_layout_inspect',receipts:copy(matching)}};
 return {...base,status:'rendered',availableLevel:expected.generation===undefined?'chart_runtime_exact_mount_generation_unavailable':'chart_runtime_exact_mount_host_generation',evidence:{kind:'public_layout_inspect',receipts:copy(matching),bindingProof:'Current inspect exact binding/script membership/artifact; not receipt per-point identity',instanceReceiptFields:'unavailable in current public rendering contract',hostGeneration:expected.generation??null},reason:'Same-version target chart rendered; pixel comparison remains independently unverified'};
}
export function nativeReportReceipt(raw,expected){
 const rows=Array.isArray(raw)?raw:[raw];
 const matches=rows.filter(r=>r?.status==='rendered'&&r.renderer?.name==='sesame-report'&&same(r.artifact,expected.ref)&&typeof r.viewInstanceId==='string'&&r.viewInstanceId.length&&Number.isSafeInteger(r.observedAt));
 if(!matches.length)return {status:'pending',raw:copy(raw),availableLevel:'published_only',reason:'Exact report has no native sesame-report rendered receipt; inspector is not native opening'};
 return {status:'opened',raw:copy(raw),availableLevel:'native_page_rendered_pixel_unverified',evidence:{kind:'public_artifacts_receipts',receipts:copy(matches)},derivedBinding:copy(expected),nativeVisibility:{status:'pending',level:'pixel',reason:'Native page runtime receipt does not certify human-visible pixels'}};
}
