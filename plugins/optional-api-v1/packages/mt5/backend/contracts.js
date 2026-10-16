import { digest, requireValue } from './support.js';
import { compileVisual } from './visual/index.js';

export const SDK_VERSION = '1.3.1';
export const TEMPLATE_VERSION = '2.0.0';
export const STRATEGY_MODULES = Object.freeze({
  signal: { file: 'Signal.mqh', modes: ['custom', 'native'] },
  money: { file: 'Money.mqh', modes: ['custom', 'native'] },
  position: { file: 'Position.mqh', modes: ['custom', 'native'] },
  trailing: { file: 'Trailing.mqh', modes: ['custom', 'native', 'disabled'] },
  risk: { file: 'Risk.mqh', modes: ['custom', 'disabled'] },
  expert: { file: 'Expert.mqh', modes: ['custom', 'native'] },
});
export const DEFAULT_RISK_LIMITS = Object.freeze({ max_risk_per_trade_pct: 0.5, max_daily_loss_pct: 2, max_open_positions: 1, max_lots: '1' });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(value);
const text = (value, max = 200) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const shape = (value, keys, label) => requireValue(object(value) && Object.keys(value).every(key => keys.includes(key)), `${label} 包含未知字段或格式无效`);

export function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function riskLimits(value) {
  shape(value, Object.keys(DEFAULT_RISK_LIMITS), '平台风险配置');
  for (const key of ['max_risk_per_trade_pct', 'max_daily_loss_pct']) requireValue(Number.isFinite(value[key]) && value[key] > 0 && value[key] <= 100, `${key} 必须在 0–100 之间`);
  requireValue(Number.isSafeInteger(value.max_open_positions) && value.max_open_positions > 0 && value.max_open_positions <= 10000, '持仓数上限无效');
  requireValue(typeof value.max_lots === 'string' && /^(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*)$/.test(value.max_lots) && value.max_lots.length <= 24 && Number.isFinite(Number(value.max_lots)), '手数上限必须为正十进制字符串');
  return structuredClone(value);
}

export function rulesDefinition(graph) {
  shape(graph, ['label', 'nodes', 'edges', 'state_machines'], '规则定义');
  requireValue(text(graph.label), '需要规则图名称');
  requireValue(Array.isArray(graph.nodes) && graph.nodes.length > 0 && graph.nodes.length <= 512, '规则图需要 1–512 个节点');
  requireValue(Array.isArray(graph.edges) && graph.edges.length <= 2048 && Array.isArray(graph.state_machines) && graph.state_machines.length <= 32, '规则图的边或状态机无效');
  const nodes = new Map(), incoming = new Map(), children = new Map();
  for (const node of graph.nodes) {
    shape(node, ['id', 'kind', 'label', 'operator', 'config'], '规则节点');
    requireValue(identifier(node.id) && !nodes.has(node.id) && text(node.label) && identifier(node.operator), '规则节点 ID/名称/算子无效或重复');
    requireValue(['input', 'compute', 'condition', 'all', 'any', 'not', 'action'].includes(node.kind) && object(node.config), '规则节点类型或配置无效');
    nodes.set(node.id, node); incoming.set(node.id, 0); children.set(node.id, []);
  }
  const edges = new Set(), inputs = new Set();
  for (const edge of graph.edges) {
    shape(edge, ['id', 'source_node_id', 'target_node_id', 'input_name'], '规则依赖边');
    requireValue(identifier(edge.id) && !edges.has(edge.id) && nodes.has(edge.source_node_id) && nodes.has(edge.target_node_id) && text(edge.input_name, 128), '规则边 ID 或引用无效');
    const input = `${edge.target_node_id}:${edge.input_name}`;
    requireValue(!inputs.has(input), '同一规则输入不能绑定多个来源');
    inputs.add(input); edges.add(edge.id);
    incoming.set(edge.target_node_id, incoming.get(edge.target_node_id) + 1);
    children.get(edge.source_node_id).push(edge.target_node_id);
  }
  for (const node of graph.nodes) {
    if (node.kind === 'not') requireValue(incoming.get(node.id) === 1, 'NOT 节点需要一个输入');
    if (['all', 'any'].includes(node.kind)) requireValue(incoming.get(node.id) >= 2, 'AND/OR 节点需要至少两个输入');
  }
  const degree = new Map(incoming), queue = [...degree].filter(([, value]) => value === 0).map(([key]) => key);
  let visited = 0;
  for (let index = 0; index < queue.length; index++) {
    visited++;
    for (const child of children.get(queue[index])) {
      degree.set(child, degree.get(child) - 1);
      if (degree.get(child) === 0) queue.push(child);
    }
  }
  requireValue(visited === nodes.size, '单次规则求值图不能有环；跨事件循环使用状态机');
  const machines = new Set();
  for (const machine of graph.state_machines) {
    shape(machine, ['id', 'label', 'initial_state', 'states', 'transitions'], '状态机');
    requireValue(identifier(machine.id) && !machines.has(machine.id) && text(machine.label), '状态机 ID/名称无效或重复');
    machines.add(machine.id);
    requireValue(Array.isArray(machine.states) && machine.states.length > 0 && machine.states.length <= 128 && Array.isArray(machine.transitions) && machine.transitions.length <= 512, '状态机大小无效');
    const states = new Set(), transitions = new Set();
    for (const state of machine.states) {
      shape(state, ['id', 'label'], '状态');
      requireValue(identifier(state.id) && !states.has(state.id) && text(state.label), '状态 ID/名称无效或重复');
      states.add(state.id);
    }
    requireValue(states.has(machine.initial_state), '状态机初始状态不存在');
    for (const transition of machine.transitions) {
      shape(transition, ['id', 'from_state', 'to_state', 'trigger', 'guard_node_id', 'action_node_ids'], '状态转移');
      requireValue(identifier(transition.id) && !transitions.has(transition.id) && states.has(transition.from_state) && states.has(transition.to_state) && text(transition.trigger, 128), '状态转移 ID、事件或前后状态无效');
      transitions.add(transition.id);
      requireValue(transition.guard_node_id === null || ['condition', 'all', 'any', 'not'].includes(nodes.get(transition.guard_node_id)?.kind), '状态转移守卫必须引用布尔条件节点');
      requireValue(Array.isArray(transition.action_node_ids) && new Set(transition.action_node_ids).size === transition.action_node_ids.length && transition.action_node_ids.every(key => nodes.get(key)?.kind === 'action'), '状态转移动作引用无效');
    }
  }
  requireValue(Buffer.byteLength(stableJSON(graph)) <= 512 * 1024, '规则定义超过 512 KiB');
  return structuredClone(graph);
}

function strategyContract(files, rules) {
  if (!Object.hasOwn(files, 'strategy.json')) return null; // Existing, pre-contract projects.
  let contract;
  try { contract = JSON.parse(files['strategy.json']); } catch { requireValue(false, 'strategy.json 必须是有效 JSON'); }
  shape(contract, ['template_version', 'modules'], '策略模块契约');
  requireValue(contract.template_version === TEMPLATE_VERSION, '策略模板版本不受支持');
  shape(contract.modules, Object.keys(STRATEGY_MODULES), '策略模块');
  const nodes = new Set(rules.nodes.filter(n => !n.id.startsWith('platform.')).map(n => n.id));
  const machines = new Set(rules.state_machines.map(m => m.id));
  requireValue([...machines].every(id => !id.startsWith('platform.')), 'platform. 状态机命名空间由平台保留');
  const claimedNodes = new Set(), claimedMachines = new Set();
  for (const [key, spec] of Object.entries(STRATEGY_MODULES)) {
    const module = contract.modules[key];
    shape(module, ['mode', 'description', 'node_ids', 'state_machine_ids'], `${key} 模块`);
    requireValue(Object.hasOwn(files, `Include/Strategy/${spec.file}`), `缺少 ${key} 模块文件 ${spec.file}`);
    requireValue(module.mode === 'unimplemented' || spec.modes.includes(module.mode), `${key} 模块不支持此实现方式`);
    requireValue(typeof module.description === 'string' && module.description.length <= 2000 && (module.mode === 'unimplemented' || module.description.trim()), `${key} 需要说明实现方案或停用原因`);
    for (const [field, available, claimed] of [['node_ids', nodes, claimedNodes], ['state_machine_ids', machines, claimedMachines]]) {
      requireValue(Array.isArray(module[field]) && module[field].every(id => available.has(id)), `${key}.${field} 必须引用实际的策略节点或状态机`);
      for (const id of module[field]) { requireValue(!claimed.has(id), `${id} 只能归属一个模块`); claimed.add(id); }
    }
    requireValue(module.mode !== 'disabled' || (!module.node_ids.length && !module.state_machine_ids.length), `${key} 停用时不应声明执行节点或状态机`);
    requireValue(module.mode !== 'custom' || module.node_ids.length > 0, `${key} 自定义实现需要声明可观测节点`);
  }
  requireValue(claimedNodes.size === nodes.size && claimedMachines.size === machines.size, '每个策略节点和状态机都需要声明所属模块');
  return structuredClone(contract);
}

// This is a declaration gate, not a proof that MQL implements the declared rules.
export function strategyImplementation(source) {
  if (!source.strategy_contract) return { status: 'legacy', pending_modules: [] };
  const pending = Object.entries(source.strategy_contract.modules).filter(([, module]) => module.mode === 'unimplemented').map(([key]) => key);
  return { status: pending.length ? 'draft' : source.engine ? 'checked' : 'declared', pending_modules: pending };
}

export function projectFiles(files) {
  requireValue(object(files) && Object.keys(files).length > 0 && Object.keys(files).length <= 128, '工程需要 1–128 个文本文件');
  const seen = new Set(); let bytes = 0;
  for (const [path, content] of Object.entries(files)) {
    requireValue(typeof content === 'string' && !content.includes('\0'), '工程仅接受文本文件');
    requireValue(path.length <= 220 && /^[A-Za-z0-9_. /-]+$/.test(path), '工程路径包含不支持的字符');
    const segments = path.split('/');
    requireValue(segments.every(segment => segment && segment !== '.' && segment !== '..' && !/[. ]$/.test(segment) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)), '工程路径无效或是 Windows 保留名称');
    requireValue(!seen.has(path.toLowerCase()), '工程路径在 Windows 下重名'); seen.add(path.toLowerCase());
    requireValue(/^Experts\/[A-Za-z0-9_ /-]+\.mq5$/.test(path) || /^Include\/Strategy\/[A-Za-z0-9_ /-]+\.mqh$/.test(path) || ['strategy.json', 'observability/rules.json', 'inputs/default.set', 'README.md'].includes(path), '文件必须位于策略目录；平台 SDK 不能由工程覆盖');
    bytes += Buffer.byteLength(content); requireValue(bytes <= 4 * 1024 * 1024 && Buffer.byteLength(content) <= 1024 * 1024, '工程文件大小超过限制');
  }
  if (files['strategy.json']) {
    let contract; try { contract = JSON.parse(files['strategy.json']); } catch { requireValue(false, 'strategy.json 必须是有效 JSON'); }
    if (contract.language || contract.template_version === '3.0.0') {
      const result = compileVisual(files);
      return { files: structuredClone(files), rules: rulesDefinition(result.rules), strategy_contract: result.strategy_contract, engine: result.engine, generated_source: result.generated, source_digest: digest(stableJSON(files)) };
    }
  }
  requireValue(Object.hasOwn(files, 'Experts/Strategy.mq5') && Object.hasOwn(files, 'observability/rules.json'), '工程缺少 Strategy.mq5 或规则定义');
  let graph;
  try { graph = JSON.parse(files['observability/rules.json']); } catch { requireValue(false, '规则定义必须是有效 JSON'); }
  const rules = rulesDefinition(graph);
  return { files: structuredClone(files), rules, strategy_contract: strategyContract(files, rules), source_digest: digest(stableJSON(files)) };
}

export function testerConfig(config) {
  shape(config, ['symbol', 'period', 'from_date', 'to_date', 'deposit', 'currency', 'leverage', 'model', 'parameters'], 'Tester 配置');
  requireValue(typeof config.symbol === 'string' && /^[A-Za-z0-9_.#-]{1,64}$/.test(config.symbol), 'Tester 品种无效');
  requireValue(['M1','M2','M3','M4','M5','M6','M10','M12','M15','M20','M30','H1','H2','H3','H4','H6','H8','H12','D1','W1','MN1'].includes(config.period), 'Tester 周期无效');
  for (const key of ['from_date', 'to_date']) requireValue(typeof config[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(config[key]) && !Number.isNaN(Date.parse(config[key])) && new Date(config[key]).toISOString().slice(0, 10) === config[key], 'Tester 日期无效');
  requireValue(config.from_date < config.to_date, 'Tester 结束日期必须晚于开始日期');
  requireValue(Number.isFinite(config.deposit) && config.deposit > 0 && config.deposit <= 1e10 && /^[A-Z]{3}$/.test(config.currency), 'Tester 资金配置无效');
  requireValue(Number.isSafeInteger(config.leverage) && config.leverage > 0 && config.leverage <= 1000 && [0,1,2,4].includes(config.model), 'Tester 杠杆或建模模式无效');
  requireValue(object(config.parameters) && Object.keys(config.parameters).length <= 100, 'Tester 参数必须为对象');
  for (const [name, value] of Object.entries(config.parameters)) requireValue(/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) && !name.startsWith('Product_') && ['number','string','boolean'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value)) && !/[\r\n\0|]/.test(String(value)) && String(value).length <= 256, 'Tester 参数无效或试图修改平台参数');
  return structuredClone(config);
}
