import { mkdir, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, digest, ensure, error, identifier, MAX_SHARD_BYTES, object, referenceIdentity } from './contracts.js';
import { attemptDirectory, fileReceipt, isRef, isFile, verifiedFile } from './artifacts.js';
import { runProcess } from './host.js';
import { createBudgets } from './budgets.js';

export function createPython({ host, artifacts, journal, environment }) {
  const root = host.context.storageRoot, budgets = createBudgets(journal); let selectedEnvironment;
  const selection = async signal => {
    selectedEnvironment ??= environment.inspect({}, signal).then(value => { ensure(value.ready, value.reason ?? 'Prepare the factor Python environment first', 'PREREQUISITE_REQUIRED'); return value; }).catch(e => { selectedEnvironment = null; throw e; });
    return selectedEnvironment;
  };
  const retainedReceipt = async (record, command) => {
    let receipt;
    try {
      ensure(await existingFileBytes(record.resultPath) <= MAX_SHARD_BYTES, 'Worker result exceeds budget', 'RESOURCE_EXHAUSTED');
      receipt = JSON.parse(await readFile(record.resultPath, 'utf8'));
    } catch (cause) { if (cause.code !== 'ENOENT' && !(cause instanceof SyntaxError)) throw cause; }
    return receipt?.schema === 'factor-worker/1' && receipt.command === command && receipt.status === 'ok';
  };
  async function recoverChild(record, ctx) {
    ensure(record.parentRunId && record.operationId && typeof host.runs.list === 'function', 'The previous child admission cannot be located; inspect its native Run before retrying', 'PROCESS_RECONCILIATION_REQUIRED');
    const parent = (await host.runs.read({ id: record.parentRunId })).run;
    ensure(['completed', 'cancelled', 'interrupted', 'unknown'].includes(parent.status), 'The previous native operation is still active', 'PROCESS_RECONCILIATION_REQUIRED');
    const matches = []; let cursor;
    do {
      ctx.signal?.throwIfAborted();
      const page = await host.runs.list({ parentRunId: record.parentRunId, capabilityId: 'host.process.exec', limit: 200, ...(cursor ? { cursor } : {}) });
      matches.push(...page.items.filter(run => run.parentRunId === record.parentRunId && run.capabilityId === 'host.process.exec' && run.operationId === record.operationId));
      ensure(!page.nextCursor || page.nextCursor !== cursor, 'Child Run cursor did not advance', 'EVIDENCE_MISMATCH'); cursor = page.nextCursor;
    } while (cursor);
    ensure(matches.length <= 1, 'More than one native child owns the same process admission', 'EVIDENCE_MISMATCH');
    // Host admission persists the child Run before starting the OS process.
    // An absent child is conclusive only when the parent itself stopped cleanly.
    ensure(matches.length || parent.status !== 'unknown', 'The previous parent outcome is unknown and no child admission could be verified', 'PROCESS_RECONCILIATION_REQUIRED');
    return matches[0] ?? null;
  }
  async function settleBudget(record, ctx) {
    if (!record?.budgetToken || record.budgetSettled) return;
    const directory = attemptDirectory(root, { ...ctx, attemptId: record.attemptId });
    const outputBytes = await directoryBytes(join(directory, 'output')) + await existingFileBytes(join(directory, 'result.json'));
    let exhausted;
    try { await budgets.settle(ctx, record.budgetToken, { input: record.inputBytes, output: outputBytes }); }
    catch (cause) { if (cause.code !== 'BUDGET_EXHAUSTED') throw cause; exhausted = cause; }
    await journal.entry(ctx.jobId, 'process', record.key, current => ({ ...current, budgetSettled: true, outputBytes }));
    if (exhausted) throw exhausted;
  }
  async function sourceFiles(source, ctx, layout, budget) {
    const dir = attemptDirectory(root, ctx); await mkdir(dir, { recursive: true });
    if (source.ref) {
      const declaration = await artifacts.verify(source.ref, ctx);
      ensure(declaration.blobs?.find(b => b.path === declaration.content?.path)?.size <= budget.maxInputBytes, 'Fixed source exceeds declared input budget', 'RESOURCE_EXHAUSTED');
      const { bytes, manifest } = await artifacts.readBytes(source.ref, ctx);
      ensure(bytes.length <= budget.maxInputBytes && manifest.content.format === 'json-rows', 'Fixed source exceeds budget or is not json-rows', 'RESOURCE_EXHAUSTED');
      const rows = JSON.parse(bytes.toString('utf8')); ensure(Array.isArray(rows) && rows.length === manifest.content.rowCount, 'Source row count differs', 'EVIDENCE_MISMATCH');
      return { sourceRef: source.ref, rows: await localRows(rows, dir) };
    }
    const sources = await host.data.sources({ contract: 'sesame.datasets/1' });
    const available = Array.isArray(sources) ? sources : sources.items ?? sources.sources ?? [];
    const selected = available.find(s => s.ref?.pluginId === 'host' || s.pluginId === 'host') ?? available[0];
    ensure(selected?.ref, 'Dataset source is unavailable', 'SOURCE_UNAVAILABLE');
    let cursor, total = 0, rows = [], bytes = 2, metadata; const local = [], refs = [];
    const flush = async () => {
      if (!rows.length) return;
      const sourceKind = metadata?.provenance?.kind ?? 'observed';
      const dependencies = metadata?.inputRefs ?? metadata?.dependencies ?? [];
      const provenance = { ...(metadata?.provenance ?? {}), kind: sourceKind, datasetId: source.datasetId };
      const ref = await artifacts.publishRows(rows, provenance, dependencies, ctx, `factor-source:${source.datasetId}:${digest(rows)}`);
      refs.push(ref); const path = join(dir, `rows-${local.length}.json`); await writeFile(path, canonical(rows)); local.push(await fileReceipt(path)); rows = []; bytes = 2;
    };
    do {
      ctx.signal?.throwIfAborted();
      const page = await host.data.query({ source: selected.ref, operation: 'query', input: { datasetId: source.datasetId }, limit: 200, ...(cursor ? { cursor } : {}) }, { signal: ctx.signal });
      metadata ??= page.metadata;
      ensure(metadata?.id === source.datasetId, 'Dataset identity differs', 'EVIDENCE_MISMATCH');
      for (const row of page.items) {
        const size = Buffer.byteLength(canonical(row)) + 1; total += size;
        ensure(size <= MAX_SHARD_BYTES - 2 && total <= budget.maxInputBytes, 'Source exceeds declared input budget', 'RESOURCE_EXHAUSTED');
        if (bytes + size > MAX_SHARD_BYTES - 1024) await flush(); rows.push(row); bytes += size;
      }
      ensure(!page.nextCursor || page.nextCursor !== cursor, 'Dataset cursor did not advance', 'EVIDENCE_MISMATCH'); cursor = page.nextCursor;
    } while (cursor);
    await flush(); ensure(refs.length > 0, 'Dataset contains no rows', 'INSUFFICIENT_DATA');
    const sourceRef = refs.length === 1 ? refs[0] : await artifacts.publishJSON({ schema: 'factor-source-rows/1', datasetId: source.datasetId, shards: refs, provenance: metadata.provenance ?? { kind: 'observed' } }, { schema: 'factor-source-rows/1', dependencies: refs, operationId: `factor-source-index:${digest(refs)}` }, ctx);
    return { sourceRef, rows: local };
  }
  async function materializeInputs(refs, ctx, budget) {
    const visited = new Set(); let bytes = 0;
    const inspect = async ref => {
      const key = canonical(ref); if (visited.has(key)) return; visited.add(key);
      const manifest = await artifacts.verify(ref, ctx);
      const blob = manifest.blobs?.find(item => item.path === manifest.content?.path);
      ensure(Number.isSafeInteger(blob?.size) && blob.size >= 0, 'Input artifact has no bounded payload', 'EVIDENCE_MISMATCH');
      bytes += blob.size; ensure(bytes <= budget.maxInputBytes, 'Materialized inputs exceed the declared byte budget', 'RESOURCE_EXHAUSTED');
      if (manifest.content.format === 'factor-binary/1' || ref.kind === 'data') return;
      const walk = async (value, field) => {
        if (isRef(value)) { if (!['source', 'sourceRef', 'snapshotRef', 'usageLedgerRef', 'valuesRef'].includes(field)) await inspect(value); }
        else if (Array.isArray(value)) { for (const item of value) await walk(item, field); }
        else if (object(value)) { for (const [name, item] of Object.entries(value)) await walk(item, name); }
      };
      await walk(await artifacts.readJSON(ref, ctx));
    };
    for (const ref of refs) await inspect(ref);
    return Promise.all(refs.map(ref => artifacts.materialize(ref, ctx)));
  }
  async function inputFor(command, input, ctx, budget, outputDir) {
    if (command === 'prepare') return { ...await sourceFiles(input.source, ctx, input.layout, budget), layout: input.layout, budget, outputDir };
    if (command === 'propose') return { request: input.request, checkpoint: input.checkpoint ? (await materializeInputs([input.checkpoint], ctx, budget))[0] : null, feedback: input.feedback, limit: input.limit, outputDir };
    if (command === 'compute') return { snapshot: (await materializeInputs([input.snapshot.manifest], ctx, budget))[0], candidates: input.candidates, partition: input.partition, ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}), outputDir };
    ensure(command === 'evaluate', 'Unknown Python command');
    const snapshot = await artifacts.readJSON(input.values.snapshotRef, ctx);
    const context = evidenceContext(input.values, snapshot, input.profile, input.referenceValues);
    const [values, ...referenceValues] = await materializeInputs([input.values.manifest, ...input.referenceValues.map(v => v.manifest)], ctx, budget);
    return { values, referenceValues, profile: input.profile, context, valuesRef: input.values.manifest, outputDir };
  }
  const shard = async (file, ctx, role) => {
    const local = JSON.parse((await verifiedFile(root, file)).toString('utf8'));
    const manifest = await artifacts.importTree(file, ctx, 'factor-matrix/1', role);
    const bytes = local.shards?.reduce((sum, f) => sum + (f.bytes ?? 0), 0) ?? file.bytes;
    return { manifest, digest: local.rowOrderDigest ?? digest(local), rows: local.rows ?? 0, bytes };
  };
  async function outputFor(command, output, input, prepared, ctx) {
    if (command === 'prepare') {
      const development = await shard(output.development, ctx, 'development'), holdout = await shard(output.holdout, ctx, 'holdout');
      const provider = await artifacts.importTree(output.provider, ctx, 'factor-provider/1', 'provider');
      const usageLedgerRef = await artifacts.importTree(output.usageLedger, ctx, 'factor-usage/1', 'usage');
      const snapshot = { ...output.snapshot, source: prepared.sourceRef, development, holdout, provider, usageLedgerRef };
      const manifest = await artifacts.publishJSON(snapshot, { schema: 'factor-snapshot/1', dependencies: [snapshot.source, development.manifest, holdout.manifest, provider, usageLedgerRef], operationId: `${ctx.jobId}:snapshot:${snapshot.id}` }, ctx);
      return { ...snapshot, manifest };
    }
    if (command === 'propose') return { candidates: output.candidates, checkpoint: await artifacts.importTree(output.checkpoint, ctx, 'factor-search-state/1', 'search'), exhausted: output.exhausted };
    if (command === 'compute') {
      const matrix = await shard(output.matrix, ctx, 'matrix'), labels = await shard(output.labels, ctx, 'labels');
      const auxiliary = output.diagnosticValues ?? { covariates: null, sensitivityMatrix: null, sensitivity: [] };
      const diagnosticValues = { covariates: auxiliary.covariates ? await shard(auxiliary.covariates.manifest ?? auxiliary.covariates, ctx, 'covariates') : null, sensitivityMatrix: auxiliary.sensitivityMatrix ? await shard(auxiliary.sensitivityMatrix.manifest ?? auxiliary.sensitivityMatrix, ctx, 'sensitivity') : null, sensitivity: auxiliary.sensitivity };
      const values = { ...output.values, snapshotRef: input.snapshot.manifest, matrix, labels, diagnosticValues };
      const dependencies = [input.snapshot.manifest, matrix.manifest, labels.manifest, ...[diagnosticValues.covariates, diagnosticValues.sensitivityMatrix].filter(Boolean).map(v => v.manifest)];
      const manifest = await artifacts.publishJSON(values, { schema: 'factor-values/1', dependencies, operationId: `${ctx.jobId}:values:${values.id}` }, ctx);
      return { ...values, manifest };
    }
    const imported = [];
    for (const item of output.evaluations) {
      if (item.status !== 'ok') { imported.push(item); continue; }
      const value = item.value;
      ensure(canonical(value.context) === canonical(prepared.context) && canonical(value.valuesRef) === canonical(prepared.valuesRef) && canonical(value.profile) === canonical(input.profile), 'Evaluator identity differs', 'EVIDENCE_MISMATCH');
      const details = JSON.parse((await verifiedFile(root, value.details)).toString('utf8'));
      details.referenceValues = input.referenceValues.map(v => v.manifest);
      const diagnostics = await Promise.all(value.diagnostics.map(async diagnostic => ({ ...diagnostic, evidence: diagnostic.evidence ? JSON.parse((await verifiedFile(root, diagnostic.evidence)).toString('utf8')) : null })));
      // Stable evidence identities allow repeated evaluation of the same frozen
      // values without overwriting history or conflicting with a prior job.
      value.id = identifier('evaluation', [value.id, prepared.valuesRef, details, diagnostics]);
      const dependencies = [prepared.valuesRef, ...details.referenceValues];
      value.details = await artifacts.publishJSON(details, { schema: 'factor-evidence/1', dependencies, operationId: `${value.id}:details` }, ctx);
      for (const diagnostic of diagnostics) if (diagnostic.evidence) diagnostic.evidence = await artifacts.publishJSON(diagnostic.evidence, { schema: 'factor-evidence/1', dependencies, operationId: `${value.id}:${diagnostic.kind}` }, ctx);
      value.diagnostics = diagnostics;
      imported.push(item);
    }
    return imported;
  }
  return {
    selection,
    async execute(command, input, callerCtx) {
      const job = await journal.assertActive(callerCtx), budget = job.budget;
      const remainingTime = () => budget.maxSeconds * 1000 - job.activeMs - (job.startedAt ? Date.now() - job.startedAt : 0);
      ensure(remainingTime() > 0, 'Operation time budget exhausted', 'BUDGET_EXHAUSTED');
      const operation = identifier('process', [command, input]);
      let previous = await journal.readEntry(job.id, 'process', operation);
      if (previous?.outputRef) return artifacts.readJSON(previous.outputRef, callerCtx);
      let reconciledRun;
      if (previous && !previous.runId) {
        // Admission may have been interrupted before the child Run reference
        // was saved. A later explicit invocation checks retained evidence;
        // any recomputation gets a separate directory.
        ensure((callerCtx.nativeAttempt ?? 1) > (previous.nativeAttempt ?? 1), 'A previous process admission is unresolved; explicitly resubmit the same requestId to reconcile it', 'PROCESS_RECONCILIATION_REQUIRED');
        const child = await recoverChild(previous, callerCtx);
        if (child) previous = await journal.entry(job.id, 'process', operation, value => ({ ...value, runId: child.id }), callerCtx.signal);
        else {
          await settleBudget(previous, callerCtx);
          await journal.entry(job.id, 'process-attempt', `${operation}:${previous.attemptId}`, () => ({ ...previous, observedRunStatus: 'not_admitted', reconciledAt: Date.now(), disposition: 'retry_isolated_pure_computation' }), callerCtx.signal);
          previous = null;
        }
      }
      if (previous?.runId) {
        reconciledRun = (await host.runs.read(previous.runId)).run;
        while (['queued', 'running', 'cancelling', 'interrupting'].includes(reconciledRun.status)) {
          callerCtx.signal?.throwIfAborted();
          reconciledRun = (await host.runs.wait(previous.runId, { until: 'settled', timeoutMs: 30000 })).run;
        }
        ensure(['completed', 'cancelled', 'interrupted'].includes(reconciledRun.status), `Previous process is ${reconciledRun.status}; its termination must be resolved before consuming its receipt or retrying`, 'PROCESS_RECONCILIATION_REQUIRED');
        const usable = await retainedReceipt(previous, command);
        if (reconciledRun.status !== 'completed' || previous.status === 'failed' || !usable) {
          ensure((callerCtx.nativeAttempt ?? 1) > (previous.nativeAttempt ?? 1), `Previous process is ${reconciledRun.status}; explicitly resubmit the same requestId to reconcile its retained attempt`, 'PROCESS_RECONCILIATION_REQUIRED');
          await settleBudget(previous, callerCtx);
          // An explicit later invocation reconciles the stopped pure worker.
          // Its old files and receipt remain untouched; a new worker gets a
          // separate directory and cannot publish or mutate the factor library.
          await journal.entry(job.id, 'process-attempt', `${operation}:${previous.attemptId}`, () => ({ ...previous, observedRunStatus: reconciledRun.status, reconciledAt: Date.now(), disposition: usable ? 'use_verified_receipt' : 'retry_isolated_pure_computation' }), callerCtx.signal);
          if (usable) reconciledRun = { ...reconciledRun, output: { exitCode: 0 } };
          else { previous = null; reconciledRun = null; }
        }
      }
      const ctx = { ...callerCtx, attemptId: previous?.attemptId ?? `${command}:${randomUUID()}` };
      const dir = attemptDirectory(root, ctx), outputDir = join(dir, 'output'); await mkdir(outputDir, { recursive: true });
      const requestPath = join(dir, 'request.json'), resultPath = join(dir, 'result.json');
      const environmentInfo = await selection(ctx.signal);
      let prepared, settled;
      if (previous) {
        prepared = JSON.parse(await readFile(requestPath, 'utf8')).input; settled = reconciledRun.output;
      } else {
        const available = await budgets.available(job.id);
        const inputLimit = previous?.inputBytes ?? available.maxInputBytes;
        ensure(inputLimit > 0, 'Operation input byte budget exhausted', 'BUDGET_EXHAUSTED');
        prepared = await inputFor(command, input, ctx, { ...budget, maxInputBytes: inputLimit }, outputDir);
        const remaining = remainingTime();
        ensure(remaining > 0, 'Operation time budget exhausted during input preparation', 'BUDGET_EXHAUSTED');
        const payloadBytes = await localInputBytes(root, prepared), reservedInput = payloadBytes + Buffer.byteLength(canonical(prepared)) + 1024;
        const budgetToken = identifier('byte-budget', [operation, ctx.attemptId]);
        const operationId = `${job.id}:${operation}:${digest(ctx.attemptId).slice(7, 23)}`;
        await journal.entry(job.id, 'process', operation, prior => ({ ...prior, command, attemptId: ctx.attemptId, nativeAttempt: ctx.nativeAttempt ?? 1, epoch: ctx.epoch, parentRunId: job.runId, operationId, runId: null, resultPath, status: 'prepared', outputRef: null, startedAt: Date.now(), budgetToken, budgetSettled: false, inputBytes: reservedInput }), ctx.signal);
        const reserved = await budgets.reserve(ctx, budgetToken, reservedInput, command === 'prepare');
        const limits = { maxInputBytes: reserved.input, maxOutputBytes: reserved.output, timeoutMs: Math.max(1, Math.min(540000, Math.floor(remaining))), maxDiagnosticWork: Math.max(1, Math.min(20000000, Math.floor(remaining * 100))) };
        const requestBytes = Buffer.from(canonical({ schema: 'factor-worker/1', command, limits, input: prepared }));
        await writeFile(requestPath, requestBytes);
        await journal.entry(job.id, 'process', operation, prior => ({ ...prior, inputBytes: payloadBytes + requestBytes.length }), ctx.signal);
        const temp = join(root, 'python-temp'); await mkdir(temp, { recursive: true });
        const env = { TEMP: temp, TMP: temp, MPLCONFIGDIR: join(temp, 'matplotlib'), PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', OMP_NUM_THREADS: '1', MKL_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1' };
        try {
          settled = await runProcess(host, [environmentInfo.pythonPath, '-I', '-B', join(host.context.pluginRoot, 'python', 'worker.py'), requestPath, resultPath], { cwd: root, env, signal: ctx.signal, timeoutMs: limits.timeoutMs, operationId, onRun: run => journal.entry(job.id, 'process', operation, prior => ({ ...prior, runId: run.id, status: 'running' })) });
        } catch (cause) {
          if (!ctx.signal?.aborted) {
            try {
              const record = await journal.readEntry(job.id, 'process', operation);
              const child = record?.runId ? (await host.runs.read({ id: record.runId })).run : null;
              if (child && ['completed', 'cancelled', 'interrupted'].includes(child.status)) await settleBudget(record, ctx);
            } catch { /* Preserve the original failure; explicit recovery reconciles any retained reservation. */ }
          }
          throw cause;
        }
      }
      await settleBudget(await journal.readEntry(job.id, 'process', operation), ctx);
      ensure(settled.exitCode === 0, 'Python process did not finish successfully', 'PROCESS_EXIT');
      const receiptBytes = await readFile(resultPath); ensure(receiptBytes.length <= MAX_SHARD_BYTES, 'Worker result exceeds budget', 'RESOURCE_EXHAUSTED');
      const receipt = JSON.parse(receiptBytes.toString('utf8'));
      ensure(receipt.schema === 'factor-worker/1' && receipt.command === command, 'Worker receipt does not match request', 'EVIDENCE_MISMATCH');
      if (receipt.status !== 'ok') { await journal.entry(job.id, 'process', operation, prior => ({ ...prior, status: 'failed', error: receipt.error, finishedAt: Date.now() })); throw error(receipt.error.code, receipt.error.message, receipt.error.retryable); }
      await journal.assertActive(ctx);
      const result = await outputFor(command, receipt.output, input, prepared, ctx);
      await journal.assertActive(ctx);
      const outputRef = await artifacts.publishJSON(result, { schema: 'factor-evidence/1', dependencies: refsIn(result), operationId: `${job.id}:${operation}:receipt` }, ctx);
      await journal.entry(job.id, 'process', operation, prior => ({ ...prior, status: 'completed', outputRef, finishedAt: Date.now() }), ctx.signal);
      return result;
    },
  };
}
async function existingFileBytes(path) {
  try { const stat = await lstat(path); ensure(stat.isFile() && !stat.isSymbolicLink(), 'Worker output must be an ordinary file', 'FORBIDDEN'); return stat.size; }
  catch (cause) { if (cause.code === 'ENOENT') return 0; throw cause; }
}
async function directoryBytes(directory) {
  let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch (cause) { if (cause.code === 'ENOENT') return 0; throw cause; }
  let bytes = 0;
  for (const entry of entries) {
    ensure(!entry.isSymbolicLink(), 'Worker output must stay in its attempt directory', 'FORBIDDEN');
    bytes += entry.isDirectory() ? await directoryBytes(join(directory, entry.name)) : await existingFileBytes(join(directory, entry.name));
  }
  return bytes;
}
async function localInputBytes(root, value, seen = new Set()) {
  if (isFile(value)) {
    if (seen.has(value.path)) return 0; seen.add(value.path);
    const bytes = await verifiedFile(root, value);
    return bytes.length + (/\.json$/i.test(value.path) ? await localInputBytes(root, JSON.parse(bytes.toString('utf8')), seen) : 0);
  }
  if (isRef(value)) return 0;
  let bytes = 0;
  if (Array.isArray(value) || object(value)) for (const item of Object.values(value)) bytes += await localInputBytes(root, item, seen);
  return bytes;
}
export function evidenceContext(values, snapshot, profile, references) {
  return { snapshotId: snapshot.id, sourceDigest: snapshot.source.digest, layoutDigest: digest({ layout: snapshot.layout, calendarDigest: snapshot.calendarDigest }), profileDigest: digest(profile), engineDigest: digest(values.engine), referenceDigest: digest(referenceIdentity(references)) };
}
export function refsIn(value) {
  const refs = new Map(); const visit = item => { if (isRef(item)) refs.set(canonical(item), item); else if (Array.isArray(item)) item.forEach(visit); else if (object(item)) Object.values(item).forEach(visit); }; visit(value); return [...refs.values()];
}
async function localRows(rows, dir) {
  const files = []; let group = [], size = 2;
  const flush = async () => { if (!group.length) return; const path = join(dir, `rows-${files.length}.json`); await writeFile(path, canonical(group)); files.push(await fileReceipt(path)); group = []; size = 2; };
  for (const row of rows) { const bytes = Buffer.byteLength(canonical(row)) + 1; ensure(bytes < MAX_SHARD_BYTES - 1024, 'Source row too large', 'RESOURCE_EXHAUSTED'); if (size + bytes > MAX_SHARD_BYTES - 1024) await flush(); group.push(row); size += bytes; } await flush(); return files;
}
