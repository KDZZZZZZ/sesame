import test from 'node:test';
import assert from 'node:assert/strict';
import { fixedRows } from '../packages/backtrader/index.js';
import { runProcess } from '../packages/backtrader/execution.js';

const ref = { id: 'fixed-bars', kind: 'data', revision: 'v1', digest: `sha256:${'a'.repeat(64)}`, schemaVersion: '1.0.0' };
const rows = () => [
  { datetime: { basis: 'utc', unixMs: 1000 }, open: '1.0000000000000001', high: '2', low: '1', close: '1.5', volume: '2' },
  { datetime: '2026-10-19T10:00:00+08:00', open: '1.5', high: '2', low: '1', close: '1.6', volume: '0' },
];
function fixture(values = rows(), changes = {}) {
  const bytes = Buffer.from(JSON.stringify(values)), reads = [];
  const manifest = {
    content: { format: 'json-rows', path: 'rows.json', rowCount: values.length, provenance: { kind: 'observed' }, ...changes.content },
    blobs: [{ path: 'rows.json', size: bytes.length, ...changes.blob }],
  };
  const host = { resources: { async read(actual, options) {
    assert.deepEqual(actual, ref); reads.push(options);
    if (options.part === 'manifest') return manifest;
    assert.equal(options.entry, 'rows.json');
    const end = Math.min(bytes.length, options.offset + 71);
    return { content: bytes.subarray(options.offset, end).toString('base64'), total: bytes.length, length: end - options.offset, ...(end < bytes.length ? { nextOffset: end } : {}) };
  } } };
  return { host, reads };
}

test('Backtrader fixed input preserves exact decimal values, explicit time authority and provenance through bounded reads', async () => {
  const { host, reads } = fixture();
  assert.deepEqual(await fixedRows(host, ref), { origin: 'observed', rows: [
    { datetime: '1970-01-01T00:00:01.000Z', open: '1.0000000000000001', high: '2', low: '1', close: '1.5', volume: '2' },
    { datetime: '2026-10-19T02:00:00.000Z', open: '1.5', high: '2', low: '1', close: '1.6', volume: '0' },
  ] });
  assert.ok(reads.filter(read => read.part === 'content').length > 1);
  const aliased = rows().map(({ datetime, ...rest }) => ({ instant: datetime, ...rest }));
  assert.equal((await fixedRows(fixture(aliased).host, ref, { datetime: 'instant' })).rows[0].datetime, '1970-01-01T00:00:01.000Z');
});

test('Backtrader cancellation tolerates a synchronously revoked host port and preserves the owned outcome', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const host = {
    capabilities: { async invoke() { return { type: 'run', run: { id: 'owned-native-run' } }; } },
    runs: {
      cancel() { attempts++; throw Object.assign(new Error('Host context revoked'), { code: 'RUN_INTERRUPTED' }); },
      async wait() {
        controller.abort();
        await new Promise(resolve => setImmediate(resolve));
        return { reason: 'settled', run: { id: 'owned-native-run', status: 'cancelled', error: { code: 'run_cancelled', message: 'Owned process cancelled' } } };
      },
    },
  };
  await assert.rejects(runProcess(host, ['python'], { cwd: '.', signal: controller.signal }), { code: 'run_cancelled' });
  assert.equal(attempts, 1);
});

test('Backtrader rejects invented time authority, invalid OHLCV and changed row evidence before execution', async () => {
  for (const mutate of [
    values => { values[0].datetime = '2026-10-19T10:00:00'; },
    values => { values[0].datetime = { basis: 'utc', unixMs: 1.5 }; },
    values => { values[1].datetime = values[0].datetime; },
    values => { values[0].close = '3'; },
    values => { values[0].high = '0'; },
    values => { values[0].volume = '-1'; },
    values => { values[0].volume = null; },
  ]) {
    const values = rows(); mutate(values);
    await assert.rejects(fixedRows(fixture(values).host, ref));
  }
  for (const changes of [
    { content: { format: 'csv' } },
    { content: { rowCount: 3 } },
    { content: { provenance: { kind: 'guessed' } } },
    { blob: { size: 16 * 1024 * 1024 + 1 } },
  ]) await assert.rejects(fixedRows(fixture(rows(), changes).host, ref));
  await assert.rejects(fixedRows(fixture(rows().slice(0, 1)).host, ref));
});
