import { execFile, execFileSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { runWorker } from '@sesame/plugin-sdk/transport/worker-client';
import { requireValue } from '../support.js';

const exec = promisify(execFile);
export const limaCommand = () => process.env.MT5AGENT_LIMACTL || ['/opt/homebrew/bin/limactl', '/usr/local/bin/limactl'].find(existsSync) || 'limactl';
export const limaInstance = () => process.env.MT5AGENT_LIMA_INSTANCE || 'mt5agent';
export const limaWorker = () => { const path = process.env.SESAME_MT5_LIMA_WORKER; requireValue(typeof path === 'string' && path.startsWith('/') && !path.split('/').includes('..') && !/[\r\n\0]/.test(path), '请先用 MT5 插件的 install-lima-worker.sh 部署编译组件，并设置 SESAME_MT5_LIMA_WORKER', 503, 'compiler_unavailable'); return path; };
const workerArgs = action => ['shell', '--workdir=/', limaInstance(), '/usr/local/bin/node', limaWorker(), action];
let cachedProbe, cachedAt = 0, cachedKey;

export function probeLima() {
  if (process.platform !== 'darwin') return { available: false, compiler: false, reason: 'Lima runner 仅用于 macOS' };
  const key = `${limaCommand()}\0${limaInstance()}\0${process.env.SESAME_MT5_LIMA_WORKER ?? ''}`;
  if (cachedProbe && key === cachedKey && Date.now() - cachedAt < (cachedProbe.available ? 30000 : 3000)) return cachedProbe;
  try {
    const stdout = execFileSync(limaCommand(), workerArgs('probe'), { encoding: 'utf8', timeout: 30000, stdio: 'pipe' });
    const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
    requireValue(typeof result.available === 'boolean' && typeof result.compiler === 'boolean', 'Lima 检测响应无效');
    cachedProbe = { ...result, backend: 'lima' };
  } catch {
    cachedProbe = { available: false, compiler: false, backend: 'lima', reason: 'Mac 执行环境未就绪；请按 Sesame 安装指南配置 Lima 研究环境，然后重新打开应用' };
  }
  cachedKey = key; cachedAt = Date.now();
  return cachedProbe;
}

export async function runLima(action, payload, options = {}) {
  requireValue(['compile-lima'].includes(action), '未知 Lima 操作');
  return runWorker(limaCommand(), workerArgs(action), payload, { ...options, label: 'Lima', errorCode: 'lima_unavailable' });
}

export async function compileWithLima(directory, manifestDigest, signal, runId) {
  signal?.throwIfAborted();
  // Transfer only verified, frozen inputs. Neither the host HOME nor the repo is mounted.
  const { stageFrozenBuild } = await import('../frozen-compiler.js');
  if (runId) requireValue(/^run_[0-9a-f-]{36}$/.test(runId), '构建任务 ID 无效');
  const prefix = runId ? `mt5agent-task-${runId}-build-` : 'mt5agent-build-';
  const staging = await fs.mkdtemp(join(tmpdir(), runId ? `mt5agent-task-${runId}-transfer-` : 'mt5agent-transfer-'));
  let remote, preserve = false;
  const shell = args => exec(limaCommand(), ['shell', '--workdir=/', limaInstance(), ...args], { timeout: 30000, maxBuffer: 65536 });
  try {
    await stageFrozenBuild(directory, manifestDigest, staging, signal);
    signal?.throwIfAborted();
    const { stdout } = await shell(['mktemp', '-d', `/tmp/${prefix}XXXXXXXX`]);
    remote = stdout.trim();
    requireValue(remote.startsWith(`/tmp/${prefix}`) && /^[A-Za-z0-9]+$/.test(remote.slice(`/tmp/${prefix}`.length)), 'Lima 构建目录无效');
    await exec(limaCommand(), ['copy', '--backend=scp', '-r', `${staging}/.`, `${limaInstance()}:${remote}/`], { signal, timeout: 120000, maxBuffer: 65536 });
    signal?.throwIfAborted();
    return await runLima('compile-lima', { directory: remote, manifest_sha256: manifestDigest, run_id: runId }, { signal, timeoutMs: 330000 });
  } catch (error) { preserve = error.code === 'runtime_cleanup_failed'; throw error; }
  finally {
    if (!preserve) {
      await fs.rm(staging, { recursive: true, force: true });
      if (remote?.startsWith(`/tmp/${prefix}`) && /^[A-Za-z0-9]+$/.test(remote.slice(`/tmp/${prefix}`.length))) await shell(['rm', '-rf', '--', remote]).catch(() => {});
    }
  }
}
