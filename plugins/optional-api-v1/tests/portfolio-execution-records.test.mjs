import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { records, closeRecords } from '../packages/portfolio-execution/records.js';
import { createService } from '../packages/portfolio-execution/service.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'portfolio-receipts-'));
  const host = { context: { storageRoot: root, kind: 'main', sessionId: 'owner' }, capabilities: {} };
  t.after(() => { closeRecords(host); rmSync(root, { recursive: true, force: true }); });
  return { host, root };
}

test('private transactions roll back atomically and survive closing/reopening', t => {
  const { host } = fixture(t), store = records(host);
  store.put('commands', { id: 'sent', status: 'outcome_unknown' });
  assert.throws(() => store.transaction(() => {
    store.put('commands', { id: 'sent', status: 'rejected' });
    store.put('observations', { id: 'new', consumedBy: 'sent' });
    throw new Error('interruption');
  }), /interruption/);
  assert.throws(() => store.transaction(async () => {}), /synchronous/);
  closeRecords(host);
  assert.equal(records(host).get('commands', 'sent').status, 'outcome_unknown');
  assert.equal(records(host).get('observations', 'new', true), undefined);
});

test('the committed submitting receipt is visible to another connection before dispatch; unknown results block replacement IDs after restart', async t => {
  const { host, root } = fixture(t), now = 1800000000000;
  const account = { accountId: '123', server: 'broker', revision: '1' };
  let sends = 0;
  const adapters = {
    snapshot: async () => ({ account, symbol: 'EURUSD', quote: { sourceTimeMs: now }, positions: [], spec: {}, capturedAt: now, captureMs: 0 }),
    identity: async () => account,
    orderRequest: () => {},
    submit: async () => {
      sends++;
      const reader = new DatabaseSync(join(root, 'execution.sqlite'), { readOnly: true });
      try {
        const row = reader.prepare('SELECT value FROM records WHERE collection=? AND id=?').get('commands', 'first');
        assert.equal(JSON.parse(row.value).status, 'submitting');
      } finally { reader.close(); }
      throw new Error('connection lost after possible send');
    },
  };
  const service = createService(host, { now: () => now, adapters });
  const observation = await service.observe({ backend: 'mt5', symbol: 'EURUSD' });
  const intent = { operation_id: 'first', observation_id: observation.observation_id, user_authorized: true, action: 'market', side: 'buy', quantity: '0.1', price_limit: '1.2' };
  assert.equal((await service.execute(intent)).status, 'outcome_unknown');
  closeRecords(host);
  const resumed = createService(host, { now: () => now, adapters });
  assert.equal((await resumed.execute(intent)).status, 'outcome_unknown');
  const fresh = await resumed.observe({ backend: 'mt5', symbol: 'EURUSD' });
  await assert.rejects(resumed.execute({ ...intent, operation_id: 'replacement', observation_id: fresh.observation_id }), { code: 'UNRESOLVED_ORDER' });
  assert.equal(sends, 1);
});
