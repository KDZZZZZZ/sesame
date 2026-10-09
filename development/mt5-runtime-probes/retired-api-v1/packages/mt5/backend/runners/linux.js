import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { compilerSnapshotFrames } from '../compiler-snapshot.js';
import { networkEnvironment } from '@sesame/plugin-sdk/transport/network-policy';
import { taskRunId } from '../support.js';
import { digest } from '../support.js';
import { LINUX_ROLES, bundledPython, linuxError, prepareLinuxRoot, privateDirectory, runHelper, within } from '@sesame/plugin-sdk/transport/linux-rootfs';
import { prepareAppImageBwrap } from '@sesame/plugin-sdk/transport/linux-setup';

const source = name => fileURLToPath(new URL(`../resources/${name}`, import.meta.url));
const agentSource = name => fileURLToPath(new URL(`../resources/${name}`, import.meta.url));
const OUTPUT_BYTES = 1024 * 1024;
const LIMITS = Object.freeze({
  research: { 'memory.max': '402653184', 'memory.swap.max': '0', 'pids.max': '64', 'cpu.max': '100000 100000' },
  compiler: { 'memory.max': '2147483648', 'memory.swap.max': '0', 'pids.max': '256', 'cpu.max': '200000 100000' },
});
const controllerEnvironment = () => ({ PATH: '', LC_ALL: 'C', XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus` });
const unitName = runId => `mt5agent-${runId ? `${taskRunId(runId)}-` : ''}${randomUUID()}.scope`;

async function remove(path) {
  try { await fs.rm(path, { recursive: true, force: true }); }
  catch (error) { throw linuxError(`Linux task scratch cleanup failed: ${error.message}`, 'runtime_cleanup_failed'); }
}
async function readJSON(path, maximum = 65536) {
  const info = await fs.lstat(path);
  if (!info.isFile() || info.nlink !== 1 || info.size > maximum) throw linuxError('Linux task result is not a bounded regular file');
  return JSON.parse(await fs.readFile(path, 'utf8'));
}
async function stopScope(unit, state) {
  const env = controllerEnvironment();
  await runHelper('/usr/bin/systemctl', ['--user', 'kill', '--kill-whom=all', '--signal=KILL', unit], { env, timeoutMs: 3000 }).catch(() => {});
  let group;
  try { group = (await readJSON(join(state, 'ready.json'))).cgroup; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (group && (!within('/sys/fs/cgroup', group) || group.split('/').at(-1) !== unit)) throw linuxError('Linux task reported an invalid cgroup', 'runtime_cleanup_failed');
  for (let attempt = 0; attempt < 20; attempt++) {
    let empty = !group;
    if (group) {
      try { empty = /(?:^|\n)populated 0(?:\n|$)/.test(await fs.readFile(join(group, 'cgroup.events'), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') empty = true; else throw error; }
    }
    const status = await runHelper('/usr/bin/systemctl', ['--user', 'show', unit, '--property=LoadState,ActiveState'], { env, timeoutMs: 3000 });
    if (empty && /(?:LoadState=not-found|ActiveState=(?:inactive|failed))/.test(status)) return;
    await delay(50);
  }
  throw linuxError('Linux task process cleanup could not be confirmed', 'runtime_cleanup_failed');
}

async function runScoped(root, bwrap, state, config, { signal, timeoutMs, stdin = '', onData } = {}) {
  signal?.throwIfAborted();
  const python = bundledPython(root), env = { ...controllerEnvironment(), ...python.env };
  await fs.writeFile(join(state, 'request.json'), JSON.stringify({ ...config, bwrap, python: python.command, libraries: python.args[1], python_binary: python.args[2], seccomp: agentSource('seccomp.py') }), { mode: 0o600 });
  const compiler = config.limits === LIMITS.compiler;
  const args = ['--user', '--scope', '--quiet', `--unit=${config.unit}`, '-p', `MemoryMax=${config.limits['memory.max']}`, '-p', 'MemorySwapMax=0',
    '-p', `TasksMax=${config.limits['pids.max']}`, '-p', `CPUQuota=${compiler ? '200%' : '100%'}`, python.command, ...python.args, source('linux-scope.py'), join(state, 'request.json')];
  const child = spawn('/usr/bin/systemd-run', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let failure, killing, output = '', total = 0;
  const stop = error => {
    failure ??= error;
    killing ??= runHelper('/usr/bin/systemctl', ['--user', 'kill', '--kill-whom=all', '--signal=KILL', config.unit], { env: controllerEnvironment(), timeoutMs: 3000 }).catch(() => {}).finally(() => child.kill('SIGKILL'));
  };
  const abort = () => stop(signal.reason ?? linuxError('Linux task canceled'));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => stop(linuxError('Linux task timed out')), timeoutMs);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
    total += bytes.length;
    if (total > OUTPUT_BYTES) { stop(linuxError('Linux task output exceeded 1 MiB')); return; }
    output += bytes.toString();
    try { onData?.(bytes); } catch (error) { stop(error); }
  });
  child.stdin.on('error', () => {}); child.stdin.end(stdin);
  let processError, code;
  try { code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); }); }
  catch (error) { processError = error; }
  finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); await killing;
    try { await stopScope(config.unit, state); }
    catch (error) { throw linuxError(`Linux task cleanup failed: ${error.message}`, 'runtime_cleanup_failed'); }
  }
  signal?.throwIfAborted();
  if (failure || processError) throw failure ?? processError;
  if (code !== 0) throw linuxError(`Bundled Linux launcher failed: ${output.slice(-1500)}`);
  const ready = await readJSON(join(state, 'ready.json')), result = await readJSON(join(state, 'result.json'));
  if (JSON.stringify(ready.limits) !== JSON.stringify(config.limits) || !Number.isInteger(result.exitCode) || result.oomKilled !== 0) throw linuxError('Linux task failed its resource or completion gate');
  return { exitCode: result.exitCode, output };
}

async function mounts(root, work, compiler, networkEnv) {
  // Mount the private extracted image, never host /usr, Python, Node or Wine.
  const args = ['--unshare-all', '--share-net', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv',
    ...['usr', 'bin', 'lib', 'lib64'].flatMap(name => ['--ro-bind', join(root, name), `/${name}`]),
    '--proc', '/proc', '--dev', '/dev', '--size', compiler ? '268435456' : '67108864', '--tmpfs', '/tmp', '--dir', '/home/agent',
    '--bind', work, '/work', '--ro-bind', agentSource('file-helper.py'), '/runner/file-helper.py',
    '--setenv', 'HOME', '/home/agent', '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin', '--setenv', 'LANG', 'C.UTF-8',
    ...Object.entries(networkEnvironment(networkEnv)).flatMap(([key, value]) => ['--setenv', key, value]), '--chdir', '/work'];
  for (const name of ['opt', 'etc/fonts', 'etc/ssl', 'etc/ld.so.cache', 'etc/alternatives', 'etc/passwd', 'etc/group']) {
    try { await fs.stat(join(root, name)); args.push('--ro-bind', join(root, name), `/${name}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return args;
}

async function networkMounts(args) {
  // OS resolver configuration is data, not a runtime/tool fallback. Public CA
  // certificates remain in the bundled image; no user certificate store mounts.
  for (const path of ['/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf']) {
    try { if ((await fs.stat(path)).isFile()) args.push('--ro-bind', path, path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export function createLinuxBackend(bundle, { directory } = {}) {
  if (process.platform !== 'linux' || process.arch !== 'x64' || bundle?.platform !== 'linux' || bundle.arch !== 'x64'
      || !isAbsolute(directory ?? '') || LINUX_ROLES.some(role => !isAbsolute(bundle.paths?.[role] ?? ''))) throw linuxError('Linux backend requires the matching verified bundle and private state directory');
  let preparing, preparingBwrap;
  const trustedBwrap = signal => preparingBwrap ??= prepareAppImageBwrap(bundle, signal, directory).catch(error => { preparingBwrap = undefined; throw error; });
  const runtimeRoot = signal => preparing ??= (async () => ({ root: await prepareLinuxRoot(bundle, resolve(directory), signal), bwrap: await trustedBwrap(signal) }))().catch(error => { preparing = undefined; throw error; });
  async function stateDirectory() { return fs.mkdtemp(join(await privateDirectory(join(directory, 'linux-tasks')), 'task-')); }
  return {
    async compile(buildDirectory, manifestDigest, { signal, runId } = {}) {
      signal?.throwIfAborted();
      const { root, bwrap } = await runtimeRoot(signal), state = await stateDirectory(), python = bundledPython(root);
      let preserve = false;
      try {
        const incoming = join(state, 'snapshot'); await fs.mkdir(incoming, { mode: 0o700 });
        const snapshot = JSON.parse(await runHelper(python.command, [...python.args, source('compiler-snapshot.py'), '--parent', incoming, '--manifest-sha256', manifestDigest],
          { env: python.env, signal, input: compilerSnapshotFrames(buildDirectory, manifestDigest, { signal }), timeoutMs: 120000 }));
        const frozen = snapshot.directory;
        if (!within(incoming, frozen) || frozen === incoming || await fs.realpath(frozen) !== frozen || snapshot.manifest_sha256 !== manifestDigest) throw linuxError('Linux compiler snapshot directory is invalid');
        const work = join(state, 'work'), prefix = join(state, 'prefix');
        await fs.mkdir(work); await fs.mkdir(prefix); await fs.mkdir(join(frozen, 'Include'), { recursive: true });
        const args = await mounts(root, work, true, {}); await networkMounts(args);
        args.push('--bind', frozen, '/build', '--ro-bind', join(frozen, 'Include'), '/build/Include', '--ro-bind', join(frozen, '.compiler'), '/build/.compiler',
          '--ro-bind', join(frozen, 'manifest.json'), '/build/manifest.json', '--ro-bind', join(frozen, '.compiler/MetaEditor64.exe'), '/terminal/MetaEditor64.exe',
          '--bind', prefix, '/prefix', '--ro-bind', source('compiler-entry.py'), '/usr/share/sesame-runtime/compiler_entry.py', '--setenv', 'SESAME_COMPILER_GUEST', '1');
        const result = await runScoped(root, bwrap, state, { unit: unitName(runId), limits: LIMITS.compiler, arguments: args,
          argv: ['/usr/bin/python3', '/usr/share/sesame-runtime/compiler_entry.py', '--manifest-sha256', manifestDigest, '--budget', 'standard', '--timeout', '115'] }, { signal, timeoutMs: 120000 });
        if (result.exitCode !== 0) throw linuxError(`Linux compiler entry failed: ${result.output.slice(-1500)}`);
        const compiled = await readJSON(join(work, 'compile-result.json'), 8 * 1024 ** 2);
        if (typeof compiled.success !== 'boolean' || typeof compiled.diagnostics !== 'string' || (compiled.success ? !/^sha256:[a-f0-9]{64}$/.test(compiled.ex5_sha256) : compiled.ex5_sha256 !== null)) throw linuxError('Linux compiler result is invalid');
        let ex5 = null;
        if (compiled.success) {
          const path = join(work, 'Strategy.ex5'), info = await fs.lstat(path);
          if (!info.isFile() || info.nlink !== 1 || info.size === 0 || info.size > 32 * 1024 ** 2) throw linuxError('Linux compiler artifact exceeds its file budget');
          const bytes = await fs.readFile(path);
          if (digest(bytes) !== compiled.ex5_sha256) throw linuxError('Linux compiler artifact digest is invalid');
          ex5 = bytes.toString('base64');
        }
        signal?.throwIfAborted();
        return { success: compiled.success, diagnostics: compiled.diagnostics, ex5, ex5_sha256: compiled.ex5_sha256 };
      } catch (error) { preserve = error.code === 'runtime_cleanup_failed'; throw error; }
      finally { if (!preserve) await remove(state); }
    },
  };
}
