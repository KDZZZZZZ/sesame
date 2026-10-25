import { setTimeout as delay } from 'node:timers/promises';
import { ID, FINAL, SETTLED, ACTIVE, hash, uniqueId, check, main, errorInfo, locked, read, put, patch, session,
  branches, branchKey, saveSession, saveBranch, publicState, continuationState } from './state.js';
import { continuationGuidance, plannerRequest } from './planning.js';

const dispatching = new Map();
const tradeEffects = new Set(['trade', 'broker.write', 'external-trading', 'external-strategy-operation', 'invoke:selected-execution', 'write:trading-checkpoints']);
const opaqueEffects = new Set(['process', 'process.exec', 'native-call']);
const taskActive = job => ['queued', 'starting', 'running'].includes(job.status);
const frozen = state => FINAL.has(state.status) || state.status === 'stopping';
const expanding = state => !frozen(state) && continuationState(state) === 'active';
const cancelAccepted = state => ['stopping', 'stopped', 'completed'].includes(state.status);
const continueState = (host, id, change) => patch(host, 'sessions', id, value => {
  if (frozen(value)) return value;
  const next = { ...value, ...change, ...(value.continuation === 'draining' ? { status: 'closing', wake: null } : {}) };
  return JSON.stringify(next) === JSON.stringify(value) ? value : { ...next, updatedAt: Date.now() };
});
const ref = run => ({ id: run.id, ...(run.kind ? { kind: run.kind } : {}), ...(run.revision ? { revision: run.revision } : {}) });
const resultState = (state, jobs = []) => ({ ...publicState(state, jobs), guidance: continuationGuidance(state) });
const offState = () => ({ status: 'off', enabled: false, continuation: 'closed', active_work: 0, accepted_work: 0, queued_work: 0, branches: [], next: 'start' });

function explicitUltraInput(parts = []) {
  const text = parts.filter(part => part.type === 'text').map(part => part.text ?? '').join('\n').trim();
  if (/^\/ultra(?:\s|$)/i.test(text)) return !/^\/ultra\s+(?:off|close|stop|status)(?:\s|$)/i.test(text);
  return /^(?:请|帮我|现在|那就)?\s*(?:重新开启|继续|恢复|开启|启用)\s*ultra\b|^(?:please\s+)?(?:start|enable|resume|restart)\s+ultra\b/i.test(text);
}

async function requireReopen(host, owner, fence) {
  const authority = await read(host, 'authorities', owner);
  check(authority?.value.ultraRequested && authority.value.counter > (fence.closeAuthority ?? 0), 'NEW_USER_INPUT_REQUIRED',
    'Ultra is closed. A new explicit user request, such as /ultra resume, is required to reopen it.');
}

async function closeOwner(host, owner) {
  const authority = await read(host, 'authorities', owner);
  for (let attempt = 0; attempt < 4; attempt++) {
    const pointer = await read(host, 'owners', owner);
    const value = { ...pointer?.value, closeGeneration: (pointer?.value.closeGeneration ?? 0) + 1,
      closeAuthority: authority?.value.counter ?? 0, closeRequestedAt: Date.now() };
    try { return (await put(host, 'owners', owner, value, pointer?.version ?? 0)).value; }
    catch (error) { if (!['VERSION_CONFLICT', 'CONFLICT'].includes(error.code) || attempt === 3) throw error; }
  }
}

export async function beforeTurn(host, input) {
  // The host supplies origin/source; never infer user authority from message text.
  // source is the originating conversation ID, not a role name.
  const owner = input.conversation?.id;
  if (!owner) return { parts: input.parts };
  if (input.metadata?.origin !== 'automation' && !input.source) {
    await locked(host, owner, async () => {
      const messageKey = hash([owner, input.messageId]);
      if (await read(host, 'human_inputs', messageKey)) return;
      const prior = await read(host, 'authorities', owner);
      await host.state.commit([
        { op: 'put', key: { collection: 'authorities', key: owner }, expectedVersion: prior?.version ?? 0,
          value: { owner, messageId: input.messageId, counter: (prior?.value.counter ?? 0) + 1, ultraRequested: explicitUltraInput(input.parts) } },
        { op: 'put', key: { collection: 'human_inputs', key: messageKey }, expectedVersion: 0, value: { owner, messageId: input.messageId } },
      ]);
    });
  }
  return { parts: input.parts };
}

async function progressBasis(host, state, jobs) {
  const capabilities = []; let cursor;
  do {
    const page = await host.capabilities.list({ limit: 200, ...(cursor ? { cursor } : {}) });
    capabilities.push(...page.items.map(item => [item.id, item.revision ?? null])); cursor = page.nextCursor;
  } while (cursor);
  const authority = await read(host, 'authorities', state.owner);
  return hash({ objective: state.objective, criteria: state.successCriteria, mode: state.mode,
    authority: authority?.value.counter ?? 0, observation: state.lastObservation ?? null,
    capabilities: capabilities.sort(([left], [right]) => left.localeCompare(right)),
    branches: jobs.map(job => ({ key: job.key, fingerprint: job.fingerprint, status: job.status,
      result: job.result ?? null, error: job.error ?? null, stopDone: job.stopDone ?? false })).sort((left, right) => left.key.localeCompare(right.key)),
  });
}

export async function afterTurn(host, input, signal) {
  return continueAfterTurn(host, input, signal, true);
}

async function continueAfterTurn(host, input, signal, drainQueue) {
  // The public lifecycle runs after the whole SDK turn settles. It also emits
  // callbacks for steered replies and subagents, so bind both scope and owner.
  if (input.scope !== 'main' || host.context.kind !== 'main' || input.status !== 'completed' || input.conversationId !== host.context.sessionId) return { continued: false };
  const owner = main(host);
  const action = await locked(host, owner, async () => {
    const pointer = await read(host, 'owners', owner); if (!pointer?.value.id) return { continued: false };
    const retained = await session(host, pointer.value.id, owner);
    if (retained.continuation === 'draining' || retained.status === 'closed') {
      const observed = await observe(host, retained); return resultState(observed.state, observed.jobs);
    }
    if (frozen(retained) || retained.status === 'waiting-input' || retained.status === 'interrupted' && retained.error?.code !== 'CONTINUATION_STALLED') return publicState(retained, await branches(host, retained.id));
    // afterAgentTurn audits each steered reply after the SDK settles. A newly
    // queued completion already has its own continuation; do not race it.
    const snapshot = await host.capabilities.invoke('host.sessions.query', { binding: {}, query: { sessionId: owner }, page: { limit: 1 } });
    const currentSession = snapshot.value?.items?.find(item => item.id === owner);
    if (currentSession?.status !== 'idle' || currentSession.activeResponseId) return { continued: false, reason: 'main-not-idle' };
    let { state, jobs } = await observe(host, retained);
    const paused = () => !expanding(state) || state.status === 'waiting-input' || state.status === 'interrupted' && state.error?.code !== 'CONTINUATION_STALLED';
    if (paused()) return publicState(state, jobs);
    const current = state.cycle?.id ? (await host.runs.read(state.cycle)).run : null;
    if (current && ACTIVE.has(current.status)) return publicState(state, jobs);
    if (state.recovery?.responseId === input.responseId) return publicState(state, jobs);
    const active = jobs.filter(job => ['starting', 'running'].includes(job.status));
    const runnable = jobs.some(job => job.status === 'queued' && (!job.exclusive || !active.some(item => item.exclusive)));
    if (drainQueue && runnable && active.length < state.maxParallel) return { drain: state.id };
    const refs = active.flatMap(job => job.refs ?? []);
    if (refs.length) return publicState(await launchCycle(host, state, { mode: 'runs', refs }, signal), jobs);
    if (jobs.some(job => ['starting', 'interrupted', 'unknown'].includes(job.status))) {
      state = await continueState(host, state.id, { status: 'interrupted', error: { code: 'RECONCILE_REQUIRED', message: 'Resolve the retained branch outcome before starting new work; no accepted action was replayed.' } });
      return publicState(state, jobs);
    }
    const basis = await progressBasis(host, state, jobs);
    if (state.recovery?.basis === basis) {
      state = await continueState(host, state.id, { status: 'interrupted', error: { code: 'CONTINUATION_STALLED',
        message: 'The main coordinator ended another turn without dispatching its retained plan or registering a real wait. Continue by dispatching a concrete new method or resolve the actual scheduler error; the user goal is not complete and no new approval is required.' } });
      return publicState(state, jobs);
    }
    state = await continueState(host, state.id, { status: 'ready', error: null, recovery: { basis, responseId: input.responseId } });
    try { return publicState(await launchCycle(host, state, { mode: 'plan' }, signal), jobs); }
    catch (error) {
      await continueState(host, state.id, { status: 'interrupted', error: errorInfo(error) }); throw error;
    }
  });
  if (!action.drain) return action;
  // dispatch owns the same per-session lock. Fill at most one immediate batch
  // in this hook; a real cycle handles further work without monopolizing it.
  await dispatch(host, { id: action.drain, branches: [] }, signal);
  return continueAfterTurn(host, input, signal, false);
}

function retainedResult(value) {
  if (Buffer.byteLength(JSON.stringify(value ?? null)) <= 64 * 1024) return value ?? null;
  return { summary: 'The source result exceeds the Ultra status preview; read the retained original Run output or published references.', preview: JSON.stringify(value).slice(0, 12000), truncated: true };
}

async function descriptor(host, id) {
  const found = (await host.capabilities.list({ ids: [id] })).items.find(value => value.id === id);
  check(found, 'CAPABILITY_UNAVAILABLE', `Discover and load the declared capability ${id} before dispatch.`);
  return found;
}

function nestedCalls(input) {
  return (input.allowedCalls ?? []).map(call => call.pluginId === 'host' ? `host.${call.capabilityId}` : `${call.pluginId}#${call.capabilityId}`);
}

async function classify(host, branch) {
  const target = await descriptor(host, branch.capability), effects = [...(target.effects ?? [])];
  check(branch.capability !== `${ID}#ultra_cycle` && !branch.capability.startsWith(`${ID}#ultra_`), 'INVALID_BRANCH', 'Ultra controls are not research branches.');
  if (branch.capability === 'host.agent.run') {
    check(!nestedCalls(branch.input).some(id => ['host.capabilities.invoke', 'host.agent.run'].includes(id)), 'UNBOUNDED_DELEGATION', 'Delegate exact business tools. Nested generic invocation would hide the execution lane and concurrency from Ultra.');
    for (const id of nestedCalls(branch.input)) {
      const child = await descriptor(host, id);
      effects.push(...child.effects ?? []);
    }
  }
  const schedule = effects.some(effect => ['manage:scheduler', 'manage:subscriptions'].includes(effect));
  check(!schedule || branch.stop, 'STOP_ACTION_REQUIRED', 'A persistent schedule/subscription branch must include its exact domain stop capability and arguments.');
  if (branch.stop) await descriptor(host, branch.stop.capability);
  const trading = effects.some(effect => tradeEffects.has(effect));
  return { target, trading, persistent: schedule, exclusive: trading || effects.some(effect => opaqueEffects.has(effect)) || branch.exclusive === true };
}

async function ownedRef(host, state, candidate) {
  const run = (await host.runs.read(candidate)).run;
  check(run.sessionId === state.owner && !run.parentRunId, 'FOREIGN_RUN', 'Only root Runs created in this Ultra owner conversation can be registered or controlled.');
  return ref(run);
}

// Some existing main-only workflow launchers return their real workflow inside
// an immediate domain receipt. Verify the public Run before tracking it.
async function acceptedRefs(host, state, accepted) {
  if (accepted.type === 'run') return [await ownedRef(host, state, accepted.run)];
  const value = accepted.value, found = [];
  for (const candidate of [value?.workflow, value?.run, value?.run_ref, value?.runRef]) {
    if (candidate && typeof candidate.id === 'string' && candidate.id.startsWith('run_') && !found.some(item => item.id === candidate.id)) found.push(await ownedRef(host, state, candidate));
  }
  return found;
}

async function observe(host, state) {
  let jobs = await branches(host, state.id);
  await Promise.all(jobs.filter(job => job.refs?.length && !['completed', 'failed', 'cancelled', 'unknown'].includes(job.status)).map(async job => {
    const observed = await Promise.all(job.refs.map(async item => (await host.runs.read(item)).run));
    const active = observed.some(run => ACTIVE.has(run.status));
    const interrupted = observed.find(run => run.status === 'interrupted');
    const failure = observed.find(run => ['failed', 'cancelled', 'canceled', 'unknown'].includes(run.status));
    const done = observed.every(run => run.status === 'completed');
    const change = { status: active ? 'running' : interrupted ? 'interrupted' : failure ? failure.status === 'canceled' ? 'cancelled' : failure.status : done ? 'completed' : job.status,
      ...(failure?.error ? { error: failure.error } : {}),
      ...(done ? { result: retainedResult(observed.map(run => ({ run: ref(run), output: run.output, ...(run.report?.ref ? { report_ref: run.report.ref } : {}) }))), completedAt: Date.now() } : {}) };
    if (Object.entries(change).some(([key, value]) => JSON.stringify(job[key]) !== JSON.stringify(value))) await saveBranch(host, job, change);
  }));
  state = await session(host, state.id, state.owner); jobs = await branches(host, state.id);
  if (state.cycle?.id) {
    const run = (await host.runs.read(state.cycle)).run;
    if (run.status === 'interrupted' && !frozen(state)) state = await continueState(host, state.id, { status: 'interrupted', error: { code: 'RUN_INTERRUPTED', message: 'Resume the retained Ultra cycle after resolving its concrete interruption.' } });
    else if (['unknown', 'failed'].includes(run.status) && !frozen(state)) state = await continueState(host, state.id, { status: 'interrupted', error: run.error ?? { code: 'UNKNOWN_OUTCOME', message: 'Inspect the retained cycle before resuming; no business action was replayed.' } });
  }
  for (const job of jobs.filter(job => job.stopRefs?.length && !job.stopDone)) {
    const outputs = await Promise.all(job.stopRefs.map(async item => (await host.runs.read(item)).run));
    if (outputs.every(run => run.status === 'completed')) await saveBranch(host, job, { stopDone: true });
    else {
      const failed = outputs.find(run => ['failed', 'unknown', 'cancelled', 'canceled', 'interrupted'].includes(run.status));
      if (failed) await saveBranch(host, job, { stopError: failed.error ?? { code: 'DOMAIN_STOP_INCOMPLETE', message: `The registered domain shutdown is ${failed.status}.` } });
    }
  }
  jobs = await branches(host, state.id);
  if (state.continuation === 'draining' && !jobs.some(job => !(job.persistent ?? Boolean(job.stop)) && ['starting', 'running'].includes(job.status))) {
    state = await patch(host, 'sessions', state.id, value => value.continuation === 'draining'
      ? { ...value, status: 'closed', continuation: 'closed', closedAt: Date.now(), updatedAt: Date.now(), wake: null } : value);
  }
  if (state.status === 'stopping' && !state.pendingCycle && jobs.every(job => !taskActive(job) && job.status !== 'interrupted') && jobs.every(job => !job.stop || !job.startedAt || job.stopDone)) {
    const cycleRun = state.cycle?.id ? (await host.runs.read(state.cycle)).run : null;
    if (!cycleRun || SETTLED.has(cycleRun.status)) state = await saveSession(host, state.id, { status: 'stopped', stoppedAt: Date.now(), wake: null });
  }
  return { state, jobs };
}

async function launchCycle(host, state, spec, signal) {
  state = await session(host, state.id, state.owner);
  if (!expanding(state)) return state;
  if (state.cycle?.id) {
    const current = (await host.runs.read(state.cycle)).run;
    if (ACTIVE.has(current.status)) return state;
    check(current.status !== 'interrupted' && current.status !== 'unknown', 'RESUME_REQUIRED', 'Resume the retained Ultra cycle rather than creating a duplicate.');
  }
  const number = state.pendingCycle?.number ?? (state.cycleNumber ?? 0) + 1;
  spec = state.pendingCycle?.spec ?? spec;
  state = await continueState(host, state.id, { cycleNumber: number, cycle: null, pendingCycle: { number, spec }, wake: spec, status: spec.mode === 'plan' ? 'planning' : 'waiting' });
  if (!expanding(state)) return state;
  const accepted = await host.capabilities.invoke(`${ID}#ultra_cycle`, { id: state.id, number, ...spec }, {
    operationId: `${state.id}:cycle:${number}`, signal, task: { title: spec.mode === 'plan' ? 'Ultra 并行规划' : 'Ultra 等待下一阶段', output: { type: 'none' } },
  });
  check(accepted.type === 'run', 'INVALID_HOST_RESULT', 'Ultra cycle must be a real host workflow.');
  await saveSession(host, state.id, { cycle: accepted.run, pendingCycle: null });
  const latest = await session(host, state.id, state.owner);
  if (cancelAccepted(latest)) await host.runs.cancel(accepted.run, { reason: 'Ultra was stopped during cycle admission.' });
  return latest;
}

export async function start(host, input, signal) {
  const owner = main(host);
  return locked(host, owner, async () => {
    const pointer = await read(host, 'owners', owner), controlGeneration = pointer?.value.closeGeneration ?? 0;
    let previous = pointer?.value.id ? await session(host, pointer.value.id, owner) : null;
    if (controlGeneration && (!previous || controlGeneration > (previous.controlGeneration ?? 0))) await requireReopen(host, owner, pointer.value);
    if (previous?.continuation === 'draining' || previous?.status === 'closed') {
      await requireReopen(host, owner, pointer?.value ?? previous);
      if (previous.continuation === 'draining') previous = await saveSession(host, previous.id, { continuation: 'active', controlGeneration, status: 'ready', error: null });
    }
    if (previous && !FINAL.has(previous.status)) { const observed = await observe(host, previous); return { ...publicState(observed.state, observed.jobs), existing: true }; }
    if (previous?.status === 'stopped') {
      const authority = await read(host, 'authorities', owner);
      check((authority?.value.counter ?? 0) > (previous.stopAuthority ?? 0), 'NEW_USER_INPUT_REQUIRED', 'A stopped Ultra goal cannot restart from an old automatic completion notice. Wait for a new user instruction.');
    }
    const id = uniqueId(), state = { id, owner, objective: input.objective, context: input.context ?? '', mode: input.mode ?? 'auto',
      successCriteria: input.success_criteria ?? [], plugins: input.plugins ?? [], maxParallel: input.max_parallel ?? 8,
      status: 'planning', continuation: 'active', controlGeneration, createdAt: Date.now(), updatedAt: Date.now(), summary: '' };
    await put(host, 'sessions', id, state);
    try { await put(host, 'owners', owner, { ...pointer?.value, id }, pointer?.version ?? 0); }
    catch (error) {
      const current = await read(host, 'owners', owner);
      if (!['VERSION_CONFLICT', 'CONFLICT'].includes(error.code) || (current?.value.closeGeneration ?? 0) <= controlGeneration) throw error;
      const observed = await observe(host, await session(host, id, owner)); return resultState(observed.state, observed.jobs);
    }
    try { return publicState(await launchCycle(host, state, { mode: 'plan' }, signal)); }
    catch (error) { await saveSession(host, id, { status: 'interrupted', error: errorInfo(error) }); throw error; }
  });
}

export async function status(host, input = {}) {
  const owner = main(host), pointer = await read(host, 'owners', owner);
  if (!input.id && !pointer?.value.id) return offState();
  const observed = await observe(host, await session(host, input.id, owner));
  const jobs = input.branch_key ? observed.jobs.filter(job => job.key === input.branch_key) : observed.jobs;
  check(!input.branch_key || jobs.length, 'NOT_FOUND', 'This branch was not recorded in the Ultra goal.');
  return { ...publicState(observed.state, jobs, Boolean(input.branch_key)), guidance: continuationGuidance(observed.state) };
}

async function admitBranch(host, state, input) {
  check(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(input.key), 'INVALID_BRANCH', 'Branch key must be stable and use letters, numbers, dots, dashes or underscores.');
  const key = branchKey(state.id, input.key), existing = await read(host, 'branches', key), fingerprint = hash({ capability: input.capability, input: input.input, task: input.task ?? null, stop: input.stop ?? null });
  if (existing) { check(existing.value.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', 'A branch key already identifies different frozen work.'); return existing.value; }
  const prior = await branches(host, state.id);
  check(!prior.some(job => job.fingerprint === fingerprint), 'DUPLICATE_BRANCH', 'This exact work is already recorded under another key. Inspect its result or change the method/input.');
  const { target, exclusive, trading, persistent } = await classify(host, input);
  check(expanding(await session(host, state.id, state.owner)), 'CLOSED', 'Ultra is closed; collect existing results instead of adding branches.');
  check(state.mode !== 'research' && state.mode !== 'monitor' || !trading, 'MODE_MISMATCH', 'This research/monitor goal has no trading execution lane; retain the user-authorized task scope.');
  const job = { ...structuredClone(input), session: state.id, fingerprint, revision: target.revision ?? null, exclusive, persistent,
    status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), refs: [] };
  const stored = (await put(host, 'branches', key, job)).value;
  if (!expanding(await session(host, state.id, state.owner))) await saveBranch(host, job, { status: 'cancelled', withdrawnReason: 'Ultra closed before this branch started.' });
  return stored;
}

async function invokeBranch(host, state, job, signal) {
  const current = await session(host, state.id, state.owner); if (!expanding(current)) return;
  const target = await descriptor(host, job.capability);
  check((target.revision ?? null) === job.revision, 'CAPABILITY_CHANGED', 'A queued branch capability changed; inspect and create a new branch rather than silently replaying it.');
  await saveBranch(host, job, { status: 'starting', startedAt: job.startedAt ?? Date.now() });
  if (!expanding(await session(host, state.id, state.owner))) {
    await saveBranch(host, job, { status: 'cancelled', startedAt: null, withdrawnReason: 'Ultra closed before this branch was invoked.' }); return;
  }
  try {
    const accepted = await host.capabilities.invoke(job.revision ? { id: job.capability, revision: job.revision } : job.capability, job.input,
      { signal, operationId: `${state.id}:branch:${job.key}`, ...(job.task ? { task: job.task } : {}) });
    const refs = await acceptedRefs(host, state, accepted);
    await saveBranch(host, job, { refs, status: refs.length ? 'running' : 'completed', result: accepted.type === 'result' ? retainedResult(accepted.value) : null,
      ...(!refs.length ? { completedAt: Date.now() } : {}) });
    if (cancelAccepted(await session(host, state.id, state.owner))) {
      for (const item of refs) await host.runs.cancel(item, { reason: 'Ultra was stopped while this branch was being accepted.' });
    }
  } catch (error) {
    // The host operation key and the domain's own command key remain unchanged.
    // An uncertain side effect is reconciled, never converted into another order.
    await saveBranch(host, job, { status: job.exclusive && signal?.aborted ? 'unknown' : 'failed', error: errorInfo(error) });
  }
}

export async function dispatch(host, input, signal) {
  const owner = main(host);
  return locked(host, owner, async () => {
    let state = await session(host, input.id, owner); check(!frozen(state), 'STOPPED', 'Start a new Ultra goal after the prior goal has ended.');
    check(expanding(state), 'CLOSED', 'Ultra is closed; collect existing results instead of dispatching new work.');
    const controller = new AbortController(), combined = AbortSignal.any([controller.signal, signal].filter(Boolean)); dispatching.set(state.id, controller);
    try {
      for (const branch of input.branches ?? []) { combined.throwIfAborted(); await admitBranch(host, state, branch); }
      let observed = await observe(host, state); state = observed.state;
      if (state.error?.code === 'CONTINUATION_STALLED' && input.branches?.length) state = await continueState(host, state.id, { status: 'ready', error: null });
      check(state.status !== 'interrupted', 'RESUME_REQUIRED', 'Resolve the retained cycle interruption and resume; do not create a new cycle.');
      const running = observed.jobs.filter(job => ['starting', 'running'].includes(job.status));
      const slots = Math.max(0, state.maxParallel - running.length);
      let exclusive = running.some(job => job.exclusive);
      const admitted = [];
      for (const job of observed.jobs.filter(value => value.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)) {
        if (admitted.length >= slots) break;
        if (job.exclusive && exclusive) continue;
        if (job.exclusive) exclusive = true;
        admitted.push(job);
      }
      await continueState(host, state.id, { status: 'running', summary: input.summary ?? state.summary, wake: null });
      await Promise.all(admitted.map(job => invokeBranch(host, state, job, combined)));
      observed = await observe(host, state); state = observed.state;
      const refs = observed.jobs.filter(job => job.status === 'running').flatMap(job => job.refs);
      if (expanding(state) && refs.length) state = await launchCycle(host, state, { mode: 'runs', refs }, combined);
      else if (expanding(state)) state = await continueState(host, state.id, { status: 'ready', wake: null });
      return resultState(state, await branches(host, state.id));
    } finally { if (dispatching.get(state.id) === controller) dispatching.delete(state.id); }
  });
}

export async function wait(host, input, signal) {
  const owner = main(host);
  return locked(host, owner, async () => {
    let state = await session(host, input.id, owner); check(!frozen(state), 'STOPPED', 'Ultra has ended.');
    check(expanding(state), 'CLOSED', 'Ultra is closed; existing Run notifications will deliver their results.');
    if (input.kind === 'input') {
      check(typeof input.reason === 'string' && input.reason.trim(), 'INVALID_WAIT', 'Explain the specific missing input and attempted alternatives.');
      state = await continueState(host, state.id, { status: 'waiting-input', wake: { mode: 'input', reason: input.reason }, summary: input.reason });
      return publicState(state, await branches(host, state.id));
    }
    let spec;
    if (input.kind === 'time') {
      const at = Date.parse(input.until); check(Number.isFinite(at) && at > Date.now(), 'INVALID_WAIT', 'Supply a concrete future ISO time.');
      spec = { mode: 'time', until: new Date(at).toISOString(), reason: input.reason ?? 'Wait for the next meaningful observation time.' };
    } else if (input.kind === 'event') {
      check(input.source && input.operation && input.input, 'INVALID_WAIT', 'An event wait requires the exact declared source, subscription operation and input.');
      spec = { mode: 'event', source: input.source, operation: input.operation, input: input.input, reason: input.reason ?? 'Wait for a new source event.' };
    } else {
      const observed = await observe(host, state), refs = observed.jobs.filter(job => job.status === 'running').flatMap(job => job.refs);
      check(refs.length, 'NO_ACTIVE_RUNS', 'There are no registered running branches to wait on.'); spec = { mode: 'runs', refs };
    }
    state = await launchCycle(host, state, spec, signal);
    return publicState(state, await branches(host, state.id));
  });
}

async function nextRun(host, reference, signal) {
  const first = (await host.runs.read(reference)).run; if (SETTLED.has(first.status)) return first;
  const stream = await host.runs.watch(reference, { afterVersion: first.revision, signal });
  try {
    for await (const run of stream.events) if (SETTLED.has(run.status)) return run;
    const last = (await host.runs.read(reference)).run;
    check(SETTLED.has(last.status), 'WATCH_ENDED', 'The Run subscription ended without a settled outcome.'); return last;
  } finally { await stream.close(); }
}

export async function cycle(host, input, signal, execution) {
  check(execution?.run?.id && execution.checkpoint, 'WORKFLOW_CONTEXT_REQUIRED', 'Ultra cycles require the host native workflow context.');
  const record = await read(host, 'sessions', input.id); check(record, 'NOT_FOUND', 'Ultra goal was not found.');
  let state = record.value;
  check((host.context.ownerSessionId ?? host.context.sessionId) === state.owner, 'FORBIDDEN', 'Ultra cycle belongs to another conversation.');
  state = await session(host, state.id, state.owner);
  check(!cancelAccepted(state), 'STOPPED', 'Ultra was stopped.');
  const saved = structuredClone(execution.checkpointState ?? { id: input.id, number: input.number, mode: input.mode });
  check(saved.id === input.id && saved.number === input.number && saved.mode === input.mode, 'CHECKPOINT_MISMATCH', 'Resume the original frozen Ultra cycle.');
  const checkpoint = () => execution.checkpoint(structuredClone(saved));
  try {
    if (!expanding(state) && !saved.planner) return resultState(state, await branches(host, state.id));
    if (input.mode === 'plan') {
      if (!saved.request) { saved.request = await plannerRequest(host, state, await branches(host, state.id)); await checkpoint(); }
      if (!saved.planner) {
        state = await session(host, state.id, state.owner);
        if (!expanding(state)) return resultState(state, await branches(host, state.id));
        const accepted = await host.capabilities.invoke('host.agent.run', saved.request, { signal, operationId: `${state.id}:planner:${input.number}`, task: { title: 'Ultra · 并行计划', output: { type: 'none' } } });
        check(accepted.type === 'run', 'INVALID_HOST_RESULT', 'The Ultra planner must be a tracked Agent.'); saved.planner = accepted.run; await checkpoint();
      }
      const result = await nextRun(host, saved.planner, signal);
      check(result.status === 'completed', 'PLANNER_UNAVAILABLE', result.error?.message ?? `Planner ${result.status}; inspect and resume its original Run.`);
      saved.result = retainedResult(result.output); await checkpoint();
      state = await session(host, state.id, state.owner);
      if (state.status !== 'waiting-input') state = await continueState(host, state.id, { status: 'ready', summary: String(result.output?.text ?? '').slice(0, 20000), wake: null });
      return { ...resultState(state, await branches(host, state.id)), plan: saved.result };
    }
    if (input.mode === 'runs') {
      check(input.refs?.length, 'INVALID_WAIT', 'A cycle requires real registered Run references.');
      const registered = new Set((await branches(host, state.id)).flatMap(job => job.refs ?? []).map(item => item.id));
      check(input.refs.every(item => registered.has(item.id)), 'FOREIGN_RUN', 'The cycle can wait only on its registered branches.');
      saved.refs ??= input.refs; await checkpoint();
      const controller = new AbortController(), combined = AbortSignal.any([controller.signal, signal].filter(Boolean));
      try { saved.changed = ref(await Promise.race(saved.refs.map(item => nextRun(host, item, combined)))); }
      finally { controller.abort(); }
    } else if (input.mode === 'time') {
      saved.until ??= input.until; await checkpoint();
      let remaining = Date.parse(saved.until) - Date.now();
      while (remaining > 0) { await delay(Math.min(remaining, 2 ** 31 - 1), undefined, { signal }); remaining = Date.parse(saved.until) - Date.now(); }
    } else if (input.mode === 'event') {
      saved.source ??= input.source; await checkpoint();
      const stream = await host.data.watch({ source: saved.source, operation: input.operation, input: input.input }, { signal });
      try {
        let received = false;
        for await (const event of stream.events) {
          // A subscription's initial snapshot is current state, not a fresh market event.
          if (event?.type === 'snapshot' || event?.kind === 'snapshot') continue;
          saved.event = retainedResult(event); received = true; break;
        }
        check(received, 'SOURCE_ENDED', 'The source subscription ended before a new event.');
      } finally { await stream.close(); }
    } else check(false, 'INVALID_WAIT', 'Unknown Ultra cycle mode.');
    await checkpoint();
    const observed = await observe(host, state);
    state = observed.state;
    if (state.status !== 'waiting-input') state = await continueState(host, state.id, { status: 'ready', wake: null,
      ...(['time', 'event'].includes(input.mode) ? { lastObservation: { cycle: input.number, mode: input.mode, ...(saved.until ? { until: saved.until } : {}), ...(saved.event ? { event: saved.event } : {}) } } : {}) });
    execution.progress?.({ phase: state.status, summary: expanding(state) ? '新结果已到达，继续 Ultra 目标。' : '已有研究结果已到达，整理成果并逐渐收敛。' });
    return { ...resultState(state, observed.jobs), ...(saved.event ? { event: saved.event } : {}) };
  } catch (error) {
    if (signal?.aborted || error.code === 'RUN_INTERRUPTED') throw error;
    await continueState(host, state.id, { status: 'interrupted', error: errorInfo(error) });
    return execution.interrupt({ reason: error.message, state: saved, requirements: [{ id: error.code ?? 'ULTRA_DEPENDENCY', available: false, reason: error.message }] });
  }
}

export async function resume(host, input, signal) {
  const owner = main(host);
  return locked(host, owner, async () => {
    const pointer = await read(host, 'owners', owner), controlGeneration = pointer?.value.closeGeneration ?? 0;
    let state = await session(host, input.id, owner);
    if (state.continuation === 'draining' || state.status === 'closed') {
      await requireReopen(host, owner, pointer?.value ?? state);
      state = await saveSession(host, state.id, { continuation: 'active', controlGeneration, status: 'ready', error: null });
    }
    check(!frozen(state), 'STOPPED', 'A stopped Ultra task is not resumed; start a new goal.');
    const jobs = await branches(host, state.id), refs = [...(state.cycle ? [state.cycle] : []), ...jobs.flatMap(job => job.refs ?? [])];
    check(!jobs.some(job => job.status === 'starting' && !job.refs?.length), 'RECONCILE_REQUIRED', 'An admitted branch has no recorded outcome. Inspect the original operation before continuing; it is not replayed.');
    for (const reference of refs) {
      const current = (await host.runs.read(reference)).run;
      if (current.status !== 'interrupted') { check(current.status !== 'unknown', 'RECONCILE_REQUIRED', 'A Run has an unknown outcome. Reconcile the original operation; do not replay it.'); continue; }
      const interruptIds = (current.interrupts ?? []).filter(item => !item.resolvedAt).map(item => item.id);
      check(interruptIds.length, 'INTERRUPT_REQUIRED', 'Read the exact current interruption before resuming.');
      state = await session(host, state.id, state.owner);
      if (!expanding(state)) return resultState(state, await branches(host, state.id));
      await host.runs.resume(reference, { interruptIds, ...(input.response ? { response: input.response } : {}), operationId: `${state.id}:resume:${hash([reference.id, interruptIds, input.response ?? null])}` });
    }
    state = await continueState(host, state.id, { status: 'ready', wake: null, error: null });
    const observed = await observe(host, state);
    state = observed.state;
    const running = observed.jobs.filter(job => job.status === 'running').flatMap(job => job.refs);
    if (running.length) state = await launchCycle(host, state, { mode: 'runs', refs: running }, signal);
    else if (!state.cycle || SETTLED.has((await host.runs.read(state.cycle)).run.status)) state = await launchCycle(host, state, state.pendingCycle?.spec ?? { mode: 'plan' }, signal);
    return resultState(state, observed.jobs);
  });
}

export async function close(host, input = {}) {
  const owner = main(host);
  // Validate explicit ownership before advancing the current owner's fence.
  if (input.id) {
    await session(host, input.id, owner);
    const current = await read(host, 'owners', owner);
    check(current?.value.id === input.id, 'NOT_FOUND', 'Close controls the current Ultra goal in this conversation.');
  }
  const pointer = await closeOwner(host, owner);
  if (!input.id && !pointer.id) return offState();
  let state = await session(host, input.id ?? pointer.id, owner);
  if (FINAL.has(state.status) || state.status === 'stopping') return resultState(state, await branches(host, state.id));
  // Do not wait behind dispatch's lock: a pending admission must retain its Run,
  // while this durable fence prevents the next branch from being started.
  state = await patch(host, 'sessions', state.id, value => frozen(value) || value.continuation === 'draining' ? value : {
    ...value, continuation: 'draining', status: 'closing', wake: null,
    closeReason: input.reason ?? 'User closed Ultra; let existing research finish.',
    closeRequestedAt: pointer.closeRequestedAt, closeAuthority: pointer.closeAuthority, updatedAt: Date.now(),
  });
  for (const job of await branches(host, state.id)) {
    if (job.status !== 'queued') continue;
    await patch(host, 'branches', branchKey(state.id, job.key), value => value.status === 'queued'
      ? { ...value, status: 'cancelled', withdrawnReason: 'Ultra closed before this branch started.', updatedAt: Date.now() } : value);
  }
  const observed = await observe(host, state);
  return resultState(observed.state, observed.jobs);
}

export async function stop(host, input = {}) {
  const owner = main(host), pointer = await read(host, 'owners', owner);
  if (!input.id && !pointer?.value.id) return offState();
  let state = await session(host, input.id, owner); if (['completed', 'stopped'].includes(state.status)) return publicState(state, await branches(host, state.id));
  const authority = await read(host, 'authorities', owner);
  state = await saveSession(host, state.id, { status: 'stopping', continuation: 'closed', wake: null, stopReason: input.reason ?? 'User stopped Ultra.', stopRequestedAt: Date.now(), stopAuthority: authority?.value.counter ?? 0 });
  dispatching.get(state.id)?.abort(Object.assign(new Error(state.stopReason), { code: 'CANCELLED' }));
  const jobs = await branches(host, state.id), failures = [];
  for (const job of jobs.filter(item => item.status === 'queued')) await saveBranch(host, job, { status: 'cancelled' });
  const refs = [...(state.cycle ? [state.cycle] : []), ...jobs.flatMap(job => job.refs ?? [])];
  await Promise.all(refs.map(async reference => {
    try { const actual = (await host.runs.read(reference)).run; if (!['completed', 'failed', 'cancelled', 'canceled'].includes(actual.status)) await host.runs.cancel(reference, { reason: state.stopReason }); }
    catch (error) { failures.push(errorInfo(error)); }
  }));
  // A domain stop is explicit and persisted; canceling a Run cannot undo an
  // already filled order or detach an external strategy by itself.
  for (const job of jobs.filter(item => item.stop && item.startedAt && !item.stopDone && !item.stopRefs?.length)) {
    try {
      const accepted = await host.capabilities.invoke(job.stop.capability, job.stop.input, { operationId: `${state.id}:stop:${job.key}` });
      const stopRefs = await acceptedRefs(host, state, accepted);
      await saveBranch(host, job, { stopRefs, stopDone: stopRefs.length === 0 });
    }
    catch (error) { failures.push(errorInfo(error)); }
  }
  if (failures.length) await saveSession(host, state.id, { error: { code: 'STOP_PENDING', message: 'Some existing work has not confirmed shutdown.', failures } });
  const observed = await observe(host, state);
  return publicState(observed.state, observed.jobs);
}

export async function finish(host, input) {
  const owner = main(host);
  return locked(host, owner, async () => {
    const observed = await observe(host, await session(host, input.id, owner)), state = observed.state;
    check(!frozen(state), 'STOPPED', 'Ultra is already ended.');
    check(!observed.jobs.some(job => taskActive(job) || job.status === 'interrupted'), 'WORK_REMAINS', 'Wait for, resolve, or explicitly cancel the retained unfinished branches before finishing.');
    check(observed.jobs.some(job => job.status === 'completed'), 'NO_EVIDENCE', 'A plan alone does not prove the user goal was achieved.');
    check(typeof input.summary === 'string' && input.summary.trim() && input.evidence?.length, 'NO_EVIDENCE', 'Give concrete completion evidence and report references from the actual work.');
    for (const job of observed.jobs.filter(item => item.stop && item.startedAt && !item.stopDone)) {
      const accepted = await host.capabilities.invoke(job.stop.capability, job.stop.input, { operationId: `${state.id}:stop:${job.key}` });
      const stopRefs = await acceptedRefs(host, state, accepted);
      await saveBranch(host, job, { stopRefs, stopDone: stopRefs.length === 0 });
      check(stopRefs.length === 0, 'CLEANUP_PENDING', 'The registered domain shutdown is still running; observe its actual completion before finishing.');
    }
    if (state.cycle) {
      const current = (await host.runs.read(state.cycle)).run;
      if (ACTIVE.has(current.status)) await host.runs.cancel(state.cycle, { reason: 'Ultra goal was verified complete.' });
    }
    const done = await saveSession(host, state.id, { status: 'completed', wake: null, completedAt: Date.now(), result: { summary: input.summary, evidence: input.evidence } });
    return publicState(done, observed.jobs);
  });
}
