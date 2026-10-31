import { canonical, digest } from './shared.js';
import { publishWorkflowReport } from './report-publication.js';
import { artifactRef, uniqueRefs } from './research-artifacts.js';

export function finalSnapshot(run) {
  return structuredClone(Object.fromEntries(Object.entries(run).filter(([key]) => !['report', 'reportPending', 'reportError', 'reportSnapshot', 'reportPublication', 'updatedAt', 'workflow', 'consumedOutputs'].includes(key))));
}
export async function archiveReport(host, run, dataset, { onPublication = () => {}, signal } = {}) {
  if (run.report?.ref) return run.report;
  const snapshot = run.reportSnapshot ?? finalSnapshot(run), hash = digest(snapshot);
  const nativeInputs = snapshot.nativeValidation?.windows ? [snapshot.config.nativeValidation.development.data, snapshot.config.nativeValidation.holdout?.data].filter(Boolean) : [];
  const nativeResults = (snapshot.nativeValidation?.attempts ?? []).flatMap(attempt => {
    const result = attempt.result ?? {};
    return [result.ref, result.rawResult, result.nativeSource, result.environment, ...(result.data ?? []).map(table => table.ref)].filter(ref => artifactRef(ref));
  });
  const factorInputs = uniqueRefs(snapshot.data.inputRefs ?? []);
  const inputRefs = uniqueRefs([...factorInputs, ...nativeInputs]);
  const references = uniqueRefs([...inputRefs, ...nativeResults]);
  const raw = canonical(snapshot);
  const source = canonical({ schemaVersion: 1, dataDigest: snapshot.data.digest, holdoutSealed: snapshot.data.holdoutMode !== 'none' && !snapshot.finalEvaluation,
    holdoutStatus: snapshot.finalEvaluation?.holdoutStatus ?? (snapshot.data.holdoutMode === 'none' ? 'not-requested' : 'sealed'), evaluator: snapshot.config.evaluator, dataset });
  const factors = canonical({ schemaVersion: 1, runId: snapshot.id, data: snapshot.data, selection: snapshot.selection ?? null,
    factors: (snapshot.selection?.trialIds ?? []).map(id => ({ ...snapshot.trials.find(t => t.id === id), holdout: snapshot.holdout?.[id] ?? null })),
    ...(snapshot.strategyValidation ? { strategyValidation: snapshot.strategyValidation } : {}),
    ...(snapshot.nativeValidation ? { nativeValidation: snapshot.nativeValidation } : {}),
    usage: 'Reproduce with the frozen evaluator and evidence. Measured scores do not imply tradability or a completed trade-rule backtest.' });
  return publishWorkflowReport(host, { operationId: 'factor-publication:' + run.id + ':' + hash, title: snapshot.title, summary: `比较了 ${snapshot.trials?.length ?? 0} 个信号，保留 ${snapshot.selection?.trialIds?.length ?? 0} 个继续观察；图中展示效果和限制。`,
    content: { kind: 'signal-study', run: snapshot }, attachments: [['run.json', raw], ['dataset.json', source], ['factors.json', factors]].map(([path, content]) => ({ path, content, mediaType: 'application/json' })),
    data: inputRefs.map((ref, index) => ({ id: 'input-' + (index + 1), ref, usage: nativeInputs.some(input => canonical(input) === canonical(ref))
      ? factorInputs.some(input => canonical(input) === canonical(ref)) ? 'Frozen factor evaluation and explicitly declared native validation input' : 'Explicitly declared fixed native validation input'
      : 'Frozen factor evaluation input' })), references,
    features: ['interactive'], demo: Boolean(snapshot.data.synthetic), publication: run.reportPublication, onPublication, signal });
}
