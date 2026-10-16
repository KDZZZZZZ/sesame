import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const kinds = new Set(['decision_job', 'decision_simulation', 'decision_run', 'decision_channel', 'decision_block', 'decision_epoch', 'decision_guard']);
export class DecisionRecords {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, 'decisions.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,id))');
  }
  kind(value) { if (!kinds.has(value)) throw new Error('Unknown decision record kind'); return value; }
  get(kind, id, optional = false) {
    const row = this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(this.kind(kind), id);
    if (!row && !optional) throw Object.assign(new Error('Decision record does not exist'), { code: 'NOT_FOUND' });
    return row ? JSON.parse(row.body) : null;
  }
  list(kind) { return this.db.prepare('SELECT body FROM records WHERE kind=?').all(this.kind(kind)).map(row => JSON.parse(row.body)); }
  put(kind, value) { this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(this.kind(kind), value.id, JSON.stringify(value)); return structuredClone(value); }
  update(kind, id, changes) { return this.put(kind, { ...this.get(kind, id), ...changes }); }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); this.db.close(); }
}
