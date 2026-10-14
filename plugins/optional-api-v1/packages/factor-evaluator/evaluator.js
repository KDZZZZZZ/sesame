import { createHash } from 'node:crypto';
import { prepareDataset, evaluateFactor, compareFactors, validateExpression, EVALUATOR_VERSION } from './engine.js';
export const PROTOCOL = 'sesame.factor-evaluator/v1';
export const canonical = value => JSON.stringify(normalize(value));
function normalize(value) { return Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value; }
export const digest = value => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
export function check(ok, message, code = 'EVALUATION_REJECTED') { if (!ok) throw Object.assign(new Error(message), { code }); }
const receipt = value => ({ ...value, receiptDigest: digest(value) });
const bounded = (value, label) => { check(typeof value === 'string' && value.length > 0 && value.length <= 200, `${label} is required`); return value; };
const candidateExample = { op: 'delta', args: [{ op: 'field', name: 'close' }], window: 5 };
const instructions = 'This explicitly selected evaluator accepts a factor AST. Operators: field(name), constant(value), add/sub/mul/div(2 args), neg/abs/log/rank/zscore(1 arg), lag/delta/mean/std/sum(1 arg, window 1..252). It computes train/validation Rank IC, coverage, non-overlapping long-short return after costs and train-only redundancy. Submit the AST as candidate; never supply measured metrics.';

function caller(host) {
  check(typeof host.tools?.invocation === 'function', 'Upgrade Sesame to expose live tool invocation proof', 'HOST_UPGRADE_REQUIRED');
  const chain = host.tools.invocation().chain;
  check(chain.length >= 2 && chain.at(-1).pluginId === host.plugin.id, 'Evaluation requires a nested workflow tool invocation', 'FORBIDDEN');
  return chain.at(-2).pluginId;
}
function options(value = {}) {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => ['dataset', 'minRankIC', 'minCoverage', 'maxCorrelation'].includes(key)), 'Unknown evaluator option');
  const number = (value, fallback, min, max) => { const n = value ?? fallback; check(Number.isFinite(n) && n >= min && n <= max, 'Invalid evaluator threshold'); return n; };
  return { dataset: value.dataset, minRankIC: number(value.minRankIC, 0, -1, 1), minCoverage: number(value.minCoverage, .6, 0, 1), maxCorrelation: number(value.maxCorrelation, .95, 0, 1) };
}
export function evaluate(host, args) {
  check(args.protocol === PROTOCOL, 'Unsupported evaluator protocol');
  const workflowPluginId = caller(host), runId = bounded(args.run_id, 'run_id');
  if (args.action === 'prepare') {
    check(host.scope.kind === 'main', 'Prepare a new evaluator session in the main conversation', 'FORBIDDEN');
    check(['restricted', 'development-only'].includes(args.access), 'Choose restricted or development-only data access');
    const sourceId = bounded(args.dataset_id, 'dataset_id'), config = options(args.options), source = host.datasets.read(sourceId);
    check(Buffer.byteLength(JSON.stringify(source.rows)) <= 4 * 1024 * 1024, 'Use a panel <=4MiB');
    const dataset = prepareDataset(source.rows, config.dataset, { developmentOnly: args.access === 'development-only' });
    config.dataset = dataset.config;
    const provenance = structuredClone(source.provenance ?? { source_kind: source.source_kind ?? 'unspecified' });
    check(Buffer.byteLength(JSON.stringify(provenance)) <= 12000, 'Keep input provenance within 12KB');
    const id = `fe_${digest([workflowPluginId, host.scope.conversationId, runId]).slice(7, 39)}`;
    const inputDigest = digest({ dataset, sourceId }), fingerprint = digest({ inputDigest, config, provenance, access: args.access });
    const prior = host.storage.get('sessions', id, true);
    if (prior) { check(prior.fingerprint === fingerprint, 'Evaluator session already has different frozen inputs'); return prior.prepared; }
    const development = { evaluatorVersion: EVALUATOR_VERSION, access: args.access, config: dataset.config, summary: dataset.summary,
      rows: dataset.rows.filter(row => row.time <= dataset.config.validationEnd) };
    const prepared = receipt({ protocol: PROTOCOL, action: 'prepare', runId, sessionId: id, inputDigest,
      data: { sourceId, digest: inputDigest, evaluatorVersion: EVALUATOR_VERSION, rowCount: dataset.summary.rows, symbolCount: dataset.summary.symbols.length,
        fields: dataset.summary.fields, range: { start: dataset.summary.start, end: dataset.summary.end }, provenance,
        synthetic: /demo|synthetic|fixture/i.test([source.source_kind, provenance.kind, provenance.source_kind].join(' ')),
        scope: 'development', holdoutMode: args.access === 'restricted' ? 'workflow-isolated' : 'none' },
      contract: { candidateExample, instructions, dataset: dataset.config, metricColumns: [{ key: 'rankIC', label: 'Rank IC' }, { key: 'coverage', label: '覆盖率' }, { key: 'netReturn', label: '净收益' }] }, development });
    host.storage.put('sessions', { id, runId, workflowPluginId, ownerConversationId: host.scope.conversationId, fingerprint, dataset, config, prepared, candidates: {} });
    return prepared;
  }
  const session = host.storage.get('sessions', bounded(args.session_id, 'session_id'));
  check(session.workflowPluginId === workflowPluginId && session.runId === runId, 'Evaluator session belongs to another workflow', 'FORBIDDEN');
  if (host.scope.kind === 'main') check(session.ownerConversationId === host.scope.conversationId, 'Evaluator session belongs to another conversation', 'FORBIDDEN');
  else {
    const task = host.agents.current();
    check(task?.pluginId === workflowPluginId && task.input?.runId === runId && task.status === 'running', 'Evaluation requires the registered workflow task', 'FORBIDDEN');
  }
  check(session.dataset.evaluatorVersion === EVALUATOR_VERSION, 'Evaluator version changed');
  const dataset = prepareDataset(session.dataset.rows, session.dataset.config, { developmentOnly: session.dataset.access === 'development-only' });
  check(digest({ dataset, sourceId: session.prepared.data.sourceId }) === session.prepared.inputDigest, 'Frozen input digest differs');
  const common = { protocol: PROTOCOL, action: args.action, runId, sessionId: session.id };
  if (args.action === 'candidate') {
    check(!session.selection, 'Candidate selection is frozen');
    const trialId = bounded(args.trial_id, 'trial_id');
    let candidate;
    try { candidate = validateExpression(args.candidate); } catch (error) { error.code = 'EVALUATION_REJECTED'; throw error; }
    const candidateDigest = digest(candidate);
    const previous = session.candidates[trialId];
    if (previous) { check(previous.candidateDigest === candidateDigest, 'Candidate receipt is frozen'); return previous; }
    check(Object.keys(session.candidates).length < 40, 'Evaluator trial budget reached');
    check(!Object.values(session.candidates).some(value => value.candidateDigest === candidateDigest), 'Duplicate candidate formula');
    const accepted = args.accepted_ids ?? [];
    check(Array.isArray(accepted) && accepted.length <= 40 && accepted.every(id => Object.hasOwn(session.candidates, id)), 'Unknown comparison candidate');
    const metrics = evaluateFactor(dataset, candidate), validation = metrics.validation;
    const eligible = Number.isFinite(validation.rankIC) && validation.rankIC >= session.config.minRankIC && validation.coverage >= session.config.minCoverage;
    const result = receipt({ ...common, trialId, candidate, candidateDigest, metrics, eligible,
      gate: eligible ? 'validation threshold passed; not proof of tradability' : 'validation rankIC/coverage threshold not met',
      redundancy: accepted.map(id => ({ trialId: id, ...compareFactors(dataset, candidate, session.candidates[id].candidate) })) });
    session.candidates[trialId] = result; host.storage.put('sessions', session); return result;
  }
  if (args.action === 'select') {
    const ids = args.trial_ids;
    check(Array.isArray(ids) && ids.length <= 20 && new Set(ids).size === ids.length && ids.every(id => session.candidates[id]?.eligible), 'Select unique eligible measured candidates');
    if (session.selection) { check(canonical(session.selection.trialIds) === canonical(ids), 'Selection is frozen'); return session.selection; }
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const corr = compareFactors(dataset, session.candidates[ids[a]].candidate, session.candidates[ids[b]].candidate);
      check(corr.correlation !== null && Math.abs(corr.correlation) <= session.config.maxCorrelation, 'Selected factors are redundant or have insufficient train overlap');
    }
    session.selection = receipt({ ...common, trialIds: ids, selectionDigest: digest({ input: session.prepared.inputDigest, ids, candidates: ids.map(id => session.candidates[id].candidateDigest) }) });
    host.storage.put('sessions', session); return session.selection;
  }
  check(args.action === 'finalize', 'Unknown evaluator action');
  check(session.selection && args.selection_digest === session.selection.selectionDigest, 'Final evaluation requires the exact frozen selection');
  if (session.final) return session.final;
  const holdout = {};
  if (dataset.access !== 'development-only') for (const id of session.selection.trialIds) holdout[id] = evaluateFactor(dataset, session.candidates[id].candidate, { holdout: true }).holdout;
  session.final = receipt({ ...common, selectionDigest: session.selection.selectionDigest, holdout, holdoutStatus: dataset.access === 'development-only' ? 'not-requested' : 'evaluated', archive: dataset });
  host.storage.put('sessions', session); return session.final;
}
