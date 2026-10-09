// Minimal declared host ports; evidence and private SQLite remain the real plugin implementation.
import { join } from 'node:path';
export { Store } from './mt5-host.js';
export function judgmentHost(store, { isActive = () => true } = {}) {
  return {
    storage: { directory: join(store.directory, 'judgment-state') },
    workspace: { root: () => join(store.directory, 'workspace') },
    tasks: { read: id => store.get('conversation', id) },
    messages: { read: (id, optional) => store.get('message', id, optional) },
    datasets: { read: id => store.get('dataset', id), list: () => store.list('dataset') },
    plugins: { isActive },
  };
}
