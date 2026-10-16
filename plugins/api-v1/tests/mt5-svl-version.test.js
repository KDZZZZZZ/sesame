import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digest } from '@sesame/plugin-sdk/protocol';
import { validateSource } from '@sesame/plugin-sdk/svl';
import { registerTranslation } from '../../optional-api-v1/packages/mt5/backend/target.js';
import { translationBinding } from '../../optional-api-v1/packages/mt5/backend/parameters.js';
import { fixtureHost } from './mt5-conformance-fixture.js';

// Only storage and immutable artifact ports are fixtures. The production SVL
// validator and MT5 translation/binding code execute unchanged; no terminal runs.
async function fixture(t, version, versions = ['1.0.0']) {
  const f = await fixtureHost(t);
  const source = JSON.parse(readFileSync(new URL('../packages/strategy-authoring/examples/close-threshold.svl.json', import.meta.url)));
  source.schemaVersion = version;
  const checked = validateSource(source), bytes = Buffer.from(JSON.stringify(source));
  const ref = (id, kind) => ({ id, kind, revision: 'revision-1', schemaVersion: '1.0.0', digest: digest(id) });
  const sourceRef = ref('fixed-source', 'strategy.source'), targetRef = ref('fixed-target', 'strategy.target'), translationRef = ref('fixed-translation', 'strategy.translation');
  const parameterMap = { instrument: { binding: 'instrument' }, threshold: { nativeInput: 'Threshold' } };
  const artifacts = new Map([
    [sourceRef.id, { ref: sourceRef, manifest: { content: { sourcePath: 'strategy.svl.json', sourceDigest: checked.sourceDigest }, blobs: [{ path: 'strategy.svl.json', digest: digest(bytes), size: bytes.length }] } }],
    [targetRef.id, { ref: targetRef, producer: { id: 'sesame/mt5' }, manifest: { content: { id: 'sesame.mt5.mql5', svl: { versions, events: ['bar.closed'] } } } }],
    [translationRef.id, { ref: translationRef, manifest: { content: { source: sourceRef, target: targetRef, nativeParameterMap: parameterMap } } }],
  ]);
  const records = new Map([
    ['mt5_build/build', { project_id: 'project', revision: 1 }],
    ['mt5_revision/project:1', { translation: translationRef }],
  ]);
  let writes = 0;
  const storage = f.store;
  for (const [key, value] of records) { const [kind, id] = key.split('/'); storage.put(kind, { ...value, id }); }
  const host = f.host;
  host.resources.read = async (value, options) => {
    const record = artifacts.get(value.id); assert.ok(record); assert.deepEqual(value, record.ref);
    if (options.part === 'metadata') return { ref: record.ref, producer: record.producer };
    if (options.part === 'manifest') return structuredClone(record.manifest);
    assert.equal(options.part, 'content'); assert.equal(value.id, sourceRef.id);
    return { content: bytes.toString(options.encoding), total: bytes.length };
  };
  host.resources.create = () => { writes++; throw new Error('Unexpected publication before version validation'); };
  const mt5 = { storage, official: { config: { account: { server: 'Fixture-Demo', login: '7001' } } } };
  const config = { symbol: 'EURUSD', period: 'M1', parameters: { Threshold: '101.25' } };
  const args = {
    operation_id: 'svl_version_boundary_01', title: 'Version boundary fixture', source: sourceRef, target: targetRef, mode: 'backtest', parameter_map: parameterMap,
    files: { 'Experts/Strategy.mq5': '// Identity fixture; not native code validation' },
    source_map: source.nodes.map(node => ({ nodeId: node.id, generated: [], instrumentation: 'unobservable', reason: 'No native run in this test' })), adaptations: [],
  };
  return { host, mt5, config, args, artifacts, records: storage, writes: () => writes };
}

test('MT5 registration refuses a newer SVL source before project publication', async t => {
  for (const versions of [['1.0.0'], [], null, '1.1.0', {}]) {
    const f = await fixture(t, '1.1.0', versions);
    await assert.rejects(registerTranslation(f.host, f.mt5, f.args), { code: 'UNSUPPORTED_CAPABILITY', status: 422 });
    assert.equal(f.writes(), 0);
  }
});

test('resuming or retesting a frozen translation cannot bypass its target language versions', async t => {
  for (const versions of [['1.0.0'], [], null, '1.1.0', {}]) {
    const f = await fixture(t, '1.1.0', versions);
    await assert.rejects(translationBinding(f.host, f.mt5, 'build', f.config), { code: 'UNSUPPORTED_CAPABILITY', status: 422 });
    assert.equal(f.writes(), 0);
  }
});

test('existing SVL 1.0 translations retain exact parameters and native bindings', async t => {
  const f = await fixture(t, '1.0.0'), bound = await translationBinding(f.host, f.mt5, 'build', f.config);
  assert.equal(bound.parameters.threshold, '101.25');
  assert.equal(bound.parameters.instrument.instrumentId, 'EURUSD');
  assert.deepEqual(bound.native, { Threshold: '101.25' });
  assert.deepEqual(bound.source, f.args.source);
  assert.deepEqual(bound.target, f.args.target);
  assert.equal(f.writes(), 0);
});

test('native projects without a SVL translation keep their existing path', async t => {
  const f = await fixture(t, '1.0.0');
  f.records.put('mt5_revision', { id: 'project:1' });
  assert.equal(await translationBinding(f.host, f.mt5, 'build', f.config), null);
});
