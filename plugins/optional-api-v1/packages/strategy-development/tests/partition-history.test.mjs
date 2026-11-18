import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest } from '@sesame/plugin-sdk/protocol';
import { partitionCollection, reservePartition } from '../partition-history.js';

const ref = (kind, id) => ({ kind, id, revision: '1', schemaVersion: '1.0.0', digest: digest(id) });
const partition = (name, first, last) => ({ ref: ref('data', name), first, last });
const candidate = name => ref('resource', name);
const error = code => Object.assign(new Error(code), { code });

function memory() {
  const entries = new Map();
  return { entries, state: {
    read({ key }) { if (!entries.has(key)) throw error('NOT_FOUND'); return structuredClone(entries.get(key)); },
    async commit(changes) {
      // Model the asynchronous validation and atomic CAS of the host port.
      await new Promise(resolve => setImmediate(resolve));
      if (!changes.every(change => (entries.get(change.key.key)?.version ?? 0) === change.expectedVersion)) throw error('VERSION_CONFLICT');
      for (const change of changes) entries.set(change.key.key, { version: change.expectedVersion + 1, value: structuredClone(change.value) });
    },
  } };
}

test('sibling candidates share a development set, with compact union and unused gaps retained', async () => {
  const host = memory();
  await Promise.all([
    reservePartition(host, 'project', 'development', partition('A', 10, 20), null, 'branch-A'),
    reservePartition(host, 'project', 'development', partition('B', 15, 24), null, 'branch-B'),
    reservePartition(host, 'project', 'development', partition('C', 26, 32), null, 'branch-C'),
  ]);
  await reservePartition(host, 'project', 'development', partition('A copy', 10, 20), null, 'branch-D');
  const ranges = [...host.entries].find(([key]) => key.startsWith('ranges-'))[1];
  assert.deepEqual(ranges.value, { development: [[10, 24], [26, 32]], holdout: [] });
  await assert.rejects(reservePartition(host, 'project', 'holdout', partition('overlap', 24, 25), candidate('chosen'), 'confirm-D'), { code: 'PARTITION_ALREADY_OBSERVED' });
  await reservePartition(host, 'project', 'holdout', partition('gap', 25, 25), candidate('chosen'), 'confirm-gap');
});

async function race(host) {
  const shared = partition('holdout', 40, 50);
  const requests = Array.from({ length: 12 }, (_, index) => () => reservePartition(host, 'family', 'holdout', { ...shared, ref: ref('data', 'snapshot-' + index) }, candidate('sibling-' + index), 'confirm-' + index));
  const outcomes = await Promise.allSettled(requests.map(call => call()));
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  assert.ok(outcomes.filter(outcome => outcome.status === 'rejected').every(outcome => outcome.reason.code === 'PARTITION_ALREADY_OBSERVED'));
  // Replaying the winning reservation after settlement is safe.
  await requests[outcomes.findIndex(outcome => outcome.status === 'fulfilled')]();
}

test('concurrent holdouts from sibling versions admit only one independent confirmation', async () => {
  const host = memory();
  await race(host);
  await assert.rejects(reservePartition(host, 'family', 'development', partition('different-copy', 49, 55), null, 'late-research'), { code: 'PARTITION_ALREADY_OBSERVED' });
  await reservePartition(host, 'independent-project', 'development', partition('different-copy', 49, 55), null, 'late-research');
});

test('simultaneous identical reservations replay; a reused operation cannot change snapshot or selected winner', async () => {
  const host = memory(), held = partition('holdout', 70, 90), best = candidate('best');
  await Promise.all(Array.from({ length: 8 }, () => reservePartition(host, 'p', 'holdout', held, best, 'run')));
  assert.equal(host.entries.size, 2);
  await assert.rejects(reservePartition(host, 'p', 'holdout', held, candidate('second-best'), 'run'), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(reservePartition(host, 'p', 'holdout', partition('other-copy', 70, 90), best, 'run'), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(reservePartition(host, 'p', 'holdout', held, best, 'another-run'), { code: 'PARTITION_ALREADY_OBSERVED' });
  // A combined optimize-and-confirm operation legitimately reserves each role once.
  await reservePartition(host, 'p', 'development', partition('development', 20, 50), null, 'run');
});

test('concurrent development/confirmation of overlapping windows cannot both be admitted', async () => {
  const host = memory(), window = partition('same-period', 20, 50);
  const attempts = await Promise.allSettled([
    reservePartition(host, 'p', 'development', window, null, 'sibling-dev'),
    reservePartition(host, 'p', 'holdout', { ...window, ref: ref('data', 'other-bars') }, candidate('best'), 'sibling-holdout'),
  ]);
  assert.equal(attempts.filter(attempt => attempt.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(attempt => attempt.status === 'rejected').reason.code, 'PARTITION_ALREADY_OBSERVED');
});

const hostRoot = process.env.SESAME_HOST_ROOT;
test('host document CAS preserves the winning holdout across a SQLite reopen', { skip: !hostRoot }, async t => {
  const { Store } = await import(pathToFileURL(join(hostRoot, 'modules/agent/store.js')));
  const { PluginAuthority } = await import(pathToFileURL(join(hostRoot, 'modules/plugins/plugin-authority.js')));
  const { createStatePort } = await import(pathToFileURL(join(hostRoot, 'modules/plugins/host-v2/state.js')));
  const directory = await mkdtemp(join(tmpdir(), 'sesame-partition-history-'));
  const entry = { id: 'sesame/strategy-development', digest: digest('partition-history-test'), capabilityManifest: { stateCollections: [partitionCollection] } };
  let store;
  const open = () => {
    store = new Store(directory);
    const runtime = { store, plugins: { entries: new Map([[entry.id, entry]]) } };
    runtime.authority = new PluginAuthority(runtime);
    return { state: createStatePort({ runtime, entry, context: runtime.authority.bind({ kind: 'service' }, entry) }) };
  };
  t.after(async () => { store?.close(); await rm(directory, { recursive: true, force: true }); });
  await race(open());
  store.close();
  const reopened = open();
  await assert.rejects(reservePartition(reopened, 'family', 'development', partition('new-ref', 50, 65), null, 'restarted'), { code: 'PARTITION_ALREADY_OBSERVED' });
  await reservePartition(reopened, 'family', 'development', partition('fresh-window', 55, 65), null, 'restarted');
});
