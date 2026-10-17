import { records } from './records.js';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { check } from './adapters.js';
import { invoke, requirePlugin, pluginStatus } from './calls.js';
import { applyPortfolio } from './portfolio.js';
import { withAccountLock } from './execution-lock.js';

export const PLUGIN = 'sesame/portfolio-execution';
export const CONTEXT = 'portfolio_execution_context';
export const APPLY = 'portfolio_execution_apply';
const clone = value => structuredClone(value);
const active = new Map();
const nonempty = value => typeof value === 'string' && value.length > 0;
const same = (a, b) => a !== undefined && b !== undefined && canonical(a) === canonical(b);
const main = host => check(host.context?.kind === 'main' && nonempty(host.context.sessionId), 'FORBIDDEN', 'Configure execution bindings from the main conversation');

// The previous package owns its private storage. An optional, main-only export
// bridge transfers receipts without a legacy grant or direct database access.
export async function migrateLegacy(host, signal) {
  main(host);
  let installed;
  try { installed = await pluginStatus(host, 'sesame/manual-trading'); }
  catch (error) { if (!['NOT_FOUND', 'not_found', 'PLUGIN_NOT_FOUND', 'plugin_not_found'].includes(error.code)) throw error; }
  if (!installed) return;
  await requirePlugin(host, 'sesame/manual-trading');
  check(installed.tools?.includes('manual_trading_execution_export'), 'PREREQUISITE_REQUIRED', 'Upgrade manual-trading to a version with manual_trading_execution_export before moving execution; unknown legacy orders must remain blocked');
  let offset = 0;
  for (;;) {
    signal?.throwIfAborted();
    const result = await invoke(host, 'sesame/manual-trading', 'manual_trading_execution_export', { offset, limit: 100 }, signal);
    check(result?.source === 'sesame/manual-trading' && Array.isArray(result.items) && result.items.length <= 100 && Array.isArray(result.unresolved), 'SOURCE_DATA_INVALID', 'Invalid legacy execution export');
    records(host).transaction(() => {
      for (const record of result.items) {
        check(record?.conversationId === host.context.sessionId && nonempty(record.id) && nonempty(record.fingerprint), 'SOURCE_DATA_INVALID', 'Legacy receipt does not belong to this owner');
        const prior = records(host).get('commands', record.id, true);
        check(!prior || prior.conversationId === record.conversationId && prior.fingerprint === record.fingerprint, 'IDEMPOTENCY_CONFLICT', 'Legacy operation ID conflicts with an execution receipt');
        if (!prior) records(host).put('commands', record);
      }
      for (const blocker of result.unresolved) {
        check(nonempty(blocker?.id) && blocker.kind === 'order' && ['submitting', 'outcome_unknown'].includes(blocker.status) && blocker.account, 'SOURCE_DATA_INVALID', 'Invalid unresolved legacy order');
        const recovered = records(host).get('commands', blocker.id, true);
        if (recovered?.conversationId === blocker.conversationId && !['preparing', 'submitting', 'outcome_unknown'].includes(recovered.status)) continue;
        records(host).put('legacy_blocks', { ...blocker, id: digest([blocker.conversationId, blocker.id]), originalOperationId: blocker.id });
      }
    });
    check(result.nextOffset === null || result.nextOffset === undefined || Number.isSafeInteger(result.nextOffset) && result.nextOffset > offset, 'SOURCE_DATA_INVALID', 'Legacy export cursor did not advance');
    if (result.nextOffset === null || result.nextOffset === undefined) {
      check(result.complete === true, 'SOURCE_DATA_INVALID', 'Legacy receipt export is incomplete');
      break;
    }
    offset = result.nextOffset;
  }
  records(host).put('migrations', { id: host.context.sessionId, source: 'sesame/manual-trading', completedAt: Date.now() });
}

export function createExecution(host, { now = Date.now, apply = applyPortfolio, provenance, signal: lifetime } = {}) {
  const readBinding = id => {
    const binding = records(host).get('bindings', id, true);
    check(binding, 'NOT_FOUND', 'Execution binding not found; call portfolio_execution_configure first');
    return binding;
  };
  const native = async (binding, action, signal, historyDays) => {
    await requirePlugin(host, `sesame/${binding.backend}`);
    return invoke(host, `sesame/${binding.backend}`, `${binding.backend}_trading_context`, { action, ...(historyDays === undefined ? {} : { history_days: historyDays }) }, signal);
  };
  function assertBinding(binding, run) {
    lifetime?.throwIfAborted();
    const current = readBinding(binding.id);
    check(same(current, binding), 'BINDING_CHANGED', 'Execution binding changed; configure the workflow again');
    if (host.context.kind === 'main') {
      check(!run && binding.ownerConversationId === host.context.sessionId, 'FORBIDDEN', 'Binding belongs to another owner or requires a workflow executor');
      return null;
    }
    const task = provenance?.agent, input = task?.input, execution = input?.execution, plan = input?.tradingPlan;
    check(host.context.kind === 'subagent' && task?.sessionId === host.context.sessionId
      && nonempty(task.pluginId) && nonempty(input?.runId) && nonempty(input.role) && nonempty(plan?.id)
      && plan.ownerConversationId === binding.ownerConversationId && same(plan.account, binding.account)
      && execution?.pluginId === PLUGIN && execution.contextTool === CONTEXT && execution.applyTool === APPLY
      && same(execution.arguments, { binding_id: binding.id }) && same(execution.account, binding.account)
      && same(execution.context, { bindingId: binding.id, backend: binding.backend, account: binding.account }),
    'FORBIDDEN', 'This task does not hold the matching frozen execution binding');
    if (run) {
      check(input.role === 'executor' && run.id === input.runId && run.plan?.id === plan.id
        && run.plan.ownerConversationId === plan.ownerConversationId && same(run.plan.account, binding.account),
      'FORBIDDEN', 'Only the matching workflow executor may apply this saved run');
      const chain = provenance?.chain;
      check(Array.isArray(chain) && chain.length >= 2 && chain.at(-1).pluginId === PLUGIN && chain.at(-1).capabilityId === `${PLUGIN}#${APPLY}`
        && chain.at(-2).pluginId === task.pluginId, 'FORBIDDEN', 'Apply must be called by a live workflow tool, not directly by the model');
    }
    return task;
  }
  function validateRun(binding, run) {
    const decision = run?.decision, targets = decision?.targets, pauses = decision?.pause_strategies;
    check(Number.isSafeInteger(run?.decidedAt) && Number.isInteger(run?.plan?.slippageBps) && run.plan.slippageBps >= 0 && run.plan.slippageBps <= 500, 'INVALID_ARGUMENT', 'A saved decision time and bounded slippage are required');
    check(run.plan.backend === undefined, 'INVALID_ARGUMENT', 'Backend is determined by the execution binding');
    check(typeof decision?.unchanged === 'boolean' && Array.isArray(targets) && targets.length <= 100
      && (decision.unchanged ? targets.length === 0 : targets.length > 0) && Array.isArray(pauses) && pauses.length <= 30,
    'INVALID_ARGUMENT', 'Use a bounded saved target portfolio, or unchanged with no targets');
    const seen = new Set();
    for (const target of targets) {
      check(nonempty(target.symbol) && target.symbol.length <= 100 && !seen.has(target.symbol)
        && typeof target.quantity === 'string' && target.quantity.length <= 40 && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(target.quantity)
        && (binding.backend === 'mt5' ? target.unit === 'lots' : target.unit === 'shares' && /^(0|[1-9]\d*)$/.test(target.quantity)),
      'INVALID_ARGUMENT', 'Targets must have unique symbols and exact quantities in the bound native unit');
      seen.add(target.symbol);
    }
    check(new Set(pauses.map(value => value.deployment_id)).size === pauses.length
      && pauses.every(value => nonempty(value.deployment_id) && typeof value.reason === 'string' && value.reason.trim().length >= 10 && value.reason.length <= 2000), 'INVALID_ARGUMENT', 'Pause intents require a unique deployment and an extreme-risk reason');
  }
  return {
    status(args = {}) {
      main(host);
      if (args.binding_id) assertBinding(readBinding(args.binding_id));
      const offset = args.offset ?? 0, limit = args.limit ?? 20;
      check(Number.isSafeInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 100, 'INVALID_ARGUMENT', 'Use a nonnegative offset and limit 1..100');
      const rows = records(host).list('applications').filter(row => row.ownerConversationId === host.context.sessionId
        && (!args.binding_id || row.bindingId === args.binding_id) && (!args.run_id || row.runId === args.run_id))
        .sort((a, b) => b.execution.startedAt - a.execution.startedAt || a.id.localeCompare(b.id));
      const items = rows.slice(offset, offset + limit).map(row => ({ run_id: row.runId, plan_id: row.planId, binding_id: row.bindingId, workflow_plugin_id: row.workflowPluginId,
        status: row.completedAt ? row.execution.status : active.has(`${host.context.storageRoot}:${row.id}`) ? 'running' : 'interrupted',
        startedAt: row.execution.startedAt, completedAt: row.completedAt ?? null, error: row.execution.error ?? null,
        orders: (row.execution.orders ?? []).map(order => ({ operation_id: order.operationId, symbol: order.symbol, status: order.receipt?.status ?? 'unknown' })),
        pauses: row.execution.pauses ?? [], recovery: 'Use manual_trade_status for each operation_id; never resend an unknown operation under a new ID' }));
      return { items, total: rows.length, nextOffset: offset + items.length < rows.length ? offset + items.length : null };
    },
    async configure(args, signal) {
      main(host); check(['mt5', 'qmt'].includes(args.backend), 'UNSUPPORTED_CAPABILITY', 'Choose a supported execution adapter');
      await migrateLegacy(host, signal);
      const dependency = await requirePlugin(host, `sesame/${args.backend}`), version = /^(\d+)\.(\d+)\.(\d+)(?:[-+]|$)/.exec(dependency.version ?? '');
      const [minimumMajor, minimumMinor] = args.backend === 'mt5' ? [2, 1] : [1, 4];
      check(version && (Number(version[1]) > minimumMajor || Number(version[1]) === minimumMajor && Number(version[2]) >= minimumMinor), 'PREREQUISITE_REQUIRED', `Composed workflow execution requires sesame/${args.backend} ${minimumMajor}.${minimumMinor}.0+ with the delegated execution contract and declared read capabilities`);
      const id = args.id ?? randomUUID();
      check(/^[A-Za-z0-9_-]{1,100}$/.test(id), 'INVALID_ARGUMENT', 'Use a stable binding ID');
      const prior = records(host).get('bindings', id, true);
      check(!prior || prior.ownerConversationId === host.context.sessionId, 'FORBIDDEN', 'Binding belongs to another owner');
      const identity = await native({ backend: args.backend }, 'identity', signal);
      check(nonempty(identity?.account?.accountId) && nonempty(identity.account.revision)
        && nonempty(args.backend === 'mt5' ? identity.account.server : identity.account.connectionId), 'SOURCE_DATA_INVALID', 'Execution adapter omitted its exact configured identity');
      signal?.throwIfAborted();
      const binding = { id, backend: args.backend, account: identity.account, ownerConversationId: host.context.sessionId };
      check(!prior || same(prior, binding), 'BINDING_CHANGED', 'An execution binding is immutable; choose a new binding ID after an account or configuration change');
      if (!prior) records(host).put('bindings', binding);
      return { plugin_id: PLUGIN, context_tool: CONTEXT, apply_tool: APPLY, arguments: { binding_id: id } };
    },
    async context(args, signal) {
      const binding = readBinding(args.binding_id); assertBinding(binding);
      check(['identity', 'snapshot'].includes(args.action), 'INVALID_ARGUMENT', 'Choose identity or snapshot');
      const result = await native(binding, args.action, signal, args.history_days);
      assertBinding(binding);
      check(same(result.account, binding.account), 'ACCOUNT_CHANGED', 'Configured execution account changed; create a new binding');
      if (args.action === 'snapshot') return result;
      const readTools = [CONTEXT, `${binding.backend}_trading_context`, ...(binding.backend === 'mt5' ? ['mt5_catalog', 'mt5_call'] : ['qmt_read'])];
      return { account: clone(binding.account), tools: [...readTools, APPLY, ...(binding.backend === 'mt5' ? ['mt5_trading_order', 'mt5_trading_pause', 'mt5_trading_command'] : ['qmt_trading_order', 'qmt_trading_cancel', 'qmt_trading_command'])], readTools,
        taskContext: { bindingId: binding.id, backend: binding.backend, account: clone(binding.account) },
        accountProvider: { pluginId: `sesame/${binding.backend}`, providerId: 'account' },
        fillSources: binding.backend === 'mt5' ? [{ pluginId: 'sesame/mt5', provider: 'mt5/python/history_deals_get' }] : [],
        quantityRules: { unit: binding.backend === 'mt5' ? 'lots' : 'shares', signed: binding.backend === 'mt5', integer: binding.backend === 'qmt' } };
    },
    async apply(args, signal) {
      const binding = readBinding(args.binding_id), run = clone(args.run);
      const task = assertBinding(binding, run); validateRun(binding, run);
      const id = digest([task.pluginId, binding.ownerConversationId, run.plan.id, run.id]);
      const key = `${host.context.storageRoot}:${id}`, fingerprint = digest({ binding, run });
      const existing = records(host).get('applications', id, true);
      check(!existing || existing.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', 'This workflow run already has a different execution intent');
      if (active.has(key)) return clone(await active.get(key));
      if (existing) return clone(existing.completedAt ? existing.execution : { ...existing.execution, status: 'blocked', error: { code: 'EXECUTION_INTERRUPTED', message: 'Previous execution did not settle; inspect retained order receipts before a new run' } });
      const assertActive = () => { signal?.throwIfAborted(); assertBinding(binding, run); };
      let record = { id, fingerprint, runId: run.id, planId: run.plan.id, workflowPluginId: task.pluginId, ownerConversationId: binding.ownerConversationId, bindingId: binding.id,
        execution: { status: 'blocked', error: { code: 'EXECUTION_INTERRUPTED', message: 'Execution may have started; inspect retained order receipts before a new run' }, startedAt: now(), orders: [], pauses: [], after: null, targetReached: null } };
      records(host).put('applications', record);
      const operation = withAccountLock(host, binding, async () => {
        const result = await apply(host, { ...run, id: id.slice(7), plan: { ...run.plan, backend: binding.backend } }, { now, signal, assertActive,
          authorizeRequest: (_name, values) => { assertActive(); return values; },
          checkpoint: value => { record = { ...record, execution: clone(value.executionProgress) }; records(host).put('applications', record); } });
        record = { ...record, completedAt: now(), execution: clone(result) }; records(host).put('applications', record); return result;
      });
      active.set(key, operation);
      try { return clone(await operation); }
      finally { if (active.get(key) === operation) active.delete(key); }
    },
  };
}
