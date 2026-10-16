import { promises as fs } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, sep } from 'node:path';
import { requireValue, readTree } from './support.js';

const inside = (root, path) => { const name = relative(root, path); return name === '' || name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name); };
export function workspacePath(host, name) {
  requireValue(host.context.workspaceRoot && typeof name === 'string', 'MT5 file operations require an active workspace');
  const root = resolve(host.context.workspaceRoot), path = resolve(root, name);
  requireValue(inside(root, path), 'MT5 file path is outside the active workspace', 403, 'FORBIDDEN'); return path;
}
async function checked(host, name, create = false) {
  const root = await fs.realpath(host.context.workspaceRoot), path = workspacePath(host, name);
  let current = path;
  for (;;) {
    try { const info = await fs.lstat(current); requireValue(!info.isSymbolicLink() && inside(root, await fs.realpath(current)), 'MT5 workspace path follows a link', 403, 'FORBIDDEN'); break; }
    catch (error) { if (!create || error.code !== 'ENOENT') throw error; const parent = dirname(current); requireValue(parent !== current, 'Invalid workspace parent'); current = parent; }
  }
  return path;
}
export async function readWorkspace(host, name, signal) {
  signal?.throwIfAborted(); const path = await checked(host, name), info = await fs.lstat(path);
  requireValue(info.isFile() && info.size <= 32 * 1024 * 1024, 'MT5 input must be a bounded file'); return fs.readFile(path);
}
export async function writeWorkspace(host, name, content, signal) {
  signal?.throwIfAborted(); const path = await checked(host, name, true);
  await fs.mkdir(dirname(path), { recursive: true }); await checked(host, name, true); await fs.writeFile(path, content); return path;
}
export async function snapshotWorkspace(host, name) { return readTree(await checked(host, name)); }
