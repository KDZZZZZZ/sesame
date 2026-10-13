import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createTradingMemory, MEMORY_LIMITS } from '../packages/manual-trading/memory.js';
import { JudgmentService } from '../packages/manual-trading/judgment/service.js';
import { createJudgmentTools, definitions } from '../packages/manual-trading/judgment/tools.js';
import { createService as createResearchService } from '../packages/financial-research/service.js';

const T0 = Date.parse('2026-10-13T12:00:00Z');
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'sesame-memory-'));
  let db, time = T0; const disposers = [];
  const open = () => { db = new DatabaseSync(join(directory, 'host.sqlite')); db.exec('CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))'); };
  open();
  const storage = {
    directory,
    get(kind, id) { const row = db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, id); return row ? JSON.parse(row.body) : undefined; },
    put(kind, value) { db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind, value.id, JSON.stringify(value)); return structuredClone(value); },
    list(kind) { return db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid').all(kind).map(row => JSON.parse(row.body)); },
  };
  const checkedPlugins = [];
  const host = { storage, scope: { kind: 'main', conversationId: 'conv_main' },
    datasets: { register: value => storage.put('datasets', { ...value, producer_plugin_id: 'sesame/financial-research' }), read: id => storage.get('datasets', id), list: () => storage.list('datasets') },
    tasks: { read: id => ({ scope: id === 'conv_main' ? 'main' : 'subagent', active_response_message_id: null }) },
    workspace: { root: () => join(directory, 'workspace') },
    plugins: { isActive: id => { checkedPlugins.push(id); return true; } },
    tools: { define: (name, description, properties, execute) => ({ name, description, properties, execute }) },
  };
  t.after(async () => { for (const dispose of disposers) await dispose(); db.close(); assert.ok(resolve(directory).startsWith(resolve(join(tmpdir(), 'sesame-memory-')))); rmSync(directory, { recursive: true, force: true }); });
  return { host, checkedPlugins, directory, now: () => time, setTime: value => { time = value; },
    memory: () => createTradingMemory(host, { now: () => time }), reopen: () => { db.close(); open(); }, onDispose: fn => disposers.push(fn),
    data: (id = 'quotes', overrides = {}) => storage.put('datasets', { id,
      rows: [{ symbol: 'EURUSD', observedAt: time, close: 1.11 }],
      provenance: { source_kind: 'external', provider: 'https://prices.example/quotes', as_of: new Date(time).toISOString() }, ...overrides }),
  };
}
const run = (extra = {}) => ({ id: 'run-1', planId: 'plan-1', accountId: 'account-1', createdAt: T0,
  snapshot: { symbol: 'EURUSD', capturedAt: T0, quote: { bid: 1.1, ask: 1.101, sourceTimeMs: T0 }, positions: [] },
  decision: { action: 'hold', targets: [{ symbol: 'EURUSD', weight: 0.25 }] },
  reports: [{ role: 'risk', model: 'model-fixture', report: 'Existing target weight remains a proposal, not an executed order.' }], ...extra });
const ref = (extra = {}) => ({ datasetId: 'quotes', kind: 'market', observedAtField: 'observedAt', symbolField: 'symbol', ...extra });

test('decision snapshots, team/model reports and reviews survive real host storage reopen', t => {
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
  f.host.scope.conversationId = 'conv_other'; memory.record(run({ id: 'other-conversation' }));
  f.host.scope.conversationId = 'conv_main';
  const context = memory.context({ planId: 'plan-1', accountId: 'account-1', symbols: ['EURUSD'] });
  assert.deepEqual(context.cases.map(item => item.id), ['run-1', 'other-plan']);
  assert.throws(() => memory.review({ runId: 'other-conversation', evidence: [ref()], reflection: 'foreign' }), { code: 'FORBIDDEN' });
  f.host.scope.kind = 'subagent';
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
  assert.equal(review.evidence.length, 1); assert.equal(f.host.storage.list('trading_memory_reviews').length, 1);
  assert.equal(memory.context({ accountId: 'account-1' }).lessons.length, 1);
});

test('service memory binds its trusted owner once and rejects subagent owner spoofing', t => {
  const f = fixture(t);
  f.host.scope.kind = 'service';
  const own = createTradingMemory(f.host, { now: f.now, ownerConversationId: 'conv_main' });
  const other = createTradingMemory(f.host, { now: f.now, ownerConversationId: 'conv_other' });
  own.record(run({ conversationId: 'conv_other' }));
  other.record(run({ id: 'other-service-run' }));
  assert.deepEqual(own.context({ accountId: 'account-1', ownerConversationId: 'conv_other' }).cases.map(item => item.id), ['run-1']);
  assert.equal(own.context({ accountId: 'account-1' }).cases[0].conversationId, 'conv_main');
  assert.throws(() => own.review({ runId: 'other-service-run', evidence: [ref()], reflection: 'foreign' }), { code: 'FORBIDDEN' });
  assert.throws(() => createTradingMemory(f.host, { now: f.now }).context({ accountId: 'account-1' }), { code: 'FORBIDDEN' });
  f.host.scope.kind = 'subagent';
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
  assert.equal(f.host.storage.list('trading_memory_reviews').length, 0);
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
  f.data('fills', { rows, provenance: { source_kind: 'external', provider: 'mt5/python/history_deals_get', as_of: new Date(T0 + 1000).toISOString() } });
  const evidence = ref({ datasetId: 'fills', kind: 'execution', accountIdField: 'account', runIdField: 'decisionRun', executionIdField: 'ticket', quantityField: 'volume', priceField: 'price' });
  const result = memory.review({ runId: 'run-1', evidence: [evidence], reflection: 'The source confirms an opening fill; closing fills and costs remain unreconciled.' });
  assert.equal(result.outcome.executionConfirmed, true); assert.equal(result.outcome.realizedPnl, null);
  rows[0].decisionRun = 'another-run'; f.data('unrelated-fill', { rows, provenance: { source_kind: 'external', provider: 'mt5/python/history_deals_get', as_of: new Date(T0 + 1000).toISOString() } });
  assert.throws(() => memory.review({ runId: 'run-1', evidence: [{ ...evidence, datasetId: 'unrelated-fill' }], reflection: 'unrelated fill' }), { code: 'INVALID_EVIDENCE' });
});

test('decision time admits fills before episode completion without making the episode visible early', t => {
  const f = fixture(t), memory = f.memory();
  f.setTime(T0 + 80000);
  f.data('during-execution', { rows: [{ symbol: 'EURUSD', account: 'account-1', decisionRun: 'run-1', observedAt: f.now(), ticket: 21, volume: 0.1, price: 1.1 }],
    provenance: { source_kind: 'external', provider: 'mt5/python/history_deals_get', as_of: new Date(f.now()).toISOString() } });
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

test('financial research registered source ancestry supports time-bounded memory review without claiming execution', async t => {
  const f = fixture(t), memory = f.memory(); memory.record(run());
  f.setTime(T0 + 120000);
  const published = new Date(T0 + 60000).toISOString(), acquired = new Date(f.now()).toISOString();
  const research = createResearchService(f.host, { now: f.now, env: { FMP_API_KEY: 'fixture-only-no-network' }, fetch: async address => {
    assert.equal(new URL(address).pathname, '/stable/news/stock');
    return new Response(JSON.stringify([{ symbol: 'EURUSD', publishedDate: published, title: 'Source observation after the saved decision', url: 'https://news.example/observed-event' }]));
  } });
  const evidence = await research.query({ kind: 'news', symbol: 'EURUSD', limit: 1 });
  assert.ok(evidence.dataset_id); assert.ok(evidence.raw_dataset_id);
  const saved = f.host.datasets.read(evidence.dataset_id);
  assert.deepEqual(saved.input_ids, [evidence.raw_dataset_id]);
  assert.equal(saved.provenance.source_kind, 'external'); assert.equal(saved.provenance.as_of, acquired);
  const reference = { datasetId: evidence.dataset_id, kind: 'observation', observedAtField: 'observed_at', symbolField: 'data.symbol' };
  assert.throws(() => memory.review({ runId: 'run-1', asOf: T0 + 90000, evidence: [reference], reflection: 'Cannot use an earlier publication date to backdate our knowledge.' }), { code: 'FUTURE_EVIDENCE' });
  const reviewed = memory.review({ runId: 'run-1', evidence: [reference], reflection: 'This later news is a source observation; the target remains unexecuted.' });
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

test('migrated judgment service keeps frozen verification, reflection, candidate rules and its own durable state', async t => {
  const f = fixture(t), options = { clock: () => new Date(f.now()) };
  let service = new JudgmentService(f.host, options).init(); f.onDispose(() => service.close());
  assert.equal(service.directory, join(f.directory, 'workspace', 'manual-trading', 'judgment'));
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
  service.reviewQueue('conv_main'); assert.ok(f.checkedPlugins.includes('sesame/manual-trading'));
  await service.close(); service = new JudgmentService(f.host, options).init();
  assert.equal(service.read('conv_main', item.id).review.semantic.no_change_reason, 'Maintain existing policy pending prospective independent samples.');
  assert.equal(service.rules('conv_main').items[0].status, 'candidate');
  assert.match(readFileSync(join(service.directory, 'CRITERIA.md'), 'utf8'), /尚无通过/);
});

test('judgment tool factory takes the explicit service and publishes only manual names', () => {
  const calls = [], service = { rules: conversation => { calls.push(conversation); return { items: [] }; } };
  const tools = createJudgmentTools({ scope: { conversationId: 'conv_main' }, tools: { define: (name, description, properties, execute) => ({ name, description, properties, execute }) } }, { service });
  assert.equal(tools.length, 13); assert.ok(tools.every(tool => tool.name.startsWith('manual_judgment_')));
  assert.ok(definitions.every(([name]) => name.startsWith('manual_judgment_')));
  assert.deepEqual(tools.find(tool => tool.name === 'manual_judgment_rules').execute({}), { items: [] });
  assert.deepEqual(calls, ['conv_main']);
  assert.throws(() => new JudgmentService({}, { workspaceSubpath: '../escape' }), /相对路径/);
});
