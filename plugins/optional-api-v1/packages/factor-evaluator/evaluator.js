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
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const hashBytes = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export const inputDigest = (dataset, data) => digest({ dataset, sourceId: data.sourceId, ...(data.inputRefs ? { inputRefs: data.inputRefs } : {}) });
// Published artifacts sort keys while serializing. Keep the evaluator's existing
// receipt/input digest contract unchanged: JSON.stringify reorders integer keys.
function artifactCanonical(value) {
  if (Array.isArray(value)) return `[${value.map(artifactCanonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${artifactCanonical(value[key])}`).join(',')}}`;
  check(value === null || typeof value === 'boolean' || typeof value === 'string' || Number.isFinite(value), 'Artifact manifest must contain JSON values');
  return JSON.stringify(value);
}

function caller(host, execution) {
  const provenance = execution?.provenance, chain = provenance?.chain;
  check(Array.isArray(chain) && chain.length >= 2 && chain.at(-1).pluginId === host.context.pluginId && provenance.caller?.pluginId === chain.at(-2).pluginId,
    'Evaluation requires a trusted nested workflow capability invocation', 'FORBIDDEN');
  return provenance.caller.pluginId;
}
async function readDataset(host, datasetId, signal) {
  const available = await host.data.sources({ contract: 'sesame.datasets/1' });
  const selected = available.items.find(item => item.ref.providerId === 'host#datasets' && item.available !== false);
  check(selected, 'The saved dataset source is unavailable', 'DATA_SOURCE_UNAVAILABLE');
  const rows = []; let cursor, metadata, bytes = 0;
  do {
    const result = await host.data.query({ source: selected.ref, operation: 'query', input: { datasetId }, limit: 200, ...(cursor ? { cursor } : {}) }, { signal });
    metadata ??= result.metadata; rows.push(...result.items); bytes += Buffer.byteLength(JSON.stringify(result.items));
    check(bytes <= 4 * 1024 * 1024, 'Use a panel <=4MiB'); cursor = result.nextCursor;
  } while (cursor);
  check(metadata?.id === datasetId, 'Dataset source returned a different identity'); return { ...metadata, rows };
}
async function readFixedDataset(host, ref, signal) {
  check(ref && typeof ref === 'object' && !Array.isArray(ref) && Object.keys(ref).sort().join(',') === 'digest,id,kind,revision,schemaVersion' &&
    ['id', 'revision'].every(key => typeof ref[key] === 'string' && ref[key].length > 0 && ref[key].length <= 200) &&
    ref.kind === 'data' && ref.schemaVersion === '1.0.0' && /^sha256:[a-f0-9]{64}$/.test(ref.digest), 'Use a complete fixed data reference');
  signal?.throwIfAborted();
  const manifest = await host.resources.read(ref, { part: 'manifest' });
  check(manifest && typeof manifest === 'object' && hashBytes(artifactCanonical(manifest)) === ref.digest, 'Fixed input manifest digest differs');
  check(manifest.kind === 'data' && manifest.schemaVersion === ref.schemaVersion, 'Unsupported fixed data schema');
  const content = manifest.content;
  check(content?.format === 'json-rows', 'Fixed data must use json-rows');
  check(Number.isSafeInteger(content.rowCount) && content.rowCount > 0 && content.rowCount <= 20000, 'Use a panel with 1–20000 rows');
  check(content.provenance && ['observed', 'derived', 'user_input', 'demo'].includes(content.provenance.kind), 'Fixed data requires recorded provenance');
  check(Array.isArray(manifest.dependencies) && manifest.dependencies.length <= 256 && (content.provenance.kind !== 'derived' || manifest.dependencies.length > 0), 'Fixed data requires its recorded dependencies');
  const entries = Array.isArray(manifest.blobs) ? manifest.blobs.filter(blob => blob.path === content.path) : [];
  check(typeof content.path === 'string' && content.path.length > 0 && entries.length === 1, 'Fixed data requires its published content entry');
  const blob = entries[0];
  check(Number.isSafeInteger(blob.size) && blob.size > 0 && blob.size <= MAX_INPUT_BYTES, 'Use a panel <=4MiB');
  check(/^sha256:[a-f0-9]{64}$/.test(blob.digest), 'Fixed data content digest is required');
  const parts = []; let offset = 0;
  for (;;) {
    signal?.throwIfAborted();
    const value = await host.resources.read(ref, { part: 'content', entry: content.path, encoding: 'base64', offset, length: 262144 });
    check(canonical(value.ref) === canonical(ref), 'Fixed input returned a different source identity');
    check(value.encoding === 'base64' && typeof value.content === 'string', 'Fixed input must return base64 content');
    const chunk = Buffer.from(value.content, 'base64');
    check(value.offset === offset && value.length === chunk.length && value.total === blob.size && offset + chunk.length <= MAX_INPUT_BYTES, 'Fixed input byte range differs or exceeds 4MiB');
    parts.push(chunk); offset += chunk.length;
    if (value.nextOffset === undefined) { check(offset === blob.size, 'Fixed input content is incomplete'); break; }
    check(chunk.length > 0 && value.nextOffset === offset && offset < blob.size, 'Invalid fixed input byte cursor');
  }
  signal?.throwIfAborted();
  const bytes = Buffer.concat(parts);
  check(hashBytes(bytes) === blob.digest, 'Fixed input content digest differs');
  let rows;
  try { rows = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { check(false, 'Fixed input must contain UTF-8 JSON rows'); }
  check(Array.isArray(rows) && rows.length === content.rowCount, 'Fixed input rowCount differs from actual rows');
  return { id: ref.id, rows, provenance: structuredClone(content.provenance), inputRefs: [structuredClone(ref)], dependencies: structuredClone(manifest.dependencies) };
}
async function readJson(host, ref) {
  const parts = []; let offset = 0, bytes = 0;
  for (;;) {
    const value = await host.resources.read(ref, { part: 'content', encoding: 'base64', offset });
    const chunk = Buffer.from(value.content, 'base64'); bytes += chunk.length;
    check(bytes <= 16 * 1024 * 1024, 'Stored evaluator payload exceeds 16 MiB'); parts.push(chunk);
    if (value.nextOffset === undefined) return JSON.parse(Buffer.concat(parts).toString('utf8'));
    check(value.nextOffset > offset, 'Invalid stored resource cursor'); offset = value.nextOffset;
  }
}
async function storedSession(host, id) {
  let record;
  try { record = await host.state.read({ collection: 'sessions', key: id }); }
  catch (error) { if (error.code === 'NOT_FOUND') return null; throw error; }
  const { refs, ...session } = record.value;
  session.dataset = await readJson(host, refs.dataset); session.prepared = await readJson(host, refs.prepared);
  session.candidates = Object.fromEntries(await Promise.all(Object.entries(refs.candidates).map(async ([id, ref]) => [id, await readJson(host, ref)])));
  if (refs.final) session.final = await readJson(host, refs.final);
  return { ...session, _stateVersion: record.version, _refs: refs };
}
async function saveSession(host, session, signal) {
  const refs = { ...session._refs, candidates: { ...session._refs?.candidates } };
  const persist = (name, value) => host.resources.create({ kind: 'blob', name: `${session.id}-${name}-${digest(value).slice(7, 23)}.json`, lifetime: 'durable', policy: { readOnly: true }, source: { content: JSON.stringify(value) } }, { operationId: `${session.id}:${name}:${digest(value)}`, signal });
  refs.dataset ??= await persist('input', session.dataset); refs.prepared ??= await persist('prepared', session.prepared);
  for (const [id, value] of Object.entries(session.candidates)) refs.candidates[id] ??= await persist(`candidate-${digest(id).slice(7, 23)}`, value);
  if (session.final) refs.final ??= await persist('final', session.final);
  const { dataset, prepared, candidates, final, _stateVersion, _refs, ...metadata } = session;
  await host.state.commit([{ op: 'put', key: { collection: 'sessions', key: session.id }, expectedVersion: _stateVersion ?? 0, value: { ...metadata, refs } }], { signal });
}
function options(value = {}) {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => ['dataset', 'inputRef', 'minRankIC', 'minCoverage', 'maxCorrelation'].includes(key)), 'Unknown evaluator option');
  const number = (value, fallback, min, max) => { const n = value ?? fallback; check(Number.isFinite(n) && n >= min && n <= max, 'Invalid evaluator threshold'); return n; };
  return { dataset: value.dataset, ...(value.inputRef === undefined ? {} : { inputRef: structuredClone(value.inputRef) }), minRankIC: number(value.minRankIC, 0, -1, 1), minCoverage: number(value.minCoverage, .6, 0, 1), maxCorrelation: number(value.maxCorrelation, .95, 0, 1) };
}
const sessions = new Map();
export async function evaluate(host, args, signal, execution) {
  const owner = caller(host, execution);
  const session = args.session_id ?? `fe_${digest([owner, host.context.sessionId, args.run_id]).slice(7, 39)}`;
  const key = `${host.context.storageRoot ?? host.context.pluginId}:${session}`;
  // Candidate receipts share one session document. Serialize that document's
  // mutations while independent sessions remain concurrent; CAS stays enabled.
  const work = (sessions.get(key) ?? Promise.resolve()).catch(() => {}).then(() => evaluateSession(host, args, signal, execution));
  sessions.set(key, work);
  try { return await work; } finally { if (sessions.get(key) === work) sessions.delete(key); }
}
async function evaluateSession(host, args, signal, execution) {
  signal?.throwIfAborted();
  check(args.protocol === PROTOCOL, 'Unsupported evaluator protocol');
  const workflowPluginId = caller(host, execution), runId = bounded(args.run_id, 'run_id');
  if (args.action === 'prepare') {
    check(host.context.kind === 'main', 'Prepare a new evaluator session in the main conversation', 'FORBIDDEN');
    check(['restricted', 'development-only'].includes(args.access), 'Choose restricted or development-only data access');
    const config = options(args.options), hasDataset = args.dataset_id !== undefined, hasRef = config.inputRef !== undefined;
    check(hasDataset !== hasRef, hasDataset ? 'Choose dataset_id or options.inputRef, not both' : 'dataset_id or options.inputRef is required');
    const source = hasRef ? await readFixedDataset(host, config.inputRef, signal) : await readDataset(host, bounded(args.dataset_id, 'dataset_id'), signal);
    const sourceId = source.id, sourceIdentity = { sourceId, ...(source.inputRefs ? { inputRefs: source.inputRefs } : {}) };
    check(Buffer.byteLength(JSON.stringify(source.rows)) <= 4 * 1024 * 1024, 'Use a panel <=4MiB');
    const dataset = prepareDataset(source.rows, config.dataset, { developmentOnly: args.access === 'development-only' });
    config.dataset = dataset.config;
    const provenance = structuredClone(source.provenance ?? { source_kind: source.source_kind ?? 'unspecified' });
    check(Buffer.byteLength(JSON.stringify(provenance)) <= 12000, 'Keep input provenance within 12KB');
    const id = `fe_${digest([workflowPluginId, host.context.sessionId, runId]).slice(7, 39)}`;
    const frozenDigest = inputDigest(dataset, sourceIdentity), fingerprint = digest({ inputDigest: frozenDigest, config, provenance, access: args.access });
    const prior = await storedSession(host, id);
    if (prior) { check(prior.fingerprint === fingerprint, 'Evaluator session already has different frozen inputs'); return prior.prepared; }
    const development = { evaluatorVersion: EVALUATOR_VERSION, access: args.access, config: dataset.config, summary: dataset.summary,
      rows: dataset.rows.filter(row => row.time <= dataset.config.validationEnd) };
    const prepared = receipt({ protocol: PROTOCOL, action: 'prepare', runId, sessionId: id, inputDigest: frozenDigest,
      data: { ...sourceIdentity, ...(source.dependencies ? { dependencies: source.dependencies } : {}), digest: frozenDigest, evaluatorVersion: EVALUATOR_VERSION, rowCount: dataset.summary.rows, symbolCount: dataset.summary.symbols.length,
        fields: dataset.summary.fields, range: { start: dataset.summary.start, end: dataset.summary.end }, provenance,
        synthetic: /demo|synthetic|fixture/i.test([source.source_kind, provenance.kind, provenance.source_kind].join(' ')),
        scope: 'development', holdoutMode: args.access === 'restricted' ? 'workflow-isolated' : 'none' },
      contract: { candidateExample, instructions, dataset: dataset.config, metricColumns: [{ key: 'rankIC', label: 'Rank IC' }, { key: 'coverage', label: '覆盖率' }, { key: 'netReturn', label: '净收益' }] }, development });
    await saveSession(host, { id, runId, workflowPluginId, ownerConversationId: host.context.sessionId, fingerprint, dataset, config, prepared, candidates: {} }, signal);
    return prepared;
  }
  const session = await storedSession(host, bounded(args.session_id, 'session_id'));
  check(session, 'Evaluator session does not exist', 'NOT_FOUND');
  check(session.workflowPluginId === workflowPluginId && session.runId === runId, 'Evaluator session belongs to another workflow', 'FORBIDDEN');
  const workflow = execution?.provenance?.workflow;
  if (workflow) check(workflow.ownerSessionId === session.ownerConversationId, 'Evaluator session belongs to another workflow owner', 'FORBIDDEN');
  if (host.context.kind === 'main') check(session.ownerConversationId === host.context.sessionId, 'Evaluator session belongs to another conversation', 'FORBIDDEN');
  else if (workflow && !execution.provenance.agent) {
    check(workflow.sessionId === host.context.sessionId && workflow.runId === execution.provenance.caller.runId, 'Evaluation requires its trusted workflow controller', 'FORBIDDEN');
  } else {
    const task = execution?.provenance?.agent;
    check(task?.pluginId === workflowPluginId && task.input?.runId === runId && task.sessionId === host.context.sessionId && task.taskId, 'Evaluation requires the registered workflow Agent', 'FORBIDDEN');
  }
  check(session.dataset.evaluatorVersion === EVALUATOR_VERSION, 'Evaluator version changed');
  const dataset = prepareDataset(session.dataset.rows, session.dataset.config, { developmentOnly: session.dataset.access === 'development-only' });
  check(inputDigest(dataset, session.prepared.data) === session.prepared.inputDigest, 'Frozen input digest differs');
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
    session.candidates[trialId] = result; await saveSession(host, session, signal); return result;
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
    await saveSession(host, session, signal); return session.selection;
  }
  check(args.action === 'finalize', 'Unknown evaluator action');
  check(session.selection && args.selection_digest === session.selection.selectionDigest, 'Final evaluation requires the exact frozen selection');
  if (session.final) return session.final;
  const holdout = {};
  if (dataset.access !== 'development-only') for (const id of session.selection.trialIds) holdout[id] = evaluateFactor(dataset, session.candidates[id].candidate, { holdout: true }).holdout;
  session.final = receipt({ ...common, selectionDigest: session.selection.selectionDigest, holdout, holdoutStatus: dataset.access === 'development-only' ? 'not-requested' : 'evaluated', archive: dataset });
  await saveSession(host, session, signal); return session.final;
}
