import { randomUUID } from 'node:crypto';
import { check, digest } from '@sesame/plugin-sdk/protocol';
import { closeWorkers } from './worker.js';
import { bindConnection, boundConnection, readConnection, sourceMetadata } from './connection.js';
import { instrumentSummary, searchInstruments, describeInstrument } from './instruments.js';
import { intervals, queryBars } from './history.js';
import { POLL_INTERVAL, subscribeBars } from './stream.js';

export { displayDecimals } from './instruments.js';

export const descriptor = {
  id: "market",
  contract: "sesame.market",
  versions: ["1.0.0"],
  capabilities: [
    "instruments.search",
    "instruments.describe",
    "bars.history",
    "bars.subscribe",
  ],
  limits: {
    transportMode: "poll",
    minPollIntervalMs: POLL_INTERVAL,
    maxPageSize: 500,
    timeframes: Object.keys(intervals),
    priceBases: ["last"],
    adjustments: ["none"],
  },
};
// This facade remains the sole owner of provider state and lifecycle. Helpers
// receive this same instance, including an injected native call boundary in tests.
export class CCXTProvider {
  constructor(host) {
    this.host = host;
    this.bindings = new Map();
    this.pages = new Map();
    this.revisions = new Map();
    this.closedThrough = new Map();
    this.streams = new Set();
    this.sequence = 0n;
  }
  bind(input, context) { return bindConnection(this, input, context); }
  bound(context, ref) { return boundConnection(this, context, ref); }
  async call(context, action, args = {}) { return readConnection(this, context, action, args); }
  meta(result) { return sourceMetadata(result); }
  summary(binding, row) { return instrumentSummary(binding, row); }
  async searchInstruments(input, context) { return searchInstruments(this, input, context); }
  async describeInstrument(input, context) { return describeInstrument(this, input, context); }
  async queryBars(input, context) { return queryBars(this, input, context); }
  async subscribeBars(input, context) { return subscribeBars(this, input, context); }

  async page(input, context, load) {
    const limit = input.page?.limit;
    check(
      Number.isInteger(limit) && limit >= 1 && limit <= 500,
      "page.limit must be 1..500",
    );
    check(
      input.direction === undefined ||
        ["forward", "backward"].includes(input.direction),
      "Invalid direction",
    );
    const filters = { ...input };
    delete filters.page;
    const key = digest([context.bindingId, filters]);
    for (const [id, p] of this.pages)
      if (p.expires < Date.now()) this.pages.delete(id);
    let p,
      offset = 0;
    if (input.page.cursor) {
      p = this.pages.get(input.page.cursor);
      check(
        p && p.key === key,
        "Cursor expired or filter identity changed",
        "INVALID_CURSOR",
      );
      offset = p.offset;
    } else {
      const loaded = await load();
      check(
        loaded.items.length <= 10000 &&
          Buffer.byteLength(JSON.stringify(loaded)) <= 8 * 1024 * 1024,
        "Snapshot budget exceeded",
        "RESOURCE_EXHAUSTED",
      );
      p = {
        ...loaded,
        key,
        bindingId: context.bindingId,
        expires: Date.now() + 60000,
        id: randomUUID(),
      };
    }
    const end = Math.min(offset + limit, p.items.length),
      items =
        input.direction === "backward"
          ? p.items.slice(
              Math.max(0, p.items.length - end),
              p.items.length - offset,
            )
          : p.items.slice(offset, end);
    let nextCursor = null;
    if (end < p.items.length) {
      while (this.pages.size >= 32)
        this.pages.delete(this.pages.keys().next().value);
      nextCursor = randomUUID();
      this.pages.set(nextCursor, { ...p, offset: end });
    }
    return {
      data: {
        items: structuredClone(items),
        snapshotId: p.id,
        consistency: "snapshot",
        nextCursor,
      },
      meta: p.meta,
      ...(p.extra ? { extra: p.extra } : {}),
    };
  }
  revise(bar) {
    const hash = digest(bar),
      old = this.revisions.get(bar.id),
      revision = old?.hash === hash ? old.revision : String(++this.sequence);
    while (this.revisions.size >= 50000 && !this.revisions.has(bar.id))
      this.revisions.delete(this.revisions.keys().next().value);
    this.revisions.set(bar.id, { hash, revision });
    return { ...bar, revision };
  }
  async unbind({ bindingId }) {
    this.bindings.delete(bindingId);
    await Promise.allSettled(
      [...this.streams]
        .filter((stream) => stream.bindingId === bindingId)
        .map((stream) => stream.close()),
    );
    for (const [id, p] of this.pages)
      if (p.bindingId === bindingId) this.pages.delete(id);
  }
  async dispose() {
    await Promise.allSettled([...this.streams].map((stream) => stream.close()));
    this.bindings.clear();
    this.pages.clear();
    this.revisions.clear();
    this.closedThrough.clear();
    await closeWorkers(this.host.context.storageRoot);
  }
}
