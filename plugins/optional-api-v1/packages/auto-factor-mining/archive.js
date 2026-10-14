import { renderReport } from './report.js';
import { canonical, check, digest } from './shared.js';

export function finalSnapshot(run) {
  const snapshot = Object.fromEntries(Object.entries(run).filter(([key]) => !['report', 'reportPending', 'reportError', 'reportSnapshot', 'reportFiles', 'updatedAt', 'activityReadKeys', 'activitySequence', 'activityDropped'].includes(key)));
  snapshot.tasks = run.tasks.filter(task => task.role !== 'reporter');
  snapshot.events = run.events.filter(event => event.role !== 'reporter');
  return structuredClone(snapshot);
}

export async function archiveReport(host, run, dataset, { onFile = () => {} } = {}) {
  const files = host.reports.files.forSpace('research');
  const folder = run.config.reportFolder;
  let entries = (await files.list({ recursive: true })).entries;
  // File identity survives user moves. Deletion or edits are not permission to
  // create another summary or overwrite the user's version.
  if (run.report?.fileId) {
    const existing = entries.find(entry => entry.id === run.report.fileId);
    if (!existing) return { ...run.report, state: 'removed_by_user' };
    const current = await files.read({ path: existing.path });
    return { ...run.report, path: existing.path, state: digest(current.content) === run.report.digest ? 'archived' : 'modified_by_user' };
  }
  const known = entries.find(e => e.path === folder);
  if (known) check(known.kind === 'directory', 'REPORT_PATH_OCCUPIED', 'Research report folder is a file');
  else {
    try { await files.mkdir({ path: folder }); }
    catch (error) { if (!(await files.list({ recursive: true })).entries.some(e => e.path === folder && e.kind === 'directory')) throw error; }
  }
  // Reporter execution details change after publication; omit them from this
  // immutable snapshot so retries generate identical evidence and HTML.
  const snapshot = run.reportSnapshot ?? finalSnapshot(run);
  const snapshotDigest = digest(snapshot);
  const base = `${folder}/${run.id}`;
  const raw = canonical(snapshot), html = renderReport(snapshot, { demo: Boolean(run.data.synthetic) });
  // Cancelled/exhausted work can finish without a frozen selection. Its unused
  // holdout is not exported as development evidence.
  const holdoutSealed = run.data.holdoutMode !== 'none' && !run.finalEvaluation;
  const source = canonical({ schemaVersion: 1, dataDigest: run.data.digest, holdoutSealed, holdoutStatus: run.finalEvaluation?.holdoutStatus ?? (run.data.holdoutMode === 'none' ? 'not-requested' : 'sealed'), evaluator: run.config.evaluator ?? null, dataset });
  const factors = canonical({ schemaVersion: 1, runId: run.id, data: run.data, selection: run.selection ?? null,
    factors: (run.selection?.trialIds ?? []).map(id => { const trial = run.trials.find(t => t.id === id); return { ...trial, holdout: run.holdout?.[id] ?? null }; }),
    usage: 'Reproduce using the explicitly selected evaluator and its frozen inputs/receipts. The workflow does not define numerical methods or imply tradability.' });
  const blobs = [['run.json', raw], ['dataset.json', source], ['factors.json', factors], ['report.html', html]].map(([path, content]) => ({ ...host.artifacts.blob(content), path, mediaType: path.endsWith('.html') ? 'text/html' : 'application/json' }));
  const evidenceRef = host.artifacts.publish({ operationId: `factor-report:${run.id}:${snapshotDigest}`, manifest: {
    kind: 'resource', schemaVersion: '1.0.0', content: { type: 'auto-factor-mining-run', runId: run.id, path: 'run.json' },
    dependencies: [], blobs, provenance: { kind: 'derived', references: [] },
  } });
  entries = (await files.list({ recursive: true })).entries;
  let htmlEntry; const paths = {};
  for (const [suffix, content] of [['.json', raw], ['.dataset.json', source], ['.factors.json', factors], ['.html', html]]) {
    const path = base + suffix, recorded = run.reportFiles?.find(file => file.suffix === suffix);
    const existing = recorded ? entries.find(entry => entry.id === recorded.fileId) : entries.find(entry => entry.path === path);
    if (recorded) check(existing, 'REPORT_REMOVED_BY_USER', `Previously written evidence was removed; it will not be recreated: ${recorded.path}`);
    let entry;
    if (existing) {
      const read = await files.read({ path: existing.path });
      check(read.content === content, 'REPORT_PATH_OCCUPIED', `Existing report differs and will not be overwritten: ${path}`);
      entry = existing;
    } else entry = await files.write({ path, content });
    paths[suffix] = entry.path ?? path;
    onFile({ suffix, fileId: entry.id, path: paths[suffix], digest: digest(content) });
    if (suffix === '.html') htmlEntry = entry;
  }
  return { fileId: htmlEntry.id, path: paths['.html'], dataPath: paths['.json'], datasetPath: paths['.dataset.json'], factorsPath: paths['.factors.json'],
    evidenceRef, space: 'research', digest: digest(html), state: 'archived' };
}
