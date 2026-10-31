// Actual API2 install/invoke and fixed artifact reads; isolated Store, no model/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hostRoot = process.env.SESAME_HOST_ROOT;
const receipts = process.env.SESAME_HISTORICAL_EVIDENCE_RECEIPT_DIR;
const packageRoot = fileURLToPath(new URL('../packages/historical-evidence/', import.meta.url));
test('installed history capabilities compute inline and exact fixed refs while preserving dependency/permission boundaries', { skip: !hostRoot, timeout: 60000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)).href);
  for (const key of Object.keys(process.env)) if (/^(MT5AGENT_|SESAME_)/.test(key)) delete process.env[key];
  process.env.SESAME_OFFICIAL_PLUGINS_REQUIRED = '1';
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sesame-historical-evidence-')));
  let runtime, store, modelCalls = 0, networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkCalls++; throw new Error('Network prohibited'); };
  try {
    const [{ Store }, { Runtime }, { ModelRuntime }, { createHostContextV2 }, { toolResult }] = await Promise.all([
      load('modules/agent/store.js'), load('modules/agent/runtime.js'), load('node_modules/@earendil-works/pi-coding-agent/dist/index.js'), load('modules/plugins/host-v2/context.js'), load('modules/agent/tools.js'),
    ]);
    const models = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), refreshOnCreate: false });
    models.registerProvider('unused-fixture', { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'never-called', models: [{ id: 'unused', name: 'Never called', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
    store = new Store(join(root, 'state'));
    runtime = await new Runtime(store, { officialPluginsDirectory: join(hostRoot, 'build/official-plugins'), piDir: join(root, 'pi'), modelRuntime: models, model: models.getModel('unused-fixture', 'unused') }).init();
    runtime.modelTransport.fetch = async () => { modelCalls++; throw new Error('Models prohibited'); };
    const workspace = runtime.workspaces.root('conv_main'); await mkdir(workspace, { recursive: true });
    const installed = [];
    for (const name of ['historical-evidence', 'investment-research']) {
      const draft = join(workspace, name + '-draft'); await cp(fileURLToPath(new URL(`../packages/${name}/`, import.meta.url)), draft, { recursive: true });
      const verified = await runtime.plugins.manager.test('conv_main', { path: draft });
      assert.equal(verified.passed, true, JSON.stringify(verified));
      const result = await runtime.plugins.manager.install('conv_main', { path: draft, digest: verified.digest });
      assert.equal(result.runtime_status, 'ready', JSON.stringify(result.diagnostics));
      installed.push({ id: result.id, digest: verified.digest, runtimeStatus: result.runtime_status });
    }
    const host = createHostContextV2(runtime, runtime.capabilities.hostEntry, 'conv_main');
    const publish = (id, rows, dependencies = [], kind = 'demo') => runtime.contractArtifacts.publish({ id: 'fixture/historical-evidence', version: '1.0.0', digest: 'sha256:' + 'b'.repeat(64) }, {
      operationId: id, manifest: { kind: 'data', schemaVersion: '1.0.0', dependencies,
        content: { format: 'json-rows', path: 'rows.json', rowCount: rows.length, columns: Object.keys(rows[0] ?? {}), provenance: { kind, source_kind: 'synthetic', description: 'Explicit software fixture; not market data or certified prediction history.' } },
        blobs: [{ ...runtime.contractArtifacts.blob(JSON.stringify(rows)), path: 'rows.json', mediaType: 'application/json' }] } });
    const provenance = publish('original-fixture-source', [{ synthetic: true }]);
    const invoke = async (name, input) => {
      const result = await host.capabilities.invoke('sesame/historical-evidence#' + name, input);
      assert.equal(result.type, 'result'); return result.value;
    };
    const readResult = async (delivery, expectedProvenance = 'demo') => {
      const manifest = await host.resources.read(delivery.result_ref, { part: 'manifest' });
      const metadata = await host.resources.read(delivery.result_ref, { part: 'metadata' });
      assert.equal(metadata.producer.id, 'sesame/historical-evidence'); assert.equal(metadata.producer.version, '1.1.2');
      assert.equal(manifest.content.format, 'json-rows'); assert.equal(manifest.content.rowCount, 1);
      assert.equal(manifest.content.provenance.kind, expectedProvenance);
      assert.deepEqual(manifest.dependencies[0], delivery.input_ref);
      for (const dependency of manifest.dependencies) assert.deepEqual((await host.resources.read(dependency, { part: 'metadata' })).ref, dependency);
      const chunks = []; let offset = 0;
      for (;;) {
        const page = await host.resources.read(delivery.result_ref, { part: 'content', entry: delivery.result_data.path, encoding: 'base64', offset, length: 4096 });
        assert.deepEqual(page.ref, delivery.result_ref); assert.equal(page.offset, offset);
        const chunk = Buffer.from(page.content, 'base64'); assert.equal(chunk.length, page.length);
        chunks.push(chunk); offset += chunk.length;
        if (page.nextOffset === undefined) break;
        assert.equal(page.nextOffset, offset);
      }
      const bytes = Buffer.concat(chunks);
      assert.equal(bytes.length, delivery.result_data.content_bytes);
      assert.equal('sha256:' + createHash('sha256').update(bytes).digest('hex'), delivery.result_data.content_digest);
      assert.equal(manifest.blobs[0].digest, delivery.result_data.content_digest);
      const rows = JSON.parse(bytes); assert.equal(rows.length, 1);
      return rows[0];
    };
    const results = [];
    for (const [name, capability] of [['match', 'historical_evidence_match'], ['match-replay', 'historical_evidence_match'], ['calibration', 'historical_evidence_calibrate'], ['calibration-replay', 'historical_evidence_calibrate']]) {
      const input = JSON.parse(await readFile(join(packageRoot, 'examples', name + '.json'), 'utf8'));
      input.source_refs = [provenance]; input.plan.ref = provenance;
      const dependencies = [provenance];
      if (input.replay) {
        input.replay.code_ref = publish('match-replay-code', [{ synthetic: true, purpose: 'Fixed synthetic replay recipe; no original historical publication claim.' }]);
        input.replay.data_refs = [publish('match-replay-data', [{ synthetic: true, purpose: 'Fixed synthetic input snapshot.' }])];
        dependencies.push(input.replay.code_ref, ...input.replay.data_refs);
      }
      for (const row of input.records ?? []) { row.prediction_ref = provenance; if (row.replay) { row.replay.code_ref = provenance; row.replay.data_refs = [provenance]; } }
      const direct = await invoke(capability, input);
      const inputRef = publish(name + '-input', [input], dependencies);
      const args = { operation: name.startsWith('match') ? 'match' : 'calibrate', input_ref: inputRef };
      const delivery = await invoke('historical_evidence_from_ref', args), fromRef = await readResult(delivery);
      assert.equal(JSON.parse(toolResult(delivery).content[0].text)._tool_output_truncated, undefined);
      assert.deepEqual(await invoke('historical_evidence_from_ref', args), delivery);
      for (const [key, value] of Object.entries(direct)) if (!['source_refs', 'data_access'].includes(key)) assert.deepEqual(fromRef[key], value, 'complete numerical field: ' + key);
      assert.equal(direct.input_digest, fromRef.input_digest);
      assert.equal(fromRef.input_producer, 'fixture/historical-evidence');
      assert.equal(fromRef.source_provenance.kind, 'demo');
      assert.deepEqual(fromRef.input_ref, inputRef);
      assert.equal(fromRef.input_integrity.manifest_digest_verified, true);
      assert.equal(fromRef.input_integrity.content_digest_verified, true);
      assert.ok(fromRef.input_integrity.content_bytes > 0);
      assert.ok(fromRef.source_refs.some(ref => ref.digest === inputRef.digest));
      assert.ok(fromRef.source_refs.some(ref => ref.digest === provenance.digest));
      if (name.startsWith('match')) {
        assert.deepEqual(direct.cohorts, fromRef.cohorts); assert.equal(fromRef.selection.cohort, 'same_instrument_history');
        if (input.replay) {
          assert.equal(fromRef.observation_origin, 'historical_replay'); assert.equal(fromRef.forecast_probability, null);
          assert.equal(fromRef.clock.plan_frozen_at, '2026-10-29T00:00:00.000Z'); assert.equal(fromRef.decision_at, '2026-01-01T00:00:00.000Z');
          for (const omitted of [input.replay.code_ref, ...input.replay.data_refs]) {
            const missing = publish('match-replay-missing-' + omitted.id, [input], dependencies.filter(ref => ref.id !== omitted.id));
            await assert.rejects(() => invoke('historical_evidence_from_ref', { operation: 'match', input_ref: missing }), /replay code\/data refs/);
          }
        }
      }
      else if (name === 'calibration') {
        assert.deepEqual(direct.current_predictions, fromRef.current_predictions); assert.equal(fromRef.current_predictions[0].calibrated_probability, .5);
        const limitedInput = structuredClone(input); limitedInput.plan.minimum_evaluation = 100;
        const limited = await invoke(capability, limitedInput);
        assert.equal(limited.current_predictions[0].status, 'limited'); assert.equal(limited.current_predictions[0].calibrated_probability, .5);
        limitedInput.plan.sample_policy = { mode: 'required', source: 'user', reason: 'Synthetic explicit user requirement.' };
        const required = await invoke(capability, limitedInput);
        assert.equal(required.current_predictions[0].calibrated_probability, null);
        assert.equal(required.groups[0].evaluation.metrics_on_common_scored_rows.n, 4);
        assert.equal(required.parameters.sample_policy.mode, 'required');
        limitedInput.plan.sample_policy.source = 'agent';
        await assert.rejects(() => invoke(capability, limitedInput), /explicit user requirement/);
      }
      else {
        assert.equal(fromRef.prediction_origin, 'historical_replay'); assert.equal(fromRef.status, 'exploratory');
        assert.equal(fromRef.groups[0].fit.n, 4); assert.equal(fromRef.groups[0].evaluation.n, 4);
        assert.equal(fromRef.current_predictions[0].calibrated_probability, null);
        assert.equal(fromRef.groups[0].evaluation.metrics_on_common_scored_rows.calibrated_brier, .14453125);
        assert.match(fromRef.evaluation_basis, /chronological_replay_split_only/);
      }
      const noDependencies = publish(name + '-without-dependencies', [input]);
      await assert.rejects(() => invoke('historical_evidence_from_ref', { operation: name.startsWith('match') ? 'match' : 'calibrate', input_ref: noDependencies }), /dependenc/i);
      await assert.rejects(() => invoke('historical_evidence_from_ref', { operation: 'match', input_ref: { ...inputRef, digest: 'sha256:' + '0'.repeat(64) } }), /digest|mismatch|artifact|reference/i);
      results.push({ operation: name, inputRef, delivery });
    }
    // More detail than the actual Agent tool preview can carry; no model call.
    const large = JSON.parse(await readFile(join(packageRoot, 'examples/match.json'), 'utf8'));
    large.source_refs = [provenance]; large.plan.ref = provenance; large.plan.matching.max_matches = 500;
    const originalCase = large.cases[0];
    large.cases = Array.from({ length: 300 }, (_, i) => {
      const at = new Date(Date.UTC(2025, 0, 2) + i * 86400000).toISOString(), end = new Date(Date.parse(at) + 86400000).toISOString();
      return { ...structuredClone(originalCase), id: 'large-fixture-' + i, at, regime_available_at: at,
        features: { custom_feature: { value: 1, available_at: at }, custom_state: { value: 'expansion', available_at: at } },
        outcome: { ...originalCase.outcome, label: i % 2, end_at: end, available_at: end } };
    });
    const largeDirect = await invoke('historical_evidence_match', large);
    assert.equal(JSON.parse(toolResult(largeDirect).content[0].text)._tool_output_truncated, true);
    const largeRef = publish('large-detail-input', [large], [provenance]);
    const largeArgs = { operation: 'match', input_ref: largeRef, operation_id: 'large-same-operation' };
    const [largeDelivery, concurrent] = await Promise.all([invoke('historical_evidence_from_ref', largeArgs), invoke('historical_evidence_from_ref', largeArgs)]);
    assert.deepEqual(largeDelivery, concurrent);
    const modelPreview = JSON.parse(toolResult(largeDelivery).content[0].text);
    assert.equal(modelPreview._tool_output_truncated, undefined);
    assert.deepEqual(modelPreview.result_ref, largeDelivery.result_ref);
    assert.ok(Buffer.byteLength(JSON.stringify(largeDelivery)) < 8192);
    const largeComplete = await readResult(largeDelivery);
    assert.deepEqual(largeComplete.cohorts, largeDirect.cohorts); assert.equal(largeComplete.n_input, 300);
    let lostAck;
    await assert.rejects(async () => { lostAck = await invoke('historical_evidence_from_ref', largeArgs); throw Error('Fixture caller lost its acknowledgement'); }, /lost its acknowledgement/);
    assert.deepEqual(await invoke('historical_evidence_from_ref', largeArgs), lostAck);
    await assert.rejects(invoke('historical_evidence_from_ref', { ...largeArgs, input_ref: results[0].inputRef }), /operationId.*different input/i);
    const independent = await invoke('historical_evidence_from_ref', { ...largeArgs, operation_id: 'large-independent-operation' });
    assert.notEqual(independent.result_ref.id, largeDelivery.result_ref.id);
    assert.equal(independent.result_data.content_digest, largeDelivery.result_data.content_digest);
    const derivedEnvelope = publish('derived-envelope-with-demo-dependency', [large], [provenance], 'derived');
    await readResult(await invoke('historical_evidence_from_ref', { operation: 'match', input_ref: derivedEnvelope }), 'demo');
    const authorInput = publish('user-provided-contract-fixture', [{ synthetic: true }], [], 'user_input');
    const nonDemoInput = structuredClone(large); nonDemoInput.source_refs = [authorInput]; nonDemoInput.plan.ref = authorInput;
    const nonDemoRef = publish('user-input-envelope', [nonDemoInput], [authorInput], 'user_input');
    await readResult(await invoke('historical_evidence_from_ref', { operation: 'match', input_ref: nonDemoRef }), 'derived');
    const declaration = JSON.parse(await readFile(join(packageRoot, 'capabilities.json'), 'utf8'));
    const research = await import('../packages/investment-research/src/composition.js');
    const syntheticDescriptors = declaration.capabilities.map(cap => ({ ...cap, id: 'sesame/historical-evidence#' + cap.id }));
    assert.ok(syntheticDescriptors.every(research.readOnly));
    assert.equal(research.readOnly({ ...syntheticDescriptors[0], id: 'unreviewed/plugin#calculation' }), false);
    assert.deepEqual(declaration.capabilities[2].effects, ['resources.read', 'resources.create', 'resources.publish']);
    assert.equal(declaration.capabilities[2].researchDataAccess, undefined);
    assert.equal(modelCalls, 0); assert.equal(networkCalls, 0);
    if (receipts) {
      await mkdir(receipts, { recursive: true });
      await writeFile(join(receipts, 'host-receipt.json'), JSON.stringify({ status: 'passed', checkedAt: new Date().toISOString(), installed, modelCalls, networkCalls,
        checks: ['real package validation and installation', 'all three actual capabilities invoked', 'exact input ref/producer/dependencies', 'manifest and content digest/size/page integrity verified', 'all complete inline fields unchanged in published result', 'large full result exceeds actual host tool preview but compact delivery retains readable result_ref', 'concurrent/repeated calls and lost caller acknowledgement recover the same fixed result', 'changed input with same operation ID rejected; explicit new operation has a distinct ref with identical content bytes', 'missing dependencies and forged digest rejected', 'advisory sample target yields limited estimate; user-required target blocks output without dropping diagnostics; Agent-required rejected', 'Research admits the fixed-result delivery without promoting it to input-only', 'unreviewed empty-effects tool remains rejected'],
        largeResult: { fullBytes: largeDelivery.result_data.content_bytes, previewBytes: Buffer.byteLength(JSON.stringify(largeDelivery)), fullPreviewTruncated: true, delivery: largeDelivery }, results }, null, 2) + '\n');
    }
    t.diagnostic('Actual API2 installation and all three capability invocations; exact refs and provenance; isolated runtime; no model or network.');
  } finally { await runtime?.close(); store?.close(); globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); }
});
