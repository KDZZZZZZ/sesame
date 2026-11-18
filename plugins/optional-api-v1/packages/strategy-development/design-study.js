import { canonical } from '@sesame/plugin-sdk/protocol';
import { analyzeBreakoutStudy } from './breakout-study.js';
import { readBarPartition, unusedRange } from './experiments.js';
import { reservePartition } from './partition-history.js';
import { loadProject, saveProject } from './project.js';
import { publishRecord, requireThat } from './records.js';

function interpretSide({ opportunities: observed, allDecisions: reference }) {
  if (!observed.labeled) return { observation: 'no_complete_opportunities', nextTest: '核对突破机会数与末端截尾数。先取得覆盖预设持有期的开发样本。' };
  if (observed.meanGapOnSignalClose > 0 && observed.meanContinuationOnNextOpen <= 0)
    return { observation: 'favorable_gap_without_positive_mean_continuation', nextTest: '本样本的平均顺向移动出现在入场前。核对报价和成交延迟，再判断这个入场时点是否值得回测。' };
  if (observed.labeled === reference.labeled)
    return { observation: 'no_nonbreakout_reference', nextTest: '所有完整机会都触发突破。补充含未突破时段的开发行情，才能判断这条规则的筛选作用。' };
  if (observed.meanContinuationOnNextOpen <= 0)
    return { observation: 'nonpositive_mean_after_open', nextTest: '开发样本在最早入场后平均缺少顺向延续。检视逐次机会和相应期限，再决定是否保留这个想法。' };
  if (observed.meanContinuationOnNextOpen <= reference.meanContinuationOnNextOpen)
    return { observation: 'positive_continuation_also_present_in_reference', nextTest: '开盘后有顺向移动，全体同方向决策也有相近或更大的均值。用时段、波动和敞口相近的机会检验突破是否增加选择价值。' };
  return { observation: 'positive_mean_continuation_above_reference', nextTest: '开发样本在开盘后仍有顺向延续。用同方向、相近时段和波动的对照，再以实际费用和下一次可成交规则验证基线。' };
}

export async function studyProject(host, input, signal) {
  const project = await loadProject(host, input.project_ref);
  const { development, study, columns = {}, operation_id: key } = input;
  requireThat(study.method === 'breakout_continuation', 'Choose the breakout_continuation opportunity study.');
  requireThat(!project.protocol?.holdout || canonical(development) !== canonical(project.protocol.holdout),
    'This data is the project’s declared holdout. Supply development bars for the design study.');
  const { partition, values } = await readBarPartition(host, development, columns, signal);
  unusedRange(partition, project.consumedHoldouts ?? []);
  await reservePartition(host, project.projectKey, 'development', partition, null, 'study:' + key);
  const protocol = { study, columns, partition, projectRef: input.project_ref, researchDesign: project.researchDesign ?? null };
  const protocolRef = await publishRecord(host, 'strategy-development.design-study-protocol', protocol, key, [input.project_ref, development]);
  signal?.throwIfAborted();
  const assessment = analyzeBreakoutStudy(values, columns, study, signal);
  const interpretation = Object.fromEntries(Object.entries(assessment.sides).map(([side, results]) => [side, interpretSide(results)]));
  const evidence = { study, protocolRef, developmentRef: development, partition, assessment, interpretation };
  const ref = await publishRecord(host, 'strategy-development.design-study', evidence, key, [protocolRef, development]);
  const designStudy = { method: study.method, ref, protocolRef, developmentRef: development, recordedFrom: input.project_ref, interpretation };
  const saved = await saveProject(host, { ...project, designStudy }, input.project_ref, key);
  return { ...saved, evidence };
}
