import { ROLES } from './plans.js';
import { instance } from './state.js';
import { records } from './records.js';

export function createAgentCapabilities(host) {
  const runtime = () => instance(host).runtime;
  const handlers = {
    manual_trading_models: () => ({ models: host.context.models, roles: ROLES }),
    manual_trading_analyze: (args, signal) => runtime().analyze(host, args, signal),
    manual_trading_plan: async (args, signal) => {
      const service = runtime(); service.main(host);
      if (args.action === 'list') return { plans: service.plans().filter(plan => plan.ownerConversationId === host.context.sessionId && plan.purpose !== 'analysis') };
      if (args.action === 'save') return service.configure(host, args.plan, signal);
      return service.setEnabled(host, args.plan_id, args.action === 'resume');
    },
    manual_trading_run: args => { const service = runtime(); service.ownedPlan(host, args.plan_id); return service.trigger(args.plan_id, { kind: 'manual', id: args.request_id }, host); },
    manual_trading_event: args => { const service = runtime(); service.main(host); return { runs: service.event(args.key, args.event_id, args.data ?? {}, args.observed_at, host.context.sessionId, host) }; },
    manual_trading_runs: args => {
      const service = runtime(); service.main(host);
      if (args.action === 'read') return service.authorize(host, args.run_id);
      if (args.action === 'cancel') { service.authorize(host, args.run_id); return service.cancel(args.run_id, 'Stopped by main Agent'); }
      const rows = records(host).list('runs').filter(run => run.plan.ownerConversationId === host.context.sessionId && (!args.plan_id || run.planId === args.plan_id)).sort((a, b) => b.createdAt - a.createdAt), offset = args.offset ?? 0, limit = args.limit ?? 20;
      return { items: rows.slice(offset, offset + limit).map(run => ({ id: run.id, planId: run.planId, status: run.status, createdAt: run.createdAt, completedAt: run.completedAt, error: run.error, report: run.report, reportPending: run.reportPending,
        ...(run.plan.purpose === 'analysis' ? { purpose: 'analysis', workflow: run.workflow, summary: run.summary } : {}) })), total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null };
    },
    manual_trading_activity: args => { const run = runtime().authorize(host, args.run_id); runtime().main(host); if (!run.workflow) throw Object.assign(new Error('The workflow has no execution yet'), { code: 'NOT_STARTED' }); return host.views.open({ surface: 'run', runId: run.workflow.id }); },
    manual_trading_context: (args, signal) => runtime().context(host, args.run_id, args.section, args.offset, args.limit, signal),
    manual_trading_decide: (args, signal) => runtime().decide(host, args.run_id, args.decision, signal),
    manual_trading_apply: (args, signal) => runtime().apply(host, args.run_id, signal),
    manual_trading_execution_export: args => {
      runtime().main(host);
      const all = records(host).list('commands'), rows = all.filter(row => row.conversationId === host.context.sessionId).sort((a, b) => a.id.localeCompare(b.id));
      const offset = args.offset ?? 0, limit = args.limit ?? 100, nextOffset = offset + limit < rows.length ? offset + limit : null;
      const unresolved = all.filter(row => row.conversationId !== host.context.sessionId && row.kind === 'order' && ['submitting', 'outcome_unknown'].includes(row.status))
        .map(({ id, backend, account, symbol, status, kind, conversationId }) => ({ id, backend, account, symbol, status, kind, conversationId }));
      return { source: 'sesame/manual-trading', items: rows.slice(offset, offset + limit), total: rows.length, nextOffset, complete: nextOffset === null, unresolved };
    },
    manual_trading_report: args => runtime().archive(host, args.run_id),
    manual_trading_review: (args, signal) => runtime().review(host, args, signal),
  };
  return Object.entries(handlers).map(([name, handler]) => ({ name, execute: (input, signal, context) => runtime().invocation.run({ ...context, signal }, () => handler(input, signal)) }));
}
