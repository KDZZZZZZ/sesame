import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (a, b) => ['kind', 'project_id', 'strategy_id'].every(key => a[key] === b[key]);
const assert = (condition, code = 'MEMORY_PLAN_INVALID') => { if (!condition) throw Object.assign(new Error(code), { code }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, keys) => assert(object(value) && Object.keys(value).every(key => keys.includes(key)));
const text = (value, max) => assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max);
const sourceKey = source => source.type === 'user_message' ? `user:${source.id}` : `artifact:${source.id}:${source.revision ?? ''}:${source.digest ?? ''}`;
const contentOf = message => (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
const SYSTEM = readFileSync(new URL('./curation.md', import.meta.url), 'utf8');
const CHUNK = 16000, MAX_BATCHES = 6;

// Defence in depth for unattended extraction. Sources remain in their original
// store; neither redacted transcripts nor model responses are journaled here.
export function redact(value) {
  return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED]')
    .replace(/\b(?:sk-(?:proj-|ant-)?|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9+/_=-]{12,}/gi, '[REDACTED]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|token|password|secret|密码|密钥)["']?\s*[:=]\s*["']?)[^"'\s,;}\n]{4,}/gi, '$1[REDACTED]');
}

function sourceText(host, source) {
  if (source.type === 'user_message') {
    const message = host.messages.read(source.id);
    assert(message.role === 'user' && !message.source_conversation_id && !message.system_generated && !message.owner_run_id && (!message.origin || ['user', 'human'].includes(message.origin)), 'MEMORY_SOURCE_INVALID');
    return redact(contentOf(message));
  }
  // Legacy candidate references remain available to manual memory tools; do
  // not guess their revision or turn a candidate's own prose into evidence.
  assert(typeof source.revision === 'string' && source.digest && source.kind && source.schemaVersion, 'MEMORY_SOURCE_INVALID');
  const { type, ...ref } = source, artifact = host.artifacts.read(ref);
  const excerpts = [];
  let remaining = 48000;
  for (const blob of artifact.manifest.blobs ?? []) {
    if (!remaining || !['text/plain', 'text/markdown', 'text/html'].includes(blob.mediaType) || blob.size > 256000) continue;
    let value = host.artifacts.readBlob(blob).toString('utf8');
    if (blob.mediaType === 'text/html') value = value.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    value = value.slice(0, remaining); remaining -= value.length;
    excerpts.push({ path: blob.path, text: value });
  }
  return redact(JSON.stringify({ title: artifact.manifest.title, content: artifact.manifest.content, excerpts }));
}

function enqueue(host, source, candidateId) {
  const id = hash([host.scope.conversationId, sourceKey(source)]), previous = host.storage.get('compaction_sources', id, true);
  if (previous) return;
  host.storage.put('compaction_sources', { id, conversationId: host.scope.conversationId, source, candidateId: candidateId ?? null, offset: 0, status: 'pending', createdAt: Date.now() });
}

function discoverSources(event, host, candidates) {
  for (const message of event.messages) if (message.source) enqueue(host, message.source);
  for (const candidate of candidates) for (const source of candidate.sources) enqueue(host, source, candidate.id);
  // Small immutable manifests are sufficient for source-backed references and
  // conclusions. We never execute reports or copy raw datasets/tool logs.
  let recent = [], offset = 0;
  for (;;) {
    const page = host.artifacts.list({ limit: 2000, offset });
    const eligible = page.items.filter(item => ['report', 'strategy.result', 'strategy.validation', 'resource'].includes(item.ref.kind)
      && host.artifacts.read(item.ref).context?.conversationId === host.scope.conversationId);
    recent = [...recent, ...eligible].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
    if (!page.hasMore) break;
    offset += page.items.length;
  }
  for (const item of recent) enqueue(host, { type: 'artifact', ...item.ref });
}

function existingMemories(host, documents) {
  const selected = new Map();
  for (const document of documents) {
    // Keep cold memories searchable without treating retrieval as adoption.
    for (const item of host.memory.search({ query: document.text.slice(0, 450), include_archived: true, limit: 12 }).items) selected.set(item.id, item);
  }
  for (const item of host.memory.index({ limit: 20 }).items) if (!selected.has(item.id)) selected.set(item.id, item);
  return [...selected.values()].slice(0, 40).map(item => host.memory.read(item.id));
}

function validatePlan(result, documents, memories, candidates, host) {
  assert(typeof result === 'string' && result.length <= 48000);
  // Fenced JSON is a harmless presentation choice, not an executable program.
  const plan = JSON.parse(result.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1'));
  fields(plan, ['entries']); assert(Array.isArray(plan.entries) && plan.entries.length <= 12);
  const sources = new Map(documents.map(document => [document.key, document]));
  const targets = new Map(memories.map(memory => [memory.id, memory]));
  const tree = host.memory.tree().categories;
  const used = new Set();
  return plan.entries.map(entry => {
    fields(entry, ['targetId', 'candidateId', 'category', 'scope', 'title', 'summary', 'content', 'evidence', 'citations', 'tags']);
    text(entry.category, 320); text(entry.title, 160); text(entry.summary, 600); text(entry.content, 6000);
    for (const key of ['category', 'title', 'summary', 'content']) entry[key] = entry[key].trim();
    assert(redact(JSON.stringify(entry)) === JSON.stringify(entry) && !JSON.stringify(entry).includes('[REDACTED]'), 'MEMORY_SENSITIVE_CONTENT');
    assert(['explicit', 'verified', 'inferred'].includes(entry.evidence));
    fields(entry.scope, ['kind', 'project_id', 'strategy_id']);
    const { kind, project_id, strategy_id } = entry.scope;
    assert(['global', 'project', 'strategy'].includes(kind));
    if (kind !== 'global') text(project_id, 160);
    if (kind === 'strategy') text(strategy_id, 160);
    if (kind !== 'global') assert(/^[\w.-]+$/.test(project_id));
    if (kind === 'strategy') assert(/^[\w.-]+$/.test(strategy_id));
    assert(!(kind === 'global' && (project_id || strategy_id)) && !(kind === 'project' && strategy_id));
    entry.scope = { kind, ...(kind !== 'global' ? { project_id } : {}), ...(kind === 'strategy' ? { strategy_id } : {}) };
    const parts = entry.category.split('/');
    if (parts[0] === 'projects') {
      assert(parts[1] === project_id && (parts.length === 3 && kind !== 'global' && tree.projects.includes(parts[2]) || parts.length === 5 && kind === 'strategy' && parts[2] === 'strategies' && parts[3] === strategy_id && tree.strategies.includes(parts[4])));
    } else assert(parts.length === 2 && tree[parts[0]]?.includes(parts[1]) && (parts[0] !== 'user' || kind === 'global'));
    if (host.scope.kind !== 'main') {
      const task = host.tasks.read(host.scope.conversationId);
      assert(kind === 'global' || project_id === task.project_id && (kind !== 'strategy' || strategy_id === task.strategy_id));
    }
    assert(entry.tags === undefined || Array.isArray(entry.tags) && entry.tags.length <= 12 && entry.tags.every(tag => typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 64));
    if (entry.tags) entry.tags = [...new Set(entry.tags.map(tag => tag.trim()))];
    assert(Array.isArray(entry.citations) && entry.citations.length > 0 && entry.citations.length <= 8);
    const cited = entry.citations.map(citation => {
      fields(citation, ['key', 'quote']); text(citation.key, 160); text(citation.quote, 1200);
      const document = sources.get(citation.key);
      assert(document && citation.quote.trim().length >= Math.min(8, document.text.trim().length) && document.text.includes(citation.quote), 'MEMORY_CITATION_INVALID');
      return document.source;
    });
    if (entry.evidence === 'explicit') assert(cited.some(source => source.type === 'user_message'), 'MEMORY_CITATION_INVALID');
    if (entry.evidence === 'verified') assert(cited.some(source => source.type === 'artifact'), 'MEMORY_CITATION_INVALID');
    const candidate = entry.candidateId ? candidates.find(candidate => candidate.id === entry.candidateId) : null;
    assert(!entry.candidateId || candidate, 'MEMORY_CANDIDATE_CHANGED');
    if (candidate) assert(candidate.category === entry.category && same(candidate.scope, entry.scope), 'MEMORY_CANDIDATE_CHANGED');
    const target = entry.targetId ? targets.get(entry.targetId) : memories.find(memory => memory.category === entry.category && same(memory.scope, entry.scope) && memory.title === entry.title);
    assert(!entry.targetId || target, 'MEMORY_TARGET_CHANGED');
    if (target) assert(target.category === entry.category && same(target.scope, entry.scope) && target.title === entry.title, 'MEMORY_TARGET_CHANGED');
    const identity = target?.id ?? hash([entry.category, entry.scope, entry.title]);
    assert(!used.has(identity), 'MEMORY_PLAN_DUPLICATE'); used.add(identity);
    return { candidate, target, memory: { category: entry.category, scope: entry.scope, title: entry.title, summary: entry.summary, content: entry.content, evidence: entry.evidence, tags: entry.tags ?? [],
      sources: [...new Map(cited.map(source => [sourceKey(source), source])).values()] } };
  });
}

function applyEntry(host, { candidate, target, memory }, batchId) {
  const operationId = hash([batchId, memory.category, memory.scope, memory.title]);
  const fingerprint = hash({ ...memory, tags: [...memory.tags].sort(), sources: memory.sources.map(sourceKey).sort() });
  const previous = host.storage.get('compaction_operations', operationId, true);
  // A retry may reorder entries or produce a new paraphrase. Only an exact
  // applied entry is deduplicated; a known rejection can be reconsidered with
  // fresh versions. Unknown writes must not be replayed. No prose is journaled.
  if (previous && previous.status !== 'rejected') return previous.status === 'applied' && previous.fingerprint === fingerprint ? 'deduplicated' : 'uncertain';
  const current = host.memory.search({ query: memory.title.slice(0, 450), limit: 200, include_expired: true }).items.map(item => host.memory.read(item.id));
  const unseenTarget = !target && current.find(value => value.category === memory.category && same(value.scope, memory.scope) && value.title === memory.title);
  target ??= unseenTarget;
  const protectedTarget = target && (unseenTarget || target.pinned || target.category === 'user/constraints' || target.status === 'conflict' || target.status === 'expired' || target.content.length > 1500 || redact(target.content) !== target.content);
  const changesEvidence = target && target.evidence !== memory.evidence;
  const propose = host.scope.kind !== 'main' || memory.evidence === 'inferred' || protectedTarget || changesEvidence;
  const duplicate = [...current, ...(propose ? host.memory.candidates().items : [])]
    .find(value => value.category === memory.category && same(value.scope, memory.scope) && value.content.normalize('NFKC').trim() === memory.content.normalize('NFKC').trim());
  if (duplicate && (!candidate || duplicate.id !== candidate.id)) {
    if (candidate && !propose && duplicate.evidence === memory.evidence && !duplicate.owner_conversation_id && !['conflict', 'expired'].includes(duplicate.status)) {
      host.memory.resolveCandidate({ id: candidate.id, action: 'accept', expected_version: candidate.version,
        category: duplicate.category, scope: duplicate.scope, title: duplicate.title, summary: duplicate.summary, content: duplicate.content, evidence: duplicate.evidence, sources: duplicate.sources });
    }
    return 'deduplicated';
  }
  if (propose && candidate) return 'deferred';
  const write = { ...memory, ...(target && propose ? { conflicts_with: [target.id] } : {}) };
  if (target && !propose) {
    // Preserve provenance and retention settings, never refresh last_used_at.
    write.sources = [...new Map([...target.sources, ...memory.sources].map(source => [sourceKey(source), source])).values()];
    assert(write.sources.length <= 20, 'MEMORY_SOURCE_BUDGET');
  }
  host.storage.put('compaction_operations', { id: operationId, fingerprint, status: 'applying', createdAt: Date.now() });
  let saved;
  try {
    saved = propose ? host.memory.propose(write) : host.memory.save({ ...write, ...(target ? { id: target.id, expected_version: target.version } : {}) });
  } catch (error) {
    // Known rejections have no new write. Unknown failures stay uncertain.
    const rejected = ['version_conflict', 'memory_forgotten', 'memory_source_invalid', 'memory_scope_denied'].includes(error.code);
    host.storage.put('compaction_operations', { id: operationId, fingerprint, status: rejected ? 'rejected' : 'uncertain', createdAt: Date.now() });
    throw error;
  }
  host.storage.put('compaction_operations', { id: operationId, fingerprint, status: 'applied', createdAt: Date.now() });
  if (candidate && !propose) host.memory.resolveCandidate({ id: candidate.id, action: 'accept', expected_version: candidate.version, ...write });
  return propose ? 'proposed' : target ? 'revised' : saved.deduplicated ? 'deduplicated' : 'saved';
}

export async function curate(event, host) {
  const candidates = host.memory.candidates().items.filter(candidate => Date.parse(candidate.expires_at) > Date.now());
  discoverSources(event, host, candidates);
  const pending = host.storage.list('compaction_sources').filter(source => source.conversationId === host.scope.conversationId && source.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
  const receipt = { id: hash([host.scope.conversationId, event.checkpointId]), conversationId: host.scope.conversationId, checkpointId: event.checkpointId, status: 'completed', counts: {}, processedChunks: 0, pendingSources: pending.length, updatedAt: Date.now() };
  const count = key => { receipt.counts[key] = (receipt.counts[key] ?? 0) + 1; };
  const contextWindow = event.modelLimits?.contextWindow ?? 32768;
  const maxTokens = Math.min(4096, event.modelLimits?.maxOutputTokens ?? 4096, Math.floor(contextWindow / 4));
  // Use a conservative UTF-8 budget, including the curation instructions.
  // A small configured model should receive smaller chunks, not overflow on
  // the very maintenance pass meant to relieve context pressure.
  const inputBudget = Math.floor((contextWindow - maxTokens) * 0.8) - Buffer.byteLength(SYSTEM);
  const chunkSize = Math.min(CHUNK, Math.max(256, Math.floor(inputBudget / 8)));
  try {
    // Source references survive a model-less compaction for the next configured
    // session. This is an expected lifecycle state, not a failed model request.
    if (!event.model) { receipt.status = 'skipped'; receipt.code = 'MODEL_UNAVAILABLE'; return receipt; }
    for (const queued of pending) {
      event.signal.throwIfAborted();
      if (receipt.processedChunks >= MAX_BATCHES) break;
      let evidence;
      try { evidence = sourceText(host, queued.source); }
      catch (error) {
        // Deleted or legacy evidence is not retried forever or reconstructed
        // from an assistant's account. Manual candidate review remains intact.
        if (!['MEMORY_SOURCE_INVALID', 'NOT_FOUND', 'not_found', 'task_private', 'FORBIDDEN'].includes(error.code)) throw error;
        host.storage.put('compaction_sources', { ...queued, status: 'unavailable' }); count('unavailable'); continue;
      }
      const evidenceDigest = hash(evidence);
      let offset = queued.contentDigest === evidenceDigest ? queued.offset : 0;
      while (offset < evidence.length && receipt.processedChunks < MAX_BATCHES) {
        event.signal.throwIfAborted();
        const end = Math.min(evidence.length, offset + chunkSize), key = hash([queued.id, evidenceDigest, offset]);
        const documents = [{ key, source: queued.source, text: evidence.slice(offset, end), truncated: offset > 0 || end < evidence.length }];
        const memories = existingMemories(host, documents);
        const batchId = hash([host.scope.conversationId, key]);
        const input = { scope: host.scope, documents, memories: memories.map(({ id, version, category, scope, title, summary, content, evidence, pinned, status }) => ({ id, version, category, scope, title: redact(title), summary: redact(summary), content: redact(content.slice(0, 1500)), truncated: content.length > 1500, evidence, pinned, status })),
          candidates: candidates.filter(candidate => candidate.sources.some(source => sourceKey(source) === sourceKey(queued.source))).slice(0, 12).map(({ id, category, title, summary, evidence }) => ({ id, category, title: redact(title), summary: redact(summary), evidence })), categories: host.memory.tree().categories };
        while (Buffer.byteLength(JSON.stringify(input)) > inputBudget && input.memories.length) input.memories.pop();
        while (Buffer.byteLength(JSON.stringify(input)) > inputBudget && input.candidates.length) input.candidates.pop();
        assert(Buffer.byteLength(JSON.stringify(input)) <= inputBudget, 'MEMORY_CONTEXT_TOO_SMALL');
        const visibleMemories = memories.filter(memory => input.memories.some(item => item.id === memory.id));
        const visibleCandidates = candidates.filter(candidate => input.candidates.some(item => item.id === candidate.id));
        const result = await host.inference.complete({ requestId: `memory-${batchId}`, model: event.model, systemPrompt: SYSTEM, input,
          maxTokens, reasoning: 'off', timeoutMs: 60000 }, event.signal);
        event.signal.throwIfAborted();
        const entries = validatePlan(result.text, documents, visibleMemories, visibleCandidates, host);
        let uncertain = false;
        for (const entry of entries) {
          event.signal.throwIfAborted();
          const outcome = applyEntry(host, entry, batchId);
          count(outcome); uncertain ||= outcome === 'uncertain';
        }
        receipt.processedChunks++;
        if (uncertain) break;
        offset = end;
        host.storage.put('compaction_sources', { ...queued, contentDigest: evidenceDigest, offset, status: end === evidence.length ? 'done' : 'pending' });
      }
      if (!evidence.length) host.storage.put('compaction_sources', { ...queued, status: 'done', contentDigest: evidenceDigest });
    }
  } catch (error) {
    receipt.status = event.signal.aborted ? 'canceled' : 'failed';
    receipt.code = typeof error.code === 'string' && /^[A-Za-z_]{1,64}$/.test(error.code) ? error.code : 'MEMORY_CURATION_FAILED';
    throw error;
  } finally {
    receipt.pendingSources = host.storage.list('compaction_sources').filter(source => source.conversationId === host.scope.conversationId && source.status === 'pending').length;
    if (receipt.status === 'completed' && (receipt.pendingSources || receipt.counts.uncertain)) receipt.status = 'partial';
    host.storage.put('compaction_receipts', receipt);
    const old = host.storage.list('compaction_receipts').filter(item => item.conversationId === host.scope.conversationId).sort((a, b) => b.updatedAt - a.updatedAt).slice(32);
    for (const item of old) host.storage.delete('compaction_receipts', item.id);
    host.events.emit('memory.compaction', receipt);
  }
  return receipt;
}

export function activate(host) {
  assert(typeof host.lifecycle?.onBeforeCompact === 'function', 'HOST_COMPACTION_HOOK_REQUIRED');
  const queues = new Map();
  const dispose = host.lifecycle.onBeforeCompact((event, scopedHost) => {
    const id = scopedHost.scope.conversationId, previous = queues.get(id) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(() => { event.signal.throwIfAborted(); return curate(event, scopedHost); });
    queues.set(id, task);
    void task.finally(() => { if (queues.get(id) === task) queues.delete(id); }).catch(() => {});
    return task;
  }, { timeoutMs: 180000 });
  return { dispose };
}
