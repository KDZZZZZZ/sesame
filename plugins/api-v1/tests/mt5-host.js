// Real plugin-private SQLite, with isolated API v2 host context and event/data ports.
// This helper never opens the host application's database.
import { join } from 'node:path';
import { records } from '../../optional-api-v1/packages/mt5/backend/records.js';
import { digest } from '../../optional-api-v1/packages/mt5/backend/support.js';
export { digest, id } from '../../optional-api-v1/packages/mt5/backend/support.js';
export { mt5Import, mt5Path } from './mt5-path.js';
export class Store {
  constructor(directory) {
    const store = records({ context: { storageRoot: directory } });
    store.events = [];
    store.event = (type, data) => store.events.push({ type, data: structuredClone(data) });
    store.cursor = () => String(store.events.length);
    return store;
  }
}
export function hostForStore(store, context = {}) {
  return {
    context: { pluginId: 'sesame/mt5', pluginVersion: 'fixture', pluginRevision: digest('mt5 fixture'), sessionId: 'fixture-main', runId: 'fixture-run', kind: 'main', storageRoot: store.directory, workspaceRoot: join(store.directory, 'workspace'), ...context },
    events: { emit: async ({ topic, payload }) => { store.event(topic, payload); return { accepted: true }; } },
    data: { query: async (_source, { query = {} } = {}) => ({ items: store.list('message').filter(row => (!query.sessionId || row.conversation_id === query.sessionId) && (!query.ids || query.ids.includes(row.id))), metadata: {} }) },
  };
}
