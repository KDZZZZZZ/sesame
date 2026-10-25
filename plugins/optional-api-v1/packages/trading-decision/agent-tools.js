import { ROLES } from './plans.js';
import { instance } from './state.js';
import { records } from './records.js';

export function createAgentCapabilities(host) {
  const runtime = () => instance(host).runtime;
  const handlers = {
    trading_decision_models: () => ({ models: host.context.models, roles: ROLES }),
    trading_decision_plan: async (args, signal) => {
      const service = runtime(); service.main(host);
      if (args.action === 'list') return { plans: service.plans().filter(plan => plan.ownerConversationId === host.context.sessionId) };
      if (args.action === 'save') return service.configure(host, args.plan, signal);
      return service.setEnabled(host, args.plan_id, args.action === 'resume');
    },
    trading_decision_run: args => { const service = runtime(); service.ownedPlan(host, args.plan_id); return service.trigger(args.plan_id, { kind: 'manual', id: args.request_id }, host); },
    trading_decision_event: args => { const service = runtime(); service.main(host); return { runs: service.event(args.key, args.event_id, args.data ?? {}, args.observed_at, host.context.sessionId, host) }; },
    trading_decision_runs: args => {
      const service = runtime(); service.main(host);
      if (args.action === 'read') return service.authorize(host, args.run_id);
      if (args.action === 'cancel') { service.authorize(host, args.run_id); return service.cancel(args.run_id, 'Stopped by main Agent'); }
      const rows = records(host).list('runs').filter(run => run.plan.ownerConversationId === host.context.sessionId && (!args.plan_id || run.planId === args.plan_id)).sort((a, b) => b.createdAt - a.createdAt), offset = args.offset ?? 0, limit = args.limit ?? 20;
      return { items: rows.slice(offset, offset + limit).map(run => ({ id: run.id, planId: run.planId, status: run.status, createdAt: run.createdAt, completedAt: run.completedAt, error: run.error, report: run.report, reportPending: run.reportPending, workflow: run.workflow })), total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null };
    },
    trading_decision_activity: args => { const run = runtime().authorize(host, args.run_id); runtime().main(host); if (!run.workflow) throw Object.assign(new Error('The workflow has no execution yet'), { code: 'NOT_STARTED' }); return host.views.open({ surface: 'run', runId: run.workflow.id }); },
    trading_decision_context: (args, signal) => runtime().context(host, args.run_id, args.section, args.offset, args.limit, signal),
    trading_decision_decide: (args, signal) => runtime().decide(host, args.run_id, args.decision, signal),
    trading_decision_check: args => runtime().checkReview(host, args.run_id, args),
    trading_decision_apply: (args, signal) => runtime().apply(host, args.run_id, signal),
    trading_decision_report: args => runtime().archive(host, args.run_id),
    trading_decision_review: (args, signal) => runtime().review(host, args, signal),
  };
  return Object.entries(handlers).map(([name, handler]) => ({ name, execute: (input, signal, context) => runtime().invocation.run({ ...context, signal }, () => handler(input, signal)) }));
}
