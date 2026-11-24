import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { redact } from '../packages/memory/compaction.js';
import { memoryHost } from './fixtures/memory-host.mjs';

const integration = (name, run) => test(name, { skip: !process.env.SESAME_HOST_ROOT }, run);
const preference = '以后报告请使用中文，保留数据口径和适用范围。';
const proposal = (input, patch = {}) => ({ category: 'user/communication', scope: { kind: 'global' }, title: '报告语言与依据', summary: '报告使用中文并保留依据。', content: '报告使用中文，保留数据口径和适用范围。', evidence: 'explicit',
  citations: [{ key: input.documents[0].key, quote: input.documents[0].text.slice(0, 100) }], ...patch });

async function fixture(t, responder = input => ({ entries: [proposal(input)] })) {
  const f = { respond: responder };
  const { runtime, store, calls, entry, bindChild } = await memoryHost(t, (input, options) => f.respond(input, options));
  const model = runtime.model, registry = runtime.plugins;
  const { MemoryRepository } = await import(pathToFileURL(join(entry.root, 'repository.js')));
  const main = {
    search: input => runtime.memory.call('search', input),
    read: id => runtime.memory.call('read', { id }),
    save: entry => runtime.memory.call('manage', { action: 'save', entry }),
    forget: (id, expected_version) => runtime.memory.call('manage', { action: 'forget', id, expected_version }),
    candidates: () => runtime.memory.call('manage', { action: 'candidates' }),
  };
  return Object.assign(f, { runtime, store, calls, registry, entry, model, main, bindChild, repository: MemoryRepository.prototype,
    journal() {
      const db = new DatabaseSync(join(store.directory, 'plugins/data/sesame/memory/memory/memory.sqlite'), { readOnly: true });
      try { return db.prepare('SELECT kind, body FROM curation_journal').all(); } finally { db.close(); }
    },
    message(id, text, cid = 'conv_main', patch = {}) {
      store.put('message', { id, role: 'user', status: 'accepted', created_at: new Date().toISOString(), conversation_id: cid, content: [{ type: 'text', text }], ...patch });
      return { type: 'message', id: `pi_${id}`, message: { role: 'user', content: [{ type: 'text', text }], timestamp: 1234 } };
    },
    async run(entries = [], { reason = 'threshold', cid = 'conv_main', signal = new AbortController().signal, sessionModel = model } = {}) {
      await registry.beforeCompact(cid, { reason, signal, branchEntries: entries, preparation: { firstKeptEntryId: 'keep', messagesToSummarize: entries.map(entry => entry.message), turnPrefixMessages: [] } }, sessionModel);
      return (await runtime.memory.call('stats', {}, cid)).compaction;
    },
    artifact(content, cid = 'conv_main', files = [], kind = 'resource') {
      return runtime.contractArtifacts.publish({ id: 'example/evidence', version: '1.0.0', digest: 'sha256:' + 'a'.repeat(64) }, {
        operationId: crypto.randomUUID(), manifest: { kind, schemaVersion: '1.0.0', content, dependencies: [], blobs: files.map(file => ({ ...runtime.contractArtifacts.blob(file.text), path: file.path, mediaType: file.mediaType })) },
      }, { conversationId: cid, sessionId: cid, runId: store.get('conversation', cid).host_run_id ?? null });
    },
  });
}

test('unattended extraction redacts credential formats without removing ordinary prose', () => {
  const clean = 'Use Chinese reports with audited market data.'; assert.equal(redact(clean), clean);
  for (const value of ['sk-example012345678901234567890', 'Bearer abcdef012345678901234567890', 'password: super-secret-value', '"api_key":"abcde12345678901234567890"', '密钥=abcd1234567890123456789', '-----BEGIN PRIVATE KEY-----\nprivate material\n-----END PRIVATE KEY-----']) assert.match(redact(value), /REDACTED/);
});

integration('registered plugin persists real evidence before compaction, remains idempotent across restart and does not resurrect forgotten memory', async t => {
  const f = await fixture(t), input = f.message('human_1', preference);
  const first = await f.run([input], { reason: 'manual' }); assert.equal(first.status, 'completed', JSON.stringify(first)); assert.equal(first.counts.saved, 1);
  const saved = (await f.main.search({})).items[0]; assert.deepEqual((await f.main.read(saved.id)).sources, [{ type: 'user_message', id: 'human_1' }]);
  assert.equal(f.store.list('message').length, 1, 'No fabricated user message or chat turn');
  await f.registry.stopService(f.entry.id); await f.registry.start(f.entry);
  await f.run([input], { reason: 'overflow' }); assert.equal(f.calls.length, 1);
  await f.main.forget(saved.id, saved.version); await f.run([input]); assert.equal(f.calls.length, 1); assert.equal((await f.main.search({})).items.length, 0);
  const rows = f.journal(); assert.ok(rows.length);
  const journal = JSON.stringify(rows);
  assert.doesNotMatch(journal, /报告使用中文|以后报告|entries|citations/);
});

integration('malformed, unsupported and fabricated plans cannot partially write or escalate evidence', async t => {
  const f = await fixture(t), human = f.message('human', preference);
  for (const corrupt of [
    input => ({ entries: [proposal(input), proposal(input, { title: 'bad', citations: [{ key: 'invented', quote: 'not evidence' }] })] }),
    input => ({ entries: [proposal(input, { evidence: 'verified' })] }),
    input => ({ entries: [proposal(input, { pinned: true })] }),
    input => ({ entries: [proposal(input, { category: '../private' })] }),
    input => ({ entries: [proposal(input), proposal(input, { title: 'bad tags', tags: ['   '] })] }),
    input => ({ entries: [proposal(input, { content: 'password: very-private-fixture' })] }),
    () => 'not JSON',
  ]) {
    f.respond = corrupt;
    const before = f.calls.length, receipt = await f.run([human]);
    assert.equal(f.calls.length, before + 1, 'The curator received this invalid output');
    assert.equal(receipt.status, 'failed'); assert.equal((await f.main.search({})).items.length, 0); assert.equal((await f.main.candidates()).items.length, 0);
    assert.equal(receipt.pendingSources, 1);
  }
});

integration('inferences are candidates, and pinned constraints require review instead of overwrite', async t => {
  const f = await fixture(t, input => ({ entries: [proposal(input, { evidence: 'inferred' })] }));
  await f.run([f.message('human', preference)]);
  assert.equal((await f.main.search({})).items.length, 0); assert.equal((await f.main.candidates()).items[0].evidence, 'inferred');
  const g = await fixture(t); g.message('old', 'Never remove the data provenance from a report.');
  const old = await g.main.save({ category: 'user/constraints', scope: { kind: 'global' }, title: '报告依据', summary: '保留依据', content: '始终保留数据口径。', sources: [{ type: 'user_message', id: 'old' }], evidence: 'explicit', pinned: true });
  g.respond = input => ({ entries: [proposal(input, { targetId: old.id, category: 'user/constraints', title: old.title })] });
  const receipt = await g.run([g.message('new', preference)]); assert.equal(receipt.counts.proposed, 1);
  assert.equal((await g.main.read(old.id)).version, 1); assert.equal((await g.main.read(old.id)).content, old.content);
  assert.deepEqual((await g.main.candidates()).items[0].conflicts_with, [old.id]);
});

integration('source-backed merge keeps cold memory cold and never fabricates adoption', async t => {
  const f = await fixture(t); f.message('old', preference);
  const clock = t.mock.method(f.repository, 'timestamp', () => new Date(Date.now() - 100 * 86400000).toISOString());
  const old = await f.main.save({ category: 'user/communication', scope: { kind: 'global' }, title: '报告语言与依据', summary: '中文报告', content: '报告使用中文。', sources: [{ type: 'user_message', id: 'old' }], evidence: 'explicit' });
  clock.mock.restore(); assert.equal((await f.main.read(old.id)).status, 'archived');
  f.respond = input => ({ entries: [proposal(input, { targetId: old.id })] });
  const receipt = await f.run([f.message('new', preference + '不要遗漏适用范围。')]); assert.equal(receipt.counts.revised, 1);
  const next = (await f.main.read(old.id)); assert.equal(next.version, 2); assert.equal(next.last_used_at, null); assert.equal(next.use_count, 0); assert.equal(next.status, 'archived');
  assert.equal(next.sources.length, 2);
});

integration('concurrent manual correction wins over a stale automatic merge', async t => {
  const f = await fixture(t); f.message('old', preference);
  const old = await f.main.save({ category: 'user/communication', scope: { kind: 'global' }, title: '报告语言与依据', summary: '中文报告', content: '报告使用中文。', sources: [{ type: 'user_message', id: 'old' }], evidence: 'explicit' });
  // The manual writer commits after the curator reads the old version and before its CAS.
  const save = f.repository.save;
  t.mock.method(f.repository, 'save', async function (cid, input, ...args) {
    await save.call(this, cid, { id: old.id, expected_version: 1, content: '用户刚刚指定另一种报告要求。' });
    return save.call(this, cid, input, ...args);
  });
  f.respond = input => ({ entries: [proposal(input, { targetId: old.id })] });
  const receipt = await f.run([f.message('new', preference + '这是新的要求。')]);
  assert.equal(receipt.status, 'failed'); assert.equal(receipt.code, 'version_conflict');
  assert.equal((await f.main.read(old.id)).content, '用户刚刚指定另一种报告要求。');
});

integration('failed inference retains only references and can catch up after the raw turn has been compacted', async t => {
  const f = await fixture(t, () => { throw Object.assign(new Error('sensitive provider response'), { code: 'RATE_LIMITED' }); });
  const receipt = await f.run([f.message('human', preference)]); assert.equal(receipt.status, 'failed'); assert.equal(receipt.pendingSources, 1);
  f.respond = input => ({ entries: [proposal(input)] });
  const next = await f.run([]); assert.equal(next.counts.saved, 1); assert.equal(next.pendingSources, 0);
  assert.doesNotMatch(JSON.stringify(f.store.events('0')), /sensitive provider response/);
});

integration('a reordered retry cannot mistake another applied entry for its own receipt', async t => {
  const second = { title: '报告图表', summary: '保留图表', content: '报告应保留清晰的图表。' };
  const f = await fixture(t, input => ({ entries: [proposal(input), proposal(input, second)] }));
  const save = f.repository.save; let reject = true;
  t.mock.method(f.repository, 'save', async function (cid, input, ...args) {
    if (reject && input.title === second.title) { reject = false; throw Object.assign(new Error('Concurrent revision'), { status: 409, code: 'version_conflict' }); }
    return save.call(this, cid, input, ...args);
  });
  const first = await f.run([f.message('human', preference + second.content)]);
  assert.equal(first.status, 'failed'); assert.equal(first.counts.saved, 1); assert.equal(first.pendingSources, 1);
  f.respond = input => ({ entries: [proposal(input, second), proposal(input)] });
  const next = await f.run([]);
  assert.equal(next.status, 'completed'); assert.equal(next.counts.saved, 1); assert.equal(next.counts.deduplicated, 1);
  assert.equal(next.pendingSources, 0); assert.equal((await f.main.search({})).items.length, 2);
  const entries = await Promise.all((await f.main.search({})).items.map(item => f.main.read(item.id)));
  assert.ok(entries.some(entry => entry.content === second.content));
});

integration('an applied receipt only deduplicates the exact entry fingerprint', async t => {
  const f = await fixture(t, input => ({ entries: [proposal(input), proposal(input, { title: 'second', content: 'A separate preference.' })] }));
  const save = f.repository.save;
  t.mock.method(f.repository, 'save', async function (cid, input, ...args) {
    if (input.title === 'second') throw Object.assign(new Error('Stale input'), { status: 409, code: 'version_conflict' });
    return save.call(this, cid, input, ...args);
  });
  await f.run([f.message('human', preference)]);
  const saved = (await f.main.search({})).items[0];
  f.respond = input => ({ entries: [proposal(input, { content: '同一标题下改写后的不同内容。' })] });
  const retry = await f.run([]);
  assert.equal(retry.status, 'partial'); assert.equal(retry.counts.uncertain, 1); assert.equal(retry.pendingSources, 1);
  assert.equal((await f.main.read(saved.id)).version, 1);
});

integration('an uncertain write is not replayed or marked complete after a new paraphrase', async t => {
  const f = await fixture(t), save = f.repository.save; let interrupt = true;
  t.mock.method(f.repository, 'save', async function (cid, input, ...args) {
    const saved = await save.call(this, cid, input, ...args);
    if (interrupt) { interrupt = false; throw Object.assign(new Error('Lost response after commit'), { code: 'STORAGE_INTERRUPTED' }); }
    return saved;
  });
  const first = await f.run([f.message('human', preference)]); assert.equal(first.status, 'failed');
  const saved = (await f.main.search({})).items[0];
  f.respond = input => ({ entries: [proposal(input, { content: '所有报告使用中文，注明数据口径及其适用范围。' })] });
  const retry = await f.run([]);
  assert.equal(retry.status, 'partial'); assert.equal(retry.counts.uncertain, 1); assert.equal(retry.pendingSources, 1);
  assert.equal((await f.main.read(saved.id)).version, 1); assert.equal((await f.main.search({})).items.length, 1);
});

integration('a model-less session skips inference and retains evidence for a later configured session', async t => {
  const f = await fixture(t);
  const first = await f.run([f.message('human', preference)], { sessionModel: null });
  assert.equal(first.status, 'skipped'); assert.equal(first.pendingSources, 1); assert.equal(f.calls.length, 0);
  assert.equal(f.store.events('0').filter(event => event.type === 'plugin.lifecycle' && event.data?.status === 'failed').length, 0);
  const next = await f.run([]);
  assert.equal(next.status, 'completed'); assert.equal(next.counts.saved, 1); assert.equal(next.pendingSources, 0);
});

integration('newer artifacts from other conversations or kinds cannot evict eligible local evidence', async t => {
  const f = await fixture(t, () => ({ entries: [] }));
  const ref = f.artifact({ lesson: 'Main conversation evidence' });
  const key = `${ref.id}:${ref.revision}`;
  f.store.put('contract_artifact', { ...f.store.get('contract_artifact', key), createdAt: 1 });
  for (let index = 0; index < 25; index++) {
    f.artifact({ lesson: `Child evidence ${index}` }, 'child');
    f.artifact({ lookback: index + 1 }, 'conv_main', [], 'parameters');
  }
  const receipt = await f.run([]);
  assert.equal(receipt.status, 'completed'); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].documents[0].source.id, ref.id);
});

integration('large evidence is bounded and the next compaction resumes remaining chunks without storing raw text', async t => {
  const f = await fixture(t, () => ({ entries: [] }));
  const body = 'durable source text '.repeat(6000);
  const first = await f.run([f.message('long', body)]); assert.equal(first.status, 'partial'); assert.equal(first.processedChunks, 6);
  const second = await f.run([]); assert.equal(second.status, 'completed'); assert.equal(second.pendingSources, 0);
  assert.ok(f.calls.every(input => input.documents[0].text.length <= 16000));
  assert.equal(f.calls.map(input => input.documents[0].text).join(''), body);
});

integration('published evidence is independent of candidate prose and subagents only propose', async t => {
  const f = await fixture(t, input => ({ entries: [proposal(input, { category: 'lessons/data-quality', evidence: 'verified', title: '固定数据口径', content: '研究必须固定数据口径。', summary: '固定数据口径' })] }));
  f.bindChild();
  const ref = f.artifact({ lesson: '研究必须固定数据口径，比较前先核对单位。' }, 'child');
  const childReceipt = await f.run([], { cid: 'child' }); assert.equal(childReceipt.counts.proposed, 1); assert.equal((await f.main.search({})).items.length, 0);
  const candidate = (await f.main.candidates()).items[0]; assert.equal(candidate.owner_conversation_id, 'child'); assert.deepEqual(candidate.sources, [{ type: 'artifact', ...ref }]);
  f.respond = input => ({ entries: [proposal(input, { category: candidate.category, title: candidate.title, content: candidate.content, summary: candidate.summary, evidence: 'verified', candidateId: candidate.id })] });
  const mainReceipt = await f.run([]); assert.equal(mainReceipt.counts.saved, 1); assert.equal((await f.main.candidates()).items.length, 0);
  assert.deepEqual((await f.main.read((await f.main.search({})).items[0].id)).sources, [{ type: 'artifact', ...ref }]);
});

integration('published HTML is read as text without script execution or hidden model prompts', async t => {
  const f = await fixture(t, () => ({ entries: [] }));
  f.artifact({ note: 'Published final report' }, 'conv_main', [{ path: 'report.html', mediaType: 'text/html', text: '<style>hidden-style</style><script>neverExecute()</script><h1>可核验的结论</h1><p>保留数据来源。</p>' }]);
  const receipt = await f.run([]); assert.equal(receipt.status, 'completed', JSON.stringify(receipt));
  const input = JSON.stringify(f.calls[0]); assert.match(input, /可核验的结论/); assert.doesNotMatch(input, /neverExecute|hidden-style/);
});

integration('credential-bearing input is redacted before the model call and cannot be remembered', async t => {
  const f = await fixture(t, () => ({ entries: [] }));
  await f.run([f.message('human', `${preference}\npassword: fixture-secret-value`)]);
  assert.doesNotMatch(JSON.stringify(f.calls), /fixture-secret-value/); assert.match(JSON.stringify(f.calls), /REDACTED/);
  assert.equal((await f.main.search({})).items.length, 0);
});

integration('small model limits constrain the maintenance request instead of overflowing', async t => {
  let outputLimit;
  const f = await fixture(t, (input, options) => { outputLimit = options.maxTokens; return { entries: [proposal(input)] }; });
  const sessionModel = { ...f.model, maxTokens: 1024, contextWindow: 8192 };
  const receipt = await f.run([f.message('human', preference)], { sessionModel });
  assert.equal(receipt.status, 'completed', JSON.stringify(receipt)); assert.equal(receipt.counts.saved, 1);
  assert.ok(outputLimit > 0 && outputLimit <= sessionModel.maxTokens, `Requested ${outputLimit} output tokens`);
  assert.ok(Buffer.byteLength(JSON.stringify(f.calls[0])) < 3000);
});

integration('a child cannot reopen parent private messages, but unavailable evidence does not poison other sources', async t => {
  const f = await fixture(t, () => ({ entries: [] })); f.message('human', preference);
  const tool = f.registry.definitions({ conversationId: 'child' }).find(item => item.name === 'memory_propose');
  await tool.execute(crypto.randomUUID(), { category: 'user/communication', scope: { kind: 'global' }, title: '报告语言', summary: '使用中文', content: '以后报告请使用中文。', evidence: 'explicit', sources: [{ type: 'user_message', id: 'human' }] });
  f.bindChild();
  const ref = f.artifact({ lesson: '研究必须固定数据口径，比较前先核对单位。' }, 'child');
  const receipt = await f.run([], { cid: 'child' }); assert.equal(receipt.counts.unavailable, 1); assert.equal(receipt.status, 'completed'); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].documents.map(doc => doc.source), [{ type: 'artifact', ...ref }]);
  assert.equal((await f.main.candidates()).items.length, 1);
});

integration('project scope key order and title whitespace cannot bypass merge checks', async t => {
  const f = await fixture(t); f.message('old', preference);
  const old = await f.main.save({ category: 'projects/project_a/conventions', scope: { kind: 'project', project_id: 'project_a' }, title: '报告语言与依据', summary: '中文报告', content: '报告使用中文。', sources: [{ type: 'user_message', id: 'old' }], evidence: 'explicit' });
  f.respond = input => ({ entries: [proposal(input, { targetId: old.id, category: old.category, scope: { project_id: 'project_a', kind: 'project' }, title: ` ${old.title} ` })] });
  const receipt = await f.run([f.message('new', preference + '请继续遵守。')]);
  assert.equal(receipt.counts.revised, 1); assert.equal((await f.main.search({})).items.length, 1); assert.equal((await f.main.read(old.id)).version, 2);
});
