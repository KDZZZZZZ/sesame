import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.SESAME_HOST_ROOT;
test('decision tools use the real host inference port, persistent namespace and artifact publication', { skip: !root }, async t => {
  const load = path => import(pathToFileURL(join(root, path)));
  await load('modules/plugins/sdk-loader.js');
  const { Store } = await load('modules/agent/store.js'), { ContractArtifacts } = await load('modules/plugins/artifacts.js'), { createHostContext } = await load('modules/plugins/context.js');
  const { createDecisionTools, activateDecisions } = await import('../packages/strategy-authoring/lib/agent-decision-tools.js');
  const directory = mkdtempSync(join(tmpdir(), 'sesame-decisions-host-')), workspace = join(directory, 'work'); mkdirSync(workspace);
  const store = new Store(directory), api = new ContractArtifacts(store), entry = { id: 'sesame/strategy-authoring', version: '1.2.0', digest: `sha256:${'a'.repeat(64)}` };
  store.put('conversation', { id: 'main', scope: 'main' });
  const evidence = api.publish(entry, { operationId: 'demo-evidence', manifest: { kind: 'resource', schemaVersion: '1.0.0', content: { close: '65000' }, dependencies: [], blobs: [], provenance: { kind: 'demo', references: [] } } });
  const model = { provider: 'fixture', id: 'fixed', api: 'fixture', maxTokens: 4096 };
  let calls = 0;
  const runtime = { store, contractArtifacts: api, workspaces: { current: () => null, root: () => workspace, assertOpen: () => {}, owner: () => null },
    modelRuntime: { getModels: () => [model], getModel: () => model, hasConfiguredAuth: () => true },
    sessionModels: { async completeSimple(selected, context) { calls++; assert.equal(selected.id, 'fixed'); assert.equal(context.messages.length, 2); const input = JSON.parse(context.messages[1].content); assert.equal(input.inputs[0].content.close, '65000');
      return { provider: 'fixture', model: 'fixed', stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify({ direction: 'flat', reason: 'Fictional test observation', evidence: [evidence] }) }], usage: { input: 10, output: 10 } }; } }, plugins: { track() {} } };
  const host = createHostContext(runtime, entry, 'main', { box: { file: async (op, path, content) => { const full = join(workspace, path); assert.ok(full.startsWith(workspace + '/')); if (op === 'read') return readFileSync(full); writeFileSync(full, content); return { path }; } } });
  const lifecycle = activateDecisions(host), tools = new Map(createDecisionTools(host).map(tool => [tool.name, tool]));
  t.after(async () => { await lifecycle.dispose(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const call = async args => (await tools.get('strategy_decision').execute('fixture-call', args)).details;
  const models = await call({ action: 'models' }), now = Date.now();
  const request = { schemaVersion: '1.0.0', requestId: 'host-request', scope: { strategyId: 'strategy', runId: 'run', account: { connectionId: 'demo', accountId: '1' }, instrument: { sourceId: 'demo', instrumentId: 'BTC' } }, channel: 'alpha', mode: 'live',
    triggeredAt: { basis: 'utc', unixMs: now }, dataCutoffAt: { basis: 'utc', unixMs: now }, inputs: [{ ref: evidence, availableAt: { basis: 'utc', unixMs: now } }],
    program: { id: 'alpha', version: '1', role: 'signal', feedback: 'market', model: models.models[0], prompt: 'Return a structured fixture decision.', ttlMs: 30000, maxInputAgeMs: 60000, maxTokens: 1000, timeoutMs: 1000, failurePolicy: 'halt_new_risk' } };
  writeFileSync(join(workspace, 'request.json'), JSON.stringify(request));
  const started = await call({ action: 'submit', request_path: 'request.json' }); assert.equal(started.status, 'queued');
  const completed = await call({ action: 'status', job_id: started.id, wait: true }); assert.equal(completed.status, 'completed', JSON.stringify(completed.error));
  const timeline = await call({ action: 'timeline', job_id: started.id, as_of_ms: Date.now(), output_path: 'timeline.json', operation_id: 'timeline-evidence' });
  assert.equal(timeline.signals.length, 1); assert.equal(calls, 1); assert.equal(runtime.inferenceCalls, 0);
  assert.equal(api.read(timeline.evidence).manifest.provenance.kind, 'demo');
  assert.equal(JSON.parse(readFileSync(join(workspace, 'timeline.json'))).digest, timeline.digest);
  const preResponse = await call({ action: 'timeline', job_id: started.id, as_of_ms: now - 1, operation_id: 'before-response' });
  assert.equal(preResponse.signals.length, 0);
  const publication = api.read(preResponse.evidence), jobsBlob = publication.manifest.blobs.find(blob => blob.path === 'requests.json');
  assert.deepEqual(JSON.parse(api.readBlob(jobsBlob).toString()), [], 'An earlier export must not contain future request results');

  const historical = structuredClone(request); historical.requestId = 'historical-host'; historical.mode = 'historical'; historical.scope.runId = 'historical-run';
  historical.triggeredAt.unixMs = historical.dataCutoffAt.unixMs = historical.inputs[0].availableAt.unixMs = 1000;
  historical.simulation = { id: 'path', parametersDigest: `sha256:${'c'.repeat(64)}`, stateDigest: `sha256:${'d'.repeat(64)}`, step: 0, latencyMs: 18 };
  writeFileSync(join(workspace, 'historical.json'), JSON.stringify(historical));
  const historyJob = await call({ action: 'submit', request_path: 'historical.json', wait: true }); assert.equal(historyJob.status, 'completed');
  const historyBefore = await call({ action: 'timeline', job_id: historyJob.id, as_of_ms: 1018 });
  await assert.rejects(() => call({ action: 'invalidate', job_id: historyJob.id }), /explicit UTC asOf/);
  await assert.rejects(() => call({ action: 'invalidate', job_id: historyJob.id, as_of_ms: 1017 }), /backwards/);
  const invalidated = await call({ action: 'invalidate', job_id: historyJob.id, as_of_ms: 1020 }); assert.equal(invalidated.invalidatedAt, 1020);
  const historyAfter = await call({ action: 'timeline', job_id: historyJob.id, as_of_ms: 1020 }); assert.equal(historyAfter.effective.length, 0);
  assert.deepEqual(await call({ action: 'timeline', job_id: historyJob.id, as_of_ms: 1018 }), historyBefore);
});
