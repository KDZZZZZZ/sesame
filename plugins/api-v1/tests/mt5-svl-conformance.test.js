import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '@sesame/plugin-sdk/protocol';
import { graph } from '@sesame/plugin-sdk/svl';
import { compareNativeReplay, verifyConformance, prepareConformance } from '../../optional-api-v1/packages/mt5/backend/conformance.js';
import { registerTranslation, validateMapping } from '../../optional-api-v1/packages/mt5/backend/target.js';
import { parameterMapping, translationBinding } from '../../optional-api-v1/packages/mt5/backend/parameters.js';
import { assertTargetCapabilities, svlCapabilities } from '../../optional-api-v1/packages/mt5/backend/svl-capabilities.js';
import { frozenTimeline, readTimeline, externalInputAdaptation, stageFrozenTimeline, TIMELINE_PATH, EXTERNAL_INPUT_FORMAT } from '../../optional-api-v1/packages/mt5/backend/external-inputs.js';
import { fixtureHost, translationFixture, mockedNativeEvidence, sourceFixture, replayFixture } from './mt5-conformance-fixture.js';

for (const version of ['1.1.0', '1.2.0']) test(`SVL ${version} scoped function translation is admitted as unverified software, not native equivalence`, async t => {
  const f = await translationFixture(t, sourceFixture(version)), result = await registerTranslation(f.host, f.mt5, f.args), translated = f.host.artifacts.read(result.translation).manifest.content;
  assert.equal(translated.admission.languageVersion, version); assert.equal(translated.admission.verification, 'not_run');
  assert.equal(result.implementation, 'translated_unverified'); assert.equal(f.host.artifacts.read(result.validation).manifest.content.outcome, 'partial');
  assert.ok(translated.sourceMap.some(entry => entry.functionId === 'addStep'));
  const incomplete = f.args.source_map.filter(entry => !entry.functionId);
  assert.throws(() => validateMapping(f.value, f.args.files, incomplete), /每个/);
  const ambiguous = structuredClone(f.args.source_map); delete ambiguous.at(-1).functionId;
  assert.throws(() => validateMapping(f.value, f.args.files, ambiguous), /作用域/);
  await assert.rejects(registerTranslation(f.host, f.mt5, { ...f.args, operation_id: 'equivalence_rejected_001', adaptations: [{ code: 'CLAIM', nodes: ['call'], status: 'equivalent', description: 'This is just a claim', evidence: [] }] }), /不能声明/);
});
test('target rejects unknown versions or undeclared operators and extensions; full SDK matrix is explicit', () => {
  const source = sourceFixture(), svl = svlCapabilities(); assert.ok(svl.versions.includes('1.2.0')); assert.equal(svl.automaticOperators.length, 0);
  assert.throws(() => assertTargetCapabilities(source, { svl: { ...svl, versions: ['1.0.0'] } }), { code: 'UNSUPPORTED_CAPABILITY' });
  delete svl.operatorCapabilities['function.call']; assert.throws(() => assertTargetCapabilities(source, { svl }), { code: 'UNSUPPORTED_CAPABILITY' });
});
test('fixture prepare is deterministic reference evidence only and does not execute a terminal', async t => {
  const f = await translationFixture(t); await f.host.workspace.file('write', 'fixture.json', JSON.stringify(replayFixture()));
  const result = await prepareConformance(f.host, { operation_id: 'prepare_fixture_001', source: f.source, fixture_path: 'fixture.json', header_path: 'Include/Fixture.mqh' });
  assert.equal(result.nativeEngineExecuted, false); assert.equal(result.validationScope, 'reference-only'); assert.equal(f.store.list('mt5_pass').length, 0);
  assert.match(await readFile(join(f.workspace, 'Include/Fixture.mqh'), 'utf8'), /PRODUCT_SVL_SOURCE_DIGEST/);
});
test('offline ledger contract fixture matches nodes including function trace, explicitly not real native acceptance', async t => {
  const f = await mockedNativeEvidence(t), result = verifyConformance(f.host, f.mt5, f.verifyArgs);
  assert.equal(result.outcome, 'passed'); assert.equal(result.covered, 3); assert.deepEqual(result.uncovered, []); assert.equal(result.generalEquivalence, 'not_proven');
});
test('offline contract rejects native identity/cleanup gaps, actual changed inputs and missing ledger', async t => {
  for (const change of [({ build }) => { build.execution.backend = 'fixture'; }, ({ pass }) => { pass.process_cleanup.activeProcesses = 1; }, ({ pass }) => { pass.trace_truncated = true; }, ({ pass }) => { pass.actual_inputs.Step = '2'; }]) {
    const f = await mockedNativeEvidence(t, change); assert.throws(() => verifyConformance(f.host, f.mt5, f.verifyArgs));
  }
  const f = await mockedNativeEvidence(t); f.store.delete('mt5_pass', f.pass.id); assert.throws(() => verifyConformance(f.host, f.mt5, f.verifyArgs));
});
test('actual input order is not sorted to look right and function trace cannot be omitted or reassigned', async t => {
  const reordered = await mockedNativeEvidence(t, ({ trace }) => { trace[1].value.digest = digest('different event'); });
  assert.throws(() => verifyConformance(reordered.host, reordered.mt5, reordered.verifyArgs), /内容或顺序/);
  const wrongScope = await mockedNativeEvidence(t, ({ trace }) => { const row = trace.find(row => row.kind === 'svl_event').value.trace.find(row => row.functionId); row.functionId = 'anotherFunction'; });
  const result = verifyConformance(wrongScope.host, wrongScope.mt5, wrongScope.verifyArgs); assert.equal(result.outcome, 'failed'); assert.ok(result.differences.some(item => item.path.includes('/functionId')));
  const changedState = await mockedNativeEvidence(t, ({ trace }) => { trace.at(-1).value.state.counter = '99'; });
  assert.equal(verifyConformance(changedState.host, changedState.mt5, changedState.verifyArgs).outcome, 'failed');
});
test('cross-backend numeric comparison fixes shape/order and never applies epsilon to decisions or state', () => {
  const expected = { events: [{ trace: [{ value: '1' }], branches: [true] }], state: { quantity: '1' } }, observed = structuredClone(expected);
  observed.events[0].trace[0].value = '1.0001'; const policy = [{ path: '/events/0/trace/0/value', absolute: '0.001', relative: '0' }];
  assert.equal(compareNativeReplay(expected, observed).matched, false); assert.equal(compareNativeReplay(expected, observed, policy).matched, true);
  observed.state.quantity = '1.0001'; assert.equal(compareNativeReplay(expected, observed, policy).matched, false);
  for (const path of ['/state/quantity', '/events/0/branches/0', '/events/*/trace/0/value']) assert.throws(() => compareNativeReplay(expected, observed, [{ ...policy[0], path }]));
});
test('structured parameters require JSON encoding and are checked against actual native input values', async t => {
  const source = sourceFixture(); source.parameters.data = { type: 'record', shape: { kind: 'record', fields: { n: { kind: 'integer' } } }, default: { n: 1 } };
  assert.throws(() => parameterMapping(source, { step: { nativeInput: 'Step' }, data: { nativeInput: 'Data' } }), { code: 'UNSUPPORTED_CAPABILITY' });
  const f = await translationFixture(t, source); f.args.parameter_map.data = { nativeInput: 'Data', encoding: 'json' }; const registered = await registerTranslation(f.host, f.mt5, f.args);
  f.store.put('mt5_build', { id: 'build_json', project_id: registered.project_id, revision: 1 });
  assert.deepEqual(translationBinding(f.host, f.mt5, 'build_json', { symbol: 'FIXTURE', period: 'M1', parameters: { Data: '{"n":2}' } }).parameters.data, { n: 2 });
  assert.throws(() => translationBinding(f.host, f.mt5, 'build_json', { symbol: 'FIXTURE', period: 'M1', parameters: { Data: '{"n":"bad"}' } }));
});
test('external input requires frozen secret-free limited adaptation and identical timeline; files stage from immutable artifact', async t => {
  const f = await translationFixture(t), schema = f.publish('resource', { type: 'external-fixture' });
  f.value.inputs.clock = { kind: 'external', schema: structuredClone(schema), availabilityPolicy: structuredClone(schema) }; f.value.handlers[0].event.type = 'external.input'; f.source = f.publishSource(f.value); f.args.source = f.source;
  const replay = replayFixture(); replay.events.forEach(event => { event.type = 'external.input'; });
  await f.host.workspace.file('write', 'fixture.json', JSON.stringify(replay));
  const prepared = await prepareConformance(f.host, { operation_id: 'prepare_external_001', source: f.source, fixture_path: 'fixture.json', timeline_path: 'timeline.ndjson' });
  f.args.files[TIMELINE_PATH] = await readFile(join(f.workspace, 'timeline.ndjson'), 'utf8');
  await assert.rejects(registerTranslation(f.host, f.mt5, f.args), { code: 'UNSUPPORTED_CAPABILITY' });
  f.args.operation_id = 'external_translation_001'; f.args.adaptations = [{ code: 'EXTERNAL_INPUT_BRIDGE', status: 'limited', nodes: ['call'], description: 'Frozen time-ordered external input, stops new risk on expiry', evidence: [prepared.bridgeConfiguration] }];
  const registered = await registerTranslation(f.host, f.mt5, f.args);
  const build = { id: 'build_external', project_id: registered.project_id, revision: 1 }, pass = { id: 'pass_external', build_id: build.id }; f.store.put('mt5_build', build); f.store.put('mt5_pass', pass);
  const output = join(f.directory, 'common/pass'); const receipt = await stageFrozenTimeline(f.mt5, pass, output);
  assert.equal(receipt.digest, prepared.timelineDigest); assert.equal(receipt.rows, 3); assert.equal(await readFile(join(output, 'svl-timeline.ndjson'), 'utf8'), f.args.files[TIMELINE_PATH]);
  const bad = f.host.artifacts.read(prepared.bridgeConfiguration).manifest.content; bad.token = 'forbidden-test-token'; const evidence = f.publish('resource', bad);
  assert.throws(() => externalInputAdaptation(f.host, f.value, 'backtest', f.args.files, [{ ...f.args.adaptations[0], evidence: [evidence] }]), /白名单/);
  const mutated = structuredClone(f.args.files); mutated[TIMELINE_PATH] = mutated[TIMELINE_PATH].replace('event-1', 'event-x');
  assert.throws(() => externalInputAdaptation(f.host, f.value, 'backtest', mutated, f.args.adaptations));
});
test('frozen timeline rejects future reordering, inconsistent digest and absent UTC availability', () => {
  const events = replayFixture().events, text = frozenTimeline(events); assert.equal(readTimeline(text).rows, 3);
  assert.throws(() => frozenTimeline([events[1], events[0]]), /非递减/);
  const missing = structuredClone(events); delete missing[0].availableAt; assert.throws(() => frozenTimeline(missing), /UTC/);
  assert.throws(() => readTimeline(text.replace('event-1', 'other'))); assert.throws(() => readTimeline(text.slice(0, -1)));
});
