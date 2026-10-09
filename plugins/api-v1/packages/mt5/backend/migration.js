import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export const collections = ['mt5_project', 'mt5_revision', 'mt5_build', 'mt5_checkout', 'mt5_backtest', 'mt5_pass', 'mt5_command', 'mt5_deployment', 'mt5_preparation', 'mt5_connection_status', 'configuration_change'];

/** Read existing user data into the package namespace without modifying its source.
 * SQLite's backup API includes committed WAL pages in one consistent snapshot. */
export async function importDirectory(source, destination) {
  let entries;
  try { entries = await fs.readdir(source, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    if (/\.sqlite-(?:wal|shm)$/.test(entry.name)) continue;
    const oldPath = join(source, entry.name), newPath = join(destination, entry.name);
    if (entry.isDirectory()) { await importDirectory(oldPath, newPath); continue; }
    if (!entry.isFile()) throw new Error(`MT5 data migration requires a regular file: ${entry.name}`);
    try { await fs.access(newPath); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (entry.name.endsWith('.sqlite')) {
      const temporary = `${newPath}.${randomUUID()}.import`, database = new DatabaseSync(oldPath, { readOnly: true });
      try { await backup(database, temporary); await fs.chmod(temporary, 0o600); await fs.rename(temporary, newPath); }
      finally { database.close(); await fs.rm(temporary, { force: true }); }
    } else await fs.copyFile(oldPath, newPath, 1);
  }
}

export async function migrate(host) {
  if (host.storage.get('migration', 'initial', true)) return;
  await importDirectory(host.storage.legacy.path('mt5'), join(host.storage.directory, 'mt5'));
  host.storage.transaction(() => {
    for (const collection of collections) for (const record of host.storage.legacy.list(collection)) {
      if (collection === 'configuration_change' && record.target !== 'mt5') continue;
      if (!host.storage.get(collection, record.id, true)) host.storage.put(collection, record);
    }
    host.storage.put('migration', { id: 'initial', importedAt: new Date().toISOString() });
  });
}
