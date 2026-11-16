import test from 'node:test';
import assert from 'node:assert/strict';

const chart = extra => ({ type: 'chart', kind: 'bar', options: { x: 'item', y: 'count' }, ...extra });
const document = blocks => ({ kind: 'document', sections: [{ title: '', blocks }] });
const ref = { id: 'fixed-counts', revision: 'fixture-v1', digest: `sha256:${'a'.repeat(64)}`, kind: 'data', schemaVersion: '1.0.0' };
const data = [{ id: 'counts', ref, usage: 'Supplied counts' }];

test('shared normalization infers only columns and preserves every supplied value recursively', async () => {
  const { normalizeComponentContent } = await import('../packages/reports/component-input.js');
  const inline = chart({ rows: [{ item: 'A', count: '9007199254740993.00001' }, { item: 'B', count: null, note: 'supplied' }] });
  const original = document([{ type: 'group', layout: 'stack', blocks: [{ type: 'details', title: 'Detail', blocks: [inline] }] }, inline]);
  const before = structuredClone(original), normalized = await normalizeComponentContent({}, original);
  assert.deepEqual(original, before); assert.notEqual(normalized, original);
  assert.deepEqual(normalized.sections[0].blocks[1].columns, ['item', 'count', 'note']);
  assert.deepEqual(normalized.sections[0].blocks[0].blocks[0].blocks[0], { ...inline, columns: ['item', 'count', 'note'] });
  for (const name of ['title', 'takeaway', 'source_note']) assert.equal(Object.hasOwn(normalized.sections[0].blocks[1], name), false);
  assert.equal(normalized.sections[0].blocks[1].rows[0].count, '9007199254740993.00001');
});

test('fixed columns prefer manifest metadata and otherwise read actual JSON rows', async () => {
  const { normalizeComponentContent } = await import('../packages/reports/component-input.js');
  const reads = [], rows = [{ item: 'A', count: 4 }], bytes = Buffer.from(JSON.stringify(rows));
  const manifest = { content: { format: 'json-rows', path: 'rows.json', columns: ['item', 'count'] } };
  const host = { resources: { read: async (actual, request) => {
    assert.deepEqual(actual, ref); reads.push(request);
    return request.part === 'manifest' ? manifest : { content: bytes.toString('base64'), total: bytes.length };
  } } };
  const input = document([chart({ data_id: 'counts' }), chart({ data_id: 'counts', columns: ['item', 'count'] })]);
  assert.deepEqual((await normalizeComponentContent(host, input, data)).sections[0].blocks[0].columns, ['item', 'count']);
  assert.deepEqual(reads.map(item => item.part), ['manifest']);
  reads.length = 0; delete manifest.content.columns;
  const normalized = await normalizeComponentContent(host, input, data);
  assert.deepEqual(normalized.sections[0].blocks[0].columns, ['item', 'count']);
  assert.deepEqual(reads.map(item => item.part), ['manifest', 'content']);
  reads.length = 0;
  await normalizeComponentContent(host, document([chart({ data_id: 'counts', columns: ['item', 'count'] })]), data);
  assert.deepEqual(reads, []);
  await assert.rejects(normalizeComponentContent(host, input, []), /\/content\/sections\/0\/blocks\/0\/data_id/);
});

test('fixed metadata read failures are incomplete and invalid rows stay invalid', async () => {
  const { normalizeComponentContent } = await import('../packages/reports/component-input.js');
  const input = document([chart({ data_id: 'counts' })]);
  await assert.rejects(normalizeComponentContent({ resources: { read: async () => { throw new Error('Unavailable fixture'); } } }, input, data),
    error => error.validationIncomplete === true && /data_id/.test(error.message));
  const bytes = Buffer.from('[null]');
  const host = { resources: { read: async (_ref, request) => request.part === 'manifest'
    ? { content: { format: 'json-rows', path: 'rows.json' } } : { content: bytes.toString('base64'), total: bytes.length } } };
  await assert.rejects(normalizeComponentContent(host, input, data), error => !error.validationIncomplete && /rows|object/.test(error.message));
});
