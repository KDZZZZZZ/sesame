import { spawn, execFileSync } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ApiError, digest, id, requireValue, taskRunId } from './support.js';

export function linuxCompilerDependencies() {
  if (process.platform !== 'linux') return false;
  try {
    for (const [command, args] of [['wine', ['--version']], ['Xvfb', ['-help']], ['xvfb-run', ['--help']], ['bwrap', ['--version']], ['systemctl', ['--version']]]) execFileSync(command, args, { timeout: 3000, stdio: 'pipe' });
    return true;
  } catch { return false; }
}

// Freeze the complete installed library, including resources used by its headers.
export async function fileManifest(directory, prefix = '', result = {}) {
  for (const entry of await fs.readdir(join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await fileManifest(directory, name, result);
    else {
      if (!entry.isFile()) throw new Error('构建输入不能包含链接或特殊文件');
      const bytes = await fs.readFile(join(directory, name));
      result[name] = { bytes: bytes.length, sha256: digest(bytes) };
    }
  }
  return result;
}

// The trusted WSL worker stages only the already-frozen build manifest. The compiler
// sees this private Linux copy, never the Windows filesystem, credentials or terminal.
export async function compileInWSL({ directory, editor, manifest_sha256, run_id }, signal) {
  requireValue(process.platform === 'linux' && /^[a-z]:[\\/]/i.test(directory ?? ''), '无效的 Windows 构建目录');
  requireValue(win32.normalize(editor ?? '').toLowerCase() === win32.join(directory, '.compiler', 'MetaEditor64.exe').toLowerCase(), '只能使用冻结编译器');
  signal?.throwIfAborted();
  const source = execFileSync('wslpath', ['-u', directory], { encoding: 'utf8', timeout: 5000 }).trim();
  return compileFrozenDirectory(source, manifest_sha256, signal, undefined, run_id && taskRunId(run_id));
}

export async function compileInLima({ directory, manifest_sha256, run_id }, signal) {
  const runId = run_id && taskRunId(run_id), prefix = runId ? `/tmp/mt5agent-task-${runId}-build-` : '/tmp/mt5agent-build-';
  requireValue(process.platform === 'linux' && typeof directory === 'string' && directory.startsWith(prefix) && /^[A-Za-z0-9]+$/.test(directory.slice(prefix.length)), '无效的 Lima 构建目录');
  requireValue(await fs.realpath(directory) === directory, 'Lima 构建目录不能是链接');
  return compileFrozenDirectory(directory, manifest_sha256, signal, 300000, runId);
}

export async function stageFrozenBuild(source, manifest_sha256, staging, signal) {
  const manifestBytes = await fs.readFile(join(source, 'manifest.json'));
  requireValue(manifestBytes.length <= 8 * 1024 * 1024, '构建清单过大');
  requireValue(digest(manifestBytes) === manifest_sha256, '构建清单摘要不匹配');
  const manifest = JSON.parse(manifestBytes);
  requireValue(manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files), '构建清单无效');
  const realSource = await fs.realpath(source);
  let total = 0;
  const entries = Object.entries(manifest.files);
  requireValue(entries.length <= 10000, '构建文件过多');
  for (const [name, expected] of entries) {
    signal?.throwIfAborted();
    requireValue(name && !posix.isAbsolute(name) && !/[\\:\x00]/.test(name) && !name.split('/').some(part => !part || part === '.' || part === '..'), '构建清单路径无效');
    const sourceFile = join(source, name), targetFile = join(staging, name);
    const stat = await fs.lstat(sourceFile);
    requireValue(stat.isFile() && stat.size === expected.bytes && stat.size <= 256 * 1024 * 1024, '冻结构建输入无效');
    const real = await fs.realpath(sourceFile), relative = posix.relative(realSource, real);
    requireValue(relative && !relative.startsWith('../') && !posix.isAbsolute(relative), '构建输入越过目录边界');
    total += stat.size;
    requireValue(total <= 512 * 1024 * 1024, '冻结构建超过 512 MiB');
    await fs.mkdir(join(targetFile, '..'), { recursive: true });
    await fs.copyFile(sourceFile, targetFile);
    requireValue(digest(await fs.readFile(targetFile)) === expected.sha256, '冻结构建输入摘要不匹配');
  }
  requireValue(manifest.files['.compiler/MetaEditor64.exe']?.sha256 === manifest.compiler_sha256, '编译器摘要不匹配');
  await fs.writeFile(join(staging, 'manifest.json'), manifestBytes);
}

export async function compileFrozenDirectory(source, manifest_sha256, signal, timeoutMs, runId) {
  const staging = await fs.mkdtemp(runId ? `/tmp/mt5agent-task-${runId}-compile-` : '/tmp/mt5agent-compile-');
  let preserve = false;
  try {
    await stageFrozenBuild(source, manifest_sha256, staging, signal);
    const result = await compileLinux({ editor: join(staging, '.compiler/MetaEditor64.exe') }, staging, signal, timeoutMs, runId);
    const ex5 = result.success ? await fs.readFile(join(staging, 'Experts/Strategy.ex5')) : null;
    requireValue(!ex5 || ex5.length <= 32 * 1024 * 1024 && digest(ex5) === result.ex5_sha256, '编译产物无效');
    return { ...result, ex5: ex5?.toString('base64') ?? null };
  } catch (error) { preserve = error.code === 'runtime_cleanup_failed'; throw error; }
  finally { if (!preserve) await fs.rm(staging, { recursive: true, force: true }); }
}

async function confirmScopeStopped(unit) {
  for (let attempt = 0; attempt < 20; attempt++) {
    let state;
    try { state = execFileSync('systemctl', ['--user', 'show', unit, '--property=ControlGroup,ActiveState,LoadState'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { state = ''; }
    const group = /^ControlGroup=(.*)$/m.exec(state)?.[1];
    let empty = !group;
    if (group && group.startsWith('/') && !group.split('/').includes('..') && group.split('/').at(-1) === unit) {
      try { empty = /(?:^|\n)populated 0(?:\n|$)/.test(await fs.readFile(`/sys/fs/cgroup${group}/cgroup.events`, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') empty = true; else throw error; }
    }
    if (empty && /(?:LoadState=not-found|ActiveState=(?:inactive|failed))/.test(state)) return;
    await delay(50);
  }
  throw new ApiError(503, 'runtime_cleanup_failed', '无法确认 MT5 隔离编译进程已完整清理；保留私有现场');
}

export async function compileLinux(native, directory, signal, timeoutMs = 120000, runId) {
  if (!native || process.platform !== 'linux') throw new ApiError(503, 'compiler_unavailable', '需要本机 MT5、Wine、Xvfb 和 bwrap 编译环境');
  signal?.throwIfAborted();
  const prefix = join(directory, '.wine');
  await fs.mkdir(prefix, { mode: 0o700 });
  const unit = `mt5agent-${runId ? `${runId}-` : ''}compile-${id('job').slice(4)}.scope`;
  const command = ['--user', '--scope', '--quiet', `--unit=${unit}`, '-p', 'MemoryMax=2G', '-p', 'MemorySwapMax=0', '-p', 'TasksMax=256', '-p', 'CPUQuota=200%',
    'bwrap', '--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv',
    '--ro-bind', '/usr', '/usr', '--ro-bind', '/bin', '/bin', '--ro-bind', '/lib', '/lib',
    ...(existsSync('/lib64') ? ['--ro-bind', '/lib64', '/lib64'] : []),
    ...(existsSync('/opt/wine-staging') ? ['--ro-bind', '/opt/wine-staging', '/opt/wine-staging'] : []),
    ...['/etc/ld.so.cache', '/etc/fonts', '/etc/alternatives'].filter(existsSync).flatMap(path => ['--ro-bind', path, path]),
    '--proc', '/proc', '--dev', '/dev', '--size', '268435456', '--tmpfs', '/tmp', '--dir', '/home/compiler',
    '--ro-bind', native.editor, '/terminal/MetaEditor64.exe', '--bind', directory, '/build',
    '--ro-bind', join(directory, 'Include'), '/build/Include',
    '--bind', prefix, '/prefix', '--setenv', 'HOME', '/home/compiler', '--setenv', 'PATH', '/usr/bin:/bin',
    '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'WINEPREFIX', '/prefix', '--setenv', 'WINEDEBUG', '-all',
    '--setenv', 'WINEDLLOVERRIDES', 'mscoree,mshtml=', '--setenv', 'LIBGL_ALWAYS_SOFTWARE', '1',
    '--chdir', '/build', '/usr/bin/xvfb-run', '-a', '-s', '-screen 0 1024x768x24', '/usr/bin/wine', '/terminal/MetaEditor64.exe',
    '/compile:Z:\\build\\Experts\\Strategy.mq5', '/include:Z:\\build', '/log'];
  let output = '', stopped = null;
  const child = spawn('systemd-run', command, { stdio: ['ignore', 'pipe', 'pipe'] });
  const kill = () => { try { execFileSync('systemctl', ['--user', 'kill', '--kill-whom=all', '--signal=KILL', unit], { stdio: 'ignore', timeout: 3000 }); } catch {} };
  const stop = reason => { if (stopped) return; stopped = reason; kill(); child.kill('SIGTERM'); };
  const abort = () => stop('编译已取消');
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => stop(`编译超过 ${timeoutMs / 1000} 秒`), timeoutMs);
  const collect = bytes => { output += bytes.toString(); if (output.length > 1024 * 1024) stop('编译输出超过限制'); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  try {
    const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)); });
    kill();
    if (stopped) throw new Error(stopped);
    let diagnostics;
    try { diagnostics = (await fs.readFile(join(directory, 'Experts/Strategy.log'))).toString('utf16le').replace(/^\uFEFF/, ''); }
    catch { throw new Error(`MetaEditor 没有生成编译日志（退出码 ${exitCode}）：${output.slice(-1500)}`); }
    const success = /Result: 0 errors, \d+ warnings/.test(diagnostics) && existsSync(join(directory, 'Experts/Strategy.ex5'));
    return { success, diagnostics, ex5_sha256: success ? digest(await fs.readFile(join(directory, 'Experts/Strategy.ex5'))) : null };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); kill();
    await confirmScopeStopped(unit);
    // The disposable prefix has never contained the user's terminal or credentials.
    await fs.rm(prefix, { recursive: true, force: true });
  }
}
