import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { isRef, readText, requireThat } from './records.js';

const equal = (a, b) => canonical(a ?? null) === canonical(b ?? null);
const scalar = v => typeof v === 'boolean' || typeof v === 'string' || Number.isFinite(v);
const controls = ['class_name', 'backend', 'development', 'columns', 'config', 'objective', 'constraints'];

// Other coordinates are the exact frozen winner's values. A full Cartesian grid
// already tested the intervention iff its varied axis contained the new value.
function testedOnBaseline(baseline, name, value) {
  const grid = baseline.protocol?.parameter_space, counts = baseline.experiment?.counts;
  if (!grid || typeof grid !== 'object' || Array.isArray(grid) || !(counts?.planned > 0 && counts.completed === counts.planned)) return null;
  if (!Object.hasOwn(grid, name)) return false;
  return Array.isArray(grid[name]) ? grid[name].some(level => equal(level, value)) : null;
}

export async function readExecutionEnvironment(host, manifest, nativeResultRef, signal) {
  const ref = manifest.content?.environment, engine = manifest.content?.engine;
  try {
    requireThat(isRef(ref, 'environment') && manifest.dependencies?.some(item => equal(item, ref)) &&
      ['Backtrader Cerebro', 'Backtrader Cerebro.optstrategy'].includes(engine?.name), 'Missing native Backtrader environment dependency.');
    const [envManifest, metadata] = await Promise.all([host.resources.read(ref, { part: 'manifest' }), host.resources.read(ref, { part: 'metadata' })]);
    const content = envManifest.content;
    requireThat(metadata.producer?.id === 'sesame/backtrader' && equal(metadata.ref, ref) && content?.type === 'backtrader-environment' &&
      content.execution === 'host' && content.path === 'environment.json' && content.version === engine.version, 'Environment receipt and native engine disagree.');
    const env = JSON.parse(await readText(host, ref, content.path, 4 * 1024 * 1024));
    signal?.throwIfAborted();
    requireThat(Array.isArray(env.version) && env.version.length === 3 && env.version.every(v => Number.isSafeInteger(v) && v >= 0) &&
      typeof env.platform === 'string' && env.platform && [32, 64].includes(env.bits) && typeof env.library === 'string' && env.library === engine.version &&
      env.packages && typeof env.packages === 'object' && !Array.isArray(env.packages), 'Environment needs the Python version, platform, architecture and package versions.');
    const packages = new Map(), conflicts = new Set();
    let incompleteEntries = 0;
    for (const [raw, version] of Object.entries(env.packages)) {
      const name = raw.toLowerCase().replace(/[-_.]+/g, '-');
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || typeof version !== 'string' || !version.trim()) { incompleteEntries++; continue; }
      if (packages.has(name) && packages.get(name) !== version) conflicts.add(name);
      packages.set(name, version);
    }
    requireThat(packages.get('backtrader') === env.library && !conflicts.has('backtrader'), 'The recorded Backtrader distribution differs from the engine.');
    const runtime = { pythonVersion: env.version.join('.'), platform: env.platform, bits: env.bits, backtrader: env.library };
    if (incompleteEntries || conflicts.size) return { status: 'snapshot_only', nativeResultRef, ref, ...runtime, incompleteEntries,
      conflictingDistributions: [...conflicts].sort(), reason: 'The package inventory requires an identical pinned environment snapshot for comparison.' };
    const identity = { ...runtime, packagesDigest: digest(Object.fromEntries(packages)), packageCount: packages.size };
    return { status: 'observed', nativeResultRef, ref, ...identity, fingerprint: digest(identity) };
  } catch (error) {
    signal?.throwIfAborted();
    return { status: 'needs_evidence', nativeResultRef, ...(isRef(ref, 'environment') ? { ref } : {}), reason: error.message };
  }
}

function environmentComparison(a, b) {
  function observed(project) {
    const env = project.tradeEvidence?.environment, resultRef = project.experiment?.best?.batchResultRef;
    return env && isRef(resultRef, 'strategy.result') && equal(env.nativeResultRef, resultRef) ? env : null;
  }
  const baseline = observed(a), candidate = observed(b);
  const measured = [baseline, candidate];
  let status = 'needs_evidence', basis = null;
  if (measured.every(env => env?.status === 'observed' && isRef(env.ref, 'environment') && /^sha256:[a-f0-9]{64}$/.test(env.fingerprint))) {
    basis = 'recorded_version_fingerprint'; status = baseline.fingerprint === candidate.fingerprint ? 'matched' : 'different';
  } else if (measured.every(env => env?.status === 'snapshot_only' && isRef(env.ref, 'environment')) && baseline.ref.digest === candidate.ref.digest) {
    // Per-operation resource IDs differ. The digest covers the archived manifest
    // and its environment.json blob, including the interpreter and raw inventory.
    basis = 'identical_pinned_environment_snapshot'; status = 'matched';
  }
  return { status, basis, scope: 'recorded_runtime_and_distribution_versions', baseline, candidate };
}

export function planParameterTrial(baseline, baselineRef, input) {
  const best = baseline?.experiment?.best;
  requireThat(isRef(baselineRef, 'resource') && isRef(baseline?.experiment?.selectionRef, 'resource') && best && baseline.implementation?.nativeHash,
    'A controlled change needs a completed, frozen native development baseline.');
  const name = input.parameter;
  requireThat(Object.hasOwn(best.parameters, name), 'Run the baseline with an explicit value for the parameter you intend to change.');
  requireThat(scalar(input.to) && !equal(best.parameters[name], input.to), 'Choose a different scalar value for the intervention.');
  return { ...input, from: best.parameters[name], baselineRef, baselineSelectionRef: baseline.experiment.selectionRef,
    baselineNativeHash: baseline.implementation.nativeHash, baselineWasSelected: baseline.experiment.counts.planned > 1,
    alreadyTestedOnBaselineGrid: testedOnBaseline(baseline, name, input.to) };
}

export function fixedTrialExperiment(baseline, trial, pythonPath) {
  requireThat(equal(baseline.experiment?.selectionRef, trial.baselineSelectionRef) && baseline.implementation?.nativeHash === trial.baselineNativeHash,
    'The original baseline selection and source must match the registered intervention.');
  const fixed = Object.fromEntries(controls.filter(key => baseline.protocol[key] !== undefined).map(key => [key, baseline.protocol[key]]));
  const python = pythonPath ?? baseline.protocol.python_path;
  return { ...fixed, parameters: { ...baseline.experiment.best.parameters, [trial.parameter]: trial.to },
    parameter_space: {}, max_trials: 1, ...(python ? { python_path: python } : {}) };
}

// A comparison can include unrelated matched controls. Only the precise baseline
// named in the research decision is entitled to the one-parameter attribution.
export function assessParameterTrial(a, b) {
  const trial = b.parameterTrial;
  if (!trial || !equal(a.projectRef, trial.baselineRef)) return null;
  const issues = [];
  if (!equal(a.experiment?.selectionRef, trial.baselineSelectionRef)) issues.push('baselineSelection');
  if (a.implementation?.nativeHash !== trial.baselineNativeHash || b.implementation?.nativeHash !== trial.baselineNativeHash) issues.push('nativeSource');
  if (!equal(a.mandateRef, b.mandateRef)) issues.push('mandate');
  for (const key of ['mode', 'components', 'bindings', 'factors'])
    if (!equal(a.structure?.[key], b.structure?.[key])) issues.push('structure.' + key);
  for (const key of controls) if (!equal(a.protocol?.[key], b.protocol?.[key])) issues.push(key);
  const av = a.experiment?.best?.parameters, bv = b.experiment?.best?.parameters;
  if (!av || !equal(av[trial.parameter], trial.from) || !equal(bv, { ...av, [trial.parameter]: trial.to })
    || !equal(b.protocol?.parameters, bv)) issues.push('parameters');
  if (!equal(b.protocol?.parameter_space, {}) || b.protocol.max_trials !== 1 || b.experiment?.counts?.completed !== 1
    || !isRef(b.experiment?.selectionRef, 'resource')) issues.push('fixedCandidate');
  const environment = environmentComparison(a, b);
  if (environment.status !== 'matched') issues.push('executionEnvironment');
  return { ...trial, alreadyTestedOnBaselineGrid: testedOnBaseline(a, trial.parameter, trial.to), environment, verified: issues.length === 0, issues };
}

export function evaluateTrialMeasure(comparison) {
  const trial = comparison.comparisons?.candidateMinusBaseline?.trial;
  if (!trial?.verified || comparison.status !== 'compared') return;
  const pair = comparison.comparisons.candidateMinusBaseline;
  const change = trial.primary === 'turnover' ? pair.executionDelta?.turnoverOnInitialEquity
    : trial.primary === 'commission' ? pair.executionDelta?.commission : pair.delta[trial.primary];
  const directionalObservation = !Number.isFinite(change) ? 'unavailable' : change === 0 ? 'unchanged'
    : (trial.direction === 'maximize' ? change > 0 : change < 0) ? 'matched' : 'opposite';
  let outcome = 'needs_evidence';
  if (directionalObservation !== 'unavailable') {
    if (trial.alreadyTestedOnBaselineGrid === true) outcome = 'observed_on_grid_retest';
    else if (trial.alreadyTestedOnBaselineGrid !== false) outcome = 'prior_grid_exposure_unknown';
    else outcome = { unchanged: 'unchanged', matched: 'supported_on_development', opposite: 'opposite_on_development' }[directionalObservation];
  }
  return { hypothesis: trial.hypothesis, primary: trial.primary, direction: trial.direction, change: change ?? null, outcome,
    directionalObservation, alreadyTestedOnBaselineGrid: trial.alreadyTestedOnBaselineGrid ?? null,
    mandateObjective: pair.objective, evidence: [comparison.arms.A.nativeResultRef, comparison.arms.B.nativeResultRef] };
}
