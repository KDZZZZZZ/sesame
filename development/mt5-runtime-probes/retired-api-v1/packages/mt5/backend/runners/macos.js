import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { compilerSnapshotFrames } from '../compiler-snapshot.js';
import { assertPortableTree } from '@sesame/plugin-sdk/transport/portable-tree';
import { taskRunId } from '../support.js';
import { runGuest } from '@sesame/plugin-sdk/transport/guest-client';

const ROLES = ['qemu', 'qemu_bios', 'compiler_kernel', 'compiler_initramfs', 'compiler_root_image'];
const inside = (root, path) => { const name = relative(root, path); return name && name !== '..' && !name.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(name); };
const check = (value, message) => { if (!value) throw new Error(message); };
const cleanupError = cause => Object.assign(new Error('Mac 运行环境未能确认完整清理', { cause }), { code: 'runtime_cleanup_failed' });
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function seatbelt(bundle, scratch, broker) {
  const quote = JSON.stringify, ancestors = [];
  for (const base of [bundle.root, scratch]) {
    for (let path = dirname(base); path !== dirname(path); path = dirname(path)) ancestors.push(path);
  }
  return [
    '(version 1)', '(deny default)',
    `(allow process-exec (literal ${quote(bundle.paths.qemu)}))`,
    '(allow sysctl-read)', '(allow process-info* (target self))', '(allow signal (target self))',
    '(allow file-read* (subpath "/System") (subpath "/usr/lib") (subpath "/usr/share/locale")',
    '  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom")',
    `  (subpath ${quote(bundle.root)}) (subpath ${quote(scratch)}))`,
    '(allow file-map-executable (subpath "/System/Library") (subpath "/usr/lib")',
    `  (subpath ${quote(bundle.root)}))`,
    '(allow file-read* (require-all (literal "/") (vnode-type DIRECTORY)))',
    '(allow file-read-metadata',
    ...[...new Set(ancestors)].map(path => `  (require-all (literal ${quote(path)}) (vnode-type DIRECTORY))`), ')',
    `(allow file-write* (subpath ${quote(scratch)}) (literal "/dev/null"))`, '(allow network*)',
    ...(broker ? ['(allow file-read* (literal "/etc/resolv.conf") (literal "/private/etc/resolv.conf") (literal "/private/var/run/resolv.conf"))',
      '(allow mach-lookup (global-name "com.apple.SystemConfiguration.DNSConfiguration"))'] : []), '',
  ].join('\n');
}

function compilerArguments(paths, profile) {
  const nodes = [
    { driver: 'file', 'node-name': 'runtime-root-file', filename: paths.compiler_root_image, 'read-only': true, 'auto-read-only': false },
    { driver: 'raw', 'node-name': 'runtime-root', file: 'runtime-root-file', 'read-only': true, 'auto-read-only': false },
  ];
  return ['-f', profile, paths.qemu, '-run-with', 'exit-with-parent=on', '-no-user-config',
    '-machine', 'q35', '-accel', 'tcg,thread=multi', '-cpu', 'max', '-smp', '2', '-m', '4096',
    '-nodefaults', '-no-reboot', '-display', 'none', '-monitor', 'none', '-serial', 'none',
    '-chardev', 'stdio,id=console,signal=off', '-device', 'virtio-serial-pci', '-device', 'virtconsole,chardev=console',
    '-nic', 'none', '-L', dirname(paths.qemu_bios), '-bios', paths.qemu_bios,
    '-kernel', paths.compiler_kernel, '-initrd', paths.compiler_initramfs,
    '-append', 'console=hvc0 rdinit=/init quiet panic=-1 sesame-p0=1',
    ...nodes.flatMap(node => ['-blockdev', JSON.stringify(node)]), '-device', 'virtio-blk-pci,drive=runtime-root'];
}

function filesFrom(result, compiler = false) {
  const tree = result.files;
  check(tree && typeof tree === 'object' && !Array.isArray(tree) && Object.keys(tree).length <= 256, '无效的运行环境文件响应');
  const decoded = {};
  let total = 0;
  for (const [name, encoded] of Object.entries(tree)) {
    check(Buffer.byteLength(name) <= 1024 && name.split('/').length <= 64, '运行环境文件路径过长');
    check(typeof encoded === 'string' && encoded.length <= (compiler ? 48 : 12) * 1024 * 1024, '运行环境文件过大');
    const bytes = Buffer.from(encoded, 'base64');
    check(bytes.toString('base64') === encoded && bytes.length <= (compiler ? 32 : 8) * 1024 * 1024, '运行环境文件编码或大小无效');
    total += bytes.length;
    check(total <= (compiler ? 48 : 16) * 1024 * 1024, '运行环境文件总量过大');
    Object.defineProperty(decoded, name, { value: bytes, enumerable: true });
  }
  assertPortableTree(decoded);
  return decoded;
}

function completed(result, compiler) {
  check(Number.isInteger(result?.exitCode) && result.stopped === null, `代码执行结束：${result?.stopped || 'invalid_response'}`);
  const limits = { 'memory.max': compiler ? '2147483648' : '402653184', 'memory.swap.max': '0',
    'pids.max': compiler ? '256' : '64', 'cpu.max': compiler ? '200000 100000' : '100000 100000' };
  check(Object.entries(limits).every(([name, value]) => result.metrics?.[name] === value), '运行环境资源约束不匹配');
  if (!/(?:^|\n)populated 0(?:\n|$)/.test(result.metrics['cgroup.events'] ?? '')
      || !Number.isFinite(result.cleanup_ms) || result.cleanup_ms < 0 || result.cleanup_ms > 2000) throw cleanupError();
}

/** The caller supplies a preflight-verified installation and an app-private root. */
export function createMacOSBackend(bundle, { directory, spawnProcess = spawn } = {}) {
  check(bundle?.platform === 'darwin' && bundle.arch === 'arm64' && bundle.protocolVersion === 1
    && isAbsolute(bundle.root) && ROLES.every(role => isAbsolute(bundle.paths?.[role] ?? '') && inside(bundle.root, bundle.paths[role])),
  'Mac 自带运行环境缺少必需组件');
  check(typeof directory === 'string' && isAbsolute(directory), 'Mac 运行环境目录必须是应用私有绝对路径');
  const root = resolve(directory);

  async function invoke(kind, request, options = {}) {
    options.signal?.throwIfAborted();
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    check((await fs.realpath(root)).normalize('NFC') === root.normalize('NFC') && !(await fs.lstat(root)).isSymbolicLink(),
      'Mac 运行目录不能被链接重定向');
    const parent = await fs.stat(root, { bigint: true });
    const scratch = await fs.mkdtemp(join(root, 'task-'));
    await fs.chmod(scratch, 0o700);
    const owned = await fs.lstat(scratch, { bigint: true });
    let failure, response;
    try {
      const profile = join(scratch, 'qemu.sb'), compiler = kind === 'compiler';
      await fs.writeFile(profile, seatbelt(bundle, scratch, !compiler), { flag: 'wx', mode: 0o600 });
      const env = { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: scratch, TMP: scratch, TEMP: scratch,
        LC_ALL: 'C', QEMU_AUDIO_DRV: 'none', GIO_USE_VFS: 'local', GSETTINGS_BACKEND: 'memory' };
      const lifetime = 45000 + options.timeoutMs + 2000;
      response = await runGuest({
        command: compiler ? '/usr/bin/sandbox-exec' : bundle.paths.launcher,
        args: compiler ? compilerArguments(bundle.paths, profile) : ['--kernel', bundle.paths.kernel, '--initrd', bundle.paths.initramfs,
          '--qemu', bundle.paths.qemu, '--broker-profile', profile, '--lifetime-ms', String(lifetime)],
        cwd: scratch, env, request, frames: options.frames, signal: options.signal, onData: options.onData,
        timeoutMs: options.timeoutMs, bootTimeoutMs: compiler ? 180000 : 45000,
        cleanupTimeoutMs: 2000, cancelTimeoutMs: 2000, spawnProcess,
        ...(compiler ? { shutdownRequest: { action: 'shutdown' }, terminateOnFailure: true } : {}),
        validateReady(value) {
          check(value.protocol_version === 1 && value.network?.enabled === !compiler, 'Mac 运行协议或网络初始化状态不匹配');
        },
        validateCleanup(events, termination) {
          if (termination.forced_termination || !termination.helper_exited || termination.helper_exit_signal !== null) throw cleanupError();
          if (compiler) {
            if (termination.helper_exit_code !== 0) throw cleanupError();
            return;
          }
          const cleanup = events.filter(event => event.schema === 'sesame.macos-runtime.v1' && event.event === 'cleanup');
          if (cleanup.length !== 1 || cleanup[0].accepted !== true || cleanup[0].vm_stopped !== true
            || cleanup[0].broker_reaped !== true || !Number.isFinite(cleanup[0].elapsed_ms) || cleanup[0].elapsed_ms < 0 || cleanup[0].elapsed_ms > 2000)
            throw cleanupError();
        },
      });
    } catch (error) { failure = error; }
    // A failed lifecycle retains its private directory for diagnosis. A
    // preflight result is not a lease against a hostile same-user writer.
    if (failure?.code !== 'runtime_cleanup_failed') {
      try {
        const current = await fs.lstat(scratch, { bigint: true }), ancestor = await fs.stat(root, { bigint: true });
        check(dirname(scratch) === root && current.isDirectory() && !current.isSymbolicLink()
          && current.dev === owned.dev && current.ino === owned.ino && parent.dev === ancestor.dev && parent.ino === ancestor.ino
          && (await fs.realpath(scratch)).normalize('NFC') === scratch.normalize('NFC'), '任务临时目录身份已改变');
        await fs.rm(scratch, { recursive: true, force: false });
      } catch (error) { failure = cleanupError(error); }
    }
    if (failure) throw failure;
    return response;
  }

  return Object.freeze({
    async compile(buildDirectory, manifestDigest, { signal, runId } = {}) {
      if (runId) taskRunId(runId);
      check(/^sha256:[a-f0-9]{64}$/.test(manifestDigest), '无效的冻结编译清单摘要');
      const request = { action: 'compile_snapshot', id: randomUUID(), compilerBudget: 'macos', manifest_sha256: manifestDigest };
      const { result } = await invoke('compiler', request, { signal, timeoutMs: 450000,
        frames: internalSignal => compilerSnapshotFrames(buildDirectory, manifestDigest, { signal: internalSignal }) });
      completed(result, true);
      check(result.exitCode === 0, result.stderr || '编译器执行失败');
      const files = filesFrom(result, true);
      check(files['compile-result.json']?.length <= 1024 * 1024, '编译结果缺失或过大');
      const parsed = JSON.parse(files['compile-result.json'].toString('utf8'));
      check(typeof parsed.success === 'boolean' && typeof parsed.diagnostics === 'string', '无效的编译响应');
      const ex5 = files['Strategy.ex5'];
      check(Object.keys(files).length === (parsed.success ? 2 : 1), '编译器返回了未声明的文件');
      if (parsed.success) check(ex5?.length > 0 && sha256(ex5) === parsed.ex5_sha256, '编译产物摘要不匹配');
      else check(!ex5 && parsed.ex5_sha256 === null, '失败的编译返回了产物');
      return { success: parsed.success, diagnostics: parsed.diagnostics, ex5: ex5?.toString('base64') ?? null, ex5_sha256: parsed.ex5_sha256 };
    },
  });
}
