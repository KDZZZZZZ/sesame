import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { TradingRuntime } from '../packages/manual-trading/runtime.js';
import { TradingActivityViewer, activityHTML } from '../packages/manual-trading/viewer.js';

const T0 = Date.parse('2026-10-13T12:00:00Z');
const clone = value => value === undefined ? undefined : structuredClone(value);
function fixture(t) {
  let now = T0, fileId = 0;
  const records = new Map(), files = new Map();
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
    reports: { files: { forSpace: space => { assert.equal(space, 'research'); return filePort; } } },
    events: { emit: () => {} },
    tools: { call: () => assert.fail('Viewing must not call trading tools') },
  };
  const main = { ...host, scope: { kind: 'main', conversationId: 'owner' } };
  const runtime = new TradingRuntime(host, { now: () => now, timer: false });
  const plan = { id: 'plan', ownerConversationId: 'owner', title: 'Collaboration fixture', mode: 'team', debateRounds: 1, backend: 'mt5', reportFolder: '手工交易日报/test' };
  runtime.save({ id: 'run', planId: plan.id, plan, status: 'queued', createdAt: T0, tasks: [], reports: [] });
  const viewer = new TradingActivityViewer(runtime);
  t.after(async () => { await viewer.dispose(); await runtime.dispose(); });
  return { viewer, runtime, host, main, files, filePort, advance: () => ++now };
}
function http(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, options, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end();
  });
}
async function nextSnapshot(reader) {
  let buffer = '';
  for (;;) {
    const result = await reader.read();
    assert.equal(result.done, false, 'Stream ended before a snapshot');
    buffer += new TextDecoder().decode(result.value);
    const message = buffer.split('\n\n').find(value => value.includes('event: snapshot\n'));
    if (message) return JSON.parse(message.split('\n').find(line => line.startsWith('data: ')).slice(6));
  }
}

test('viewer is lazy, owner-scoped, and cannot start or change trading', async t => {
  const f = fixture(t);
  assert.equal(f.viewer.server, undefined);
  assert.equal(f.viewer.read(f.main, 'run').run.status, 'queued');
  assert.equal(f.viewer.server, undefined);
  const other = { ...f.main, scope: { kind: 'main', conversationId: 'other' } };
  await assert.rejects(f.viewer.open(other, 'run'), { code: 'FORBIDDEN' });
  await assert.rejects(f.viewer.open(f.host, 'run'), { code: 'FORBIDDEN' });
  const opened = await f.viewer.open(f.main, 'run');
  assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/$/);
  assert.equal((await f.viewer.open(f.main, 'run')).url, opened.url);
  const page = await http(opened.url), snapshot = await http(`${opened.url}snapshot.json`);
  assert.equal(page.status, 200); assert.match(page.text, /id="report-body"/);
  assert.equal(page.headers['cache-control'], 'no-store'); assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(JSON.parse(snapshot.text).run.status, 'queued');
  assert.equal(f.runtime.run('run').activity.events.length, 1);
});

test('capability routes reject foreign origins, rebinding, writes and token guesses', async t => {
  const f = fixture(t), { url } = await f.viewer.open(f.main, 'run'), origin = new URL(url).origin;
  assert.equal((await http(url, { headers: { origin: 'https://outside.example' } })).status, 403);
  assert.equal((await http(url, { headers: { host: 'outside.example' } })).status, 403);
  assert.equal((await http(url, { method: 'POST' })).status, 405);
  assert.equal((await http(`${origin}/${'0'.repeat(64)}/`)).status, 404);
  assert.equal((await http(`${url}../snapshot.json`)).status, 404);
  assert.equal((await http(url, { headers: { origin } })).status, 200);
});

test('SSE streams real persisted updates and releases clients on disconnect', async t => {
  const f = fixture(t), { url } = await f.viewer.open(f.main, 'run');
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${url}events`, { signal: controller.signal });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader(), initial = await nextSnapshot(reader);
  assert.equal(initial.events.length, 1); assert.equal(f.viewer.clients.size, 1);
  f.runtime.update('run', { status: 'researching', startedAt: f.advance() });
  const update = await nextSnapshot(reader);
  assert.equal(update.run.status, 'researching');
  assert.equal(update.events.at(-1).type, 'run.started');
  assert.deepEqual(update.events, f.runtime.run('run').activity.events);
  await reader.cancel();
  for (let index = 0; index < 30 && f.viewer.clients.size; index++) await delay(10);
  assert.equal(f.viewer.clients.size, 0);
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

test('archiving requires finished tasks, saves the actual record, and follows stable file IDs', async t => {
  const f = fixture(t);
  await assert.rejects(f.viewer.archive(f.main, 'run'), { code: 'RUN_NOT_FINISHED' });
  f.runtime.update('run', { status: 'completed', completedAt: f.advance(), tasks: [{ id: 'reporter', role: 'reporter', round: 0, status: 'running' }] });
  await assert.rejects(f.viewer.archive(f.main, 'run'), { code: 'RUN_NOT_FINISHED' });
  f.runtime.update('run', { tasks: [{ id: 'reporter', role: 'reporter', round: 0, status: 'completed', completedAt: f.advance() }] });
  f.runtime.activity('run', 'run.finished', { at: f.advance(), status: 'completed' });
  const [one, two] = await Promise.all([f.viewer.archive(f.main, 'run'), f.viewer.archive(f.main, 'run')]);
  assert.deepEqual(one, two); assert.equal(one.space, 'research');
  assert.match(one.path, /^手工交易日报\/test\/.+\.collaboration\.html$/);
  const data = JSON.parse(f.files.get(one.dataPath).content);
  assert.equal(data.mode, 'archive'); assert.equal(data.feedUrl, undefined);
  assert.equal(data.events.at(-1).type, 'run.finished');
  const file = f.files.get(one.path); f.files.delete(one.path); file.path = 'renamed.html'; f.files.set(file.path, file);
  assert.equal((await f.viewer.archive(f.main, 'run')).path, 'renamed.html');
  f.files.delete(file.path);
  assert.equal((await f.viewer.archive(f.main, 'run')).state, 'removed_by_user');
  assert.equal([...f.files.values()].some(value => value.path.endsWith('.html')), false);
});

test('opening a running view archives its actual completion without overwriting user files', async t => {
  const f = fixture(t); await f.viewer.open(f.main, 'run');
  f.runtime.update('run', { status: 'completed', completedAt: f.advance() });
  f.runtime.activity('run', 'run.finished', { at: f.advance(), status: 'completed' });
  await Promise.all(f.viewer.archiving.values());
  const saved = f.runtime.run('run').activityReport;
  assert.equal(saved.state, 'archived');
  const other = { ...f.runtime.run('run'), id: 'other-run', activity: undefined, activityReport: undefined };
  f.runtime.save(other);
  const target = saved.path.replace('-run.collaboration.html', '-other-run.collaboration.html');
  await f.filePort.write({ path: target, content: 'Existing user research' });
  await assert.rejects(f.viewer.archive(f.main, other.id), { code: 'REPORT_PATH_OCCUPIED' });
  assert.equal(f.files.get(target).content, 'Existing user research');
});

test('dispose closes streams, the server and the runtime subscription', async t => {
  const f = fixture(t), { url } = await f.viewer.open(f.main, 'run');
  const response = await fetch(`${url}events`), reader = response.body.getReader();
  await nextSnapshot(reader);
  await f.viewer.dispose();
  assert.equal(f.runtime.activityListeners.size, 0); assert.equal(f.viewer.clients.size, 0);
  assert.equal((await reader.read()).done, true);
  await assert.rejects(http(url));
  await assert.rejects(f.viewer.open(f.main, 'run'), { code: 'RUNTIME_CLOSED' });
});

test('deactivation while the listener is starting rejects open without leaving it pending', async t => {
  const f = fixture(t);
  const opening = assert.rejects(f.viewer.open(f.main, 'run'), { code: 'RUNTIME_CLOSED' });
  await f.viewer.dispose();
  await opening;
  assert.equal(f.viewer.server.listening, false);
});
