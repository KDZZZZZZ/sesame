import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, hostForStore } from './mt5-host.js';
import { MT5 } from '../../optional-api-v1/packages/mt5/backend/service.js';
import { SDK_VERSION, stableJSON } from '../../optional-api-v1/packages/mt5/backend/contracts.js';
import { digest } from '../../optional-api-v1/packages/mt5/backend/support.js';

const runId = 'run_00000000-0000-0000-0000-000000000001';
const completed = bytes => ({ success: true, diagnostics: 'Fixture compilation succeeded',
  ex5: bytes.toString('base64'), ex5_sha256: digest(bytes), execution: { backend: 'fixture', nativeExecuted: false } });

async function fixture(t, { compiler = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mt5-project-compiler-'));
  const directory = join(root, 'private'), options = { disabled: !compiler };
  let store = new Store(directory), host = hostForStore(store, { sessionId: 'conv_main', runId });
  await mkdir(host.context.workspaceRoot, { recursive: true });
  if (compiler) {
    const terminal = join(root, 'terminal'), data = join(root, 'terminal-data');
    const python = join(root, 'python.exe'), wine = join(root, 'wine');
    await mkdir(terminal); await mkdir(join(data, 'MQL5/Include'), { recursive: true });
    for (const path of [join(terminal, 'terminal64.exe'), join(terminal, 'MetaEditor64.exe'), python, wine]) await writeFile(path, 'MZ fixture; never execute');
    await writeFile(join(data, 'MQL5/Include/Fixture.mqh'), '// frozen native include\n');
    store.put('mt5_dependencies', { id: 'local', version: 1, terminal_directory: terminal, data_directory: data, python, wine, wine_prefix: data });
    options.directory = terminal;
  }
  let mt5 = await new MT5(host, options).init();
  t.after(async () => {
    await mt5.close(); store.close();
    assert.equal(dirname(root), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  return {
    root, directory, options,
    get mt5() { return mt5; }, get store() { return store; }, get host() { return host; },
    async reopen() {
      await mt5.close(); store.close();
      store = new Store(directory); host = hostForStore(store, { sessionId: 'conv_main', runId });
      mt5 = await new MT5(host, options).init();
      return mt5;
    },
  };
}

test('SQLite reopen fails only interrupted builds without replay and retains project, SDK and official state', async t => {
  const f = await fixture(t), project = f.mt5.create('Restarted project');
  const revision = f.store.get('mt5_revision', `${project.id}:1`), sdk = structuredClone(f.mt5.sdk);
  const settings = await f.mt5.official.configure({ expected_version: 1, allow_trading: false, servers: { terminal: { enabled: false } } });
  const originals = [];
  for (const status of ['queued', 'compiling', 'succeeded', 'failed', 'canceled', 'unknown']) {
    originals.push(f.store.put('mt5_build', { id: `build_${status}`, project_id: project.id, revision: 1,
      source_digest: project.source_digest, status, created_at: '2026-10-01T00:00:00.000Z', completed_at: null,
      ex5_sha256: 'retained-hash', diagnostics: 'retained-diagnostic', conversation_id: 'conv_main', owner_run_id: runId }));
  }
  const priorStorage = f.store, mt5 = await f.reopen();
  assert.notEqual(f.store, priorStorage, 'The fixture must reopen SQLite rather than reuse the cached store');
  assert.equal(mt5.host, f.host); assert.equal(mt5.storage, f.store); assert.equal(mt5.official.storage, f.store);
  assert.deepEqual(mt5.list(), [project]); assert.deepEqual(f.store.get('mt5_revision', `${project.id}:1`), revision);
  assert.deepEqual(mt5.sdk, sdk); assert.ok(mt5.legacyTemplate.files['Experts/Strategy.mq5']);
  assert.equal(mt5.template.strategy_contract.template_version, project.template_version);
  assert.equal(mt5.status().sdk_version, SDK_VERSION); assert.deepEqual(mt5.official.settings(), settings);
  const actual = f.store.list('mt5_build');
  for (const original of originals) {
    const restored = actual.find(row => row.id === original.id);
    if (['queued', 'compiling'].includes(original.status)) {
      assert.deepEqual(restored, { ...original, status: 'failed', ex5_sha256: null,
        diagnostics: '应用重启，未自动重放编译。', completed_at: restored.completed_at });
      assert.ok(Number.isFinite(Date.parse(restored.completed_at)));
    } else assert.deepEqual(restored, original);
  }
  mt5.compile = () => assert.fail('Recovered builds must not be automatically replayed');
  for (const build of actual) assert.deepEqual(await mt5.startBuild(build.id), build);
  assert.equal(mt5.jobs.size, 0);
  await f.reopen();
  assert.deepEqual(f.store.list('mt5_build'), actual, 'A second restart must retain the first recovery receipt');
});

test('project revisions keep their own platform entry and preserve conflicts across reopens', async t => {
  const f = await fixture(t), mt5 = f.mt5, project = mt5.create('Frozen platform entry');
  const checkout = await mt5.checkout(f.host, project.id, undefined, 'conv_main');
  const alternate = await mt5.checkout(f.host, project.id, undefined, 'conv_main');
  const original = mt5.project(project.id), engineDigest = original.engine.digest;
  mt5.template.files['Experts/Strategy.mq5'] = '// next package version';
  const note = join(checkout.path, 'README.md');
  await writeFile(note, original.files['README.md'] + '\nSaved revision note.\n');
  const saved = await mt5.save(f.host, checkout.id, undefined, 'conv_main');
  assert.equal(saved.revision, 2); assert.equal(saved.version, 2);
  assert.equal(mt5.project(project.id).engine.digest, engineDigest);
  assert.deepEqual(f.store.get('mt5_revision', `${project.id}:1`).files, original.files);
  await assert.rejects(mt5.save(f.host, alternate.id, undefined, 'conv_main'), { code: 'revision_conflict', status: 409 });
  const limits = { ...saved.test_risk_limits, max_open_positions: 2 };
  assert.throws(() => mt5.configure(project.id, limits, 1), { code: 'version_conflict', status: 409 });
  const configured = mt5.configure(project.id, limits, 2);
  assert.equal(configured.version, 3); assert.equal(configured.revision, 2);
  const restored = await f.reopen();
  assert.equal(restored.project(project.id).files['README.md'], await readFile(note, 'utf8'));
  assert.deepEqual(restored.project(project.id).test_risk_limits, limits);
  await writeFile(join(checkout.path, 'Experts/Strategy.mq5'), original.files['Experts/Strategy.mq5'] + '\n// altered platform entry\n');
  await assert.rejects(restored.save(f.host, checkout.id, undefined, 'conv_main'), error => {
    const diagnostic = JSON.parse(error.message);
    assert.equal(diagnostic.code, 'visual_mql_invalid');
    assert.equal(diagnostic.diagnostics[0].file, 'Experts/Strategy.mq5');
    return true;
  });
  assert.equal(restored.project(project.id).revision, 2);
});

test('missing compiler returns the original prerequisite diagnostic without queuing a build', async t => {
  const f = await fixture(t), project = f.mt5.create('Offline project');
  assert.throws(() => f.mt5.queueBuild(project.id, 1, 'conv_main', f.host), error => {
    assert.equal(error.code, 'PREREQUISITE_REQUIRED'); assert.equal(error.status, 503);
    const diagnostic = JSON.parse(error.message);
    assert.equal(diagnostic.capability, 'local-compiler');
    assert.equal(diagnostic.private_directory, join(f.directory, 'dependencies'));
    assert.equal(diagnostic.next.tool, 'mt5_dependencies');
    assert.ok(diagnostic.missing.some(row => row.id === 'terminal'));
    return true;
  });
  assert.deepEqual(f.store.list('mt5_build'), []); assert.equal(f.mt5.jobs.size, 0);
});

test('build queue serializes frozen compilation, deduplicates starts and retains the original owner', { timeout: 15000 }, async t => {
  const f = await fixture(t, { compiler: true }), mt5 = f.mt5, project = mt5.create('Serial compiler');
  const first = mt5.queueBuild(project.id, 1, 'conv_main', f.host);
  const childHost = hostForStore(f.store, { sessionId: 'child', runId: 'run_00000000-0000-0000-0000-000000000002', kind: 'subagent' });
  const second = mt5.queueBuild(project.id, 1, 'child', childHost);
  assert.equal(first.owner_run_id, runId); assert.equal(second.owner_run_id, childHost.context.runId);
  const firstEntered = Promise.withResolvers(), releaseFirst = Promise.withResolvers();
  const calls = []; let active = 0, maxActive = 0;
  mt5.compilerEnvironment.executeWorker = async (entry, input, context) => {
    calls.push(input); active++; maxActive = Math.max(maxActive, active);
    assert.equal(entry, 'backend/compiler-worker.js'); assert.equal(context.runId, input.runId);
    assert.equal(context.signal.aborted, false);
    const manifestText = await readFile(join(input.directory, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestText);
    assert.equal(input.manifestDigest, digest(manifestText));
    assert.equal(manifest.source_digest, project.source_digest);
    assert.equal(f.store.get('mt5_build', manifest.build_id).status, 'compiling');
    assert.equal(await readFile(join(input.directory, 'Include/Fixture.mqh'), 'utf8'), '// frozen native include\n');
    assert.match(await readFile(join(input.directory, 'Include/Product/Build.mqh'), 'utf8'), new RegExp(manifest.build_id));
    assert.equal(manifest.sdk_version, SDK_VERSION);
    if (calls.length === 1) { firstEntered.resolve(); await releaseFirst.promise; }
    active--; return completed(Buffer.from(`fixture EX5 for ${manifest.build_id}`));
  };
  const a = mt5.startBuild(first.id), duplicate = mt5.startBuild(first.id), b = mt5.startBuild(second.id);
  assert.equal(a, duplicate); assert.equal(mt5.jobs.size, 2);
  await firstEntered.promise;
  assert.equal(calls.length, 1); assert.equal(f.store.get('mt5_build', second.id).status, 'queued');
  releaseFirst.resolve();
  const [one, two] = await Promise.all([a, b]);
  assert.equal(maxActive, 1); assert.equal(calls.length, 2); assert.equal(mt5.jobs.size, 0);
  assert.deepEqual(calls.map(row => row.runId), [runId, childHost.context.runId]);
  for (const value of [one, two]) {
    assert.equal(value.status, 'succeeded'); assert.equal(value.execution.nativeExecuted, false);
    assert.equal(value.ex5_sha256, digest(await readFile(join(f.directory, 'mt5/builds', value.id, 'Experts/Strategy.ex5'))));
    const manifest = JSON.parse(await readFile(join(f.directory, 'mt5/builds', value.id, 'manifest.json'), 'utf8'));
    assert.equal(value.manifest_digest, digest(stableJSON(manifest)));
    assert.deepEqual(await mt5.startBuild(value.id), value);
  }
  assert.equal(calls.length, 2, 'Reading completed builds must not dispatch compilation again');
  assert.equal(await readFile(join(mt5.native.include, 'Fixture.mqh'), 'utf8'), '// frozen native include\n');
});

test('canceling a queued compilation does not cancel its predecessor or dispatch its native worker', { timeout: 15000 }, async t => {
  const f = await fixture(t, { compiler: true }), mt5 = f.mt5, project = mt5.create('Queued cancellation');
  const first = mt5.queueBuild(project.id, 1), second = mt5.queueBuild(project.id, 1);
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let calls = 0;
  mt5.compilerEnvironment.executeWorker = async (_entry, _input, { signal }) => {
    calls++; entered.resolve(); await release.promise;
    assert.equal(signal.aborted, false); return completed(Buffer.from('first EX5'));
  };
  const controller = new AbortController(), a = mt5.startBuild(first.id), b = mt5.startBuild(second.id, controller.signal);
  await entered.promise; controller.abort(); release.resolve();
  assert.equal((await a).status, 'succeeded'); assert.equal((await b).status, 'canceled');
  assert.equal(calls, 1); assert.equal(mt5.jobs.size, 0);
});

test('cleanup failure remains unknown and a rejected compilation does not poison the shared queue', { timeout: 15000 }, async t => {
  const f = await fixture(t, { compiler: true }), mt5 = f.mt5, project = mt5.create('Unknown cleanup');
  const first = mt5.queueBuild(project.id, 1), second = mt5.queueBuild(project.id, 1); let calls = 0;
  const failure = Object.assign(new Error('fixture cleanup unconfirmed'), { code: 'runtime_cleanup_failed' });
  mt5.compilerEnvironment.executeWorker = async () => {
    if (++calls === 1) throw failure;
    return completed(Buffer.from('second EX5'));
  };
  const a = mt5.startBuild(first.id), b = mt5.startBuild(second.id);
  await assert.rejects(a, error => error === failure);
  assert.equal((await b).status, 'succeeded');
  const unknown = f.store.get('mt5_build', first.id);
  assert.equal(unknown.status, 'unknown'); assert.equal(unknown.cleanup_failed, true); assert.equal(unknown.ex5_sha256, null);
  assert.deepEqual(await mt5.startBuild(first.id), unknown); assert.equal(calls, 2);
  assert.equal(mt5.jobs.size, 0);
});

test('closing the facade aborts running and queued builds before their promises settle', { timeout: 15000 }, async t => {
  const f = await fixture(t, { compiler: true }), mt5 = f.mt5, project = mt5.create('Close compiler');
  const first = mt5.queueBuild(project.id, 1), second = mt5.queueBuild(project.id, 1);
  const entered = Promise.withResolvers(); let calls = 0;
  mt5.compilerEnvironment.executeWorker = (_entry, _input, { signal }) => new Promise((_resolve, reject) => {
    calls++; entered.resolve();
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const a = mt5.startBuild(first.id), b = mt5.startBuild(second.id);
  await entered.promise; await mt5.close();
  assert.equal((await a).status, 'canceled'); assert.equal((await b).status, 'canceled');
  assert.equal(calls, 1); assert.equal(mt5.jobs.size, 0);
  assert.throws(() => mt5.queueBuild(project.id, 1), error => error.status === 503);
});
