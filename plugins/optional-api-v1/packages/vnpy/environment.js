import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const VERSIONS = Object.freeze({ vnpy: '4.5.0', vnpy_ctastrategy: '1.4.1' });
const WHEELS = Object.freeze({ vnpy: '69d95de6a78812c5617fea1475ac5ce29fdee279c6c44dc4689738aff9bd0fcd', 'vnpy-ctastrategy': 'd625ebbff1fcf1a61794bf7c75c13f4bcfea333b3d80d0ada36292a09100288f' });
const name = value => value.toLowerCase().replaceAll('_', '-');
const safeError = error => String(error.message ?? error).replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1[redacted]@').slice(0, 1600);
const error = (code, message) => Object.assign(new Error(message), { code });
const locks = new Map();
const inspectCode = `import importlib.metadata as m,json,platform,struct,sys
from pathlib import Path
data={"python":sys.executable,"platform":sys.platform,"arch":platform.machine(),"bits":struct.calcsize("P")*8,"version":list(sys.version_info[:3]),"packages":{d.metadata["Name"].lower().replace("_","-"):d.version for d in m.distributions()}}
if data["packages"].get("vnpy")=="4.5.0" and data["packages"].get("vnpy-ctastrategy")=="1.4.1":
 from vnpy_ctastrategy.backtesting import BacktestingEngine
 data["engineImport"]=type(BacktestingEngine()).__name__
Path(sys.argv[1]).write_text(json.dumps(data),encoding="utf8")`;

export async function run(host, argv, cwd, signal, timeout = 600) {
  signal?.throwIfAborted();
  const result = await host.workspace.run(argv, { cwd, timeout, signal });
  const code = result.exitCode ?? result.exit_code;
  if (code !== 0) throw Object.assign(error('PROCESS_EXIT', `Command exited with ${code}: ${safeError(result.stderr ?? result.output ?? '')}`), { details: { exitCode: code, executionId: result.executionId ?? null, output: safeError(result.output ?? result.stderr ?? '') } });
  return result;
}

async function inspect(host, python, signal) {
  const probe = join(host.workspace.root(), `.vnpy-probe-${randomUUID()}`);
  await mkdir(join(probe, '.vntrader'), { recursive: true });
  let data;
  try {
    const report = join(probe, 'environment.json');
    await run(host, [python, '-I', '-B', '-c', inspectCode, report], probe, signal, 60);
    data = JSON.parse(await readFile(report, 'utf8'));
  } finally { await rm(probe, { recursive: true, force: true }); }
  const expected = host.environment.capabilities.platform;
  if (data.platform !== expected || data.bits !== 64 || data.version[0] !== 3 || data.version[1] < 10 || data.version[1] > 13) throw error('ENVIRONMENT_UNAVAILABLE', 'Requires native 64-bit Python 3.10–3.13. The pinned Qt dependency is not a Python 3.14 environment.');
  return data;
}
function compatible(info) { return info.engineImport === 'BacktestingEngine' && Object.entries(VERSIONS).every(([key, value]) => info.packages[name(key)] === value); }
async function receipt(host) {
  try { return JSON.parse(await readFile(join(host.storage.directory, 'environment.json'), 'utf8')); }
  catch (cause) { if (cause.code === 'ENOENT') return null; throw cause; }
}
async function save(host, value) {
  const temporary = join(host.storage.directory, `.environment-${randomUUID()}.json`);
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, join(host.storage.directory, 'environment.json'));
}

export async function environment(host, { action = 'inspect', python_path } = {}, signal) {
  await mkdir(host.storage.directory, { recursive: true });
  const previous = await receipt(host), candidates = [...new Set([python_path, previous?.python, host.environment.pythonPath].filter(Boolean))], findings = [];
  for (const python of candidates) {
    try {
      const info = await inspect(host, python, signal);
      const ready = compatible(info);
      findings.push({ python: info.python, compatible: ready, versions: Object.fromEntries(Object.keys(VERSIONS).map(key => [key, info.packages[name(key)] ?? null])) });
      if (ready) {
        const retained = previous?.python === python;
        const inventory = packages => JSON.stringify(Object.entries(packages).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
        const changed = retained && previous.packages && inventory(previous.packages) !== inventory(info.packages);
        if (changed && !(action === 'prepare' && python_path)) throw error('ENVIRONMENT_CHANGED', 'The selected environment dependency versions changed; inspect and explicitly prepare a compatible python_path to accept its new inventory.');
        const value = { schemaVersion: 1, execution: 'host', python: info.python, platform: info.platform, arch: info.arch, pythonVersion: info.version, packages: info.packages, observedAt: Date.now(), origin: retained && !changed ? previous.origin : 'existing', downloads: retained && !changed ? previous.downloads ?? [] : [] };
        if (action === 'prepare') await save(host, value);
        return { ready: true, reused: true, environment: value, findings, configured: action === 'prepare' || previous?.python === python };
      }
    } catch (cause) {
      signal?.throwIfAborted();
      if (cause.code === 'ENVIRONMENT_CHANGED') throw cause;
      findings.push({ python, compatible: false, error: safeError(cause) });
    }
  }
  if (action !== 'prepare') return { ready: false, execution: 'host', requirements: VERSIONS, findings, next: 'Supply an existing native Python path; prepare reuses a compatible environment before installing into private plugin data.' };
  if (!candidates.length) throw error('ENVIRONMENT_UNAVAILABLE', 'No native Python was discovered. Inspect existing installations and supply python_path. No system interpreter is downloaded automatically.');
  const task = async () => {
    const existing = await environment(host, { action: 'inspect', python_path }, signal);
    if (existing.ready && existing.configured) return existing;
    const base = python_path ?? host.environment.pythonPath;
    if (!base) throw error('ENVIRONMENT_UNAVAILABLE', 'A compatible native Python path is required to create a new private environment.');
    await inspect(host, base, signal);
    const root = join(host.storage.directory, 'python-vnpy-4.5.0-cta-1.4.1');
    try { await mkdir(root); }
    catch (cause) { if (cause.code === 'EEXIST') throw error('ENVIRONMENT_EXISTS', 'The private environment path already exists but was not validated. Inspect it; preparation does not overwrite an unknown environment.'); throw cause; }
    const stage = join(host.workspace.root(), `.vnpy-prepare-${randomUUID()}`);
    try {
      await mkdir(stage);
      await run(host, [base, '-I', '-B', '-m', 'venv', root], stage, signal);
      const python = join(root, host.environment.capabilities.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      const report = join(stage, 'pip-report.json');
      await run(host, [python, '-I', '-B', '-m', 'pip', '--isolated', 'install', '--index-url', 'https://pypi.org/simple', '--only-binary=:all:', '--no-cache-dir', '--disable-pip-version-check', '--report', report, 'vnpy==4.5.0', 'vnpy_ctastrategy==1.4.1'], stage, signal);
      const install = JSON.parse(await readFile(report, 'utf8'));
      const downloads = install.install.map(item => ({ name: item.metadata.name, version: item.metadata.version, url: item.download_info.url, sha256: item.download_info.archive_info.hashes.sha256 }));
      if (downloads.some(item => new URL(item.url).hostname !== 'files.pythonhosted.org' || !/^[a-f0-9]{64}$/.test(item.sha256))) throw error('SOURCE_MISMATCH', 'The install report contains an unexpected source or missing archive hash.');
      for (const [key, hash] of Object.entries(WHEELS)) if (!downloads.some(item => name(item.name) === key && item.sha256 === hash)) throw error('SOURCE_MISMATCH', `The ${key} wheel differs from the pinned source hash.`);
      await run(host, [python, '-I', '-B', '-m', 'pip', 'check'], stage, signal);
      const info = await inspect(host, python, signal);
      if (!compatible(info)) throw error('ENVIRONMENT_UNAVAILABLE', 'The installed engine versions differ from the plugin contract.');
      const value = { schemaVersion: 1, execution: 'host', python, platform: info.platform, arch: info.arch, pythonVersion: info.version, packages: info.packages, downloads, origin: 'private-install', observedAt: Date.now() };
      await save(host, value);
      return { ready: true, reused: false, configured: true, environment: value, findings };
    } catch (cause) {
      // This is a newly created, plugin-owned path, never an existing installation.
      await rm(root, { recursive: true, force: true }); throw cause;
    } finally { await rm(stage, { recursive: true, force: true }); }
  };
  const prior = locks.get(host.storage.directory) ?? Promise.resolve(), pending = prior.catch(() => {}).then(task);
  locks.set(host.storage.directory, pending);
  try { return await pending; } finally { if (locks.get(host.storage.directory) === pending) locks.delete(host.storage.directory); }
}

export async function configured(host, signal) {
  const value = await receipt(host);
  if (!value) throw error('ENVIRONMENT_UNAVAILABLE', 'Inspect and prepare an existing or private environment first. Loading the plugin never downloads dependencies.');
  const current = await environment(host, { action: 'inspect', python_path: value.python }, signal);
  if (!current.ready || !current.configured) throw error('ENVIRONMENT_UNAVAILABLE', 'The configured environment is no longer ready.');
  return current.environment;
}
