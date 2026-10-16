import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, hostForStore } from './mt5-host.js';
import { configureDependencies, discoverDependencies, inspectDependencies } from '../../optional-api-v1/packages/mt5/backend/dependencies.js';
import { compileNative, fileManifest } from '../../optional-api-v1/packages/mt5/backend/native.js';
import { compileLocal } from '../../optional-api-v1/packages/mt5/backend/local-compiler.js';
import { digest } from '../../optional-api-v1/packages/mt5/backend/support.js';
import { wineCommand, wineEnvironment } from '../../optional-api-v1/packages/mt5/backend/platform.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sesame-dependencies-')); t.after(() => rm(root, { recursive: true, force: true }));
  const program = join(root, 'terminal'), data = join(root, 'data'), python = join(root, 'python.exe'), wine = join(root, 'wine');
  await mkdir(program); await mkdir(join(data, 'MQL5/Include'), { recursive: true });
  for (const p of [join(program, 'terminal64.exe'), join(program, 'MetaEditor64.exe'), python, wine]) await writeFile(p, 'MZ controlled fixture');
  const host = { ...hostForStore(new Store(join(root, 'private'))), scope: { kind: 'main', conversationId: 'conv_main' }, configuration: { exclusive: fn => fn() }, environment: { runtime: { platform: process.platform, paths: { qemu: '/research-only' } }, pythonPath: '/never-use-host-python' } };
  const mt5 = { host, options: {}, jobs: new Map(), tester: { pending: new Map() }, deployments: { list: () => [] }, official: { jobs: new Map(), python: { close: async () => {} }, settings: () => ({ existing: true }) } };
  const changes = { terminal_directory: program, data_directory: data, python, ...(process.platform !== 'win32' ? { wine, wine_prefix: data } : {}) };
  return { root, host, mt5, program, data, python, wine, changes };
}

test('dependency configuration persists explicit paths, preserves account settings, and is idempotent', async t => {
  const f = await fixture(t), args = { command_id: 'configure_native_dependencies', expected_version: 1, changes: f.changes };
  const saved = await configureDependencies(f.host, f.mt5, args);
  assert.equal(saved.version, 2); assert.deepEqual(await configureDependencies(f.host, f.mt5, args), saved);
  const found = discoverDependencies(f.host);
  assert.equal(found.native.dataDirectory, f.data); assert.equal(found.native.python, f.python);
  assert.equal(found.environment.native.editor, join(f.program, 'MetaEditor64.exe'));
  if (process.platform !== 'win32') { assert.equal(wineCommand(found.native), f.wine); assert.equal(wineEnvironment(found.native).WINEPREFIX, f.data); }
  const status = inspectDependencies(f.mt5, { probe: true });
  assert.equal(status.compiler.available, true); assert.equal(status.compiler.backend, 'native');
  assert.deepEqual(status.connections, { existing: true }); assert.equal(status.python.sdk_verified, false);
  await assert.rejects(configureDependencies(f.host, f.mt5, { ...args, changes: { ...f.changes, python: null } }), { code: 'idempotency_conflict' });
  await assert.rejects(configureDependencies(f.host, f.mt5, { ...args, command_id: 'stale_dependency_command' }), { code: 'version_conflict' });
});

test('dependency configure refuses active native runs and host Python executables', async t => {
  const f = await fixture(t); f.mt5.deployments.list = () => [{ status: 'running' }];
  const args = { command_id: 'configure_dependency_refused', expected_version: 1, changes: f.changes };
  await assert.rejects(configureDependencies(f.host, f.mt5, args), { code: 'mt5_busy' });
  assert.equal(f.host.storage.get('mt5_dependencies', 'local', true), undefined);
  f.mt5.deployments.list = () => []; await writeFile(f.python, '#!/bin/sh');
  await assert.rejects(configureDependencies(f.host, f.mt5, args), /Windows Python/);
});

test('missing terminal reports installation prerequisites without a mandatory runtime image', async t => {
  const f = await fixture(t); f.mt5.options = { directory: join(f.root, 'missing') };
  const report = inspectDependencies(f.mt5, { probe: true });
  assert.equal(report.compiler.available, false); assert.equal(report.discovered.terminal, null);
  assert.ok(report.missing.find(x => x.id === 'terminal'));
  assert.ok(report.missing.find(x => x.id === 'python').install_directory.startsWith(f.host.storage.directory));
});

async function frozen(f) {
  const source = join(f.root, 'frozen'); await mkdir(join(source, 'Experts'), { recursive: true }); await mkdir(join(source, '.compiler')); await mkdir(join(source, 'Include'));
  await writeFile(join(source, 'Experts/Strategy.mq5'), 'void OnStart() {}'); await writeFile(join(source, '.compiler/MetaEditor64.exe'), 'MZ frozen compiler');
  const files = await fileManifest(source), manifest = JSON.stringify({ files, compiler_sha256: files['.compiler/MetaEditor64.exe'].sha256 });
  await writeFile(join(source, 'manifest.json'), manifest);
  return { source, hash: digest(manifest), native: { directory: f.program, editor: join(f.program, 'MetaEditor64.exe'), python: f.python, wine: f.wine, winePrefix: f.data } };
}

test('research-only host runtime falls through to native worker and retains its execution evidence', async t => {
  const f = await fixture(t), b = await frozen(f); let request;
  const result = await compileNative(b.native, b.source, undefined, b.hash, undefined, { ...f.host.environment, compiler: { backend: 'auto' }, executeWorker: async (_entry, payload) => { request = payload; return { success: false, diagnostics: 'Result: 1 errors, 0 warnings', ex5_sha256: null, execution: { backend: 'native' } }; } });
  assert.equal(request.runtime, undefined); assert.equal(request.compiler, undefined); assert.equal(request.native.python, f.python);
  assert.deepEqual(result.execution, { backend: 'native' });
});

test('local compiler freezes input, waits for native cleanup, and stops only its private Wine prefix', async t => {
  const f = await fixture(t), b = await frozen(f); let prefix, stopped = false;
  const result = await compileLocal(b.native, b.source, b.hash, undefined, { runProcess: async (native, request) => {
    prefix = native.winePrefix; assert.notEqual(prefix, f.data); assert.equal(request.kind, 'compiler');
    assert.equal(await readFile(join(request.directory, 'Experts/Strategy.mq5'), 'utf8'), 'void OnStart() {}');
    await writeFile(join(request.directory, 'Experts/Strategy.log'), Buffer.from('\uFEFFResult: 0 errors, 0 warnings', 'utf16le'));
    await writeFile(join(request.directory, 'Experts/Strategy.ex5'), 'controlled-ex5');
    return { nativePid: 123, cleanup: { confirmed: true, activeProcesses: 0 } };
  }, stopWine: async native => { assert.equal(native.winePrefix, prefix); stopped = true; } });
  assert.equal(result.ex5_sha256, digest('controlled-ex5')); assert.equal(result.execution.backend, 'native');
  if (process.platform !== 'win32') assert.equal(stopped, true);
  assert.equal((await readdir(f.root)).some(name => name.startsWith('native-compile-')), false);
  await assert.rejects(readFile(join(b.source, 'Experts/Strategy.ex5')), { code: 'ENOENT' });
});

test('local compiler preserves diagnostic directory if native cleanup is unconfirmed', async t => {
  const f = await fixture(t), b = await frozen(f);
  await assert.rejects(compileLocal(b.native, b.source, b.hash, undefined, { runProcess: async () => ({ cleanup: { confirmed: false } }), stopWine: async () => {} }), { code: 'runtime_cleanup_failed' });
  assert.ok((await readdir(f.root)).some(name => name.startsWith('native-compile-')));
});

test('local compiler checks snapshot digest before any native process starts', async t => {
  const f = await fixture(t), b = await frozen(f); let started = false;
  await writeFile(join(b.source, 'Experts/Strategy.mq5'), 'tampered');
  await assert.rejects(compileLocal(b.native, b.source, b.hash, undefined, { runProcess: async () => { started = true; }, stopWine: async () => {} }), /冻结构建输入/);
  assert.equal(started, false);
});

test('official catalog reports an actionable prerequisite when native dependencies are absent', async t => {
  const f = await fixture(t);
  const { MT5Official } = await import('../../optional-api-v1/packages/mt5/backend/official.js');
  const official = await new MT5Official(f.host, null).init(); t.after(() => official.close());
  const catalog = await official.catalog('python');
  assert.equal(catalog.items[0].status, 'not_installed');
  assert.equal(catalog.items[0].prerequisite.code, 'PREREQUISITE_REQUIRED');
  assert.equal(catalog.items[0].prerequisite.private_directory, join(f.host.storage.directory, 'dependencies'));
  await assert.rejects(official.tools('launcher'), error => error.code === 'PREREQUISITE_REQUIRED' && JSON.parse(error.message).next.tool === 'mt5_dependencies');
});
