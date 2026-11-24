import { formatRef, parseToken, ARTIFACT_NAME, OUTCOME_NAME } from './definition.mjs';

// Pure plan arithmetic. Nothing here reads the host or remembers a previous answer.

const clone = value => structuredClone(value);
const artifactOf = (plan, name) => {
  const artifact = plan.artifacts[name];
  return artifact && !artifact.expired && artifact.version > 0 ? artifact : null;
};

export function constraintsOf(definition, name) {
  const found = new Set();
  for (const step of Object.values(definition.steps)) {
    for (const ref of [...step.requires, ...step.requires_any, ...step.requires_if_valid]) {
      if (ref.name === name && ref.outcome) found.add(ref.outcome);
    }
  }
  return [...found];
}

export function stepActive(definition, plan, name) {
  const step = definition.steps[name];
  return Boolean(step) && (!step.when || plan.conditions?.[step.when] === true);
}

export function goalNames(definition, plan) {
  const names = new Set([definition.goal, ...(definition.goals ?? [])]);
  for (const step of Object.values(definition.steps)) {
    if (step.when && plan.conditions?.[step.when] === true) for (const product of step.produces) names.add(product);
  }
  return [...names];
}

export function requirementAvailable(definition, plan, name) {
  const artifact = artifactOf(plan, name);
  return { available: Boolean(artifact), valid: Boolean(artifact) && !contradicts(definition, name, artifact), outcome: artifact?.outcome ?? null };
}

function contradicts(definition, name, artifact) {
  const required = constraintsOf(definition, name);
  if (!required.length) return false;
  if (!artifact?.outcome) return true;
  return required.some(outcome => outcome !== artifact.outcome);
}

function isValid(definition, plan, name) {
  const artifact = artifactOf(plan, name);
  return Boolean(artifact) && !contradicts(definition, name, artifact);
}

export function gateOpen(definition, plan, step) {
  return step.requires.every(ref => isValid(definition, plan, ref.name));
}

function satisfied(plan, ref) {
  const artifact = artifactOf(plan, ref.name);
  return Boolean(artifact) && (!ref.outcome || artifact.outcome === ref.outcome);
}

function producerStatus(definition, plan, name) {
  const producer = definition.producers[name];
  if (!producer) return null;
  return plan.steps[producer]?.status ?? 'pending';
}

function issuesFor(definition, plan, step) {
  const issues = [];
  const add = (ref, mode) => {
    if (satisfied(plan, ref)) return;
    const artifact = artifactOf(plan, ref.name);
    const producer = definition.producers[ref.name] ?? null;
    if (artifact && ref.outcome && artifact.outcome !== ref.outcome) {
      issues.push({ type: 'outcome', artifact: ref.name, actual: artifact.outcome ?? '未标明', required: ref.outcome, producer, mode });
      return;
    }
    if (!producer) {
      issues.push({ type: 'external', artifact: ref.name, mode });
      return;
    }
    const status = plan.steps[producer]?.status ?? 'pending';
    if (status === 'running') issues.push({ type: 'running', step: producer, artifact: ref.name, mode });
    else if (status === 'failed') issues.push({ type: 'failed', step: producer, artifact: ref.name, mode });
    else if (status === 'skipped') issues.push({ type: 'skipped', step: producer, artifact: ref.name, mode });
    else issues.push({ type: 'wait', step: producer, artifact: ref.name, mode });
  };
  for (const ref of step.requires) add(ref, 'all');
  if (step.requires_any.length && !step.requires_any.some(ref => satisfied(plan, ref))) {
    for (const ref of step.requires_any) add(ref, 'any');
  }
  if (gateOpen(definition, plan, step)) {
    for (const ref of step.requires_if_valid) {
      if (satisfied(plan, ref)) continue;
      const producer = definition.producers[ref.name];
      if (producer && plan.steps[producer]?.status === 'skipped') continue;
      add(ref, 'if');
    }
  }
  return issues;
}

function waivedBySkip(definition, plan, step, ref) {
  const producer = definition.producers[ref.name];
  return Boolean(producer) && plan.steps[producer]?.status === 'skipped' && gateOpen(definition, plan, step);
}

export function dependencyMet(definition, plan, name) {
  const step = definition.steps[name];
  if (!step) return false;
  if (step.requires.some(ref => !satisfied(plan, ref))) return false;
  if (step.requires_any.length && !step.requires_any.some(ref => satisfied(plan, ref))) return false;
  if (gateOpen(definition, plan, step)) {
    for (const ref of step.requires_if_valid) {
      if (!satisfied(plan, ref) && !waivedBySkip(definition, plan, step, ref)) return false;
    }
  }
  return true;
}

// Unfinished steps that still sit on a reverse path to an unmet goal.
// requires_if_valid is always a path edge, including when its gate is closed.
export function necessaryUnfinished(definition, plan) {
  const available = (name, outcome = null) => satisfied(plan, { name, outcome });
  const queue = [];
  const seen = new Set();
  for (const name of goalNames(definition, plan)) if (!available(name)) queue.push(name);
  const needed = new Set();
  while (queue.length) {
    const artifact = queue.pop();
    if (seen.has(artifact)) continue;
    seen.add(artifact);
    const producer = definition.producers[artifact];
    if (!producer || !stepActive(definition, plan, producer)) continue;
    const status = plan.steps[producer]?.status;
    if (status === 'done' || status === 'skipped') continue;
    needed.add(producer);
    const step = definition.steps[producer];
    for (const ref of step.requires) if (!available(ref.name, ref.outcome)) queue.push(ref.name);
    if (step.requires_any.length && !step.requires_any.some(ref => available(ref.name, ref.outcome))) {
      for (const ref of step.requires_any) queue.push(ref.name);
    }
    for (const ref of step.requires_if_valid) {
      const skipped = definition.producers[ref.name] && plan.steps[definition.producers[ref.name]]?.status === 'skipped';
      if (!available(ref.name, ref.outcome) && !skipped) queue.push(ref.name);
    }
  }
  return needed;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function reasonFor(issues, unreachable) {
  const running = unique(issues.filter(issue => issue.type === 'running').map(issue => issue.step));
  if (running.length) return { kind: 'running', vars: { steps: running } };
  const failed = unique(issues.filter(issue => issue.type === 'failed').map(issue => issue.step));
  if (failed.length) return { kind: 'failed', vars: { steps: failed } };
  const waiting = unique(issues.filter(issue => issue.type === 'wait' && !unreachable.has(issue.step)).map(issue => issue.step));
  if (waiting.length) return { kind: 'wait', vars: { steps: waiting } };
  const external = issues.filter(issue => issue.type === 'external');
  if (external.length) {
    const mode = external.every(issue => issue.mode === 'any') ? '任一' : '全部';
    return { kind: 'external', vars: { inputs: unique(external.map(issue => issue.artifact)), mode } };
  }
  const outcome = issues.find(issue => issue.type === 'outcome');
  if (outcome) return { kind: 'outcome', vars: { artifact: outcome.artifact, actual: outcome.actual, required: outcome.required } };
  const skipped = unique(issues.filter(issue => issue.type === 'skipped').map(issue => issue.step));
  if (skipped.length) return { kind: 'skipped', vars: { steps: skipped } };
  const blocked = unique(issues.filter(issue => issue.type === 'wait' && unreachable.has(issue.step)).map(issue => issue.step));
  if (blocked.length) return { kind: 'wait', vars: { steps: blocked } };
  return { kind: 'wait', vars: { steps: [] } };
}

function unreachableSet(definition, plan, names) {
  const unreachable = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of names) {
      if (unreachable.has(name)) continue;
      const status = plan.steps[name]?.status ?? 'pending';
      if (status !== 'pending') continue;
      const issues = issuesFor(definition, plan, definition.steps[name]);
      if (!issues.length) continue;
      const resolvable = issues.some(issue => issue.type === 'external' || issue.type === 'failed' || issue.type === 'running'
        || (issue.type === 'wait' && !unreachable.has(issue.step)));
      const blocked = issues.some(issue => issue.type === 'outcome' || issue.type === 'skipped' || (issue.type === 'wait' && unreachable.has(issue.step)));
      if (!resolvable && blocked) { unreachable.add(name); changed = true; }
    }
  }
  return unreachable;
}

function goalsMet(definition, plan) {
  return goalNames(definition, plan).every(name => artifactOf(plan, name));
}

function explainBlock(definition, plan) {
  const unmet = goalNames(definition, plan).filter(name => !artifactOf(plan, name));
  const queue = unmet.map(name => ({ artifact: name, depth: 0 }));
  const seen = new Set();
  let external = [];
  while (queue.length) {
    const { artifact } = queue.shift();
    if (seen.has(artifact)) continue;
    seen.add(artifact);
    if (artifactOf(plan, artifact)) continue;
    const producer = definition.producers[artifact];
    if (!producer) { external.push(artifact); continue; }
    const status = plan.steps[producer]?.status;
    if (status === 'skipped') return { kind: 'skipped', vars: { artifact, step: producer }, rework: reworkSteps(definition, plan) };
    const step = definition.steps[producer];
    const outcome = issuesFor(definition, plan, step).find(issue => issue.type === 'outcome');
    if (outcome) return { kind: 'outcome', vars: { step: producer, artifact: outcome.artifact, required: outcome.required, actual: outcome.actual }, rework: reworkSteps(definition, plan) };
    if (status === 'failed' || status === 'pending' || status === 'running' || status === undefined) {
      for (const ref of [...step.requires, ...step.requires_any, ...step.requires_if_valid]) queue.push({ artifact: ref.name });
    }
  }
  if (external.length) return { kind: 'external', vars: { inputs: unique(external) }, rework: [] };
  return { kind: 'external', vars: { inputs: unmet }, rework: reworkSteps(definition, plan) };
}

function reworkSteps(definition, plan) {
  const ancestors = new Set();
  const queue = goalNames(definition, plan).slice();
  const seen = new Set();
  while (queue.length) {
    const artifact = queue.pop();
    if (seen.has(artifact)) continue;
    seen.add(artifact);
    const producer = definition.producers[artifact];
    if (!producer || !stepActive(definition, plan, producer) || ancestors.has(producer)) continue;
    ancestors.add(producer);
    const step = definition.steps[producer];
    for (const ref of [...step.requires, ...step.requires_any, ...step.requires_if_valid]) queue.push(ref.name);
  }
  const order = new Map(Object.keys(definition.steps).map((name, index) => [name, index]));
  return [...ancestors].filter(name => plan.steps[name]?.status === 'done').sort((a, b) => order.get(a) - order.get(b));
}

function freshStep() {
  return { status: 'pending', iteration: 0, consumed: null, runs: [], note: null, violation: false, startedAt: null, endedAt: null, fallbackTo: null, fallbackPlanId: null };
}

export function syncActivation(definition, plan) {
  for (const name of Object.keys(definition.steps)) {
    if (stepActive(definition, plan, name) && !plan.steps[name]) plan.steps[name] = freshStep();
  }
}

function snapshotConsumed(definition, plan, name) {
  const step = definition.steps[name];
  const refs = [...step.requires];
  const chosen = step.requires_any.find(ref => satisfied(plan, ref));
  if (chosen) refs.push(chosen);
  if (gateOpen(definition, plan, step)) refs.push(...step.requires_if_valid.filter(ref => satisfied(plan, ref) || artifactOf(plan, ref.name)));
  const consumed = {};
  for (const ref of refs) {
    const artifact = artifactOf(plan, ref.name);
    if (artifact) consumed[ref.name] = artifact.version;
  }
  return consumed;
}

function stale(plan, state) {
  if (!state?.consumed) return false;
  return Object.entries(state.consumed).some(([name, version]) => {
    const artifact = plan.artifacts[name];
    return !artifact || artifact.expired || artifact.version !== version;
  });
}

export function propagateExpiry(definition, plan) {
  const expiredArtifacts = [];
  const resetSteps = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, state] of Object.entries(plan.steps)) {
      if (state.status !== 'done' || !stale(plan, state)) continue;
      const staleNames = Object.entries(state.consumed).filter(([artifact, version]) => {
        const current = plan.artifacts[artifact];
        return !current || current.expired || current.version !== version;
      }).map(([artifact]) => artifact);
      for (const product of definition.steps[name].produces) {
        const artifact = plan.artifacts[product];
        if (artifact && !artifact.expired && artifact.step === name) {
          artifact.expired = true;
          expiredArtifacts.push(product);
          changed = true;
        }
      }
      state.status = 'pending';
      state.iteration += 1;
      state.consumed = null;
      state.runs = [];
      state.note = null;
      state.violation = false;
      state.violationMissing = null;
      state.startedAt = null;
      state.endedAt = null;
      state.fallbackTo = null;
      state.fallbackPlanId = null;
      resetSteps.push({ step: name, because: staleNames });
      changed = true;
    }
  }
  return { expiredArtifacts: unique(expiredArtifacts), resetSteps };
}

function markReused(definition, plan) {
  const reusedSteps = [];
  const artifacts = [];
  for (const [name, step] of Object.entries(definition.steps)) {
    if (!stepActive(definition, plan, name)) continue;
    const state = plan.steps[name];
    if (!state || !['pending', 'failed'].includes(state.status)) continue;
    if (!step.produces.every(product => artifactOf(plan, product))) continue;
    state.status = 'done';
    state.iteration = 0;
    state.consumed = snapshotConsumed(definition, plan, name);
    state.endedAt = state.endedAt ?? plan.updatedAt ?? null;
    reusedSteps.push(name);
    artifacts.push(...step.produces);
  }
  return { steps: reusedSteps, artifacts: unique(artifacts) };
}

export function knownArtifacts(definition) {
  return definition.artifacts ?? [...new Set([...Object.keys(definition.producers), ...definition.externals])];
}

export function closestName(needle, options) {
  const text = String(needle);
  let best = null, score = Infinity;
  for (const option of options) {
    const distance = editDistance(text, option);
    const prefix = option.startsWith(text) || text.startsWith(option);
    const ranked = distance * (prefix ? 0.5 : 1);
    if (ranked < score) { score = ranked; best = option; }
  }
  return best;
}

function editDistance(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const saved = row[j];
      row[j] = left[i - 1] === right[j - 1] ? previous : Math.min(previous, row[j], row[j - 1]) + 1;
      previous = saved;
    }
  }
  return row[right.length];
}

function reject(code, vars) {
  return { ok: false, error: { code, vars } };
}

export function parseHaveList(definition, tokens = [], refs = {}, scope = '工作流') {
  const parsed = [];
  const seen = new Map();
  for (const token of tokens) {
    const ref = parseToken(token);
    if (!ARTIFACT_NAME.test(ref.name) || (ref.outcome !== null && !OUTCOME_NAME.test(ref.outcome))) {
      return reject('unknown_artifact', { artifact: token, scope, suggestion: closestName(ref.name, knownArtifacts(definition)), artifacts: knownArtifacts(definition) });
    }
    if (!knownArtifacts(definition).includes(ref.name)) {
      return reject('unknown_artifact', { artifact: ref.name, scope, suggestion: closestName(ref.name, knownArtifacts(definition)), artifacts: knownArtifacts(definition) });
    }
    const allowed = definition.outcomes[ref.name];
    if (allowed && !ref.outcome) return reject('outcome_required', { artifact: ref.name, outcomes: allowed });
    if (ref.outcome && allowed && !allowed.includes(ref.outcome)) return reject('invalid_outcome', { artifact: ref.name, outcome: ref.outcome, outcomes: allowed });
    if (ref.outcome && !allowed) return reject('invalid_outcome', { artifact: ref.name, outcome: ref.outcome, outcomes: [] });
    if (seen.has(ref.name) && seen.get(ref.name) !== (ref.outcome ?? '')) return reject('invalid_outcome', { artifact: ref.name, outcome: ref.outcome, outcomes: allowed ?? [] });
    seen.set(ref.name, ref.outcome ?? '');
    parsed.push(ref);
  }
  for (const name of Object.keys(refs ?? {})) {
    if (!knownArtifacts(definition).includes(name)) return reject('unknown_artifact', { artifact: name, scope, suggestion: closestName(name, knownArtifacts(definition)), artifacts: knownArtifacts(definition) });
    if (typeof refs[name] !== 'string' || !refs[name].trim() || refs[name].length > 500) return reject('invalid_plan', { detail: `引用 ${name} 必须是不超过 500 字的定位信息` });
  }
  return { ok: true, refs: parsed };
}

function putHave(plan, definition, refs, links) {
  for (const ref of refs) {
    const previous = plan.artifacts[ref.name];
    const outcome = ref.outcome ?? (previous && !previous.expired ? previous.outcome : null);
    const changed = !previous || previous.expired || (Boolean(ref.outcome) && previous.outcome !== ref.outcome);
    plan.artifacts[ref.name] = {
      version: changed ? (previous?.version ?? 0) + 1 : previous.version,
      outcome,
      origin: changed ? 'have' : previous.origin,
      step: definition.producers[ref.name] ?? null,
      iteration: changed ? null : previous.iteration,
      ref: links?.[ref.name] ?? previous?.ref ?? null,
      expired: false,
    };
  }
  for (const [name, value] of Object.entries(links ?? {})) {
    if (plan.artifacts[name]) plan.artifacts[name].ref = value;
  }
}

export function createPlanState({ id, title, definition, have = [], refs = {}, conditions = {}, parent = null, at = Date.now() }) {
  const parsed = parseHaveList(definition, have, refs);
  if (!parsed.ok) return parsed;
  const conditionError = checkConditions(definition, conditions);
  if (conditionError) return conditionError;
  const plan = {
    id, title, workflow: definition.qualifiedId ?? definition.id, definition, conditions: { ...conditions },
    steps: {}, artifacts: {}, parent, status: 'active', seq: 0, updatedAt: at, createdAt: at, note: null,
  };
  syncActivation(definition, plan);
  putHave(plan, definition, parsed.refs, refs);
  const reused = markReused(definition, plan);
  const view = resolve(definition, plan);
  plan.status = view.status;
  return { ok: true, plan, reused, view };
}

export function checkConditions(definition, conditions = {}) {
  for (const [key, value] of Object.entries(conditions)) {
    if (!definition.conditions.includes(key)) return reject('unknown_condition', { workflow: definition.id, condition: key, conditions: definition.conditions });
    if (typeof value !== 'boolean') return reject('unknown_condition', { workflow: definition.id, condition: key, conditions: definition.conditions });
  }
  return null;
}

export function revisePlan(definition, plan, { have = [], refs = {}, conditions = {}, at = Date.now() } = {}) {
  const parsed = have.length || Object.keys(refs).length ? parseHaveList(definition, have, refs) : { ok: true, refs: [] };
  if (!parsed.ok) return { ...parsed, plan };
  const merged = { ...plan.conditions, ...conditions };
  const conditionError = checkConditions(definition, merged);
  if (conditionError) return { ...conditionError, plan };
  const next = clone(plan);
  next.conditions = merged;
  next.updatedAt = at;
  syncActivation(definition, next);
  putHave(next, definition, parsed.refs, refs);
  if (have.length) propagateExpiry(definition, next);
  const reused = markReused(definition, next);
  const view = resolve(definition, next);
  next.status = view.status;
  return { ok: true, plan: next, reused, view };
}

export function closePlan(definition, plan, { outcome, note, at = Date.now() } = {}) {
  if (outcome === 'completed' && !goalsMet(definition, plan)) return { ...reject('close_incomplete', { goal: goalNames(definition, plan) }), plan };
  if (outcome === 'abandoned' && !note?.trim()) return { ...reject('note_required', { status: 'abandoned' }), plan };
  if (!['completed', 'abandoned'].includes(outcome)) return { ...reject('invalid_plan', { detail: 'close 的 outcome 只能是 completed 或 abandoned' }), plan };
  const next = clone(plan);
  next.status = outcome === 'abandoned' ? 'abandoned' : 'completed';
  next.note = note?.trim() || next.note || null;
  next.updatedAt = at;
  next.closed = true;
  return { ok: true, plan: next, view: resolve(definition, next) };
}

function missingTokens(definition, plan, name) {
  const step = definition.steps[name];
  const missing = [];
  for (const ref of step.requires) if (!satisfied(plan, ref)) missing.push(formatRef(ref));
  if (step.requires_any.length && !step.requires_any.some(ref => satisfied(plan, ref))) missing.push(...step.requires_any.map(formatRef));
  if (gateOpen(definition, plan, step)) {
    for (const ref of step.requires_if_valid) {
      if (!satisfied(plan, ref) && !(definition.producers[ref.name] && plan.steps[definition.producers[ref.name]]?.status === 'skipped')) missing.push(formatRef(ref));
    }
  }
  return unique(missing);
}

export function reportStep(definition, plan, input) {
  const name = input.step;
  if (!Object.hasOwn(definition.steps, name) || !stepActive(definition, plan, name)) {
    const options = Object.keys(definition.steps).filter(step => stepActive(definition, plan, step));
    return { ...reject('unknown_step', { step: name, suggestion: closestName(name, options), steps: options }), plan };
  }
  const state = plan.steps[name] ?? freshStep();
  if (state.status === 'skipped') return { ...reject('step_skipped', { step: name }), plan };
  if (input.status === 'started' && state.status === 'running') {
    const next = clone(plan);
    const current = next.steps[name];
    current.runs ??= [];
    const seen = new Set(current.runs.map(run => run.id));
    for (const run of input.runs ?? []) {
      if (run && typeof run.id === 'string' && !seen.has(run.id)) {
        current.runs.push(run);
        seen.add(run.id);
      }
    }
    next.updatedAt = input.at ?? Date.now();
    const view = resolve(definition, next);
    next.status = view.status;
    return {
      ok: true, plan: next, view, violation: current.violation === true, missing: current.violationMissing ?? [],
      renewed: [], expiry: { expiredArtifacts: [], resetSteps: [] }, iteration: current.iteration,
      alreadyRunning: { step: name, runs: [...seen] },
    };
  }
  if (input.status === 'done' && state.status === 'done') {
    return { ...reject('already_done', { step: name, attempt: state.iteration + 1 }), plan };
  }
  if (['failed', 'skipped'].includes(input.status) && !input.note?.trim()) return { ...reject('note_required', { status: input.status }), plan };
  if (input.note && input.note.length > 500) return { ...reject('invalid_plan', { detail: 'note 不超过 500 字' }), plan };
  const produced = input.produced ?? [];
  const declared = new Set(definition.steps[name].produces);
  const producedNames = new Map();
  for (const ref of produced) {
    if (!declared.has(ref.name)) {
      return { ...reject('unknown_artifact', { artifact: formatRef(ref), scope: `步骤 ${name}`, suggestion: closestName(ref.name, [...declared]), artifacts: [...declared] }), plan };
    }
    const allowed = definition.outcomes[ref.name];
    if (allowed && !ref.outcome) return { ...reject('outcome_required', { artifact: ref.name, outcomes: allowed }), plan };
    if (ref.outcome && allowed && !allowed.includes(ref.outcome)) return { ...reject('invalid_outcome', { artifact: ref.name, outcome: ref.outcome, outcomes: allowed }), plan };
    if (ref.outcome && !allowed) return { ...reject('invalid_outcome', { artifact: ref.name, outcome: ref.outcome, outcomes: [] }), plan };
    if (producedNames.has(ref.name) && producedNames.get(ref.name) !== (ref.outcome ?? '')) return { ...reject('invalid_outcome', { artifact: ref.name, outcome: ref.outcome, outcomes: allowed ?? [] }), plan };
    producedNames.set(ref.name, ref.outcome ?? '');
  }
  for (const artifact of Object.keys(input.refs ?? {})) {
    if (!knownArtifacts(definition).includes(artifact)) {
      return { ...reject('unknown_artifact', { artifact, scope: '工作流', suggestion: closestName(artifact, knownArtifacts(definition)), artifacts: knownArtifacts(definition) }), plan };
    }
  }
  if (input.status === 'done') {
    for (const product of definition.steps[name].produces) {
      const allowed = definition.outcomes[product];
      if (allowed && !producedNames.has(product)) return { ...reject('outcome_required', { artifact: product, outcomes: allowed }), plan };
    }
  }
  if (input.fallback) {
    if (input.status !== 'failed') return { ...reject('fallback_undeclared', { step: name, workflow: input.fallback, declared: definition.steps[name].fallback ?? '（无）' }), plan };
    if (definition.steps[name].fallback !== input.fallback) return { ...reject('fallback_undeclared', { step: name, workflow: input.fallback, declared: definition.steps[name].fallback ?? '（无）' }), plan };
  }

  const next = clone(plan);
  next.steps[name] ??= freshStep();
  const current = next.steps[name];
  const at = input.at ?? Date.now();
  next.updatedAt = at;
  let violation = false;
  let missing = [];
  const renewed = [];
  if (input.status === 'started') {
    if (current.status === 'done' || current.status === 'failed') current.iteration += 1;
    const unmet = !dependencyMet(definition, plan, name);
    missing = unmet ? missingTokens(definition, plan, name) : [];
    violation = unmet;
    current.status = 'running';
    current.consumed = snapshotConsumed(definition, next, name);
    current.runs = input.runs ?? [];
    current.note = null;
    current.violation = violation;
    current.violationMissing = violation ? missing : null;
    current.startedAt = at;
    current.endedAt = null;
    current.fallbackTo = null;
    current.fallbackPlanId = null;
  } else if (input.status === 'done') {
    if (current.status === 'failed') { current.iteration += 1; current.consumed = null; }
    if (current.consumed === null) current.consumed = snapshotConsumed(definition, next, name);
    const unmet = !dependencyMet(definition, plan, name);
    const priorMissing = current.violationMissing ?? [];
    if (current.violation || ((current.status === 'pending' || current.status === 'failed') && unmet)) violation = true;
    missing = violation ? (unmet ? missingTokens(definition, plan, name) : priorMissing) : [];
    current.status = 'done';
    current.runs = input.runs ?? current.runs ?? [];
    current.note = input.note ?? null;
    current.violation = violation;
    current.violationMissing = violation ? missing : null;
    current.endedAt = at;
    current.startedAt = current.startedAt ?? at;
    current.fallbackTo = null;
    current.fallbackPlanId = null;
    for (const product of definition.steps[name].produces) {
      const previous = next.artifacts[product];
      const outcome = producedNames.has(product) ? (producedNames.get(product) || null) : (previous && !previous.expired ? previous.outcome : null);
      next.artifacts[product] = {
        version: (previous?.version ?? 0) + 1,
        outcome: outcome || null,
        origin: 'step',
        step: name,
        iteration: current.iteration,
        ref: input.refs?.[product] ?? previous?.ref ?? null,
        expired: false,
      };
      renewed.push(product);
    }
    for (const [artifact, value] of Object.entries(input.refs ?? {})) {
      if (next.artifacts[artifact]) next.artifacts[artifact].ref = value;
    }
    const expiry = propagateExpiry(definition, next);
    const view = resolve(definition, next);
    next.status = view.status;
    return { ok: true, plan: next, view, violation, missing, renewed, expiry, iteration: current.iteration };
  } else if (input.status === 'failed' || input.status === 'skipped') {
    if (current.status === 'failed' && input.status === 'failed') current.iteration += 1;
    if (current.consumed === null) current.consumed = snapshotConsumed(definition, next, name);
    current.status = input.status;
    current.note = input.note.trim();
    current.runs = input.runs ?? current.runs ?? [];
    current.endedAt = at;
    current.startedAt = current.startedAt ?? at;
    current.fallbackTo = input.fallback ?? null;
    current.fallbackPlanId = input.fallbackPlanId ?? null;
    current.violation = false;
  }
  const view = resolve(definition, next);
  next.status = view.status;
  return { ok: true, plan: next, view, violation, missing, renewed, expiry: { expiredArtifacts: [], resetSteps: [] }, iteration: current.iteration };
}

export function resumeAfterChild(definition, plan, step, at = Date.now()) {
  const next = clone(plan);
  const state = next.steps[step];
  if (state) {
    state.status = 'pending';
    state.iteration += 1;
    state.consumed = null;
    state.runs = [];
    state.note = null;
    state.violation = false;
    state.startedAt = null;
    state.endedAt = null;
    state.fallbackTo = null;
    state.fallbackPlanId = null;
  }
  next.updatedAt = at;
  const view = resolve(definition, next);
  next.status = view.status;
  return { plan: next, view };
}

export function resolve(definition, plan) {
  const active = Object.keys(definition.steps).filter(name => stepActive(definition, plan, name));
  const unfinished = necessaryUnfinished(definition, plan);
  const pendingNames = [...unfinished].filter(name => (plan.steps[name]?.status ?? 'pending') === 'pending');
  const unreachable = unreachableSet(definition, plan, pendingNames);
  const partition = { ready: [], running: [], waiting: [], unreachable: [] };
  const ready = [], running = [], waiting = [], failed = [];
  for (const name of active) {
    const state = plan.steps[name] ?? freshStep();
    const step = definition.steps[name];
    if (state.fallbackPlanId && state.status === 'failed') {
      const item = { step: name, missing: [], reason: { kind: 'fallback', vars: { workflow: state.fallbackTo } }, unreachable: false };
      waiting.push(item);
      if (unfinished.has(name)) partition.waiting.push({ step: name, reason: item.reason });
      continue;
    }
    if (state.status === 'running') {
      running.push({ step: name, iteration: state.iteration, runs: (state.runs ?? []).map(run => run.id) });
      if (unfinished.has(name)) partition.running.push({ step: name });
      continue;
    }
    if (state.status === 'failed') {
      failed.push({ step: name, iteration: state.iteration, note: state.note });
      if (unfinished.has(name)) partition.waiting.push({ step: name, reason: { kind: 'failed', vars: { steps: [name] } } });
      continue;
    }
    if (state.status === 'done' || state.status === 'skipped') continue;
    if (!unfinished.has(name)) continue;
    const issues = issuesFor(definition, plan, step);
    if (!issues.length) {
      const item = { step: name, iteration: state.iteration };
      ready.push(item);
      partition.ready.push(item);
      continue;
    }
    const reason = reasonFor(issues, unreachable);
    const item = { step: name, missing: missingTokens(definition, plan, name), reason, unreachable: unreachable.has(name) };
    waiting.push(item);
    partition[unreachable.has(name) ? 'unreachable' : 'waiting'].push({ step: name, reason });
  }
  const order = new Map(active.map((name, index) => [name, index]));
  for (const list of [ready, running, waiting, failed]) list.sort((a, b) => order.get(a.step) - order.get(b.step));
  let status = 'active';
  let blocked = null;
  let externalInputs = [];
  if (plan.status === 'abandoned') status = 'abandoned';
  else if (running.length || failed.length || ready.length) status = 'active';
  else if (goalsMet(definition, plan)) status = 'completed';
  else {
    const reason = explainBlock(definition, plan);
    if (reason.kind === 'external') { status = 'needs_input'; externalInputs = reason.vars.inputs ?? []; }
    else { status = 'blocked'; blocked = reason; }
  }
  const progress = { done: active.filter(name => plan.steps[name]?.status === 'done').length, total: active.length };
  return { status, progress, necessary: unfinished, partition, ready, running, waiting, failed, blocked, externalInputs, goals: goalNames(definition, plan), active };
}

export function inputTokens(definition, plan, name) {
  const step = definition.steps[name];
  const tokens = step.requires.map(formatRef);
  if (step.requires_any.length) tokens.push(...step.requires_any.map(formatRef));
  if (gateOpen(definition, plan, step)) tokens.push(...step.requires_if_valid.map(formatRef));
  return tokens;
}

export function layersOf(definition) {
  const memo = new Map();
  const layer = (name, stack = new Set()) => {
    if (memo.has(name)) return memo.get(name);
    if (stack.has(name)) return 0;
    stack.add(name);
    let depth = 0;
    const step = definition.steps[name];
    for (const ref of [...step.requires, ...step.requires_any, ...step.requires_if_valid]) {
      const producer = definition.producers[ref.name];
      if (producer && producer !== name) depth = Math.max(depth, layer(producer, stack) + 1);
    }
    stack.delete(name);
    memo.set(name, depth);
    return depth;
  };
  for (const name of Object.keys(definition.steps)) layer(name);
  return memo;
}
