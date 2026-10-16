import { statSync, openSync, readSync, closeSync } from 'node:fs';
import { isAbsolute, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from '@sesame/plugin-sdk/schema';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { ApiError, digest, requireValue } from './support.js';
import { stableJSON } from './contracts.js';
import { installation, compilerDependencies } from './native.js';
import { pythonPath, MT5Python } from './process.js';
import { wineCommand, winePrefix } from './platform.js';

const path = Type.Union([Type.String({ minLength: 1, maxLength: 4096, pattern: '^[^\\r\\n\\u0000]*$' }), Type.Null()]);
export const dependencyChanges = Type.Object({
  terminal_directory: Type.Optional(path), data_directory: Type.Optional(path),
  python: Type.Optional(path), wine: Type.Optional(path), wine_prefix: Type.Optional(path),
}, { additionalProperties: false, minProperties: 1 });
const defaultSettings = () => ({ id: 'local', version: 1, terminal_directory: null, data_directory: null, python: null, wine: null, wine_prefix: null });
export const dependencySettings = host => host.storage.get('mt5_dependencies', 'local', true) ?? defaultSettings();
export const dependencyDirectory = host => join(host.storage.directory, 'dependencies');
const present = (file, directory = false) => { try { const info = statSync(file); return directory ? info.isDirectory() : info.isFile(); } catch { return false; } };
const executable = command => isAbsolute(command) ? present(command) : (process.env.PATH ?? '').split(delimiter).some(folder => present(join(folder, command)));

export function discoverDependencies(host, options = {}) {
  const settings = dependencySettings(host), base = dependencyDirectory(host);
  let native = options.disabled ? null : installation(options.directory ?? settings.terminal_directory ?? undefined, settings.data_directory);
  if (native) {
    native = { ...native, ...(settings.wine ? { wine: settings.wine } : {}), ...(settings.wine_prefix ? { winePrefix: settings.wine_prefix } : {}) };
    // Reuse explicit/native installations before considering our own downloads.
    const candidates = [settings.python, process.env.MT5AGENT_PYTHON, pythonPath(native), join(base, 'python', 'python.exe')].filter(Boolean);
    const python = candidates.find(file => present(file));
    if (python) native.python = python;
  }
  return { native, environment: { ...host.environment, native }, settings };
}

export function inspectDependencies(mt5, { probe = false } = {}) {
  const host = mt5.host, found = discoverDependencies(host, mt5.options), native = found.native;
  const python = native && pythonPath(native), wine = process.platform === 'win32' ? null : wineCommand(native);
  const compiler = probe ? Boolean(native && compilerDependencies(found.environment)) : null;
  const missing = [];
  if (!native) missing.push({ id: 'terminal', required_for: ['local-compiler', 'tester', 'python-ipc', 'launcher'], reason: '未找到唯一有效的 terminal64.exe、MetaEditor64.exe 和 MQL5/Include；已有远程 MCP 连接不需要本机终端', configure: ['terminal_directory', 'data_directory'] });
  if (wine && !executable(wine)) missing.push({ id: 'wine', required_for: ['local-compiler', 'tester', 'python-ipc', 'launcher'], reason: '没有发现 Windows 程序兼容运行器', configure: ['wine', 'wine_prefix'] });
  if (!python || !present(python)) missing.push({ id: 'python', required_for: ['local-compiler', 'tester', 'python-ipc'], reason: '未找到 Windows x64 Python 原生进程控制器；本体不包含此可选依赖', install_directory: join(dependencyDirectory(host), 'python'), configure: ['python'] });
  if (compiler === false) missing.push({ id: 'compiler', required_for: ['local-compiler'], reason: '所选编译引擎未就绪；默认使用本机 MetaEditor、Windows Python 进程控制器及非 Windows 上的 Wine', configure: ['terminal_directory', 'python', 'wine'] });
  if (probe) mt5.compilerReady = compiler;
  return { version: found.settings.version, settings: found.settings, platform: process.platform, private_directory: dependencyDirectory(host),
    discovered: { terminal: native?.directory ?? null, data_directory: native?.dataDirectory ?? null, python: python && present(python) ? python : null, wine, wine_prefix: native && process.platform !== 'win32' ? winePrefix(native) : null },
    compiler: { available: compiler, checked: probe, backend: 'native' },
    python: { installed: Boolean(python && present(python)), sdk_verified: false, next: 'mt5_catalog server:python，再调用 version 核验实际 IPC；发现文件不代表官方包或账户已就绪' },
    connections: mt5.official?.settings?.() ?? null,
    missing, next: missing.length ? { tool: 'plugin_read', plugin_id: 'sesame/mt5', path: 'skills/dependencies/SKILL.md' } : null,
    scripts: Object.fromEntries(['install-mt5-python.py', 'install-mt5-macos.sh'].map(name => [name, fileURLToPath(new URL(`../scripts/${name}`, import.meta.url))])),
  };
}

export function prerequisite(mt5, capability) {
  const state = inspectDependencies(mt5);
  if (capability === 'local-compiler' && !mt5.compilerReady) state.missing.push({ id: 'compiler', required_for: ['local-compiler'], reason: '本机编译依赖未就绪；检查 MetaEditor、Windows Python 与 Wine' });
  return new ApiError(503, 'PREREQUISITE_REQUIRED', JSON.stringify({ code: 'PREREQUISITE_REQUIRED', capability,
    missing: state.missing.filter(item => item.required_for.includes(capability)), private_directory: state.private_directory,
    next: { tool: 'mt5_dependencies', action: 'inspect', probe: true }, skill: 'skills/dependencies/SKILL.md' }));
}

function validatePaths(changes) {
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) continue;
    requireValue(isAbsolute(value), `${key} 必须为本机绝对路径`);
    requireValue(present(value, key.endsWith('_directory') || key === 'wine_prefix'), `${key} 指向的已有文件或目录不存在`);
  }
  if (changes.python) {
    const file = openSync(changes.python, 'r'), header = Buffer.alloc(2);
    try { readSync(file, header, 0, 2, 0); } finally { closeSync(file); }
    requireValue(header.toString() === 'MZ', 'python 必须是 Windows Python PE 程序，不能配置 macOS/Linux Python');
  }

}

export async function configureDependencies(host, mt5, args) {
  requireValue(host.scope.kind === 'main', '只有主 Agent 可以修改本机 MT5 依赖路径', 403);
  requireValue(Value.Check(dependencyChanges, args.changes) && /^[A-Za-z0-9_-]{16,128}$/.test(args.command_id) && Number.isInteger(args.expected_version), '依赖配置参数无效');
  const fingerprint = digest(stableJSON({ ...args, conversationId: host.scope.conversationId }));
  return host.configuration.exclusive(async () => {
    const previous = host.storage.get('mt5_dependency_command', args.command_id, true);
    if (previous) { requireValue(previous.fingerprint === fingerprint, '依赖配置命令 ID 已用于其他修改', 409, 'idempotency_conflict'); return previous.result; }
    requireValue(!mt5.jobs.size && !mt5.tester.pending.size && !mt5.official.jobs.size
      && !mt5.deployments.list().some(item => ['preparing', 'attaching', 'running', 'unknown'].includes(item.status)), '编译、Tester 或持久 EA 仍在运行；不能改其依赖路径', 409, 'mt5_busy');
    const current = dependencySettings(host);
    requireValue(current.version === args.expected_version, 'MT5 依赖配置已更新，请重新读取', 409, 'version_conflict');
    validatePaths(args.changes);
    const result = { ...current, ...args.changes, version: current.version + 1 };
    if (result.terminal_directory) requireValue(installation(result.terminal_directory, result.data_directory), '目录必须含 terminal64.exe、MetaEditor64.exe 和有效的 MQL5/Include 数据目录');
    // Closing the plugin's Python IPC never closes a user's terminal or EA.
    await mt5.official.python.close();
    host.storage.transaction(() => {
      host.storage.put('mt5_dependencies', result);
      host.storage.put('mt5_dependency_command', { id: args.command_id, fingerprint, result });
    });
    const found = discoverDependencies(host, mt5.options);
    mt5.native = found.native; mt5.compilerEnvironment = found.environment;
    mt5.official.native = found.native; mt5.official.python = new MT5Python(found.native);
    mt5.compilerReady = false;
    return result;
  });
}
