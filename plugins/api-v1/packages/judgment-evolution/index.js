import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { JudgmentService } from './service.js';
import { setInstance } from './state.js';
export { createTools } from './tools.js';

export async function activate(host) {
  // Copy only on first activation; the old user-owned state remains untouched.
  const file = join(host.storage.directory, 'judgments.sqlite');
  try { await fs.access(file); }
  catch {
    const previous = host.storage.legacy.path('workspaces/main/judgment-state');
    const source = join(previous, 'judgments.sqlite');
    try { await fs.access(source); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (await fs.stat(source).catch(error => { if (error.code !== 'ENOENT') throw error; return null; })) {
      const database = new DatabaseSync(source, { readOnly: true }), temporary = `${file}.import`;
      try { await backup(database, temporary); await fs.chmod(temporary, 0o600); await fs.rename(temporary, file); }
      finally { database.close(); await fs.rm(temporary, { force: true }); }
    }
  }
  const service = new JudgmentService(host).init(); setInstance(host, service);
  return { afterTurn: event => service.auditTurn(event), dispose: () => { service.close(); setInstance(host, null); } };
}
