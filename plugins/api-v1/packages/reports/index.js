import { readFileSync } from 'node:fs';
import { backtestTemplate } from './backtest-template.js';
import { readWorkspace, writeWorkspace, publishFiles } from './artifact-io.js';

const fail = (condition, message) => { if (!condition) throw new Error(message); };
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const scriptJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const asset = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const safePath = path => typeof path === 'string' && path.length <= 256 && !path.startsWith('/') && !path.includes('\\') && path.split('/').every(part => part && part !== '.' && part !== '..');
const chartKinds = ['line', 'bar', 'scatter', 'matrix', 'units', 'waterfall', 'dumbbell', 'strip', 'histogram', 'boxplot', 'ridgeline', 'violin', 'calendar', 'parallel', 'bump', 'lifecycle', 'treemap', 'threads', 'flow', 'network-circular', 'network-force'];
const chartAssets = ['editorial-charts.js', 'charts-statistics.js', 'charts-temporal.js', 'charts-structure.js'];
const uniqueRefs = refs => [...new Map(refs.map(ref => [JSON.stringify([ref.id, ref.revision, ref.digest, ref.kind, ref.schemaVersion]), ref])).values()];

function assertPackaged(text, label) {
  // This is an authoring check. The host independently enforces the runtime CSP,
  // parses packaged resources, verifies digests, and grants only read-only refs.
  fail(!/<(?:base|iframe|object|embed|form)\b/i.test(text), `${label}: embedded frames, forms and base URLs are unsupported`);
  fail(!/<(?:script|img|source|video|audio)\b[^>]*\bsrc\s*=\s*["']?(?:https?:|\/\/)/i.test(text), `${label}: package remote resources before publishing`);
  fail(!/<link\b[^>]*\bhref\s*=\s*["']?(?:https?:|\/\/)/i.test(text), `${label}: package styles and fonts before publishing`);
  fail(!/(?:@import\s*|url\(\s*)["']?(?:https?:|\/\/)/i.test(text), `${label}: CSS resources must be packaged`);
}

export function createCapabilities(host) {
  return [
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
      const zh = args.locale === 'zh-CN';
      const config = {
        dataId: args.data_id, title: args.title, summary: args.summary, takeaway: args.takeaway, sourceNote: args.source_note,
        label: args.demo ? (zh ? '演示样本 · 非实盘结果' : 'DEMO SAMPLE · NOT LIVE RESULTS') : (zh ? '研究笔记' : 'RESEARCH BRIEF'),
        labels: zh ? { sample: '样本', unit: '单位', evidence: '证据', table: '查看明细', filter: '筛选', placeholder: '搜索固定数据', binding: '固定数据' } : { sample: 'Sample', unit: 'Unit', evidence: 'Evidence', table: 'Inspect the values', filter: 'Filter', placeholder: 'Search the frozen data', binding: 'Fixed data' },
        columns: args.columns, chartData, chart: { ...extra, kind: args.kind, ...(args.x ? { x: args.x } : {}), ...(args.y ? { y: args.y } : {}), ...(args.value ? { value: args.value } : {}), unit: args.unit, ...(args.unit_value ? { unitValue: args.unit_value } : {}), title: args.chart_title },
      };
      const values = { LOCALE: args.locale ?? 'en', TITLE: args.title };
      let html = asset('templates/research-brief.html').replace(/\{\{([A-Z_]+)\}\}/g, (token, key) => Object.hasOwn(values, key) ? escapeHTML(values[key]) : token);
      html = html.replace('{{STYLES}}', () => asset('assets/editorial.css')).replace('{{KIT}}', () => asset('assets/report-kit.js')).replace('{{CHARTS}}', () => chartAssets.map(name => asset(`assets/${name}`)).join('\n')).replace('{{CONFIG}}', () => scriptJSON(config));
      const written = await writeWorkspace(host, args.output_path, html, signal);
      return { path: written.path, bytes: Buffer.byteLength(html), runtime: 'sesame-report/1', runtimeRevision: '1.0.0', binding: args.data_id, editable: true };
    } },
    backtestTemplate(host),
    { name: 'report_read', execute: async (args, signal) => {
      if (!args.ref) return host.data.query({ source: { providerId: 'host#artifacts', revision: 'host:2' }, input: { kind: 'report' }, limit: args.limit ?? 30, ...(args.cursor ? { cursor: args.cursor } : {}) }, { signal });
      const manifest = await host.resources.read(args.ref, { part: 'manifest' }), metadata = await host.resources.read(args.ref, { part: 'metadata' });
      return { ...metadata, manifest, ...(args.include_checks ? { checks: (await host.resources.read(args.ref, { part: 'receipts' })).items } : {}) };
    } },
    { name: 'report_check', execute: (args, signal) => host.views.inspect({ surface: 'artifact', ref: args.ref }, { signal }) },
    { name: 'report_publish', execute: async (args, signal) => {
      let bytes = await readWorkspace(host, args.html_path, signal, args.operation_id), html = utf8(bytes);
      fail(bytes.length > 0 && bytes.length <= 1024 * 1024 && /<[a-z][a-z0-9:-]*(?:\s+(?:[^<>"']|"[^"<>]*"|'[^'<>]*')*)?\s*\/?>/i.test(html), 'Report requires valid authored HTML up to 1 MiB');
      assertPackaged(html, 'HTML');
      const related = [...(args.related ?? [])];
      if (args.strategy_source) {
        fail(args.strategy_source.kind === 'strategy.source', 'strategy_source requires a fixed SVL source');
        if (!related.some(item => item.role === 'strategy' && item.artifact?.id === args.strategy_source.id && item.artifact?.revision === args.strategy_source.revision && item.artifact?.digest === args.strategy_source.digest)) related.push({ role: 'strategy', artifact: args.strategy_source });
      }
      fail(related.length <= 32, 'At most 32 related entries, including strategy_source');
      const refs = uniqueRefs([...args.data.map(binding => binding.ref), ...related.flatMap(item => item.artifact ? [item.artifact] : []), ...(args.references ?? [])]);
      const records = await Promise.all(refs.map(ref => host.resources.read(ref, { part: 'manifest' })));
      fail(new Set(args.data.map(binding => binding.id)).size === args.data.length, 'Report data binding IDs must be unique');
      fail(!records.some(record => record.content.provenance?.kind === 'demo') || args.provenance_kind === 'demo', 'Reports with demo inputs must remain labelled demo');
      if (args.provenance_kind === 'demo') fail(/demo|演示|样本/i.test(html), 'Demo reports must visibly identify their data as demo');
      if (args.provenance_kind === 'demo') {
        // Authored JavaScript can contain the word "demo" without displaying it.
        // Publish an explicit badge from the artifact provenance as well.
        const badge = '<aside data-sesame-provenance="demo" role="note" style="display:block!important;visibility:visible!important;opacity:1!important;padding:8px 0;font:600 12px/1.5 system-ui;color:var(--report-muted,#626262)">DEMO · 演示数据</aside>';
        html = /<body\b[^>]*>/i.test(html) ? html.replace(/<body\b[^>]*>/i, value => value + badge) : badge + html;
        bytes = Buffer.from(html, 'utf8');
        fail(bytes.length <= 1024 * 1024, 'Report including provenance badge exceeds 1 MiB');
      }
      for (const relation of related) { fail(Boolean(relation.artifact) !== Boolean(relation.record), 'Related evidence requires exactly one artifact or versioned record'); if (relation.record) await host.data.query({ source: { providerId: 'host#records', revision: 'host:2' }, input: { recordId: relation.record.id, version: relation.record.version }, limit: 1 }, { signal }); }
      const blobs = [{ bytes, path: 'index.html', mediaType: 'text/html' }], paths = new Set(['index.html']);
      let total = bytes.length;
      for (const item of args.assets ?? []) {
        fail(safePath(item.path) && !paths.has(item.path), 'Asset paths must be unique, safe and relative'); paths.add(item.path);
        const content = await readWorkspace(host, item.source_path, signal, args.operation_id); total += content.length;
        fail(total <= 16 * 1024 * 1024, 'Report assets exceed 16 MiB');
        if (/^(text\/|application\/(?:javascript|json))/.test(item.media_type)) assertPackaged(utf8(content), item.path);
        blobs.push({ bytes: content, path: item.path, mediaType: item.media_type });
      }
      signal?.throwIfAborted();
      const provenance = { kind: args.provenance_kind, references: refs };
      const features = [...new Set([...(args.features ?? ['interactive']), ...(args.strategy_source ? ['strategy_details'] : [])])];
      const content = { schemaVersion: '1.0.0', title: args.title, summary: args.summary, entry: 'index.html', runtime: 'sesame-report/1', runtimeRevision: '1.0.0', data: args.data, related, features, locale: args.locale ?? 'en', provenance };
      const published = await publishFiles(host, args.operation_id, { kind: 'report', schemaVersion: '1.0.0', content, dependencies: refs, provenance }, blobs, args.artifact_id ? { artifactId: args.artifact_id, expectedRevision: args.expected_revision ?? null } : {}, signal);
      const ref = published.ref;
      return { ref, title: args.title, data: args.data, runtime: content.runtime, runtimeRevision: content.runtimeRevision, renderStatus: 'not_checked' };
    } },
  ];
}
