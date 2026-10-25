import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function createRecords(root) {
  mkdirSync(resolve(root), { recursive: true });
  const db = new DatabaseSync(join(resolve(root), 'binance.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id))');
  const get = db.prepare('SELECT value FROM records WHERE kind=? AND id=?');
  const put = db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value');
  const all = db.prepare('SELECT value FROM records WHERE kind=? ORDER BY id');
  const trim = db.prepare("DELETE FROM records WHERE kind=? AND id IN (SELECT id FROM records WHERE kind=? ORDER BY COALESCE(json_extract(value,'$.at'),0) DESC,id DESC LIMIT -1 OFFSET ?) RETURNING id");
  return {
    get: (kind, id) => { const row = get.get(kind, id); return row ? JSON.parse(row.value) : undefined; },
    put: (kind, id, value) => { put.run(kind, id, JSON.stringify(value)); return structuredClone(value); },
    list: kind => all.all(kind).map(row => JSON.parse(row.value)),
    trimByTimestamp: (kind, limit) => trim.all(kind, kind, limit).map(row => row.id),
    remove: (kind, id) => db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id),
    close: () => db.close(),
  };
}
