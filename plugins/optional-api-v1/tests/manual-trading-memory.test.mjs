import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createTradingMemory, MEMORY_LIMITS } from '../packages/manual-trading/memory.js';
import { createService as createResearchService } from '../packages/financial-research/service.js';
import { records, closeRecords } from '../packages/manual-trading/records.js';
import { records as researchRecords, closeRecords as closeResearchRecords } from '../packages/financial-research/records.js';
import { createCapabilities as createResearchCapabilities } from '../packages/financial-research/index.js';
import { publishRows } from '../packages/financial-research/resource-files.js';
import { datasetSnapshot } from '../packages/manual-trading/data.js';
import { JudgmentService as StandaloneJudgmentService } from '../packages/judgment-evolution/service.js';
import { createCapabilities as createStandaloneJudgmentCapabilities } from '../packages/judgment-evolution/tools.js';
import { setInstance as setJudgmentInstance } from '../packages/judgment-evolution/state.js';

import { hostRoot, nativeHost } from './host-v2-fixture.mjs';

const T0 = Date.parse('2026-10-13T12:00:00Z');
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'sesame-memory-'));
  let time = T0; const disposers = [], datasets = new Map();
  const host = { context: { kind: 'main', sessionId: 'conv_main', pluginId: 'sesame/manual-trading', storageRoot: join(directory, 'private') } };
  const readDataset = id => structuredClone(datasets.get(id));
  t.after(async () => { for (const dispose of disposers) await dispose(); closeRecords(host); assert.ok(resolve(directory).startsWith(resolve(join(tmpdir(), 'sesame-memory-')))); rmSync(directory, { recursive: true, force: true }); });
  return { host, directory, datasets, now: () => time, setTime: value => { time = value; },
    memory: () => createTradingMemory(host, { now: () => time, datasetReader: readDataset }), reopen: () => { closeRecords(host); records(host); }, onDispose: fn => disposers.push(fn),
    snapshot: () => ({ sessions: new Map([['conv_main', { kind: 'main', activeResponseId: null }], ['child', { kind: 'subagent' }]]), messages: new Map(), datasets: new Map([...datasets].map(([id, value]) => [id, structuredClone(value)])), enabled: true }),
    data: (id = 'quotes', overrides = {}) => { const data = { id,
      rows: [{ symbol: 'EURUSD', observedAt: time, close: 1.11 }],
      provenance: { source_kind: 'external', provider: 'https://prices.example/quotes', as_of: new Date(time).toISOString() }, ...overrides }; datasets.set(id, structuredClone(data)); return structuredClone(data); },
  };
}
const run = (extra = {}) => ({ id: 'run-1', executionSources: [{pluginId:'custom/execution',provider:'arbitrary-native/fill-history'}], planId: 'plan-1', accountId: 'account-1', createdAt: T0,
  snapshot: { symbol: 'EURUSD', capturedAt: T0, quote: { bid: 1.1, ask: 1.101, sourceTimeMs: T0 }, positions: [] },
  decision: { action: 'hold', targets: [{ symbol: 'EURUSD', weight: 0.25 }] },
  reports: [{ role: 'risk', model: 'model-fixture', report: 'Existing target weight remains a proposal, not an executed order.' }], ...extra });
const ref = (extra = {}) => ({ datasetId: 'quotes', kind: 'market', observedAtField: 'observedAt', symbolField: 'symbol', ...extra });

test('decision snapshots, team/model reports and reviews survive private plugin database reopen', t => {
  const f = fixture(t), memory = f.memory(), original = run();
  const saved = memory.record(original);
  original.snapshot.quote.bid = 900;
  f.setTime(T0 + 60000); f.data();
  const reviewed = memory.review({ runId: saved.id, evidence: [ref()], reflection: 'No order was executed; compare only the observed price movement.' });
  f.reopen();
  const context = f.memory().context({ planId: 'plan-1', accountId: 'account-1', symbols: ['EURUSD'] });
  assert.equal(context.cases[0].snapshot.quote.bid, 1.1);
  assert.equal(context.cases[0].reports[0].model, 'model-fixture');
  assert.equal(context.cases[0].review.id, reviewed.id);
  assert.equal(context.lessons[0].reflection, reviewed.reflection);
  context.cases[0].snapshot.quote.bid = 800;
  assert.equal(f.memory().context({ accountId: 'account-1' }).cases[0].snapshot.quote.bid, 1.1);
});

test('context checks when records became known as well as source event times', t => {
  const f = fixture(t), memory = f.memory(); memory.record(run());
  f.setTime(T0 + 60000); f.data();
  f.setTime(T0 + 120000);
  memory.review({ runId: 'run-1', asOf: T0 + 60000, evidence: [ref()], reflection: 'Only available after this review was actually recorded.' });
  const past = memory.context({ accountId: 'account-1', asOf: T0 + 90000 });
  assert.equal(past.cases.length, 1); assert.equal(past.cases[0].review, null); assert.deepEqual(past.lessons, []);
  assert.equal(memory.context({ accountId: 'account-1' }).lessons.length, 1);
  memory.record(run({ id: 'late-import', createdAt: T0 + 1000 }));
  assert.equal(memory.context({ accountId: 'account-1', asOf: T0 + 90000 }).cases.length, 1, 'a backdated import was not known in the past');
  assert.throws(() => memory.context({ accountId: 'account-1', asOf: T0 + 120001 }), { code: 'FUTURE_EVIDENCE' });
});

test('account, conversation and symbol isolation survive relevant cross-plan retrieval', t => {
  const f = fixture(t), memory = f.memory();
  memory.record(run()); memory.record(run({ id: 'other-account', accountId: 'account-2' }));
  memory.record(run({ id: 'other-plan', planId: 'plan-2' }));
  memory.record(run({ id: 'other-symbol', snapshot: { symbol: 'GBPUSD', capturedAt: T0 }, decision: { action: 'hold' } }));
  f.host.context.sessionId = 'conv_other'; memory.record(run({ id: 'other-conversation' }));
  f.host.context.sessionId = 'conv_main';
  const context = memory.context({ planId: 'plan-1', accountId: 'account-1', symbols: ['EURUSD'] });
  assert.deepEqual(context.cases.map(item => item.id), ['run-1', 'other-plan']);
  assert.throws(() => memory.review({ runId: 'other-conversation', evidence: [ref()], reflection: 'foreign' }), { code: 'FORBIDDEN' });
  f.host.context.kind = 'subagent';
  assert.throws(() => memory.context({ accountId: 'account-1' }), { code: 'FORBIDDEN' });
});

test('repeated decisions and evidence reviews are idempotent without overwriting history', t => {
  const f = fixture(t), memory = f.memory();
  const first = memory.record(run()); f.setTime(T0 + 1000);
  assert.deepEqual(memory.record(run()), first);
  assert.throws(() => memory.record(run({ decision: { action: 'sell' } })), { code: 'IDEMPOTENCY_CONFLICT' });
  f.data(); const args = { runId: 'run-1', evidence: [ref(), ref()], reflection: 'Repeated evidence is one observation.' };
  const review = memory.review(args); f.setTime(T0 + 2000);
  assert.equal(memory.review({ ...args, evidence: [ref()] }).id, review.id);
  assert.equal(review.evidence.length, 1); assert.equal(records(f.host).list('trading_memory_reviews').length, 1);
  assert.equal(memory.context({ accountId: 'account-1' }).lessons.length, 1);
});

test('service memory binds its trusted owner once and rejects subagent owner spoofing', t => {
  const f = fixture(t);
  f.host.context.kind = 'service';
  const own = createTradingMemory(f.host, { now: f.now, ownerConversationId: 'conv_main' });
  const other = createTradingMemory(f.host, { now: f.now, ownerConversationId: 'conv_other' });
  own.record(run({ conversationId: 'conv_other' }));
  other.record(run({ id: 'other-service-run' }));
  assert.deepEqual(own.context({ accountId: 'account-1', ownerConversationId: 'conv_other' }).cases.map(item => item.id), ['run-1']);
  assert.equal(own.context({ accountId: 'account-1' }).cases[0].conversationId, 'conv_main');
  assert.throws(() => own.review({ runId: 'other-service-run', evidence: [ref()], reflection: 'foreign' }), { code: 'FORBIDDEN' });
  assert.throws(() => createTradingMemory(f.host, { now: f.now }).context({ accountId: 'account-1' }), { code: 'FORBIDDEN' });
  f.host.context.kind = 'subagent';
  assert.throws(() => createTradingMemory(f.host, { now: f.now, ownerConversationId: 'conv_main' }), { code: 'FORBIDDEN' });
  assert.throws(() => createTradingMemory(f.host, { now: f.now }).context({ accountId: 'account-1', ownerConversationId: 'conv_main' }), { code: 'FORBIDDEN' });
});

test('targets, unexecuted decisions and market movement never become actual trading returns', t => {
  const f = fixture(t), memory = f.memory(); memory.record(run());
  f.setTime(T0 + 1000); f.data();
  const reviewed = memory.review({ runId: 'run-1', evidence: [ref()], reflection: 'Target weight was unchanged; price rose without proof of an actual position.' });
  assert.equal(reviewed.outcome.executionConfirmed, false);
  assert.equal(reviewed.outcome.realizedPnl, null); assert.equal(reviewed.outcome.actualTradeReturn, null);
  assert.throws(() => memory.review({ runId: 'run-1', evidence: [{ kind: 'execution', target: 1.2, pnl: 100 }], reflection: 'invented' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => memory.review({ runId: 'run-1', evidence: [ref({ kind: 'execution' })], reflection: 'quote mislabeled as a fill' }), { code: 'INVALID_EVIDENCE' });
});

test('reviews reject future, synthetic, wrong-symbol and wrong-account evidence', t => {
  const f = fixture(t), memory = f.memory(); memory.record(run()); f.setTime(T0 + 1000);
  const review = evidence => memory.review({ runId: 'run-1', evidence: [evidence], reflection: 'source check' });
  f.data('future', { provenance: { source_kind: 'external', provider: 'prices', as_of: new Date(T0 + 1001).toISOString() } });
  assert.throws(() => review(ref({ datasetId: 'future' })), { code: 'FUTURE_EVIDENCE' });
  f.data('prediction', { rows: [{ symbol: 'EURUSD', observedAt: T0 + 2000, close: 2 }] });
  assert.throws(() => review(ref({ datasetId: 'prediction' })), { code: 'FUTURE_EVIDENCE' });
  f.data('fake', { provenance: { source_kind: 'synthetic', provider: 'prices', as_of: new Date(T0 + 1000).toISOString() } });
  f.data('derived', { input_ids: ['fake'] });
  assert.throws(() => review(ref({ datasetId: 'derived' })), { code: 'INVALID_EVIDENCE' });
  f.data('wrong-symbol', { rows: [{ symbol: 'GBPUSD', observedAt: T0 + 1000 }] });
  assert.throws(() => review(ref({ datasetId: 'wrong-symbol' })), { code: 'INVALID_EVIDENCE' });
  f.data('wrong-account', { rows: [{ symbol: 'EURUSD', account: 'account-2', observedAt: T0 + 1000 }] });
  assert.throws(() => review(ref({ datasetId: 'wrong-account', accountIdField: 'account' })), { code: 'ACCOUNT_MISMATCH' });
  assert.equal(records(f.host).list('trading_memory_reviews').length, 0);
});

test('later derived evidence cannot inherit an earlier root source timestamp to enter a past review', t => {
  const f = fixture(t), memory = f.memory(); memory.record(run());
  f.setTime(T0 + 60000); const earlier = f.data('earlier');
  f.setTime(T0 + 180000);
  f.data('derived-later', { input_ids: [earlier.id], rows: earlier.rows,
    provenance: { source_kind: 'derived', as_of: new Date(f.now()).toISOString() } });
  const review = { runId: 'run-1', asOf: T0 + 90000, evidence: [ref({ datasetId: 'derived-later' })], reflection: 'The source existed earlier, but this derived observation did not.' };
  assert.throws(() => memory.review(review), { code: 'FUTURE_EVIDENCE' });
  f.data('derived-later', { input_ids: [earlier.id], rows: earlier.rows,
    provenance: { source_kind: 'derived', as_of: new Date(T0 + 60000).toISOString(), retrieved_at: new Date(f.now()).toISOString() } });
  assert.throws(() => memory.review(review), { code: 'FUTURE_EVIDENCE' });
  const accepted = memory.review({ ...review, asOf: f.now() });
  assert.equal(accepted.evidence[0].roots[0].datasetId, earlier.id);
  assert.equal(memory.context({ accountId: 'account-1', asOf: T0 + 90000 }).lessons.length, 0);
});

test('native fill evidence must identify its account and decision; a fill still does not establish portfolio P&L', t => {
  const f = fixture(t), memory = f.memory(); memory.record(run()); f.setTime(T0 + 1000);
  const rows = [{ symbol: 'EURUSD', account: 'account-1', decisionRun: 'run-1', observedAt: T0 + 1000, ticket: 17, volume: 0.1, price: 1.1 }];
  f.data('fills', { rows, producer_plugin_id: 'custom/execution', provenance: { source_kind: 'external', provider: 'arbitrary-native/fill-history', as_of: new Date(T0 + 1000).toISOString() } });
  const evidence = ref({ datasetId: 'fills', kind: 'execution', accountIdField: 'account', runIdField: 'decisionRun', executionIdField: 'ticket', quantityField: 'volume', priceField: 'price' });
  const result = memory.review({ runId: 'run-1', evidence: [evidence], reflection: 'The source confirms an opening fill; closing fills and costs remain unreconciled.' });
  assert.equal(result.outcome.executionConfirmed, true); assert.equal(result.outcome.realizedPnl, null);
  f.data('spoofed-producer', { rows, producer_plugin_id: 'custom/research', provenance: { source_kind: 'external', provider: 'arbitrary-native/fill-history', as_of: new Date(T0 + 1000).toISOString() } });
  assert.throws(() => memory.review({ runId: 'run-1', evidence: [{ ...evidence, datasetId: 'spoofed-producer' }], reflection: 'Matching provider text does not establish the producing capability.' }), { code: 'INVALID_EVIDENCE' });
  rows[0].decisionRun = 'another-run'; f.data('unrelated-fill', { rows, producer_plugin_id: 'custom/execution', provenance: { source_kind: 'external', provider: 'arbitrary-native/fill-history', as_of: new Date(T0 + 1000).toISOString() } });
  assert.throws(() => memory.review({ runId: 'run-1', evidence: [{ ...evidence, datasetId: 'unrelated-fill' }], reflection: 'unrelated fill' }), { code: 'INVALID_EVIDENCE' });
});

for (const populated of [false, true]) test(`derived execution rows cannot borrow authority from ${populated ? 'an altered native fill' : 'an empty native source'}`, t => {
  const f = fixture(t), memory = f.memory();
  memory.record(run({ executionAccountId: 'native-account-1' })); f.setTime(T0 + 1000);
  const nativeRow = { symbol: 'EURUSD', account: 'native-account-1', decisionRun: 'run-1', observedAt: f.now(), ticket: 17, volume: 0.1, price: 1.1 };
  const provenance = { source_kind: 'external', provider: 'arbitrary-native/fill-history', as_of: new Date(f.now()).toISOString() };
  f.data('native-root', { rows: populated ? [nativeRow] : [], producer_plugin_id: 'custom/execution', provenance });
  f.data('derived-fill', {
    input_ids: ['native-root'], rows: [{ ...nativeRow, ticket: 999, volume: 10, price: 123 }],
    producer_plugin_id: populated ? 'custom/execution' : 'custom/research',
    provenance: { ...provenance, source_kind: populated ? 'external' : 'derived' },
  });
  const evidence = ref({ datasetId: 'derived-fill', kind: 'execution', accountIdField: 'account', runIdField: 'decisionRun', executionIdField: 'ticket', quantityField: 'volume', priceField: 'price' });
  assert.throws(() => memory.review({ runId: 'run-1', evidence: [evidence], reflection: 'A derived row cannot establish an original fill.' }), { code: 'INVALID_EVIDENCE' });
  assert.equal(records(f.host).list('trading_memory_reviews').length, 0);
});

test('derived market and observation rows remain usable without confirming execution', t => {
  const f = fixture(t), memory = f.memory(); memory.record(run()); f.setTime(T0 + 1000);
  const source = f.data('source-quotes');
  f.data('derived-observation', { input_ids: [source.id], rows: [{ ...source.rows[0], note: 'Research interpretation' }],
    producer_plugin_id: 'custom/research', provenance: { source_kind: 'derived', as_of: new Date(f.now()).toISOString() } });
  for (const kind of ['market', 'observation']) {
    const result = memory.review({ runId: 'run-1', evidence: [ref({ datasetId: 'derived-observation', kind })], reflection: `Derived ${kind} evidence is not a fill.` });
    assert.equal(result.evidence[0].roots[0].datasetId, source.id);
    assert.equal(result.evidence[0].row.note, 'Research interpretation');
    assert.equal(result.outcome.executionConfirmed, false);
    assert.equal(result.outcome.basis, 'source_observations_only');
  }
});

test('decision time admits fills before episode completion without making the episode visible early', t => {
  const f = fixture(t), memory = f.memory();
  f.setTime(T0 + 80000);
  f.data('during-execution', { producer_plugin_id: 'custom/execution', rows: [{ symbol: 'EURUSD', account: 'account-1', decisionRun: 'run-1', observedAt: f.now(), ticket: 21, volume: 0.1, price: 1.1 }],
    provenance: { source_kind: 'external', provider: 'arbitrary-native/fill-history', as_of: new Date(f.now()).toISOString() } });
  f.setTime(T0 + 120000);
  memory.record(run({ decisionAt: T0 + 60000, createdAt: f.now(), reports: [{ role: 'executor', observedAt: f.now(), report: 'Later execution report was not available at decision time.' }] }));
  assert.equal(memory.context({ accountId: 'account-1', asOf: T0 + 90000 }).cases.length, 0);
  const evidence = ref({ datasetId: 'during-execution', kind: 'execution', accountIdField: 'account', runIdField: 'decisionRun', executionIdField: 'ticket', quantityField: 'volume', priceField: 'price' });
  const reviewed = memory.review({ runId: 'run-1', evidence: [evidence], reflection: 'This actual source fill followed the decision but preceded the final team report.' });
  assert.equal(reviewed.outcome.executionConfirmed, true); assert.equal(reviewed.outcome.actualTradeReturn, null);
  assert.equal(memory.context({ accountId: 'account-1' }).cases[0].decisionAt, T0 + 60000);
  f.data('too-early', { rows: [{ symbol: 'EURUSD', observedAt: T0 + 30000 }] });
  assert.throws(() => memory.review({ runId: 'run-1', evidence: [ref({ datasetId: 'too-early' })], reflection: 'This observation preceded the actual decision.' }), { code: 'FUTURE_EVIDENCE' });
  assert.throws(() => memory.record(run({ id: 'late-decision', createdAt: f.now(), decisionAt: f.now() + 1 })), { code: 'FUTURE_EVIDENCE' });
  assert.throws(() => memory.record(run({ id: 'invalid-decision', createdAt: f.now(), decisionAt: T0 + 0.5 })), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => memory.record(run({ id: 'future-snapshot', createdAt: f.now(), decisionAt: T0 + 60000, snapshot: { symbol: 'EURUSD', capturedAt: T0 + 70000 } })), { code: 'FUTURE_EVIDENCE' });
});

test('financial research source ancestry supports time-bounded memory review through actual data.query', { skip: !hostRoot }, async t => {
  const f = fixture(t), memory = f.memory(); memory.record(run());
  const native = await nativeHost(t), host = native.attach('financial-research', createResearchCapabilities);
  native.onDispose(() => closeResearchRecords(host));
  f.setTime(T0 + 120000);
  const published = new Date(T0 + 60000).toISOString(), acquired = new Date(f.now()).toISOString();
  const research = createResearchService(host, { now: f.now, env: { FMP_API_KEY: 'fixture-only-no-network' }, fetch: async address => {
    assert.equal(new URL(address).pathname, '/stable/news/stock');
    return new Response(JSON.stringify(Array.from({ length: 3 }, (_, index) => ({ symbol: 'EURUSD', publishedDate: published, title: `Source observation after the saved decision ${index}`, body: 'x'.repeat(30000), url: 'https://news.example/observed-event' }))));
  } });
  const evidence = await research.query({ kind: 'news', symbol: 'EURUSD', limit: 3 });
  assert.ok(evidence.dataset_id); assert.ok(evidence.raw_dataset_id);
  const saved = researchRecords(host).get('datasets', evidence.dataset_id);
  assert.deepEqual(saved.input_ids, [evidence.raw_dataset_id]);
  assert.equal(saved.provenance.source_kind, 'external'); assert.equal(saved.provenance.as_of, acquired);
  const reference = { ...evidence.evidence, kind: 'observation', observedAtField: 'observed_at', symbolField: 'data.symbol' };
  assert.equal(reference.source.providerId, 'sesame/financial-research#evidence');
  const snapshot = await datasetSnapshot(host, [reference]);
  assert.equal(snapshot.get(evidence.dataset_id).rows.length, 3);
  assert.equal(snapshot.get(evidence.dataset_id).rows[0].data.body.length, 30000, 'the source returns full frozen rows, not the shortened Agent preview');
  const first = await host.data.query({ source: reference.source, input: reference.query, limit: 1 });
  assert.equal(first.items.length, 1); assert.ok(first.nextCursor);
  assert.deepEqual(await host.data.query({ source: reference.source, input: reference.query, limit: 1, cursor: first.nextCursor }), await host.data.query({ source: reference.source, input: reference.query, limit: 1, cursor: first.nextCursor }));
  await assert.rejects(datasetSnapshot(host, [{ ...reference, source: { ...reference.source, revision: 'stale' } }]), { code: 'STALE_REVISION' });
  assert.deepEqual(native.store.list('dataset'), [], 'evidence remains in the producer private store; no host dataset registration');
  assert.equal(snapshot.get(evidence.raw_dataset_id).producer_plugin_id, 'sesame/financial-research');
  assert.throws(() => memory.review({ runId: 'run-1', asOf: T0 + 90000, evidence: [reference], reflection: 'Cannot use an earlier publication date to backdate our knowledge.' }, snapshot), { code: 'FUTURE_EVIDENCE' });
  const reviewed = memory.review({ runId: 'run-1', evidence: [reference], reflection: 'This later news is a source observation; the target remains unexecuted.' }, snapshot);
  assert.equal(reviewed.evidence[0].roots[0].datasetId, evidence.raw_dataset_id);
  assert.equal(reviewed.evidence[0].roots[0].provider, 'fmp'); assert.equal(reviewed.evidence[0].row.data.title, saved.rows[0].data.title);
  assert.equal(reviewed.outcome.executionConfirmed, false); assert.equal(reviewed.outcome.realizedPnl, null);
  assert.equal(memory.context({ accountId: 'account-1', asOf: T0 + 90000 }).lessons.length, 0);
  assert.equal(memory.context({ accountId: 'account-1' }).lessons.length, 1);
});

test('snapshot size limits are explicit and source snapshots cannot contain future observations', t => {
  const f = fixture(t), memory = f.memory();
  assert.throws(() => memory.record(run({ snapshot: { symbol: 'EURUSD', capturedAt: T0 + 1 } })), { code: 'FUTURE_EVIDENCE' });
  assert.throws(() => memory.record(run({ reports: [{ report: 'x'.repeat(MEMORY_LIMITS.runBytes) }] })), { code: 'MEMORY_LIMIT' });
  memory.record(run({ reports: [{ role: 'research', report: 'x'.repeat(140000) }] }));
  memory.record(run({ id: 'run-2', reports: [{ role: 'research', report: 'y'.repeat(140000) }] }));
  const context = memory.context({ accountId: 'account-1' });
  assert.equal(context.cases.length, 1); assert.equal(context.omittedDueToBudget, 1);
});

const prediction = { command_id: 'forecast-1', claim: 'EURUSD closes above 1.1', topic: 'price', regime: 'range', rationale: 'Fixture prospective statement with an explicit invalidation threshold.', probability: 0.6,
  due_at: new Date(T0 + 3600000).toISOString(), verification: { provider: 'https://prices.example/quotes', metric: 'close', observed_at_field: 'observedAt', op: 'gt', target: 1.1, selector: { symbol: 'EURUSD' } } };

test('independent judgment service keeps frozen verification, reflection, candidate rules and its own durable state', async t => {
  const f = fixture(t), options = { clock: () => new Date(f.now()), snapshot: f.snapshot };
  const host = { context: { ...f.host.context, pluginId: 'sesame/judgment-evolution', storageRoot: join(f.directory, 'judgment-evolution') } };
  let service = new StandaloneJudgmentService(host, options).init(); f.onDispose(() => service.close());
  assert.equal(service.directory, join(host.context.storageRoot, 'exports'));
  const item = service.record('conv_main', prediction);
  assert.throws(() => service.record('conv_main', { ...prediction, probability: 0.9 }), /command_id/);
  assert.throws(() => service.record('child', { ...prediction, command_id: 'child' }), /仅供主/);
  f.setTime(T0 + 3600000);
  const dataset = f.data('settled', { rows: [{ symbol: 'EURUSD', observedAt: new Date(f.now()).toISOString(), close: 1.09 }] });
  const resolved = service.resolve('conv_main', { judgment_id: item.id, dataset_id: dataset.id });
  assert.equal(resolved.review.evidence.outcome, 0); assert.equal(resolved.review.brier, 0.36);
  service.reflect('conv_main', { judgment_id: item.id, analysis: 'The frozen threshold failed. One event cannot establish a robust trading rule.', no_change_reason: 'Maintain existing policy pending prospective independent samples.' });
  const rule = service.proposeRule('conv_main', { command_id: 'rule-1', title: 'A tentative range filter', guideline: 'Check the range boundary before forecasting a breakout.', topic: 'price', regime: 'range', limitations: 'Only a hypothesis from one case.', evidence_ids: [item.id] });
  assert.equal(rule.status, 'candidate');
  assert.equal(service.reviewQueue('conv_main').statistics.registered, 1);
  await service.close(); service = new StandaloneJudgmentService(host, options).init();
  assert.equal(service.read('conv_main', item.id).review.semantic.no_change_reason, 'Maintain existing policy pending prospective independent samples.');
  assert.equal(service.rules('conv_main').items[0].status, 'candidate');
  assert.match(readFileSync(join(service.directory, 'CRITERIA.md'), 'utf8'), /尚无通过/);
});

test('independent judgment factory owns the thirteen business capabilities', async () => {
  const calls = [], host = { context: { sessionId: 'conv_main', storageRoot: 'judgment-factory' } }, service = { invoke: (context, method, args) => { calls.push([context, method, args]); return { items: [] }; } };
  setJudgmentInstance(host, service);
  try {
    const tools = createStandaloneJudgmentCapabilities(host).filter(tool => !['judgment_activate', 'judgment_dispose', 'judgment_after_turn'].includes(tool.name));
    assert.equal(tools.length, 13); assert.ok(tools.every(tool => tool.name.startsWith('judgment_')));
    assert.deepEqual(await tools.find(tool => tool.name === 'judgment_rules').execute({}), { items: [] });
    assert.deepEqual(calls, [[host, 'rules', ['conv_main', {}]]]);
  } finally { setJudgmentInstance(host, null); }
});

test('independent judgment publishes fixed criteria readable through the Agent resource capability', { skip: !hostRoot }, async t => {
  const native = await nativeHost(t);
  const host = native.attach('judgment-evolution', createStandaloneJudgmentCapabilities);
  const service = new StandaloneJudgmentService(host).init(); setJudgmentInstance(host, service);
  native.onDispose(async () => { await service.close(); setJudgmentInstance(host, null); });
  const result = await native.call('sesame/judgment-evolution#judgment_rules', {});
  assert.equal(result.criteria.kind, 'resource'); assert.equal(result.criteria.schemaVersion, '1.0.0');
  assert.equal(result.path, undefined); assert.equal(result.criteria_path, undefined);
  const text = await native.call('host.resources.read', { ref: result.criteria, part: 'content', entry: 'CRITERIA.md' });
  assert.match(text.content, /尚无通过/);
  assert.deepEqual((await native.call('sesame/judgment-evolution#judgment_rules', {})).criteria, result.criteria);
  const draft = await host.resources.create({ kind: 'blob', lifetime: 'durable', name: 'private.md', source: { content: 'Private draft' } });
  await assert.rejects(native.call('host.resources.read', { ref: draft, part: 'content' }), { code: 'FORBIDDEN' });
});

test('independent judgment resolves actual financial source evidence and published artifact ancestry', { skip: !hostRoot }, async t => {
  const native = await nativeHost(t), researchHost = native.attach('financial-research', createResearchCapabilities); let time = T0;
  native.onDispose(() => closeResearchRecords(researchHost));
  const host = native.attach('judgment-evolution', createStandaloneJudgmentCapabilities);
  const service = new StandaloneJudgmentService(host, { clock: () => new Date(time) }).init(); setJudgmentInstance(host, service);
  native.onDispose(async () => { await service.close(); setJudgmentInstance(host, null); });
  const call = (name, input) => native.call(`sesame/judgment-evolution#judgment_${name}`, input);
  const forecast = { ...prediction, verification: { provider: 'fmp', metric: 'data.title', observed_at_field: 'observed_at', op: 'eq', target: 'Confirmed source publication', selector: { 'data.symbol': 'EURUSD' } } };
  const sourceCase = await call('record', forecast), artifactCase = await call('record', { ...forecast, command_id: 'forecast-artifact' });
  time = T0 + 3660000;
  const research = createResearchService(researchHost, { now: () => time, env: { FMP_API_KEY: 'fixture-only-no-network' }, fetch: async () => new Response(JSON.stringify([{ symbol: 'EURUSD', publishedDate: forecast.due_at, title: 'Confirmed source publication', url: 'https://news.example/fixed' }])) });
  const evidence = await research.query({ kind: 'news', symbol: 'EURUSD', limit: 1 });
  const resolved = await call('resolve', { judgment_id: sourceCase.id, dataset_id: evidence.dataset_id, source: evidence.evidence.source, query: evidence.evidence.query });
  assert.equal(resolved.review.evidence.outcome, 1); assert.equal(resolved.review.evidence.roots[0].dataset_id, evidence.raw_dataset_id);
  const entered = await publishRows(researchHost, { title: 'User-entered claim', rows: researchRecords(researchHost).get('datasets', evidence.dataset_id).rows,
    provenance: { kind: 'user_input', source_kind: 'user_input', provider: 'fmp', as_of: new Date(time).toISOString() } });
  await assert.rejects(call('resolve', { judgment_id: artifactCase.id, dataset_id: entered.id, artifact: entered }), /手工|合成|来源/);
  const reviewed = await call('review_due', { evidence: [{ datasetId: evidence.ref.id, artifact: evidence.ref }] });
  assert.equal(reviewed.statistics.resolved, 2);
  const second = await call('read', { judgment_id: artifactCase.id });
  assert.equal(second.review.evidence.dataset_id, evidence.ref.id); assert.equal(second.review.evidence.roots[0].dataset_id, evidence.raw_ref.id);
  assert.deepEqual(native.store.list('dataset'), [], 'only explicit data ports and immutable artifacts bridge plugin-owned evidence');
  const frozen = await datasetSnapshot(host, [evidence.ref]);
  assert.equal(frozen.get(evidence.ref.id).producer_plugin_id, 'sesame/financial-research');
  assert.equal(frozen.get(evidence.raw_ref.id).provenance.source_kind, 'external');
  await assert.rejects(datasetSnapshot(host, [{ ...evidence.ref, digest: `sha256:${'0'.repeat(64)}` }]), { code: 'NOT_FOUND' });
});
