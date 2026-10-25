import { randomUUID } from 'node:crypto';
import { check, digest } from './common.js';

export class Pages {
  constructor(now = Date.now) { this.now = now; this.pages = new Map(); }
  async read(scope, query, page, load) {
    check(Number.isInteger(page?.limit) && page.limit >= 1 && page.limit <= 1000, 'page.limit must be 1..1000', 'INVALID_ARGUMENT');
    for (const [key, value] of this.pages) if (value.expires < this.now()) this.pages.delete(key);
    const key = digest([scope, query]); let data, offset = 0;
    if (page.cursor) {
      data = this.pages.get(page.cursor);
      check(data && data.key === key, 'Page cursor expired or changed scope', 'INVALID_CURSOR'); offset = data.offset;
    } else {
      const loaded = await load();
      check(Array.isArray(loaded.items) && loaded.items.length <= 20000 && Buffer.byteLength(JSON.stringify(loaded)) <= 16 * 1024 * 1024, 'Source snapshot exceeds the page budget', 'RESOURCE_EXHAUSTED');
      data = { ...loaded, key, scope, snapshotId: randomUUID(), expires: this.now() + 120000 };
    }
    const end = Math.min(offset + page.limit, data.items.length);
    const items = query.direction === 'backward' ? data.items.slice(Math.max(0, data.items.length - end), data.items.length - offset) : data.items.slice(offset, end);
    let nextCursor;
    if (end < data.items.length) {
      while (this.pages.size >= 64) this.pages.delete(this.pages.keys().next().value);
      nextCursor = randomUUID(); this.pages.set(nextCursor, { ...data, offset: end });
    }
    return { items: structuredClone(items), ...(nextCursor ? { nextCursor } : {}), metadata: { ...data.metadata, snapshotId: data.snapshotId, consistency: 'snapshot' } };
  }
  close(scope) { for (const [id, value] of this.pages) if (!scope || value.scope === scope) this.pages.delete(id); }
}
