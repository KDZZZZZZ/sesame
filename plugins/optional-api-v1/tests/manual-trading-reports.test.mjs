import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { TradingRuntime } from '../packages/manual-trading/runtime.js';

const copy = value => value == null ? value : structuredClone(value);
function fixture(t) {
  const records = new Map(), files = new Map(), published = new Map(), writes = [];
  let sequence = 0;
  const filePort = {
    list: async () => ({ entries: [...files.values()].map(copy) }),
    mkdir: async ({ path }) => { const entry = { id: `f-${++sequence}`, path, kind: 'directory' }; files.set(path, entry); return copy(entry); },
    read: async ({ path }) => copy(files.get(path)),
    write: async ({ path, content }) => {
      const entry = { id: `f-${++sequence}`, path, kind: 'file', content };
      files.set(path, entry); writes.push(path); return copy(entry);
    },
  };
  const host = {
    scope: { kind: 'service' }, agents: {},
    storage: {
      get: (kind, id) => copy(records.get(`${kind}:${id}`)),
      put: (kind, value) => { records.set(`${kind}:${value.id}`, copy(value)); return copy(value); },
      list: kind => [...records].filter(([key]) => key.startsWith(`${kind}:`)).map(([, value]) => copy(value)),
    },
    reports: { files: { forSpace: () => filePort } },
    artifacts: {
      blob: content => ({ digest: digest(content), size: Buffer.byteLength(content) }),
      publish: ({ operationId, manifest }) => {
        const prior = published.get(operationId);
        if (prior) assert.equal(canonical(prior), canonical(manifest), 'Publication retries must preserve immutable evidence');
        published.set(operationId, copy(manifest)); return { id: operationId, revision: '1' };
      },
    },
  };
  const runtime = new TradingRuntime(host, { timer: false, activityLimit: 2 });
  const main = { ...host, scope: { kind: 'main', conversationId: 'owner' } };
  runtime.save({ id: 'run', planId: 'plan', plan: { id: 'plan', title: '合成归档测试', ownerConversationId: 'owner',
    mode: 'single', backend: 'mt5', account: { accountId: 'fixture' }, reportFolder: '手工交易日报/test' },
  status: 'completed', createdAt: 1, completedAt: 2, tasks: [], reports: [] });
  runtime.activity('run', 'decision.saved', { message: '已保存业务结果' });
  t.after(() => runtime.dispose());
  const failHTML = () => {
    const write = filePort.write;
    filePort.write = async args => { if (args.path.endsWith('.html')) throw new Error('fixture HTML write failed'); return write(args); };
    return () => { filePort.write = write; };
  };
  return { runtime, main, files, writes, filePort, published, failHTML };
}

test('partial archive retry preserves frozen evidence after reporter events evict live history', async t => {
  const f = fixture(t), restore = f.failHTML();
  await assert.rejects(f.runtime.archive(f.main, 'run'), /fixture HTML write failed/);
  const frozen = canonical(f.runtime.run('run').reportSnapshot);
  assert.ok(frozen);
  assert.equal(f.runtime.run('run').reportPending, true);
  f.runtime.activity('run', 'task.failed', { role: 'reporter', message: '归档调用失败' });
  f.runtime.activity('run', 'run.finished', { message: '本轮结束' });
  restore();
  const report = await f.runtime.archive(f.main, 'run');
  assert.equal(canonical(f.runtime.run('run').reportSnapshot), frozen);
  assert.equal(f.runtime.run('run').reportPending, false);
  assert.equal(f.runtime.run('run').reportError, null);
  assert.equal(f.writes.length, 2);
  assert.equal(f.published.size, 1);
  assert.equal(JSON.parse(f.files.get(report.dataPath).content).activity.events[0].message, '已保存业务结果');
});

test('partial archive follows a moved evidence file instead of creating a second copy', async t => {
  const f = fixture(t), restore = f.failHTML();
  await assert.rejects(f.runtime.archive(f.main, 'run'), /fixture HTML write failed/);
  const evidence = [...f.files.values()].find(file => file.path.endsWith('.json'));
  f.files.delete(evidence.path); evidence.path = '移动的证据.json'; f.files.set(evidence.path, evidence);
  restore();
  const report = await f.runtime.archive(f.main, 'run');
  assert.equal(report.dataPath, evidence.path);
  assert.equal(f.writes.length, 2);
  assert.equal(f.runtime.run('run').reportFiles.find(file => file.suffix === '.json').fileId, evidence.id);
});

for (const action of ['remove', 'edit']) test(`partial archive preserves user ${action} of the evidence`, async t => {
  const f = fixture(t), restore = f.failHTML();
  await assert.rejects(f.runtime.archive(f.main, 'run'), /fixture HTML write failed/);
  const evidence = [...f.files.values()].find(file => file.path.endsWith('.json'));
  if (action === 'remove') f.files.delete(evidence.path); else evidence.content = 'user edited';
  restore();
  await assert.rejects(f.runtime.archive(f.main, 'run'), { code: action === 'remove' ? 'REPORT_REMOVED_BY_USER' : 'REPORT_PATH_OCCUPIED' });
  assert.equal(f.writes.length, 1);
  assert.equal([...f.files.values()].filter(file => file.path.endsWith('.html')).length, 0);
});

test('concurrent callers and later retries keep one report, preserving user moves, edits and deletion', async t => {
  const f = fixture(t);
  const [first, second] = await Promise.all([f.runtime.archive(f.main, 'run'), f.runtime.archive(f.main, 'run')]);
  assert.deepEqual(first, second); assert.equal(f.writes.length, 2);
  const html = f.files.get(first.path);
  f.files.delete(first.path); html.path = '手动整理/总结.html'; f.files.set(html.path, html);
  const moved = await f.runtime.archive(f.main, 'run');
  assert.equal(moved.fileId, first.fileId); assert.equal(moved.path, html.path);
  html.content = 'edited summary';
  assert.equal((await f.runtime.archive(f.main, 'run')).state, 'modified_by_user');
  f.files.delete(html.path);
  assert.equal((await f.runtime.archive(f.main, 'run')).state, 'removed_by_user');
  assert.equal(f.writes.length, 2);
});

test('report publication contains no reporter-specific bookkeeping or recursively embedded snapshots', async t => {
  const f = fixture(t);
  f.runtime.update('run', { tasks: [{ id: 'reporter', role: 'reporter', round: 0, status: 'running' }],
    reports: [{ taskId: 'reporter', role: 'reporter', text: '归档状态' }], reportError: { message: 'old error' }, reportPending: true });
  const report = await f.runtime.archive(f.main, 'run');
  const raw = JSON.parse(f.files.get(report.dataPath).content);
  assert.equal(raw.tasks.length, 0); assert.equal(raw.reports.length, 0);
  for (const key of ['report', 'reportError', 'reportPending', 'reportSnapshot', 'reportFiles', 'activityReport']) assert.equal(raw[key], undefined);
  assert.equal(raw.activity.events.some(event => event.role === 'reporter'), false);
});
