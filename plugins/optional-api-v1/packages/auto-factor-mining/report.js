import { invokeValue } from '@sesame/plugin-sdk/capabilities';
import { artifactRef, canonical, digest, ensure } from './contracts.js';
import { refsIn } from './python-bridge.js';

const metric = value => value?.status === 'computed' && Number.isFinite(value.value) ? Number(value.value.toPrecision(5)) : '—';
const paragraph = text => ({ type: 'paragraph', text });
const formulaText = node => node.field ? `$${node.field}` : Object.hasOwn(node, 'constant') ? String(node.constant) : `${node.call}(${node.args.map(formulaText).join(', ')})`;
export function buildContent(job, input, trials) {
  const measured = trials.filter(t => t.development?.status === 'evaluated');
  const held = trials.filter(t => t.holdout?.status === 'evaluated');
  const evaluated = trials.filter(t => t.candidate && (t.development?.evaluation || t.holdout?.evaluation));
  const rows = evaluated.slice().sort((a, b) => ((b.development?.evaluation ?? b.holdout?.evaluation).score.value ?? -Infinity) - ((a.development?.evaluation ?? a.holdout?.evaluation).score.value ?? -Infinity)).slice(0, 100);
  const state = input.profile?.kind === 'state';
  const body = rows.map(t => {
    const development = t.development?.evaluation, holdout = t.holdout?.evaluation, primary = development ?? holdout;
    return [formulaText(t.candidate.formula.tree), metric(state ? development?.score : development?.rankIC), metric(state ? holdout?.score : holdout?.rankIC), metric(primary.coverage), metric(primary.stability), (t.development?.factorIds ?? t.holdout?.factorIds ?? []).join('、')];
  });
  const sections = [{ title: '研究目标', blocks: [paragraph(input.need ?? (input.mode === 'compute' ? '计算已指定公式，并保留可供后续评价的固定因子值。' : '评价已指定因子的关联、稳定性和参考因子关系。'))] }];
  if (body.length) sections.push({ title: state ? '状态识别因子' : '因子证据', blocks: [{ type: 'table', columns: ['公式', state ? '开发 η²' : '开发 RankIC', state ? '留出 η²' : '留出 RankIC', '覆盖率', '稳定性标准差', '因子库编号'], rows: body }] });
  const diagnosticRows = rows.flatMap(t => [...(t.development?.evaluation?.diagnostics ?? []).map(d => ['开发', d]), ...(t.holdout?.evaluation?.diagnostics ?? []).map(d => ['留出', d])].map(([partition, d]) => [formulaText(t.candidate.formula.tree), partition, d.kind, ({ passed: '已计算', failed: '未达到条件', incomplete: '未完成' })[d.status], d.reason ?? '']));
  if (diagnosticRows.length) sections.push({ title: '稳健性检验', blocks: [{ type: 'table', columns: ['公式', '样本', '检验', '结果', '具体情况'], rows: diagnosticRows.slice(0, 200) }] });
  if (job.reusedFactorIds?.length) sections.push({ title: '复用的已有因子', blocks: [{ type: 'table', columns: ['因子库编号'], rows: job.reusedFactorIds.slice(0, 100).map(id => [id]) }] });
  const layout = input.layout ?? job.snapshot?.layout;
  if (layout) sections.push({ title: '数据与评价条件', blocks: [paragraph(`${layout.universe.join('、')} · ${layout.frequency} · ${layout.timezone}；目标 ${layout.target.kind}，${layout.target.horizonBars} 根 K 线。`), paragraph(`开发区间 ${layout.development.join(' — ')}；留出区间 ${layout.holdout.join(' — ')}。`), paragraph(input.profile ? `评价轴：${input.profile.axis}；最低有效配对 ${input.profile.minPairs}，最低覆盖率 ${input.profile.minCoverage}。稳定性采用分段关联的标准差，数值越小越稳定。` : '因子值按固定时间网格保留，缺值单独记录。')] });
  const failures = trials.filter(t => t.development?.status === 'failed' || t.holdout?.status === 'failed');
  if (failures.length) sections.push({ title: '需要补充的计算', blocks: [{ type: 'table', columns: ['公式', '原因'], rows: failures.slice(0, 100).map(t => [t.candidate ? formulaText(t.candidate.formula.tree) : t.candidateId ?? t.key, (t.development?.error ?? t.holdout?.error).message]) }] });
  const computed = trials.filter(t => t.development?.status === 'computed').length;
  return { kind: 'document', overview: { conclusion: job.reusedFactorIds?.length ? `复用 ${job.reusedFactorIds.length} 个已有因子的匹配证据` : input.mode === 'compute' ? `已计算 ${computed} 个因子，固定因子值已保存` : `已评价 ${evaluated.length} 个因子，${held.length} 个完成留出检验`, facts: [{ label: '已尝试', value: String(job.attemptsUsed ?? job.proposed), format: 'number' }, { label: input.mode === 'compute' ? '已计算' : '开发评价', value: String(input.mode === 'compute' ? computed : measured.length), format: 'number' }, { label: '留出检验', value: String(held.length), format: 'number' }] }, sections };
}
export function createReports({ host, artifacts, journal }) {
  async function evidenceIndex(job, trials) {
    let pages = [];
    for (let start = 0; start < trials.length; start += 8) {
      const value = { trials: trials.slice(start, start + 8) };
      pages.push(await artifacts.publishJSON(value, { schema: 'factor-evidence/1', dependencies: refsIn(value), operationId: `${job.id}:report-evidence:${start}` }));
    }
    for (let level = 0; pages.length > 128; level++) {
      const next = [];
      for (let start = 0; start < pages.length; start += 128) {
        const children = pages.slice(start, start + 128);
        next.push(await artifacts.publishJSON({ pages: children }, { schema: 'factor-evidence/1', dependencies: children, operationId: `${job.id}:report-index:${level}:${start}` }));
      }
      pages = next;
    }
    return artifacts.publishJSON({ jobId: job.id, attempted: job.attemptsUsed ?? job.proposed, completed: job.completed, pages, reusedFactorIds: job.reusedFactorIds ?? [], holdoutExposureRef: job.holdoutExposureRef ?? null }, { schema: 'factor-evidence/1', dependencies: [...pages, ...(job.holdoutExposureRef ? [job.holdoutExposureRef] : [])], operationId: `${job.id}:report-evidence` });
  }
  return {
    async publish(job, onPublished) {
      let ref = job.report;
      if (!ref) {
        const description = await invokeValue(host, 'host.reports.describe', {});
        const variants = description.inputSchema?.properties?.content?.oneOf ?? [];
        ensure(description.contract === 'sesame.report/1' && description.provider?.pluginId === 'sesame/reports' && variants.some(v => v.properties?.kind?.const === 'document'), 'Selected report provider does not support structured factor reports', 'REPORT_PROVIDER_UNSUPPORTED');
        const input = await artifacts.readJSON(job.inputRef), trials = await journal.all(job.id, 'candidate');
        const references = [job.inputRef, job.snapshot?.manifest, job.searchCheckpoint, job.valuesRef, await evidenceIndex(job, trials)].filter(Boolean);
        let provenanceKind = 'derived';
        if (job.snapshot?.source) { references.push(job.snapshot.source); const source = await artifacts.verify(job.snapshot.source); if (source.content?.provenance?.kind === 'demo') provenanceKind = 'demo'; }
        const title = input.need ? `因子研究：${input.need.slice(0, 70)}` : '因子计算与评价';
        const report = await invokeValue(host, 'host.reports.publish', { operationId: `${job.id}:factor-report`, title, summary: `已保存 ${job.completed} 项计算结果与对应因子证据。`, locale: 'zh-CN', space: 'research', provenanceKind, data: [], related: [], references: [...new Map(references.map(r => [canonical(r), r])).values()], features: [], input: { content: buildContent(job, input, trials) } });
        ref = artifactRef(report.ref); ensure(ref.kind === 'report', 'Publication did not return a report', 'REPORT_PUBLICATION_UNKNOWN');
        await onPublished(ref);
      }
      await invokeValue(host, 'sesame/reports#report_check', { ref });
      const receipts = await host.resources.read(ref, { part: 'receipts' });
      const matching = receipts.items.filter(r => r.renderer?.name === 'sesame-report-inspector' && digest(r.artifact) === digest(ref));
      const latest = matching.map((receipt, index) => ({ receipt, index })).sort((a, b) => (Number(b.receipt.observedAt) || Date.parse(b.receipt.observedAt) || 0) - (Number(a.receipt.observedAt) || Date.parse(a.receipt.observedAt) || 0) || b.index - a.index)[0]?.receipt;
      ensure(latest?.status === 'rendered', 'The published report has not passed its render check', 'REPORT_NOT_RENDERED');
      return { ref };
    },
  };
}
