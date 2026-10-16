import { capability,currentTask,currentExecution } from './execution.js';
import { check } from '@sesame/plugin-sdk/protocol';
import { configuration } from './configuration.js';

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
    const summary = await service.native('asset', {}, signal);
    check(summary.asset?.account_id === account.accountId, 'Native asset belongs to another account', 'ACCOUNT_MISMATCH');
    async function all(action) {
      let cursor, rows = [];
      do {
        const result = await service.native(action, { page: { limit: 200, ...(cursor ? { cursor } : {}) } }, signal);
        check(result.connection?.id === account.connectionId && result.connection.revision === account.revision && Array.isArray(result.items), 'Incomplete or changed QMT snapshot', 'CONNECTION_CHANGED');
        rows.push(...result.items); cursor = result.nextCursor;
        check(rows.length <= 20000, 'QMT account snapshot exceeds budget', 'RESOURCE_EXHAUSTED');
      } while (cursor);
      return rows;
    }
    const [positions, orders, fills] = await Promise.all(['positions', 'orders', 'fills'].map(all));
    check(sameAccount(account, tradingAccount(host)), 'QMT configuration changed during the read', 'CONNECTION_CHANGED');
    return { account, summary: summary.asset, positions, orders, fills, deployments: [], capturedAt: now(),
      historyCoverage: { scope: 'current_native_trading_day', complete: false, requestedDays: args.history_days ?? 7,
        limitations: ['XtQuant orders and fills are current-day only; no historical ledger or managed EA mounts are provided.'] } };
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
