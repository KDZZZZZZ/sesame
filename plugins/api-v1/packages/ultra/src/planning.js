import { continuationState, publicState } from './state.js';

export const PLANNER = `你是 Sesame Ultra 的阶段规划员。根据用户目标、上下文、验收条件和已有成果，规划一批**高并行、高信噪比、互不重叠**的可直接派发分支；你不替成员亲自执行研究或下单。
Ultra enabled=true 时，在授权、真实依赖和 max_parallel 约束下，尽可能充分利用并发槽位并行推进多条正交高价值路线（不同品种、不同周期、不同策略族、不同假设、独立数据源与验证方法），不断档、不保守串行。但严格守住分支质量：
1. 绝不重复已核实的平台/账户规则或相同输入的原样失败；绝不为单一已读网页或影响风险 <10% 的次要费用细节单独派发多轮爬虫分支。
2. 派发任何需要读取大网页/文本的分支时，在计划中明确要求授予 extract_webpage 或解析工具，避免盲读字节。
3. **交易/考核目标优先执行闭环**：先确保执行通道与随单风控（supportsAttachedStops）已核清；其余并发槽位用于并行筛选高胜率/高盈亏比的可执行标的与独立风控校核，每条候选分支必须带明确触发价、止损止盈与足够长的自然有效期；**交易目标不为每个筛选阶段要求完整 HTML 报告**（改为交易后/日终合并），防止排版阻塞入场窗口。
4. 纯研究/因子/策略开发阶段优先复用现成工作流（auto-factor-mining、investment-research、strategy-development），并在综合分支指定统一报告路径（research/strategy）。
5. 所有执行严守用户已有授权，不扩大权限、不重问已有授权。
返回简洁可操作的计划：目标与硬验收判据、本批带稳定 key 的正交并行分支（精确能力名、精简输入与必配工具、知识包、时效或报告绑定）以及后续唤醒条件。禁止把长篇原始数据或完整 JSON 塞进计划摘要。`;

export const CONTINUATION = `Ultra 处于开启状态（enabled=true）。继续高并行、高质量推进：先直接利用最新完成通知与已有结果对照用户目标找出剩余关键缺口，仅在状态不清或上下文刚压缩时才调 ultra_status。保持高并发吞吐，优先用 ultra_dispatch 补满高价值正交分支（拒绝重复核验、低价值细节深挖或相同失败重试）；交易目标下优先推进具备有效窗口的执行分支，不让报告排版阻塞下单，并将 ultra_wait / 状态记账与业务调用同轮合批。精简 context 与 summary，仅保留短结论与引用 ID。遇到 CONTINUATION_STALLED 直接落实或替换路径，不重问已有授权；目标有可验证完成证据时调用 ultra_finish。`;

export const CLOSING = 'Ultra 已关闭主动拓展，解除最大化并行与持续寻找新路径的强制原则，回到普通助手模式。仍然可以根据用户当前需求正常判断并按需开启 subagent 或工作流。保留已经开始的研究、Run、订阅和成果，让现有工作继续并自然收敛，整理有用成果与报告；不要因为旧 Ultra 命令、计划或迟到完成通知而自动补满并发、连续扩展或恢复 Ultra 模式，也不要取消或恢复已有任务、停止已有订阅。关闭不代表研究目标已经达成。只有用户明确重新开启 Ultra（如 /ultra resume）才恢复该模式的强制并行原则。本条当前状态覆盖历史 Ultra 开启指令与技能中的持续扩展要求。';
export const continuationGuidance = state => state.replacedBy ? `这条通知属于已替换的旧目标。其成果只归原任务，请继续当前目标 ${state.replacedBy}，不恢复旧目标或重复派发。`
  : continuationState(state) === 'active' ? CONTINUATION
  : state.status === 'completed' ? 'Ultra 目标已有实际完成证据，汇报成果；不要从旧完成通知自动重开原目标。'
  : ['stopping', 'stopped'].includes(state.status) ? '用户已明确硬停止 Ultra 工作，不得从旧计划或完成通知恢复原任务。'
  : CLOSING;

export async function plannerRequest(host, state, jobs = []) {
  const available = [], wanted = [
    { pluginId: 'sesame/plugin-manager', capabilityId: 'plugin_discover' },
    { pluginId: 'sesame/plugin-manager', capabilityId: 'plugin_read' },
    { pluginId: 'host', capabilityId: 'capabilities.list' },
  ];
  for (const call of wanted) {
    const id = call.pluginId === 'host' ? `host.${call.capabilityId}` : `${call.pluginId}#${call.capabilityId}`;
    const page = await host.capabilities.list({ ids: [id] }); if (page.items.some(item => item.id === id)) available.push(call);
  }
  const catalog = []; let cursor;
  do { const page = await host.plugins.search({ limit: 100, ...(cursor ? { cursor } : {}) }); catalog.push(...page.items.map(item => ({ id: item.id, title: item.title, description: item.description, state: item.state }))); cursor = page.nextCursor; } while (cursor);
  return { title: `Ultra · ${state.objective.slice(0, 90)}`, objective: '给主 Agent 一份可立即派发的并行计划与可核验完成判据。', instructions: PLANNER,
    input: { goal: state.objective, context: state.context, mode: state.mode, success_criteria: state.successCriteria, preferred_plugins: state.plugins,
      progress: publicState(state, jobs), previous_plan: (state.summary ?? '').slice(0, 12000), observation: state.lastObservation ?? null, catalog },
    allowedCalls: available, plugins: state.plugins, output: { type: 'none' } };
}
