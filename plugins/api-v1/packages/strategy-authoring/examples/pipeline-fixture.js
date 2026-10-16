import { artifactRef, check, text } from '@sesame/plugin-sdk/protocol';

/** Fictional two-instrument teaching input. Publish a real demo resource/source first,
 * then inject those exact immutable references. This factory invents no artifact IDs.
 * Timestamps below are a simulated timeline, not historic availability evidence. */
export function createPipelineFixture({ strategySource, targetProfile, strategyId, evidence, asOf = 1700000000000 }) {
  artifactRef(strategySource); artifactRef(targetProfile); artifactRef(evidence); text(strategyId);
  check(strategySource.kind === 'strategy.source', 'Teaching fixture requires a fixed strategy.source');
  check(targetProfile.kind === 'strategy.target', 'Teaching fixture requires a fixed strategy.target');
  const t = unixMs => ({ basis: 'utc', unixMs });
  const scope = { strategyId, runId: 'pipeline-demo-run', account: { connectionId: 'demo', accountId: 'demo-account' } };
  const instruments = [{ sourceId: 'demo', instrumentId: 'DEMO_A' }, { sourceId: 'demo', instrumentId: 'DEMO_B' }];
  const source = { kind: 'algorithm', id: 'demo-alpha', version: '1', configurationDigest: evidence.digest };
  return {
    schemaVersion: '1.0.0', asOf: t(asOf), scope,
    events: instruments.map((instrument, index) => ({ schemaVersion: '1.0.0', id: `demo-signal-${index}`, sequence: index, revision: 1, channel: 'trend', kind: 'signal', scope: { ...scope, instrument }, source, occurredAt: t(asOf - 1000), generatedAt: t(asOf - 100), availableAt: t(asOf), expiresAt: t(asOf + 120000), dataCutoffAt: t(asOf - 1000), inputs: [{ ref: evidence, availableAt: t(asOf - 1000) }], direction: 'long', confidence: '0.7' })),
    guards: [], advice: [],
    target: { schemaVersion: '1.0.0', id: 'demo-target', scope, createdAt: t(asOf), validUntil: t(asOf + 60000), strategySource, evidence: [evidence], items: instruments.map((instrument, index) => ({ instrument, quantity: { value: index === 0 ? '10' : '2', unit: 'share' }, purpose: 'allocate', signalRefs: [{ id: `demo-signal-${index}`, revision: 1 }], requirements: [] })) },
    policy: { id: 'demo-fixed-policy', scope, evidence, validFrom: t(asOf - 1000), validUntil: t(asOf + 120000), maxSignalAgeMs: 60000, maxDataAgeMs: 60000, cooldownMs: 10000, limits: instruments.map(instrument => ({ instrument, unit: 'share', maxAbsPosition: '100', maxOrderQuantity: '100', allowShort: false, maxSnapshotAgeMs: 1000 })) },
    snapshot: { id: 'demo-snapshot', scope, observedAt: t(asOf), availableAt: t(asOf), complete: { positions: true, workingOrders: true, pendingIntents: true }, positions: [], workingOrders: [], pendingIntents: [], evidence: [evidence] },
    capabilities: { profile: targetProfile, features: { marketOrder: 'native', netPosition: 'native' }, instruments: instruments.map(instrument => ({ instrument, unit: 'share', step: '1', minimum: '1' })) },
  };
}
