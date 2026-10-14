import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withAccountLock } from '../packages/portfolio-execution/execution-lock.js';

test('only the same account execution waits; independent accounts and reads continue', { timeout: 2000 }, async () => {
  const host = { storage: { directory: randomUUID() } }, record = { backend: 'mt5', account: { accountId: 'one', server: 'broker', revision: '1' } };
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  const first = withAccountLock(host, record, async () => { entered(); await gate; return 'first'; });
  await ready;
  let secondStarted = false;
  const second = withAccountLock(host, { ...record, account: { ...record.account, revision: '2' } }, () => { secondStarted = true; return 'second'; });
  const independent = await withAccountLock(host, { ...record, account: { ...record.account, accountId: 'other' } }, () => 'independent');
  assert.equal(independent, 'independent'); assert.equal(secondStarted, false);
  release(); assert.equal(await first, 'first'); assert.equal(await second, 'second');
});

test('a portfolio batch reuses its own account lock for service writes and releases after failure', { timeout: 2000 }, async () => {
  const host = { storage: { directory: randomUUID() } }, record = { backend: 'qmt', account: { accountId: 'one', connectionId: 'route', revision: '1' } };
  await assert.rejects(withAccountLock(host, record, async () => {
    assert.equal(await withAccountLock(host, record, () => 'nested-write'), 'nested-write');
    throw new Error('fixture failure');
  }), /fixture failure/);
  assert.equal(await withAccountLock(host, record, () => 'next'), 'next');
});
