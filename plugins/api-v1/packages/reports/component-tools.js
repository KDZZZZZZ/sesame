import { readFileSync } from 'node:fs';
import { Errors } from '@sesame/plugin-sdk/schema/value';
import { REPORT_ARTIFACT_REF_SCHEMA } from '@sesame/plugin-sdk/report-contract';
import { COMPONENT_PROTOCOL, listComponents, describeComponents, getChartSchema } from './component-catalog.js';
import { renderStructuredReport } from './report-content.js';
import { renderReport, publishReport } from './report-provider.js';
import { chartValue } from './report-chart-fields.js';
import { readBytes } from './artifact-io.js';
import { readWorkspaceBytes } from './report-prepare.js';

const manifest = JSON.parse(readFileSync(new URL('./capabilities.json', import.meta.url), 'utf8'));
const schema = id => manifest.capabilities.find(item => item.id === id).inputSchema;
const rendererSchema = schema('report_render');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (condition, path, message) => { if (!condition) throw new Error(`${path}: ${message}`); };
const pointer = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const publicPath = path => path.replace(/^\/input(?=\/|$)/, '').replace(/^\/metadata\/provenanceKind$/, '/provenance_kind').replace(/^\/metadata(?=\/|$)/, '') || '/';
const safeEntry = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\\:\x00-\x1f]/.test(value)
  && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part));

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

async function readResource(host, ref, request, path) {
  try { return await host.resources.read(ref, request); }
  catch (error) { throw Object.assign(new Error(`${path}: Could not read the fixed resource: ${error.message}`), { validationIncomplete: true }); }
}

async function readJson(host, ref, entry, signal, path, limit) {
  check(safeEntry(entry), path, 'Fixed JSON source needs a safe packaged entry');
  let bytes;
  try { bytes = await readBytes(host, ref, entry, signal); }
  catch (error) { signal?.throwIfAborted(); throw Object.assign(new Error(`${path}: Could not read all fixed resource bytes: ${error.message}`), { validationIncomplete: true }); }
  check(bytes.length <= limit, path, `Fixed JSON source exceeds ${limit / 1024 / 1024} MiB`);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error(`${path}: Fixed source must contain valid UTF-8 JSON`); }
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
export async function validateComponents(host, args, signal) {
  const coverage = { schema: 'not_run', renderer: 'not_run', fixedData: 'not_run', assets: 'not_run', browser: 'not_run' };
  const result = { valid: false, status: 'invalid', diagnostics: [], protocol: COMPONENT_PROTOCOL, coverage,
    scope: 'Public schema, server rendering, chart field mappings and declared attachment bytes. Browser layout, chart drawing and interactions are not checked.' };
  let stage = 'schema';
  try {
    signal?.throwIfAborted();
    if (object(args) && object(args.content)) assertDocument({ content: args.content });
    assertShape('components_validate', args);
    const supplied = componentArguments(args), request = envelope(supplied); assertDocument(request.input);
    check(new Set(request.data.map(binding => binding.id)).size === request.data.length, '/data', 'Data binding IDs must be unique');
    const errors = Errors(rendererSchema, request);
    if (errors.length) {
      // Prefer the renderer's contextual explanation over unrelated oneOf errors.
      // Document rendering here does not read workspace attachments or publish.
      try { await renderStructuredReport(host, { ...supplied, ...request.input, ...request.metadata, provenance_kind: request.metadata.provenanceKind }, signal); }
      catch (error) { signal?.throwIfAborted(); result.diagnostics = [diagnostic(error, schemaDiagnostics(errors)[0]?.path)]; }
      if (!result.diagnostics.length) result.diagnostics = schemaDiagnostics(errors);
      result.diagnostics = result.diagnostics.map(item => ({ ...item, path: authorPath(item.path, args) }));
      coverage.schema = 'failed'; return result;
    }
    const charts = chartsIn(request.input.content);
    for (const { block, path } of charts) assertChartShape(block, path);
    coverage.schema = 'passed'; stage = 'fixedData';
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
    return { ...result, valid: true, status: 'valid', renderer: rendered.presentation, chartCount: charts.length, checkedBindings: count };
  } catch (error) {
    signal?.throwIfAborted();
    const item = diagnostic(error);
    item.path = authorPath(item.path, args);
    if (item.path.startsWith('/assets/')) stage = 'assets';
    coverage[stage] = error.validationIncomplete ? 'unavailable' : 'failed';
    result.status = error.validationIncomplete ? 'incomplete' : 'invalid'; result.diagnostics = [item];
    return result;
  }
}

export async function showComponents(host, args, signal) {
  if (object(args) && object(args.content)) assertDocument({ content: args.content });
  assertShape('components_show', args);
  const publication = componentArguments(args);
  let request = envelope(publication);
  if (args.input_ref) {
    const { ref, entry } = args.input_ref;
    const manifest = await readResource(host, ref, { part: 'manifest' }, '/input_ref/ref');
    check(manifest.blobs?.some(blob => blob.path === entry && /^application\/json(?:;|$)/i.test(blob.mediaType)), '/input_ref/entry', 'Component input_ref must name a fixed application/json entry');
    request = envelope(args, await readJson(host, ref, entry, signal, '/input_ref/entry', 2 * 1024 * 1024));
  }
  assertDocument(request.input);
  const preflight = await validateComponents(host, { title: request.metadata.title, summary: request.metadata.summary,
    locale: request.metadata.locale, provenance_kind: request.metadata.provenanceKind,
    data: request.data, related: request.related, references: request.references, ...request.input }, signal);
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
    { name: 'components_show', execute: (args, signal) => showComponents(host, args, signal) },
  ];
}
