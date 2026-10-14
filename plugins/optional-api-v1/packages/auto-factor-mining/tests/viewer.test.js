import test from 'node:test';
import assert from 'node:assert/strict';
import { MiningRuntime } from '../runtime.js';
import { MiningActivityViewer } from '../viewer.js';

test('live HTML panel observes persisted state, enforces ownership and never writes another report', async t => {
  const rows = new Map(), views = new Map(); let writes = 0;
  const live = {
    open: async (descriptor, source) => {
      const viewId = 'view-' + descriptor.key;
      if (!views.has(viewId)) {
        const item = { descriptor, snapshot: source.read() };
        item.unsubscribe = source.subscribe(() => { item.snapshot = source.read(); }); views.set(viewId, item);
      }
      return { viewId, title: descriptor.title, mode: 'live', panel: 'report' };
    },
    close: async id => { views.get(id)?.unsubscribe(); views.delete(id); },
  };
  const host = { scope: { kind: 'service' }, agents: {}, reports: { live, files: { forSpace() { writes++; throw new Error('Viewer must not write files'); } } }, storage: {
    get(_collection, id) { return structuredClone(rows.get(id) ?? null); }, put(_collection, row) { rows.set(row.id, structuredClone(row)); return structuredClone(row); },
  } };
  const runtime = new MiningRuntime(host), viewer = new MiningActivityViewer(runtime);
  t.after(async () => { await viewer.dispose(); await runtime.dispose(); });
  runtime.save({ id: 'run', title: 'Live research', ownerConversationId: 'owner', status: 'running', phase: 'experiments', generation: 0,
    createdAt: 1, config: { rounds: 1, directions: ['momentum'] }, tasks: [], events: [], reportPending: false });
  const main = { scope: { kind: 'main', conversationId: 'owner' }, reports: { live } };
  await assert.rejects(viewer.open({ scope: { kind: 'main', conversationId: 'other' } }, 'run'), /another conversation/);
  await assert.rejects(viewer.open({ scope: { kind: 'subagent', conversationId: 'owner' } }, 'run'), /main conversation/);
  const first = await viewer.open(main, 'run'), again = await viewer.open(main, 'run');
  assert.equal(first.viewId, again.viewId); assert.equal(first.panel, 'report'); assert.equal(first.url, undefined);
  assert.match(views.get(first.viewId).descriptor.html, /reportLive\.subscribeSnapshot/);
  runtime.update('run', { status: 'completed' }); runtime.event('run', 'run.finished', 'Finished');
  const update = views.get(first.viewId).snapshot;
  assert.equal(update.run.status, 'completed'); assert.equal(update.events.at(-1).type, 'run.finished');
  assert.equal(writes, 0); assert.equal(viewer.read(main, 'run').run.status, 'completed');
  await viewer.dispose(); assert.equal(views.size, 0); assert.equal(runtime.listeners.size, 0);
});
