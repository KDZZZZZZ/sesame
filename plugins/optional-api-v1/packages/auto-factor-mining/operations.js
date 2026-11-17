import { canonical, clone, ensure, identifier, operationBudget, validateComputeInput, validateEvaluateInput, validateFormula, validatePrepare, validateProfile } from './contracts.js';

/** Each call performs exactly the numerical operation selected by its caller. */
export function createOperations({ compute, evaluator, library, artifacts, execution }) {
  const readTyped = async (ref, schema, ctx) => {
    ctx.signal?.throwIfAborted();
    const declaration = await artifacts.verify(ref, ctx);
    ensure(ref.kind === 'resource' && declaration.content?.schema === schema, 'Artifact has the wrong factor schema', 'EVIDENCE_MISMATCH');
    const value = await artifacts.readJSON(ref, ctx);
    ctx.signal?.throwIfAborted();
    return { ...value, manifest: ref };
  };
  const validateItems = (items, ids) => {
    ensure(Array.isArray(items) && items.length === ids.length && new Set(items.map(item => item.id)).size === ids.length && items.every(item => ids.includes(item.id) && ['ok', 'failed'].includes(item.status)), 'Numerical results differ from the requested candidates', 'EVIDENCE_MISMATCH');
  };
  return {
    prepare(input, signal, nativeExecution) {
      validatePrepare(input);
      const budget = operationBudget(input.budget);
      return execution.execute('prepare', { ...input, budget }, signal, nativeExecution, async ctx => {
        const snapshot = await compute.prepare(input.source, input.layout, budget, ctx);
        ctx.signal?.throwIfAborted();
        return { snapshotRef: snapshot.manifest, snapshotId: snapshot.id, fields: snapshot.fields, layout: snapshot.layout, rows: { development: snapshot.development.rows, holdout: snapshot.holdout.rows } };
      });
    },
    compute(input, signal, nativeExecution) {
      validateComputeInput(input);
      return execution.execute('compute', { ...input, budget: operationBudget(input.budget, input.formulas.length) }, signal, nativeExecution, async ctx => {
        const snapshot = await readTyped(input.snapshotRef, 'factor-snapshot/1', ctx);
        const diagnostics = input.diagnostics === undefined ? undefined : auxiliaryRequests(input.formulas, input.diagnostics, snapshot.fields);
        const values = await compute.compute(snapshot, input.formulas, input.partition, ctx, diagnostics);
        ctx.signal?.throwIfAborted();
        ensure(values.snapshotId === snapshot.id && values.partition === input.partition && canonical(values.snapshotRef) === canonical(input.snapshotRef), 'Computed Values changed the requested data or partition', 'EVIDENCE_MISMATCH');
        validateItems(values.candidates, input.formulas.map(candidate => candidate.id));
        return { valuesRef: values.manifest, valuesId: values.id, snapshotId: values.snapshotId, partition: values.partition, candidates: values.candidates.map(item => item.status === 'ok' ? { id: item.id, status: 'ok', computeKey: item.value.computeKey } : { id: item.id, status: 'failed', error: item.error }) };
      });
    },
    evaluate(input, signal, nativeExecution) {
      validateEvaluateInput(input);
      // Values are read inside the bounded operation; their candidate count is
      // unknown at admission and cannot exceed one public compute batch.
      return execution.execute('evaluate', { ...input, budget: operationBudget(input.budget, 64) }, signal, nativeExecution, async ctx => {
        const values = await readTyped(input.valuesRef, 'factor-values/1', ctx);
        ensure(Array.isArray(values.candidates) && values.candidates.length > 0 && values.candidates.length <= 64, 'Values must contain one bounded candidate batch', 'EVIDENCE_MISMATCH');
        validateItems(values.candidates, values.candidates.map(item => item.id));
        const snapshot = await readTyped(values.snapshotRef, 'factor-snapshot/1', ctx);
        ensure(values.snapshotId === snapshot.id && ['development', 'holdout'].includes(values.partition), 'Values do not identify their frozen snapshot', 'EVIDENCE_MISMATCH');
        validateProfile(input.profile, snapshot.layout);
        const references = [];
        for (const ref of input.referenceValues) {
          const reference = await readTyped(ref, 'factor-values/1', ctx);
          ensure(reference.snapshotId === values.snapshotId && reference.partition === values.partition && canonical(reference.snapshotRef) === canonical(values.snapshotRef) && canonical(reference.engine) === canonical(values.engine), 'Reference Values use a different snapshot, partition or engine', 'EVIDENCE_MISMATCH');
          references.push(reference);
        }
        const evaluations = await evaluator.evaluate(values, input.profile, references, ctx);
        ctx.signal?.throwIfAborted();
        validateItems(evaluations, values.candidates.map(item => item.id));
        const candidates = values.candidates.filter(item => item.status === 'ok').map(item => item.value.candidate);
        const measured = evaluations.filter(item => item.status === 'ok').map(item => {
          const evaluation = item.value;
          ensure(evaluation.candidateId === item.id && candidates.some(candidate => candidate.id === item.id) && evaluation.valuesId === values.id && evaluation.partition === values.partition && canonical(evaluation.valuesRef) === canonical(input.valuesRef) && canonical(evaluation.profile) === canonical(input.profile), 'Evaluation changed its computed candidate or evidence identity', 'EVIDENCE_MISMATCH');
          return evaluation;
        });
        ctx.signal?.throwIfAborted();
        const factors = measured.length ? await library.record(candidates, measured, ctx) : [];
        ctx.signal?.throwIfAborted();
        return { valuesRef: input.valuesRef, partition: values.partition, evaluations, factorIds: factors.map(factor => factor.id) };
      });
    },
  };
}

function auxiliaryRequests(candidates, diagnostics, fields) {
  const covariateFields = [...new Set(diagnostics.filter(item => item.kind === 'regimes').map(item => item.options.field))];
  const sensitivity = [], option = diagnostics.find(item => item.kind === 'sensitivity')?.options;
  if (option) for (const candidate of candidates) {
    let selected = candidate.formula.tree;
    for (const index of option.argumentPath) selected = selected?.args?.[index];
    if (!Number.isFinite(selected?.constant)) continue;
    const neighbors = [];
    for (const value of option.neighbors) {
      const formula = clone(candidate.formula); let node = formula.tree;
      for (const index of option.argumentPath) node = node.args[index];
      node.constant = value;
      try { validateFormula(formula, { fields }); } catch { continue; }
      neighbors.push({ value, column: identifier('sensitivity', [candidate.id, option.argumentPath, value]), formula });
    }
    sensitivity.push({ candidateId: candidate.id, argumentPath: option.argumentPath, neighbors });
  }
  return { covariateFields, sensitivity };
}
