import { dirname, isAbsolute, resolve } from 'node:path';
import { stat, realpath } from 'node:fs/promises';
import { FileAccess, digest, inside, requireValue as check } from './file-access.js';

const queues = new Map(), MAX_BYTES = 50000, MAX_LINES = 2000;
const serial = (key, action) => {
  const task = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(action), tail = task.catch(() => {});
  queues.set(key, tail); void tail.finally(() => { if (queues.get(key) === tail) queues.delete(key); }); return task;
};
export function replacements(original, edits) {
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '', text = original.slice(bom.length).replaceAll('\r\n', '\n');
  const spans = edits.map(({ oldText, newText }) => {
    oldText = oldText.replaceAll('\r\n', '\n'); newText = newText.replaceAll('\r\n', '\n');
    check(oldText.length > 0, 'oldText cannot be empty');
    const start = text.indexOf(oldText); check(start >= 0 && text.indexOf(oldText, start + 1) === -1, 'Each oldText must match exactly one region of the original file');
    return { start, end: start + oldText.length, newText };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) check(spans[i - 1].end <= spans[i].start, 'Edits overlap; combine them into a single replacement');
  let content = text;
  for (const span of spans.toReversed()) content = content.slice(0, span.start) + span.newText + content.slice(span.end);
  return bom + (original.includes('\r\n') ? content.replaceAll('\n', '\r\n') : content);
}
function mime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
}
export function workspacePath(host, name) {
  const root = host.context.workspaceRoot;
  check(root && typeof name === 'string', 'An active workspace and file path are required');
  const path = resolve(root, name);
  check(inside(root, path), 'Path must stay inside the current workspace');
  return path;
}
async function checkedWorkspacePath(host, files, path) {
  const checked = await files.assertPath(path, { create: true, write: true });
  check(inside(await realpath(host.context.workspaceRoot), checked), 'Workspace symlink cannot escape the current workspace');
  return checked;
}

function boundedOutput(value = {}) {
  if (typeof value.output !== 'string') return value;
  const bytes = Buffer.from(value.output);
  if (bytes.length <= MAX_BYTES) return value;
  let offset = bytes.length - MAX_BYTES, output;
  for (; offset < bytes.length; offset++) {
    try { output = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset)); break; } catch { /* Skip a cut multibyte prefix. */ }
  }
  return { ...value, output: output ?? '', truncated: true };
}

export async function executeProcess(host, files, input, signal) {
  const cwd = await files.assertPath(input.cwd, { write: true });
  check((await stat(cwd)).isDirectory(), 'cwd must be a directory');
  const invoked = await host.capabilities.invoke('host.process.exec', { ...input, cwd }, { signal });
  check(invoked.type === 'run' && invoked.run?.id, 'Process execution must create a real host Run');
  const cancel = () => { void Promise.resolve(host.runs.cancel(invoked.run, { reason: 'Calling capability was cancelled' })).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (signal?.aborted) { cancel(); signal.throwIfAborted(); }
    for (;;) {
      const result = await host.runs.wait(invoked.run, { until: 'settled', timeoutMs: 30000, signal });
      if (result.reason === 'timeout') continue;
      const run = result.run;
      if (run.status !== 'completed') {
        const failure = run.error ?? {};
        const error = Object.assign(new Error(failure.message ?? `Process Run ${run.status}`), { ...(failure.name ? { name: failure.name } : {}), code: failure.code ?? 'PROCESS_FAILED', details: { ...boundedOutput(failure.details), run: { id: run.id, status: run.status } } });
        throw error;
      }
      return { ...boundedOutput(run.output), run: { id: run.id, status: run.status, ...(run.revision === undefined ? {} : { revision: run.revision }) }, receipt: invoked.receipt };
    }
  } finally { signal?.removeEventListener('abort', cancel); }
}

export function createCapabilities(host) {
  const files = new FileAccess(host.context);
  return [
    { name: 'read', execute: async (args, signal) => {
      const path = isAbsolute(args.path) ? args.path : workspacePath(host, args.path);
      const result = await files.bytes(path, { whole: true, signal }), bytes = result.bytes, mediaType = mime(bytes);
      if (mediaType) return { path: result.path, mediaType, encoding: 'base64', data: bytes.toString('base64'), bytes: bytes.length, digest: digest(bytes) };
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes), lines = text.split('\n'), start = (args.offset ?? 1) - 1;
      check(start <= lines.length, 'offset is beyond the end of the file');
      const selected = []; let size = 0;
      for (const line of lines.slice(start, start + (args.limit ?? MAX_LINES))) {
        const length = Buffer.byteLength(line) + 1; if (size + length > MAX_BYTES) break; selected.push(line); size += length;
      }
      check(selected.length > 0 || !text, 'A single line exceeds 50 KB; inspect it with workspace code');
      const next = start + selected.length;
      return { path: result.path, text: selected.join('\n'), offset: start + 1, lines: selected.length, next_offset: next < lines.length ? next + 1 : null, digest: digest(bytes) };
    } },
    { name: 'write', execute: (args, signal) => {
      const path = workspacePath(host, args.path);
      return serial(path, async () => {
        const checked = await checkedWorkspacePath(host, files, path);
        await files.mkdir({ path: dirname(checked) }, signal);
        return files.write({ ...args, path: checked, overwrite: args.overwrite ?? true }, signal);
      });
    } },
    { name: 'edit', execute: (args, signal) => {
      const path = workspacePath(host, args.path);
      return serial(path, async () => {
        const checked = await checkedWorkspacePath(host, files, path);
        const original = await files.bytes(checked, { whole: true, signal });
        const content = replacements(new TextDecoder('utf-8', { fatal: true }).decode(original.bytes), args.edits);
        const result = await files.write({ path: checked, content, overwrite: true, expected_sha256: digest(original.bytes) }, signal);
        return { ...result, replacements: args.edits.length };
      });
    } },
    { name: 'bash', execute: async (args, signal) => {
      const argv = process.platform === 'win32' ? ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', args.command] : ['/bin/bash', '-c', args.command];
      const cwd = await checkedWorkspacePath(host, files, workspacePath(host, args.cwd ?? '.'));
      return executeProcess(host, files, { argv, cwd, timeoutMs: (args.timeout ?? 60) * 1000 }, signal);
    } },
  ];
}
