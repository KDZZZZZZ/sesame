import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { buildMandate } from './mandate.js';
import { buildStructure, factorIntegrationGap, replaceComponent, verifyFactorUses } from './structure.js';
import { collectRefs, isRef, publishRecord, readRecord, requireThat } from './records.js';
import { planParameterTrial } from './revision-trial.js';

export const PROJECT = 'strategy-development.project';
const MANDATE = 'strategy-development.mandate';
export const loadProject = (host, ref) => readRecord(host, ref, PROJECT);
export const loadMandate = (host, ref) => readRecord(host, ref, MANDATE);

function holdoutStatus(experiment) {
  const h = experiment?.holdout;
  if (!h) return 'not_run';
  if (h.status === 'completed' || h.status === 'constraints-failed') {
    const outcome = h.status === 'completed' ? 'completed' : 'failed';
    if (experiment.status !== outcome || !isRef(h.resultRef, 'strategy.result') || !isRef(h.recordRef, 'resource')) return 'pending';
  }
  return h.status;
}

export function validationSummary(project) {
  const { structure, implementation, experiment } = project;
  const unavailable = new Set(structure.gaps.filter(item => item.unavailableRef).map(item => canonical(item.unavailableRef)));
  return {
    factorResearch: structure.factors.map((use, index) => ({
      factorId: use.factorId ?? null, evaluationId: use.evaluationId ?? null, owner: 'sesame/auto-factor-mining',
      status: structure.factorResolutions[index].verification === 'factor_library_development_evaluation' ? 'verified_development_evidence' : 'not_verified',
    })),
    integration: structure.factors.map((use, index) => {
      const issue = factorIntegrationGap(use, index);
      const missingRef = collectRefs([use.implementation, use.consumption]).find(ref => unavailable.has(canonical(ref)));
      const linked = !issue && !missingRef;
      return { purpose: use.purpose, factorId: use.factorId ?? null, status: linked ? 'evidence_supplied_for_review' : 'needs_comparison',
        comparisonRef: linked ? use.implementation.validationRef : null, missing: issue?.missing ?? missingRef?.id ?? null };
    }),
    strategy: { svlSourceRef: implementation?.sourceRef ?? null, fixedEventReplay: implementation?.replay ?? null,
      temporalCheck: implementation?.temporalCheck ?? null,
      fixedPortfolioEvaluation: implementation?.methodCheck ?? null, nativeSelectionRef: experiment?.selectionRef ?? null,
      nativeScope: experiment?.validationScope ?? null, holdout: holdoutStatus(experiment),
      pendingMandateChecks: project.mandate.experiment.unverifiedConstraints, deploymentAuthorized: false },
  };
}

function stage(project) {
  if (project.mandate.questions.length) return 'mandate';
  if (holdoutStatus(project.experiment) === 'completed') return 'review';
  if (project.parameterTrial && !project.experiment) return 'test_single_change';
  if (project.parameterTrial && project.experiment?.status === 'selected') return 'compare_single_change';
  if (project.experiment?.status === 'selected') return 'independent_confirmation';
  if (project.experiment) return 'diagnosis';
  if (project.implementation?.nativeSourceRef) return 'native_backtest';
  if (project.implementation?.sourceRef) return 'target_implementation';
  return 'strategy_design';
}

export async function saveProject(host, project, previousRef, operationId) {
  const body = { ...project, version: project.version + 1, previousRef: previousRef ?? null, stage: stage(project) };
  const absent = new Set(body.structure.gaps.filter(gap => gap.unavailableRef).map(gap => canonical(gap.unavailableRef)));
  const experiment = body.experiment;
  const dependencies = collectRefs([body.previousRef, body.mandateRef, body.parentSourceRef, body.structure, body.implementation, body.parameterTrial, body.researchDesign, body.designStudy,
    experiment?.protocolRef, experiment?.selectionRef, experiment?.holdout, ...(experiment?.selectionRef ? [] : experiment?.batches?.map(batch => batch.resultRef) ?? [])])
    .filter(ref => !absent.has(canonical(ref)));
  const projectRef = await publishRecord(host, PROJECT, body, operationId, dependencies);
  return { projectRef, version: body.version, stage: body.stage, mandateRef: body.mandateRef,
    ...(body.researchDesign ? { researchDesign: body.researchDesign } : {}),
    ...(body.designStudy ? { designStudy: body.designStudy } : {}),
    questions: body.mandate.questions, gaps: [...body.mandate.gaps, ...body.structure.gaps], next: nextAction(body), validation: validationSummary(body),
    ...(body.parameterTrial ? { parameterTrial: body.parameterTrial } : {}), ...(body.implementation ? { implementation: body.implementation } : {}),
    ...(body.experiment ? { experiment: body.experiment } : {}) };
}

function nextAction(p) {
  switch (stage(p)) {
    case 'mandate': return p.mandate.questions;
    case 'test_single_change': return ['Run strategy_development_backtest with backend backtrader and planned_trial true to reuse the frozen baseline.'];
    case 'compare_single_change': return ['Compare this development result against parameterTrial.baselineRef. Check the predicted mechanism and the mandate objective before opening a holdout.'];
    case 'strategy_design': return p.designStudy ? [...new Set(Object.values(p.designStudy.interpretation).map(item => item.nextTest))]
      : [p.researchDesign?.distinguishing_test ?? 'Use hypothesis-design to distinguish the proposed market mechanism from another explanation for the same behavior.',
        'Choose a minimal baseline that can falsify that prediction, then use strategy_development_build.'];
    case 'target_implementation': return ['Verify fixed events and supply an authored native implementation. For MT5 first freeze a target, translation, build and conformance evidence.'];
    case 'native_backtest': return ['Run strategy_development_backtest on a fixed development partition with the agreed objective, costs and parameter budget.'];
    case 'independent_confirmation': return ['Compare controlled variants on development data, then confirm the frozen selection on a subsequent untouched partition.'];
    case 'diagnosis': return p.experiment.gaps?.length ? p.experiment.gaps : ['Inspect failed constraints and run evidence before revising a single component.'];
    default: return ['Review holdout results, outstanding mandate checks and target conformance. Keep the candidate and its evidence for a separate paper evaluation.'];
  }
}

function chooseMode(goal) {
  if (/hybrid|混合/i.test(goal)) return 'hybrid';
  if (/state.machine|状态机|追踪止损|trailing stop|订单状态/i.test(goal)) return 'state_machine';
  return 'framework';
}

function designInput(previous, design, goal, identity) {
  const mode = design?.mode ?? previous?.mode ?? chooseMode(goal);
  const sameMode = previous?.mode === mode;
  return { strategyId: previous?.strategyId ?? design?.strategyId ?? identity, mode,
    components: { ...(sameMode ? previous.components : {}), ...design?.components },
    bindings: { ...previous?.bindings, ...design?.bindings }, factors: design?.factors ?? previous?.factors ?? [] };
}

async function availableModels(host, design, replacement) {
  const plugins = new Set(['sesame/strategy-authoring']);
  for (const value of [...Object.values(design.components), replacement]) {
    const target = value?.settings?.capability;
    if (typeof target === 'string' && target.includes('#')) plugins.add(target.split('#')[0]);
  }
  const ids = [];
  for (const pluginId of plugins) {
    let cursor;
    do {
      const { items, nextCursor } = await host.capabilities.list({ pluginId, limit: 200, ...(cursor ? { cursor } : {}) });
      ids.push(...items.map(item => item.id));
      requireThat(!nextCursor || nextCursor !== cursor, 'Capability inventory cursor did not advance.');
      cursor = nextCursor;
    } while (cursor);
  }
  return ids;
}

export async function planProject(host, input, signal) {
  const previous = input.project_ref ? await loadProject(host, input.project_ref) : null;
  const goal = input.goal?.trim() || previous?.goal;
  requireThat(goal, 'Supply a research goal to start a project.');
  requireThat(!input.replace || previous, 'Replace a component on a fixed prior project.');
  requireThat(!(input.replace && input.design?.components?.[input.replace.slot] !== undefined), 'Choose one replacement for the same slot.');
  requireThat(!previous || !input.design?.strategyId || input.design.strategyId === previous.structure.strategyId,
    'Keep the strategy identity across revisions or start a new project.');
  const mandate = previous && !input.mandate && goal === previous.goal ? previous.mandate
    : buildMandate({ ...input.mandate, brief: [input.goal, input.mandate?.brief].filter(Boolean).join('\n') || undefined }, previous?.mandate);
  const mandateChanged = !previous || canonical(previous.mandate) !== canonical(mandate);
  const mandateRef = mandateChanged
    ? await publishRecord(host, MANDATE, mandate, input.operation_id, previous ? [previous.mandateRef] : []) : previous.mandateRef;
  const design = designInput(previous?.structure, input.design, goal, 'research.' + digest(input.operation_id).slice(7, 23));
  // A mandate with known limits or costs is already the exact policy document for those terms.
  const limits = ['maxDrawdown', 'maxGrossExposure', 'maxNetExposure', 'maxPositionExposure', 'leverage'];
  const policyBindings = { riskPolicyRef: limits.some(key => mandate.fields[key] != null),
    costModelRef: mandate.fields.costs.commission != null && mandate.fields.costs.slippage != null };
  for (const [key, applicable] of Object.entries(policyBindings)) {
    if (input.design?.bindings?.[key]) continue;
    const old = design.bindings[key];
    if (!old || previous && canonical(old) === canonical(previous.mandateRef)) {
      if (applicable) design.bindings[key] = mandateRef;
      else delete design.bindings[key];
    }
  }
  design.availableCapabilities = await availableModels(host, design, input.replace?.component);
  let structure = buildStructure(design);
  if (input.replace) structure = replaceComponent(structure, input.replace.slot, input.replace.component);
  structure = await verifyFactorUses(host, structure, signal);
  for (const ref of collectRefs([structure.components, structure.bindings, structure.factors])) {
    try { await host.resources.read(ref, { part: 'manifest' }); }
    catch (error) {
      signal?.throwIfAborted();
      structure.status = 'needs_inputs';
      structure.gaps.push({ code: 'missing_fixed_input', component: 'bindings', missing: ref.id, unavailableRef: ref,
        impact: 'Could not read the pinned ' + ref.kind + ' input.', next: 'Retrieve the original artifact or bind a verified replacement.', diagnostic: error.message });
    }
  }
  const designKey = s => digest([s.mode, s.components, s.bindings, s.factors]);
  const designChanged = !previous || designKey(previous.structure) !== designKey(structure);
  let parameterTrial = null;
  if (input.parameter_trial) {
    requireThat(previous && !designChanged && !mandateChanged && goal === previous.goal,
      'Register a single parameter change on the frozen baseline under the same mandate and component design.');
    parameterTrial = planParameterTrial(previous, input.project_ref, input.parameter_trial);
  } else if (previous && !designChanged && !mandateChanged && goal === previous.goal) parameterTrial = previous.parameterTrial ?? null;
  // A new mandate can change eligibility while the executable remains identical.
  // A changed design needs an explicit new build before it can claim any native result.
  const keepImplementation = previous && !designChanged;
  const sameCandidate = keepImplementation && !mandateChanged && goal === previous.goal && !input.parameter_trial;
  let implementation = keepImplementation ? previous.implementation : null;
  // A generated signal source has a known scope. Replacing only portfolio or risk
  // can retain its identical bytes and fixed-event test while the native candidate is rebuilt.
  if (!keepImplementation && previous?.implementation?.scope === 'svl_signal_and_rule_state'
      && structure.starterSource && canonical(structure.starterSource) === canonical(previous.structure.starterSource)
      && canonical(structure.factors) === canonical(previous.structure.factors)
      && canonical(structure.bindings.marketDataRef ?? null) === canonical(previous.structure.bindings.marketDataRef ?? null)) {
    const { sourceRef, sourceDigest, scope, sourcePath, replay, temporalCheck } = previous.implementation;
    implementation = { sourceRef, sourceDigest, scope, sourcePath, ...(replay ? { replay } : {}), ...(temporalCheck ? { temporalCheck } : {}) };
  }
  const project = { goal, projectKey: previous?.projectKey ?? digest(['strategy-development', input.operation_id]),
    strategyIdChosen: previous?.strategyIdChosen ?? Boolean(input.design?.strategyId),
    version: previous?.version ?? 0, mandateRef, mandate, structure, implementation, parameterTrial,
    researchDesign: input.research_design ? { ...input.research_design, recordedFrom: input.project_ref ?? null,
      knownSelectionRef: previous?.experiment?.selectionRef ?? null, knownDesignStudyRef: previous?.designStudy?.ref ?? null } : previous?.researchDesign ?? null,
    designStudy: previous && !input.research_design && !designChanged && !mandateChanged && goal === previous.goal ? previous.designStudy ?? null : null,
    parentSourceRef: previous?.implementation?.sourceRef ?? previous?.parentSourceRef ?? null,
    experiment: sameCandidate ? previous.experiment : null,
    protocol: sameCandidate ? previous.protocol : null,
    consumedHoldouts: previous?.consumedHoldouts ?? [],
    revision: { reason: input.reason ?? input.parameter_trial?.hypothesis ?? (previous ? 'Update the research design or its inputs.' : goal),
      slot: input.replace?.slot ?? null, invalidated: structure.invalidated ?? (designChanged && previous ? ['implementation', 'native_backtest'] : []) } };
  return saveProject(host, project, input.project_ref, input.operation_id);
}
