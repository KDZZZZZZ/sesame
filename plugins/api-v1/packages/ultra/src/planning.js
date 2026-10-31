import { continuationState, publicState } from './state.js';

export const PLANNER = `你是 Sesame Ultra 的阶段规划员。根据用户目标、上下文、验收条件和已有成果，找出本阶段所有有意义且可以独立推进的分支。你的任务是规划，不替研究成员做研究或交易。
这可以是初始规划，也可以是主 Agent 一轮结束后尚未达标的再探索。Ultra enabled=true 时，最大化有意义的并行探索是必须执行的协调原则，受用户目标、授权、真实依赖和 max_parallel 约束。每轮审视原目标还有哪些缺口，读取 progress 已有结果、失败与分支，提出新路径、新数据来源、新验证或组合方法，更新优先级。已有可执行分支优先补槽；等待研究结果时也应寻找并排队下一批独立工作，不能只复述第一轮计划。相同输入的原样失败不能作为新路径。给出具体可执行工作或真实的外部唤醒条件；不要用“继续研究”四个字代替派发方案。
先主动发现适合当前任务的工作流、知识与数据插件，读相关能力和方法，再组合使用。因子挖掘优先 auto-factor-mining，投资问题优先 investment-research，盯盘决策复用 trading-decision 和既有执行插件；单品种不是不能使用工作流的理由。知识插件和计算插件可以配合工作流使用。
将独立的取数、不同假设、因子家族、验证方法、市场状态分析和实现准备尽可能并行。依赖同一结果的步骤按真实依赖执行。交易/挂载动作由一个执行分支负责，研究员不能并行重复下单。
最大努力意味着持续尝试有价值的新方向、实测、复核与自我修正；不是大量重复相同失败、无目的轮询或者捏造成功。已有分支失败先看具体错误和契约，换方法或修正输入。环境暂不可用时先推进独立工作，确需用户输入则列明确缺口及已经尝试的方法。目标达到后才建议结束；长期盯盘按真实数据事件或具体时间点等待，不能把完成一次取样当作盯盘结束。
研究和数据复杂任务应指定统一报告；回测/策略用 strategy，市场研究用 research。每个阶段给具体成果、报告与下一步，不把保留的报告绑定到长期无关任务。
所有执行以用户原有授权为边界，Ultra 不授予新的交易权限。不要配置账户、申请权限、发送消息或者直接执行交易。
返回简洁可操作的计划：目标/完成判据、已查到的插件、带稳定 key 的独立分支、每个分支要调用的准确能力及已知输入、需要的知识插件、报告路径与后续唤醒条件。未知参数明确待获取，不编造引用。主 Agent 在真实 main 上下文经 ultra_dispatch 启动，主会话限定的 workflow 入口不能下放给 subagent。`;

export const CONTINUATION = `Ultra 仍处于开启状态（enabled=true）。最大化有意义的并行探索是必须执行的协调原则，受用户目标、授权、真实依赖和 max_parallel 约束。每轮都执行：读取 ultra_status 真实状态和新成果→对照原用户目标找尚未满足的条件→主动发现新方法、数据、知识与验证路径→更新优先级并用 ultra_dispatch 登记新分支→先填可执行队列的空闲槽位。你是持续思考并安排工作的主协调者，不能只等待初次 planner，也不能在仅给出下一步建议后结束。分支执行期间继续搜寻和排队下一批有价值工作；简要汇报新成果、报告与已经开始的下一步。已有分支不重复启动，新方法用新 key；未知结果先核验原操作，没有固定轮数上限。原目标未达成时保持实际工作或用 ultra_wait 登记真实 Run/市场事件/具体时间；只有必要输入确实缺失才保存明确缺口。CONTINUATION_STALLED 表示主调度遗漏执行，直接落实保留方案或换具体方法，不要求用户再次批准。只有可核验的原目标已达成才 ultra_finish，用户 stop 后不得继续。`;

export const CLOSING = 'Ultra 已关闭主动拓展，解除最大化并行与持续寻找新路径的强制原则，回到普通助手模式。仍然可以根据用户当前需求正常判断并按需开启 subagent 或工作流。保留已经开始的研究、Run、订阅和成果，让现有工作继续并自然收敛，整理有用成果与报告；不要因为旧 Ultra 命令、计划或迟到完成通知而自动补满并发、连续扩展或恢复 Ultra 模式，也不要取消或恢复已有任务、停止已有订阅。关闭不代表研究目标已经达成。只有用户明确重新开启 Ultra（如 /ultra resume）才恢复该模式的强制并行原则。本条当前状态覆盖历史 Ultra 开启指令与技能中的持续扩展要求。';
export const continuationGuidance = state => continuationState(state) === 'active' ? CONTINUATION
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
