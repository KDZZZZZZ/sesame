import { check, clone, fields, sealed } from './method-support.js';
import { selectUniverse } from './universe.js';
import { constructPortfolio } from './portfolio.js';
import { constrainPortfolio, checkPlannedPortfolio } from './portfolio-risk.js';
import { createExecutionProgram, replayExecution } from './execution.js';

/** Extended workflow composes actual methods; the original 1.0 fixture stays unchanged. */
export function evaluateMethodPipeline(fixture, core) {
  fields(fixture, ['schemaVersion', 'id', 'asOf', 'executionAt', 'scope', 'strategySource', 'events', 'guards', 'universe', 'portfolio', 'policy', 'portfolioRisk', 'advice', 'snapshot', 'capabilities', 'execution'], 'method workflow');
  const signals = core.replaySignals(fixture.events, { asOf: fixture.asOf, scope: fixture.scope, guards: fixture.guards ?? [] });
  const universe = selectUniverse({ ...fixture.universe, asOf: fixture.asOf });
  const construction = constructPortfolio({ id: fixture.id, scope: fixture.scope, asOf: fixture.asOf, strategySource: fixture.strategySource, signals, universe, snapshot: fixture.snapshot, config: fixture.portfolio });
  const portfolioRisk = constrainPortfolio({ construction, market: fixture.portfolio, config: fixture.portfolioRisk });
  const advice = [...(fixture.advice ?? []), ...portfolioRisk.advice];
  let riskDecision = core.assessRisk({ target: portfolioRisk.target, signals, policy: fixture.policy, advice });
  const executionAt = fixture.executionAt ?? fixture.asOf;
  let executionPlan = core.planExecution({ decision: riskDecision, snapshot: fixture.snapshot, capabilities: fixture.capabilities, asOf: executionAt });
  const portfolioEnforcement = checkPlannedPortfolio({ risk: portfolioRisk, plan: executionPlan, market: fixture.portfolio });
  if (portfolioEnforcement.advice.length) {
    riskDecision = core.assessRisk({ target: portfolioRisk.target, signals, policy: fixture.policy, advice: [...advice, ...portfolioEnforcement.advice] });
    executionPlan = core.planExecution({ decision: riskDecision, snapshot: fixture.snapshot, capabilities: fixture.capabilities, asOf: executionAt });
    const final = checkPlannedPortfolio({ risk: portfolioRisk, plan: executionPlan, market: fixture.portfolio });
    check(final.status === 'within_limits', 'Portfolio hard limits remain violated after conservative risk exit');
    portfolioEnforcement.final = final; delete portfolioEnforcement.digest;
  }
  const execution = fixture.execution ?? {};
  fields(execution, ['config', 'events', 'checkpoint'], 'workflow execution');
  const executionProgram = createExecutionProgram({ decision: riskDecision, plan: executionPlan, snapshot: fixture.snapshot, capabilities: fixture.capabilities, config: execution.config ?? {}, asOf: executionAt });
  const executionReplay = replayExecution({ program: executionProgram, events: execution.events ?? [], checkpoint: execution.checkpoint });
  return sealed({ schemaVersion: '1.1.0', kind: 'strategy-method-workflow', scope: clone(fixture.scope), signals, universe, construction, portfolioRisk, portfolioEnforcement: portfolioEnforcement.digest ? portfolioEnforcement : sealed(portfolioEnforcement), target: portfolioRisk.target, riskDecision, executionPlan, executionProgram, executionReplay, validationScope: 'fixed-input-strategy-method-workflow', nativeEngineExecuted: false });
}
