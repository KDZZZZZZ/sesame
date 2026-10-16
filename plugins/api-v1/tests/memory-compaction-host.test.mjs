import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as plugin from '../packages/memory/index.js';
import { redact } from '../packages/memory/compaction.js';

const hostRoot = process.env.SESAME_HOST_ROOT;
const integration = (name, run) => test(name, { skip: !hostRoot }, run);
const root = fileURLToPath(new URL('../packages/memory/', import.meta.url));
const load = path => import(pathToFileURL(join(hostRoot, path)));
const preference = '以后报告请使用中文，保留数据口径和适用范围。';
const proposal = (input, patch = {}) => ({ category: 'user/communication', scope: { kind: 'global' }, title: '报告语言与依据', summary: '报告使用中文并保留依据。', content: '报告使用中文，保留数据口径和适用范围。', evidence: 'explicit',
  citations: [{ key: input.documents[0].key, quote: input.documents[0].text.slice(0, 100) }], ...patch });

async function fixture(t, responder = input => ({ entries: [proposal(input)] })) {
  const { Store } = await load('modules/agent/store.js'), { MemoryService } = await load('modules/agent/memory-service.js');
  const { PluginRegistry } = await load('modules/agent/plugin-registry.js'), { ContractArtifacts } = await load('modules/plugins/artifacts.js');
  const directory = mkdtempSync(join(tmpdir(), 'sesame-memory-curation-')), store = new Store(directory);
  const model = { provider: 'fixture', id: 'curation', maxTokens: 8192, contextWindow: 200000 };
  const calls = []; let time = Date.now();
  const f = { store, model, calls, respond: responder };
  const runtime = { store, sessions: new Map(), preferences: () => ({ locale: 'zh-CN' }), workspaces: { current: cid => ({ id: `run_${cid}` }), assertOpen() {} },
    modelRuntime: { getModels: () => [model], getModel: () => model, hasConfiguredAuth: () => true },
    sessionModels: { completeSimple: async (_model, context, options) => {
      const input = JSON.parse(context.messages[1].content); calls.push(input);
      const output = await f.respond(input, options);
      return { provider: model.provider, model: model.id, stopReason: 'stop', content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }], usage: { input: 1, output: 1 } };
    } } };
  store.put('conversation', { id: 'main', scope: 'main' });
  store.put('conversation', { id: 'child', scope: 'subagent', parent_conversation_id: 'main', project_id: 'project_a' });
  runtime.contractArtifacts = new ContractArtifacts(store);
  runtime.memory = new MemoryService(runtime, { clock: () => time }).init();
  const registry = runtime.plugins = new PluginRegistry(runtime);
  const manifest = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'));
  const entry = { ...manifest, root, entryPath: join(root, manifest.entry), module: Promise.resolve(plugin), resources: [], skills: [], definitions: [], diagnostics: [] };
  t.after(async () => { await registry.close(); runtime.memory.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  registry.register(entry); await registry.start(entry); assert.equal(entry.runtime_status, 'ready', JSON.stringify(entry.diagnostics));
  Object.assign(f, { runtime, registry, entry, main: runtime.memory.facade('main'), child: runtime.memory.facade('child'), advance: days => { time += days * 86400000; },
    message(id, text, cid = 'main', patch = {}) {
      store.put('message', { id, role: 'user', conversation_id: cid, content: [{ type: 'text', text }], ...patch });
      return { type: 'message', id: `pi_${id}`, message: { role: 'user', content: [{ type: 'text', text }], timestamp: 1234 } };
    },
    async run(entries = [], { reason = 'threshold', cid = 'main', signal = new AbortController().signal, sessionModel = model } = {}) {
      await registry.beforeCompact(cid, { reason, signal, branchEntries: entries, preparation: { firstKeptEntryId: 'keep', messagesToSummarize: entries.map(entry => entry.message), turnPrefixMessages: [] } }, sessionModel);
      return store.list('plugin:sesame/memory:compaction_receipts').filter(value => value.conversationId === cid).at(-1);
    },
    artifact(content, cid = 'main', files = [], kind = 'resource') {
      return runtime.contractArtifacts.publish({ id: 'example/evidence', version: '1.0.0', digest: 'sha256:' + 'a'.repeat(64) }, {
        operationId: crypto.randomUUID(), manifest: { kind, schemaVersion: '1.0.0', content, dependencies: [], blobs: files.map(file => ({ ...runtime.contractArtifacts.blob(file.text), path: file.path, mediaType: file.mediaType })) },
      }, { conversationId: cid });
    },
  });
  return f;
}

test('unattended extraction redacts credential formats without removing ordinary prose', () => {
  const clean = 'Use Chinese reports with audited market data.'; assert.equal(redact(clean), clean);
  for (const value of ['sk-example012345678901234567890', 'Bearer abcdef012345678901234567890', 'password: super-secret-value', '"api_key":"abcde12345678901234567890"', '密钥=abcd1234567890123456789', '-----BEGIN PRIVATE KEY-----\nprivate material\n-----END PRIVATE KEY-----']) assert.match(redact(value), /REDACTED/);
});

integration('registered plugin persists real evidence before compaction, remains idempotent across restart and does not resurrect forgotten memory', async t => {
  const f = await fixture(t), input = f.message('human_1', preference);
  const first = await f.run([input], { reason: 'manual' }); assert.equal(first.status, 'completed'); assert.equal(first.counts.saved, 1);
  const saved = f.main.search({}).items[0]; assert.deepEqual(f.main.read(saved.id).sources, [{ type: 'user_message', id: 'human_1' }]);
  assert.equal(f.store.list('message').length, 1, 'No fabricated user message or chat turn');
  await f.registry.stopService(f.entry.id); await f.registry.start(f.entry);
  await f.run([input], { reason: 'overflow' }); assert.equal(f.calls.length, 1);
  f.main.forget(saved.id, saved.version); await f.run([input]); assert.equal(f.calls.length, 1); assert.equal(f.main.search({}).items.length, 0);
  const journal = JSON.stringify(['compaction_sources', 'compaction_receipts', 'compaction_operations'].flatMap(name => f.store.list(`plugin:sesame/memory:${name}`)));
  assert.doesNotMatch(journal, /报告使用中文|以后报告|entries|citations/);
});

integration('malformed, unsupported and fabricated plans cannot partially write or escalate evidence', async t => {
  for (const corrupt of [
    input => ({ entries: [proposal(input), proposal(input, { title: 'bad', citations: [{ key: 'invented', quote: 'not evidence' }] })] }),
    input => ({ entries: [proposal(input, { evidence: 'verified' })] }),
    input => ({ entries: [proposal(input, { pinned: true })] }),
    input => ({ entries: [proposal(input, { category: '../private' })] }),
    input => ({ entries: [proposal(input), proposal(input, { title: 'bad tags', tags: ['   '] })] }),
    input => ({ entries: [proposal(input, { content: 'password: very-private-fixture' })] }),
    () => 'not JSON',
  ]) {
    const f = await fixture(t, corrupt), receipt = await f.run([f.message('human', preference)]);
    assert.equal(receipt.status, 'failed'); assert.equal(f.main.search({}).items.length, 0); assert.equal(f.main.candidates().items.length, 0);
    assert.equal(receipt.pendingSources, 1);
  }
});

integration('inferences are candidates, and pinned constraints require review instead of overwrite', async t => {
  const f = await fixture(t, input => ({ entries: [proposal(input, { evidence: 'inferred' })] }));
  await f.run([f.message('human', preference)]);
  assert.equal(f.main.search({}).items.length, 0); assert.equal(f.main.candidates().items[0].evidence, 'inferred');
  const g = await fixture(t); g.message('old', 'Never remove the data provenance from a report.');
  const old = g.main.save({ category: 'user/constraints', scope: { kind: 'global' }, title: '报告依据', summary: '保留依据', content: '始终保留数据口径。', sources: [{ type: 'user_message', id: 'old' }], evidence: 'explicit', pinned: true });
  g.respond = input => ({ entries: [proposal(input, { targetId: old.id, category: 'user/constraints', title: old.title })] });
  const receipt = await g.run([g.message('new', preference)]); assert.equal(receipt.counts.proposed, 1);
  assert.equal(g.main.read(old.id).version, 1); assert.equal(g.main.read(old.id).content, old.content);
  assert.deepEqual(g.main.candidates().items[0].conflicts_with, [old.id]);
});

integration('source-backed merge keeps cold memory cold and never fabricates adoption', async t => {
  const f = await fixture(t); f.message('old', preference);
  const old = f.main.save({ category: 'user/communication', scope: { kind: 'global' }, title: '报告语言与依据', summary: '中文报告', content: '报告使用中文。', sources: [{ type: 'user_message', id: 'old' }], evidence: 'explicit' });
  f.advance(100); assert.equal(f.main.read(old.id).status, 'archived');
  f.respond = input => ({ entries: [proposal(input, { targetId: old.id })] });
  const receipt = await f.run([f.message('new', preference + '不要遗漏适用范围。')]); assert.equal(receipt.counts.revised, 1);
  const next = f.main.read(old.id); assert.equal(next.version, 2); assert.equal(next.last_used_at, null); assert.equal(next.use_count, 0); assert.equal(next.status, 'archived');
  assert.equal(next.sources.length, 2);
});

integration('concurrent manual correction wins over a stale automatic merge', async t => {
  const f = await fixture(t); f.message('old', preference);
  const old = f.main.save({ category: 'user/communication', scope: { kind: 'global' }, title: '报告语言与依据', summary: '中文报告', content: '报告使用中文。', sources: [{ type: 'user_message', id: 'old' }], evidence: 'explicit' });
  f.respond = input => { f.main.save({ id: old.id, expected_version: 1, content: '用户刚刚指定另一种报告要求。' }); return { entries: [proposal(input, { targetId: old.id })] }; };
  const receipt = await f.run([f.message('new', preference + '这是新的要求。')]);
  assert.equal(receipt.status, 'failed'); assert.equal(receipt.code, 'version_conflict');
  assert.equal(f.main.read(old.id).content, '用户刚刚指定另一种报告要求。');
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
  const save = f.runtime.memory.save.bind(f.runtime.memory); let reject = true;
  f.runtime.memory.save = (cid, input, ...args) => {
    if (reject && input.title === second.title) { reject = false; throw Object.assign(new Error('Concurrent revision'), { status: 409, code: 'version_conflict' }); }
    return save(cid, input, ...args);
  };
  const first = await f.run([f.message('human', preference + second.content)]);
  assert.equal(first.status, 'failed'); assert.equal(first.counts.saved, 1); assert.equal(first.pendingSources, 1);
  f.respond = input => ({ entries: [proposal(input, second), proposal(input)] });
  const next = await f.run([]);
  assert.equal(next.status, 'completed'); assert.equal(next.counts.saved, 1); assert.equal(next.counts.deduplicated, 1);
  assert.equal(next.pendingSources, 0); assert.equal(f.main.search({}).items.length, 2);
  assert.ok(f.main.search({}).items.some(item => f.main.read(item.id).content === second.content));
});

integration('an applied receipt only deduplicates the exact entry fingerprint', async t => {
  const f = await fixture(t, input => ({ entries: [proposal(input), proposal(input, { title: 'second', content: 'A separate preference.' })] }));
  const save = f.runtime.memory.save.bind(f.runtime.memory);
  f.runtime.memory.save = (cid, input, ...args) => {
    if (input.title === 'second') throw Object.assign(new Error('Stale input'), { status: 409, code: 'version_conflict' });
    return save(cid, input, ...args);
  };
  await f.run([f.message('human', preference)]);
  const saved = f.main.search({}).items[0];
  f.respond = input => ({ entries: [proposal(input, { content: '同一标题下改写后的不同内容。' })] });
  const retry = await f.run([]);
  assert.equal(retry.status, 'partial'); assert.equal(retry.counts.uncertain, 1); assert.equal(retry.pendingSources, 1);
  assert.equal(f.main.read(saved.id).version, 1);
});

integration('an uncertain write is not replayed or marked complete after a new paraphrase', async t => {
  const f = await fixture(t), save = f.runtime.memory.save.bind(f.runtime.memory); let interrupt = true;
  f.runtime.memory.save = (cid, input, ...args) => {
    const saved = save(cid, input, ...args);
    if (interrupt) { interrupt = false; throw Object.assign(new Error('Lost response after commit'), { code: 'STORAGE_INTERRUPTED' }); }
    return saved;
  };
  const first = await f.run([f.message('human', preference)]); assert.equal(first.status, 'failed');
  const saved = f.main.search({}).items[0];
  f.respond = input => ({ entries: [proposal(input, { content: '所有报告使用中文，注明数据口径及其适用范围。' })] });
  const retry = await f.run([]);
  assert.equal(retry.status, 'partial'); assert.equal(retry.counts.uncertain, 1); assert.equal(retry.pendingSources, 1);
  assert.equal(f.main.read(saved.id).version, 1); assert.equal(f.main.search({}).items.length, 1);
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
    f.artifact({ lookback: index + 1 }, 'main', [], 'parameters');
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
  const ref = f.artifact({ lesson: '研究必须固定数据口径，比较前先核对单位。' }, 'child');
  const childReceipt = await f.run([], { cid: 'child' }); assert.equal(childReceipt.counts.proposed, 1); assert.equal(f.main.search({}).items.length, 0);
  const candidate = f.child.candidates().items[0]; assert.equal(candidate.owner_conversation_id, 'child'); assert.deepEqual(candidate.sources, [{ type: 'artifact', ...ref }]);
  f.respond = input => ({ entries: [proposal(input, { category: candidate.category, title: candidate.title, content: candidate.content, summary: candidate.summary, evidence: 'verified', candidateId: candidate.id })] });
  const mainReceipt = await f.run([]); assert.equal(mainReceipt.counts.saved, 1); assert.equal(f.main.candidates().items.length, 0);
  assert.deepEqual(f.main.read(f.main.search({}).items[0].id).sources, [{ type: 'artifact', ...ref }]);
});

integration('published HTML is read as text without script execution or hidden model prompts', async t => {
  const f = await fixture(t, () => ({ entries: [] }));
  f.artifact({ note: 'Published final report' }, 'main', [{ path: 'report.html', mediaType: 'text/html', text: '<style>hidden-style</style><script>neverExecute()</script><h1>可核验的结论</h1><p>保留数据来源。</p>' }]);
  await f.run([]);
  const input = JSON.stringify(f.calls[0]); assert.match(input, /可核验的结论/); assert.doesNotMatch(input, /neverExecute|hidden-style/);
});

integration('credential-bearing input is redacted before the model call and cannot be remembered', async t => {
  const f = await fixture(t, () => ({ entries: [] }));
  await f.run([f.message('human', `${preference}\npassword: fixture-secret-value`)]);
  assert.doesNotMatch(JSON.stringify(f.calls), /fixture-secret-value/); assert.match(JSON.stringify(f.calls), /REDACTED/);
  assert.equal(f.main.search({}).items.length, 0);
});

integration('small model limits constrain the maintenance request instead of overflowing', async t => {
  const f = await fixture(t, (input, options) => {
    assert.ok(options.maxTokens <= 1024); assert.ok(Buffer.byteLength(JSON.stringify(input)) < 3000);
    return { entries: [proposal(input)] };
  });
  f.model.maxTokens = 1024; f.model.contextWindow = 8192;
  const receipt = await f.run([f.message('human', preference)]); assert.equal(receipt.status, 'completed'); assert.equal(receipt.counts.saved, 1);
});

integration('a child cannot reopen parent private messages, but unavailable evidence does not poison other sources', async t => {
  const f = await fixture(t, () => ({ entries: [] })); f.message('human', preference);
  f.child.propose({ category: 'user/communication', scope: { kind: 'global' }, title: '报告语言', summary: '使用中文', content: '以后报告请使用中文。', evidence: 'explicit', sources: [{ type: 'user_message', id: 'human' }] });
  f.artifact({ lesson: '研究必须固定数据口径，比较前先核对单位。' }, 'child');
  const receipt = await f.run([], { cid: 'child' }); assert.equal(receipt.counts.unavailable, 1); assert.equal(receipt.status, 'completed'); assert.equal(f.calls.length, 1);
  assert.equal(f.child.candidates().items.length, 1);
});

integration('project scope key order and title whitespace cannot bypass merge checks', async t => {
  const f = await fixture(t); f.message('old', preference);
  const old = f.main.save({ category: 'projects/project_a/conventions', scope: { kind: 'project', project_id: 'project_a' }, title: '报告语言与依据', summary: '中文报告', content: '报告使用中文。', sources: [{ type: 'user_message', id: 'old' }], evidence: 'explicit' });
  f.respond = input => ({ entries: [proposal(input, { targetId: old.id, category: old.category, scope: { project_id: 'project_a', kind: 'project' }, title: ` ${old.title} ` })] });
  const receipt = await f.run([f.message('new', preference + '请继续遵守。')]);
  assert.equal(receipt.counts.revised, 1); assert.equal(f.main.search({}).items.length, 1); assert.equal(f.main.read(old.id).version, 2);
});
