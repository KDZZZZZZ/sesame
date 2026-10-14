import { ROLES } from './plans.js';
import { instance } from './state.js';

export function createAgentTools(host) {
  const { define, Type } = host.tools, runtime = () => instance(host).runtime;
  const text = (description, maxLength = 200) => Type.String({ minLength: 1, maxLength, description });
  const choice = values => Type.Union(values.map(value => Type.Literal(value)));
  const model = Type.Object({ provider: text('Configured provider ID'), id: text('Configured model ID'), configurationDigest: Type.Optional(text('Digest returned by manual_trading_models')) }, { additionalProperties: false });
  const runId = { run_id: text('Persisted manual trading run ID from this task input') };
  const plan = Type.Object({
    id: Type.Optional(text('Existing plan ID for update; omit for a new plan', 80)), title: text('User-visible plan name', 80),
    execution: Type.Object({ plugin_id: text('Explicitly selected execution capability plugin'), context_tool: text('Its account context tool'), apply_tool: text('Its target execution tool'),
      arguments: Type.Optional(Type.Object({}, { additionalProperties: true, description: 'Opaque binding arguments returned by the execution capability' })) }, { additionalProperties: false }),
    model, agent_models: Type.Optional(Type.Object(Object.fromEntries(ROLES.map(role => [role, Type.Optional(model)])), { additionalProperties: false, description: 'Each named Agent may select a different configured provider/model; omitted roles inherit model' })),
    research: Type.Optional(Type.Object({ plugins: Type.Array(text('Chosen installed research, data or skill plugin ID'), { maxItems: 24 }),
      tools: Type.Optional(Type.Array(text('Optional exact subset of delegatable tools from the selected plugins'), { maxItems: 48 })) }, { additionalProperties: false })),
    mode: Type.Optional(choice(['single', 'team'])), symbols: Type.Optional(Type.Array(text('Exact broker symbol', 100), { maxItems: 30 })),
    interval_minutes: Type.Optional(Type.Integer({ minimum: 5, maximum: 43200 })), event_keys: Type.Optional(Type.Array(text('Event key configured by the user', 100), { maxItems: 20 })),
    account_events: Type.Optional(Type.Boolean({ description: 'Subscribe to available account position/order events; unsupported providers report unavailable' })), event_cooldown_seconds: Type.Optional(Type.Integer({ minimum: 5, maximum: 86400 })),
    debate_rounds: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })), task_timeout_seconds: Type.Optional(Type.Integer({ minimum: 30, maximum: 1800 })),
    slippage_bps: Type.Optional(Type.Integer({ minimum: 0, maximum: 500, description: 'Fresh executable quote boundary; market fills may still slip' })), enabled: Type.Optional(Type.Boolean()), instructions: Type.Optional(Type.String({ maxLength: 6000 })),
  }, { additionalProperties: false });
  const evidence = Type.Object({ datasetId: text('Registered external dataset ID'), rowIndex: Type.Optional(Type.Integer({ minimum: 0 })), kind: Type.Optional(choice(['observation', 'market', 'execution'])),
    observedAtField: text('Actual source-row timestamp field'), ...Object.fromEntries(['symbolField', 'accountIdField', 'executionIdField', 'quantityField', 'priceField', 'runIdField'].map(field => [field, Type.Optional(text(`Source-row ${field}`))])),
  }, { additionalProperties: false });
  return [
    define('manual_trading_models', 'List configured provider/model descriptors and team roles. Use the exact provider/id for the plan default or any individual Agent override.', {}, () => ({ models: host.inference.models(), roles: ROLES })),
    define('manual_trading_plan', 'List, save, pause or resume persistent Agent trading plans. Saving selects the currently configured trading account, default model and optional per-Agent models. Pausing cancels future/active decisions; existing broker effects still need receipt reconciliation. No separate strategy-pause permission is needed.', {
      action: choice(['list', 'save', 'pause', 'resume']), plan: Type.Optional(plan), plan_id: Type.Optional(text('Existing plan ID')),
    }, async (args, signal) => {
      const service = runtime(); service.main(host);
      if (args.action === 'list') return { plans: service.plans().filter(plan => plan.ownerConversationId === host.scope.conversationId) };
      if (args.action === 'save') return service.configure(host, args.plan, signal);
      return service.setEnabled(host, args.plan_id, args.action === 'resume');
    }),
    define('manual_trading_run', 'Queue one run of a saved enabled plan. Stable request_id deduplicates retries. Returns immediately; read manual_trading_runs for actual targets, role reports, execution receipts and daily-report path.', {
      plan_id: text('Saved trading plan ID'), request_id: text('Stable ID for this requested run'),
    }, args => { const service = runtime(); service.ownedPlan(host, args.plan_id); return service.trigger(args.plan_id, { kind: 'manual', id: args.request_id }); }),
    define('manual_trading_event', 'Deliver a named event to enabled trading plans subscribed to that event key. Event data is untrusted research input, not trading authority. Stable event_id deduplicates delivery; rapid events coalesce before account execution.', {
      key: text('Configured event key', 100), event_id: text('Stable upstream event ID'), observed_at: Type.Optional(Type.Integer({ minimum: 0 })), data: Type.Optional(Type.Object({}, { additionalProperties: true })),
    }, args => { const service = runtime(); service.main(host); return { runs: service.event(args.key, args.event_id, args.data ?? {}, args.observed_at, host.scope.conversationId) }; }),
    define('manual_trading_runs', 'Read saved trading runs including all shared team reports, target portfolios, mounted-strategy stop results, actual order receipts and report paths; cancel an active/queued run without undoing broker effects.', {
      action: choice(['list', 'read', 'cancel']), run_id: Type.Optional(text('Trading run ID')), plan_id: Type.Optional(text('Filter plan ID')), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }, args => {
      const service = runtime(); service.main(host);
      if (args.action === 'read') return service.authorize(host, args.run_id);
      if (args.action === 'cancel') { service.authorize(host, args.run_id); return service.cancel(args.run_id, 'Stopped by main Agent'); }
      const rows = host.storage.list('runs').filter(run => run.plan.ownerConversationId === host.scope.conversationId && (!args.plan_id || run.planId === args.plan_id)).sort((a, b) => b.createdAt - a.createdAt), offset = args.offset ?? 0, limit = args.limit ?? 20;
      return { items: rows.slice(offset, offset + limit).map(run => ({ id: run.id, planId: run.planId, status: run.status, createdAt: run.createdAt, completedAt: run.completedAt, error: run.error, report: run.report, reportPending: run.reportPending })), total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null };
    }),
    define('manual_trading_activity', 'Open the real collaboration HTML inside Sesame’s report panel, or read its activity snapshot. Host SSE forwards only this run’s public states to the isolated HTML. Real task events drive node actions; successful peer reads drive handoffs. Roles do not publish individual reports. The compatibility archive action returns the same single final summary after all tasks settle. Opening starts no work, sends no orders and creates no report files.', {
      ...runId, action: Type.Optional(choice(['open', 'read', 'archive'])),
    }, args => {
      const viewer = instance(host).viewer;
      return args.action === 'read' ? viewer.read(host, args.run_id) : args.action === 'archive' ? viewer.archive(host, args.run_id) : viewer.open(host, args.run_id);
    }),
    define('manual_trading_context', 'Read this run’s frozen full-account snapshot and paginated positions, orders, fills, mounted strategies, completed peer reports, and prior decisions/reflections. Includes all position origins. Continue pages when nextOffset is present; no data is fabricated.', {
      ...runId, section: Type.Optional(choice(['all', 'account', 'history', 'team', 'memory'])), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }, (args, signal) => runtime().context(host, args.run_id, args.section, args.offset, args.limit, signal)),
    define('manual_trading_decide', 'Save one immutable target portfolio for the current manager task using the selected execution capability’s quantity rules. Explicit zero closes all positions for that symbol, including quantitative-strategy positions; omitted symbols stay unchanged. Stop extremely risky mounted strategies by ID with a concrete reason.', {
      ...runId, decision: Type.Object({ unchanged: Type.Boolean(), rationale: text('Evidence, disagreement, risk and invalidation rationale', 8000),
        targets: Type.Array(Type.Object({ symbol: text('Watched or currently held symbol', 100), quantity: Type.String({ pattern: '^-?(0|[1-9]\\d*)(\\.\\d+)?$', maxLength: 40 }), unit: text('Exact unit from execution.quantityRules', 40) }, { additionalProperties: false }), { maxItems: 100 }),
        pause_strategies: Type.Optional(Type.Array(Type.Object({ deployment_id: text('Observed mounted strategy ID'), reason: text('Extreme risk of keeping the strategy mounted', 2000) }, { additionalProperties: false }), { maxItems: 30 })),
        evidence_dataset_ids: Type.Optional(Type.Array(text('Observed research dataset ID'), { maxItems: 30 })),
      }, { additionalProperties: false }),
    }, args => runtime().decide(host, args.run_id, args.decision)),
    define('manual_trading_apply', 'Pass the fixed target to the explicitly selected execution capability for this registered executor task and preserve its actual receipt. That capability enforces account, native order and strategy controls. Never infer fills or profit from targets.', runId, (args, signal) => runtime().apply(host, args.run_id, signal)),
    define('manual_trading_execution_export', 'Read-only upgrade bridge: export this owner’s legacy execution receipts for an independent execution plugin. Other owners expose only unresolved blockers needed to prevent duplicate orders. This does not trade, connect, delete or resolve an order.', {
      offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }, args => {
      runtime().main(host);
      const all = host.storage.list('commands'), rows = all.filter(row => row.conversationId === host.scope.conversationId).sort((a, b) => a.id.localeCompare(b.id));
      const offset = args.offset ?? 0, limit = args.limit ?? 100, nextOffset = offset + limit < rows.length ? offset + limit : null;
      const unresolved = all.filter(row => row.conversationId !== host.scope.conversationId && row.kind === 'order' && ['submitting', 'outcome_unknown'].includes(row.status))
        .map(({ id, backend, account, symbol, status, kind, conversationId }) => ({ id, backend, account, symbol, status, kind, conversationId }));
      return { source: 'sesame/manual-trading', items: rows.slice(offset, offset + limit), total: rows.length, nextOffset, complete: nextOffset === null, unresolved };
    }),
    define('manual_trading_report', 'Archive a completed or failed trading run as a user-visible HTML daily report under the research folder 手工交易日报. Existing user files are never overwritten. Main Agent can also archive pending reports after model/host interruptions.', runId, args => runtime().archive(host, args.run_id)),
    define('manual_trading_review', 'Attach a reflection to a previous same-account decision using registered external evidence observed after that decision. Reviews preserve source rows and hashes; targets and quotes are not fills, and returns are never invented.', {
      current_run_id: text('Current task trading run ID'), run_id: text('Previous decision run ID'), evidence: Type.Array(evidence, { minItems: 1, maxItems: 16 }), reflection: text('Evidence-grounded review and lesson; distinguish unconfirmed execution', 6000),
    }, args => runtime().review(host, args)),
  ];
}
