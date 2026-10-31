import { capability,currentTask,currentExecution } from './execution.js';
import { check } from '@sesame/plugin-sdk/protocol';
import { configuration } from './configuration.js';
import { historyCoverage, readAccountRows, sameConnection } from './execution-evidence.js';

export const tradingAccount = host => {
  const c = configuration(host);
  check(c.account_id && c.connection_id, 'Configure an existing QMT account first', 'PREREQUISITE_REQUIRED');
  return { accountId: c.account_id, connectionId: c.connection_id, revision: String(c.version) };
};
const sameAccount = (a, b) => a?.accountId === b.accountId && a?.connectionId === b.connectionId && a?.revision === b.revision;
export function verifyExecutionAuthorization(task, action, parameters) {
  const { authorization: _authorization, ...args } = parameters;
  if (!task) return args;
  if (task.input.execution) {
    const execution = task.input.execution, chain = currentExecution()?.provenance?.chain;
    const applyId = `${execution.pluginId}#${execution.applyTool.split('#').at(-1)}`;
    const apply = Array.isArray(chain) ? chain.findIndex(row => row.pluginId === execution.pluginId && row.capabilityId === applyId) : -1;
    check(apply > 0 && apply < chain.length - 1
      && chain.slice(0, apply).some(row => row.pluginId === task.pluginId)
      && chain.at(-1).pluginId === 'sesame/qmt' && chain.at(-1).capabilityId === `sesame/qmt#${action}`,
    'Execution requires a live workflow-to-execution invocation chain', 'FORBIDDEN');
    return args;
  }
  check(false, 'Execution requires a host-proven workflow invocation chain', 'FORBIDDEN');
}
export function assertTradingTask(host, account, write = false, identity = false) {
  if (host.context.kind === 'main') return null;
  const task = currentTask(), input = task?.input, plan = input?.tradingPlan;
  const execution = input?.execution;
  const composed = execution && execution.context?.backend === 'qmt' && typeof execution.pluginId === 'string'
    && typeof execution.applyTool === 'string' && typeof execution.contextTool === 'string'
    && sameAccount(execution.account, account) && sameAccount(execution.context.account, account);
  check(composed && task?.status === 'running' && task.conversationId === host.context.sessionId
    && typeof plan?.id === 'string' && plan.id.length > 0
    && typeof plan.ownerConversationId === 'string' && plan.ownerConversationId.length > 0
    && typeof input.runId === 'string' && input.runId.length > 0 && typeof input.role === 'string' && input.role.length > 0
    && (!write || input.role === 'executor'), 'Only an active task with a frozen matching execution contract may use this tool', 'FORBIDDEN');
  if (write) check(typeof plan.ownerConversationId === 'string' && plan.ownerConversationId.length > 0, 'Trading plan owner is required', 'FORBIDDEN');
  if (!identity || plan.account) check(sameAccount(plan.account, account), 'Trading plan account or configuration changed', 'ACCOUNT_MISMATCH');
  return task;
}

export function createTradingContext(host, service, { now = Date.now } = {}) {
  return async (args, signal) => {
    const account = tradingAccount(host); assertTradingTask(host, account, false, args.action === 'identity');
    if (args.action === 'identity') return { account };
    check(args.action === 'snapshot', 'Unsupported context action', 'INVALID_ARGUMENT');
    const days = args.history_days ?? 7;
    check(Number.isInteger(days) && days >= 1 && days <= 90, 'History days must be between 1 and 90', 'INVALID_ARGUMENT');
    const summary = await service.native('asset', {}, signal);
    check(sameConnection(summary, account), 'QMT asset connection changed', 'CONNECTION_CHANGED');
    check(summary.asset?.account_id === account.accountId, 'Native asset belongs to another account', 'ACCOUNT_MISMATCH');
    const assertCurrent = () => check(sameAccount(account, tradingAccount(host)), 'QMT configuration changed during the read', 'CONNECTION_CHANGED');
    const [positions, orders, fills] = await Promise.all(['positions', 'orders', 'fills'].map(action => readAccountRows(service, action, account, signal, assertCurrent)));
    assertCurrent();
    return { account, summary: summary.asset, positions, orders, fills, historicalOrders: [], deployments: [], capturedAt: now(), historyCoverage: historyCoverage(days) };
  };
}

export function createTradingCapabilities(host,service) {
const context=createTradingContext(host,service);
return [
    capability('qmt_trading_context', context),
    capability('qmt_trading_order', (args, signal) => service.command('order', args, signal, host.context, host)),
    capability('qmt_trading_cancel', (args, signal) => service.command('cancel', args, signal, host.context, host)),
    capability('qmt_trading_command', args => service.commandRecord(args.operation_id, host.context, host)),
  ];
}
