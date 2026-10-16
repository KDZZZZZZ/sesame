import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Checkpoints } from '../checkpoints.js';

test('large run snapshots use immutable resources and state CAS survives reopening', async () => {
  const records = new Map(), blobs = new Map(); let sequence = 0;
  const host = {
    state: {
      query: async () => ({ items: [...records.values()] }),
      commit: async changes => {
        const change = changes[0], previous = records.get(change.key.key);
        assert.ok(Buffer.byteLength(JSON.stringify(change.value)) < 4096);
        assert.equal(change.expectedVersion, previous?.version ?? 0);
        records.set(change.key.key, { key: change.key, value: change.value, version: change.expectedVersion + 1 });
        return { entries: [{ key: change.key, version: change.expectedVersion + 1 }] };
      },
    },
    resources: {
      create: async input => { const ref = { id: String(++sequence), kind: input.kind, version: 1 }; blobs.set(ref.id, input.source.content); assert.equal(input.policy.readOnly, true); return ref; },
      read: async (ref, { offset = 0 }) => { const bytes = Buffer.from(blobs.get(ref.id)), end = Math.min(offset + 64, bytes.length); return { content: bytes.subarray(offset, end).toString('base64'), ...(end < bytes.length ? { nextOffset: end } : {}) }; },
    },
  };
  const first = await new Checkpoints(host).load();
  await first.setDataset('run', { dataset: { rows: [{ value: 1 }] }, digest: 'frozen' });
  first.save({ id: 'run', ownerConversationId: 'main', status: 'queued', text: 'x'.repeat(300000) });
  first.save({ ...first.get('run'), status: 'completed' }); await first.flush();
  assert.equal(records.get('run').version, 1, 'Unobserved same-tick changes share a checkpoint; flush is the durable barrier');
  const reopened = await new Checkpoints(host).load();
  assert.equal(reopened.get('run').status, 'completed'); assert.equal(reopened.get('run').text.length, 300000);
  assert.equal(reopened.dataset('run').dataset.rows[0].value, 1);
});

test('persistence failures are observable and prevent a successful checkpoint', async () => {
  const host = { state: { query: async () => ({ items: [] }), commit: async () => { throw new Error('CAS failed'); } }, resources: { create: async () => ({ id: 'payload', kind: 'blob', version: 1 }) } };
  const checkpoint = await new Checkpoints(host).load(); checkpoint.save({ id: 'run', ownerConversationId: 'main', status: 'queued' });
  await assert.rejects(checkpoint.flush(), /CAS failed/);
});
