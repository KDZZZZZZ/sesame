// Isolated artifact/ledger ports. These fixtures are never evidence of actual native execution.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { SVL_SEMANTICS, validateSource, evaluateReplay } from '@sesame/plugin-sdk/svl';
import { targetProfile, registerTranslation } from '../../optional-api-v1/packages/mt5/backend/target.js';
import { sourceNodes } from '../../optional-api-v1/packages/mt5/backend/svl-capabilities.js';
import { prepareConformance } from '../../optional-api-v1/packages/mt5/backend/conformance.js';
import { Store, hostForStore } from './mt5-host.js';

export const sourceFixture = (version = '1.1.0') => ({ language: 'svl/1', schemaVersion: version, strategyId: 'conformance-fixture', semantics: structuredClone(SVL_SEMANTICS), parameters: { step: { type: 'decimal', default: '1' } }, inputs: { clock: { kind: 'timer', intervalMs: 1000, clock: { basis: 'wall', alignment: { basis: 'utc', unixMs: 0 }, missed: 'skip' } } }, state: { counter: { type: { kind: 'decimal' }, initial: '0' } },
  nodes: [{ id: 'call', op: 'function.call', inputs: { functionId: 'addStep', arguments: { record: { value: { state: 'counter' }, step: { parameter: 'step' } } } } }, { id: 'save', op: 'state.set', inputs: { stateId: 'counter', value: { node: 'call' } } }],
  handlers: [{ id: 'clock', event: { type: 'timer', input: 'clock' }, steps: [{ id: 'apply', actions: ['save'] }] }],
  functions: [{ id: 'addStep', parameters: { value: { kind: 'decimal' }, step: { kind: 'decimal' } }, nodes: [{ id: 'sum', op: 'math.add', inputs: { left: { parameter: 'value' }, right: { parameter: 'step' } } }], result: { node: 'sum' }, output: { kind: 'decimal' } }], extensions: [] });
export const replayFixture = () => ({ runId: 'conformance-unit-test', events: Array.from({ length: 3 }, (_, i) => ({ eventId: `event-${i + 1}`, sequence: String(i + 1), type: 'timer', input: 'clock', availableAt: { basis: 'utc', unixMs: i * 1000 }, inputs: {} })) });
export async function fixtureHost(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mt5-conformance-'));
  if (t) t.after(() => rm(directory, { recursive: true, force: true }));
  const workspace = join(directory, 'workspace'); await mkdir(workspace);
  const store = new Store(join(directory, 'store')), blobs = new Map(), artifacts = new Map(), host = hostForStore(store);
  host.plugin = { id: 'sesame/mt5', version: 'fixture', digest: digest('offline fixture plugin') }; host.scope = { conversationId: 'fixture-conversation' };
  host.storage.idempotentAsync = async (key, fingerprint, fn) => { const prior = store.requests.get(key); if (prior) { assert.equal(prior.fingerprint, fingerprint); return structuredClone(prior.value); } const value = await fn(); store.requests.set(key, { fingerprint, value }); return value; };
  host.workspace.file = async (action, path, content) => { const full = resolve(workspace, path); if (action === 'read') return readFile(full); await mkdir(join(full, '..'), { recursive: true }); await writeFile(full, content); return true; };
  host.artifacts = {
    blob(value) { const bytes = Buffer.from(value); const ref = { digest: digest(bytes), size: bytes.length }; blobs.set(ref.digest, bytes); return ref; },
    readBlob(ref) { const bytes = blobs.get(ref.digest); assert.ok(bytes); assert.equal(bytes.length, ref.size); return Buffer.from(bytes); },
    publish({ operationId, manifest }) { const ref = { id: `artifact-${artifacts.size}`, revision: '1', digest: digest(manifest), kind: manifest.kind, schemaVersion: '1.0.0' }; artifacts.set(ref.id, { ref, producer: structuredClone(host.plugin), manifest: structuredClone(manifest), operationId }); return structuredClone(ref); },
    read(ref) { const value = artifacts.get(ref.id); assert.ok(value); assert.equal(canonical(value.ref), canonical(ref)); return structuredClone(value); },
  };
  const publish = (kind, content, files = {}, dependencies = []) => host.artifacts.publish({ operationId: `fixture-${artifacts.size}`, manifest: { kind, schemaVersion: '1.0.0', content, dependencies, blobs: Object.entries(files).map(([path, value]) => ({ path, mediaType: 'application/json', ...host.artifacts.blob(typeof value === 'string' ? value : JSON.stringify(value)) })) } });
  const publishSource = value => { const checked = validateSource(value); return publish('strategy.source', { language: 'svl/1', languageVersion: value.schemaVersion, sourceDigest: checked.sourceDigest, sourcePath: 'source.json' }, { 'source.json': value }); };
  const mt5 = { host, storage: store, status: () => ({ compile: false }), official: { config: { account: { server: 'Fixture-Demo', login: '0' } } } };
  return { directory, workspace, store, host, mt5, artifacts, blobs, publish, publishSource };
}
export async function translationFixture(t, value = sourceFixture()) {
  const f = await fixtureHost(t), source = f.publishSource(value), target = await targetProfile(f.host);
  const args = { operation_id: 'fixture_translation_001', title: 'Fixture translation', source, target, mode: 'backtest', parameter_map: { step: { nativeInput: 'Step' } }, files: { 'Experts/Strategy.mq5': '#property strict\nvoid OnTick() {}\n' }, source_map: sourceNodes(value).map(node => ({ nodeId: node.nodeId, ...(node.functionId ? { functionId: node.functionId } : {}), generated: [{ path: 'Experts/Strategy.mq5', startLine: 1, endLine: 2 }], instrumentation: 'direct' })), adaptations: [] };
  return { ...f, value, source, target, args };
}
export async function mockedNativeEvidence(t, change) {
  const f = await translationFixture(t), replay = replayFixture();
  await f.host.workspace.file('write', 'fixture.json', JSON.stringify(replay));
  const prepared = await prepareConformance(f.host, { operation_id: 'fixture_prepare_001', source: f.source, fixture_path: 'fixture.json' });
  const registered = await registerTranslation(f.host, f.mt5, f.args), translated = f.host.artifacts.read(registered.translation).manifest.content;
  const expected = evaluateReplay(f.value, replay), content = f.host.artifacts.read(prepared.fixture).manifest.content;
  const build = { id: 'build_mock_native', project_id: registered.project_id, revision: 1, status: 'succeeded', ex5_sha256: digest('offline fake EX5 bytes'), execution: { backend: 'native' } };
  const pass = { id: 'pass_mock_native', build_id: build.id, status: 'succeeded', artifact_digest: build.ex5_sha256, process_cleanup: { activeProcesses: 0 }, actual_inputs: { Step: '1' }, config: { symbol: 'FIXTURE', period: 'M1', parameters: {} }, created_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T00:00:01Z', trace_truncated: false };
  const trace = [{ kind: 'svl_begin', value: { fixtureDigest: content.fixtureDigest, sourceDigest: content.sourceDigest, runId: content.runId, parametersDigest: content.parametersDigest } }];
  replay.events.forEach((event, index) => { trace.push({ kind: 'svl_input', value: { index, eventId: event.eventId, digest: digest(event) } }, { kind: 'svl_event', value: structuredClone(expected.events[index]) }); });
  trace.push({ kind: 'svl_end', value: { status: expected.status, state: expected.state } });
  if (change) change({ trace, build, pass, expected });
  const rows = trace.map((row, i) => ({ seq: i + 1, build_id: build.id, ...row }));
  const raw = f.publish('resource', {}, { 'result.json': { completed: true, build_id: build.id, run_id: pass.id, trace_truncated: false, metrics: { trade_count: 0 }, deals: [] } });
  const chunk = f.publish('data', { path: 'rows.json', rowCount: rows.length, provenance: { kind: 'observed', nativePassId: pass.id } }, { 'rows.json': rows });
  const result = f.publish('strategy.result', { source: f.source, translation: registered.translation, status: 'completed', nativePassId: pass.id, buildId: build.id, codeDigest: build.ex5_sha256, rawResult: raw, data: [{ role: 'trace', offset: 0, ref: chunk }] });
  pass.result_artifact = result; f.store.put('mt5_build', build); f.store.put('mt5_pass', pass);
  return { ...f, registered, prepared, build, pass, expected, rows, result, verifyArgs: { operation_id: 'fixture_verify_001', fixture: prepared.fixture, translation: registered.translation, result }, replay, translated };
}
