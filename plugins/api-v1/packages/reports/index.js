import { readFileSync } from 'node:fs';

const fail = (condition, message) => { if (!condition) throw new Error(message); };
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const scriptJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const asset = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const safePath = path => typeof path === 'string' && path.length <= 256 && !path.startsWith('/') && !path.includes('\\') && path.split('/').every(part => part && part !== '.' && part !== '..');
const origins = ['observed', 'derived', 'user_input', 'demo'];
const chartKinds = ['line', 'bar', 'scatter', 'matrix', 'units', 'waterfall', 'dumbbell', 'strip', 'histogram', 'boxplot', 'ridgeline', 'violin', 'calendar', 'parallel', 'bump', 'lifecycle', 'treemap', 'threads', 'flow', 'network-circular', 'network-force'];
const chartAssets = ['editorial-charts.js', 'charts-statistics.js', 'charts-temporal.js', 'charts-structure.js'];
const uniqueRefs = refs => [...new Map(refs.map(ref => [JSON.stringify([ref.id, ref.revision, ref.digest, ref.kind, ref.schemaVersion]), ref])).values()];
const refSchema = (Type, kind) => Type.Object({ id: Type.String(), revision: Type.String(), digest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), kind: kind ? Type.Literal(kind) : Type.String(), schemaVersion: Type.Literal('1.0.0') }, { additionalProperties: false });
const originSchema = Type => Type.Union(origins.map(kind => Type.Literal(kind)));

function provenanceKind(dataset, supplied) {
  const metadata = dataset.provenance ?? {};
  const recorded = [metadata.kind, metadata.origin, metadata.meta?.origin].find(value => origins.includes(value));
  const kind = recorded ?? supplied;
  fail(origins.includes(kind), 'Dataset has no provenance kind; explicitly describe it as observed, derived, user_input or demo');
  fail(!recorded || !supplied || supplied === recorded, 'Provenance kind differs from the registered dataset');
  return kind;
}

function assertPackaged(text, label) {
  // This is an authoring check. The host independently enforces the runtime CSP,
  // parses packaged resources, verifies digests, and grants only read-only refs.
  fail(!/<(?:base|iframe|object|embed|form)\b/i.test(text), `${label}: embedded frames, forms and base URLs are unsupported`);
  fail(!/<(?:script|img|source|video|audio)\b[^>]*\bsrc\s*=\s*["']?(?:https?:|\/\/)/i.test(text), `${label}: package remote resources before publishing`);
  fail(!/<link\b[^>]*\bhref\s*=\s*["']?(?:https?:|\/\/)/i.test(text), `${label}: package styles and fonts before publishing`);
  fail(!/(?:@import\s*|url\(\s*)["']?(?:https?:|\/\/)/i.test(text), `${label}: CSS resources must be packaged`);
}

export function createTools(host) {
  const { define, Type, string, optional } = host.tools;
  const anyRef = refSchema(Type), dataRef = refSchema(Type, 'data');
  const dependencies = Type.Optional(Type.Array(anyRef, { maxItems: 64 }));
  return [
    define('report_data', 'Freeze a registered dataset into an immutable data artifact for reports. Preserves exact decimal strings, registration provenance and actual row bytes. Demo data remains demo.', {
      operation_id: string('Stable idempotency key for this exact snapshot'), dataset_id: string('Existing registered dataset ID'), provenance_kind: Type.Optional(originSchema(Type)), dependencies,
    }, args => {
      const dataset = host.datasets.read(args.dataset_id), kind = provenanceKind(dataset, args.provenance_kind);
      fail(Array.isArray(dataset.rows) && dataset.rows.length <= 1000000, 'Dataset requires at most one million frozen rows');
      fail(dataset.rows.every(row => row && typeof row === 'object' && !Array.isArray(row)), 'Dataset rows must be objects');
      const refs = uniqueRefs(args.dependencies ?? []);
      for (const ref of refs) {
        const input = host.artifacts.read(ref);
        fail(input.manifest.content.provenance?.kind !== 'demo' || kind === 'demo', 'Data derived from demo inputs must remain labelled demo');
      }
      const bytes = JSON.stringify(dataset.rows), blob = host.artifacts.blob(bytes);
      const columns = [...new Set(dataset.rows.flatMap(row => Object.keys(row)))];
      fail(columns.length <= 256, 'Dataset exceeds 256 columns');
      const registration = { datasetId: dataset.id, title: dataset.title ?? dataset.id, producerPluginId: dataset.producer_plugin_id ?? null, executionId: dataset.execution_id ?? null, inputIds: dataset.input_ids ?? [], sourceProvenance: dataset.provenance ?? {}, provenanceKind: kind };
      // The registration itself is frozen as evidence. It is explicitly a
      // recorded input, not a claim that upstream calculations were verified.
      const evidence = host.artifacts.publish({ operationId: `${args.operation_id}:registration`, manifest: { kind: 'resource', schemaVersion: '1.0.0', content: { type: 'dataset-registration', ...registration, path: 'rows.json', rowCount: dataset.rows.length, provenance: { kind, references: refs } }, dependencies: refs, blobs: [{ ...blob, path: 'rows.json', mediaType: 'application/json' }], provenance: { kind, references: refs } } });
      const pinned = uniqueRefs([evidence, ...refs]);
      const provenance = { kind, references: pinned, registration, precision: 'Source JSON strings are preserved; existing JSON numbers retain their original precision.' };
      const ref = host.artifacts.publish({ operationId: args.operation_id, manifest: { kind: 'data', schemaVersion: '1.0.0', content: { format: 'json-rows', path: 'rows.json', rowCount: dataset.rows.length, columns, provenance }, dependencies: pinned, blobs: [{ ...blob, path: 'rows.json', mediaType: 'application/json' }], provenance } });
      return { ref, rowCount: dataset.rows.length, columns, provenance };
    }),
    define('report_template', 'Write an editable report/1 HTML scaffold with Sesame’s original typography, conclusion, numbered evidence and folded methods. Optional comparison, distribution, temporal and relationship charts use the same style. Read report-design for chart field mappings; all chart data comes from named fixed bindings.', {
      output_path: string('Workspace HTML path to create'), title: string('Descriptive report title'), summary: string('Main finding supported by the bound data'), data_id: string('Exact binding ID to include in report_publish.data'), chart_title: string('Chart title with scope and period'), takeaway: string('The supported point this chart makes'), source_note: string('Source, observation period, units and material limitations'),
      kind: Type.Union(chartKinds.map(value => Type.Literal(value))), x: optional('Category or x-coordinate column; required by line/bar/scatter/matrix/units'), y: optional('Value or matrix row column; required by line/bar/scatter/matrix/units'), value: optional('Matrix numeric value column'), unit: string('Displayed measurement unit'), unit_value: Type.Optional(Type.Number({ exclusiveMinimum: 0 })), columns: Type.Array(string('Exact column name in the data'), { minItems: 1, maxItems: 32 }), locale: Type.Optional(Type.Union([Type.Literal('en'), Type.Literal('zh-CN')])), demo: Type.Optional(Type.Boolean()),
      chart_options: Type.Optional(Type.Object({}, { additionalProperties: true, description: 'Chart-specific field mappings and display options from report-design. Do not put data rows, callbacks or computed financial results here.' })),
      chart_data: Type.Optional(Type.Array(Type.Object({ property: string('Extra chart data property, for example nodes'), data_id: string('Fixed report data binding to read for that property') }, { additionalProperties: false }), { maxItems: 8 })),
    }, async (args, signal) => {
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
      await host.workspace.file('write', args.output_path, html, signal);
      return { path: args.output_path, bytes: Buffer.byteLength(html), runtime: 'sesame-report/1', runtimeRevision: '1.0.0', binding: args.data_id, editable: true };
    }),
    define('report_read', 'List fixed report artifact revisions or read an exact report reference, including its pinned data and related evidence.', {
      ref: Type.Optional(refSchema(Type, 'report')), include_checks: Type.Optional(Type.Boolean()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }, args => args.ref ? { ...host.artifacts.read(args.ref), ...(args.include_checks ? { checks: host.artifacts.receipts(args.ref) } : {}) } : host.artifacts.list({ kind: 'report', limit: args.limit ?? 30, offset: args.offset ?? 0 })),
    define('report_check', 'Render an exact published report revision through the host inspector. Return the persisted actual rendering receipt, viewport checks and diagnostics. Repair failed HTML as a new revision and inspect it again.', {
      ref: refSchema(Type, 'report'),
    }, (args, signal) => host.artifacts.inspect(args.ref, signal)),
    define('report_publish', 'Publish Agent-authored HTML and packaged assets as an immutable report/1 artifact. All data and related artifacts are fixed references; report code gets only the read-only bridge. Publication does not claim successful rendering.', {
      operation_id: string('Stable idempotency key for this exact report'), title: string('Report title'), summary: string('Supported takeaway'), html_path: string('Authored workspace HTML file'), locale: Type.Optional(string('BCP 47 language, for example en or zh-CN')), provenance_kind: originSchema(Type),
      data: Type.Array(Type.Object({ id: string('Local data binding ID used by report.readData'), ref: dataRef, usage: string('What this fixed data supports') }, { additionalProperties: false }), { maxItems: 32 }),
      related: Type.Optional(Type.Array(Type.Object({ role: Type.Union(['strategy', 'translation', 'run', 'result', 'source'].map(role => Type.Literal(role))), artifact: Type.Optional(anyRef), record: Type.Optional(Type.Object({ id: Type.String(), version: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })) }, { additionalProperties: false }), { maxItems: 32 })),
      references: dependencies, features: Type.Optional(Type.Array(Type.Union(['interactive', 'strategy_details', 'trade_details'].map(value => Type.Literal(value))), { maxItems: 3 })),
      assets: Type.Optional(Type.Array(Type.Object({ path: string('Safe relative path used by the HTML'), source_path: string('Workspace file containing this asset'), media_type: string('Exact MIME type') }, { additionalProperties: false }), { maxItems: 64 })),
      artifact_id: optional('Existing report artifact ID for a new revision'), expected_revision: optional('Exact current revision when updating'),
    }, async (args, signal) => {
      const bytes = await host.workspace.file('read', args.html_path, undefined, signal), html = utf8(bytes);
      fail(bytes.length > 0 && bytes.length <= 1024 * 1024 && /<[a-z][a-z0-9:-]*(?:\s+(?:[^<>"']|"[^"<>]*"|'[^'<>]*')*)?\s*\/?>/i.test(html), 'Report requires valid authored HTML up to 1 MiB');
      assertPackaged(html, 'HTML');
      const related = args.related ?? [], refs = uniqueRefs([...args.data.map(binding => binding.ref), ...related.flatMap(item => item.artifact ? [item.artifact] : []), ...(args.references ?? [])]);
      const records = refs.map(ref => host.artifacts.read(ref));
      fail(new Set(args.data.map(binding => binding.id)).size === args.data.length, 'Report data binding IDs must be unique');
      fail(!records.some(record => record.manifest.content.provenance?.kind === 'demo') || args.provenance_kind === 'demo', 'Reports with demo inputs must remain labelled demo');
      if (args.provenance_kind === 'demo') fail(/demo|演示|样本/i.test(html), 'Demo reports must visibly identify their data as demo');
      for (const relation of related) { fail(Boolean(relation.artifact) !== Boolean(relation.record), 'Related evidence requires exactly one artifact or versioned record'); if (relation.record) host.records.read(relation.record.id, relation.record.version); }
      const blobs = [{ ...host.artifacts.blob(bytes), path: 'index.html', mediaType: 'text/html' }], paths = new Set(['index.html']);
      let total = bytes.length;
      for (const item of args.assets ?? []) {
        fail(safePath(item.path) && !paths.has(item.path), 'Asset paths must be unique, safe and relative'); paths.add(item.path);
        const content = await host.workspace.file('read', item.source_path, undefined, signal); total += content.length;
        fail(total <= 16 * 1024 * 1024, 'Report assets exceed 16 MiB');
        if (/^(text\/|application\/(?:javascript|json))/.test(item.media_type)) assertPackaged(utf8(content), item.path);
        blobs.push({ ...host.artifacts.blob(content), path: item.path, mediaType: item.media_type });
      }
      signal?.throwIfAborted();
      const provenance = { kind: args.provenance_kind, references: refs };
      const content = { schemaVersion: '1.0.0', title: args.title, summary: args.summary, entry: 'index.html', runtime: 'sesame-report/1', runtimeRevision: '1.0.0', data: args.data, related, features: args.features ?? ['interactive'], locale: args.locale ?? 'en', provenance };
      const ref = host.artifacts.publish({ operationId: args.operation_id, ...(args.artifact_id ? { artifactId: args.artifact_id, expectedRevision: args.expected_revision ?? null } : {}), manifest: { kind: 'report', schemaVersion: '1.0.0', content, dependencies: refs, blobs, provenance } });
      return { ref, title: args.title, data: args.data, runtime: content.runtime, runtimeRevision: content.runtimeRevision, renderStatus: 'not_checked' };
    }),
  ];
}
