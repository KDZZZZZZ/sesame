import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { evaluateReplay, validateSource } from '@sesame/plugin-sdk/svl';
import { loadProject, saveProject } from './project.js';
import { isRef, publishRecord, readText, requireThat } from './records.js';

const same = (a, b) => canonical(a) === canonical(b);
const utc = t => t?.basis === 'utc' && Number.isSafeInteger(t.unixMs) ? t.unixMs : null;
const needs = message => ({ status: 'needs_evidence', message });

// Evaluation fixtures can contain a whole rolling window *inside* every event.
// Truncating the events alone would leave the same leaked observations in place.
function knownAtDecision(source, events) {
  const bars = Object.entries(source.inputs);
  if (bars.length !== 1 || bars[0][1].kind !== 'bars' || bars[0][1].barPolicy !== 'closed')
    return needs('This check needs one closed-bar input. Verify external features, account clocks and multi-feed alignment with their own point-in-time evidence.');
  const input = bars[0][0], clean = [], currentBars = [], removals = [];
  let lastDecision = -Infinity, previousClosed = -Infinity;
  for (const event of events) {
    const at = utc(event.availableAt), window = event.inputs?.[input];
    if (event.type !== 'bar.closed' || event.input !== input || at === null || at <= lastDecision || !Array.isArray(window))
      return needs('Supply one chronological decision per closed bar, with a UTC event.availableAt and the original bar window.');
    lastDecision = at;
    const visible = [];
    let priorEnd = -Infinity;
    for (const row of window) {
      const open = utc(row?.openTime), end = utc(row?.endTime), released = utc(row?.availableAt);
      if (open === null || end === null || released === null || open >= end || end <= priorEnd || released < end)
        return needs('Each closed observation needs ordered UTC openTime/endTime and a first availableAt at or after its close. Missing or inconsistent publication time cannot establish historical availability.');
      priorEnd = end;
      if (end <= at && released <= at) visible.push(row);
    }
    const latest = utc(visible.at(-1)?.endTime);
    if (latest === null || latest <= previousClosed) return needs('Each closed-bar decision needs a distinct, newly observable current bar. Check window coverage and publication timestamps.');
    previousClosed = latest;
    currentBars.push(latest);
    clean.push({ ...event, inputs: { ...event.inputs, [input]: visible } });
    removals.push(window.length - visible.length);
  }
  return { input, clean, currentBars, removals };
}

const ready = value => value != null && !['not_ready', 'unknown', 'unsupported', 'not_applicable'].includes(value.status);
const traceReady = value => ready(Array.isArray(value) ? value.at(-1) : value);

function decisionNodes(source) {
  const ids = new Set();
  function visit(steps) {
    for (const step of steps) {
      for (const id of [step.when, ...(step.actions ?? []), ...(step.elseActions ?? [])]) if (id) ids.add(id);
      if (step.steps) visit(step.steps);
    }
  }
  for (const handler of source.handlers) visit(handler.steps);
  return ids;
}

function observable(row, names, decisions) {
  const nodes = {};
  const readyNodes = new Set();
  for (const name of names) {
    const hits = (row?.trace ?? []).filter(item => item.nodeId === name);
    if (hits.some(item => traceReady(item.value))) readyNodes.add(name);
    if (hits.length) nodes[name] = hits.map(item => ({ location: item.location, series: Array.isArray(item.value),
      value: Array.isArray(item.value) ? { samples: item.value.length, digest: digest(item.value), latest: item.value.at(-1) ?? null } : item.value ?? null }));
  }
  return { nodes, readyNodes, decisionReady: (row.trace ?? []).some(item => decisions.has(item.nodeId) && traceReady(item.value)), state: row.state, intents: row.intents };
}

function difference(baseline, variant, names, decisions) {
  if (baseline?.status !== 'committed' || variant?.status !== 'committed')
    return needs(variant?.error?.message ?? 'One replay did not reach and commit this event.');
  if (!baseline.trace?.length && !variant.trace?.length) return needs('The selected event exercised no strategy operation.');
  const left = observable(baseline, names, decisions), right = observable(variant, names, decisions);
  const stateFields = Object.keys({ ...left.state, ...right.state }).filter(key => !same(left.state[key], right.state[key]));
  const intentsChanged = !same(left.intents, right.intents);
  const nodeChanges = [], unexercisedNodes = [], unreadyNodes = [];
  for (const id of names) {
    if (!left.nodes[id] && !right.nodes[id]) { unexercisedNodes.push(id); continue; }
    if (!left.readyNodes.has(id) && !right.readyNodes.has(id)) unreadyNodes.push(id);
    const a = left.nodes[id] ?? null, b = right.nodes[id] ?? null;
    if (!same(a, b)) {
      const checkpointValues = samples => samples?.map(hit => ({ location: hit.location, value: hit.series ? hit.value.latest : hit.value })) ?? null;
      nodeChanges.push({ id, scope: same(checkpointValues(a), checkpointValues(b)) ? 'window_history_only' : 'checkpoint_value_or_execution', baseline: a, variant: b });
    }
  }
  const decisionReady = { baseline: left.decisionReady, variant: right.decisionReady };
  const incomplete = !left.decisionReady || !right.decisionReady || unexercisedNodes.length || unreadyNodes.length;
  const status = stateFields.length || intentsChanged || nodeChanges.length ? 'changed' : incomplete ? 'needs_evidence' : 'agreed_at_checkpoint';
  return { status, stateFields, intentsChanged, nodeChanges, unexercisedNodes, unreadyNodes, decisionReady };
}

function warmupEvents(known, i, length) {
  const start = i - length + 1;
  if (start < 0) return needs('There are fewer closed-bar decisions than the requested warm-up length.');
  const ends = new Set(known.currentBars.slice(start, i + 1)), firstEnd = known.currentBars[start];
  const selected = [];
  let shortened = start > 0;
  for (const event of known.clean.slice(start, i + 1)) {
    const window = event.inputs[known.input], rows = window.filter(row => utc(row.endTime) >= firstEnd);
    if (rows.some(row => !ends.has(utc(row.endTime)))) return needs('A closed bar in this warm-up interval has no archived decision. Supply the intervening events to reconstruct strategy state.');
    shortened ||= rows.length !== window.length;
    selected.push({ ...event, inputs: { ...event.inputs, [known.input]: rows } });
  }
  return shortened ? { selected } : needs('This warm-up is identical to the reference history. Select a later decision or a shorter history to test sensitivity.');
}

export function checkTemporalReplay(source, fixture, baseline, options, signal) {
  const names = options.trace_nodes ?? [], lengths = options.warmup_lengths ?? [], ids = options.event_ids;
  requireThat(ids?.length > 0 && ids.length <= 8 && new Set(ids).size === ids.length
    && lengths.length <= 6 && lengths.every(v => Number.isSafeInteger(v) && v > 0) && new Set(lengths).size === lengths.length
    && names.length <= 8 && names.every(id => source.nodes.some(n => n.id === id)), 'Select existing event and node IDs and positive distinct warm-up lengths.');
  const events = fixture.events ?? [], indices = ids.map(id => events.findIndex(e => e.eventId === id));
  requireThat(indices.every(i => i >= 0) && new Set(events.map(e => e.eventId)).size === events.length,
    'Choose distinct archived decision events; duplicate event identities need reconciliation.');
  const prefix = events.slice(0, Math.max(...indices) + 1);
  const work = prefix.length + indices.reduce((sum, i) => sum + lengths.filter(n => n <= i + 1).reduce((a, n) => a + n, 0), 0);
  requireThat(work <= 25000, 'Split the requested checkpoints or histories into smaller replay checks.');
  const known = knownAtDecision(source, prefix);
  if (known.status) return known;
  signal?.throwIfAborted();
  const run = items => evaluateReplay(source, { ...fixture, events: items });
  const decisions = decisionNodes(source);
  const declared = Object.fromEntries(Object.entries(source.state).map(([id, entry]) => [id, entry.initial]));
  const initialStateBasis = fixture.initialState && !same(fixture.initialState, declared) ? 'fixture_snapshot' : 'source_defaults';
  const asOf = run(known.clean), original = new Map(baseline.events.map(row => [row.eventId, row]));
  const visible = new Map(asOf.events.map(row => [row.eventId, row]));
  const checkpoints = indices.map((i, j) => {
    signal?.throwIfAborted();
    const id = ids[j], at = utc(events[i].availableAt);
    const result = { eventId: id, decisionUtcMs: at, removedWindowEntries: known.removals.slice(0, i + 1).reduce((a, n) => a + n, 0),
      asOf: difference(original.get(id), visible.get(id), names, decisions), warmup: [] };
    for (const length of lengths) {
      if (initialStateBasis === 'fixture_snapshot') {
        result.warmup.push({ length, ...needs('The fixture supplies non-default starting state. A dated state snapshot for the shortened run is needed.') }); continue;
      }
      const history = warmupEvents(known, i, length);
      if (history.status) { result.warmup.push({ length, ...history }); continue; }
      const { selected } = history;
      const check = run(selected).events.find(row => row.eventId === id);
      result.warmup.push({ length, visibleBarsAtCheckpoint: selected.at(-1).inputs[known.input].length, ...difference(visible.get(id), check, names, decisions) });
    }
    return result;
  });
  const outcomes = checkpoints.flatMap(c => [c.asOf, ...c.warmup]);
  const status = checkpoints.some(c => c.removedWindowEntries) || outcomes.some(x => x.status === 'changed') ? 'findings'
    : outcomes.some(x => x.status === 'needs_evidence') ? 'needs_evidence' : 'agreed_at_checkpoints';
  return { status, scope: 'archived_single_closed_bar_svl_inputs', initialStateBasis, checkpoints,
    next: checkpoints.some(c => c.removedWindowEntries) ? 'Repair the source publication timeline and repeat the same checkpoints before interpreting performance.'
      : checkpoints.some(c => c.warmup.some(w => w.status === 'changed')) ? 'Trace the first differing node or state. Compare a longer warm-up or an explicit readiness rule before modifying entries.'
      : 'Use the tested timestamps and exercised rules as the scope of this observation.' };
}

export async function verifyProject(host, input, signal) {
  const project = await loadProject(host, input.project_ref), impl = project.implementation;
  requireThat(isRef(impl?.sourceRef, 'strategy.source') && isRef(impl.replay?.ref, 'resource'), 'Build the SVL source and run it against a fixture first.');
  const sourceRef = impl.sourceRef, replayRef = impl.replay.ref;
  const [sourceManifest, replayManifest] = await Promise.all([sourceRef, replayRef].map(ref => host.resources.read(ref, { part: 'manifest' })));
  const info = replayManifest.content;
  requireThat(info.type === 'svl-evaluation' && same(info.source, sourceRef) && info.sourceDigest === impl.sourceDigest, 'The replay must belong to the exact published SVL source.');
  const [sourceText, fixture, baseline] = await Promise.all([
    readText(host, sourceRef, sourceManifest.content.sourcePath, 1024 * 1024),
    readText(host, replayRef, info.inputPath, 4 * 1024 * 1024).then(JSON.parse),
    readText(host, replayRef, info.resultPath, 32 * 1024 * 1024).then(JSON.parse),
  ]);
  const validated = validateSource(sourceText);
  requireThat(validated.sourceDigest === info.sourceDigest && baseline.sourceDigest === info.sourceDigest, 'The replay and source digest differ.');
  const result = checkTemporalReplay(validated.source, fixture, baseline, input, signal);
  const checks = { event_ids: input.event_ids, warmup_lengths: input.warmup_lengths ?? [], trace_nodes: input.trace_nodes ?? [] };
  const assessment = { sourceRef, replayRef, checks, ...result };
  const ref = await publishRecord(host, 'strategy-development.temporal-check', assessment, input.operation_id, [sourceRef, replayRef]);
  const output = await saveProject(host, { ...project, implementation: { ...impl, temporalCheck: { status: result.status, ref, replayRef } } }, input.project_ref, input.operation_id);
  return { ...output, assessment: { ...assessment, ref } };
}
