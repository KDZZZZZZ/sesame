import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCapabilities } from '../packages/memory/index.js';
import { DatabaseSync } from 'node:sqlite';

function fixture(t) {
  const storageRoot = mkdtempSync(join(tmpdir(), 'memory-v2-')), messages = new Map(), events = [], models = [];
  const host = { context: { storageRoot, sessionId: 'main', kind: 'main', runId: 'run-main' },
    data: { async query({ source, input }) {
      if (source.providerId === 'host#sessions') return { items: [{ id: input.sessionId, kind: input.sessionId === 'main' ? 'main' : 'subagent', projectId: 'project_a' }] };
      if (source.providerId === 'host#messages') return { items: input.ids.map(id => messages.get(id)).filter(Boolean) };
      if (source.providerId === 'host#artifacts') return { items: [] };
      throw new Error('unexpected source');
    } },
    resources: { async read() { throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' }); } },
    events: { async emit(value) { events.push(value); return { accepted: true }; } },
    capabilities: { async invoke(id, input) { assert.equal(id, 'host.model.complete'); models.push(input); return { type: 'result', value: { text: JSON.stringify(f.respond(input.input)) } }; } },
  };
  const call = (id, input = {}, context = {}) => createCapabilities({ ...host, context: { ...host.context, ...context } }).find(c => c.name === id).execute(input, new AbortController().signal);
  const f = { host, call, messages, events, models, storageRoot, respond: () => ({ entries: [] }),
    human(id = 'human', text = 'Reports should retain source provenance.') { messages.set(id, { id, role: 'user', content: [{ type: 'text', text }], sourceSessionId: null, systemGenerated: false, ownerRunId: null, origin: 'human' }); return { type: 'user_message', id }; },
  };
  t.after(async () => { await call('memory_dispose'); rmSync(storageRoot, { recursive: true, force: true }); }); return f;
}
const entry = source => ({ category: 'user/communication', scope: { kind: 'global' }, title: 'Report provenance', summary: 'Keep sources', content: 'Reports should retain source provenance.', evidence: 'explicit', sources: [source] });

test('memory uses its private SQLite; verified sources, child writes and CAS remain enforced', async t => {
  const f = fixture(t), source = f.human();
  const saved = await f.call('memory_manage', { action: 'save', entry: entry(source) });
  assert.equal(saved.version, 1); assert.equal((await f.call('memory_read', { id: saved.id })).content, entry(source).content);
  await assert.rejects(f.call('memory_manage', { action: 'save', entry: entry(source) }, { sessionId: 'child', kind: 'subagent' }), { code: 'memory_read_only' });
  assert.equal((await f.call('memory_read', { id: saved.id }, { sessionId: 'child', kind: 'subagent' })).id, saved.id, 'workspace read is visible without extra ACL');
  await assert.rejects(f.call('memory_manage', { action: 'save', id: saved.id, expected_version: 9, entry: { content: 'bad' } }), { code: 'version_conflict' });
  assert.match(readFileSync(join(f.storageRoot, 'memory', 'MEMORY.md'), 'utf8'), /Report provenance/);
});

test('synthetic messages and invented artifact references cannot become memory evidence', async t => {
  const f = fixture(t); f.human();
  for (const patch of [{ role: 'assistant' }, { sourceSessionId: 'child' }, { systemGenerated: true }, { ownerRunId: 'run' }, { origin: 'system' }]) {
    f.human(); Object.assign(f.messages.get('human'), patch);
    await assert.rejects(f.call('memory_manage', { action: 'save', entry: entry({ type: 'user_message', id: 'human' }) }), { code: 'memory_source_invalid' });
  }
  await assert.rejects(f.call('memory_propose', entry({ type: 'artifact', id: 'invented', revision: 1 })), { code: 'memory_source_invalid' });
  assert.equal((await f.call('memory_search')).total, 0);
});

test('forget clears private content and derived data, emits only identity, and prevents resurrection', async t => {
  const f = fixture(t), source = f.human(), saved = await f.call('memory_manage', { action: 'save', entry: entry(source) });
  await f.call('memory_manage', { action: 'forget', id: saved.id, expected_version: saved.version });
  await assert.rejects(f.call('memory_read', { id: saved.id }), { code: 'memory_not_found' });
  await assert.rejects(f.call('memory_manage', { action: 'save', entry: entry(source) }), { code: 'memory_forgotten' });
  assert.deepEqual(f.events.at(-1), { topic: 'workspace.memory.forgotten', payload: { id: saved.id } });
  const db = new DatabaseSync(join(f.storageRoot, 'memory', 'memory.sqlite'));
  for (const table of ['memories', 'memory_history', 'memory_fts', 'memory_links']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  db.close();
});

test('compaction quotes real evidence, preserves restart dedupe and journals no transcript', async t => {
  const f = fixture(t), source = f.human();
  f.respond = input => ({ entries: [{ ...entry(source), citations: [{ key: input.documents[0].key, quote: input.documents[0].text }], sources: undefined }] });
  const event = { checkpointId: 'check-1', messages: [{ source }], model: { provider: 'fixture', id: 'test' } };
  const result = await f.call('memory_before_compact', event);
  assert.equal(result.counts.saved, 1); assert.equal(f.models.length, 1);
  await f.call('memory_dispose'); await f.call('memory_activate');
  await f.call('memory_before_compact', { ...event, checkpointId: 'check-2' });
  assert.equal(f.models.length, 1);
  const db = new DatabaseSync(join(f.storageRoot, 'memory', 'memory.sqlite'));
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT body FROM curation_journal').all()), /Reports should|citations|entries/); db.close();
});

test('malformed plan is rejected before any partial write; candidates close with the Run', async t => {
  const f = fixture(t), source = f.human();
  f.respond = input => ({ entries: [{ ...entry(source), sources: undefined, citations: [{ key: input.documents[0].key, quote: 'made up evidence' }] }] });
  await assert.rejects(f.call('memory_before_compact', { checkpointId: 'bad', messages: [{ source }], model: { provider: 'fixture', id: 'test' } }), { code: 'MEMORY_CITATION_INVALID' });
  assert.equal((await f.call('memory_search')).total, 0);
  const candidate = await f.call('memory_propose', entry(source), { sessionId: 'child', kind: 'subagent', runId: 'run-child' });
  assert.equal(candidate.owner_run_id, 'run-child');
  const released = await f.call('memory_before_run_release', { runId: 'run-child' }, { sessionId: 'child', kind: 'subagent', runId: 'run-child' });
  assert.equal(released.deleted_candidates, 1);
});
