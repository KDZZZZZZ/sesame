import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Order receipts are private business records. Commit them synchronously before
// native dispatch so a crash can never turn an uncertain send into a new order.
const databases = new Map();

export function savedConnections(host) {
  const path = join(resolve(host.context.storageRoot), 'public-connections.sqlite');
  if (!existsSync(path)) return [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare('SELECT value FROM records WHERE collection=? ORDER BY id').all('public_connections').map(({ value }) => {
      const { configuration, connection } = JSON.parse(value);
      return { exchange: configuration.exchange, connection: { id: connection.id, revision: connection.revision } };
    });
  } finally { db.close(); }
}

export function records(host) {
  const root = resolve(host.context.storageRoot);
  if (databases.has(root)) return databases.get(root);
  mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(join(root, 'public-connections.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(collection,id))');
  const read = db.prepare('SELECT value FROM records WHERE collection=? AND id=?');
  const write = db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET value=excluded.value');
  const all = db.prepare('SELECT value FROM records WHERE collection=? ORDER BY id');
  const remove = db.prepare('DELETE FROM records WHERE collection=? AND id=?');
  let depth = 0;
  const repository = {
    get(collection, id, optional = false) {
      const row = read.get(collection, id);
      if (!row && !optional) throw Object.assign(new Error(`Record not found: ${collection}/${id}`), { code: 'NOT_FOUND' });
      return row ? JSON.parse(row.value) : undefined;
    },
    put(collection, value) {
      if (typeof value?.id !== 'string' || !value.id) throw new TypeError('Private records require a nonempty string id');
      const json = JSON.stringify(value);
      write.run(collection, value.id, json);
      return JSON.parse(json);
    },
    list(collection) { return all.all(collection).map(row => JSON.parse(row.value)); },
    delete(collection, id) { return remove.run(collection, id).changes > 0; },
    transaction(fn) {
      const level = depth++, savepoint = `nested_${level}`;
      db.exec(level ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
      try {
        const result = fn();
        if (result && typeof result.then === 'function') throw new TypeError('Private receipt transactions must be synchronous');
        db.exec(level ? `RELEASE ${savepoint}` : 'COMMIT');
        return result;
      } catch (error) {
        db.exec(level ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
        throw error;
      } finally { depth--; }
    },
    close() { if (databases.get(root) === repository) { db.close(); databases.delete(root); } },
  };
  databases.set(root, repository);
  return repository;
}

export function closeRecords(host) { databases.get(resolve(host.context.storageRoot))?.close(); }
