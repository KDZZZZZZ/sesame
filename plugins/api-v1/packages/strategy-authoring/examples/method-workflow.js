import { createPipelineFixture } from './pipeline-fixture.js';

/** Fictional, fully reproducible method example. All artifact refs must be supplied by the host. */
export function createMethodWorkflow(input) {
  const base = createPipelineFixture(input), now = base.asOf.unixMs, time = unixMs => ({ basis: 'utc', unixMs }), evidence = input.evidence;
  const instruments = base.target.items.map(item => item.instrument);
  base.events[0].confidence = '0.25'; base.events[1].confidence = '0.75';
  return {
    schemaVersion: '1.1.0', id: 'method-demo-target', asOf: base.asOf, scope: base.scope, strategySource: input.strategySource, events: base.events, guards: [], advice: [],
    universe: { candidates: instruments.map((instrument, i) => ({ instrument, fields: { liquidity: i === 0 ? '1000' : '2000', market: 'demo' }, observedAt: time(now - 100), availableAt: time(now), evidence: [evidence] })), rank: [{ field: 'liquidity', type: 'decimal', order: 'desc', missing: 'exclude' }], topN: 2, previous: [], maxDataAgeMs: 1000 },
    portfolio: { method: 'equal', budget: { value: '1000', currency: 'USD' }, budgetBasis: 'cash', reserveFraction: '0', feeRate: '0', signalAggregation: 'latest', inactiveSignalPolicy: 'hold', removedInstrumentPolicy: 'hold', maxDataAgeMs: 1000, validUntil: time(now + 60000), evidence: [evidence],
      instruments: instruments.map((instrument, i) => ({ instrument, unit: 'share', price: { value: i === 0 ? '100' : '10', currency: i === 0 ? 'USD' : 'EUR' }, multiplier: '1', step: '1', minimum: '1', volatility: i === 0 ? '0.1' : '0.2', groups: ['demo-market'], valuation: 'linear', observedAt: time(now - 100), availableAt: time(now), evidence: [evidence] })),
      fx: [{ from: 'EUR', to: 'USD', rate: '2', observedAt: time(now - 100), availableAt: time(now), evidence: [evidence] }],
    },
    policy: base.policy,
    portfolioRisk: { policyRef: evidence, equity: { currency: 'USD', historyStart: time(now - 86400000), complete: true, observations: [{ id: 'equity-start', value: '1000', observedAt: time(now - 86400000), availableAt: time(now - 86400000), evidence: [evidence] }, { id: 'equity-now', value: '1000', observedAt: time(now), availableAt: time(now), evidence: [evidence] }] }, maxEquityAgeMs: 1000, maxDrawdown: '0.2', maxGrossExposure: '1', maxAbsNetExposure: '1', groupLimits: [{ group: 'demo-market', maxGrossExposure: '1' }] },
    snapshot: base.snapshot,
    capabilities: { ...base.capabilities, features: { marketOrder: 'native', limitOrder: 'native', stopOrder: 'native', stopLimitOrder: 'native', netPosition: 'native', reduceOnly: 'native', modifyOrder: 'native', cancelOrder: 'native', ocoQuantityReduction: 'native' } },
    execution: { config: {}, events: [] },
  };
}
