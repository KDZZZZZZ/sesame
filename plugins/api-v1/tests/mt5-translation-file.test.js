import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Type } from '@sesame/plugin-sdk/schema';
import { digest, canonical } from '@sesame/plugin-sdk/protocol';
import { validateSource } from '@sesame/plugin-sdk/svl';
import { registerTranslationFile } from '../packages/mt5/backend/translation-file.js';
import { registerTranslation, targetProfile } from '../packages/mt5/backend/target.js';
import { createTools } from '../packages/mt5/tools/strategy.js';
import { translationManifestSchema, translationSchema, MAX_TRANSLATION_MANIFEST_BYTES } from '../packages/mt5/backend/translation-input.js';
import { Store, hostForStore } from './mt5-host.js';

const clone = value => structuredClone(value);
const conflict = () => Object.assign(new Error('Idempotency conflict'), { code: 'idempotency_conflict' });
async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'sesame-translation-file-'))), workspace = join(directory, 'workspace');
  await mkdir(workspace); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(join(directory, 'storage')), blobs = new Map(), records = new Map(), requests = new Map(), pending = new Map();
  const host = hostForStore(store);
  host.plugin = { id: 'sesame/mt5', version: '1.1.9', digest: `sha256:${'1'.repeat(64)}` }; host.scope = { kind: 'main', conversationId: 'fixture-main', runId: 'fixture-run' };
  host.workspace = { path: path => resolve(workspace, path) };
  host.tools = { Type, define: (name, description, properties, execute) => ({ name, label: name, description, parameters: Type.Object(properties, { additionalProperties: false }), execute }) };
  host.storage.idempotentAsync = async (key, fingerprint, action) => {
    const done = store.requests.get(key);
    if (done) { if (done.fingerprint !== fingerprint) throw conflict(); return clone(done.value); }
    const running = pending.get(key);
    if (running) { if (running.fingerprint !== fingerprint) throw conflict(); return running.promise; }
    const promise = Promise.resolve().then(action).then(value => store.idempotent(key, fingerprint, () => value)).finally(() => pending.delete(key));
    pending.set(key, { fingerprint, promise }); return promise;
  };
  host.artifacts = {
    blob(value) { const bytes = Buffer.from(value), ref = { digest: digest(bytes), size: bytes.length }; blobs.set(ref.digest, bytes); return ref; },
    readBlob(ref) { const bytes = blobs.get(ref.digest); assert.ok(bytes); assert.equal(bytes.length, ref.size); assert.equal(digest(bytes), ref.digest); return Buffer.from(bytes); },
    publish(input) {
      const old = requests.get(input.operationId), hash = digest(input);
      if (old) { if (old.hash !== hash) throw conflict(); return clone(old.ref); }
      for (const ref of input.manifest.dependencies) this.read(ref);
      for (const blob of input.manifest.blobs) this.readBlob(blob);
      const ref = { id: `artifact-${records.size}`, revision: `revision-${records.size}`, digest: digest(input.manifest), kind: input.manifest.kind, schemaVersion: '1.0.0' };
      records.set(ref.id, { ref, producer: clone(host.plugin), manifest: clone(input.manifest) }); requests.set(input.operationId, { hash, ref }); return clone(ref);
    },
    read(ref) { const record = records.get(ref.id); assert.ok(record); assert.equal(canonical(record.ref), canonical(ref)); return clone(record); },
  };
  const value = JSON.parse(await readFile(new URL('../packages/strategy-authoring/examples/close-threshold.svl.json', import.meta.url))), checked = validateSource(value);
  const source = host.artifacts.publish({ operationId: 'fixture-source', manifest: { kind: 'strategy.source', schemaVersion: '1.0.0', content: { language: 'svl/1', languageVersion: '1.0.0', sourcePath: 'strategy.svl.json', sourceDigest: checked.sourceDigest }, dependencies: [], blobs: [{ path: 'strategy.svl.json', mediaType: 'application/json', ...host.artifacts.blob(JSON.stringify(value)) }] } });
  const target = await targetProfile(host);
  const manifest = { title: '  Fixture translation  ', source, target, mode: 'backtest', parameter_map: { instrument: { binding: 'instrument' }, threshold: { nativeInput: 'Threshold' } },
    files: { 'Experts/Strategy.mq5': '#property strict\n' + '// declaration fixture, not native validation\n'.repeat(800) + 'void OnTick() {}\n' },
    source_map: value.nodes.map(node => ({ nodeId: node.id, generated: [{ path: 'Experts/Strategy.mq5', startLine: 1, endLine: 1 }], instrumentation: 'direct' })), adaptations: [] };
  const path = join(workspace, 'translation.json'); await writeFile(path, JSON.stringify(manifest));
  const args = { operation_id: 'translation_file_fixture_01', manifest_path: 'translation.json' };
  return { directory, workspace, path, store, host, manifest, args, mt5: { status: () => ({ compile: false }) }, blobs, records, requests, write: value => writeFile(path, JSON.stringify(value)), run: (input = args) => registerTranslationFile(host, { status: () => ({ compile: false }) }, input) };
}

function withoutManifest(result) { const { manifest, ...rest } = result; return rest; }

test('short file tool publishes exact 800-line bytes through the shared target pipeline and returns compact refs', async t => {
  const f = await fixture(t), tools = createTools(f.host, f.mt5), call = tools.find(tool => tool.name === 'mt5_translation_file');
  assert.deepEqual(Object.keys(call.parameters.properties), ['operation_id', 'manifest_path']);
  const result = await call.execute(f.args), artifact = f.host.artifacts.read(result.translation);
  const file = artifact.manifest.blobs.find(item => item.path === 'Experts/Strategy.mq5');
  assert.equal(f.host.artifacts.readBlob(file).toString(), f.manifest.files['Experts/Strategy.mq5']);
  assert.equal(f.host.artifacts.read(result.validation).manifest.content.outcome, 'partial');
  assert.equal(result.manifest.source.sha256, digest(await readFile(f.path))); assert.equal(result.manifest.reused, false);
  assert.equal(result.manifest.digest, digest(f.manifest));
  assert.ok(JSON.stringify(result).length < 4000); assert.equal(JSON.stringify(result).includes('declaration fixture'), false);
  assert.equal(f.store.list('mt5_project').length, 1); assert.equal(f.store.list('mt5_translation_receipt').length, 1);
  assert.deepEqual(await registerTranslation(f.host, f.mt5, { operation_id: f.args.operation_id, ...f.manifest }), withoutManifest(result));
  assert.deepEqual(Object.fromEntries(Object.entries(translationSchema.properties).filter(([key]) => key !== 'operation_id')), translationManifestSchema.properties);
  const profile = f.host.artifacts.read(f.manifest.target).manifest.content;
  assert.ok(profile.workflows[0].tools.some(tool => tool.toolId === 'mt5_translation_file')); assert.ok(profile.runtime.resources.includes('target/translation-file.md'));
});

test('concurrent same-operation calls converge; retries explicitly reuse the frozen input after edits or deletion', async t => {
  const f = await fixture(t), results = await Promise.all(Array.from({ length: 12 }, () => f.run()));
  assert.ok(results.every(result => result.project_id === results[0].project_id)); assert.equal(f.store.list('mt5_project').length, 1);
  const old = results[0], size = f.records.size;
  await f.write({ ...f.manifest, title: 'Changed after first snapshot' });
  const edited = await f.run(); assert.deepEqual(withoutManifest(edited), withoutManifest(old)); assert.equal(edited.manifest.reused, true); assert.equal(edited.manifest.digest, old.manifest.digest);
  await rm(f.workspace, { recursive: true });
  const retry = await f.run(); assert.deepEqual(withoutManifest(retry), withoutManifest(old)); assert.equal(retry.manifest.reused, true); assert.equal(f.records.size, size);
  await assert.rejects(f.run({ ...f.args, manifest_path: 'another.json' }), { code: 'idempotency_conflict' });
  await assert.rejects(registerTranslation(f.host, f.mt5, { operation_id: f.args.operation_id, ...f.manifest, title: 'Other input' }), { code: 'idempotency_conflict' });
});

test('unknown outcome after project commit recovers without republishing or overwriting a later project revision', async t => {
  const f = await fixture(t), transaction = f.host.storage.transaction; let lost = false;
  f.host.storage.transaction = action => {
    const result = transaction(action);
    if (!lost && f.store.list('mt5_translation_receipt').length) { lost = true; throw new Error('Injected lost response after commit'); }
    return result;
  };
  await assert.rejects(f.run(), /lost response/);
  const project = f.store.list('mt5_project')[0]; assert.ok(project); const count = f.records.size;
  f.store.update('mt5_project', project.id, { revision: 7, title: 'Later user revision' }); await rm(f.workspace, { recursive: true });
  f.host.artifacts.read = () => { throw new Error('A committed retry must not reread artifacts'); };
  const recovered = await f.run(); assert.equal(recovered.project_id, project.id); assert.equal(recovered.manifest.reused, true);
  assert.equal(f.records.size, count); assert.equal(f.store.get('mt5_project', project.id).revision, 7);
});

test('different concurrent first-read contents cannot replace the winning snapshot under one operation', async t => {
  const f = await fixture(t), open = fs.open.bind(fs); let first = true, ready, release;
  const readCompleted = new Promise(resolve => { ready = resolve; }), gate = new Promise(resolve => { release = resolve; });
  t.mock.method(fs, 'open', async (path, ...args) => {
    const handle = await open(path, ...args);
    if (path === f.path && first) {
      first = false; const close = handle.close.bind(handle);
      handle.close = async () => { await close(); ready(); await gate; };
    }
    return handle;
  });
  const old = f.run(); await readCompleted;
  const changed = { ...f.manifest, title: 'Concurrent winner' }; await f.write(changed);
  const winner = await f.run(); release();
  await assert.rejects(old, { code: 'idempotency_conflict' });
  assert.equal(winner.manifest.digest, digest(changed)); assert.equal(f.store.list('mt5_project').length, 1);
});

test('simultaneous different paths conflict and receipt-write failure rolls the project back', async t => {
  const f = await fixture(t); await writeFile(join(f.workspace, 'other.json'), JSON.stringify({ ...f.manifest, title: 'Other file' }));
  const results = await Promise.allSettled([f.run(), f.run({ ...f.args, manifest_path: 'other.json' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'idempotency_conflict');
  const next = { ...f.args, operation_id: 'receipt_failure_operation_01' }, put = f.host.storage.put; let failed = false;
  f.host.storage.put = (kind, value) => { if (kind === 'mt5_translation_receipt' && !failed) { failed = true; throw new Error('Receipt storage unavailable'); } return put(kind, value); };
  await assert.rejects(f.run(next), /Receipt storage/); assert.equal(f.store.list('mt5_project').length, 1);
  const recovered = await f.run(next); assert.ok(recovered.translation); assert.equal(f.store.list('mt5_project').length, 2);
});

test('partial publication and unknown artifact response reuse fixed operation refs, even if compiler availability changes', async t => {
  const f = await fixture(t), publish = f.host.artifacts.publish.bind(f.host.artifacts); let failed = false;
  f.host.artifacts.publish = input => {
    const result = publish(input);
    if (!failed && input.manifest.kind === 'strategy.translation') { failed = true; throw new Error('Lost translation publication result'); }
    return result;
  };
  await assert.rejects(f.run(), /Lost translation/); const translation = [...f.records.values()].find(record => record.ref.kind === 'strategy.translation').ref;
  await rm(f.workspace, { recursive: true });
  const result = await registerTranslationFile(f.host, { status: () => ({ compile: true }) }, f.args);
  assert.deepEqual(result.translation, translation); assert.equal(f.store.list('mt5_project').length, 1);
  assert.equal([...f.records.values()].filter(record => record.ref.kind === 'strategy.translation').length, 1);
});

test('final transaction respects a receipt committed by another connection after the initial lookup', async t => {
  const f = await fixture(t), publish = f.host.artifacts.publish.bind(f.host.artifacts), operation = digest(f.args.operation_id).slice(7); let winner;
  f.host.artifacts.publish = input => {
    const ref = publish(input);
    if (input.manifest.kind === 'strategy.validation') {
      const start = f.store.requests.get(`translation-start-${operation}`).value;
      winner = { project_id: start.projectId, revision: 1, source: f.manifest.source, translation: input.manifest.content.translation, validation: ref, implementation: 'translated_unverified', limitations: input.manifest.content.limitations };
      // Controlled stand-in for a second connection completing then editing its
      // project while this call was between the initial lookup and final commit.
      f.store.put('mt5_project', { id: start.projectId, revision: 9, title: 'Newer committed edit' });
      f.store.put('mt5_translation_receipt', { id: operation, fingerprint: digest({ operation_id: f.args.operation_id, ...f.manifest }), result: winner });
    }
    return ref;
  };
  const result = await f.run(); assert.deepEqual(withoutManifest(result), winner);
  assert.equal(f.store.get('mt5_project', winner.project_id).revision, 9); assert.equal(f.store.get('mt5_project', winner.project_id).title, 'Newer committed edit');
});

test('shared strict schema rejects unknown, missing and incorrectly typed fields in both entry points', async t => {
  const f = await fixture(t);
  const invalid = [
    value => ({ ...value, unexpected: true }), value => ({ ...value, title: 1 }), value => ({ ...value, title: ' '.repeat(3) }),
    value => ({ ...value, source: { ...value.source, extra: 1 } }), value => ({ ...value, parameter_map: { instrument: { binding: 'instrument', extra: true } } }),
    value => ({ ...value, source_map: [{ ...value.source_map[0], generated: [{ path: 'Experts/Strategy.mq5', startLine: '1', endLine: 1 }] }] }),
    value => ({ ...value, source_map: Array.from({ length: 1001 }, () => value.source_map[0]) }),
    value => ({ ...value, adaptations: [{ code: 'x', nodes: [], status: 'equivalent', description: 'test', evidence: [], extra: 1 }] }),
    value => { delete value.adaptations; return value; },
  ];
  for (const [index, change] of invalid.entries()) {
    const body = change(clone(f.manifest)), operation_id = `invalid_schema_${index}_operation`;
    await f.write(body); await assert.rejects(f.run({ ...f.args, operation_id }), /schema|名称/);
    await assert.rejects(registerTranslation(f.host, f.mt5, { operation_id, ...body }), /schema|名称/);
  }
  await f.write({ ...f.manifest, operation_id: f.args.operation_id }); await assert.rejects(f.run(), /schema/);
  await assert.rejects(f.run({ ...f.args, source: f.manifest.source }), /operation_id/);
  assert.equal(f.store.list('mt5_translation_manifest').length, 0); assert.equal(f.store.list('mt5_project').length, 0);
});

test('file registration reuses all source, target, source-map, parameter and SDK path checks', async t => {
  const f = await fixture(t), invalid = [
    value => ({ ...value, source: { ...value.source, digest: `sha256:${'f'.repeat(64)}` } }),
    value => ({ ...value, target: value.source }), value => ({ ...value, source_map: [] }),
    value => ({ ...value, source_map: value.source_map.map(entry => ({ ...entry, generated: [{ path: 'Experts/Strategy.mq5', startLine: 1, endLine: 10000 }] })) }),
    value => ({ ...value, parameter_map: { ...value.parameter_map, threshold: { nativeInput: 'Product_Reserved' } } }),
    value => ({ ...value, files: { ...value.files, 'Include/Product/Trade.mqh': 'override' } }),
    value => ({ ...value, files: { ...value.files, 'Experts/../Strategy.mq5': 'escape' } }),
    value => ({ ...value, files: { ...value.files, 'strategy.json': '{}' } }),
    value => ({ ...value, adaptations: [{ code: 'x', nodes: ['not-a-node'], status: 'limited', description: 'invalid node', evidence: [] }] }),
  ];
  for (const [index, change] of invalid.entries()) {
    const body = change(clone(f.manifest)), operation_id = `invalid_semantics_${index}_operation`; await f.write(body);
    await assert.rejects(f.run({ ...f.args, operation_id }));
    await assert.rejects(registerTranslation(f.host, f.mt5, { ...body, operation_id: `${operation_id}_inline` }));
  }
  assert.equal(f.records.size, 2); assert.equal(f.store.list('mt5_project').length, 0);
});

test('intake rejects traversal, outside absolute files, symlinks, directories and special files', async t => {
  const f = await fixture(t), outside = join(f.directory, 'outside.json'); await writeFile(outside, JSON.stringify(f.manifest));
  await mkdir(join(f.workspace, 'nested')); await symlink(outside, join(f.workspace, 'link.json'));
  await symlink(f.directory, join(f.workspace, 'parent-link'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(f.path, join(f.workspace, 'inside-link.json'));
  const paths = ['../outside.json', outside, '.', 'nested', 'link.json', 'inside-link.json', 'parent-link/outside.json', 'nested/../../outside.json'];
  if (process.platform !== 'win32') { execFileSync('mkfifo', [join(f.workspace, 'pipe')]); paths.push('pipe'); }
  for (const [index, manifest_path] of paths.entries()) await assert.rejects(f.run({ operation_id: `rejected_path_${index}_operation`, manifest_path }));
  assert.equal(f.store.list('mt5_translation_manifest').length, 0);
  const result = await f.run({ ...f.args, manifest_path: f.path }); assert.ok(result.translation);
});

test('intake rejects a final-path symlink replacement during open', async t => {
  const f = await fixture(t), open = fs.open.bind(fs); let replaced = false;
  const outside = join(f.directory, 'outside.json'); await writeFile(outside, JSON.stringify(f.manifest));
  t.mock.method(fs, 'open', async (path, ...args) => {
    if (path === f.path && !replaced) { replaced = true; await rm(f.path); await symlink(outside, f.path); }
    return open(path, ...args);
  });
  await assert.rejects(f.run()); assert.equal(f.store.list('mt5_translation_manifest').length, 0);
});

test('invalid UTF-8/JSON and raw, string-byte or total project limits fail before publication', async t => {
  const f = await fixture(t);
  for (const bytes of [Buffer.from([0xff]), Buffer.from('{broken')]) { await writeFile(f.path, bytes); await assert.rejects(f.run(), /UTF-8 JSON/); }
  await truncate(f.path, MAX_TRANSLATION_MANIFEST_BYTES + 1); await assert.rejects(f.run(), /8 MiB/);
  const large = clone(f.manifest); large.files['Experts/Strategy.mq5'] = '界'.repeat(400000); await f.write(large);
  await assert.rejects(f.run(), /大小/);
  const total = clone(f.manifest); for (let index = 0; index < 5; index++) total.files[`Include/Strategy/Test${index}.mqh`] = 'x'.repeat(1000000);
  await f.write(total); await assert.rejects(f.run({ ...f.args, operation_id: 'total_limit_operation_01' }), /大小/);
  assert.equal(f.records.size, 2); assert.equal(f.store.list('mt5_project').length, 0);
});

test('cancellation before intake leaves no snapshot; persisted-snapshot corruption is never silently accepted', async t => {
  const f = await fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(registerTranslationFile(f.host, f.mt5, f.args, controller.signal), { name: 'AbortError' }); assert.equal(f.store.list('mt5_translation_manifest').length, 0);
  await f.run(); const row = f.store.list('mt5_translation_manifest')[0]; row.manifest.title = 'corruption'; f.store.put('mt5_translation_manifest', row);
  await assert.rejects(f.run(), { code: 'translation_snapshot_corrupt' });
});

test('manifest and static tool definitions expose the short entry without changing the inline schema', async t => {
  const f = await fixture(t), root = new URL('../packages/mt5/', import.meta.url), definition = JSON.parse(await readFile(new URL('plugin.json', root))), tools = JSON.parse(await readFile(new URL('tools.json', root)));
  assert.equal(definition.version, '1.1.9'); assert.ok(definition.tool_names.includes('mt5_translation_file')); assert.ok(definition.resources.includes('target/translation-file.md'));
  for (const tool of createTools(f.host, f.mt5)) assert.deepEqual(JSON.parse(JSON.stringify({ ...tool, execute: undefined })), tools.find(item => item.name === tool.name));
});
