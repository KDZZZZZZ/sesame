import { capability } from '@sesame/plugin-sdk/capabilities';
import { records } from '../backend/records.js';
import { randomUUID } from 'node:crypto';
import { digest } from '@sesame/plugin-sdk/protocol';
import { requireValue } from '../backend/support.js';
import { pythonEnvelope } from '../backend/execution-evidence.js';

export function assertTradingTask(host, account, write = false, identity = false, executionContext) {
  if (host.context.kind === 'main') return null;
  const agent = executionContext?.provenance?.agent;
  const task = agent ? { ...agent, id: agent.taskId, conversationId: agent.sessionId } : null, input = task?.input, plan = input?.tradingPlan;
  const execution = input?.execution;
  const composed = execution && execution.context?.backend === 'mt5' && typeof execution.pluginId === 'string'
    && typeof execution.applyTool === 'string' && typeof execution.contextTool === 'string'
    && sameAccount(execution.account, account) && sameAccount(execution.context.account, account);
  requireValue(composed && task?.status === 'running'
    && task.conversationId === host.context.sessionId && typeof plan?.id === 'string' && plan.id.length > 0
    && typeof plan.ownerConversationId === 'string' && plan.ownerConversationId.length > 0
    && typeof input.runId === 'string' && input.runId.length > 0
    && typeof input.role === 'string' && input.role.length > 0 && (!write || input.role === 'executor'),
  'Only the main conversation or an active task with a frozen matching execution contract may use this tool', 403, 'FORBIDDEN');
  if (!identity || plan.account) requireValue(sameAccount(plan.account, account), 'Trading plan account or configuration changed', 409, 'ACCOUNT_MISMATCH');
  return task;
}
const sameAccount = (a, b) => a?.accountId === b.accountId && a?.server === b.server && a?.revision === b.revision;
const sameDomain = (a, b) => a?.accountId === b.accountId && a?.server === b.server;
export function verifyExecutionAuthorization(task, action, parameters, now = Date.now(), executionContext) {
  const { authorization: _authorization, ...args } = parameters;
  if (!task) return args;
  if (task.input.execution) {
    const execution = task.input.execution, chain = executionContext?.provenance?.chain;
    const applyId = `${execution.pluginId}#${execution.applyTool.split('#').at(-1)}`;
    const apply = Array.isArray(chain) ? chain.findIndex(row => row.pluginId === execution.pluginId && row.capabilityId === applyId) : -1;
    requireValue(apply > 0 && apply < chain.length - 1
      && chain.slice(0, apply).some(row => row.pluginId === task.pluginId)
      && chain.at(-1).pluginId === 'sesame/mt5' && chain.at(-1).capabilityId === `sesame/mt5#${action}`,
    'Execution requires a live workflow-to-execution invocation chain', 403, 'FORBIDDEN');
    return args;
  }
  requireValue(false, 'Execution requires a host-proven workflow invocation chain', 403, 'FORBIDDEN');
}
const accountOf = mt5 => {
  const settings = mt5.official.settings();
  requireValue(settings.account?.login && settings.account.server, 'Configure an existing MT5 account first', 409, 'PREREQUISITE_REQUIRED');
  return { accountId: String(settings.account.login), server: settings.account.server, revision: String(settings.version) };
};

export function createTradingContext(host, mt5, { now = Date.now } = {}) {
  const assertCurrent = account => requireValue(sameAccount(account, accountOf(mt5)), 'MT5 account configuration changed during the operation', 409, 'CONNECTION_CHANGED');
  async function read(tool, args, signal, account) {
    signal?.throwIfAborted();
    let result;
    try {
      result = await mt5.official.call({ server: 'python', tool, arguments: args, command_id: `trading-read-${randomUUID()}` }, host.context.sessionId, signal);
    } catch (error) {
      signal?.throwIfAborted();
      if (error.name === 'AbortError') throw error;
      error.details = { ...error.details, transport: 'python', requiredTransport: 'python', method: tool, commandId: null };
      throw error;
    }
    signal?.throwIfAborted(); assertCurrent(account);
    return pythonEnvelope(result, tool, null, value => mt5.official.redact(value)).result;
  }
  return {
    async context(args, signal, executionContext) {
      const account = accountOf(mt5); assertTradingTask(host, account, false, args.action === 'identity', executionContext);
      if (args.action === 'identity') return { account };
      requireValue(args.action === 'snapshot', 'Unsupported trading context action');
      const days = args.history_days ?? 7;
      requireValue(Number.isInteger(days) && days >= 1 && days <= 90, 'History days must be between 1 and 90');
      const to = now(), from = to - days * 86400000, range = { date_from: new Date(from).toISOString(), date_to: new Date(to).toISOString() };
      // Python already serializes native calls. Awaiting each observation avoids
      // queueing more reads after a disconnected channel or changed account.
      // Terminal MCP fields and broker-wall history are not this UTC/raw-Python contract.
      const summary = await read('account_info', {}, signal, account);
      requireValue(String(summary.login) === account.accountId && summary.server === account.server,
        'Native MT5 account differs from the configured account', 409, 'ACCOUNT_MISMATCH');
      const terminal = await read('terminal_info', {}, signal, account);
      requireValue(terminal.connected === true, 'MT5 Python terminal is not connected to its broker', 503, 'SOURCE_UNAVAILABLE');
      const lists = {};
      // No symbol/magic/comment filter: risk decisions see every position on this account.
      for (const [key, method, input] of [['positions', 'positions_get', {}], ['orders', 'orders_get', {}],
        ['fills', 'history_deals_get', range], ['historicalOrders', 'history_orders_get', range]]) {
        const value = await read(method, input, signal, account);
        requireValue(Array.isArray(value), `MT5 Python ${method} omitted its account rows`, 503, 'SOURCE_DATA_INVALID');
        lists[key] = value;
      }
      const { positions, orders, fills, historicalOrders } = lists;
      const deployments = mt5.deployments.list().filter(row => String(row.login) === account.accountId && row.server === account.server);
      return { account, summary, positions, orders, fills, historicalOrders, deployments,
        historyCoverage: { requestedFrom: from, requestedTo: to, scope: 'native_requested_range', complete: false,
          limitations: ['Broker-retained native history; availability does not prove all-history completeness.'] }, capturedAt: now() };
    },
    async pause(args, signal, executionContext) {
      const account = accountOf(mt5); const task = assertTradingTask(host, account, true, false, executionContext);
      verifyExecutionAuthorization(task, 'mt5_trading_pause', args, now(), executionContext);
      requireValue(sameAccount(args.account, account), 'Pause account or configuration changed', 409, 'ACCOUNT_MISMATCH');
      requireValue(typeof args.reason === 'string' && args.reason.trim() && args.reason.length <= 2000, 'A bounded risk reason is required');
      const deployment = mt5.deployments.list().find(row => row.id === args.deployment_id);
      requireValue(deployment && String(deployment.login) === account.accountId && deployment.server === account.server,
        'Deployment is not owned by the exact account', 409, 'ACCOUNT_MISMATCH');
      signal?.throwIfAborted();
      await mt5.market.connected(); assertCurrent(account); verifyExecutionAuthorization(assertTradingTask(host, account, true, false, executionContext), 'mt5_trading_pause', args, now(), executionContext);
      signal?.throwIfAborted();
      const receipt = await mt5.deployments.stop(deployment.id);
      return { account, deployment: receipt, run_record: mt5.runObserver?.reference('deployment', receipt.id) ?? null,
        requestedAction: 'pause', nativeAction: 'remove_expert', status: receipt.status, reason: args.reason,
        planId: task?.input.tradingPlan.id ?? null, runId: task?.input.runId ?? null, capturedAt: now(),
        limitation: 'Stops the EA without closing positions; there is no automatic resume or preserved runtime-state pause.' };
    },
    async order(parameters, signal, executionContext, authorizationAction = 'mt5_trading_order') {
      const account = accountOf(mt5), task = assertTradingTask(host, account, true, false, executionContext);
      const args = verifyExecutionAuthorization(task, authorizationAction, parameters, now(), executionContext);
      requireValue(args.server === 'python' && args.tool === 'order_send', 'Only the guarded Python order_send path is supported');
      requireValue(!task || args.arguments?.execution_guard || args.arguments?.cancellation_guard, 'Plan orders require a native final-mile guard');
      requireValue(!task || args.arguments?.cancellation_guard || Array.isArray(args.arguments?.execution_guard?.expected_positions), 'Plan execution requires a full symbol position expectation');
      const owner = task?.input.tradingPlan.ownerConversationId ?? host.context.sessionId;
      requireValue(typeof owner === 'string' && owner.length > 0, 'Trading plan owner is required', 403, 'FORBIDDEN');
      requireValue(typeof args.command_id === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(args.command_id), 'A stable command ID is required');
      const fingerprint = digest({ args, account, owner }), old = records(host).get('mt5_trading_commands', args.command_id, true);
      requireValue(!old || old.fingerprint === fingerprint && (!task || old.planId === task.input.tradingPlan.id && old.runId === task.input.runId && old.taskId === task.id), 'Command ID belongs to another signed intent', 409, 'IDEMPOTENCY_CONFLICT');
      signal?.throwIfAborted(); assertCurrent(account); verifyExecutionAuthorization(assertTradingTask(host, account, true, false, executionContext), authorizationAction, parameters, now(), executionContext);
      if (!old) records(host).put('mt5_trading_commands', { id: args.command_id, account, owner, fingerprint, planId: task?.input.tradingPlan.id ?? null, runId: task?.input.runId ?? null, taskId: task?.id ?? null, createdAt: now() });
      return mt5.official.call(args, owner, signal);
    },
    command(args, signal, executionContext) {
      const account = accountOf(mt5), task = assertTradingTask(host, account, false, false, executionContext);
      const row = records(host).get('mt5_trading_commands', args.command_id, true), owner = task?.input.tradingPlan.ownerConversationId ?? host.context.sessionId;
      requireValue(row && row.owner === owner && sameDomain(row.account, account) && (!task || row.planId === task.input.tradingPlan.id), 'Command is outside this owner and account', 403, 'FORBIDDEN');
      return mt5.official.command(args.command_id, owner);
    },
  };
}

export function createCapabilities(host, mt5) {
  const service = createTradingContext(host, mt5);
  return [
    capability('mt5_trading_context', (args, signal, executionContext) => service.context(args, signal, executionContext)),
    capability('mt5_trading_pause', (args, signal, executionContext) => service.pause(args, signal, executionContext)),
    capability('mt5_trading_order', (args, signal, executionContext) => service.order(args, signal, executionContext)),
    capability('mt5_trading_command', (args, signal, executionContext) => service.command(args, signal, executionContext)),
  ];
}
