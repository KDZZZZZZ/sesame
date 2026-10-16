import { renderReport } from './report.js';
import { canonical, digest } from './shared.js';

export function finalSnapshot(run) {
  return structuredClone(Object.fromEntries(Object.entries(run).filter(([key]) => !['report', 'reportPending', 'reportError', 'reportSnapshot', 'updatedAt', 'workflow', 'consumedOutputs'].includes(key))));
}
export async function archiveReport(host, run, dataset) {
  if (run.report?.ref) return run.report;
  const snapshot = run.reportSnapshot ?? finalSnapshot(run), hash = digest(snapshot);
  const raw = canonical(snapshot), html = renderReport(snapshot, { demo: Boolean(run.data.synthetic) });
  const source = canonical({ schemaVersion: 1, dataDigest: run.data.digest, holdoutSealed: run.data.holdoutMode !== 'none' && !run.finalEvaluation,
    holdoutStatus: run.finalEvaluation?.holdoutStatus ?? (run.data.holdoutMode === 'none' ? 'not-requested' : 'sealed'), evaluator: run.config.evaluator, dataset });
  const factors = canonical({ schemaVersion: 1, runId: run.id, data: run.data, selection: run.selection ?? null,
    factors: (run.selection?.trialIds ?? []).map(id => ({ ...run.trials.find(t => t.id === id), holdout: run.holdout?.[id] ?? null })),
    usage: 'Reproduce with the frozen evaluator and evidence. Measured scores do not imply tradability.' });
  const files = [['run.json', raw], ['dataset.json', source], ['factors.json', factors], ['report.html', html]];
  const packageRoot = await host.resources.create({ kind: 'directory', lifetime: 'durable', name: run.id + '-report-' + hash.slice(7) }, { operationId: 'factor-report:' + run.id + ':' + hash });
  const blobs = [];
  for (const [path, content] of files) {
    await host.resources.create({ kind: 'file', lifetime: 'durable', parent: packageRoot, name: path, source: { content }, policy: { readOnly: true } }, { operationId: 'factor-report:' + run.id + ':' + hash + ':' + path });
    blobs.push({ entry: path, path, mediaType: path.endsWith('.html') ? 'text/html' : 'application/json' });
  }
  const { ref, receipt } = await host.resources.publish(packageRoot, { kind: 'report', schemaVersion: '1.0.0', content: {
    schemaVersion: '1.0.0', title: run.title, summary: run.goal, entry: 'report.html', runtime: 'sesame-report/1', runtimeRevision: '1.0.0', data: [], related: [], features: ['interactive'], locale: 'zh-CN',
    provenance: { kind: run.data.synthetic ? 'demo' : 'derived', references: [] },
  }, dependencies: [], blobs }, { operationId: 'factor-publication:' + run.id + ':' + hash });
  return { ref, receipt, entry: 'report.html', attachments: blobs.filter(blob => blob.path !== 'report.html').map(({ path, mediaType }) => ({ path, mediaType })), state: 'published' };
}
