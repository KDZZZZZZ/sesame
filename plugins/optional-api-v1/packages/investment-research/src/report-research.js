import { researchWorkflow } from './runtime.js';
import { check } from './workflow-mechanics.js';

export function researchBrief(value = {}) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_REPORT_BRIEF', 'report_brief must describe the research task.');
  const fields = ['objective', 'questions', 'method_ids', 'evidence_requirements', 'delivery'];
  check(Object.keys(value).every(key => fields.includes(key)), 'INVALID_REPORT_BRIEF', 'Use objective, questions, method_ids, evidence_requirements and delivery; report templates do not define the research task.');
  for (const key of ['objective', 'delivery']) {
    check(value[key] === undefined || typeof value[key] === 'string' && value[key].trim().length > 0 && value[key].length <= 12000,
      'INVALID_REPORT_BRIEF', `${key} must be nonempty text, at most 12000 characters.`);
  }
  for (const key of ['questions', 'method_ids', 'evidence_requirements']) {
    const limit = key === 'method_ids' ? 100 : 6000;
    check(value[key] === undefined || Array.isArray(value[key]) && value[key].length <= 64
      && value[key].every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= limit),
    'INVALID_REPORT_BRIEF', `${key} must contain at most 64 nonempty strings, each at most ${limit} characters.`);
  }
  return structuredClone(value);
}

export function reportResearchPlan() {
  return { stages: [
    [{ id:'scope', role:'custom', title:'明确研究问题', instructions:'沿用用户问题、report_brief 和已有证据，明确实际目标、必要问题、对象期限和会改变判断的证据，区分用户要求与合理研究假设。先用 research_methods 按任务发现方法，再用 research_read 读取最相关的方法或 report_brief.method_ids；这些 ID 指向研究方法，不是报告模板。采用贴近问题的调查与回答结构；未精确命中时参考相近结构适配，删去不相关问题，不能把全部建议变成必做。将证据缺口和已授权来源对应到问题，给后续成员交接精简调查计划与回答大纲，不规定图表或固定章节。信息足够就推进，只对无法合理推断且会改变目标的关键歧义澄清。本阶段复用已有材料和方法知识，不提前编造市场判断。' }],
    [{ id:'evidence', role:'custom', title:'取得关键证据', instructions:'按本次调查计划复用固定证据，仅补会改变答案的具体缺口。使用已授权来源与知识；已知可靠入口直接获取，未知入口通过已授权搜索发现并取得原文，摘要只用于选源。优先无需配置的可用来源；单一来源不可用时尝试本次授权内适合问题的替代渠道。保留来源、原始发布时间、观察期、实际获取时间、历史可用性与覆盖，拒绝访问不等于零结果。预测、规律或条件性建议需要适用历史及后来结果时，取得可核查、可计算、可画图的完整数据；真实缺失和未检索分别记录。按问题交接完整固定引用和仍有影响的缺口，不扩大用户裁剪的角度。' }],
    [{ id:'analysis', role:'custom', title:'研究与判断', instructions:'依据已选 Research 方法和专业知识逐项回答实际问题，复用已有数据与清晰判断。方法与回答结构随问题适配，不把全部检验或建议字段设为统一门槛。按需要检验机制、竞争解释、可比历史及实际结果；保持当时可知、样本选择、阈值冻结和评价分离，不将经验频率称为校准概率。prospective 只用于真实提前固定的原计划；今天选方法或历史选择未知时用 exploratory 和真实冻结时间，禁止回填虚构旧日期。匹配只使用 query.at 前已知结果，当前预测不能复用历史记录 ID。使用 historical-evidence 时由 historical_evidence_from_ref 读取固定单行输入，inline 只计算传入行。已知条件内的证据可以支持条件使用，无需所有检验同时通过。已授权安全来源和计算能力可用于具体缺口，也可向取证成员定向追问；不重复无新路径的失败。可解决的重要缺口应处理，确实不可取得时保留尝试与仍受支持的较窄判断。交接明确答案、关键依据、反例、改判条件和可视化所需完整固定数据；事实或确定性问题不强行追加预测、概率或不适用研究。' }],
    [{ id:'synthesis', role:'manager', title:'研究报告', instructions:'根据用户实际问题和上游回答大纲综合结论，保留真实分歧与有影响的条件；不按成员拼接，不补回用户删去的内容。研究方法决定调查充分性与内容结构；Reports 只负责统一视觉。先检查会影响答案且仍可解决的研究缺口，必要时向原成员定向核查。用 components_show({target:"report",content:{kind:"document",sections:[...]},...}) 将用户需要的文字与固定数据组件直接交付到已绑定报告；按需查询组件，不先套业务模板或生成 HTML。图表按数据关系选择，不固定图数、不自动增加附录、图注和方法说明。发布后核验精确修订，检查失败保留同一引用重试，不重跑研究。' }],
  ], synthesis:'synthesis' };
}

export async function startReportResearch(host, input, signal, execution) {
  check(execution?.task?.output?.type === 'report', 'REPORT_OUTPUT_REQUIRED', 'Research delivery requires task.output:{type:"report",space:"research",path:"...html"}. Use analyze only for an intentional internal data handoff.');
  const brief = researchBrief(input.report_brief);
  const normalized = { ...input, report_brief:brief, workflow:input.workflow ?? reportResearchPlan(),
    ...(!input.workflow ? {workflow_profile:'report-research/2'} : {}) };
  return researchWorkflow(host, normalized, signal, execution, 'analyze');
}
