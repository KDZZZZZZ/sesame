import { OPERATORS, SUPPORTED_VERSIONS, graph } from '@sesame/plugin-sdk/svl';
import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { requireValue } from './support.js';

const versions = ['1.0.0', '1.1.0', '1.2.0'];
const events = ['tick', 'bar.updated', 'bar.closed', 'timer', 'order.updated', 'fill', 'recovery', 'external.input'];
const requirements = op => op.startsWith('calendar.') || op.startsWith('time.') ? ['explicit_clock_and_calendar_binding']
  : op.startsWith('series.') ? ['ordered_available_inputs', 'readiness_and_window_alignment']
    : op.startsWith('array.') || op === 'function.call' ? ['bounded_typed_calls', 'function_and_iteration_trace']
      : op.startsWith('account.') || op.startsWith('order.') ? ['owned_positions_orders_and_pending_intents', 'native_order_lifecycle']
        : op.startsWith('math.') || op.startsWith('compare.') ? ['decimal34_binary64_tolerance', 'exact_branch_decisions'] : ['missing_and_atomic_event_semantics'];

// These are admission capabilities for an Agent-authored implementation, not a
// claim that MQL5 natively implements SVL. Each immutable translation is unverified
// until its own native fixture evidence is checked by the conformance tool.
export function svlCapabilities() {
  return {
    versions: versions.filter(version => SUPPORTED_VERSIONS.includes(version)),
    operators: [], automaticOperators: [], events, extensions: [],
    operatorCapabilities: Object.fromEntries(Object.entries(OPERATORS).filter(([, op]) => versions.includes(op.version)).map(([id, op]) => [id, {
      version: op.version, support: 'software', implementation: 'agent-authored-mql5', verification: 'per-translation-native-fixture', requirements: requirements(id),
    }])),
    extensionPolicy: { format: 'frozen-pure-function-module', support: 'software', arbitraryCode: 'unsupported', verification: 'all-expanded-functions-mapped-and-tested' },
    eventCapabilities: Object.fromEntries(events.map(id => [id, { support: ['tick', 'timer', 'order.updated', 'fill'].includes(id) ? 'native' : 'software', ...(id === 'external.input' ? { adaptation: 'EXTERNAL_INPUT_BRIDGE', requirements: ['frozen_secret_free_configuration', 'actual_availability_and_expiry', 'halt_new_risk_on_failure', 'native_timeline_conformance'] } : {}) }])),
  };
}

export const sourceNodeKey = entry => canonical([entry.functionId ?? null, entry.nodeId]);
export const sourceRuleId = entry => entry.functionId ? `function.${digest([entry.functionId, entry.nodeId]).slice(7, 31)}` : entry.nodeId;
export function sourceNodes(source) {
  const view = graph(source);
  return [
    ...view.nodes.map(node => ({ nodeId: node.id, op: node.operator })),
    ...(view.functions ?? []).flatMap(fn => fn.nodes.map(node => ({ nodeId: node.id, functionId: fn.id, op: node.operator }))),
  ];
}

export function assertTargetCapabilities(source, target) {
  requireValue(Array.isArray(target.svl?.versions) && target.svl.versions.includes(source.schemaVersion), '固定 MT5 目标不支持此 SVL 语言版本；不能静默降级', 422, 'UNSUPPORTED_CAPABILITY');
  const nodes = sourceNodes(source), capabilities = target.svl.operatorCapabilities;
  // Previously frozen 1.0 targets had no per-operator matrix. Their original
  // semantics remain usable; a newer source cannot use that legacy exception.
  requireValue(capabilities || source.schemaVersion === '1.0.0', '新版 SVL 目标必须声明逐原语翻译能力', 422, 'UNSUPPORTED_CAPABILITY');
  if (capabilities) for (const node of nodes) requireValue(['native', 'software'].includes(capabilities[node.op]?.support), `MT5 目标未声明原语 ${node.op} 的实现路径`, 422, 'UNSUPPORTED_CAPABILITY');
  requireValue(source.handlers.every(handler => target.svl.events?.includes(handler.event.type)), 'MT5 目标不支持此原生事件；冻结 fixture 的注入不能代替实时事件桥', 422, 'UNSUPPORTED_CAPABILITY');
  if (source.extensions?.length) requireValue(target.svl.extensionPolicy?.format === 'frozen-pure-function-module' && target.svl.extensionPolicy.support === 'software', 'MT5 目标未声明冻结纯函数模块翻译能力', 422, 'UNSUPPORTED_CAPABILITY');
  return { languageVersion: source.schemaVersion, operators: [...new Set(nodes.map(node => node.op))], extensions: (source.extensions ?? []).map(({ id, version, digest }) => ({ id, version, digest })), implementation: 'agent-authored', verification: 'not_run' };
}

export function executionCapabilities() {
  return {
    protocol: 'sesame.execution/1', dispatch: 'unsupported',
    features: { marketOrder: 'native', limitOrder: 'native', stopOrder: 'native', stopLimitOrder: 'native', modifyOrder: 'native', cancelOrder: 'native', netPosition: 'software', hedgedPosition: 'native', reduceOnly: 'software', bracket: 'software', oco: 'software', ocoQuantityReduction: 'software', trailingStop: 'software', reversal: 'software', parentFillActivation: 'software', restartReconciliation: 'software' },
    qualification: ['Static support is conditional on account mode, broker symbol/order rules and fresh runtime capabilities.', 'Software features require an explicit tested planner and persistent request ledger; this plugin does not silently emulate them.', 'The conformance tool observes fixture telemetry only and never dispatches a generic execution program.'],
  };
}
