import { compositionKinds } from './report-chart-fields.js';
import { renderStructuredReport } from './report-content.js';
import { reportStyleCapabilities } from './report-styles.js';
import { backtestTemplate } from './backtest-template.js';
import { writeWorkspace } from './artifact-io.js';
import { renderReport, publishReport } from './report-provider.js';
import { reportCompositionCapabilities } from './report-compose.js';

const fail = (condition, message) => { if (!condition) throw new Error(message); };
const chartKinds = [...compositionKinds, 'line', 'bar', 'scatter', 'matrix', 'units', 'waterfall', 'dumbbell', 'strip', 'histogram', 'boxplot', 'ridgeline', 'violin', 'calendar', 'parallel', 'bump', 'lifecycle', 'treemap', 'threads', 'flow', 'network-circular', 'network-force', 'decision-tree', 'candlestick'];
export function createCapabilities(host) {
  return [
    ...reportStyleCapabilities(host),
    ...reportCompositionCapabilities(host),
    { name: 'report_data', execute: async (args, signal) => {
      fail(args.source ? args.input && args.title && !args.dataset_id : args.dataset_id, 'Choose dataset_id or explicit source, input and title');
      const result = await host.capabilities.invoke('sesame/data-access#data_snapshot', { source: args.source ?? { providerId: 'host#datasets', revision: 'host:2' }, operationId: args.operation_id, title: args.title ?? args.dataset_id, input: args.input ?? { datasetId: args.dataset_id }, ...(args.provenance_kind ? { provenanceKind: args.provenance_kind } : {}), ...(args.dependencies ? { dependencies: args.dependencies } : {}) }, { signal });
      fail(result.type === 'result', 'Data snapshot must return an immediate result');
      return result.value;
    } },
    { name: 'report_template', execute: async (args, signal) => {
      fail(args.kind !== 'matrix' || args.value, 'Matrix charts require a value column');
      fail(chartKinds.includes(args.kind), 'Unknown chart kind');
      fail(!['line', 'bar', 'scatter', 'matrix', 'units'].includes(args.kind) || (args.x && args.y), 'This chart requires x and y column mappings');
      const protectedOptions = new Set(['rows', 'data', 'kind', 'title', 'onSelect', 'onFilter', 'onError', '__proto__', 'constructor', 'prototype']);
      const extra = args.chart_options ?? {};
      fail(extra && typeof extra === 'object' && !Array.isArray(extra), 'chart_options must be an object');
      fail(!Object.hasOwn(extra, 'nodes'), 'Node rows must use chart_data with a fixed nodes binding');
      fail(Object.keys(extra).every(key => !protectedOptions.has(key)), 'Chart data, lifecycle callbacks and identity cannot be supplied through chart_options');
      const chartData = args.chart_data ?? [];
      fail(chartData.every(item => /^[a-z][a-zA-Z0-9_]*$/.test(item.property) && !protectedOptions.has(item.property) && !['x', 'y', 'value', 'unit', 'unitValue'].includes(item.property)), 'Extra chart data requires an unreserved property name');
      fail(new Set(chartData.map(item => item.property)).size === chartData.length, 'Extra chart data properties must be unique');
      const content = { kind:'document', sections:[{title:args.chart_title??args.title,blocks:[{type:'chart',title:args.chart_title??args.title,kind:args.kind,columns:args.columns,options:{...extra,...(args.x?{x:args.x}:{}),...(args.y?{y:args.y}:{}),...(args.value?{value:args.value}:{}),...(args.unit?{unit:args.unit}:{}),...(args.unit_value?{unitValue:args.unit_value}:{})},data_id:args.data_id,takeaway:args.takeaway,source_note:args.source_note,...(chartData.length?{chart_data:chartData}:{})}]}] };
      // Previews know binding names; publication still requires real complete refs.
      const html = await renderStructuredReport(host,{...args,content,data:[{id:args.data_id},...chartData.map(item=>({id:item.data_id}))],provenance_kind:args.demo?'demo':'derived'},signal);
      const written = await writeWorkspace(host,args.output_path,html,signal);
      return {path:written.path,bytes:Buffer.byteLength(html),runtime:'sesame-report/1',runtimeRevision:'1.0.0',binding:args.data_id,editable:false,publish:{title:args.title,summary:args.summary,content,style:args.style??{},provenance_kind:args.demo?'demo':'derived'}};
    } },
    { name: 'report_document_template', execute: async (args, signal) => {
      fail(!Object.hasOwn(args, 'body_html') && !Object.hasOwn(args, 'html_path'), 'Custom HTML is disabled; supply structured content');
      const html = await renderStructuredReport(host, { ...args, summary: args.summary ?? '', data: args.data ?? [], provenance_kind: args.provenance_kind ?? 'derived' }, signal);
      fail(Buffer.byteLength(html) <= 1024 * 1024, 'Report exceeds 1 MiB');
      const written = await writeWorkspace(host, args.output_path, html, signal);
      return { path: written.path, bytes: Buffer.byteLength(html), runtime: 'sesame-report/1', runtimeRevision: '1.0.0', editable: false, publish: { content: args.content, style: args.style ?? {} } };
    } },
    backtestTemplate(host),
    { name: 'report_read', execute: async (args, signal) => {
      if (!args.ref) return host.data.query({ source: { providerId: 'host#artifacts', revision: 'host:2' }, input: { kind: 'report' }, limit: args.limit ?? 30, ...(args.cursor ? { cursor: args.cursor } : {}) }, { signal });
      const manifest = await host.resources.read(args.ref, { part: 'manifest' }), metadata = await host.resources.read(args.ref, { part: 'metadata' });
      return { ...metadata, manifest, ...(args.include_checks ? { checks: (await host.resources.read(args.ref, { part: 'receipts' })).items } : {}) };
    } },
    { name: 'report_check', execute: (args, signal) => host.views.inspect({ surface: 'artifact', ref: args.ref }, { signal }) },
    { name: 'report_export_check', execute: (args, signal) => host.views.inspect({ surface: 'report-export', ref: args.ref }, { signal }) },
    { name: 'report_render', execute: (args, signal) => renderReport(host, args, signal) },
    { name: 'report_publish', execute: (args, signal) => publishReport(host, args, signal) },
  ];
}
