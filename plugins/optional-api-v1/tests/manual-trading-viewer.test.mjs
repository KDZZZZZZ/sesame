import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { TradingRuntime } from '../packages/manual-trading/runtime.js';
import { TradingActivityViewer, activityHTML } from '../packages/manual-trading/viewer.js';

const T0 = Date.parse('2026-10-13T12:00:00Z');
const clone = value => value === undefined ? undefined : structuredClone(value);
function fixture(t) {
  let now = T0, fileId = 0;
  const records = new Map(), files = new Map(), views = new Map();
  const filePort = {
    list: async () => ({ entries: [...files.values()].map(clone) }),
    mkdir: async ({ path }) => { const entry = { id: `file-${++fileId}`, path, kind: 'directory' }; files.set(path, entry); return clone(entry); },
    write: async ({ path, content }) => { const entry = { id: `file-${++fileId}`, path, content, kind: 'file' }; files.set(path, entry); return clone(entry); },
    read: async ({ path }) => clone(files.get(path)),
  };
  const host = {
    scope: { kind: 'service', conversationId: null },
    storage: { get: (kind, id) => clone(records.get(`${kind}:${id}`)), put: (kind, value) => { records.set(`${kind}:${value.id}`, clone(value)); return clone(value); }, list: () => [] },
    agents: { submit: () => assert.fail('Viewing must not start agents'), cancel: () => assert.fail('Viewing must not cancel agents') },
    reports: {
      live: {
        open: async (descriptor, source) => {
          const viewId = 'view-' + descriptor.key;
          if (!views.has(viewId)) {
            const item = { descriptor, snapshot: source.read(), source };
            item.unsubscribe = source.subscribe(() => { item.snapshot = source.read(); }); views.set(viewId, item);
          }
          return { viewId, title: descriptor.title, mode: 'live', panel: 'report' };
        },
        close: async viewId => { views.get(viewId)?.unsubscribe(); views.delete(viewId); },
      },
      files: { forSpace: space => { assert.equal(space, 'research'); return filePort; } },
    },
    artifacts: { blob: content => ({ digest: String(content.length), size: Buffer.byteLength(content) }), publish: () => ({ id: 'evidence', revision: '1' }) },
    events: { emit: () => {} },
    tools: { call: () => assert.fail('Viewing must not call trading tools') },
  };
  const main = { ...host, scope: { kind: 'main', conversationId: 'owner' } };
  const runtime = new TradingRuntime(host, { now: () => now, timer: false });
  const plan = { id: 'plan', ownerConversationId: 'owner', title: 'Collaboration fixture', mode: 'team', debateRounds: 1, backend: 'mt5', account: { accountId: 'fixture' }, reportFolder: '手工交易日报/test' };
  runtime.save({ id: 'run', planId: plan.id, plan, status: 'queued', createdAt: T0, tasks: [], reports: [] });
  const viewer = new TradingActivityViewer(runtime);
  t.after(async () => { await viewer.dispose(); await runtime.dispose(); });
  return { viewer, runtime, host, main, files, filePort, views, advance: () => ++now };
}
test('viewer opens an owner-scoped HTML panel without starting or changing work', async t => {
  const f = fixture(t);
  assert.equal(f.views.size, 0);
  assert.equal(f.viewer.read(f.main, 'run').run.status, 'queued');
  const other = { ...f.main, scope: { kind: 'main', conversationId: 'other' } };
  await assert.rejects(f.viewer.open(other, 'run'), { code: 'FORBIDDEN' });
  await assert.rejects(f.viewer.open(f.host, 'run'), { code: 'FORBIDDEN' });
  const opened = await f.viewer.open(f.main, 'run');
  assert.equal(opened.panel, 'report'); assert.equal(opened.url, undefined);
  assert.deepEqual(await f.viewer.open(f.main, 'run'), opened);
  assert.equal(f.views.size, 1);
  assert.match(f.views.get(opened.viewId).descriptor.html, /id="report-body"/);
  assert.equal(f.files.size, 0);
});

test('host panel subscriptions carry actual persisted state and release on close', async t => {
  const f = fixture(t), { viewId } = await f.viewer.open(f.main, 'run');
  assert.equal(f.runtime.activityListeners.size, 1);
  f.runtime.update('run', { status: 'researching', startedAt: f.advance() });
  const snapshot = f.views.get(viewId).snapshot;
  assert.equal(snapshot.run.status, 'researching');
  assert.equal(snapshot.events.at(-1).type, 'run.started');
  assert.deepEqual(snapshot.events, f.runtime.run('run').activity.events);
  await f.host.reports.live.close(viewId);
  assert.equal(f.runtime.activityListeners.size, 0);
  assert.equal(f.viewer.views.size, 0);
});

test('closed and capacity-evicted views do not accumulate plugin-side references', async t => {
  const f = fixture(t), base = f.runtime.run('run');
  for (let i = 0; i < 100; i++) {
    const id = `run-${i}`;
    f.runtime.save({ ...base, id });
    const opened = await f.viewer.open(f.main, id);
    await f.viewer.open(f.main, id);
    if (f.views.size > 2) await f.host.reports.live.close(f.views.keys().next().value);
    assert.ok(f.viewer.views.has(opened.viewId));
    assert.equal(f.viewer.views.size, f.views.size);
    assert.equal(f.runtime.activityListeners.size, f.views.size);
  }
  await f.viewer.dispose();
  assert.equal(f.viewer.views.size, 0);
  assert.equal(f.runtime.activityListeners.size, 0);
});

test('older hosts report the required panel capability instead of opening an external browser', async t => {
  const f = fixture(t), old = { ...f.main, reports: { files: f.main.reports.files } };
  await assert.rejects(f.viewer.open(old, 'run'), { code: 'HOST_UPGRADE_REQUIRED' });
  assert.equal(f.views.size, 0); assert.equal(f.files.size, 0);
});

test('embedded reports cannot escape JSON into executable HTML', t => {
  const f = fixture(t), snapshot = f.viewer.read(f.main, 'run');
  snapshot.run.title = '</script><script>globalThis.compromised=true</script>\u2028\u2029 __SESAME_ACTIVITY_SCRIPT__';
  const html = activityHTML(snapshot);
  assert.equal(html.includes('<script>globalThis.compromised'), false);
  const raw = /<script id="activity-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.deepEqual(JSON.parse(raw), JSON.parse(JSON.stringify(snapshot)));
  assert.equal((html.match(/__SESAME_ACTIVITY_SCRIPT__/g) ?? []).length, 1, 'Template-like text in a report stays literal');
});

test('legacy archive returns the one run summary, coalesces retries, and follows stable file IDs', async t => {
  const f = fixture(t);
  await assert.rejects(f.viewer.archive(f.main, 'run'), { code: 'RUN_NOT_FINISHED' });
  f.runtime.update('run', { status: 'completed', completedAt: f.advance(), tasks: [{ id: 'reporter', role: 'reporter', round: 0, status: 'running' }] });
  await assert.rejects(f.viewer.archive(f.main, 'run'), { code: 'RUN_NOT_FINISHED' });
  f.runtime.update('run', { tasks: [{ id: 'reporter', role: 'reporter', round: 0, status: 'completed', completedAt: f.advance() }] });
  f.runtime.activity('run', 'run.finished', { at: f.advance(), status: 'completed' });
  const [one, two] = await Promise.all([f.viewer.archive(f.main, 'run'), f.viewer.archive(f.main, 'run')]);
  assert.deepEqual(one, two); assert.equal(one.space, 'research');
  assert.match(one.path, /^手工交易日报\/test\/.+\.html$/);
  assert.doesNotMatch(one.path, /\.collaboration\.html$/);
  assert.equal([...f.files.values()].filter(value => value.path.endsWith('.html')).length, 1);
  const data = JSON.parse(f.files.get(one.dataPath).content);
  assert.equal(data.id, 'run'); assert.equal(data.status, 'completed');
  assert.equal(data.tasks.some(task => task.role === 'reporter'), false);
  const file = f.files.get(one.path); f.files.delete(one.path); file.path = 'renamed.html'; f.files.set(file.path, file);
  assert.equal((await f.viewer.archive(f.main, 'run')).path, 'renamed.html');
  f.files.delete(file.path);
  assert.equal((await f.viewer.archive(f.main, 'run')).state, 'removed_by_user');
  assert.equal([...f.files.values()].some(value => value.path.endsWith('.html')), false);
});

test('opening and finishing a live view never creates another report or replay file', async t => {
  const f = fixture(t), opened = await f.viewer.open(f.main, 'run');
  assert.equal(opened.archiveUrl, undefined);
  f.runtime.update('run', { status: 'completed', completedAt: f.advance() });
  f.runtime.activity('run', 'run.finished', { at: f.advance(), status: 'completed' });
  await delay(80);
  assert.equal(f.runtime.run('run').activityReport, undefined);
  assert.equal(f.files.size, 0);
  const saved = await f.runtime.archive(f.main, 'run');
  await f.viewer.open(f.main, 'run');
  assert.equal([...f.files.values()].filter(value => value.path.endsWith('.html')).length, 1);
  assert.equal(f.viewer.read(f.main, 'run').run.report.path, saved.path);
});

test('dispose revokes the panel and releases its runtime subscription', async t => {
  const f = fixture(t); await f.viewer.open(f.main, 'run');
  await f.viewer.dispose();
  assert.equal(f.runtime.activityListeners.size, 0); assert.equal(f.views.size, 0);
  await assert.rejects(f.viewer.open(f.main, 'run'), { code: 'RUNTIME_CLOSED' });
});

test('deactivation during panel registration rejects open and revokes the late view', async t => {
  const f = fixture(t);
  const opening = assert.rejects(f.viewer.open(f.main, 'run'), { code: 'RUNTIME_CLOSED' });
  await f.viewer.dispose(); await opening;
  assert.equal(f.views.size, 0); assert.equal(f.runtime.activityListeners.size, 0);
});
