import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { check } from './shared.js';
import { selectResearch } from './composition.js';

export const ROLES = ['market', 'fundamentals', 'news', 'sentiment', 'bull', 'bear', 'risk', 'manager', 'executor'];
export const ANALYSTS = ROLES.slice(0, 4);
export const TERMINAL = new Set(['completed', 'cancelled']);
export const clone = value => structuredClone(value);
export const accountKey = plan => canonical([plan.execution?.pluginId ?? 'legacy', Object.fromEntries(Object.entries(plan.account).filter(([key]) => key !== 'revision'))]);
export const cleanError = error => ({ code: error?.code ?? 'RUN_FAILED', message: String(error?.message ?? error).slice(0, 1000) });
// eslint-disable-next-line no-control-regex -- Report file names must exclude control characters.
export const safeName = value => String(value).normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 60) || '计划';
const bounded = (value, min, max, name) => check(Number.isSafeInteger(value) && value >= min && value <= max, 'INVALID_ARGUMENT', `${name} must be ${min}..${max}`);

export function selectModel(host, selection) {
  check(selection?.provider && selection.id, 'MODEL_REQUIRED', 'Select a configured provider and model from manual_trading_models');
  const model = host.context.models.find(value => value.provider === selection.provider && value.id === selection.id);
  check(model, 'MODEL_UNAVAILABLE', `Configured model unavailable: ${selection.provider}/${selection.id}`);
  check(!selection.configurationDigest || selection.configurationDigest === model.configurationDigest, 'MODEL_CHANGED', 'Model configuration changed; select it again');
  return clone(model);
}

export async function makePlan(host, input, execution, previous, now = Date.now()) {
  const id = input.id ?? previous?.id ?? randomUUID();
  check(/^[a-zA-Z0-9_-]{1,80}$/.test(id), 'INVALID_ARGUMENT', 'Plan ID must be a safe identifier');
  check(typeof input.title === 'string' && input.title.trim() && input.title.length <= 80, 'INVALID_ARGUMENT', 'Plan title is required (max 80 characters)');
  check(execution?.account && execution.contextTool && execution.applyTool, 'EXECUTION_REQUIRED', 'Bind a selected execution capability before saving the workflow');
  check(input.backend === undefined, 'INVALID_ARGUMENT', 'Select an execution capability; configure native backends in that capability plugin');
  const mode = input.mode ?? 'single';
  check(['single', 'team'].includes(mode), 'INVALID_ARGUMENT', 'Choose single or team');
  const model = selectModel(host, input.model), agentModels = {};
  for (const [role, selected] of Object.entries(input.agent_models ?? {})) {
    check(ROLES.includes(role), 'INVALID_ARGUMENT', `Unknown team role: ${role}`);
    agentModels[role] = selectModel(host, selected);
  }
  const intervalMinutes = input.interval_minutes ?? null;
  if (intervalMinutes !== null) bounded(intervalMinutes, 5, 43200, 'interval_minutes');
  const eventKeys = input.event_keys ?? [];
  check(Array.isArray(eventKeys) && eventKeys.length <= 20 && eventKeys.every(key => /^[a-zA-Z0-9_.:-]{1,100}$/.test(key)), 'INVALID_ARGUMENT', 'Use at most 20 bounded event keys');
  const cooldownSeconds = input.event_cooldown_seconds ?? 60, debateRounds = input.debate_rounds ?? 1;
  const slippageBps = input.slippage_bps ?? 50;
  bounded(cooldownSeconds, 5, 86400, 'event_cooldown_seconds'); bounded(debateRounds, 1, 3, 'debate_rounds');
  bounded(slippageBps, 0, 500, 'slippage_bps');
  const symbols = input.symbols ?? [];
  check(Array.isArray(symbols) && symbols.length <= 30 && symbols.every(symbol => typeof symbol === 'string' && symbol.length > 0 && symbol.length <= 100), 'INVALID_ARGUMENT', 'Use at most 30 exact broker symbols');
  const research = await selectResearch(host, input.research ?? previous?.research ?? {});
  check(typeof (input.instructions ?? '') === 'string' && (input.instructions ?? '').length <= 6000, 'INVALID_ARGUMENT', 'Instructions exceed 6000 characters');
  const plan = { id, title: input.title.trim(), execution: clone(execution), account: clone(execution.account), mode, model, agentModels,
    symbols: [...new Set(symbols)], research, intervalMinutes, eventKeys: [...new Set(eventKeys)], accountEvents: input.account_events ?? false,
    eventCooldownMs: cooldownSeconds * 1000, debateRounds, slippageBps,
    instructions: input.instructions ?? '', enabled: input.enabled ?? true, ownerConversationId: host.context.sessionId,
    reportFolder: `手工交易日报/${safeName(input.title)}-${id}`, revision: (previous?.revision ?? 0) + 1,
    createdAt: previous?.createdAt ?? now, updatedAt: now, nextDueAt: intervalMinutes === null ? null : now + intervalMinutes * 60000,
    lastEventAt: previous?.lastEventAt ?? null, lastRunId: previous?.lastRunId ?? null };
  check(typeof plan.enabled === 'boolean' && typeof plan.accountEvents === 'boolean', 'INVALID_ARGUMENT', 'enabled/account_events must be boolean');
  return plan;
}

export function validateDecision(plan, snapshot, decision) {
  check(decision && typeof decision === 'object' && !Array.isArray(decision), 'INVALID_DECISION', 'A target portfolio object is required');
  check(typeof decision.rationale === 'string' && decision.rationale.trim() && decision.rationale.length <= 8000, 'INVALID_DECISION', 'Explain the portfolio decision');
  check(typeof decision.unchanged === 'boolean', 'INVALID_DECISION', 'State whether the portfolio is unchanged');
  const targets = decision.targets ?? [], pauses = decision.pause_strategies ?? [], evidence = decision.evidence_dataset_ids ?? [], sources = decision.evidence_sources ?? [], artifacts = decision.evidence_artifacts ?? [];
  check(Array.isArray(targets) && targets.length <= 100 && (!decision.unchanged || targets.length === 0), 'INVALID_DECISION', 'Unchanged requires empty targets');
  check(decision.unchanged || targets.length > 0, 'INVALID_DECISION', 'Supply explicit targets, or unchanged:true');
  const universe = new Set([...plan.symbols, ...(snapshot.positions ?? []).map(row => row.symbol ?? row.stock_code)]);
  const seen = new Set();
  for (const target of targets) {
    check(universe.has(target.symbol) && !seen.has(target.symbol), 'INVALID_DECISION', 'Targets must use unique watched or held symbols');
    seen.add(target.symbol);
    check(typeof target.quantity === 'string' && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(target.quantity) && target.quantity.length <= 40, 'INVALID_DECISION', 'Target quantity must be an exact signed decimal string');
    const rules = plan.execution.quantityRules;
    check(rules.signed || !target.quantity.startsWith('-'), 'INVALID_DECISION', 'Selected capability does not support negative quantities');
    check(!rules.integer || !target.quantity.includes('.'), 'INVALID_DECISION', 'Selected capability requires integer quantities');
    check(target.unit === rules.unit, 'INVALID_DECISION', 'Target quantity unit differs from the selected execution capability');
  }
  check(Array.isArray(pauses) && pauses.length <= 30 && new Set(pauses.map(value => value.deployment_id)).size === pauses.length, 'INVALID_DECISION', 'Pause requests must be unique');
  for (const pause of pauses) {
    check(typeof pause.reason === 'string' && pause.reason.trim().length >= 10 && pause.reason.length <= 2000, 'INVALID_DECISION', 'Explain the extreme risk of continuing the mounted strategy');
    check((snapshot.deployments ?? []).some(row => row.id === pause.deployment_id), 'INVALID_DECISION', 'Pause must name an observed mounted strategy');
  }
  check(Array.isArray(evidence) && evidence.length <= 30 && evidence.every(id => typeof id === 'string' && id.length <= 200), 'INVALID_DECISION', 'Evidence must name registered datasets');
  check(Array.isArray(sources) && sources.length + evidence.length <= 30 && sources.every(ref => ref && typeof ref.datasetId === 'string' && ref.datasetId.length > 0 && ref.datasetId.length <= 200 && ref.source && typeof ref.source.providerId === 'string' && typeof ref.source.revision === 'string' && ref.query && typeof ref.query === 'object' && !Array.isArray(ref.query)), 'INVALID_DECISION', 'External evidence requires datasetId, SourceRef and query');
  check(Array.isArray(artifacts) && artifacts.length + sources.length + evidence.length <= 30 && artifacts.every(ref => ref && ref.kind === 'data' && ref.schemaVersion === '1.0.0' && typeof ref.id === 'string' && typeof ref.revision === 'string' && /^sha256:[a-f0-9]{64}$/.test(ref.digest)), 'INVALID_DECISION', 'Artifact evidence requires exact data ArtifactRefs');
  return clone({ unchanged: decision.unchanged, targets, pause_strategies: pauses, rationale: decision.rationale, evidence_dataset_ids: evidence, evidence_sources: sources, evidence_artifacts: artifacts });
}

export function triggerIdentity(plan, trigger) {
  check(typeof trigger.id === 'string' && trigger.id.length > 0 && trigger.id.length <= 200, 'INVALID_ARGUMENT', 'A stable event/request ID is required');
  return `run_${digest([plan.id, trigger.kind, trigger.id]).slice(7, 39)}`;
}
