import { digest } from '@sesame/plugin-sdk/protocol';
import { renderMarkdown } from '@sesame/plugin-sdk/markdown';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const managerSummary = run => run.summary?.trim() ? run.summary : run.reports?.findLast(report => report.role === 'manager' && report.status === 'completed' && report.text?.trim())?.text;
export const reportPath = run => `${run.plan.reportFolder}/${new Date(run.createdAt).toISOString().replace(/[:.]/g, '-')}-${run.id}.html`;
export function dailyHTML(run) {
  const summary = managerSummary(run) ?? '经理尚未形成最终总结，已取得的成果保留在工作过程中。';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(run.plan.title)}</title><style>
  :root{color-scheme:light dark;font-family:system-ui,"Microsoft YaHei",sans-serif;line-height:1.65}body{max-width:1120px;margin:40px auto;padding:0 24px}h1{font-size:30px}h2{margin-top:36px;font-size:21px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#80808012;padding:16px;border-radius:8px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;border-bottom:1px solid #8885;padding:9px;overflow-wrap:anywhere}main{overflow:auto}</style></head><body><main class="report-markdown">${renderMarkdown(summary)}</main></body></html>`;
}

export async function writeDailyReport(host, run, { onSnapshot = () => {} } = {}) {
  if (run.report?.ref) return run.report;
  let frozen = run.reportSnapshot;
  if (!frozen) {
    frozen = { ...run };
    for (const key of ['report', 'reportError', 'reportPending', 'reportSnapshot', 'workflow', 'consumedOutputs']) delete frozen[key];
    frozen = structuredClone(frozen); onSnapshot(frozen);
  }
  const raw = JSON.stringify(frozen, null, 2), html = dailyHTML(frozen), hash = digest(raw);
  const root = await host.resources.create({ kind: 'directory', lifetime: 'durable', name: run.id + '-report-' + hash.slice(7) }, { operationId: 'manual-report:' + run.id + ':' + hash });
  const blobs = [];
  const analysis = run.plan.purpose === 'analysis';
  for (const [path, content] of [['run.json', raw], ['report.html', html], ...(analysis ? [['analysis.md', frozen.summary ?? frozen.error?.message ?? '研究未完成。']] : [])]) {
    await host.resources.create({ kind: 'file', lifetime: 'durable', parent: root, name: path, source: { content }, policy: { readOnly: true } }, { operationId: 'manual-report:' + run.id + ':' + hash + ':' + path });
    blobs.push({ entry: path, path, mediaType: path.endsWith('.html') ? 'text/html' : path.endsWith('.md') ? 'text/markdown' : 'application/json' });
  }
  const { ref, receipt } = await host.resources.publish(root, { kind: 'report', schemaVersion: '1.0.0', content: {
    schemaVersion: '1.0.0', title: run.plan.title, summary: managerSummary(frozen)?.slice(0, 1000) ?? '经理尚未形成最终总结。', entry: 'report.html', runtime: 'sesame-report/1', runtimeRevision: '1.0.0', data: [], related: [], features: [], locale: 'zh-CN',
    provenance: { kind: run.mockModelResponses ? 'demo' : 'derived', references: [] },
  }, dependencies: [], blobs }, { operationId: 'manual-publication:' + run.id + ':' + hash });
  return { ref, receipt, entry: 'report.html', attachments: [{ path: 'run.json', mediaType: 'application/json' }, ...(analysis ? [{ path: 'analysis.md', mediaType: 'text/markdown' }] : [])], state: 'published' };
}
