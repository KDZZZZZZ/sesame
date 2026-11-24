import { join } from 'node:path';
import { MemoryRepository } from './repository.js';
import { requireValue } from './support.js';
import { curate, personalCategory, stageTaskSources } from './compaction.js';

const repositories = new Map();
const source = name => ({ providerId: `host#${name}`, revision: 'host:2' });
const failSource = condition => requireValue(condition, 'Memory evidence must resolve to an authentic user message or a fixed artifact', 422, 'memory_source_invalid');
const textOf = message => (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');

async function message(host, id, sessionId) {
  const page = await host.data.query({ source: source('messages'), input: { ids: [id], ...(sessionId && { sessionId }) }, limit: 1 });
  const value = page.items.find(item => item.id === id);
  failSource(value && value.role === 'user' && !value.sourceSessionId && !value.systemGenerated && !value.ownerRunId && (!value.origin || ['user', 'human'].includes(value.origin)));
  return value;
}

async function artifact(host, value) {
  const { type, ...ref } = value;
  failSource(typeof ref.id === 'string' && typeof ref.revision === 'string' && typeof ref.kind === 'string' && /^sha256:[a-f0-9]{64}$/.test(ref.digest) && typeof ref.schemaVersion === 'string');
  const manifest = await host.resources.read(ref, { part: 'manifest' });
  return { ref, manifest };
}

async function verify(host, value) {
  if (value.type === 'user_message') { await message(host, value.id); return { type: 'user_message', id: value.id }; }
  return { type: 'artifact', ...(await artifact(host, value)).ref };
}

async function evidence(host, value) {
  if (value.type === 'user_message') return textOf(await message(host, value.id, host.context.kind === 'main' ? undefined : host.context.sessionId));
  const { ref, manifest } = await artifact(host, value), excerpts = [];
  let remaining = 48000;
  for (const blob of manifest.blobs ?? []) {
    if (!remaining || !['text/plain', 'text/markdown', 'text/html'].includes(blob.mediaType) || blob.size > 256000) continue;
    const result = await host.resources.read(ref, { part: 'content', entry: blob.path, encoding: 'utf8', length: Math.min(256000, blob.size || 256000) });
    let text = result.content;
    if (blob.mediaType === 'text/html') text = text.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    text = text.slice(0, remaining); remaining -= text.length; excerpts.push({ path: blob.path, text });
  }
  return JSON.stringify({ title: manifest.title, content: manifest.content, excerpts });
}

function holder(host) {
  const key = host.context.storageRoot;
  let entry = repositories.get(key);
  if (!entry) {
    entry = { tail: Promise.resolve(), hosts: new Map(), pending: new Set() };
    entry.repository = new MemoryRepository(join(key, 'memory'), (cid, value) => verify(entry.hosts.get(cid), value)).init();
    entry.repository.onForget = id => { entry.pending.add(id); };
    for (const row of entry.repository.db.prepare('SELECT id FROM memory_tombstones').all()) entry.pending.add(row.id.split(':')[0]);
    repositories.set(key, entry);
  }
  return entry;
}

async function flush(host, entry) {
  for (const id of entry.pending) {
    await host.events.emit({ topic: 'workspace.memory.forgotten', payload: { id } });
    entry.pending.delete(id);
  }
}

async function context(host, id = host.context.sessionId) {
  requireValue(id, 'Memory requires a session context', 403, 'memory_scope_denied');
  const page = await host.data.query({ source: source('sessions'), input: { sessionId: id }, limit: 1 });
  const value = page.items.find(item => item.id === id);
  requireValue(value, 'Memory session does not exist', 404, 'memory_scope_denied');
  return { id, conversationId: id, scope: value.kind, kind: value.kind, project_id: value.projectId ?? null,
    strategy_id: value.strategyId ?? null, memory_scopes: value.memoryScopes ?? [], runId: value.runId ?? (id === host.context.sessionId ? host.context.runId : null) ?? null };
}

/** Serialize source verification plus mutation, so asynchronous evidence checks preserve CAS. */
export function withMemory(host, action) {
  const entry = holder(host);
  const task = entry.tail.catch(() => {}).then(async () => {
    const current = await context(host), repository = entry.repository;
    entry.hosts.set(current.id, host); repository.contexts.set(current.id, current);
    try {
      const services = { memory: repository.facade(current.id), journal: repository.journal(), context: current,
        evidence: ref => evidence(host, ref),
        recentArtifacts: async () => {
          const kinds = ['report', 'strategy.result', 'strategy.validation', 'resource'];
          const pages = await Promise.all(kinds.map(kind => host.data.query({
            source: source('artifacts'), input: { sessionId: current.id, kind }, limit: 20,
          })));
          return pages.flatMap(page => page.items).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
        },
        complete: async (input, signal) => {
          const result = await host.capabilities.invoke('host.model.complete', input, { signal });
          requireValue(result.type === 'result', 'Memory curation requires an immediate model response'); return result.value;
        },
        emit: payload => host.events.emit({ topic: 'workspace.memory.compaction', payload }),
      };
      const result = await action(services, repository);
      await flush(host, entry); return result;
    } finally { entry.hosts.delete(current.id); repository.contexts.delete(current.id); }
  });
  entry.tail = task; return task;
}

export async function activateMemory(host) {
  const entry = holder(host);
  await flush(host, entry);
  if (!entry.timer) {
    entry.timer = setInterval(() => {
      entry.tail = entry.tail.catch(() => {}).then(() => { entry.repository.maintain(); });
      void entry.tail.catch(() => {});
    }, entry.repository.policy().maintenance_interval_ms);
    entry.timer.unref?.();
  }
  return { ready: true, storage: 'plugin-private-sqlite' };
}

export async function disposeMemory(host) {
  const entry = repositories.get(host.context.storageRoot);
  if (!entry) return { closed: true };
  clearInterval(entry.timer); await entry.tail.catch(() => {}); await flush(host, entry);
  entry.repository.close(); repositories.delete(host.context.storageRoot); return { closed: true };
}

export const compactMemory = (host, input, signal) => withMemory(host, services => curate({ ...input, signal: signal ?? new AbortController().signal }, services));

export const releaseTaskMemory = (host, input, signal) => withMemory(host, async (services, repository) => {
  const owner = services.context;
  requireValue(owner.kind === 'main' && owner.id === input.ownerSessionId && input.reason === 'task_release'
    && input.workspaceRunId && input.conversationId !== owner.id, 'Task memory requires its durable owner session');
  const task = await context(host, input.conversationId);
  requireValue(task.kind !== 'main' && (!task.runId || task.runId === input.runId), 'Task memory source session changed');
  const sources = [...input.messages.map(item => item.source), ...input.artifactRefs.map(ref => ({ ...ref, type: 'artifact' }))];
  const sourceIds = stageTaskSources(services, sources, task);
  const sourceIdentity = value => JSON.stringify([value.type, value.id, value.revision, value.digest, value.kind, value.schemaVersion]);
  const durable = new Set(sources.map(sourceIdentity));
  const candidates = services.memory.candidates().items.filter(value => value.owner_conversation_id === task.id);
  const retained = [];
  for (const candidate of candidates) {
    if (Date.parse(candidate.expires_at) <= repository.clock()) continue;
    if (personalCategory(candidate.category) && !candidate.sources.some(ref => ref.type === 'user_message')) continue;
    let valid = true;
    for (const ref of candidate.sources) {
      if (durable.has(sourceIdentity(ref))) continue;
      if (ref.type === 'user_message') {
        // A child may already have cited an original main-session message.
        try { if ((await message(host, ref.id)).sessionId === owner.id) { durable.add(sourceIdentity(ref)); continue; } }
        catch (error) { if (error.code !== 'memory_source_invalid') throw error; }
      }
      valid = false; break;
    }
    if (valid) retained.push(candidate.id);
  }
  const handoff = repository.finishCandidates(task.id, owner.id, retained);
  const receipt = await curate({ ...input, signal: signal ?? new AbortController().signal }, services, sourceIds);
  return { ...handoff, curation: receipt };
});
