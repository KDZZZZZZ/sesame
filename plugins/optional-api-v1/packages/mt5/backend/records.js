import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { requireValue } from './support.js';

const databases = new Map();
export function records(host) {
  const root = resolve(host.context.storageRoot);
  if (databases.has(root)) return databases.get(root);
  mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(join(root, 'mt5.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(collection TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(collection,id))');
  const get = db.prepare('SELECT value FROM records WHERE collection=? AND id=?');
  const put = db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET value=excluded.value');
  const list = db.prepare('SELECT value FROM records WHERE collection=? ORDER BY id');
  const del = db.prepare('DELETE FROM records WHERE collection=? AND id=?');
  let depth = 0, configurationBusy = false;
  const pending = new Map();
  const store = {
    directory: root,
    get(collection, id, optional = false) {
      const row = get.get(collection, id);
      requireValue(row || optional, `MT5 record not found: ${collection}/${id}`, 404, 'NOT_FOUND');
      return row ? JSON.parse(row.value) : undefined;
    },
    put(collection, value) {
      requireValue(typeof value?.id === 'string' && value.id, 'MT5 records require a stable ID');
      const json = JSON.stringify(value); put.run(collection, value.id, json); return JSON.parse(json);
    },
    list(collection) { return list.all(collection).map(row => JSON.parse(row.value)); },
    update(collection, id, changes) { return store.transaction(() => store.put(collection, { ...store.get(collection, id), ...changes, id })); },
    delete(collection, id) { return del.run(collection, id).changes > 0; },
    transaction(fn) {
      const level = depth++, savepoint = `mt5_${level}`;
      db.exec(level ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
      try {
        const result = fn(); requireValue(!result?.then, 'MT5 SQLite transactions must be synchronous');
        db.exec(level ? `RELEASE ${savepoint}` : 'COMMIT'); return result;
      } catch (error) { db.exec(level ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK'); throw error; }
      finally { depth--; }
    },
    idempotent(id, fingerprint, fn) {
      return store.transaction(() => {
        const old = store.get('operation', id, true);
        requireValue(!old || old.fingerprint === fingerprint, 'Operation ID belongs to another request identity', 409, 'IDEMPOTENCY_CONFLICT');
        if (old) return old.result;
        const result = fn(); requireValue(!result?.then, 'Use idempotentAsync for asynchronous work');
        store.put('operation', { id, fingerprint, result }); return result;
      });
    },
    async idempotentAsync(id, fingerprint, fn) {
      const prior = pending.get(id);
      if (prior) { requireValue(prior.fingerprint === fingerprint, 'Operation ID belongs to another request identity', 409, 'IDEMPOTENCY_CONFLICT'); return prior.promise; }
      const old = store.get('operation', id, true);
      requireValue(!old || old.fingerprint === fingerprint, 'Operation ID belongs to another request identity', 409, 'IDEMPOTENCY_CONFLICT');
      if (old) return old.result;
      const promise = Promise.resolve().then(fn).then(result => { store.put('operation', { id, fingerprint, result }); return result; });
      pending.set(id, { fingerprint, promise });
      try { return await promise; } finally { pending.delete(id); }
    },
    assertIdle() { requireValue(!configurationBusy, 'MT5 configuration is busy', 409, 'mt5_busy'); },
    async exclusive(fn) { store.assertIdle(); configurationBusy = true; try { return await fn(); } finally { configurationBusy = false; } },
    close() { if (databases.get(root) === store) { db.close(); databases.delete(root); } },
  };
  databases.set(root, store); return store;
}

export const pluginIdentity = host => ({ id: host.context.pluginId, version: host.context.pluginVersion, digest: host.context.pluginRevision });
export const ownership = host => ({ conversation_id: host.context.sessionId, owner_run_id: host.context.runId ?? null, owner_task_id: null });
export const changed = (host, payload) => host.events.emit({ topic: 'workspace.mt5.configuration', payload });
