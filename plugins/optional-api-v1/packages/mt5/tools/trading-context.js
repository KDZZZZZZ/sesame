import { randomUUID, createPublicKey, verify } from 'node:crypto';
import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { requireValue } from '../backend/support.js';

export function assertTradingTask(host, account, write = false, identity = false) {
  if (host.scope.kind === 'main') return null;
  const task = host.agents?.current(), input = task?.input, plan = input?.tradingPlan;
  requireValue(task?.pluginId === 'sesame/manual-trading' && task.status === 'running'
    && task.conversationId === host.scope.conversationId && typeof plan?.id === 'string' && plan.id.length > 0
    && plan.backend === 'mt5' && typeof input.runId === 'string' && input.runId.length > 0
    && typeof input.role === 'string' && input.role.length > 0 && (!write || input.role === 'executor'),
  'Only the main conversation or a matching manual-trading plan task may use this tool', 403, 'FORBIDDEN');
  if (!identity || plan.account) requireValue(sameAccount(plan.account, account), 'Trading plan account or configuration changed', 409, 'ACCOUNT_MISMATCH');
  return task;
}
const sameAccount = (a, b) => a?.accountId === b.accountId && a?.server === b.server && a?.revision === b.revision;
const sameDomain = (a, b) => a?.accountId === b.accountId && a?.server === b.server;
export function verifyExecutionAuthorization(task, action, parameters, now = Date.now()) {
  const { authorization, ...args } = parameters;
  if (!task) return args;
  let valid = false;
  try {
    const key = createPublicKey(task.input.executionPublicKey), signature = Buffer.from(authorization.signature, 'base64');
    valid = key.asymmetricKeyType === 'ed25519' && signature.length === 64 && signature.toString('base64') === authorization.signature
      && Number.isSafeInteger(authorization.expiresAt) && authorization.expiresAt > now && authorization.expiresAt - now <= 60000
      && verify(null, Buffer.from(canonical({ version: 1, taskId: task.id, runId: task.input.runId, action, args, expiresAt: authorization.expiresAt })), key, signature);
  } catch { /* Missing or malformed proof has no authority. */ }
  requireValue(valid, 'Execution requires an unexpired signed intent from the trading runtime', 403, 'FORBIDDEN');
  return args;
}
const accountOf = mt5 => {
  const settings = mt5.official.settings();
  requireValue(settings.account?.login && settings.account.server, 'Configure an existing MT5 account first', 409, 'PREREQUISITE_REQUIRED');
  return { accountId: String(settings.account.login), server: settings.account.server, revision: String(settings.version) };
};

export function createTradingContext(host, mt5, { now = Date.now } = {}) {
  const assertCurrent = account => requireValue(sameAccount(account, accountOf(mt5)), 'MT5 account configuration changed during the operation', 409, 'CONNECTION_CHANGED');
  async function read(tool, args, signal) {
    const result = await mt5.official.call({ server: 'python', tool, arguments: args, command_id: `trading-read-${randomUUID()}` }, host.scope.conversationId, signal);
    requireValue(result?.status === 'returned' && !result.result?.error && result.result?.result !== null && result.result?.result !== undefined,
      `MT5 ${tool} did not return a confirmed result`, 503, 'SOURCE_UNAVAILABLE');
    return result.result.result;
  }
  return {
    async context(args, signal) {
      const account = accountOf(mt5); assertTradingTask(host, account, false, args.action === 'identity');
      if (args.action === 'identity') return { account };
      requireValue(args.action === 'snapshot', 'Unsupported trading context action');
      const days = args.history_days ?? 7;
      requireValue(Number.isInteger(days) && days >= 1 && days <= 90, 'History days must be between 1 and 90');
      const to = now(), from = to - days * 86400000, range = { date_from: new Date(from).toISOString(), date_to: new Date(to).toISOString() };
      // No symbol/magic/comment filter: risk decisions see every position on this account.
      const [summary, terminal, positions, orders, fills, historicalOrders] = await Promise.all([
        read('account_info', {}, signal), read('terminal_info', {}, signal), read('positions_get', {}, signal), read('orders_get', {}, signal),
        read('history_deals_get', range, signal), read('history_orders_get', range, signal),
      ]);
      assertCurrent(account);
      requireValue(String(summary.login) === account.accountId && summary.server === account.server && terminal.connected === true,
        'Native MT5 account differs or is disconnected', 409, 'ACCOUNT_MISMATCH');
      requireValue([positions, orders, fills, historicalOrders].every(Array.isArray), 'Incomplete MT5 account snapshot', 503, 'SOURCE_DATA_INVALID');
      const deployments = mt5.deployments.list().filter(row => String(row.login) === account.accountId && row.server === account.server);
      return { account, summary, positions, orders, fills, historicalOrders, deployments,
        historyCoverage: { requestedFrom: from, requestedTo: to, scope: 'native_requested_range', complete: false,
          limitations: ['Broker-retained native history; availability does not prove all-history completeness.'] }, capturedAt: now() };
    },
    async pause(args, signal) {
      const account = accountOf(mt5); const task = assertTradingTask(host, account, true);
      verifyExecutionAuthorization(task, 'mt5_trading_pause', args, now());
      requireValue(sameAccount(args.account, account), 'Pause account or configuration changed', 409, 'ACCOUNT_MISMATCH');
      requireValue(typeof args.reason === 'string' && args.reason.trim() && args.reason.length <= 2000, 'A bounded risk reason is required');
      const deployment = mt5.deployments.list().find(row => row.id === args.deployment_id);
      requireValue(deployment && String(deployment.login) === account.accountId && deployment.server === account.server,
        'Deployment is not owned by the exact account', 409, 'ACCOUNT_MISMATCH');
      signal?.throwIfAborted();
      await mt5.market.connected(); assertCurrent(account); verifyExecutionAuthorization(assertTradingTask(host, account, true), 'mt5_trading_pause', args, now());
      signal?.throwIfAborted();
      const receipt = await mt5.deployments.stop(deployment.id);
      return { account, deployment: receipt, run_record: mt5.runObserver?.reference('deployment', receipt.id) ?? null,
        requestedAction: 'pause', nativeAction: 'remove_expert', status: receipt.status, reason: args.reason,
        planId: task?.input.tradingPlan.id ?? null, runId: task?.input.runId ?? null, capturedAt: now(),
        limitation: 'Stops the EA without closing positions; there is no automatic resume or preserved runtime-state pause.' };
    },
    async order(parameters, signal) {
      const account = accountOf(mt5), task = assertTradingTask(host, account, true);
      const args = verifyExecutionAuthorization(task, 'mt5_trading_order', parameters, now());
      requireValue(args.server === 'python' && args.tool === 'order_send', 'Only the guarded Python order_send path is supported');
      requireValue(!task || args.arguments?.execution_guard || args.arguments?.cancellation_guard, 'Plan orders require a native final-mile guard');
      requireValue(!task || args.arguments?.cancellation_guard || Array.isArray(args.arguments?.execution_guard?.expected_positions), 'Plan execution requires a full symbol position expectation');
      const owner = task?.input.tradingPlan.ownerConversationId ?? host.scope.conversationId;
      requireValue(typeof owner === 'string' && owner.length > 0, 'Trading plan owner is required', 403, 'FORBIDDEN');
      requireValue(typeof args.command_id === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(args.command_id), 'A stable command ID is required');
      const fingerprint = digest({ args, account, owner }), old = host.storage.get('mt5_trading_commands', args.command_id, true);
      requireValue(!old || old.fingerprint === fingerprint && (!task || old.planId === task.input.tradingPlan.id && old.runId === task.input.runId && old.taskId === task.id), 'Command ID belongs to another signed intent', 409, 'IDEMPOTENCY_CONFLICT');
      signal?.throwIfAborted(); assertCurrent(account); verifyExecutionAuthorization(assertTradingTask(host, account, true), 'mt5_trading_order', parameters, now());
      if (!old) host.storage.put('mt5_trading_commands', { id: args.command_id, account, owner, fingerprint, planId: task?.input.tradingPlan.id ?? null, runId: task?.input.runId ?? null, taskId: task?.id ?? null, createdAt: now() });
      return mt5.official.call(args, owner, signal);
    },
    command(args) {
      const account = accountOf(mt5), task = assertTradingTask(host, account);
      const row = host.storage.get('mt5_trading_commands', args.command_id, true), owner = task?.input.tradingPlan.ownerConversationId ?? host.scope.conversationId;
      requireValue(row && row.owner === owner && sameDomain(row.account, account) && (!task || row.planId === task.input.tradingPlan.id), 'Command is outside this owner and account', 403, 'FORBIDDEN');
      return mt5.official.command(args.command_id, owner);
    },
  };
}

export function createTools(host, mt5) {
  const { define, Type, string } = host.tools, service = createTradingContext(host, mt5);
  const authorization = Type.Optional(Type.Object({ expiresAt: Type.Integer({ minimum: 1 }), signature: Type.String({ minLength: 88, maxLength: 88 }) }, { additionalProperties: false }));
  return [
    define('mt5_trading_context', 'Read exact configured account identity or a full-account native snapshot for the main Agent or a matching manual-trading plan task. Includes all origins and broker-retained history; never trades.', {
      action: Type.Union(['identity', 'snapshot'].map(Type.Literal)), history_days: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
    }, (args, signal) => service.context(args, signal)),
    define('mt5_trading_pause', 'Risk executor only: stop one EA belonging to the exact account. Native action removes the expert; no automatic resume, state-preserving pause or position close is implied. Unknown receipts require inspection, not replay.', {
      deployment_id: string('Exact deployment ID from the account snapshot'), account: Type.Object({ accountId: string('Exact login'), server: string('Exact server'), revision: string('Exact configuration revision') }, { additionalProperties: false }),
      reason: Type.String({ minLength: 1, maxLength: 2000 }), authorization,
    }, (args, signal) => service.pause(args, signal)),
    define('mt5_trading_order', 'Submit one runtime-signed exact-account guarded order intent. Plan tasks cannot invent or alter signed intent; stable command ID retains the parent-owner receipt.', {
      server: Type.Literal('python'), tool: Type.Literal('order_send'), arguments: Type.Object({}, { additionalProperties: true }), command_id: Type.String({ pattern: '^[a-zA-Z0-9_-]{16,128}$' }), authorization,
    }, (args, signal) => service.order(args, signal)),
    define('mt5_trading_command', 'Read a retained plan order receipt for its exact owner and account, including after a configuration revision change. Never submits or replays an order.', {
      command_id: string('Existing signed plan command ID'),
    }, args => service.command(args)),
  ];
}
