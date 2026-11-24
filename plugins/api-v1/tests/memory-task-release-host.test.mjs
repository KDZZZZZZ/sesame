import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { memoryHost } from './fixtures/memory-host.mjs';

const hostRoot = process.env.SESAME_HOST_ROOT;
const integration = (name, run) => test(name, { skip: !hostRoot, timeout: 60000 }, run);
const conclusion = 'The ETF fixture contains duplicate timestamps before aggregation.';

async function fixture(t, respond) {
  const { runtime, store, calls, child, bindChild } = await memoryHost(t, input => ({ entries: respond(input.documents[0]) }));
  const workspace = runtime.workspaces.current(child.id), run = bindChild();
  const publish = (session = child, note = conclusion) => runtime.contractArtifacts.publish(
    { id: 'fixture/research', version: '1.0.0', digest: 'sha256:' + 'a'.repeat(64) },
    { operationId: crypto.randomUUID(), manifest: { kind: 'resource', schemaVersion: '1.0.0', content: { note }, blobs: [], dependencies: [] } },
    { sessionId: session.id, conversationId: session.id, runId: store.get('conversation', session.id).host_run_id ?? null },
  );
  const finish = async (artifacts = []) => {
    const done = await runtime.requestFinish(child.id, { status: 'succeeded', summary: 'Study complete', artifact_ids: artifacts.map(ref => ref.id) });
    assert.equal(done.cleanup_state, 'cleaned', JSON.stringify(done.cleanup_error));
    await assert.rejects(access(runtime.workspaces.taskRoot(workspace)), { code: 'ENOENT' });
  };
  const candidates = async () => (await runtime.memory.call('manage', { action: 'candidates' })).items;
  const memories = async () => (await runtime.memory.call('search', {})).items;
  const compact = cid => runtime.plugins.beforeCompact(cid, { reason: 'manual', signal: new AbortController().signal,
    branchEntries: [], preparation: { firstKeptEntryId: 'tail', messagesToSummarize: [], turnPrefixMessages: [] } }, runtime.model);
  return { store, runtime, child, run, publish, finish, candidates, memories, compact,
    get requests() { return calls.map(input => input.documents.map(doc => doc.source)); } };
}

function finding(doc) {
  return { category: 'lessons/data-quality', title: 'Duplicate input timestamps', summary: conclusion, content: conclusion,
    scope: { kind: 'global' }, evidence: 'verified', citations: [{ key: doc.key, quote: conclusion }] };
}

integration('a short uncompressed task leaves an evidence-backed finding after its workspace is deleted', async t => {
  const f = await fixture(t, doc => [finding(doc)]);
  f.publish(f.runtime.store.get('conversation', 'conv_main'), 'Unrelated finding from a different session');
  const ref = f.publish();
  await f.finish([ref]);
  assert.deepEqual(f.requests.flat(), [{ type: 'artifact', ...ref }]);
  const drafts = await f.candidates();
  if (drafts.length) {
    assert.equal(drafts.length, 1);
    await f.runtime.memory.call('manage', { action: 'accept', id: drafts[0].id, expected_version: drafts[0].version });
  }
  const saved = await f.memories(); assert.equal(saved.length, 1);
  const entry = await f.runtime.memory.call('read', { id: saved[0].id });
  assert.equal(entry.category, 'lessons/data-quality'); assert.equal(entry.content, conclusion);
  assert.deepEqual(entry.sources, [{ type: 'artifact', ...ref }]);
  assert.equal(f.runtime.contractArtifacts.read(ref).manifest.content.note, conclusion);
  await f.runtime.finalizeTask(f.child.id);
  assert.equal(f.requests.length, 1); assert.equal((await f.memories())[0].version, entry.version);
});

integration('cleanup preserves a candidate from earlier compaction without processing the same source again', async t => {
  const f = await fixture(t, doc => [finding(doc)]), ref = f.publish();
  await f.compact(f.child.id);
  const [before] = await f.candidates(); assert.ok(before, JSON.stringify((await f.runtime.memory.call('stats', {}, f.child.id)).compaction));
  assert.deepEqual(f.requests.flat(), [{ type: 'artifact', ...ref }]);
  await f.finish([ref]);
  assert.equal(f.requests.length, 1);
  const [retained] = await f.candidates(); assert.equal(retained?.id, before.id);
  await f.runtime.memory.call('manage', { action: 'accept', id: retained.id, expected_version: retained.version });
  assert.equal((await f.memories()).length, 1);
});

integration('unpublished scratch and a task summary alone do not start the curation model', async t => {
  const f = await fixture(t, () => []);
  f.store.put('message', { id: 'draft-chat', conversation_id: f.child.id, role: 'assistant', status: 'completed',
    content: [{ type: 'text', text: 'Unverified assistant speculation' }] });
  await f.finish();
  assert.notEqual(f.store.get('message', 'draft-chat', true)?.content[0]?.text, 'Unverified assistant speculation');
  assert.deepEqual(f.requests, []); assert.deepEqual(await f.candidates(), []); assert.deepEqual(await f.memories(), []);
});

integration('an ETF-only study cannot become a personal investment preference from artifact evidence', async t => {
  const f = await fixture(t, doc => [{ ...finding(doc), category: 'trading/style', title: 'Retirement account · IPS', content: 'Invest only in ETFs.' }]);
  const ref = f.publish(); await f.finish([ref]);
  assert.deepEqual(f.requests.flat(), [{ type: 'artifact', ...ref }]);
  assert.deepEqual(await f.memories(), []); assert.deepEqual(await f.candidates(), []);
});

integration('only a delivered user Run message can support an explicit preference after child cleanup', async t => {
  const preference = 'For monthly statements, use the original reporting currency.';
  const f = await fixture(t, doc => [{ scope: { kind: 'global' }, category: 'user/communication',
    title: 'Statement currency', summary: preference, content: preference, evidence: 'explicit',
    citations: [{ key: doc.key, quote: preference }] }]);
  const message = { id: 'delivered', runId: f.run.id, sourceKind: 'user', text: preference, deliveredAt: Date.now(),
    createdAt: Date.now(), responseId: 'response-fixture', deliveryError: null };
  f.store.put('run_message', message);
  for (const patch of [
    { id: 'undelivered', deliveredAt: null }, { id: 'from-agent', sourceKind: 'service' },
    { id: 'other-run', runId: 'unrelated' }, { id: 'failed', deliveryError: 'failure' },
  ]) f.store.put('run_message', { ...message, ...patch });
  await f.finish();
  const source = { type: 'user_message', id: 'run-user:delivered' };
  assert.deepEqual(f.requests.flat(), [source]); const [saved] = await f.memories();
  const entry = await f.runtime.memory.call('read', { id: saved.id });
  assert.equal(entry.content, preference); assert.deepEqual(entry.sources, [source]);
  // Resolve the persisted source again after the temporary process database is gone.
  const edited = await f.runtime.memory.call('manage', { action: 'save', id: saved.id, expected_version: saved.version,
    entry: { sources: [source], summary: 'Retain the reporting currency in the monthly statement.' } });
  assert.equal(edited.version, saved.version + 1);
});

integration('temporary model failure during cleanup preserves the source for the next main compaction', async t => {
  let unavailable = true;
  const f = await fixture(t, doc => {
    if (unavailable) throw Object.assign(new Error('Temporary fixture failure'), { code: 'RATE_LIMITED' });
    return [finding(doc)];
  });
  const ref = f.publish(); await f.finish([ref]); assert.equal(f.requests.length, 1); assert.deepEqual(await f.memories(), []);
  unavailable = false; await f.compact('conv_main');
  assert.deepEqual(f.requests.flat(), [ref, ref].map(item => ({ type: 'artifact', ...item })), JSON.stringify((await f.runtime.memory.call('stats')).compaction));
  const [saved] = await f.memories();
  assert.equal((await f.runtime.memory.call('read', { id: saved.id })).content, conclusion);
});
