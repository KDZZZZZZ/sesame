import { randomUUID } from 'node:crypto';
import { check, canonical, digest } from '@sesame/plugin-sdk/protocol';

/** One state owner per service: cursors, revisions, closure memory and polling lifetime. */
export function createProviderState({ now = Date.now } = {}) {
  const bindings = new Map(), pages = new Map(), revisions = new Map(), closedThrough = new Map(), streams = new Set(), lifetime = new AbortController();
  let nextRevision = 0n;
  function revised(item) {
    const key=item.id, prior=revisions.get(key);
    if(prior?.closed && item.isClosed===false)item={...item,isClosed:true,closure:prior.closure};
    const hash = digest(item);
    const revision = prior?.hash === hash ? prior.revision : String(nextRevision++);
    while(revisions.size >= 20000 && !revisions.has(key)) revisions.delete(revisions.keys().next().value);
    revisions.set(key, { hash, revision, ...(item.isClosed===true?{closed:true,closure:item.closure}:{}) }); return { ...item, revision };
  }
  async function paged(connection, method, input, load, fixed) {
    const limit = input.page?.limit;
    check(Number.isInteger(limit) && limit >= 1 && limit <= 200, 'page.limit must be 1–200', 'INVALID_ARGUMENT');
    const filter = { ...input }; delete filter.page;
    check(input.direction===undefined||['forward','backward'].includes(input.direction),'Invalid page direction','INVALID_ARGUMENT');
    const signature = digest({ method, connection, filter });
    for (const [key, value] of pages) if (now() - value.at > 60000) pages.delete(key);
    let snapshot, offset = 0;
    if (input.page.cursor) {
      const cursor = pages.get(input.page.cursor);
      check(cursor, 'QMT cursor expired; request a new snapshot', 'CURSOR_EXPIRED');
      check(cursor.signature === signature, 'Cursor filters or connection changed', 'INVALID_CURSOR');
      ({ snapshot, offset } = cursor);
    } else {
      const { rows, meta, extra } = await load();
      check(rows.length <= 20000 && Buffer.byteLength(canonical(rows)) <= 8 * 1024 * 1024, 'Native snapshot exceeds budget', 'RESOURCE_EXHAUSTED');
      snapshot = { id: randomUUID(), rows, meta, extra };
    }
    let nextCursor = null;
    if (offset + limit < snapshot.rows.length) {
      while (pages.size >= 64) pages.delete(pages.keys().next().value);
      nextCursor = randomUUID(); pages.set(nextCursor, { bindingId:input.bindingId, at: now(), signature, snapshot, offset: offset + limit });
    }
    if(input.bindingId) fixed({bindingId:input.bindingId});
    return structuredClone({ data: { items: input.direction==='backward' ? snapshot.rows.slice(Math.max(0,snapshot.rows.length-offset-limit),snapshot.rows.length-offset) : snapshot.rows.slice(offset, offset + limit), nextCursor, snapshotId: snapshot.id, consistency: 'snapshot' }, meta: snapshot.meta, ...snapshot.extra });
  }

  async function unbind(bindingId) {
    bindings.delete(bindingId);
    for (const [key, page] of pages) if (page.bindingId === bindingId) pages.delete(key);
    await Promise.allSettled([...streams].filter(stream => stream.bindingId === bindingId).map(stream => stream.close()));
  }
  async function dispose() {
    lifetime.abort();
    await Promise.allSettled([...streams].map(stream => stream.close()));
    bindings.clear(); pages.clear(); revisions.clear(); closedThrough.clear();
  }
  return { bindings, closedThrough, streams, lifetime, revised, paged, unbind, dispose };
}
