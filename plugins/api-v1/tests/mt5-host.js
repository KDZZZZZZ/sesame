// In-memory ports for isolated plugin behavior tests. Durable host integration
// is exercised separately against the installed SDK/host test harness.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
export { digest, id } from '../packages/mt5/backend/support.js';
export { mt5Import, mt5Path } from './mt5-path.js';
const copy = value => value === undefined ? value : structuredClone(value);
export class Store {
  constructor(directory) { this.directory = directory; this.rows = new Map(); this.requests = new Map(); this.events = []; mkdirSync(directory, { recursive: true }); }
  get(kind, id, optional = false) { const value = this.rows.get(`${kind}:${id}`); if (!value && !optional) throw Object.assign(new Error(`Missing ${kind}/${id}`), { code: 'not_found', status: 404 }); return copy(value); }
  put(kind, value, event) { this.rows.set(`${kind}:${value.id}`, copy(value)); if (event) this.event(event, value); return copy(value); }
  list(kind) { return [...this.rows].filter(([key]) => key.startsWith(`${kind}:`)).map(([, value]) => copy(value)); }
  update(kind, id, changes) { return this.put(kind, { ...this.get(kind, id), ...changes }); }
  delete(kind, id) { return this.rows.delete(`${kind}:${id}`); }
  transaction(action) { const rows = structuredClone(this.rows), requests = structuredClone(this.requests), events = [...this.events]; try { return action(); } catch (error) { this.rows = rows; this.requests = requests; this.events = events; throw error; } }
  idempotent(id, fingerprint, action) { const prior = this.requests.get(id); if (prior) { if (prior.fingerprint !== fingerprint) throw Object.assign(new Error('Idempotency conflict'), { code: 'idempotency_conflict' }); return copy(prior.value); } return this.transaction(() => { const value = action(); this.requests.set(id, { fingerprint, value: copy(value) }); return value; }); }
  event(type, data) { this.events.push({ type, data: copy(data) }); }
  cursor() { return String(this.events.length); }
  close() {}
}
export function hostForStore(store) {
  return { storage: { directory: store.directory, ...Object.fromEntries(['get','list','put','update','delete','transaction','idempotent'].map(name => [name, (...args) => store[name](...args)])) },
    datasets: { register: data => store.put('dataset', data), read: id => store.get('dataset', id), list: () => store.list('dataset') },
    workspace: { owner: conversation_id => ({ conversation_id }), root: id => join(store.directory, 'workspaces', id) },
    events: { emit: (name, data) => store.event(name, data) },
  };
}
