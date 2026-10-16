import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digest } from '@sesame/plugin-sdk/protocol';
import { createCapabilities } from '../packages/strategy-authoring/index.js';
import { resourceHost } from './core-v2-fixture.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'strategy-v2-')), f = resourceHost({ workspaceRoot: root, storageRoot: join(root, 'private') });
  const tools = new Map(createCapabilities(f.host).map(tool => [tool.name, tool]));
  f.call = (name, input = {}) => tools.get(name).execute(input, new AbortController().signal); f.root = root;
  f.host.events = { emit: async () => ({ accepted: true }) };
  t.after(async () => { await f.call('strategy_dispose'); rmSync(root, { recursive: true, force: true }); }); return f;
}

test('SVL publication reads actual bytes, preserves semantic digest and replays its frozen source', async t => {
  const f = fixture(t);
  for (const name of ['close-threshold.svl.json', 'close-threshold.replay.json']) writeFileSync(join(f.root, name), readFileSync(new URL('../packages/strategy-authoring/examples/' + name, import.meta.url)));
  const validated = await f.call('strategy_validate', { source_path: 'close-threshold.svl.json' });
  const published = await f.call('strategy_publish', { source_path: 'close-threshold.svl.json', operation_id: 'fixed-source', title: 'Threshold', change_summary: 'First version' });
  assert.equal(published.sourceDigest, validated.sourceDigest);
  const graph = await f.call('strategy_graph', { source: published.ref }); assert.deepEqual(graph, published.graph);
  const replay = await f.call('strategy_replay', { source: published.ref, fixture_path: 'close-threshold.replay.json', operation_id: 'fixed-replay' });
  assert.equal(replay.nativeEngineExecuted, false); assert.equal(replay.evidence.kind, 'resource');
  const evidence = f.artifacts.get(replay.evidence.id); assert.deepEqual(evidence.manifest.dependencies, [published.ref]);
  assert.equal(JSON.parse(evidence.bytes.get('replay.json')).status, replay.status);
  const source = f.artifacts.get(published.ref.id); source.manifest.content.sourceDigest = digest('different source');
  await assert.rejects(f.call('strategy_graph', { source: published.ref }), /semantic digest/);
});

test('decision lifecycle uses private durable records and actual frozen resource inputs', async t => {
  const f = fixture(t), model = { provider: 'fixture', id: 'frozen', configurationDigest: digest('fixture config') }, now = Date.now();
  const resource = await f.host.resources.create({ kind: 'file', lifetime: 'durable', name: 'input.json', source: { content: '{"close":"100"}' } });
  const evidence = await f.host.resources.publish(resource, { kind: 'resource', schemaVersion: '1.0.0', content: { close: '100' }, dependencies: [], provenance: { kind: 'demo' }, blobs: [{ path: 'input.json', entry: '', mediaType: 'application/json' }] });
  const request = { schemaVersion: '1.0.0', requestId: 'decision-1', scope: { strategyId: 'strategy', runId: 'portfolio-1', account: { connectionId: 'fixture', accountId: '1' }, instrument: { sourceId: 'fixture', instrumentId: 'BTC' } }, channel: 'direction', mode: 'live',
    program: { id: 'alpha', version: '1', role: 'signal', feedback: 'market', model, prompt: 'Use only the supplied facts.', ttlMs: 60000, maxInputAgeMs: 120000, maxTokens: 1000, timeoutMs: 1000, failurePolicy: 'halt_new_risk' },
    triggeredAt: { basis: 'utc', unixMs: now }, dataCutoffAt: { basis: 'utc', unixMs: now }, inputs: [{ ref: evidence.ref, availableAt: { basis: 'utc', unixMs: now - 1 }, paths: ['input.json'] }] };
  let calls = 0;
  f.host.data = { query: async ({ source }) => { assert.equal(source.providerId, 'host#models'); return { items: [model] }; } };
  f.host.capabilities = { async invoke(id, input) {
    assert.equal(id, 'host.model.complete'); assert.equal(input.requestId, undefined); assert.equal(input.input.inputs[0].files[0].content, '{"close":"100"}'); calls++;
    return { type: 'result', value: { model, text: JSON.stringify({ direction: 'long', reason: 'Actual fixed input', evidence: [evidence.ref] }), usage: { input: 2, output: 1 }, modelRevisionVerified: false } };
  } };
  writeFileSync(join(f.root, 'request.json'), JSON.stringify(request)); await f.call('strategy_activate');
  const job = await f.call('strategy_decision', { action: 'submit', request_path: 'request.json', wait: true });
  assert.equal(job.status, 'completed'); assert.equal(calls, 1); assert.ok(existsSync(join(f.root, 'private', 'decisions', 'decisions.sqlite')));
  await f.call('strategy_dispose'); await f.call('strategy_activate');
  assert.equal((await f.call('strategy_decision', { action: 'submit', request_path: 'request.json', wait: true })).id, job.id); assert.equal(calls, 1);
  const timeline = await f.call('strategy_decision', { action: 'timeline', job_id: job.id, operation_id: 'timeline-1', as_of_ms: Date.now() });
  assert.equal(timeline.modelInvocations, 0); assert.equal(timeline.signals.length, 1); assert.equal(f.artifacts.get(timeline.evidence.id).manifest.provenance.kind, 'demo');
});
