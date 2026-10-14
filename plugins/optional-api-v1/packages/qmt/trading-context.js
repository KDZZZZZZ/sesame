import { createPublicKey, verify } from 'node:crypto';
import { check, canonical } from '@sesame/plugin-sdk/protocol';
import { configuration } from './configuration.js';

export const tradingAccount = host => {
  const c = configuration(host);
  check(c.account_id && c.connection_id, 'Configure an existing QMT account first', 'PREREQUISITE_REQUIRED');
  return { accountId: c.account_id, connectionId: c.connection_id, revision: String(c.version) };
};
const sameAccount = (a, b) => a?.accountId === b.accountId && a?.connectionId === b.connectionId && a?.revision === b.revision;
export function verifyExecutionAuthorization(task, action, parameters, now = Date.now(), host) {
  const { authorization, ...args } = parameters;
  if (!task) return args;
  if (task.input.execution) {
    const execution = task.input.execution, chain = host?.tools.invocation?.()?.chain;
    const apply = Array.isArray(chain) ? chain.findIndex(row => row.pluginId === execution.pluginId && row.toolName === execution.applyTool) : -1;
    check(apply > 0 && apply < chain.length - 1
      && chain.slice(0, apply).some(row => row.pluginId === task.pluginId)
      && chain.at(-1).pluginId === 'sesame/qmt' && chain.at(-1).toolName === action,
    'Execution requires a live workflow-to-execution invocation chain', 'FORBIDDEN');
    return args;
  }
  let valid = false;
  try {
    const key = createPublicKey(task.input.executionPublicKey), signature = Buffer.from(authorization.signature, 'base64');
    valid = key.asymmetricKeyType === 'ed25519' && signature.length === 64 && signature.toString('base64') === authorization.signature
      && Number.isSafeInteger(authorization.expiresAt) && authorization.expiresAt > now && authorization.expiresAt - now <= 60000
      && verify(null, Buffer.from(canonical({ version: 1, taskId: task.id, runId: task.input.runId, action, args, expiresAt: authorization.expiresAt })), key, signature);
  } catch { /* Missing or malformed proof has no authority. */ }
  check(valid, 'Execution requires an unexpired signed intent from the trading runtime', 'FORBIDDEN');
  return args;
}
export function assertTradingTask(host, account, write = false, identity = false) {
  if (host.scope.kind === 'main') return null;
  const task = host.agents?.current(), input = task?.input, plan = input?.tradingPlan;
  const execution = input?.execution;
  const composed = execution && execution.context?.backend === 'qmt' && typeof execution.pluginId === 'string'
    && typeof execution.applyTool === 'string' && typeof execution.contextTool === 'string'
    && sameAccount(execution.account, account) && sameAccount(execution.context.account, account);
  const legacy = !execution && task?.pluginId === 'sesame/manual-trading' && plan?.backend === 'qmt';
  check((composed || legacy) && task.status === 'running' && task.conversationId === host.scope.conversationId
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

export function createTradingTools(host, service, executionGuard) {
  const { Type, define, string } = host.tools, context = createTradingContext(host, service);
  const operation = Type.String({ pattern: '^[A-Za-z0-9_-]{1,100}$' });
  const authorization = Type.Optional(Type.Object({ expiresAt: Type.Integer({ minimum: 1 }), signature: Type.String({ minLength: 88, maxLength: 88 }) }, { additionalProperties: false }));
  const common = { operation_id: operation, user_authorized: Type.Literal(true), account_id: string('Exact authorized account ID'), connection_revision: string('Exact configured connection revision'), authorization };
  return [
    define('qmt_trading_context', 'Read configured identity or complete full-account raw positions/current-day orders and fills for an active workflow task with a frozen matching execution contract. No origin filter, terminal launch or trade.', {
      action: Type.Union(['identity', 'snapshot'].map(Type.Literal)), history_days: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
    }, context),
    define('qmt_trading_order', 'Main Agent, host-proven workflow-to-execution call chain, or legacy runtime-signed executor intent: submit one guarded exact-account limit order through the existing idempotent native path. Unknown receipts are not retried.', {
      ...common, symbol: Type.String({ pattern: '^\\d{6}\\.(SH|SZ|BJ)$' }), side: Type.Union([Type.Literal('buy'), Type.Literal('sell')]),
      shares: Type.String({ pattern: '^[1-9]\\d*$' }), price: Type.String({ pattern: '^(0|[1-9]\\d*)(\\.\\d+)?$' }), execution_guard: executionGuard,
    }, (args, signal) => service.command('order', args, signal, host.scope, host)),
    define('qmt_trading_cancel', 'Main Agent, host-proven workflow-to-execution call chain, or legacy runtime-signed executor intent: cancel only an existing exact-account original order through the native ownership and idempotence checks. Inspect native status after unknown results.', {
      ...common, original_operation_id: string('Original qmt_order operation ID'), order_id: Type.String({ pattern: '^[1-9]\\d*$' }),
    }, (args, signal) => service.command('cancel', args, signal, host.scope, host)),
    define('qmt_trading_command', 'Read one exact-account retained order/cancel receipt for an active workflow task with a frozen matching execution contract without submitting or replaying it.', {
      operation_id: string('Existing operation ID'),
    }, args => service.commandRecord(args.operation_id, host.scope, host)),
  ];
}
