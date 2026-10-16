import { statSync, statfsSync } from 'node:fs';

const size = path => { try { return statSync(path).size; } catch { return 0; } };

/** Reconstructible history only. Deal records and frozen research inputs are never evicted. */
export class MarketCache {
  constructor(market, { maxBytes = 512 * 1024 * 1024, ttlMs = 30 * 86400_000 } = {}) {
    this.market = market; this.db = market.db; this.maxBytes = Math.max(512 * 1024, maxBytes); this.ttlMs = ttlMs;
    this.db.exec(`CREATE TABLE IF NOT EXISTS cache_blocks(server TEXT,symbol TEXT,period TEXT,start INTEGER,end INTEGER,accessed INTEGER,PRIMARY KEY(server,symbol,period,start));
      CREATE INDEX IF NOT EXISTS cache_blocks_access ON cache_blocks(accessed);`);
    this.db.exec('PRAGMA cache_size=-8192; PRAGMA wal_autocheckpoint=64; PRAGMA journal_size_limit=1048576');
    if (!this.db.prepare('SELECT 1 FROM cache_blocks LIMIT 1').get()) {
      for (const row of this.db.prepare('SELECT server,symbol,period,MIN(time) start,MAX(time)+1 end FROM bars GROUP BY server,symbol,period').all()) this.touch(row);
    }
  }
  touch({ server, symbol, period, start, end }) {
    this.db.prepare(`INSERT INTO cache_blocks VALUES(?,?,?,?,?,?) ON CONFLICT(server,symbol,period,start)
      DO UPDATE SET end=MAX(end,excluded.end),accessed=excluded.accessed`).run(server, symbol, period, start, end, Date.now());
  }
  accessed(server, symbol, period, from, to) {
    this.db.prepare('UPDATE cache_blocks SET accessed=? WHERE server=? AND symbol=? AND period=? AND start<? AND end>? AND accessed<?').run(Date.now(), server, symbol, period, to, from, Date.now() - 60000);
  }
  stats() {
    return { bytes: size(this.market.databasePath) + size(`${this.market.databasePath}-wal`) + size(`${this.market.databasePath}-shm`), max_bytes: this.maxBytes };
  }
  trim(reserve = 0) {
    const rows = this.db.prepare('SELECT * FROM cache_blocks ORDER BY accessed,start').all();
    let changed = false;
    for (const block of rows) {
      const pressured = this.stats().bytes + reserve > this.maxBytes * .9;
      if (!pressured && block.accessed > Date.now() - this.ttlMs) break;
      const active = this.market.activeRanges.get(`${block.server}:${block.symbol}:${block.period}`);
      if (active && block.start < active.to && block.end > active.from) continue;
      this.db.exec('BEGIN');
      try {
        this.db.prepare('DELETE FROM bars WHERE server=? AND symbol=? AND period=? AND time>=? AND time<?').run(block.server, block.symbol, block.period, block.start, block.end);
        // Removing a chunk must also invalidate its coverage certificate.
        this.db.prepare('DELETE FROM ranges WHERE server=? AND symbol=? AND period=? AND start<? AND end>?').run(block.server, block.symbol, block.period, block.end, block.start);
        this.db.prepare('DELETE FROM cache_blocks WHERE server=? AND symbol=? AND period=? AND start=?').run(block.server, block.symbol, block.period, block.start);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      this.db.exec('PRAGMA incremental_vacuum(256); PRAGMA wal_checkpoint(TRUNCATE)'); changed = true;
    }
    if (changed) this.db.exec('PRAGMA incremental_vacuum; PRAGMA wal_checkpoint(TRUNCATE)');
    const free = statfsSync(this.market.databasePath), stats = this.stats();
    return { ...stats, writable: stats.bytes + reserve <= this.maxBytes && free.bavail * free.bsize > reserve + 16 * 1024 * 1024 };
  }
}
