import { check, digest } from './shared.js';

export async function resourceJSON(host, ref) {
  const chunks = []; let offset = 0, size = 0;
  for (;;) {
    const page = await host.resources.read(ref, { part: 'content', encoding: 'base64', offset });
    const bytes = Buffer.from(page.content, 'base64'); size += bytes.length;
    check(size <= 32 * 1024 * 1024, 'CHECKPOINT_TOO_LARGE', 'Checkpoint exceeds 32 MiB'); chunks.push(bytes);
    if (page.nextOffset === undefined) return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    check(page.nextOffset > offset, 'INVALID_RESOURCE_PAGE', 'Resource cursor did not advance'); offset = page.nextOffset;
  }
}

/** In-memory domain state with ordered, explicit durable checkpoint barriers. */
export class Checkpoints {
  constructor(host) { this.host = host; this.runs = new Map(); this.datasets = new Map(); this.refs = new Map(); this.versions = new Map(); this.pending = new Map(); this.draining = false; this.tail = Promise.resolve(); }
  async load() {
    let cursor;
    do {
      const page = await this.host.state.query({ collection: 'runs', limit: 200, ...(cursor ? { cursor } : {}) });
      for (const { value, version } of page.items) {
        this.runs.set(value.id, await resourceJSON(this.host, value.payload)); this.versions.set(value.id, version);
        if (value.dataset) { this.refs.set(value.id, value.dataset); this.datasets.set(value.id, await resourceJSON(this.host, value.dataset)); }
      }
      cursor = page.nextCursor;
    } while (cursor);
    return this;
  }
  get(id) { return structuredClone(this.runs.get(id) ?? null); }
  all() { return [...this.runs.values()].map(value => structuredClone(value)); }
  dataset(id) { const value = this.datasets.get(id); check(value, 'NOT_FOUND', 'Frozen dataset is unavailable'); return structuredClone(value); }
  persist(id, kind, value) {
    const hash = digest(value);
    return this.host.resources.create({ kind: 'blob', lifetime: 'durable', name: `${id}-${kind}-${hash.slice(7)}.json`, source: { content: JSON.stringify(value) }, policy: { readOnly: true } }, { operationId: `${id}:${kind}:${hash}` });
  }
  async setDataset(id, value) { const ref = await this.persist(id, 'dataset', value); this.refs.set(id, ref); this.datasets.set(id, structuredClone(value)); return ref; }
  save(run) {
    const value = structuredClone(run), dataset = this.refs.get(run.id); this.runs.set(run.id, value);
    this.pending.set(run.id, { value, dataset });
    if (!this.draining) {
      this.draining = true;
      this.tail = this.tail.then(async () => {
        try {
          while (this.pending.size) {
            const [id, next] = this.pending.entries().next().value; this.pending.delete(id);
            const payload = await this.persist(id, 'run', next.value), expectedVersion = this.versions.get(id) ?? 0;
            await this.host.state.commit([{ op: 'put', key: { collection: 'runs', key: id }, expectedVersion,
              value: { id, ownerConversationId: next.value.ownerConversationId, status: next.value.status, payload, ...(next.dataset ? { dataset: next.dataset } : {}) } }]);
            this.versions.set(id, expectedVersion + 1);
          }
        } finally { this.draining = false; }
      });
    }
    // Domain mutations are synchronous; callers must await flush before a handoff
    // or successful capability response. Keep failures observable at that barrier.
    this.tail.catch(() => {}); return structuredClone(value);
  }
  flush() { return this.tail; }
}
