import { readFileSync } from 'node:fs';

const groups = [
  ['M01', 'M02', 'M03', 'M04'],
  ['M05', 'M06', 'M07', 'M08'],
  ['M09', 'M10', 'M11', 'M12'],
  ['M13', 'M14', 'M15', 'M16'],
  ['M17', 'M18', 'M19'],
];
const files = Object.fromEntries(groups.flatMap(ids => ids.map(id => [id, `templates/field-guide-${ids[0]}-${ids.at(-1)}.json`])));
const cache = new Map();
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Small shared rules. Detailed field semantics are loaded only when selected. */
export const reportGuidance = freeze({
  schemaVersion: 1,
  purpose: '模板只约定结果含义和建议显示，不是必做分析清单，也不会运行研究、优化、回测或执行交易。',
  judgment_brief: '研究之前先明确用户需要Agent判断什么、从哪些角度判断：记录用户决策或问题、对象与期限、比较对象/备选、用户指定角度与Agent补充角度、什么证据会改变判断。信息足够就合理假设并继续，不把这变成反复询问的表格。依据这些问题选择取证和方法，不按现成数据或模板顺序盲目展开。',
  template_alignment: '对齐TC等参考模板，是对齐各字段所分析的问题和含义。逐项使用tc_alignment的字段对应，已有同义分析保留，缺项补必要结论，含义偏移则修正；通用总判断不能替代各字段的问题。新闻情绪、价格影响、关注程度分别回答；技术判断期限不等于K线周期。方法、图表和用户删改保持自由。参考没有直接对应的内容明确属于本产品扩展，不以相似标题冒充对齐，也不为对齐额外开展无关研究。',
  result_coverage: '默认模板有建议承担的判断职责。按用户问题选择后，保留已有清晰结论，只补缺失的必要结论；把相关分析和图表放到对应判断下，不以一句总评包办不同问题，也不为每项补一整套栏目。对象和期限相同时可以共用说明，关键条件与历史数字在影响判断时就近保留。判断任务单对照正文核查：已回答、具体缺口或用户明确删减；只是Agent裁剪sections不能等同用户放弃问题。',
  customization: '用户可删改、重排、拼接模块和字段，或自建章节；用户明示约定优先。修改 meaning/type 后不沿用默认字段指导。输入中的子项仅是语义提示，不增加必填 schema 或固定理论。',
  method_and_knowledge: '方法和知识可以按任务自由组合，不指定供应商、理论、公式、指标集、权重或优化器。用 method_ref 记录实际执行的方法，用 theory_refs 记录实际使用的知识。方法不可用时说明缺口，不为填字段静默换方法或新造统计。',
  interpretation: '区分观察事实、知识假说、历史统计、模拟结果和预测；公允价值、模型目标与分析师共识分别表达；历史条件频率、预测概率、预测置信度与供应商证据量评分分别表达。',
  judgment: '用户需要回答的分析问题应直接给出明确判断或有依据的倾向；相邻分析字段可以共同支撑一个判断，不为每个数字另造结论。优先说明什么关系更可能成立、什么解释更有力、何时有效；不能只列数值、两面可能、否定或继续观察。判断回应方向、强弱、风险、贵便宜、适用条件等，日期和来源保持事实。未严格证明因果不等于没有因果，未找到普遍规律不等于没有条件性规律；结合机制与历史实际结果判断，不把相关性当作因果证明，也不用这句话替代分析。信息不全时先说已能支持的判断及范围，再说具体未知；不能编造倾向、概率或中性结论。定性倾向不等于历史支持的置信度。',
  writing: '开头直接给总体结论，通常1–3句即可；下面按必要判断展开，用表达结论的小标题连接已有图表和短理由。已有清晰结论、分析、图表和风格保持，只补缺失结论和必要衔接；摘要、卡片与图注不重复同一话。用普通读者能懂的话，不搬研究或开发术语；完整来源与方法在末尾附录，重要结论、数据和条件仍就近可见。这是行文建议，不是字数或必填栏目规则；用户调整优先。',
  appendix: '正文保留判断、主要 K 线/热力图/统计图、关键数字、精简读图说明、推理步骤与影响决策的条件。来源、真实原始数据、样本清单、复核计算、参数和完整方法细节统一集中在报告末尾可折叠附录；正文只留小锚点，点击展开对应附录并可返回。不要把主图或全部指标移入附录，不改变研究方法、数据或结果。 用户可调整布局；自定义证据用 data-report-evidence 标记，交互控制用 data-report-disclosure=controls；data-report-evidence-layout=inline 明确保留原位。',
  lineage: '字段的 lineage 只说明 Agent 内部的结果来源性质，不显示获取、计算、推断徽章。获取方式与内容性质分开：取得外部预测不等于取得事实；公式计算不等于行情推断。实际结果可声明 origin；不能把建议分类冒充执行事实。插件覆盖另行审查，不成为模板指定方法。缺少声明仅列入内部 lineageAudit，不替研究者猜来源。',
  reasoning: '推断用 reasoning 记录精简观察、推导、判断及历史参照状态。知识假说与同类样本相互核对；对应历史结果为 linked，未检索为 pending，无法取得为 unavailable。确定性复算或用户偏好可为 not_applicable 并说明原因，行情预测不能免除历史参照；不为填过程制造概率。报告只显示这些业务依据，不显示插件覆盖、来源分类或内部审计。',
  unit_time: '每个值保留单位、原尺度、对象、观察/目标期间和数据截点；观察、首次可得、发布修订、获取和报告生成时间不能互代。回看历史只用当时可得信息；不同币种、财期、期限、分母与来源尺度先说明可比性。',
  missing: '只填已提供的真实成果。已知零值/false/空集合与未知不同；无结果使用 unavailable/pending/not_applicable 加原因并省略 value 或用 null。可选字段可省略，用户删除字段不补回；不填 0、50% 或中性标签代替缺失。',
  historical: {
    requirement: '行情预测或可检验推断应有历史相同或可比情景的实际后续结果；知识假说与历史统计、基准和反例对照。概率、分布、置信度及逐项推断使用各自的 method_ref、historical_basis 与真实 validation；综合结论另有联合方法历史检验。',
    sampling: '历史结果保留品种、近期窗口、已有检索范围与状态、数量和固定成果。用户默认偏好当前品种近期同类样本；跨品种结果应附同品种检索已完成且零匹配的记录及可比性说明。未检索、检索不可用、样本少都不等于零匹配。用户明确覆盖时保存 override_reason；这些是结果来源语义，不要求 Report 执行检索或规定研究步骤。',
    limits: '保留匹配/排除、已结算/待结算数量、重叠与有效样本、基准、区间含义、可得性和验证范围。没有可比已结算结果时用 unavailable/pending，不造概率或自评置信度；固定引用和字段齐全不等于研究有效。',
  },
  evidence: '固定数据引用放结果行 evidence_refs；保留完整 id/revision/digest/kind/schemaVersion。图表只呈现方法已有成果，不自行计算指标、合成分数、插值成实测或选出新参数。',
  knowledge: {
    entry: 'skills/report-writing/field-guide.md',
    by_module: files,
    reading: '先读本次所选字段的 agent_guidance。仅在需要更多字段时按模块读取对应分片，避免把全部字段灌入默认 prompt。',
  },
});

export const guidance = reportGuidance;

// These are writing expectations, not a scoring method or a content schema.
const judgmentByNature = {
  metadata: '保留真实对象、日期、单位和来源，不为背景信息编造倾向；影响判断的含义就近放入对应分析项。',
  fact: '保留事实原值；作为分析依据呈现时，说清它支持哪项判断或倾向，不把已发生事实直接改写成未来预测。',
  statistic: '数值旁说明与实际基准或比较对象相比意味着什么，给出明确判断或倾向；缺少比较依据时不擅定高低阈值。',
  interpretation: '先回答该项问题，最少给出明确倾向，再列关键依据与改变判断的条件；有冲突时说明目前更支持哪边及原因。',
  prediction: '先给目标期限内明确判断或倾向，关联该项历史实际结果与失效条件；倾向与置信度分开，没有概率依据就不填概率。',
  plan: '明确倾向采用、暂缓或仅在什么条件下使用，并说明依据和停用条件；可有条件使用，不要求通过所有检验，不把建议写成已执行。',
  mixed: '每项分析内容先给明确判断或倾向，再给依据及改变判断的条件；原始事实保留原义，多项内容不可共用一句含糊总评。',
};

/**
 * Return a detached, agent-readable semantic guide for one suggested field.
 * A field definition may be passed so changed meaning/type cannot silently
 * inherit the original guide. Other display changes retain its semantics.
 * Unknown/custom fields intentionally return null, never a type-only fallback.
 */
export function fieldGuidance(moduleId, field) {
  const key = typeof field === 'string' ? field : field?.key;
  if (typeof moduleId !== 'string' || !Object.hasOwn(files, moduleId) || typeof key !== 'string') return null;
  const path = files[moduleId];
  if (!cache.has(path)) {
    const data = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
    if (data.schemaVersion !== 1 || !data.modules) throw new Error(`Unsupported report field guidance: ${path}`);
    cache.set(path, data);
  }
  const fields = cache.get(path).modules[moduleId]?.fields;
  if (!fields || !Object.hasOwn(fields, key)) return null;
  const entry = fields[key];
  if (typeof field === 'object' && field !== null
      && (field.type !== undefined && field.type !== entry.type
        || field.meaning !== undefined && field.meaning !== entry.catalog_meaning)) return null;
  const { type, catalog_meaning, ...semantics } = entry;
  // The user may keep the business meaning while changing the chart contract.
  // Do not return stale column or evidence-role suggestions in that case.
  if (field?.chart) {
    semantics.chart = { kind: field.chart.kind, columns: field.chart.columns, evidence_role: field.chart.evidence_role };
    if (['historical', 'prediction'].includes(field.chart.evidence_role) && !semantics.historical) semantics.historical = reportGuidance.historical;
  }
  return structuredClone({ ...semantics, judgment: judgmentByNature[semantics.lineage.nature], source: `${path}#${moduleId}.${key}` });
}
