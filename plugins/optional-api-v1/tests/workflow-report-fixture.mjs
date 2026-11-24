// Isolated protocol fixture: real managed bytes, explicit synthetic inspector
// receipts. This never starts a browser, backend, process capability or trade.
import assert from 'node:assert/strict';
import { digest } from '@sesame/plugin-sdk/protocol';
import { renderMarkdown } from '@sesame/plugin-sdk/markdown';

export const reportDescription = () => ({ contract: 'sesame.report/1', provider: { pluginId: 'sesame/reports', serviceId: 'report-renderer', version: 'fixture', revision: digest('fixture-report-provider') },
  inputSchema: { $id: 'urn:sesame:report:provider-input:1', type: 'object', properties: { content: { type: 'object', properties: { kind: { const: 'document' } } }, style: { type: 'object' }, assets: { type: 'array' } } } });
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function fixtureHTML(input) {
  assert.equal(input.target, 'report');
  assert.ok(input.content?.kind === 'document' && !Object.hasOwn(input, 'body_html') && !Object.hasOwn(input, 'html_path'), 'The fixture accepts only generic document content');
  const block = value => value.type === 'markdown' ? renderMarkdown(value.text) : value.type === 'details'
    ? `<details><summary>${escape(value.title)}</summary>${value.blocks.map(block).join('')}</details>` : `<p>${escape(value.text)}</p>`;
  assert.ok(input.lead?.trim() && input.highlights?.length >= 1 && input.highlights.length <= 6);
  const highlights = input.highlights.map(item => `<dt>${escape(item.label)}</dt><dd>${escape(item.value)}</dd>`).join('');
  const body = input.content.sections.map(section => `<section><h2>${escape(section.title)}</h2>${section.blocks.map(block).join('')}</section>`).join('');
  return `<!doctype html><html><head><title>${escape(input.title)}</title></head><body><main><p>${escape(input.lead)}</p><dl>${highlights}</dl>${body}</main></body></html>`;
}

const states = new WeakMap();
export function workflowReports(host, sharedState) {
  const resources = host.resources;
  let state = states.get(resources) ?? sharedState;
  if (!states.has(resources)) {
    state ??= { files: new Map(), receipts: new Map(), calls: [], inspectionStatus: 'rendered' };
    const read = resources.read.bind(resources);
    resources.read = async (ref, options) => options.part === 'receipts' && state.receipts.has(ref.id) ? { items: structuredClone(state.receipts.get(ref.id)) } : read(ref, options);
    states.set(resources, state);
  }
  const invoke = host.capabilities?.invoke?.bind(host.capabilities);
  host.capabilities = { ...host.capabilities, invoke: async (id, input, options = {}) => {
    if (!['host.reports.describe', 'sesame/workspace#write', 'sesame/reports#components_show', 'sesame/reports#report_check'].includes(id)) {
      assert.ok(invoke, `Undeclared fixture capability: ${id}`); return invoke(id, input, options);
    }
    options.signal?.throwIfAborted(); state.calls.push({ id, input: structuredClone(input) });
    if (id === 'sesame/workspace#write') { state.files.set(input.path, input.content); return { type: 'result', value: { path: input.path } }; }
    if (id === 'host.reports.describe') return { type: 'result', value: structuredClone(state.description ?? reportDescription()) };
    if (id.endsWith('#components_show')) {
      const operationId = input.operation_id;
      const root = await resources.create({ kind: 'directory', lifetime: 'durable', name: digest(operationId).slice(7) }, { operationId: operationId + ':root' });
      const entries = [{ path: 'index.html', content: fixtureHTML(input), mediaType: 'text/html' }, ...input.assets.map(asset => ({ path: asset.path, content: state.files.get(asset.source_path), mediaType: asset.media_type }))];
      for (const file of entries) {
        assert.equal(typeof file.content, 'string', `Missing authored fixture file: ${file.path}`);
        await resources.create({ kind: 'file', parent: root, lifetime: 'durable', name: file.path, source: { content: file.content }, policy: { readOnly: true } }, { operationId: operationId + ':' + file.path });
      }
      const provenance = { kind: input.provenance_kind, references: input.references };
      const result = await resources.publish(root, { kind: 'report', schemaVersion: '1.0.0', content: { schemaVersion: '1.0.0', title: input.title, summary: input.summary, entry: 'index.html', runtime: 'sesame-report/1', runtimeRevision: '1.0.0', data: input.data, related: input.related, features: input.features, locale: input.locale, provenance }, dependencies: input.references, provenance, blobs: entries.map(({ path, mediaType }) => ({ entry: path, path, mediaType })) }, { operationId });
      state.receipts.set(result.ref.id, state.receipts.get(result.ref.id) ?? []);
      return { type: 'result', value: { ref: result.ref, renderStatus: 'not_checked' } };
    }
    const receipts = state.receipts.get(input.ref.id) ?? [];
    const receipt = { artifact: structuredClone(input.ref), renderer: { name: 'sesame-report-inspector' }, status: state.inspectionStatus, observedAt: receipts.length + 1 };
    receipts.push(receipt); state.receipts.set(input.ref.id, receipts);
    return { type: 'result', value: receipt };
  } };
  return state;
}
