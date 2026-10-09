import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ApiError, requireValue } from './support.js';
import { winePrefix, wineCommand as wine, wineEnvironment as environment, terminalInvocation } from './platform.js';

const worker = fileURLToPath(new URL('./python-worker.py', import.meta.url));
const terminalControl = fileURLToPath(new URL('./terminal-control.py', import.meta.url));
const exec = promisify(execFile);
export const winePath = path => process.platform === 'win32' ? path : `Z:${path.replaceAll('/', '\\')}`;
export const pythonPath = native => process.env.MT5AGENT_PYTHON ?? native?.python ?? join(winePrefix(native?.directory), 'drive_c/mt5agent-python/python.exe');

export async function controlTerminal(native, action, signal) {
  requireValue(native && existsSync(pythonPath(native)) && ['inspect', 'close'].includes(action), '自动配置需要本机 Windows Python 与 MT5', 503);
  const executable = pythonPath(native), flags = ['-I', '-B', winePath(terminalControl), action, winePath(native.terminal)];
  return new Promise((resolve, reject) => execFile(process.platform === 'win32' ? executable : wine(), process.platform === 'win32' ? flags : [executable, ...flags],
    { env: environment(native.directory), timeout: 35000, maxBuffer: 65536, signal, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new ApiError(503, 'terminal_control_unavailable', `终端配置暂未完成：${stderr.trim().split('\n').at(-1) || error.message}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new ApiError(502, 'terminal_control_invalid', '终端控制没有返回有效结果')); }
    }));
}

export class MT5Python {
  constructor(native) { this.native = native; this.tail = Promise.resolve(); }
  available() { return Boolean(this.native && existsSync(pythonPath(this.native))); }
  start() {
    requireValue(!this.closed, 'Python IPC 已关闭', 503);
    if (this.child) return;
    requireValue(this.available(), 'MT5 的 Python 运行组件不可用，请检查应用安装与 MT5 路径。', 503, 'mt5_python_unavailable');
    const executable = pythonPath(this.native), args = ['-B', '-u', winePath(worker)];
    const child = spawn(process.platform === 'win32' ? executable : wine(), process.platform === 'win32' ? args : [executable, ...args], { env: environment(this.native.directory), stdio: ['pipe', 'pipe', 'ignore'], detached: process.platform !== 'win32', windowsHide: true });
    this.child = child; let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) { this.pending?.reject(new Error('Python 结果超过 8 MiB')); this.stop(); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try { this.pending?.resolve(JSON.parse(line)); } catch { this.pending?.reject(new Error('Python IPC 响应无效')); }
      }
    });
    const lost = () => {
      if (this.child === child) this.child = null;
      this.pending?.reject(new ApiError(503, 'mt5_python_disconnected', 'Windows Python 进程已退出；检查官方包安装。已发出的交易不得自动重试。'));
    };
    child.once('error', lost); child.once('exit', lost);
    child.stdin.on('error', lost);
  }
  call(tool, args, account, signal) {
    const task = this.tail.then(async () => {
      signal?.throwIfAborted(); this.start();
      const combined = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
      let abort;
      try {
        return await new Promise((resolve, reject) => {
          this.pending = { resolve, reject };
          abort = () => { reject(new Error('Python 调用中断，结果未知；先核对账户，不自动重试')); this.stop(); };
          combined.addEventListener('abort', abort, { once: true });
          this.child.stdin.write(JSON.stringify({ tool, arguments: args, terminal: winePath(this.native.terminal), ...(['login', 'initialize'].includes(tool) ? { account } : {}) }) + '\n');
        });
      } finally { combined.removeEventListener('abort', abort); this.pending = null; }
    });
    this.tail = task.catch(() => {}); return task;
  }
  stop() {
    const child = this.child; this.child = null;
    if (child) {
      try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
  }
  async close() { this.closed = true; this.stop(); await this.tail; }
}

export const LAUNCH_TOOLS = [
  { name: 'start_terminal', description: '启动本机 terminal64；不强制重启已有实例。参数只对新实例生效，PID 不表示登录成功。use_account_login 使用用户配置的 Login；use_startup_config 使用用户保存的原生 INI。', inputSchema: { type: 'object', properties: { portable: { type: 'boolean' }, profile: { type: 'string', pattern: '^[^\\r\\n\\x00/\\\\:]{1,80}$' }, use_account_login: { type: 'boolean' }, use_startup_config: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'start_editor', description: '启动 MetaEditor；连接就绪后由原生 MCP 进行文件编辑、编译及语法检查。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  ...['install', 'uninstall', 'start', 'stop', 'restart', 'help'].map(action => ({ name: `tester_agent_${action}`, description: `MetaTester 官方 /${action} 命令。地址、端口和密码由用户配置，操作 Windows/Wine 中的测试代理服务，不是启动一次策略回测。`, inputSchema: { type: 'object', properties: {}, additionalProperties: false } })),
];

export async function launch(native, tool, args, configFile, testerAgent, signal) {
  requireValue(native, 'MT5 安装目录未找到', 503, 'mt5_unavailable');
  if (tool.startsWith('tester_agent_')) {
    const executable = join(native.directory, 'metatester64.exe'), action = tool.slice('tester_agent_'.length);
    requireValue(existsSync(executable), 'MetaTester 未安装', 503);
    requireValue(action === 'help' || testerAgent?.address && testerAgent?.port, '请先在前端设置测试代理地址与端口');
    requireValue(action !== 'install' || testerAgent.password, '安装代理服务需要用户配置密码');
    const flags = [`/${action}`, ...(action === 'help' ? [] : [`/address:${testerAgent.address}:${testerAgent.port}`]), ...(action === 'install' ? [`/password:${testerAgent.password}`] : [])];
    return new Promise(resolve => execFile(process.platform === 'win32' ? executable : wine(), process.platform === 'win32' ? flags : [executable, ...flags], { env: environment(native.directory), timeout: 15000, maxBuffer: 1024 * 1024, signal, windowsHide: true }, (error, stdout, stderr) => {
      const output = `${stdout}\n${stderr}`.replaceAll(testerAgent?.password || '\0', '[redacted]');
      resolve({ isError: Boolean(error), outcome_unknown: Boolean(error?.killed || error?.name === 'AbortError'), exit_code: typeof error?.code === 'number' ? error.code : error ? null : 0, output, message: error ? 'MetaTester 命令失败或超时；请核对 Windows 服务状态，不自动重放。' : 'MetaTester 命令已返回；服务状态仍需核对原生日志。' });
    }));
  }
  const executable = tool === 'start_editor' ? native.editor : native.terminal;
  const flags = [...(args.portable ? ['/portable'] : []), ...(args.profile ? [`/profile:${args.profile}`] : []), ...(args.use_account_login ? [`/login:${args.configured_login}`] : []), ...(args.use_startup_config ? [`/config:${winePath(configFile)}`] : [])];
  const env = environment(native.directory, native.commonFolder);
  const { program, args: argv } = terminalInvocation(executable, flags, env);
  if (process.platform === 'linux' && process.env.INVOCATION_ID) {
    // detached only separates process groups. A systemd service still kills its
    // entire cgroup on restart, so the trading terminal needs its own user unit.
    const unit = `mt5agent-${tool.replaceAll('_', '-')}-${randomUUID()}.service`;
    const forwarded = ['WINEPREFIX', 'WINEDEBUG', 'DISPLAY', 'XAUTHORITY', 'PATH'].filter(key => env[key]).map(key => `--setenv=${key}=${env[key]}`);
    try {
      await exec('systemd-run', ['--user', '--quiet', '--collect', '--service-type=exec', `--unit=${unit}`, '--property=StandardOutput=null', '--property=StandardError=null', ...forwarded, '--', program, ...argv], { timeout: 15000, signal });
      const { stdout } = await exec('systemctl', ['--user', 'show', unit, '--property=MainPID', '--value'], { timeout: 5000, signal });
      return { pid: Number(stdout.trim()), unit, status: 'spawned', message: '已发送独立终端启动请求；应用服务重启不会关闭终端。请刷新原生能力确认连接。' };
    } catch {
      throw new ApiError(503, 'terminal_launch_unavailable', '独立终端启动尚未确认，请重试连接检查；未自动重复启动。');
    }
  }
  const child = spawn(program, argv, { env, stdio: 'ignore', detached: true });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  return { pid: child.pid, status: 'spawned', message: '已发送启动请求。请刷新原生能力确认连接；同目录已有终端时不会应用新的启动参数。' };
}
