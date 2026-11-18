import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMethodWorkflow } from '../../api-v1/packages/strategy-authoring/examples/method-workflow.js';

const hostRoot = process.env.SESAME_HOST_ROOT;
const plugin = 'sesame/strategy-development';
const pkg = fileURLToPath(new URL('../packages/strategy-development', import.meta.url));

test('a freshly installed development plugin plans, builds, replays and replaces one model through the host', { skip: !hostRoot, timeout: 90000 }, async t => {
  const { fixture } = await import(pathToFileURL(join(hostRoot, 'tests/fixture-provider.js')));
  const { createHostContextV2 } = await import(pathToFileURL(join(hostRoot, 'modules/plugins/host-v2/context.js')));
  const app = await fixture();
  t.after(() => app.dispose());
  const { runtime } = app, sessionId = 'conv_main', work = runtime.workspaces.root(sessionId);
  assert.equal(runtime.plugins.entries.has('sesame/auto-factor-mining'), false);
  const draft = join(work, 'development-plugin');
  await cp(pkg, draft, { recursive: true });
  const checked = await runtime.plugins.manager.test(sessionId, { path: draft });
  assert.equal(checked.passed, true, JSON.stringify(checked));
  const installed = await runtime.plugins.manager.install(sessionId, { path: draft, digest: checked.digest });
  assert.equal(installed.id, plugin); assert.equal(installed.runtime_status, 'ready', JSON.stringify(installed.diagnostics));
  runtime.plugins.activate(sessionId, plugin);
  const main = createHostContextV2(runtime, runtime.capabilities.hostEntry, sessionId);
  async function call(name, args) {
    const capability = plugin + '#strategy_development_' + name;
    const result = await main.capabilities.invoke(capability, args);
    if (result.type === 'result') return result.value;
    const { run } = await main.runs.wait(result.run, { until: 'settled', timeoutMs: 30000 });
    assert.equal(run.status, 'completed', JSON.stringify(run.error)); return run.output;
  }
  const plan = await call('plan', {
    operation_id: 'fixture-plan', goal: '标的 SPY。只做多。最大回撤不超过 15%。佣金 1 bp。滑点 2 bp。研究收盘阈值。',
    research_design: { mechanism: 'Breakouts continue from the next tradable price.', rival: 'The effect is only broad market exposure.',
      distinguishing_test: 'Compare opportunities at matched exposure.' },
    design: { strategyId: 'fixture.threshold', components: { alpha: { model: 'close_threshold', settings: { threshold: '10' } } } },
  });
  assert.equal(plan.projectRef.kind, 'resource'); assert.deepEqual(plan.questions, []);
  const inspected = await call('read', { project_ref: plan.projectRef }), initial = inspected.project;
  assert.ok(inspected.diagnostics);
  assert.equal(initial.structure.strategyId, 'fixture.threshold'); assert.deepEqual(initial.structure.factorResolutions, []);
  assert.deepEqual(initial.structure.bindings.riskPolicyRef, plan.mandateRef);
  assert.deepEqual(inspected.validation.factorResearch, []);
  assert.equal(inspected.validation.strategy.holdout, 'not_run');
  assert.ok(initial.structure.gaps.some(gap => gap.missing === 'marketDataRef'));
  assert.equal(initial.structure.gaps.some(gap => gap.code === 'missing_capability'), false);
  assert.ok(initial.structure.interfaces.portfolio.models.includes('inverse_volatility'));
  assert.equal(plan.researchDesign.rival, initial.researchDesign.rival); assert.equal(plan.researchDesign.knownSelectionRef, null);
  assert.ok(plan.next.includes(initial.researchDesign.distinguishing_test));
  const menu = await call('method', {}); assert.equal(menu.methods.length, 9);
  const technique = await call('method', { method: 'hypothesis-design' }); assert.ok(technique.guidance.includes('假突破'));
  const utc = unixMs => ({ basis: 'utc', unixMs });
  const replay = {
    runId: 'fixture-replay', parameters: { instrument: { instrumentId: 'SPY', sourceId: 'fixture' } },
    events: [9, 11].map((n, i) => ({ eventId: 'bar-' + i, sequence: String(i + 1), type: 'bar.closed', input: 'bars', availableAt: utc((i + 1) * 10),
      inputs: { bars: [{ openTime: utc(i * 10), endTime: utc((i + 1) * 10), availableAt: utc((i + 1) * 10), close: String(n) }] } })),
  };
  await writeFile(join(work, 'threshold.replay.json'), JSON.stringify(replay));
  const built = await call('build', { operation_id: 'fixture-build', project_ref: plan.projectRef, replay_path: 'threshold.replay.json' });
  assert.equal(built.implementation.sourceRef.kind, 'strategy.source'); assert.equal(built.implementation.replay.status, 'completed');
  assert.equal(built.implementation.replay.nativeEngineExecuted, false);
  const temporal = await call('verify', { operation_id: 'fixture-time-check', project_ref: built.projectRef,
    event_ids: ['bar-1'], warmup_lengths: [1], trace_nodes: ['close'] });
  assert.equal(temporal.assessment.status, 'agreed_at_checkpoints', JSON.stringify(temporal.assessment));
  const checkedProject = await call('read', { project_ref: temporal.projectRef });
  assert.deepEqual(checkedProject.validation.strategy.temporalCheck.ref, temporal.assessment.ref);
  const source = await main.resources.read(built.implementation.sourceRef, { part: 'manifest' });
  assert.equal(source.content.sourceDigest, built.implementation.sourceDigest); assert.equal(source.content.strategyId, 'fixture.threshold');
  const revised = await call('plan', { operation_id: 'fixture-revise', project_ref: built.projectRef,
    replace: { slot: 'alpha', component: { model: 'moving_average', settings: { fastPeriod: 2, slowPeriod: 3 } } } });
  const project = (await call('read', { project_ref: revised.projectRef })).project;
  assert.deepEqual(Object.keys(project.structure.components).filter(slot =>
    JSON.stringify(project.structure.components[slot]) !== JSON.stringify(initial.structure.components[slot])), ['alpha']);
  assert.deepEqual(project.mandateRef, initial.mandateRef);
  assert.equal(project.implementation, null);
  const rebuilt = await call('build', { operation_id: 'fixture-rebuild', project_ref: revised.projectRef });
  assert.notEqual(rebuilt.implementation.sourceDigest, built.implementation.sourceDigest);
  const parent = await main.resources.read(rebuilt.implementation.sourceRef, { part: 'manifest' });
  assert.deepEqual(parent.content.parent, built.implementation.sourceRef);
  const old = (await call('read', { project_ref: built.projectRef })).project;
  assert.equal(old.structure.components.alpha.model, 'close_threshold');
  assert.deepEqual(old.implementation.replay.ref, built.implementation.replay.ref);
  // The existing method fixture pins all observations and uses two fictional instruments.
  const demo = kind => runtime.contractArtifacts.publish({ id: 'fixture/strategy-methods', version: '1.0.0' }, {
    operationId: 'fixture-' + kind, manifest: { kind, schemaVersion: '1.0.0',
      content: { type: 'teaching-inputs', provenance: { kind: 'demo' } }, blobs: [], dependencies: [], provenance: { kind: 'demo', references: [] } },
  });
  const evidence = demo('resource'), target = demo('strategy.target');
  const fixed = createMethodWorkflow({ strategySource: built.implementation.sourceRef, strategyId: 'fixture.threshold', evidence, targetProfile: target });
  const methodPlan = await call('plan', { operation_id: 'fixture-methods', project_ref: built.projectRef,
    design: { bindings: { workflowFixture: fixed, marketDataRef: evidence, candidateSnapshotRef: evidence, riskPolicyRef: evidence,
      costModelRef: evidence, confidenceRef: evidence, targetProfileRef: target } } });
  const equal = await call('build', { operation_id: 'fixture-equal', project_ref: methodPlan.projectRef });
  const alternative = await call('plan', { operation_id: 'fixture-weight', project_ref: equal.projectRef, replace: { slot: 'portfolio', component: 'confidence' } });
  const confidence = await call('build', { operation_id: 'fixture-confidence', project_ref: alternative.projectRef });
  async function targetQuantities(project) {
    const { ref, nativeEngineExecuted } = project.implementation.methodCheck;
    assert.equal(nativeEngineExecuted, false);
    const file = await main.resources.read(ref, { part: 'content', entry: 'pipeline.json', encoding: 'utf8' });
    return JSON.parse(file.content).target.items.map(item => item.quantity.value);
  }
  assert.deepEqual(await targetQuantities(equal), ['5', '25']);
  assert.deepEqual(await targetQuantities(confidence), ['2', '37']);
  assert.deepEqual(confidence.implementation.sourceRef, equal.implementation.sourceRef, 'a portfolio change retains the verified signal source');
  const factorDraft = join(work, 'factor-plugin');
  await cp(fileURLToPath(new URL('../packages/auto-factor-mining', import.meta.url)), factorDraft, { recursive: true });
  const factorCheck = await runtime.plugins.manager.test(sessionId, { path: factorDraft });
  assert.equal(factorCheck.passed, true, JSON.stringify(factorCheck));
  const factorInstall = await runtime.plugins.manager.install(sessionId, { path: factorDraft, digest: factorCheck.digest });
  assert.equal(factorInstall.runtime_status, 'ready'); runtime.plugins.activate(sessionId, factorInstall.id);
  const registered = await main.capabilities.invoke(factorInstall.id + '#factor_library', { action: 'register', operationId: 'fixture-factor',
    formula: { dsl: 'qlib-expr/1', tree: { field: 'close' } }, name: 'Worksheet close', hypothesis: 'A fixture definition with no archived evaluation.', sources: [], changes: 'Original definition.' });
  const factor = registered.value;
  const requested = { factorId: factor.id, definitionDigest: factor.definitionDigest, purpose: 'entry_filter',
    sourcePartition: 'development', evaluationId: 'unarchived', consumption: { inputFields: ['close'], decisionTime: 'bar close', transform: 'level', missingPolicy: 'skip' },
    implementation: { mode: 'svl_function', ref: evidence, validationRef: evidence } };
  const factorPlan = await call('plan', { operation_id: 'fixture-factor-use', project_ref: plan.projectRef, design: { factors: [requested] } });
  const factorProject = (await call('read', { project_ref: factorPlan.projectRef })).project;
  assert.equal(factorProject.structure.factorResolutions[0].status, 'evidence_gap');
  assert.equal(factorProject.structure.factorResolutions[0].gap.missing, 'evaluationId');
  assert.equal(factorPlan.validation.factorResearch[0].status, 'not_verified');
  assert.equal(factorPlan.validation.strategy.nativeSelectionRef, null);
  assert.deepEqual(app.requests, []);
});
