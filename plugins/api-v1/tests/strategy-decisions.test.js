import test from 'node:test';
import assert from 'node:assert/strict';
import { clone, digest } from '@sesame/plugin-sdk/protocol';
import { AgentDecisionService, validateDecisionRequest } from '../packages/strategy-authoring/lib/agent-decisions.js';
import { replaySignals } from '../packages/strategy-authoring/lib/pipeline.js';

const time = unixMs => ({ basis: 'utc', unixMs });
const ref = { id: 'evidence', revision: '1', kind: 'resource', schemaVersion: '1.0.0', digest: digest('fictional test data') };
const model = { provider: 'fixture', id: 'frozen', configurationDigest: digest('fixture model') };
const scope = { strategyId: 'test-strategy', runId: 'test-run', account: { connectionId: 'demo', accountId: '1' }, instrument: { sourceId: 'demo', instrumentId: 'BTC' } };
const request = (id = 'r1') => ({ schemaVersion: '1.0.0', requestId: id, scope: clone(scope), channel: 'direction', mode: 'live',
  program: { id: 'alpha', version: '1', role: 'signal', feedback: 'market', model: clone(model), prompt: 'Use the supplied facts.', ttlMs: 60000, maxInputAgeMs: 120000,
    maxTokens: 1000, timeoutMs: 1000, failurePolicy: 'halt_new_risk' }, triggeredAt: time(100000), dataCutoffAt: time(99000), inputs: [{ ref, availableAt: time(90000) }] });
function fixture(complete, concurrency = 2) {
  let now = 100000, calls = 0;
  const records = new Map(), key = (kind, id) => `${kind}/${id}`;
  const storage = { directory: `fixture-${Math.random()}`,
    get(kind, id, optional = false) { const value = records.get(key(kind, id)); if (!value && !optional) throw Error(`Missing ${kind}/${id}`); return value ? clone(value) : null; },
    put(kind, value) { records.set(key(kind, value.id), clone(value)); return clone(value); },
    update(kind, id, changes) { return this.put(kind, { ...this.get(kind, id), ...changes }); },
    list(kind) { return [...records.entries()].filter(([k]) => k.startsWith(kind + '/')).map(([, value]) => clone(value)); },
    transaction(action) { const before = new Map([...records].map(([k, v]) => [k, clone(v)])); try { return action(); } catch (error) { records.clear(); before.forEach((v, k) => records.set(k, v)); throw error; } },
  };
  const host = { storage, artifacts: { read(value) { assert.deepEqual(value, ref); return { manifest: { content: { close: '100', provenance: { kind: 'demo' } }, provenance: { kind: 'demo' }, blobs: [] } }; } },
    inference: { models: () => [clone(model)], complete: async (input, signal) => { calls++; const result = complete ? await complete(input, signal) : { direction: 'long', confidence: '0.6', reason: 'Fictional signal', evidence: [ref] }; return { model, text: JSON.stringify(result), usage: { input: 100, output: 10 }, modelRevisionVerified: false }; } } };
  const service = new AgentDecisionService(host, { clock: () => now, concurrency });
  return { host, service, setTime: value => { now = value; }, calls: () => calls };
}

test('asynchronous producer freezes actual artifacts, saves a signal and replays without model calls', async () => {
  let seen;
  const f = fixture(input => { seen = input; return { direction: 'long', reason: 'Observed fixture', evidence: [ref] }; });
  const job = f.service.submit(request()); assert.equal(job.status, 'queued');
  const result = await f.service.wait(job.id);
  assert.equal(result.status, 'completed', JSON.stringify(result.error));
  assert.equal(seen.input.inputs[0].content.close, '100');
  assert.equal(seen.input.scope.account.accountId, '1');
  assert.equal(seen.tools, undefined);
  assert.ok(result.response.modelRevisionVerified === false);
  assert.equal(result.output.availableAt.unixMs, 100000);
  const timeline = f.service.timeline(scope, time(100000));
  assert.equal(timeline.signals.length, 1);
  assert.equal(replaySignals(timeline.signals, { scope: { strategyId: scope.strategyId, runId: scope.runId, account: scope.account }, asOf: time(100000) }).active.length, 1);
  assert.equal(f.calls(), 1); assert.equal(timeline.modelInvocations, 0);
  await f.service.close();
});

test('request identity is durable and cannot silently reuse changed prompts, inputs or simulations', async () => {
  const f = fixture(), input = request(), job = f.service.submit(input); await f.service.wait(job.id);
  assert.equal(f.service.submit(input).id, job.id); assert.equal(f.calls(), 1);
  input.program.prompt = 'Changed program'; assert.throws(() => f.service.submit(input), /ID reused/);
  await f.service.close();
});

test('future inputs, stale live requests and forged model references fail before inference', () => {
  const f = fixture(), future = request(); future.inputs[0].availableAt = time(100001);
  assert.throws(() => f.service.submit(future), /not available/);
  const stale = request(); stale.triggeredAt = time(10000); stale.dataCutoffAt = time(9000); stale.inputs[0].availableAt = time(9000);
  assert.throws(() => f.service.submit(stale), /already expired/);
  const switched = request(); switched.program.model.configurationDigest = digest('new'); assert.throws(() => f.service.submit(switched), /not currently configured/);
  assert.equal(f.calls(), 0);
});

test('late same-channel response cannot replace a newer generation, even if provider ignores abort', async () => {
  let firstResolve;
  const f = fixture(input => input.requestId.startsWith('r1/') ? new Promise(resolve => { firstResolve = resolve; }) : { direction: 'short', reason: 'New', evidence: [ref] });
  const first = f.service.submit(request('r1')); await new Promise(resolve => setImmediate(resolve));
  const second = f.service.submit(request('r2')); await f.service.wait(second.id);
  firstResolve({ direction: 'long', reason: 'Old', evidence: [ref] }); await f.service.wait(first.id);
  assert.equal(f.service.get(first.id).status, 'superseded');
  const timeline = f.service.timeline(scope, time(100000)); assert.equal(timeline.signals.length, 1); assert.equal(timeline.signals[0].direction, 'short');
  await f.service.close();
});

test('risk halt retires previous Alpha and invalidates pre-risk outstanding completions', async () => {
  let resolveSlow;
  const f = fixture(input => input.requestId.startsWith('slow/') ? new Promise(resolve => { resolveSlow = resolve; }) : input.requestId.startsWith('risk/') ? { action: 'halt', reason: 'Frozen risk fact', evidence: [ref] } : { direction: 'long', reason: 'Before risk', evidence: [ref] });
  const first = f.service.submit(request('first')); await f.service.wait(first.id);
  const slow = f.service.submit(request('slow')); await new Promise(resolve => setImmediate(resolve));
  f.setTime(100010);
  const risk = request('risk'); risk.program.role = 'risk'; risk.program.id = 'risk-observer'; risk.channel = 'risk'; risk.triggeredAt = time(100010);
  const riskJob = f.service.submit(risk); await f.service.wait(riskJob.id);
  resolveSlow({ direction: 'long', reason: 'Late pre-risk output', evidence: [ref] }); await f.service.wait(slow.id);
  assert.equal(f.service.get(slow.id).status, 'canceled');
  const timeline = f.service.timeline(scope, time(100010)); assert.equal(timeline.advice[0].action, 'halt'); assert.equal(timeline.guards.length, 1);
  const replay = replaySignals(timeline.signals, { scope: { strategyId: scope.strategyId, runId: scope.runId, account: scope.account }, asOf: time(100010), guards: timeline.guards });
  assert.equal(replay.active.length, 0); assert.ok(replay.inactive.some(item => item.reason === 'risk_retired'));
  await f.service.close();
});

test('historical feedback uses declared latency and rejects concurrent or cross-parameter chains', async () => {
  let release;
  const f = fixture(() => new Promise(resolve => { release = resolve; }));
  const input = request(); input.mode = 'historical'; input.program.feedback = 'account'; input.simulation = { id: 'simulation', step: 0, parametersDigest: digest('parameters'), stateDigest: digest('state0'), latencyMs: 18 };
  const job = f.service.submit(input); await new Promise(resolve => setImmediate(resolve));
  const concurrent = clone(input); concurrent.requestId = 'r2'; concurrent.simulation.step = 1;
  assert.throws(() => f.service.submit(concurrent), /chronological/);
  release({ direction: 'flat', reason: 'Simulation result', evidence: [ref] }); await f.service.wait(job.id);
  assert.equal(f.service.timeline(scope, time(100017)).signals.length, 0);
  assert.equal(f.service.timeline(scope, time(100018)).signals.length, 1);
  const changed = clone(concurrent); changed.simulation.parametersDigest = digest('other-parameters');
  assert.throws(() => f.service.submit(changed), /different simulation paths/);
  assert.throws(() => f.service.submit(concurrent), /chronological/);
  await f.service.close();
});

test('invalid evidence, schema violations and late output never become active signals', async () => {
  for (const output of [{ direction: 'long', reason: 'Unknown', evidence: [{ ...ref, id: 'invented' }] }, { direction: 'long', reason: 'Unknown', evidence: [ref], order: 'buy' }]) {
    const f = fixture(() => output), job = f.service.submit(request()); const result = await f.service.wait(job.id);
    assert.equal(result.status, 'failed'); assert.equal(result.output, null); await f.service.close();
  }
  const f = fixture(() => { f.setTime(200000); return { direction: 'long', reason: 'Too late', evidence: [ref] }; });
  const job = f.service.submit(request()), result = await f.service.wait(job.id);
  assert.equal(result.status, 'expired'); assert.equal(result.output, null); await f.service.close();
});

test('restart marks unresolved jobs interrupted and never starts another model request', async () => {
  const f = fixture(), initial = f.service.submit(request()); await f.service.wait(initial.id); await f.service.close();
  f.host.storage.update('decision_job', initial.id, { status: 'running', output: null });
  const restarted = new AgentDecisionService(f.host, { clock: () => 100000 });
  assert.equal(restarted.get(initial.id).status, 'interrupted'); assert.equal(f.calls(), 1);
  assert.equal(restarted.submit(request()).status, 'interrupted'); await restarted.close();
});

test('new risk advice replaces older advice from its channel and expiry never revives an older allowance', async () => {
  let action = 'halt';
  const f = fixture(() => ({ action, reason: 'Risk observation', evidence: [ref] })), input = request(); input.program.role = 'risk'; input.program.id = 'risk';
  const first = f.service.submit(input); await f.service.wait(first.id);
  f.setTime(100010); action = 'allow'; input.requestId = 'r2'; input.triggeredAt = time(100010);
  const second = f.service.submit(input); await f.service.wait(second.id);
  assert.equal(f.service.timeline(scope, time(100010)).advice.length, 1);
  assert.equal(f.service.timeline(scope, time(100010)).advice[0].action, 'allow');
  assert.equal(f.service.timeline(scope, time(160010)).effective.length, 0); await f.service.close();
});

test('invalidation preserves a fixed evidence guard and closes queued/running jobs', async () => {
  const f = fixture(); const first = f.service.submit(request()); await f.service.wait(first.id);
  f.setTime(100020); const run = f.service.invalidate(scope, 'User changed strategy context', [ref]); assert.equal(run.epoch, 1);
  const timeline = f.service.timeline(scope, time(100020)); assert.equal(timeline.guards[0].retiredSignals[0].id, f.service.get(first.id).output.id);
  assert.equal(timeline.effective.length, 0); await f.service.close();
});

test('decision schema has bounded explicit failure and time policies', () => {
  const unsafe = request(); unsafe.program.failurePolicy = 'trade-anyway'; assert.throws(() => validateDecisionRequest(unsafe), /halt new risk/);
  const fractional = request(); fractional.program.ttlMs = 0.5; assert.throws(() => validateDecisionRequest(fractional), /lifetime/);
  const naive = request(); naive.dataCutoffAt = { basis: 'wall', value: '2026-10-10' }; assert.throws(() => validateDecisionRequest(naive), /unknown field|UTC/);
});

test('future invalidations and risk epochs cannot alter an earlier timeline or its digest', async () => {
  let risk = false;
  const f = fixture(() => risk ? { action: 'halt', reason: 'Later risk', evidence: [ref] } : { direction: 'long', reason: 'Earlier signal', evidence: [ref] });
  const first = f.service.submit(request('epoch-first')); await f.service.wait(first.id);
  const before = f.service.timeline(scope, time(100000));
  f.setTime(100010); f.service.invalidate(scope, 'Context changed', [ref]);
  assert.deepEqual(f.service.timeline(scope, time(100000)), before);
  const invalidated = f.service.timeline(scope, time(100010)); assert.equal(invalidated.epoch, 1); assert.notEqual(invalidated.digest, before.digest);
  f.setTime(100020); risk = true; const next = request('risk-epoch'); next.triggeredAt = time(100020); next.program.role = 'risk'; next.program.id = 'risk';
  await f.service.wait(f.service.submit(next).id);
  assert.equal(f.service.timeline(scope, time(100020)).epoch, 2);
  assert.deepEqual(f.service.timeline(scope, time(100010)), invalidated);
  assert.deepEqual(f.service.timeline(scope, time(100000)), before);
  assert.notEqual(f.service.timeline(scope, time(100001)).digest, before.digest); // asOf is part of identity.
  await f.service.close();
});

test('historical invalidation requires an explicit monotone simulation clock, never host wall time', async () => {
  const f = fixture(); f.setTime(2000000000000);
  const input = request('historical-explicit'); input.mode = 'historical'; input.triggeredAt = time(1000); input.dataCutoffAt = time(900); input.inputs[0].availableAt = time(800);
  input.simulation = { id: 'history', parametersDigest: digest('p'), stateDigest: digest('s'), step: 0, latencyMs: 18 };
  await f.service.wait(f.service.submit(input).id); const before = f.service.timeline(scope, time(1018));
  assert.throws(() => f.service.invalidate(scope, 'change', [ref]), /explicit UTC asOf/);
  assert.throws(() => f.service.invalidate(scope, 'change', [ref], time(1017)), /backwards/);
  f.service.invalidate(scope, 'change', [ref], time(1020));
  assert.equal(f.service.timeline(scope, time(1020)).guards[0].issuedAt.unixMs, 1020); assert.equal(f.service.timeline(scope, time(1020)).effective.length, 0);
  assert.deepEqual(f.service.timeline(scope, time(1018)), before);
  assert.throws(() => f.service.invalidate(scope, 'older change', [ref], time(1019)), /backwards/);
  const next = clone(input); next.requestId = 'backdated'; next.triggeredAt = time(1019); next.simulation.step = 1;
  assert.throws(() => f.service.submit(next), /chronological/); await f.service.close();
});

test('failed replacement retires the old signal and blocks new risk until a later same-channel success', async () => {
  let failed = false;
  const f = fixture(() => { if (failed) throw new Error('offline'); return { direction: 'long', reason: 'Observation', evidence: [ref] }; });
  const old = await f.service.wait(f.service.submit(request('first-good')).id); const before = f.service.timeline(scope, time(100000));
  f.setTime(100010); failed = true; const bad = request('failed-replacement'); bad.triggeredAt = time(100010); const failedJob = await f.service.wait(f.service.submit(bad).id);
  assert.equal(failedJob.status, 'failed'); const blocked = f.service.timeline(scope, time(100010));
  assert.equal(blocked.effective.length, 0); assert.equal(blocked.guards[0].blockedUntil.unixMs, Number.MAX_SAFE_INTEGER);
  assert.ok(blocked.guards[0].retiredSignals.some(value => value.id === old.output.id));
  assert.equal(replaySignals(blocked.signals, { scope: { strategyId: scope.strategyId, runId: scope.runId, account: scope.account }, asOf: blocked.asOf, guards: blocked.guards }).active.length, 0);
  assert.deepEqual(f.service.timeline(scope, time(100000)), before);
  f.setTime(100030); failed = false; const newer = request('recovery'); newer.triggeredAt = time(100030); const recovered = await f.service.wait(f.service.submit(newer).id);
  const after = f.service.timeline(scope, time(100030)); assert.deepEqual(after.effective, [recovered.output.id]); assert.equal(after.guards[0].blockedUntil.unixMs, 100030);
  assert.deepEqual(f.service.timeline(scope, time(100010)), blocked); // Future clearedAt is not visible.
  await f.service.close();
});

test('a pending replacement may use a still-valid prior output, but its failure creates an actual guard', async () => {
  let reject;
  const f = fixture(input => input.requestId.startsWith('pending/') ? new Promise((_resolve, fail) => { reject = fail; }) : { direction: 'long', reason: 'Old valid signal', evidence: [ref] });
  const old = await f.service.wait(f.service.submit(request('ready')).id); f.setTime(100010); const pending = request('pending'); pending.triggeredAt = time(100010);
  const job = f.service.submit(pending); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(f.service.timeline(scope, time(100010)).effective, [old.output.id]);
  f.setTime(100020); reject(new Error('model timeout')); await f.service.wait(job.id); assert.deepEqual(f.service.timeline(scope, time(100020)).effective, []); await f.service.close();
});

test('first-ever failure has a blocking guard even with no retired signals, and newer failures stay blocked', async () => {
  const f = fixture(() => { throw new Error('offline'); });
  await f.service.wait(f.service.submit(request('first-failure')).id); const first = f.service.timeline(scope, time(100000));
  assert.equal(first.guards.length, 1); assert.deepEqual(first.guards[0].retiredSignals, []); assert.deepEqual(first.guards[0].evidence, [ref]);
  f.setTime(100010); const newer = request('another-failure'); newer.triggeredAt = time(100010); await f.service.wait(f.service.submit(newer).id);
  const second = f.service.timeline(scope, time(100010)); assert.equal(second.guards.length, 2); assert.ok(second.guards.every(guard => guard.blockedUntil.unixMs === Number.MAX_SAFE_INTEGER));
  assert.deepEqual(f.service.timeline(scope, time(100000)), first); await f.service.close();
});

test('superseded late failure cannot block a newer successful channel result', async () => {
  let reject;
  const f = fixture(input => input.requestId.startsWith('slow-failure/') ? new Promise((_resolve, fail) => { reject = fail; }) : { direction: 'short', reason: 'New generation', evidence: [ref] });
  const slow = f.service.submit(request('slow-failure')); await new Promise(resolve => setImmediate(resolve)); f.setTime(100010);
  const newer = request('new-good'); newer.triggeredAt = time(100010); const good = await f.service.wait(f.service.submit(newer).id);
  reject(new Error('old late timeout')); await f.service.wait(slow.id);
  const current = f.service.timeline(scope, time(100010)); assert.deepEqual(current.effective, [good.output.id]); assert.equal(current.guards.length, 0); assert.equal(f.service.get(slow.id).status, 'superseded'); await f.service.close();
});

test('an expired request blocks until recovery, preserving the declared historical failure time', async () => {
  const f = fixture(); const input = request('expired-history'); input.mode = 'historical'; input.triggeredAt = time(1000); input.dataCutoffAt = time(900); input.inputs[0].availableAt = time(800); input.program.ttlMs = 10;
  input.simulation = { id: 'history', parametersDigest: digest('p'), stateDigest: digest('s'), step: 0, latencyMs: 20 };
  const result = await f.service.wait(f.service.submit(input).id); assert.equal(result.status, 'expired'); assert.equal(result.failedAt.unixMs, 1020);
  assert.equal(f.service.timeline(scope, time(1019)).guards.length, 0); assert.equal(f.service.timeline(scope, time(1020)).guards[0].blockedUntil.unixMs, Number.MAX_SAFE_INTEGER);
  await f.service.close();
});

test('restart and explicit cancel persist failure-policy guards instead of silently reviving old outputs', async () => {
  const f = fixture(); const completed = await f.service.wait(f.service.submit(request('completed')).id); await f.service.close();
  const pending = clone(f.host.storage.get('decision_job', completed.id)); pending.id = digest('interrupted-new-job'); pending.revision++; pending.status = 'running'; pending.output = null;
  pending.request.requestId = 'interrupted-new-job'; pending.request.triggeredAt = time(100010); pending.fingerprint = digest(pending.request); f.host.storage.put('decision_job', pending);
  const channel = f.host.storage.get('decision_channel', pending.channel); f.host.storage.put('decision_channel', { ...channel, latestJob: pending.id, revision: pending.revision });
  const restarted = new AgentDecisionService(f.host, { clock: () => 100020 }); assert.equal(restarted.get(pending.id).status, 'interrupted'); assert.equal(f.calls(), 1);
  assert.equal(restarted.timeline(scope, time(100020)).effective.length, 0); assert.equal(restarted.timeline(scope, time(100020)).guards[0].reason, 'decision_interrupted'); await restarted.close();
  let finish; const g = fixture(() => new Promise(resolve => { finish = resolve; })); const job = g.service.submit(request('cancel-me')); await new Promise(resolve => setImmediate(resolve));
  g.setTime(100010); g.service.cancel(job.id, 'User canceled'); assert.equal(g.service.timeline(scope, time(100010)).guards[0].reason, 'decision_canceled');
  finish({ direction: 'long', reason: 'Too late', evidence: [ref] }); await g.service.wait(job.id); assert.equal(g.service.get(job.id).status, 'canceled'); await g.service.close();
});

test('manual run invalidation retires old risk allowances without erasing independent risk sources on ordinary risk updates', async () => {
  const f = fixture(input => input.requestId.startsWith('alpha/') ? { direction: 'long', reason: 'New context', evidence: [ref] }
    : input.requestId.startsWith('cap/') ? { action: 'cap', cap: { value: '1', unit: 'contract' }, reason: 'Position cap', evidence: [ref] }
      : { action: 'allow', reason: 'Context reviewed', evidence: [ref] });
  const risk = request('allow'); risk.program.role = 'risk'; risk.program.id = 'news-risk'; risk.channel = 'news-risk';
  await f.service.wait(f.service.submit(risk).id); const before = f.service.timeline(scope, time(100000));
  f.setTime(100010); const cap = clone(risk); cap.requestId = 'cap'; cap.channel = 'position-risk'; cap.program.id = 'position-risk'; cap.triggeredAt = time(100010);
  await f.service.wait(f.service.submit(cap).id); const withCap = f.service.timeline(scope, time(100015));
  assert.deepEqual(withCap.advice.map(value => value.action), ['allow', 'cap'], 'A risk source cannot discard another source merely by tightening');
  f.setTime(100020); f.service.invalidate(scope, 'Strategy context changed', [ref]);
  assert.deepEqual(f.service.timeline(scope, time(100020)).advice, []);
  assert.deepEqual(f.service.timeline(scope, time(100020)).effective, []);
  f.setTime(100030); const alpha = request('alpha'); alpha.triggeredAt = time(100030); const newSignal = await f.service.wait(f.service.submit(alpha).id);
  const noAllowance = f.service.timeline(scope, time(100030));
  assert.deepEqual(noAllowance.effective, [newSignal.output.id]); assert.deepEqual(noAllowance.advice, [], 'A post-reset Alpha cannot reuse the pre-reset risk allowance');
  f.setTime(100040); risk.requestId = 'new-allow'; risk.triggeredAt = time(100040); await f.service.wait(f.service.submit(risk).id);
  assert.equal(f.service.timeline(scope, time(100040)).advice.length, 1);
  f.setTime(100050); f.service.invalidate(scope, 'Second context change', [ref]);
  assert.deepEqual(f.service.timeline(scope, time(100030)), noAllowance);
  assert.deepEqual(f.service.timeline(scope, time(100015)), withCap);
  assert.deepEqual(f.service.timeline(scope, time(100000)), before); await f.service.close();
});
