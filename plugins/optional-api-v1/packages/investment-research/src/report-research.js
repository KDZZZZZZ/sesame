import { researchWorkflow } from './runtime.js';
import { check } from './workflow-mechanics.js';

export const REPORT_CASES = {
  auto: null, overview: 'R01', outlook: 'R02', event: 'R03', company: 'R04', briefing: 'R05',
  options: 'R06', portfolio: 'R07', forecast_review: 'R08', calendar: 'R09', custom: null,
};
export function researchBrief(value = {}) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_REPORT_BRIEF', 'report_brief must be an object.');
  check(Object.keys(value).every(key => ['case', 'template_id', 'sections', 'adjustments'].includes(key)), 'INVALID_REPORT_BRIEF', 'Only case, template_id, sections and adjustments belong to the result brief; select methods through research.');
  const kind = value.case ?? 'auto';
  check(Object.hasOwn(REPORT_CASES, kind), 'INVALID_REPORT_BRIEF', 'Select a declared research report case, or custom.');
  check(value.template_id === undefined || typeof value.template_id === 'string' && value.template_id.length > 0 && value.template_id.length <= 128, 'INVALID_REPORT_BRIEF', 'template_id is a result template ID, not an analysis method.');
  check(value.sections === undefined || Array.isArray(value.sections) && value.sections.length > 0 && value.sections.length <= 64 && value.sections.every(section => section && typeof section === 'object' && !Array.isArray(section)), 'INVALID_REPORT_BRIEF', 'sections must be a nonempty report_structure section list.');
  check(value.adjustments === undefined || typeof value.adjustments === 'string' && value.adjustments.length <= 12000, 'INVALID_REPORT_BRIEF', 'adjustments describes user-requested field, section or visual changes.');
  // Explicit sections replace the suggested composition. No methods are selected here.
  return { case: kind, ...(value.template_id ? {template_id:value.template_id} : value.sections === undefined && REPORT_CASES[kind] ? {template_id:REPORT_CASES[kind]} : {}),
    ...(value.sections === undefined ? {} : {sections:structuredClone(value.sections)}), adjustments:value.adjustments ?? '' };
}

export function reportResearchPlan(brief) {
  return { stages: [
    [{id:'scope',role:'custom',title:'需求与报告范围',instructions:'先理解用户要Agent判断什么、从哪些角度判断，在现有需求交接中形成精简判断任务单：用户决策/待回答问题、对象与期限、比较对象、用户指定角度与Agent补充角度（区分）、何种证据会改变判断。角度按问题表达，不预设结论或机械列指标。结合已有report_brief和用户裁剪；信息足够就说明合理假设继续，不重复问，只有无法合理推断且会改变目标的关键歧义才澄清。再调用 host_reports_describe 读取宿主所选报告插件的 inputSchema；仅当选中 sesame/reports 且接口适用时读取 report_structure，选择能承接这些判断的单模块、组合或自定义结果形式；用户明确字段优先。将所需证据、已有引用与缺口对应到判断问题；预测、规律和条件性建议要安排可比历史与后来结果的对照，明确需要的数据范围，不指定匹配算法。不新增强制API结构，不把模板当分析方法或必须填满的清单。此阶段不联网、不计算市场结论、不生成报告。'}],
    [{id:'evidence',role:'custom',title:'消息与数据取证',instructions:'按判断任务单复用固定证据，仅补会改变答案的具体缺口；每项材料说明服务哪项判断、能支持或区分什么解释，不按来源或指标数量堆资料。已知可靠入口直接获取，未知来源再搜索；优先无需配置，再考虑免费配置，付费按用户授权。使用已选来源、RSS/正文解析取得原文；摘要只选源。保留来源、发布时间、实际获取时间、历史可用性与覆盖；拒绝访问不是零消息。涉及预测、规律或条件性建议时，准备可比历史所需的价格、事件或其他实际数据及随后结果，不只给最新快照。优先同品种近期，再扩展同品种历史；确无合适样本才考虑可比品种，访问失败不算零匹配。条件由问题和已选方法明确，无法在本阶段确定时保留足够原始历史并交给分析成员选择，必要时接受定向补取。提供完整固定引用、观察期和实际获取时间，不扩大用户已裁剪的角度。'}],
    [{id:'analysis',role:'custom',title:'方法分析与历史参照',instructions:'回答判断任务单中的必要问题，已有清晰结论保留，只补缺失判断；将已有知识、证据和反例组织到对应判断下，共同对象与期限可以沿用，关键改判条件按需要说明，不逐项填满整套栏目。按本次问题选择并组合已授予的方法，复用前序固定数据，不以模板指定理论。技术分析可从互补流派寻找不同特征，同源指标不算独立支持。将理论解释与历史同类情景及实际后果相互检验。预测、规律和条件性建议即使不给概率，也要实际查找或复用适用历史结果；只描述近期行情或引用理论不算完成。先确定可观察条件和结果期限，再用已选能力比较实际后果、适用基准和反例。优先同一品种近期，再看同品种历史；没有符合的同品种样本且可比性明确时才扩大到其他品种。已选择 historical-evidence 时可用 historical_evidence_from_ref 读取前序固定单行输入包；inline计算只消费传入行，不解引用。用户优先确定特征、规则、阈值与条件组；冻结计划，核对特征与regime当时可知、结果已到期，不能按结果挑特征或匹配。分别保留各条件的样本、距离/规则、目标窗口、基线、反例、重叠、缺失与降级。经验频率不能冒充校准概率；校准须使用原固定预测和后来标签，过去拟合、后续分离评价，不在fit样本上评价。prospective只用于真实提前固定的原计划；今天选方法或旧选择未知则用exploratory和真实冻结时间，禁止回填虚构旧日期。匹配结果只可用query.at前已知后果，当前预测不能复用历史记录ID。没有独立校准证据时保留定性或经验结论。已知有效/失效条件可以支持条件使用，无需所有检验同时通过；明确conditions、counterevidence、monitoring及何时改判。关键历史输入缺失但仍可取得时，向取证成员定向补问，不直接交付一项待办。确实无法取得时保留尝试、具体限制及仍有依据的定性判断；不虚构样本或置信度。将可画图的逐次结果、分布和基准数据连同固定引用交给报告阶段，不只交一段总结。逐项交接判断、简短推理、适用历史参照及其检索/可用状态和固定结果引用；确定性比较或用户偏好说明历史不适用，不为凑证据编概率。完整因果证明不是形成有依据倾向的前提；用户裁剪优先，不强制每个任务预测行情。'}],
    [{id:'synthesis',role:'manager',title:'Research 报告',instructions:`依据判断任务单补齐必要结论；本轮结果意图为 ${brief.case}。开头直接给总体结论，各节用结论标题组织原有图表和短理由。已有清晰结论、分析和风格保持，共同对象与期限只交代一次，重要条件与历史数字就近保留；不逐项补齐整套栏目，不在摘要、卡片和图注反复复述。事实与图表服务判断；保留不同角度和期限的真实分歧，策略说明条件适用、失效和取舍，不要求全部检验通过才回答。先 host_reports_describe，再按返回的插件 inputSchema 通过 host_reports_publish 发布；宿主不内置 content/style 格式。默认 sesame/reports 适用时使用 report_structure/report_compose 预览或选择组件；用户增删角度、字段、模块和视觉的要求优先，不补回用户裁剪项，不复制字段解释或固定分析算法。先检查重要预测、规律与条件性建议是否带有实际历史对照；可解决的缺口定向交回原成员补齐，未检索不能当完成验证。确有能力或覆盖限制时简述限制，保留受支持的判断。定量证据优先用已选报告插件的内置图：价格路径、对象比较、历史结果分布及基准差异分别选择合适图型；主要图与实际样本数、结果留在对应判断旁，不全部塞入附录。无框布局；无合适数据时用精简文字与数字，不规定图数，不为凑图编数据。正文保留判断、读图注解与简短推理。综合预测仅在适用时保留最终情景树，历史参照说明支持范围；不强制所有问题预测行情或给概率。内部来源类型与路由标注不逐项展示，必要来源保持可追溯。只呈现取得的证据，不为填模板补造数据。发布到绑定的 Research 位置并核验精确修订。`}],
  ], synthesis:'synthesis' };
}

export async function startReportResearch(host, input, signal, execution) {
  check(execution?.task?.output?.type === 'report', 'REPORT_OUTPUT_REQUIRED', 'Research delivery requires task.output:{type:"report",space:"research",path:"...html"}. Use analyze only for an intentional internal data handoff.');
  const brief = researchBrief(input.report_brief);
  const normalized = { ...input, report_brief:brief, workflow:input.workflow ?? reportResearchPlan(brief),
    ...(!input.workflow ? {workflow_profile:'report-research/1'} : {}) };
  return researchWorkflow(host, normalized, signal, execution, 'analyze');
}
