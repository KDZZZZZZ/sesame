import { digest } from '@sesame/plugin-sdk/protocol';
import { renderMarkdown } from '@sesame/plugin-sdk/markdown';
import { publishWorkflowReport } from './report-publication.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const managerSummary = run => run.reports?.findLast(report => report.role === 'manager' && report.status === 'completed' && report.text?.trim())?.text;
export const reportPath = run => `${run.plan.reportFolder}/${new Date(run.createdAt).toISOString().replace(/[:.]/g, '-')}-${run.id}.html`;
export function dailyHTML(run) {
  const summary = managerSummary(run) ?? '经理尚未形成最终总结，已取得的成果保留在工作过程中。';
  const disposition = run.executionDisposition === 'decision_only' ? '本轮仅交付决策，未执行交易。'
    : run.executionDisposition === 'withheld_by_review' ? '复核阻止本轮执行，未执行交易。' : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(run.plan.title)}</title><style>
  :root{color-scheme:light dark;font-family:system-ui,"Microsoft YaHei",sans-serif;line-height:1.65}body{max-width:1120px;margin:40px auto;padding:0 24px}h1{font-size:30px}h2{margin-top:36px;font-size:21px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#80808012;padding:16px;border-radius:8px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;border-bottom:1px solid #8885;padding:9px;overflow-wrap:anywhere}main{overflow:auto}</style></head><body>${disposition ? `<p>${escape(disposition)}</p>` : ''}<main class="report-markdown">${renderMarkdown(summary)}</main></body></html>`;
}

export async function writeDailyReport(host, run, { onSnapshot = () => {}, onPublication = () => {}, signal } = {}) {
  if (run.report?.ref) return run.report;
  let frozen = run.reportSnapshot;
  if (!frozen) {
    frozen = { ...run };
    for (const key of ['report', 'reportError', 'reportPending', 'reportSnapshot', 'reportPublication', 'workflow', 'consumedOutputs']) delete frozen[key];
    frozen = structuredClone(frozen); onSnapshot(frozen);
  }
  const raw = JSON.stringify(frozen, null, 2), hash = digest(raw);
  const disposition = frozen.executionDisposition === 'decision_only' ? '本轮仅交付决策，未执行交易。'
    : frozen.executionDisposition === 'withheld_by_review' ? '复核阻止本轮执行，未执行交易。' : '';
  const summary = managerSummary(frozen) ?? '经理尚未形成最终总结，已取得的成果保留在工作过程中。';
  return publishWorkflowReport(host, { operationId: 'trading-decision-publication:' + run.id + ':' + hash,
    title: frozen.plan.title, summary: summary.slice(0, 1000), bodyHTML: (disposition ? '<p>' + escape(disposition) + '</p>' : '') + '<article class="report-markdown">' + renderMarkdown(summary) + '</article>',
    attachments: [{ path: 'run.json', content: raw, mediaType: 'application/json' }], references: [...(frozen.plan.researchRefs ?? []), ...(frozen.decision?.evidence_artifacts ?? [])],
    demo: Boolean(frozen.mockModelResponses), publication: run.reportPublication, onPublication, signal });
}
