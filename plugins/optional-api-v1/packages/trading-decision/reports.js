import { digest } from '@sesame/plugin-sdk/protocol';
import { publishWorkflowReport } from './report-publication.js';

const managerSummary = run => run.reports?.findLast(report => report.role === 'manager' && report.status === 'completed' && report.text?.trim())?.text;
export const reportPath = run => `${run.plan.reportFolder}/${new Date(run.createdAt).toISOString().replace(/[:.]/g, '-')}-${run.id}.html`;
export async function writeDailyReport(host, run, { onSnapshot = () => {}, onPublication = () => {}, signal } = {}) {
  if (run.report?.ref) return run.report;
  let frozen = run.reportSnapshot;
  if (!frozen) {
    frozen = { ...run };
    for (const key of ['report', 'reportError', 'reportPending', 'reportSnapshot', 'reportPublication', 'workflow', 'consumedOutputs']) delete frozen[key];
    frozen = structuredClone(frozen); onSnapshot(frozen);
  }
  const raw = JSON.stringify(frozen, null, 2), hash = digest(raw);
  const lead = frozen.decision?.unchanged ? '本轮决定维持当前仓位。'
    : frozen.decision?.targets?.length ? `本轮已为 ${frozen.decision.targets.length} 个品种确定目标仓位。` : '本轮尚无已保存的目标仓位决策。';
  const disposition = frozen.executionDisposition === 'decision_only' ? '本轮仅交付决策，未执行交易。'
    : frozen.executionDisposition === 'withheld_by_review' ? '复核阻止本轮执行，未执行交易。'
    : frozen.execution ? '已取得执行回执' : '尚无执行回执';
  const summary = managerSummary(frozen) ?? '经理尚未形成最终总结，已取得的成果保留在工作过程中。';
  const markdown = { type: 'markdown', text: summary };
  const body = summary.length <= 1500 ? markdown : { type: 'details', title: '查看完整经理总结', blocks: [markdown] };
  return publishWorkflowReport(host, { operationId: 'trading-decision-publication:' + run.id + ':' + hash,
    title: frozen.plan.title, summary: summary.slice(0, 1000), lead, highlights: [{ label: '交易执行', value: disposition }],
    content: { kind: 'document', sections: [{ title: '本次判断', blocks: [body] }] },
    attachments: [{ path: 'run.json', content: raw, mediaType: 'application/json' }], references: [...(frozen.plan.researchRefs ?? []), ...(frozen.decision?.evidence_artifacts ?? [])],
    demo: Boolean(frozen.mockModelResponses), publication: run.reportPublication, onPublication, signal });
}
