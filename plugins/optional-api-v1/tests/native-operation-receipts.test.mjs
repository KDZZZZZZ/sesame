import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCapabilities as backtraderCapabilities } from '../packages/backtrader/index.js';
import { records as backtraderRecords, closeRecords as closeBacktrader } from '../packages/backtrader/records.js';
import { optimizationPlan } from '../packages/backtrader/backtest.js';
import { createCapabilities as vnpyCapabilities } from '../packages/vnpy/index.js';
import { records as vnpyRecords, closeRecords as closeVnpy } from '../packages/vnpy/records.js';
import { createCapabilities as testerCapabilities } from '../packages/mt5/tools/tester/index.js';
import { records as mt5Records } from '../packages/mt5/backend/records.js';

test('native read-only reconcilers return original confirmed/unknown receipts and never call an execution port', async t => {
  const root = await mkdtemp(join(tmpdir(), 'native-operation-')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, factory, records, close, collection, key] of [
    ['backtrader', backtraderCapabilities, backtraderRecords, closeBacktrader, 'backtests', 'op'],
    ['vnpy', vnpyCapabilities, vnpyRecords, closeVnpy, 'operations', 'vnpy-backtest:op'],
  ]) {
    const host = { context: { storageRoot: join(root, name) }, capabilities: { invoke() { throw Error('Read-only receipt must not execute'); } } };
    const read = factory(host).find(cap => cap.name === `${name}_operation`).execute;
    assert.deepEqual(await read({ operation_id: 'op' }), { operation_id: 'op', status: 'not-found' });
    records(host).put(collection, { id: key, status: 'unknown', fingerprint: 'bound-input' });
    assert.equal((await read({ operation_id: 'op' })).status, 'unknown');
    const result = { status: 'completed', statistics: { actual: '123' } };
    records(host).update(collection, key, { status: 'completed', result });
    assert.deepEqual((await read({ operation_id: 'op' })).result, result); close(host);
  }
  const host = { context: { storageRoot: join(root, 'mt5'), sessionId: 'owner' } }, db = mt5Records(host);
  t.after(() => db.close());
  const job = { id: 'native-job', conversation_id: 'owner', status: 'unknown', passes: [] };
  const read = testerCapabilities(host, { tester: { get: id => { assert.equal(id, job.id); return job; } }, official: {} }).find(cap => cap.name === 'mt5_backtest_operation').execute;
  const args = { command_id: 'stable_fixture_command' };
  assert.equal(read(args).status, 'not-found');
  db.put('operation', { id: 'tester-start-' + args.command_id, fingerprint: 'frozen', result: { id: job.id } });
  assert.deepEqual(read(args).result, job);
  job.conversation_id = 'other'; assert.throws(() => read(args), { code: 'FORBIDDEN' });
});

test('native Backtrader optimizer bounds the actual search and refuses duplicate or non-scalar trial values', () => {
  assert.equal(optimizationPlan({ parameter_space: { a: [1, 2], b: [true, false] } }).combinations, 4);
  for (const parameter_space of [{ a: [1, 1] }, { a: [null] }, { a: [NaN] }, { a: Array.from({ length: 64 }, (_, i) => i), b: [1, 2] }, {}]) assert.throws(() => optimizationPlan({ parameter_space }));
});
