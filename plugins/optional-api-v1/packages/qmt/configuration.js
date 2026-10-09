import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { check, digest } from '@sesame/plugin-sdk/protocol';

export function configuration(host) {
  return host.storage.get('configuration', 'local', true) ?? { id: 'local', version: 1, connection_id: null, python_path: null, userdata_directory: null, account_id: null, broker: null, market_port: null, sector: '沪深京A股' };
}
const file = path => typeof path === 'string' && isAbsolute(path) && existsSync(path) && statSync(path).isFile();
export function inspect(host) {
  const config = configuration(host), installed = host.storage.get('environment', 'managed', true);
  const candidates = [...new Set([config.python_path, process.env.QMT_PYTHON, installed?.python, ...(process.platform === 'win32' ? (process.env.PATH ?? '').split(';').map(path => join(path, 'python.exe')) : [])].filter(file))];
  return { platform: process.platform, supported_platform: 'win32-x64', configuration: config, python_candidates: candidates, suggested_userdata_directory: process.env.QMT_USERDATA ?? null, private_directory: host.storage.directory,
    sdk_verified: false, terminal_started: false, missing: [...(process.platform !== 'win32' ? ['Native Windows x64 host'] : []), ...(!candidates.length ? ['Existing compatible Windows Python; managed preparation uses CPython 3.12 x64'] : []), ...(!config.market_port ? ['Actual MiniQMT localhost market port'] : []), ...(!config.userdata_directory ? ['Existing broker MiniQMT userdata_mini directory (account reads)'] : []), ...(!config.account_id ? ['Broker-authorized STOCK account ID (account reads)'] : [])], next: 'Read skills/qmt-readonly/SKILL.md; reuse existing settings, then verify explicitly.' };
}
export async function configure(host, args) {
  return host.configuration.exclusive(() => host.storage.idempotent(`configuration:${args.operation_id}`, digest(args), () => {
    const prior = configuration(host);
    check(args.expected_version === prior.version, 'QMT configuration changed', 'STALE_REVISION');
    const allowed = new Set(['python_path','userdata_directory','account_id','broker','market_port','sector']);
    check(args.changes && Object.keys(args.changes).length > 0 && Object.keys(args.changes).every(key => allowed.has(key)), 'Unsupported configuration fields', 'INVALID_ARGUMENT');
    const next = { ...prior, ...args.changes, version: prior.version + 1, connection_id: prior.connection_id ?? `qmt-${randomUUID()}` };
    for (const key of ['python_path','userdata_directory']) if (next[key] !== null) {
      check(typeof next[key] === 'string' && isAbsolute(next[key]) && existsSync(next[key]), `Provide an existing absolute ${key}`, 'PREREQUISITE_REQUIRED');
      check(key === 'python_path' ? statSync(next[key]).isFile() : statSync(next[key]).isDirectory(), `Invalid ${key}`, 'INVALID_ARGUMENT');
    }
    for (const key of ['account_id','broker','sector']) check(next[key] === null || (typeof next[key] === 'string' && next[key].length > 0 && next[key].length <= 200), `Invalid ${key}`, 'INVALID_ARGUMENT');
    check(next.sector !== null, 'A stock catalog sector is required', 'INVALID_ARGUMENT');
    check(next.market_port === null || (Number.isInteger(next.market_port) && next.market_port >= 1 && next.market_port <= 65535), 'Invalid market port', 'INVALID_ARGUMENT');
    return host.storage.put('configuration', next);
  }));
}
export function prerequisite(host, message) {
  check(false, message, 'PREREQUISITE_REQUIRED', { tool: 'qmt_environment', action: 'inspect', skill: 'skills/qmt-readonly/SKILL.md', private_directory: host.storage.directory });
}
export async function environment(host, args, signal) {
  const status = inspect(host); if (args.action === 'inspect') return status;
  if (process.platform !== 'win32') prerequisite(host, 'QMT SDK access requires native Windows x64 and a broker-authorized MiniQMT installation');
  const selected = args.python_path ?? status.python_candidates[0];
  if (!file(selected)) prerequisite(host, 'Select an existing native Windows Python executable');
  const verify = python => host.environment.executeWorker('worker.js', { action: 'verify', python }, { signal, timeoutMs: 30000 });
  if (args.action === 'verify') return verify(selected);
  check(args.action === 'prepare' && args.operation_id, 'Explicit preparation needs an operation_id', 'INVALID_ARGUMENT');
  return host.configuration.exclusive(() => host.storage.idempotentAsync(`prepare:${args.operation_id}`, digest({ selected }), async () => {
    for (const python of [...new Set([selected, ...status.python_candidates])]) {
      try { const found = await verify(python); return { reused: true, python, ...found.result }; }
      catch (error) { signal?.throwIfAborted(); if (error.code !== 'PREREQUISITE_REQUIRED') throw error; }
    }
    const target = join(host.storage.directory, 'environments', `xtquant-${randomUUID()}`);
    const result = await host.environment.executeWorker('worker.js', { action: 'prepare', python: selected, target }, { signal, timeoutMs: 600000 });
    host.storage.put('environment', { id: 'managed', ...result.result });
    return result.result;
  }));
}
