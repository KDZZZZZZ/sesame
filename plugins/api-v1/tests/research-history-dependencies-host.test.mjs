// Real API2 data_read -> host process snapshot -> research_register -> history.
// Only synthetic fixed inputs, an isolated Store and an uncalled fixture model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildLock } from '../scripts/plugin-lock.mjs';

const hostRoot = process.env.SESAME_HOST_ROOT;
const receipts = process.env.SESAME_RESEARCH_DEPENDENCY_RECEIPT_DIR;
const core = fileURLToPath(new URL('../', import.meta.url));
const optional = fileURLToPath(new URL('../../optional-api-v1/packages/', import.meta.url));

test('research_register publishes verified direct inputs usable by historical_evidence_from_ref without provenance relabelling', { skip: !hostRoot, timeout: 90000 }, async () => {
  const load = path => import(pathToFileURL(join(hostRoot, path)).href);
  for (const key of Object.keys(process.env)) if (/^(MT5AGENT_|SESAME_)/.test(key)) delete process.env[key];
  process.env.SESAME_OFFICIAL_PLUGINS_REQUIRED = '1';
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sesame-research-history-')));
  let runtime, store, host, models, modelCalls = 0, networkCalls = 0;
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => { networkCalls++; throw Error('Network prohibited in synthetic dependency test'); };
  const close = async () => { await runtime?.close(); runtime = null; store?.close(); store = null; };
  try {
    // A small real official bundle avoids reading any daily bundle/configuration
    // or concurrently edited unrelated Report products.
    const stage = join(root, 'stage'), bundle = join(root, 'bundle');
    await mkdir(join(stage, 'packages'), { recursive: true }); await mkdir(bundle);
    for (const name of ['workspace', 'data-access']) await cp(join(core, 'packages', name), join(stage, 'packages', name), { recursive: true });
    const lock = buildLock(stage);
    for (const item of lock.packages) await cp(join(stage, 'packages', item.directory), join(bundle, item.directory), { recursive: true });
    await writeFile(join(bundle, 'official-plugins.lock.json'), JSON.stringify(lock, null, 2) + '\n');
    const [{ Store }, { Runtime }, { ModelRuntime }, { createHostContextV2 }] = await Promise.all([
      load('modules/agent/store.js'), load('modules/agent/runtime.js'), load('node_modules/@earendil-works/pi-coding-agent/dist/index.js'), load('modules/plugins/host-v2/context.js'),
    ]);
    models = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), refreshOnCreate: false });
    models.registerProvider('unused-fixture', { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'synthetic-never-called', models: [{ id: 'unused', name: 'Uncalled fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
    const open = async () => {
      store = new Store(join(root, 'state'));
      runtime = await new Runtime(store, { officialPluginsDirectory: bundle, piDir: join(root, 'pi'), modelRuntime: models, model: models.getModel('unused-fixture', 'unused') }).init();
      runtime.modelTransport.fetch = async () => { modelCalls++; throw Error('Models prohibited'); };
      host = createHostContextV2(runtime, runtime.capabilities.hostEntry, 'conv_main');
    };
    await open();
    const invoke = async (id, input) => { const result = await host.capabilities.invoke(id, input); assert.equal(result.type, 'result'); return result.value; };
    const workspace = runtime.workspaces.root('conv_main'); await mkdir(workspace, { recursive: true });
    const draft = join(workspace, 'history-draft'); await cp(join(optional, 'historical-evidence'), draft, { recursive: true });
    const checked = await runtime.plugins.manager.test('conv_main', { path: draft }); assert.equal(checked.passed, true, JSON.stringify(checked));
    const installed = await runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest }); assert.equal(installed.runtime_status, 'ready');
    const publish = async (name, rows, dependencies = []) => {
      const raw = await host.resources.create({ kind: 'file', name: name + '.json', lifetime: 'durable', source: { content: JSON.stringify(rows) } }, { operationId: 'source-' + name });
      return (await host.resources.publish(raw, { kind: 'data', schemaVersion: '1.0.0', dependencies,
        content: { format: 'json-rows', path: 'rows.json', rowCount: rows.length, columns: Object.keys(rows[0] ?? {}), provenance: { kind: 'demo', description: 'Synthetic software fixture; not observed market or ex-ante prediction evidence.' } },
        blobs: [{ path: 'rows.json', mediaType: 'application/json' }] }, { operationId: 'publish-' + name })).ref;
    };
    const refs = {};
    for (const role of ['plan', 'source', 'prediction', 'code', 'replay-data']) refs[role] = await publish(role, [{ synthetic: true, role }]);
    const input = JSON.parse(await readFile(join(optional, 'historical-evidence/examples/calibration-replay.json'), 'utf8'));
    input.plan.ref = refs.plan; input.source_refs = [refs.source];
    for (const row of input.records) { row.prediction_ref = refs.prediction; row.replay.code_ref = refs.code; row.replay.data_refs = [refs['replay-data']]; }
    const envelope = await publish('input-envelope', [input], Object.values(refs));
    const inputRefs = [envelope, ...Object.values(refs)];
    const inputs = [];
    for (const ref of inputRefs) inputs.push(await invoke('sesame/data-access#data_read', { ref, directory: 'calculation' }));
    const recipe = `import { readFileSync, writeFileSync } from 'node:fs';\nconst paths = ${JSON.stringify(inputs.map(item => 'inputs/' + item.path.split(/[\\/]/).at(-1)))};\nconst all = paths.map(path => JSON.parse(readFileSync(path, 'utf8')));\nif (all.slice(1).some(rows => rows[0].synthetic !== true)) throw Error('Expected only synthetic source inputs');\nwriteFileSync('output.json', JSON.stringify(all[0]));\n`;
    await invoke('sesame/workspace#write', { path: 'calculation/reproduce.mjs', content: recipe });
    const execution = await invoke('sesame/workspace#host_files_run', { argv: [process.execPath, 'reproduce.mjs'], cwd: join(workspace, 'calculation'), timeout: 30 });
    assert.equal(execution.exitCode, 0); assert.ok(execution.executionId); assert.deepEqual(execution.snapshotErrors ?? [], []);
    const args = { operationId: 'registered-history-envelope', executionId: execution.executionId, path: 'output.json', title: 'Synthetic historical replay envelope', description: 'Identity transformation for API interoperability; numerical replay remains hypothetical.', recipePaths: ['reproduce.mjs'], inputRefs: [...inputRefs, structuredClone(refs.plan)] };
    const registered = await invoke('sesame/data-access#research_register', args);
    const manifest = await host.resources.read(registered.ref, { part: 'manifest' });
    const metadata = await host.resources.read(registered.ref, { part: 'metadata' });
    const evidenceManifest = await host.resources.read(registered.evidence, { part: 'manifest' });
    assert.equal(metadata.producer.id, 'sesame/data-access'); assert.equal(metadata.producer.version, '3.0.4');
    assert.equal(manifest.content.provenance.kind, 'demo'); assert.deepEqual(registered.provenance.references, [registered.evidence]);
    assert.deepEqual(manifest.dependencies, [registered.evidence, ...inputRefs]);
    assert.deepEqual(evidenceManifest.dependencies, args.inputRefs, 'original evidence references stay intact, including duplicates');
    const output = await host.resources.read(registered.ref, { part: 'content', entry: 'rows.json', encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output.content), [input]);
    const direct = await invoke('sesame/historical-evidence#historical_evidence_calibrate', input);
    const delivery = await invoke('sesame/historical-evidence#historical_evidence_from_ref', { operation: 'calibrate', input_ref: registered.ref });
    const resultManifest = await host.resources.read(delivery.result_ref, { part: 'manifest' });
    assert.deepEqual(resultManifest.dependencies, [registered.ref, ...manifest.dependencies]);
    for (const dependency of resultManifest.dependencies) assert.deepEqual((await host.resources.read(dependency, { part: 'metadata' })).ref, dependency);
    const resultBytes = await host.resources.read(delivery.result_ref, { part: 'content', entry: delivery.result_data.path, encoding: 'utf8' });
    assert.equal(resultBytes.nextOffset, undefined);
    const fromRef = JSON.parse(resultBytes.content)[0];
    assert.equal(fromRef.input_digest, direct.input_digest); assert.equal(fromRef.input_producer, 'sesame/data-access');
    assert.equal(fromRef.status, 'exploratory'); assert.equal(fromRef.prediction_origin, 'historical_replay');
    assert.equal(fromRef.current_predictions[0].calibrated_probability, null);
    assert.equal(fromRef.groups[0].evaluation.metrics_on_common_scored_rows.calibrated_brier, .14453125);
    assert.equal(fromRef.input_integrity.manifest_digest_verified, true); assert.equal(fromRef.input_integrity.content_digest_verified, true);
    // A row claiming a source never promotes it automatically. The omitted
    // exact code ref is still transitive through the envelope, which is not enough.
    const omitted = await invoke('sesame/data-access#research_register', { ...args, operationId: 'missing-explicit-code', inputRefs: inputRefs.filter(ref => ref.id !== refs.code.id) });
    await assert.rejects(invoke('sesame/historical-evidence#historical_evidence_from_ref', { operation: 'calibrate', input_ref: omitted.ref }), /dependenc/i);
    await assert.rejects(invoke('sesame/data-access#research_register', { ...args, operationId: 'forged-source', inputRefs: [{ ...refs.code, digest: 'sha256:' + '0'.repeat(64) }] }), /revision|reference|found|digest/i);
    const unexecuted = await publish('never-in-execution', [{ synthetic: true, role: 'absent' }]);
    await assert.rejects(invoke('sesame/data-access#research_register', { ...args, operationId: 'unexecuted-input', inputRefs: [unexecuted] }), /exact fixed input bytes/);
    assert.deepEqual(await invoke('sesame/data-access#research_register', args), registered);
    await close(); await open();
    assert.deepEqual(await invoke('sesame/data-access#research_register', args), registered);
    const reopened = await invoke('sesame/historical-evidence#historical_evidence_from_ref', { operation: 'calibrate', input_ref: registered.ref });
    assert.deepEqual(reopened, delivery, 'resource operation receipts recover the exact fixed result after a real isolated host restart');
    assert.deepEqual(JSON.parse((await host.resources.read(reopened.result_ref, { part: 'content', entry: reopened.result_data.path, encoding: 'utf8' })).content)[0], fromRef);
    assert.equal(networkCalls, 0); assert.equal(modelCalls, 0);
    if (receipts) {
      await mkdir(receipts, { recursive: true });
      await writeFile(join(receipts, 'host-receipt.json'), JSON.stringify({ status: 'passed', checkedAt: new Date().toISOString(), dataAccessVersion: '3.0.4', historyVersion: installed.version, modelCalls, networkCalls,
        executionId: execution.executionId, registered, inputRefs, directDependencies: manifest.dependencies, sourceProvenance: manifest.content.provenance,
        verified: ['real API2 install and public capabilities', 'real Node process and host-frozen input/output bytes', 'all five historical ref roles directly pinned', 'duplicate full refs deduplicated only in data edges', 'original row/evidence inputs retained', 'from_ref actual calibration matches inline', 'replay remains exploratory with no current probability', 'transitive-only code reference rejected', 'forged and unexecuted inputs rejected', 'same operation returns same immutable result before and after isolated restart'],
        result: { resultRef: delivery.result_ref, resultDependencies: resultManifest.dependencies, inputDigest: fromRef.input_digest, inputIntegrity: fromRef.input_integrity, status: fromRef.status, calibratedBrier: .14453125, currentProbability: null } }, null, 2) + '\n');
    }
  } finally { await close(); globalThis.fetch = fetch; await rm(root, { recursive: true, force: true }); }
});
