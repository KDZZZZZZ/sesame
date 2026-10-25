import { renderReportBody } from './report.js';
import { canonical, digest } from './shared.js';
import { publishWorkflowReport } from './report-publication.js';

export function finalSnapshot(run) {
  return structuredClone(Object.fromEntries(Object.entries(run).filter(([key]) => !['report', 'reportPending', 'reportError', 'reportSnapshot', 'reportPublication', 'updatedAt', 'workflow', 'consumedOutputs'].includes(key))));
}
export async function archiveReport(host, run, dataset, { onPublication = () => {}, signal } = {}) {
  if (run.report?.ref) return run.report;
  const snapshot = run.reportSnapshot ?? finalSnapshot(run), hash = digest(snapshot);
  const inputRefs = structuredClone(snapshot.data.inputRefs ?? []);
  const raw = canonical(snapshot), html = renderReportBody(snapshot, { demo: Boolean(snapshot.data.synthetic) });
  const source = canonical({ schemaVersion: 1, dataDigest: snapshot.data.digest, holdoutSealed: snapshot.data.holdoutMode !== 'none' && !snapshot.finalEvaluation,
    holdoutStatus: snapshot.finalEvaluation?.holdoutStatus ?? (snapshot.data.holdoutMode === 'none' ? 'not-requested' : 'sealed'), evaluator: snapshot.config.evaluator, dataset });
  const factors = canonical({ schemaVersion: 1, runId: snapshot.id, data: snapshot.data, selection: snapshot.selection ?? null,
    factors: (snapshot.selection?.trialIds ?? []).map(id => ({ ...snapshot.trials.find(t => t.id === id), holdout: snapshot.holdout?.[id] ?? null })),
    usage: 'Reproduce with the frozen evaluator and evidence. Measured scores do not imply tradability.' });
  return publishWorkflowReport(host, { operationId: 'factor-publication:' + run.id + ':' + hash, title: snapshot.title, summary: snapshot.goal,
    bodyHTML: html, attachments: [['run.json', raw], ['dataset.json', source], ['factors.json', factors]].map(([path, content]) => ({ path, content, mediaType: 'application/json' })),
    data: inputRefs.map((ref, index) => ({ id: 'input-' + (index + 1), ref, usage: 'Frozen factor evaluation input' })), references: inputRefs,
    features: ['interactive'], demo: Boolean(snapshot.data.synthetic), publication: run.reportPublication, onPublication, signal });
}
