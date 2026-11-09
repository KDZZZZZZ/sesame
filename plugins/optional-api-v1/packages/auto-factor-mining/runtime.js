import { OPERATOR_DIGEST, canonical, clone, digest, ensure, error, failure, identifier, validateDraft, validateMeasure, validateFormula } from './contracts.js';
import { publicJob } from './journal.js';
import { evidenceContext } from './python-bridge.js';

const TERMINAL = new Set(['completed', 'cancelled', 'failed']);
const RUNNING_RUNS = new Set(['queued', 'running', 'interrupting', 'cancelling']);
const CONTROL_ERRORS = new Set(['CANCELLED', 'RUN_INTERRUPTED', 'ABORT_ERR', 'BUDGET_EXHAUSTED', 'PROCESS_RECONCILIATION_REQUIRED']);
const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const formulaDigest = formula => digest({ dsl: formula.dsl, operatorDigest: OPERATOR_DIGEST, tree: formula.tree });
const candidateFor = (formula, hypothesis) => ({ id: `c_${formulaDigest(formula).slice(7)}`, formula, hypothesis: hypothesis.slice(0, 2000), origin: { method: 'seed', parents: [], parameters: {} } });
const finishTime = job => ({ activeMs: job.activeMs + (job.startedAt ? Date.now() - job.startedAt : 0), startedAt: null });
const sameRef = (a, b) => canonical(a ?? null) === canonical(b ?? null);

/** Host integration injects the SDK capability/artifact ports and python.selection
 * as environment. Numerical modules retain their narrow APIs. */
export function createRuntime({ search, compute, evaluator, library, journal, runs, reports, capabilities, artifacts, environment }) {
  const active = new Map();
  const inputFor = job => artifacts.readJSON(job.inputRef);
  const context = (job, execution, controller, attemptId) => ({ jobId: job.id, epoch: job.epoch, attemptId, nativeAttempt: execution.run.attempt ?? execution.attempt ?? 1, signal: AbortSignal.any([execution.signal, controller.signal].filter(Boolean)) });
  const checkedUpdate = (ctx, transform) => journal.update(ctx.jobId, job => {
    ensure(job.epoch === ctx.epoch && ['running', 'pausing'].includes(job.status), 'Research execution is no longer active', 'CANCELLED');
    return transform(job);
  }, ctx.signal);
  const progress = async (jobId, execution, message) => {
    const job = await journal.get(jobId);
    await execution.checkpoint({ jobId, epoch: job.epoch, phase: job.phase, searchCheckpoint: job.searchCheckpoint });
    execution.emit('progress', { message, phase: job.phase, completed: job.completed, proposed: job.proposed });
  };
  const loadValues = async (ref, ctx) => ({ ...await artifacts.readJSON(ref, ctx), manifest: ref });
  const loadSnapshot = async (ref, ctx) => ({ ...await artifacts.readJSON(ref, ctx), manifest: ref });
  const saveJSON = (value, schema, operationId, dependencies, ctx) => artifacts.publishJSON(value, { schema, operationId, dependencies: dependencies.filter(Boolean) }, ctx);

  async function definitions(input) { return Promise.all([...new Set(input.references ?? [])].map(id => library.read(id))); }
  function referenceMetadata(factors, snapshot, engine, batchSize, partition) {
    return chunks(factors, batchSize).map(group => ({ snapshotId: snapshot.id, partition, engine, candidates: group.map(factor => {
      validateFormula(factor.formula, { fields: snapshot.fields });
      return { status: 'ok', value: { candidate: { formula: factor.formula }, computeKey: digest({ formula: formulaDigest(factor.formula), snapshotId: snapshot.id, calendarDigest: snapshot.calendarDigest, layout: snapshot.layout, partition, engine }) } };
    }) }));
  }
  async function matchesEvidence(factor, input, snapshot, selectedEnvironment, referenceFactors) {
    const engine = { name: 'qlib', version: selectedEnvironment.versions?.pyqlib, environmentDigest: selectedEnvironment.environmentDigest, operatorDigest: OPERATOR_DIGEST };
    if (!engine.version || !engine.environmentDigest) return false;
    let cursor;
    do {
      const page = await library.evaluations(factor.id, { limit: 100, ...(cursor ? { cursor } : {}) });
      for (const evaluation of page.items) {
        if (evaluation.partition !== 'development' || evaluation.eligibility !== 'supported' || canonical(evaluation.profile) !== canonical(input.profile) ||
            evaluation.pairs < input.profile.minPairs || (evaluation.coverage.value ?? -1) < input.profile.minCoverage) continue;
        const values = await loadValues(evaluation.valuesRef), frozen = await loadSnapshot(values.snapshotRef);
        if (canonical(frozen.layout) !== canonical(input.layout) || canonical(values.engine) !== canonical(engine)) continue;
        if (snapshot ? frozen.id !== snapshot.id || !sameRef(frozen.source, snapshot.source) || frozen.calendarDigest !== snapshot.calendarDigest
          : !input.source.ref || !sameRef(frozen.source, input.source.ref)) continue;
        if (!values.candidates.some(item => item.status === 'ok' && formulaDigest(item.value.candidate.formula) === formulaDigest(factor.formula))) continue;
        let references;
        try { references = referenceMetadata(referenceFactors, frozen, engine, input.budget.batchSize, evaluation.partition); } catch { continue; }
        if (canonical(evaluation.context) === canonical(evidenceContext(values, frozen, input.profile, references))) return true;
      }
      cursor = page.cursor;
    } while (cursor);
    return false;
  }
  async function lookup(input, snapshot = null) {
    const factors = []; let cursor;
    do {
      const page = await library.query({ fields: input.space.fields, limit: 64, ...(cursor ? { cursor } : {}) });
      factors.push(...page.items); cursor = page.cursor;
      if (input.space.seeds.length ? input.space.seeds.every(formula => factors.some(factor => formulaDigest(factor.formula) === formulaDigest(formula))) : factors.length) break;
    } while (cursor);
    // Without explicit definitions, field-compatible library entries cannot
    // establish that a different research need has already been satisfied.
    if (!input.space.seeds.length) return { reuse: [], remeasure: [], missingDefinitions: true };
    const required = input.space.seeds.map(formula => factors.find(factor => formulaDigest(factor.formula) === formulaDigest(formula)));
    if (!required.length || required.some(factor => !factor)) return { reuse: [], remeasure: [], missingDefinitions: true };
    const selectedEnvironment = await environment(), referenceFactors = await definitions(input), reuse = [], remeasure = [];
    for (const factor of new Map(required.map(value => [value.id, value])).values()) (await matchesEvidence(factor, input, snapshot, selectedEnvironment, referenceFactors) ? reuse : remeasure).push(factor);
    return { reuse, remeasure, missingDefinitions: false };
  }
  async function launch(job) {
    if (job.runId || TERMINAL.has(job.status)) return job;
    const accepted = await capabilities.invoke('sesame/auto-factor-mining#factor_workflow', { jobId: job.id }, {
      operationId: `${job.id}:workflow`, task: { title: job.type === 'research' ? '因子研究' : '因子计算与评价', output: { type: 'report', space: 'research', path: `${job.type === 'research' ? '因子研究' : '因子计算与评价'}-${job.id.slice(-12)}.html` } },
    });
    ensure(accepted?.type === 'run' && accepted.run?.id, 'Workflow admission must return a native Run', 'INVALID_OUTPUT');
    return journal.update(job.id, current => ({ ...current, runId: accepted.run.id }));
  }
  async function research(draft) {
    validateDraft(draft);
    // A mutable dataset ID cannot establish current data identity before freeze.
    if (draft.source.ref) {
      const found = await lookup(draft);
      if (!found.missingDefinitions && found.reuse.length && !found.remeasure.length) return { resolution: 'reuse', factors: found.reuse };
    } else await library.query({ fields: draft.space.fields, limit: 64 });
    return { resolution: 'research', job: publicJob(await launch(await journal.create('research', draft))) };
  }
  async function measure(input) {
    validateMeasure(input);
    if (input.formulas) ensure(input.formulas.length <= input.budget.maxCandidates, 'Requested formulas exceed the candidate budget', 'BUDGET_EXHAUSTED');
    return publicJob(await launch(await journal.create('measure', input)));
  }

  async function reserveBatch(job, candidates, partition, mode, ctx, valuesRef = null) {
    ensure(candidates.length <= (valuesRef ? 256 : job.budget.batchSize), 'Batch exceeds its declared size');
    const batchId = identifier('batch', [partition, mode, candidates.map(candidate => candidate.id), valuesRef]);
    for (const candidate of candidates) await journal.entry(job.id, 'candidate', candidate.id, prior => {
      ensure(!prior || canonical(prior.candidate) === canonical(candidate), 'Candidate identity changed', 'EVIDENCE_MISMATCH');
      return prior ?? { candidate, development: null, holdout: null, feedbackAcknowledged: null };
    }, ctx.signal);
    await journal.entry(job.id, 'batch', batchId, prior => prior ?? { partition, mode, candidateIds: candidates.map(candidate => candidate.id), status: valuesRef ? 'computed' : 'queued', valuesRef, error: null }, ctx.signal);
    return batchId;
  }
  async function refreshCounts(ctx) {
    const candidates = await journal.all(ctx.jobId, 'candidate');
    const completed = candidates.filter(item => ['evaluated', 'computed', 'failed'].includes(item.development?.status ?? item.holdout?.status)).length;
    await checkedUpdate(ctx, job => ({ ...job, proposed: Math.max(job.proposed, candidates.length), completed: Math.max(job.completed, completed) }));
  }
  function diagnostics(candidates, profile) {
    const covariateFields = [...new Set((profile?.diagnostics ?? []).filter(item => item.kind === 'regimes').map(item => item.options.field))];
    const sensitivity = [], option = profile?.diagnostics.find(item => item.kind === 'sensitivity')?.options;
    if (option) for (const candidate of candidates) {
      let selected = candidate.formula.tree;
      for (const index of option.argumentPath) selected = selected?.args?.[index];
      if (!selected || !Number.isFinite(selected.constant)) continue;
      const neighbors = [];
      for (const value of option.neighbors) {
        const formula = clone(candidate.formula); let node = formula.tree;
        for (const index of option.argumentPath) node = node.args[index];
        node.constant = value;
        try { validateFormula(formula); } catch { continue; }
        neighbors.push({ value, column: identifier('sensitivity', [candidate.id, option.argumentPath, value]), formula });
      }
      sensitivity.push({ candidateId: candidate.id, argumentPath: option.argumentPath, neighbors });
    }
    return { covariateFields, sensitivity };
  }
  async function referenceValues(job, input, snapshot, partition, ctx) {
    let frozen = job.referenceDefinitionsRef ? await artifacts.readJSON(job.referenceDefinitionsRef, ctx) : null;
    if (frozen === null) {
      frozen = await definitions(input);
      const ref = await saveJSON(frozen, 'factor-evidence/1', `${job.id}:reference-definitions`, [], ctx);
      await checkedUpdate(ctx, current => ({ ...current, referenceDefinitionsRef: ref }));
    }
    const result = [];
    for (const [index, group] of chunks(frozen, input.budget.batchSize).entries()) {
      if ((await journal.assertActive(ctx)).status === 'pausing') return null;
      const key = `${partition}:${index}`, prior = await journal.readEntry(job.id, 'reference', key);
      if (prior?.valuesRef) { result.push(await loadValues(prior.valuesRef, ctx)); continue; }
      if ((await journal.assertActive(ctx)).status === 'pausing') return null;
      const values = await compute.compute(snapshot, group.map(factor => candidateFor(factor.formula, `Library reference ${factor.id}`)), partition, { ...ctx, attemptId: `reference:${key}` });
      ensure(values.candidates.every(item => item.status === 'ok'), 'A required reference factor could not be computed', 'REFERENCE_UNAVAILABLE');
      await journal.entry(job.id, 'reference', key, () => ({ partition, valuesRef: values.manifest }), ctx.signal);
      result.push(values);
    }
    return result;
  }
  async function processBatch(job, input, batch, snapshot, references, ctx) {
    const records = await Promise.all(batch.candidateIds.map(id => journal.readEntry(job.id, 'candidate', id)));
    const candidates = records.map(record => record.candidate); let values;
    try {
      await journal.assertActive(ctx);
      if (batch.valuesRef) values = await loadValues(batch.valuesRef, ctx);
      else {
        await journal.entry(job.id, 'batch', batch.key, prior => ({ ...prior, status: 'computing' }), ctx.signal);
        values = await compute.compute(snapshot, candidates, batch.partition, ctx, diagnostics(candidates, input.profile));
        await journal.assertActive(ctx);
        await journal.entry(job.id, 'values', values.id, () => ({ valuesRef: values.manifest, partition: batch.partition, batchId: batch.key }), ctx.signal);
        await journal.entry(job.id, 'batch', batch.key, prior => ({ ...prior, status: 'computed', valuesRef: values.manifest }), ctx.signal);
        await checkedUpdate(ctx, current => ({ ...current, valuesRef: current.valuesRef ?? values.manifest }));
      }
      let evaluated = [];
      if (batch.mode !== 'compute') {
        await journal.entry(job.id, 'batch', batch.key, prior => ({ ...prior, status: 'evaluating' }), ctx.signal);
        evaluated = await evaluator.evaluate(values, input.profile, references, ctx);
        ensure(Array.isArray(evaluated) && new Set(evaluated.map(item => item.id)).size === evaluated.length, 'Evaluator returned repeated identities', 'INVALID_OUTPUT');
      }
      for (const candidate of candidates) {
        await journal.assertActive(ctx);
        const existing = records.find(record => record.candidate.id === candidate.id)?.[batch.partition];
        if (['evaluated', 'computed', 'failed'].includes(existing?.status)) continue;
        const computed = values.candidates.find(item => item.id === candidate.id), item = evaluated.find(result => result.id === candidate.id); let result;
        if (computed?.status === 'failed') result = { status: 'failed', error: computed.error, valuesRef: values.manifest };
        else if (!computed) result = { status: 'failed', error: failure(error('MISSING_COMPUTATION', 'No computed result was returned')), valuesRef: values.manifest };
        else if (batch.mode === 'compute') result = { status: 'computed', valuesRef: values.manifest };
        else if (item?.status === 'ok') {
          ensure(item.value.candidateId === candidate.id && item.value.partition === batch.partition && item.value.valuesId === values.id, 'Evaluation identity differs from its reserved candidate', 'EVIDENCE_MISMATCH');
          const factors = await library.record([candidate], [item.value], { jobId: job.id, epoch: ctx.epoch });
          result = { status: 'evaluated', evaluation: item.value, valuesRef: values.manifest, factorIds: factors.map(factor => factor.id) };
        } else result = { status: 'failed', error: item?.error ?? failure(error('MISSING_EVALUATION', 'No evaluation was returned')), valuesRef: values.manifest };
        if (batch.partition === 'development') {
          const ordered = await checkedUpdate(ctx, current => ({ ...current, feedbackSequence: (current.feedbackSequence ?? 0) + 1 }));
          result.feedbackSequence = ordered.feedbackSequence;
        }
        await journal.entry(job.id, 'candidate', candidate.id, prior => ({ ...prior, [batch.partition]: result }), ctx.signal);
      }
      await journal.entry(job.id, 'batch', batch.key, prior => ({ ...prior, status: 'completed', valuesRef: values.manifest, error: null }), ctx.signal);
    } catch (cause) {
      if (ctx.signal?.aborted || CONTROL_ERRORS.has(cause.code)) throw cause;
      await journal.assertActive(ctx); const problem = failure(cause);
      await journal.entry(job.id, 'batch', batch.key, prior => ({ ...prior, status: 'failed', error: problem }), ctx.signal);
      for (const candidate of candidates) {
        const ordered = batch.partition === 'development' ? await checkedUpdate(ctx, current => ({ ...current, feedbackSequence: (current.feedbackSequence ?? 0) + 1 })) : null;
        await journal.entry(job.id, 'candidate', candidate.id, prior => prior[batch.partition]?.status === 'evaluated' ? prior : {
          ...prior, [batch.partition]: { status: 'failed', error: problem, ...(values ? { valuesRef: values.manifest } : {}), ...(ordered ? { feedbackSequence: ordered.feedbackSequence } : {}) },
        }, ctx.signal);
      }
    }
    await refreshCounts(ctx);
  }
  function feedbackFor(record) {
    const value = record.development;
    if (!record.candidate || !value || value.status === 'computed') return null;
    const evaluation = value.evaluation, evaluationId = evaluation?.id ?? identifier('failed-evaluation', [record.candidate.id, value.error]);
    if (record.feedbackAcknowledged === evaluationId) return null;
    return { candidateId: record.candidate.id, evaluationId, developmentScore: evaluation?.score?.status === 'computed' ? evaluation.score.value : null,
      status: evaluation && evaluation.eligibility !== 'invalid' && evaluation.score?.status === 'computed' ? 'valid' : 'invalid', reasons: evaluation?.reasons ?? [value.error?.message ?? 'Evaluation unavailable'] };
  }
  async function completeProposal(job, proposal, ctx) {
    const request = await artifacts.readJSON(proposal.requestRef, ctx);
    let receipt = proposal.receiptRef ? await artifacts.readJSON(proposal.receiptRef, ctx) : null;
    if (receipt === null) {
      receipt = await search.propose(request.request, request.checkpoint, request.feedback, request.limit, { ...ctx, attemptId: proposal.key });
      const receiptRef = await saveJSON(receipt, 'factor-evidence/1', `${job.id}:${proposal.key}:receipt`, [receipt.checkpoint], ctx);
      await journal.entry(job.id, 'proposal', proposal.key, prior => ({ ...prior, receiptRef, status: 'received' }), ctx.signal);
    }
    for (const group of chunks(receipt.candidates, job.budget.batchSize)) await reserveBatch(job, group, 'development', 'evaluate', ctx);
    const checkpoint = await artifacts.readJSON(receipt.checkpoint, ctx);
    ensure(Number.isSafeInteger(checkpoint.budget?.used) && checkpoint.budget.used <= job.budget.maxCandidates, 'Search expanded its attempt budget', 'INVALID_OUTPUT');
    ensure(Number.isSafeInteger(checkpoint.budget.proposed) && checkpoint.budget.proposed >= 0 && checkpoint.budget.proposed <= checkpoint.budget.used, 'Search returned invalid proposal counters', 'INVALID_OUTPUT');
    await checkedUpdate(ctx, current => {
      ensure(sameRef(current.searchCheckpoint, request.checkpoint) || sameRef(current.searchCheckpoint, receipt.checkpoint), 'Proposal checkpoint ordering changed', 'EVIDENCE_MISMATCH');
      ensure(checkpoint.budget.used >= (current.attemptsUsed ?? 0), 'Search attempt budget moved backwards', 'INVALID_OUTPUT');
      ensure(!request.limit || receipt.exhausted || checkpoint.budget.used > (current.attemptsUsed ?? 0) || sameRef(current.searchCheckpoint, receipt.checkpoint), 'Search made no bounded progress', 'INVALID_OUTPUT');
      return { ...current, searchCheckpoint: receipt.checkpoint, searchExhausted: receipt.exhausted, attemptsUsed: checkpoint.budget.used, proposed: checkpoint.budget.proposed };
    });
    for (const feedback of request.feedback) await journal.entry(job.id, 'candidate', feedback.candidateId, prior => ({ ...prior, feedbackAcknowledged: feedback.evaluationId }), ctx.signal);
    await journal.entry(job.id, 'proposal', proposal.key, prior => ({ ...prior, status: 'committed' }), ctx.signal);
  }
  async function proposeMore(job, input, snapshot, ctx, limit) {
    const { holdout: _holdout, ...layout } = snapshot.layout;
    const request = { requestId: input.requestId, need: input.need,
      development: { snapshotId: snapshot.id, source: snapshot.source, layout, fields: snapshot.fields, calendarDigest: snapshot.calendarDigest },
      space: input.space, profile: input.profile, references: input.references, budget: input.budget };
    const feedback = (await journal.all(job.id, 'candidate')).sort((a, b) => (a.development?.feedbackSequence ?? Infinity) - (b.development?.feedbackSequence ?? Infinity)).map(feedbackFor).filter(Boolean);
    const data = { request, checkpoint: job.searchCheckpoint, feedback, limit }, key = identifier('proposal', data);
    const requestRef = await saveJSON(data, 'factor-evidence/1', `${job.id}:${key}:request`, [job.searchCheckpoint], ctx);
    const proposal = await journal.entry(job.id, 'proposal', key, prior => prior ?? { requestRef, receiptRef: null, status: 'requested' }, ctx.signal);
    await completeProposal(job, proposal, ctx);
  }
  async function drain(job, input, snapshot, references, partition, canSearch, ctx, execution) {
    const running = new Map();
    const settleOne = async () => {
      const result = await Promise.race(running.values()); running.delete(result.id);
      if (result.error) throw result.error;
      await progress(job.id, execution, `${partition} batch completed`);
    };
    try {
      for (;;) {
        const current = await journal.get(job.id);
        ensure(current.epoch === ctx.epoch && current.status !== 'cancelled', 'Research cancelled', 'CANCELLED');
        if (current.status === 'pausing') { if (running.size) { await settleOne(); continue; } return false; }
        await journal.assertActive(ctx);
        const pending = (await journal.all(job.id, 'batch')).filter(batch => batch.partition === partition && !['completed', 'failed'].includes(batch.status) && !running.has(batch.key));
        for (const batch of pending) {
          if (running.size >= input.budget.maxWorkers) break;
          if ((await journal.assertActive(ctx)).status === 'pausing') break;
          const task = processBatch(current, input, batch, snapshot, references, { ...ctx, attemptId: batch.key })
            .then(() => ({ id: batch.key }), cause => ({ id: batch.key, error: cause }));
          running.set(batch.key, task);
        }
        if (running.size >= input.budget.maxWorkers) { await settleOne(); continue; }
        if (canSearch && !current.searchExhausted) {
          // Search occupies a free slot while other batches evaluate immediately.
          if ((await journal.assertActive(ctx)).status === 'pausing') continue;
          await proposeMore(current, input, snapshot, ctx, input.budget.batchSize); continue;
        }
        if (running.size) { await settleOne(); continue; }
        return true;
      }
    } finally { await Promise.allSettled([...running.values()]); }
  }
  async function initialize(job, input, ctx) {
    let snapshot = job.snapshot;
    if (!snapshot) {
      if (job.type === 'measure' && input.mode === 'evaluate') { const values = await loadValues(input.valuesRef, ctx); snapshot = await loadSnapshot(values.snapshotRef, ctx); }
      else snapshot = await compute.prepare(input.source, input.layout, input.budget, { ...ctx, attemptId: 'prepare' });
      await checkedUpdate(ctx, current => ({ ...current, snapshot, phase: 'development' }));
    }
    job = await journal.get(job.id);
    if (job.initialized) return snapshot;
    if (job.type === 'research') {
      const found = await lookup(input, snapshot);
      if (!found.missingDefinitions) {
        const candidates = found.remeasure.map(factor => candidateFor(factor.formula, input.need));
        ensure(candidates.length <= input.budget.maxCandidates, 'Library reevaluation exceeds the candidate budget', 'BUDGET_EXHAUSTED');
        for (const group of chunks(candidates, input.budget.batchSize)) await reserveBatch(job, group, 'development', 'evaluate', ctx);
        await checkedUpdate(ctx, current => ({ ...current, searchExhausted: true, reusedFactorIds: found.reuse.map(factor => factor.id), attemptsUsed: candidates.length }));
      }
    } else if (input.mode === 'evaluate') {
      const values = await loadValues(input.valuesRef, ctx), candidates = values.candidates.filter(item => item.status === 'ok').map(item => item.value.candidate);
      ensure(values.candidates.length <= input.budget.maxCandidates, 'Frozen values exceed the evaluation candidate budget', 'BUDGET_EXHAUSTED');
      if (candidates.length) await reserveBatch(job, candidates, values.partition, 'evaluate', ctx, input.valuesRef);
      for (const item of values.candidates.filter(value => value.status === 'failed')) await journal.entry(job.id, 'candidate', item.id, prior => prior ?? {
        candidate: null, candidateId: item.id, development: null, holdout: null, [values.partition]: { status: 'failed', error: item.error, valuesRef: input.valuesRef }, feedbackAcknowledged: null,
      }, ctx.signal);
      await journal.entry(job.id, 'values', values.id, () => ({ valuesRef: input.valuesRef, partition: values.partition, batchId: null }), ctx.signal);
      await checkedUpdate(ctx, current => ({ ...current, measurePartition: values.partition, valuesRef: input.valuesRef, searchExhausted: true, selection: candidates.map(candidate => candidate.id), attemptsUsed: values.candidates.length }));
      if (values.partition === 'holdout') {
        const exposureRef = await saveJSON({ snapshotId: snapshot.id, candidateIds: candidates.map(candidate => candidate.id), valuesRef: input.valuesRef, previous: snapshot.usageLedgerRef, selectionFrozen: true }, 'factor-usage/1', `${job.id}:holdout-evaluate`, [input.valuesRef, snapshot.usageLedgerRef], ctx);
        await checkedUpdate(ctx, current => ({ ...current, holdoutExposureRef: exposureRef }));
      }
    } else {
      for (const group of chunks(input.formulas, input.budget.batchSize)) await reserveBatch(job, group, 'development', input.mode === 'compute' ? 'compute' : 'evaluate', ctx);
      await checkedUpdate(ctx, current => ({ ...current, searchExhausted: true, attemptsUsed: input.formulas.length }));
    }
    await checkedUpdate(ctx, current => ({ ...current, initialized: true })); await refreshCounts(ctx); return snapshot;
  }
  async function pause(job, execution) {
    await journal.update(job.id, current => current.status === 'pausing' ? { ...current, ...finishTime(current), status: 'paused' } : current);
    await progress(job.id, execution, 'Paused at a durable batch boundary');
    return execution.interrupt({ reason: 'Factor research paused at a safe checkpoint', state: { jobId: job.id, epoch: job.epoch } });
  }
  const publicationUpdate = (job, transform) => journal.update(job.id, current => {
    ensure(current.epoch === job.epoch && current.status !== 'cancelled', 'Publication belongs to a stopped research attempt', 'CANCELLED');
    return transform(current);
  });
  async function publish(job, signal) {
    try {
      await publicationUpdate(job, current => ({ ...current, reportStatus: 'publishing', reportError: null }));
      const result = await reports.publish(await journal.get(job.id), async ref => publicationUpdate(job, current => ({ ...current, report: ref })));
      return publicationUpdate(job, current => ({ ...current, report: result.ref, reportStatus: 'published', reportError: null, error: null }));
    } catch (cause) {
      if (signal?.aborted || cause.code === 'CANCELLED') throw cause;
      return publicationUpdate(job, current => ({ ...current, reportStatus: 'failed', reportError: failure(cause), error: failure(cause) }));
    }
  }
  async function finishPublication(job, execution) {
    const published = await publish(job, execution.signal);
    if (published.reportStatus !== 'published') {
      await publicationUpdate(job, current => ({ ...current, ...finishTime(current), status: 'interrupted', phase: 'report' }));
      await progress(job.id, execution, 'Numerical evidence saved; report publication requires recovery');
      return execution.interrupt({ reason: published.reportError.message, state: { jobId: job.id, epoch: job.epoch, phase: 'report' } });
    }
    return publicJob(await publicationUpdate(job, current => ({ ...current, ...finishTime(current), status: 'completed', phase: 'done' })));
  }
  async function run(jobId, execution, controller) {
    ensure(execution?.run?.id && typeof execution.checkpoint === 'function' && typeof execution.interrupt === 'function', 'Use the native factor workflow capability', 'WORKFLOW_CONTEXT_REQUIRED');
    let job = await journal.get(jobId);
    if (TERMINAL.has(job.status)) return publicJob(job);
    ensure(!job.runId || job.runId === execution.run.id, 'Job belongs to another native Run', 'FORBIDDEN');
    job = await journal.update(jobId, current => {
      ensure(!TERMINAL.has(current.status), 'Job has already stopped', 'CANCELLED');
      return { ...current, ...finishTime(current), runId: execution.run.id, nativeAttempt: execution.run.attempt ?? execution.attempt ?? 1, status: current.status === 'pausing' ? 'pausing' : 'running', startedAt: Date.now(), error: null };
    });
    const ctx = context(job, execution, controller, 'workflow');
    try {
      if (job.numericalComplete) return await finishPublication(job, execution);
      const input = await inputFor(job);
      if (job.status === 'pausing') return await pause(job, execution);
      const snapshot = await initialize(job, input, ctx);
      for (const proposal of await journal.all(jobId, 'proposal')) if (proposal.status !== 'committed') {
        job = await journal.get(jobId);
        if (job.status === 'pausing') return await pause(job, execution);
        await completeProposal(job, proposal, ctx);
      }
      job = await journal.get(jobId);
      if (job.status === 'pausing') return await pause(job, execution);
      const partition = job.measurePartition ?? 'development';
      const references = input.mode === 'compute' ? [] : await referenceValues(job, input, snapshot, partition, ctx);
      if (references === null) return await pause(job, execution);
      if (!await drain(job, input, snapshot, references, partition, job.type === 'research', ctx, execution)) return await pause(job, execution);
      job = await journal.get(jobId);
      if (job.status === 'pausing') return await pause(job, execution);
      if (job.type === 'research') {
        if (job.searchCheckpoint && (await journal.all(jobId, 'candidate')).some(record => feedbackFor(record))) await proposeMore(job, input, snapshot, ctx, 0);
        job = await journal.get(jobId);
        if (job.selection === null) {
          const records = await journal.all(jobId, 'candidate');
          const selection = records.filter(record => record.development?.evaluation?.eligibility === 'supported' && Number.isFinite(record.development.evaluation.score.value))
            .sort((a, b) => b.development.evaluation.score.value - a.development.evaluation.score.value || (a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0)).slice(0, 8).map(record => record.candidate.id);
          await checkedUpdate(ctx, current => ({ ...current, selection, phase: 'holdout' }));
        }
        job = await journal.get(jobId);
        if (job.status === 'pausing') return await pause(job, execution);
        if (job.selection.length) {
          const exposureRef = job.holdoutExposureRef ?? await saveJSON({ snapshotId: snapshot.id, candidateIds: job.selection, previous: snapshot.usageLedgerRef, selectionFrozen: true }, 'factor-usage/1', `${jobId}:holdout-exposure`, [snapshot.usageLedgerRef], ctx);
          await checkedUpdate(ctx, current => ({ ...current, holdoutExposureRef: exposureRef }));
          const holdoutReferences = await referenceValues(await journal.get(jobId), input, snapshot, 'holdout', ctx);
          if (holdoutReferences === null) return await pause(job, execution);
          const selected = await Promise.all(job.selection.map(id => journal.readEntry(jobId, 'candidate', id)));
          for (const group of chunks(selected.map(record => record.candidate), input.budget.batchSize)) await reserveBatch(job, group, 'holdout', 'evaluate', ctx);
          if (!await drain(job, input, snapshot, holdoutReferences, 'holdout', false, ctx, execution)) return await pause(job, execution);
        }
      }
      await checkedUpdate(ctx, current => ({ ...current, ...finishTime(current), phase: 'report', numericalComplete: true }));
      await progress(jobId, execution, 'Numerical evidence complete');
      return await finishPublication(await journal.get(jobId), execution);
    } catch (cause) {
      // Native UI interruption revokes every port of this workflow Host. Its
      // Run service owns cleanup; a fresh control caller reconciles the journal.
      if (execution.signal?.aborted) throw cause;
      const current = await journal.get(jobId);
      if (current.status === 'cancelled' || current.epoch !== ctx.epoch) return publicJob(current);
      if (['paused', 'interrupted'].includes(current.status) && cause.code === 'RUN_INTERRUPTED') throw cause;
      const interrupted = ctx.signal.aborted || ['RUN_INTERRUPTED', 'PROCESS_RECONCILIATION_REQUIRED'].includes(cause.code);
      const saved = await journal.update(jobId, value => value.epoch !== ctx.epoch ? value : { ...value, ...finishTime(value), status: interrupted ? 'interrupted' : 'failed', error: failure(cause) });
      if (interrupted) return execution.interrupt({ reason: cause.message, state: { jobId, epoch: ctx.epoch } });
      return publicJob(saved);
    }
  }
  function execute(jobId, execution) {
    if (active.has(jobId)) {
      ensure(active.get(jobId).runId === execution?.run?.id, 'Job is active in another native Run', 'FORBIDDEN');
      return active.get(jobId).promise;
    }
    const controller = new AbortController(), promise = run(jobId, execution, controller).finally(() => active.delete(jobId));
    active.set(jobId, { controller, promise, runId: execution?.run?.id }); return promise;
  }
  async function waitSettled(runId) {
    let observed = (await runs.read({ id: runId })).run;
    while (RUNNING_RUNS.has(observed.status)) observed = (await runs.wait({ id: runId }, { until: 'settled', timeoutMs: 30000 })).run;
    return observed;
  }
  async function reconcile(job, run = null) {
    if (!job.runId || TERMINAL.has(job.status)) return { job, run };
    run ??= (await runs.read({ id: job.runId })).run;
    ensure(run?.id === job.runId, 'Native workflow identity changed', 'EVIDENCE_MISMATCH');
    let status = null, problem = job.error;
    if (['cancelling', 'cancelled'].includes(run.status)) { status = 'cancelled'; problem = null; }
    else if (run.status === 'interrupted') status = job.status === 'paused' ? 'paused' : 'interrupted';
    else if (run.status === 'interrupting') status = 'pausing';
    else if (!['queued', 'running'].includes(run.status)) {
      status = 'interrupted';
      problem = failure(error('NATIVE_RECONCILIATION_REQUIRED', `Native workflow is ${run.status}; its outcome must be inspected before any recovery`));
    } else if (['paused', 'interrupted'].includes(job.status)) { status = run.status; problem = null; }
    if (status && (status !== job.status || canonical(problem) !== canonical(job.error))) job = await journal.update(job.id, current => {
      if (TERMINAL.has(current.status) || current.epoch !== job.epoch || current.runId !== job.runId || current.status !== job.status || current.nativeAttempt !== job.nativeAttempt) return current;
      return { ...current, ...(!RUNNING_RUNS.has(status) ? finishTime(current) : {}), status, error: problem, epoch: current.epoch + (status === 'cancelled' ? 1 : 0) };
    });
    return { job, run };
  }
  async function control(jobId, action, interruptIds) {
    let { job, run } = await reconcile(await journal.get(jobId));
    if (action === 'read') return publicJob(job);
    if (action === 'report') {
      ensure(job.numericalComplete, 'Numerical work is not complete', 'REPORT_NOT_READY');
      ensure(job.status !== 'cancelled', 'Cancelled work cannot resume publication', 'INVALID_STATE');
      run ??= (await runs.read({ id: job.runId })).run;
      if (run.status === 'interrupting') ({ job, run } = await reconcile(job, await waitSettled(job.runId)));
      if (run.status === 'interrupted') return control(jobId, 'resume', run.interrupts?.filter(item => item.status !== 'resolved').map(item => item.id) ?? []);
      if (['queued', 'running'].includes(run.status)) return publicJob(job);
      ensure(run.status === 'completed' && job.report, 'Publication recovery requires the original interrupted workflow; an unknown outcome cannot be replayed', 'NATIVE_RECONCILIATION_REQUIRED');
      // A completed Run can only recheck its already pinned publication.
      const checked = await publish(job);
      return publicJob(checked.reportStatus === 'published' ? await publicationUpdate(job, current => ({ ...current, status: 'completed', phase: 'done' })) : checked);
    }
    if (action === 'pause') {
      if (!TERMINAL.has(job.status) && !['paused', 'interrupted'].includes(job.status)) job = await journal.update(jobId, current => TERMINAL.has(current.status) ? current : { ...current, status: 'pausing' });
      return publicJob(job);
    }
    if (action === 'resume') {
      if (run?.status === 'interrupting') ({ job, run } = await reconcile(job, await waitSettled(job.runId)));
      ensure(['paused', 'interrupted'].includes(job.status) && job.runId, 'Job is not resumable', 'INVALID_STATE');
      run ??= await waitSettled(job.runId);
      ensure(run.status === 'interrupted', `Native workflow is ${run.status}; automatic replay is unavailable`, 'NATIVE_RECONCILIATION_REQUIRED');
      const observed = run.interrupts?.filter(item => item.status !== 'resolved').map(item => item.id) ?? [];
      ensure(Array.isArray(interruptIds) && interruptIds.length > 0 && canonical([...new Set(interruptIds)].sort()) === canonical([...observed].sort()), 'Resume requires the currently observed outstanding interrupt IDs', 'INTERRUPT_IDS_REQUIRED');
      const status = job.status;
      await journal.update(jobId, current => {
        ensure(current.epoch === job.epoch && ['paused', 'interrupted'].includes(current.status), 'Job changed while resuming', 'CANCELLED');
        return { ...current, status: 'queued', error: null };
      });
      try { await runs.resume({ id: job.runId }, { interruptIds }); }
      catch (cause) { await journal.update(jobId, current => current.status === 'queued' ? { ...current, status, error: failure(cause) } : current); throw cause; }
      return publicJob(await journal.get(jobId));
    }
    ensure(action === 'cancel', 'Unknown job control action');
    if (TERMINAL.has(job.status) && job.status !== 'cancelled') return publicJob(job);
    job = await journal.update(jobId, current => TERMINAL.has(current.status) ? current : { ...current, ...finishTime(current), status: 'cancelled', epoch: current.epoch + 1, error: null });
    if (job.status !== 'cancelled') return publicJob(job);
    active.get(jobId)?.controller.abort(error('CANCELLED', 'Factor job cancelled'));
    const processes = await journal.all(jobId, 'process');
    for (const process of processes) if (process.runId) {
      const observed = (await runs.read({ id: process.runId })).run;
      if (RUNNING_RUNS.has(observed.status) || observed.status === 'interrupted') await runs.cancel({ id: process.runId }, { reason: 'Factor job cancelled' });
    }
    for (const process of processes) if (process.runId) await waitSettled(process.runId);
    if (job.runId) {
      const observed = (await runs.read({ id: job.runId })).run;
      if (RUNNING_RUNS.has(observed.status) || observed.status === 'interrupted') await runs.cancel({ id: job.runId }, { reason: 'Factor job cancelled' });
      await waitSettled(job.runId);
    }
    if (active.has(jobId)) await Promise.allSettled([active.get(jobId).promise]);
    return publicJob(await journal.get(jobId));
  }
  return { research, measure, execute, control };
}
