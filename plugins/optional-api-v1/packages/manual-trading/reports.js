import { digest } from '@sesame/plugin-sdk/protocol';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = value => `<pre>${escape(JSON.stringify(value ?? null, null, 2))}</pre>`;
const table = (rows, fields) => `<table><thead><tr>${fields.map(key => `<th>${escape(key)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${fields.map(key => `<td>${escape(typeof row[key] === 'object' ? JSON.stringify(row[key]) : row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
export const reportPath = run => `${run.plan.reportFolder}/${new Date(run.createdAt).toISOString().replace(/[:.]/g, '-')}-${run.id}.html`;
export function dailyHTML(run) {
  const decision = run.decision, status = ({ blocked: '执行受阻，需要核对', unchanged: '保持仓位不变', target_observed: '目标仓位已核对', reconciliation_required: '实际仓位仍需核对' })[run.execution?.status] ?? (run.error ? '本轮未完成' : '等待执行');
  const models = (run.tasks ?? []).map(task => ({ role: task.role, round: task.round, provider: task.model?.provider, model: task.model?.id, status: task.status, taskId: task.id }));
  const execution = run.execution ?? run.executionProgress;
  const executionSummary = execution ? { ...execution, before: undefined, after: undefined } : { status: 'not_executed' };
  const evidenceIndex = (run.evidence ?? []).map(item => ({ datasetId: item.datasetId, capturedAt: item.capturedAt, digest: item.digest, provenance: item.dataset?.provenance, rowCount: item.dataset?.rows?.length }));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(run.plan.title)} · 手工交易日报</title><style>
  :root{color-scheme:light dark;font-family:system-ui,"Microsoft YaHei",sans-serif;line-height:1.65}body{max-width:1120px;margin:40px auto;padding:0 24px}header{border-bottom:2px solid #628b86;padding-bottom:20px}h1{font-size:30px}h2{margin-top:36px;font-size:21px}.muted{opacity:.7}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#80808012;padding:16px;border-radius:8px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;border-bottom:1px solid #8885;padding:9px;overflow-wrap:anywhere}details{margin:14px 0}summary{cursor:pointer;font-weight:600}.status{font-weight:650;color:#428079}section{overflow:auto}</style></head><body>
  <header><p class="muted">手工交易日报 · ${escape(new Date(run.createdAt).toISOString())}</p><h1>${escape(run.plan.title)}</h1><p class="status">${escape(status)} · ${escape(decision?.unchanged ? '目标仓位不变' : decision ? '调整目标仓位' : '未形成有效目标')}</p><p>${escape(decision?.rationale ?? run.error?.message ?? '等待可核验结论')}</p><p class="muted">账户 ${escape(run.plan.account.accountId)} · ${escape(run.plan.execution?.pluginId ?? '')} · 运行 ${escape(run.id)}</p></header>
  <section><h2>账户与原始持仓</h2>${json(run.snapshot?.summary)}${table(run.snapshot?.positions ?? [], [...new Set((run.snapshot?.positions ?? []).flatMap(row => Object.keys(row)))].slice(0, 12))}<p class="muted">全账户持仓，包含量化策略持仓；历史覆盖：${escape(JSON.stringify(run.snapshot?.historyCoverage ?? null))}</p></section>
  <section><h2>目标仓位</h2>${table(decision?.targets ?? [], ['symbol', 'quantity', 'unit'])}<p>未列出的品种保持不变；明确零仓位表示平仓。目标数量不是成交数量。</p></section>
  <section><h2>挂载风险与停止结果</h2>${json(execution?.pauses ?? decision?.pause_strategies ?? [])}<p class="muted">停止挂载不等于平仓；实际停止行为与状态以回执为准。</p></section>
  <section><h2>交易执行与核对</h2>${json(executionSummary)}<p class="muted">submitted、outcome_unknown 与部分成交均不表示目标已达到。本报告不从目标计算实际收益。</p></section>
  <section><h2>团队报告与分歧</h2>${table(models, ['role', 'round', 'provider', 'model', 'status'])}${(run.reports ?? []).map(report => `<details open><summary>${escape(report.role)} · ${escape(report.model?.provider)}/${escape(report.model?.id)}</summary><pre>${escape(report.text)}</pre></details>`).join('')}</section>
  <section><h2>证据、交易历史与复盘</h2><p>以下快照为当时可见资料。来源缺失与时间边界保留在原始记录中。完整记录保存在本报告冻结附件 run.json 中。</p><details><summary>研究证据索引</summary>${json(evidenceIndex)}</details><details><summary>委托和成交历史</summary>${json({ orders: run.snapshot?.orders, fills: run.snapshot?.fills, historicalOrders: run.snapshot?.historicalOrders })}</details><details><summary>已知案例与复盘</summary>${json(run.memoryContext)}</details><details><summary>运行状态</summary>${json({ id: run.id, status: run.status, createdAt: run.createdAt, completedAt: run.completedAt, trigger: run.trigger, error: run.error, memoryError: run.memoryError })}</details></section></body></html>`;
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
  for (const [path, content] of [['run.json', raw], ['report.html', html]]) {
    await host.resources.create({ kind: 'file', lifetime: 'durable', parent: root, name: path, source: { content }, policy: { readOnly: true } }, { operationId: 'manual-report:' + run.id + ':' + hash + ':' + path });
    blobs.push({ entry: path, path, mediaType: path.endsWith('.html') ? 'text/html' : 'application/json' });
  }
  const { ref, receipt } = await host.resources.publish(root, { kind: 'report', schemaVersion: '1.0.0', content: {
    schemaVersion: '1.0.0', title: run.plan.title, summary: run.decision?.rationale ?? run.error?.message ?? run.status, entry: 'report.html', runtime: 'sesame-report/1', runtimeRevision: '1.0.0', data: [], related: [], features: [], locale: 'zh-CN',
    provenance: { kind: run.mockModelResponses ? 'demo' : 'derived', references: [] },
  }, dependencies: [], blobs }, { operationId: 'manual-publication:' + run.id + ':' + hash });
  return { ref, receipt, entry: 'report.html', attachments: [{ path: 'run.json', mediaType: 'application/json' }], state: 'published' };
}
