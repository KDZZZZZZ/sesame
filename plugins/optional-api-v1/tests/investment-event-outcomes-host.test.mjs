// Real API2 installation and capability invocation. Synthetic fixed data, no model or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hostRoot = process.env.SESAME_HOST_ROOT;
const receiptDirectory = process.env.SESAME_EVENT_OUTCOMES_RECEIPT_DIR;
const packageRoot = fileURLToPath(new URL('../packages/investment-research/', import.meta.url));
test('installed event outcomes reads exact refs and publishes deterministic dependent evidence with no model', { skip: !hostRoot, timeout: 60000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)).href);
  for (const key of Object.keys(process.env)) if (/^(MT5AGENT_|SESAME_)/.test(key)) delete process.env[key];
  process.env.SESAME_OFFICIAL_PLUGINS_REQUIRED = '1';
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sesame-event-outcomes-')));
  let runtime, store, modelCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Network prohibited in fixed-event fixture'); };
  try {
    const [{ Store }, { Runtime }, { ModelRuntime }, { createHostContextV2 }] = await Promise.all([
      load('modules/agent/store.js'), load('modules/agent/runtime.js'), load('node_modules/@earendil-works/pi-coding-agent/dist/index.js'), load('modules/plugins/host-v2/context.js'),
    ]);
    const models = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), refreshOnCreate: false });
    models.registerProvider('unused-fixture', { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'never-called', models: [{ id: 'unused', name: 'Never called', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
    store = new Store(join(root, 'state'));
    runtime = await new Runtime(store, { officialPluginsDirectory: join(hostRoot, 'build/official-plugins'), piDir: join(root, 'pi'), modelRuntime: models, model: models.getModel('unused-fixture', 'unused') }).init();
    runtime.modelTransport.fetch = async () => { modelCalls++; throw new Error('Models prohibited'); };
    const workspace = runtime.workspaces.root('conv_main'), draft = join(workspace, 'event-outcomes-draft');
    await mkdir(workspace, { recursive: true }); await cp(packageRoot, draft, { recursive: true });
    const verified = await runtime.plugins.manager.test('conv_main', { path: draft });
    assert.equal(verified.passed, true, JSON.stringify(verified));
    const installed = await runtime.plugins.manager.install('conv_main', { path: draft, digest: verified.digest });
    assert.equal(installed.runtime_status, 'ready', JSON.stringify(installed.diagnostics));
    const host = createHostContextV2(runtime, runtime.capabilities.hostEntry, 'conv_main');
    const source = async (id, rows) => runtime.contractArtifacts.publish({ id: 'fixture/event-outcomes', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` }, {
      operationId: id, manifest: { kind: 'data', schemaVersion: '1.0.0', dependencies: [],
        content: { format: 'json-rows', path: 'rows.json', rowCount: rows.length, columns: Object.keys(rows[0] ?? {}), provenance: { kind: 'demo', source_kind: 'synthetic', description: 'Software fixture only; not market evidence', retrieved_at: '2026-10-28T12:00:00Z' } },
        blobs: [{ ...runtime.contractArtifacts.blob(JSON.stringify(rows)), path: 'rows.json', mediaType: 'application/json' }],
      },
    });
    const events = [{ event_id: 'fictional-old-event', instrument: 'SYNTHETIC', event_at: '2026-01-01T00:00:00Z', published_at: '2026-01-01T00:00:00Z' }];
    const prices = [{ instrument: 'SYNTHETIC', observed_at: '2026-01-01T00:00:00Z', close: 100, unit: 'USD' }, { instrument: 'SYNTHETIC', observed_at: '2026-01-02T00:00:00Z', close: 105, unit: 'USD' }];
    const input = { events_ref: await source('events', events), market_ref: await source('prices', prices), selection: 'One fictional software test event; not a historical market search', price_basis: 'Invented unadjusted close in USD', price_time_semantics: 'closed_bar_close', as_of: '2026-10-28T12:00:00Z', anchor: 'event_at', entry: 'last_at_or_before', tolerance_seconds: 0, windows: [{ id: 'day', seconds: 86400 }], baseline: { kind: 'none' } };
    const invoke = async value => {
      const response = await host.capabilities.invoke('sesame/investment-research#investment_research_event_outcomes', value);
      assert.equal(response.type, 'result'); return response.value;
    };
    const result = await invoke(input), repeat = await invoke(input);
    assert.equal(result.status, 'complete'); assert.equal(result.counts.events, 1);
    const artifact = runtime.contractArtifacts.read(result.result_ref), packet = runtime.contractArtifacts.data(result.result_ref).rows[0];
    assert.deepEqual(packet, runtime.contractArtifacts.data(repeat.result_ref).rows[0]);
    assert.deepEqual(artifact.manifest.dependencies, [input.events_ref, input.market_ref]);
    assert.equal(artifact.manifest.content.provenance.kind, 'demo');
    const metadata = await host.resources.read(result.result_ref, { part: 'metadata' });
    assert.equal(metadata.producer.id, 'sesame/investment-research');
    assert.equal(packet.rows[0].availability.first_available_at, null);
    assert.equal(packet.rows[0].availability.retrieved_at, '2026-10-28T12:00:00.000Z');
    assert.equal(packet.rows[0].availability.eligible_for_point_in_time_validation, false);
    assert.ok(Math.abs(packet.rows[0].return_fraction - .05) < 1e-12);
    await assert.rejects(() => invoke({ ...input, events_ref: { ...input.events_ref, digest: `sha256:${'0'.repeat(64)}` } }), /digest|reference|artifact|revision|mismatch/i);
    await assert.rejects(() => invoke({ ...input, events_ref: { id: 'mutable-dataset' } }), /schema|valid|digest|required|reference/i);
    assert.equal(modelCalls, 0);
    if (receiptDirectory) {
      await mkdir(receiptDirectory, { recursive: true });
      const save = (name, value) => writeFile(join(receiptDirectory, name), JSON.stringify(value, null, 2) + '\n');
      await save('host-receipt.json', { status: 'passed', checkedAt: new Date().toISOString(), plugin: { id: installed.id, version: '3.2.0', digest: verified.digest, runtimeStatus: installed.runtime_status }, modelCalls, network: 'prohibited', data: 'explicit synthetic fixture', checks: ['real package checks and API2 install', 'real native capability invocation', 'exact input refs and source dependencies', 'actual investment-research producer', 'demo lineage retained', 'same inputs produce identical packets', 'old published event does not acquire historical availability', 'modified digest and incomplete refs rejected'], result, input });
      await save('event-outcomes.packet.json', packet); await save('event-outcomes.manifest.json', artifact.manifest);
    }
    t.diagnostic('Real API2 installation; source refs and producer verified; repeated deterministic packet; invalid refs rejected; no model or network.');
  } finally { await runtime?.close(); store?.close(); globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); }
});
