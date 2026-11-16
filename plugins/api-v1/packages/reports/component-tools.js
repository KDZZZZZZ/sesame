import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Errors } from '@sesame/plugin-sdk/schema/value';
import { REPORT_ARTIFACT_REF_SCHEMA } from '@sesame/plugin-sdk/report-contract';
import { COMPONENT_PROTOCOL, listComponents, describeComponents, getChartSchema } from './component-catalog.js';
import { renderStructuredReport } from './report-content.js';
import { renderReport, publishReport } from './report-provider.js';
import { chartValue } from './report-chart-fields.js';
import { readWorkspaceBytes } from './report-prepare.js';
import { normalizeComponentContent, readComponentResource as readResource, readComponentJson as readJson, isSafeComponentEntry as safeEntry } from './component-input.js';

const manifest = JSON.parse(readFileSync(new URL('./capabilities.json', import.meta.url), 'utf8'));
const schema = id => manifest.capabilities.find(item => item.id === id).inputSchema;
const rendererSchema = schema('report_render');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (condition, path, message) => { if (!condition) throw new Error(`${path}: ${message}`); };
const pointer = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const publicPath = path => path.replace(/^\/input(?=\/|$)/, '').replace(/^\/metadata\/provenanceKind$/, '/provenance_kind').replace(/^\/metadata(?=\/|$)/, '') || '/';

function diagnostic(error, fallback = '/content') {
  const match = /^(\/[^:]*):\s*([\s\S]*)$/.exec(error.message);
  return { path: publicPath(match?.[1] ?? fallback), message: match?.[2] ?? error.message };
}

function schemaDiagnostics(errors) {
  const diagnostics = errors.map(error => {
    const extra = error.params?.additionalProperties?.[0];
    const missing = error.params?.requiredProperties?.[0];
    const path = publicPath(`${error.instancePath}${extra ? '/' + pointer(extra) : missing ? '/' + pointer(missing) : ''}`);
    return { path, message: extra || error.keyword === 'boolean' ? 'Unsupported property; use the declared component fields' : error.message };
  });
  return [...new Map(diagnostics.map(item => [JSON.stringify(item), item])).values()].slice(0, 12);
}

function assertShape(id, args) {
  const errors = Errors(schema(id), args);
  if (errors.length) {
    const [item] = schemaDiagnostics(errors);
    throw new Error(`${item.path}: ${item.message}`);
  }
}

function componentArguments(args) {
  const { component, components, layout, ...publication } = args;
  if (component !== undefined || components !== undefined) {
    let blocks = components ?? [component];
    if (components !== undefined || layout !== undefined) blocks = [{ type: 'group', layout: layout ?? 'stack', blocks }];
    publication.content = { kind: 'document', sections: [{ title: '', blocks }] };
  }
  return { ...publication, data: publication.data ?? [] };
}

function authorPath(path, args) {
  if (args?.component !== undefined) {
    const base = '/content/sections/0/blocks/0' + (args.layout === undefined ? '' : '/blocks/0');
    if (path.startsWith(base)) return '/component' + path.slice(base.length);
  }
  if (args?.components !== undefined) {
    const base = '/content/sections/0/blocks/0/blocks';
    if (path.startsWith(base)) return '/components' + path.slice(base.length);
  }
  return path;
}

function envelope(args, input = Object.fromEntries(['content', 'style', 'assets', 'target'].filter(key => Object.hasOwn(args, key)).map(key => [key, args[key]]))) {
  return { metadata: { title: args.title ?? 'Component validation', summary: args.summary ?? '', locale: args.locale ?? 'en',
    provenanceKind: args.provenance_kind ?? 'derived', features: ['interactive'], ...(args.space ? { space: args.space } : {}) },
  data: args.data ?? [], related: args.related ?? [], references: args.references ?? [], input };
}

function assertDocument(input) {
  check(object(input) && Object.keys(input).every(key => ['content', 'style', 'assets', 'target'].includes(key)), '/content', 'Unsupported input property; HTML, CSS and scripts are disabled');
  check(object(input.content) && input.content.kind === 'document', '/content/kind', 'Components require the built-in document layout');
}

function chartsIn(content) {
  const charts = [];
  const visit = (block, path) => {
    if (block.type === 'chart') charts.push({ block, path });
    if (block.type === 'group' || block.type === 'details') block.blocks.forEach((item, index) => visit(item, `${path}/blocks/${index}`));
  };
  if (content.overview?.chart) visit(content.overview.chart, '/content/overview/chart');
  content.sections.forEach((section, index) => section.blocks.forEach((block, blockIndex) => visit(block, `/content/sections/${index}/blocks/${blockIndex}`)));
  (content.appendix ?? []).forEach((block, index) => visit(block, `/content/appendix/${index}`));
  return charts;
}

function assertChartShape(block, path) {
  const errors = Errors(getChartSchema(block.kind), block);
  if (errors.length) {
    const [item] = schemaDiagnostics(errors);
    throw new Error(`${path}${item.path === '/' ? '' : item.path}: ${item.message}`);
  }
}

function contentTitle(content) {
  const blocks = [];
  const visit = block => { blocks.push(block); if (block.blocks) block.blocks.forEach(visit); };
  if (content.overview?.chart) visit(content.overview.chart);
  content.sections.forEach(section => section.blocks.forEach(visit));
  const title = blocks.find(block => typeof block.title === 'string' && block.title.trim())?.title
    ?? content.sections.find(section => section.title.trim())?.title;
  const first = blocks.find(block => !['group', 'details'].includes(block.type));
  const id = first && (first.type === 'chart' ? `chart.${first.kind}` : `block.${first.type}`);
  return { title, fallback: id ? describeComponents([id]).items[0].label : '组件' };
}

async function publicationMetadata(host, args, input, signal) {
  const supplied = contentTitle(input.content);
  let title = args.title ?? supplied.title;
  const dependencies = [
    ...(args.data ?? []).map((binding, index) => ({ ref: binding.ref, path: `/data/${index}/ref`, data: true })),
    ...(args.references ?? []).map((ref, index) => ({ ref, path: `/references/${index}` })),
    ...(args.related ?? []).flatMap((item, index) => item.artifact ? [{ ref: item.artifact, path: `/related/${index}/artifact` }] : []),
    ...(args.input_ref ? [{ ref: args.input_ref.ref, path: '/input_ref/ref' }] : []),
  ];
  const kinds = new Set(), manifests = new Map();
  for (const item of dependencies) {
    if (args.provenance_kind === 'demo' && (title || !item.data)) continue;
    signal?.throwIfAborted();
    const key = JSON.stringify(item.ref);
    if (!manifests.has(key)) manifests.set(key, await readResource(host, item.ref, { part: 'manifest' }, item.path));
    const content = manifests.get(key).content;
    kinds.add(content?.provenance?.kind ?? 'derived');
    const sourceTitle = content?.provenance?.title ?? content?.title;
    if (!title && item.data && typeof sourceTitle === 'string' && sourceTitle.trim()) title = sourceTitle;
  }
  check(!kinds.has('demo') || args.provenance_kind === undefined || args.provenance_kind === 'demo', '/provenance_kind', 'Fixed demo data must retain demo provenance');
  const inherited = kinds.has('demo') ? 'demo' : kinds.size === 1 && ['observed', 'derived', 'user_input'].includes([...kinds][0]) ? [...kinds][0] : 'derived';
  return { title: (title ?? supplied.fallback).slice(0, 1000), provenanceKind: args.provenance_kind ?? inherited };
}

function publicationOperation(host, args, execution) {
  if (args.operation_id !== undefined) return args.operation_id;
  const callId = execution?.callId ?? execution?.context?.callId, sessionId = host.context?.sessionId;
  check(typeof callId === 'string' && callId.trim() && typeof sessionId === 'string' && sessionId.trim(), '/operation_id',
    'Supply operation_id when trusted host execution.callId and sessionId are unavailable');
  return `components-show:${createHash('sha256').update(JSON.stringify(['sesame/reports', sessionId, callId])).digest('hex')}`;
}

async function validateChartRows(host, args, charts, signal) {
  const cache = new Map();
  const rowsFor = async (id, path) => {
    const binding = (args.data ?? []).find(item => item.id === id);
    check(binding, path, 'Chart data binding is missing');
    if (!cache.has(id)) {
      const manifest = await readResource(host, binding.ref, { part: 'manifest' }, path);
      check(manifest.content?.format === 'json-rows' && safeEntry(manifest.content.path), path, 'Fixed chart data must use the supported json-rows format');
      check(manifest.content.available_for_analysis !== false && manifest.content.provenance?.available_for_analysis !== false, path, 'Fixed chart data is not available for analysis');
      check(manifest.content.provenance?.kind !== 'demo' || args.provenance_kind === 'demo', path, 'Fixed demo data must retain demo provenance');
      const rows = await readJson(host, binding.ref, manifest.content.path, signal, path, 32 * 1024 * 1024);
      check(Array.isArray(rows) && rows.length <= 2500 && rows.every(object), path, 'Chart data must contain at most 2500 fixed object rows');
      cache.set(id, rows);
    }
    return cache.get(id);
  };
  for (const { block, path } of charts) {
    signal?.throwIfAborted();
    const rows = block.data_id ? await rowsFor(block.data_id, `${path}/data_id`) : block.rows;
    let nodes = block.nodes;
    for (const [index, extra] of (block.chart_data ?? []).entries()) nodes = await rowsFor(extra.data_id, `${path}/chart_data/${index}/data_id`);
    const resolved = { ...block, rows, ...(nodes ? { nodes } : {}) };
    delete resolved.data_id; delete resolved.chart_data;
    assertChartShape(resolved, path);
    try {
      chartValue({ rows, takeaway: block.takeaway, source_note: block.source_note, ...(nodes ? { nodes } : {}) },
        { kind: block.kind, columns: block.columns, options: block.options ?? {}, data_requirements: 'Supplied results only' });
    } catch (error) { throw new Error(`${path}: ${error.message}`); }
  }
  return cache.size;
}

// This preflight never creates imports, report artifacts or inspection receipts.
// The public renderer schema, server renderer and chartValue remain authoritative.
async function preflightComponents(host, args, signal, mode = 'components_validate', execution) {
  const coverage = { schema: 'not_run', renderer: 'not_run', fixedData: 'not_run', assets: 'not_run', browser: 'not_run' };
  const result = { valid: false, status: 'invalid', diagnostics: [], protocol: COMPONENT_PROTOCOL, coverage,
    scope: 'Public schema, server rendering, chart field mappings and declared attachment bytes. Browser layout, chart drawing and interactions are not checked.' };
  let stage = 'schema';
  try {
    signal?.throwIfAborted();
    if (object(args) && object(args.content)) assertDocument({ content: args.content });
    assertShape(mode, args);
    const supplied = componentArguments(args);
    if (mode === 'components_show') supplied.operation_id = publicationOperation(host, args, execution);
    let request = envelope(supplied);
    if (args.input_ref) {
      const { ref, entry } = args.input_ref;
      const manifest = await readResource(host, ref, { part: 'manifest' }, '/input_ref/ref');
      check(manifest.blobs?.some(blob => blob.path === entry && /^application\/json(?:;|$)/i.test(blob.mediaType)), '/input_ref/entry', 'Component input_ref must name a fixed application/json entry');
      request = envelope(args, await readJson(host, ref, entry, signal, '/input_ref/entry', 2 * 1024 * 1024));
    }
    assertDocument(request.input);
    check(new Set(request.data.map(binding => binding.id)).size === request.data.length, '/data', 'Data binding IDs must be unique');
    const errors = Errors(rendererSchema, request);
    if (errors.length) {
      // Prefer the renderer's contextual explanation over unrelated oneOf errors.
      // Document rendering here does not read workspace attachments or publish.
      try { await renderStructuredReport(host, { ...supplied, ...request.input, ...request.metadata, provenance_kind: request.metadata.provenanceKind }, signal); }
      catch (error) { signal?.throwIfAborted(); result.diagnostics = [diagnostic(error, schemaDiagnostics(errors)[0]?.path)]; }
      if (!result.diagnostics.length) result.diagnostics = schemaDiagnostics(errors);
      result.diagnostics = result.diagnostics.map(item => ({ ...item, path: authorPath(item.path, args) }));
      coverage.schema = 'failed'; return { result };
    }
    for (const { block, path } of chartsIn(request.input.content)) assertChartShape(block, path);
    coverage.schema = 'passed'; stage = 'fixedData';
    Object.assign(request.metadata, await publicationMetadata(host, supplied, request.input, signal));
    supplied.title = request.metadata.title; supplied.provenance_kind = request.metadata.provenanceKind;
    request.input = { ...request.input, content: await normalizeComponentContent(host, request.input.content, request.data, signal) };
    const charts = chartsIn(request.input.content);
    const count = await validateChartRows(host, supplied, charts, signal);
    coverage.fixedData = count ? 'passed' : 'not_applicable'; stage = 'renderer';
    const readOnlyHost = { ...host, resources: { ...host.resources, read: async (ref, options) => {
      const index = (args.assets ?? []).findIndex(asset => asset.ref?.id === ref.id && asset.ref?.revision === ref.revision && asset.ref?.digest === ref.digest);
      return readResource(host, ref, options, index < 0 ? '/references' : `/assets/${index}/${options.part === 'manifest' ? 'ref' : 'entry'}`);
    } } };
    const rendered = await renderReport(readOnlyHost, request, signal, async (host, path, signal) => {
      try { return await readWorkspaceBytes(host, path, signal, 32 * 1024 * 1024); }
      catch (error) { signal?.throwIfAborted(); error.validationIncomplete = error.code !== 'INVALID_ARGUMENT'; throw error; }
    });
    coverage.renderer = 'passed'; coverage.assets = args.assets?.length ? 'passed' : 'not_applicable';
    if (!args.input_ref) supplied.content = request.input.content;
    return { result: { ...result, valid: true, status: 'valid', renderer: rendered.presentation, chartCount: charts.length, checkedBindings: count }, publication: supplied };
  } catch (error) {
    signal?.throwIfAborted();
    const item = diagnostic(error);
    item.path = authorPath(item.path, args);
    if (item.path.startsWith('/assets/')) stage = 'assets';
    coverage[stage] = error.validationIncomplete ? 'unavailable' : 'failed';
    result.status = error.validationIncomplete ? 'incomplete' : 'invalid'; result.diagnostics = [item];
    return { result };
  }
}

export async function validateComponents(host, args, signal) {
  return (await preflightComponents(host, args, signal)).result;
}

export async function showComponents(host, args, signal, execution) {
  const { result: preflight, publication } = await preflightComponents(host, args, signal, 'components_show', execution);
  if (!preflight.valid) {
    const [item] = preflight.diagnostics;
    throw Object.assign(new Error(`${authorPath(item.path, args)}: ${item.message}`), {
      code: preflight.status === 'incomplete' ? 'UNAVAILABLE' : 'INVALID_ARGUMENT', details: { diagnostics: preflight.diagnostics, coverage: preflight.coverage },
    });
  }
  const published = await publishReport(host, { ...publication, summary: args.summary ?? '' }, signal);
  check(!Errors(REPORT_ARTIFACT_REF_SCHEMA, published.ref).length && published.ref.kind === 'report', '/', 'Host publication must return a fixed report reference');
  return { ...published, protocol: COMPONENT_PROTOCOL, ...(published.presentation ? { renderer: published.presentation } : {}),
    componentRef: { ref: published.ref, protocol: COMPONENT_PROTOCOL, kind: 'document', ...(published.inputDigest ? { inputDigest: published.inputDigest } : {}) } };
}

export function componentCapabilities(host) {
  return [
    { name: 'components_list', execute: async (args = {}) => { assertShape('components_list', args); return listComponents(args); } },
    { name: 'components_describe', execute: async args => { assertShape('components_describe', args); return describeComponents(args.ids); } },
    { name: 'components_validate', execute: (args, signal) => validateComponents(host, args, signal) },
    { name: 'components_show', execute: (args, signal, execution) => showComponents(host, args, signal, execution) },
  ];
}
