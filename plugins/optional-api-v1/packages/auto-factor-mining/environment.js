import { mkdir, readFile, writeFile, rename, rm, lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runProcess } from './host.js';

const preparations = new Map();
const error = (message, code = 'ENVIRONMENT_NOT_READY') => Object.assign(new Error(message), { code });
const executable = root => join(root, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

export function createEnvironment({ host, rootDir = host.context.storageRoot, packageDir = host.context.pluginRoot }) {
  const root = resolve(rootDir), venv = join(root, 'venv'), privatePython = executable(venv), selection = join(root, 'environment.json');
  const env = {
    UV_CACHE_DIR: join(root, 'cache'), UV_PYTHON_DOWNLOADS: 'never', UV_LINK_MODE: 'copy',
    TEMP: join(root, 'tmp'), TMP: join(root, 'tmp'), MPLCONFIGDIR: join(root, 'matplotlib'),
    PIP_CACHE_DIR: join(root, 'cache'), PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null',
    PIP_INDEX_URL: 'https://pypi.org/simple', PIP_EXTRA_INDEX_URL: '', PIP_TRUSTED_HOST: '',
  };
  async function initialize() {
    await mkdir(root, { recursive: true });
    if ((await lstat(root)).isSymbolicLink()) throw error('The private environment root cannot be a symlink', 'FORBIDDEN');
    for (const path of [env.UV_CACHE_DIR, env.TEMP, env.MPLCONFIGDIR]) {
      await mkdir(path, { recursive: true });
      const actual = await realpath(path), parent = await realpath(root);
      if (!actual.startsWith(parent + sep)) throw error('Environment directories must remain inside the owned root', 'FORBIDDEN');
    }
  }
  async function command(argv, signal, timeoutMs = 30000) {
    signal?.throwIfAborted();
    const result = await runProcess(host, argv, { cwd: root, env, signal, timeoutMs });
    if (result.exitCode !== 0) {
      const detail = String(result.stderr ?? '').trim().split(/\r?\n/).at(-1)?.slice(0, 500);
      throw error(`Environment process failed${detail ? `: ${detail}` : '; inspect its execution receipt'}`, 'PROCESS_EXIT');
    }
    return result;
  }
  async function previous() {
    try { return JSON.parse(await readFile(selection, 'utf8')); }
    catch (cause) { if (cause.code !== 'ENOENT') throw cause; return null; }
  }
  async function save(value) {
    const temp = `${selection}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, selection);
  }
  async function probe(pythonPath, signal) {
    const output = join(root, `probe-${randomUUID()}.json`);
    try {
      const source = 'import json,sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from data import environment_info;Path(sys.argv[2]).write_text(json.dumps(environment_info(),allow_nan=False),encoding="utf-8")';
      await command([pythonPath, '-I', '-B', '-c', source, join(packageDir, 'python'), output], signal, 60000);
      const result = JSON.parse(await readFile(output, 'utf8'));
      if (result.ready !== true || typeof result.pythonPath !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(result.environmentDigest)) throw error('Invalid environment probe result');
      return result;
    } finally { await rm(output, { force: true }); }
  }
  async function inspect({ pythonPath } = {}, signal) {
    await initialize();
    const prior = await previous();
    const candidates = [...new Set([pythonPath, prior?.pythonPath, privatePython, host.context.pythonPath].filter(Boolean))];
    let reason = 'Prepare a package-owned 64-bit CPython 3.12 environment with the pinned dependencies.';
    for (const candidate of candidates) {
      try {
        const result = await probe(candidate, signal);
        await save(result);
        return result;
      } catch (cause) { signal?.throwIfAborted(); reason = cause.message; }
      if (pythonPath) break;
    }
    return { ready: false, pythonPath: pythonPath ?? prior?.pythonPath ?? privatePython, versions: {}, environmentDigest: '', reason };
  }
  async function prepare(input = {}, signal) {
    if (preparations.has(root)) return preparations.get(root);
    const task = (async () => {
      const current = await inspect(input, signal);
      if (current.ready) return current;
      const bases = [...new Set([input.pythonPath, host.context.pythonPath, process.platform === 'win32' ? 'python.exe' : 'python3'].filter(Boolean))];
      let base;
      for (const candidate of bases) {
        try {
          await command([candidate, '-I', '-c', 'import sys,struct;assert sys.version_info[:2]==(3,12) and struct.calcsize("P")==8'], signal);
          base = candidate;
          break;
        } catch { signal?.throwIfAborted(); }
      }
      if (!base) throw error('Configure an existing 64-bit CPython 3.12 interpreter; no Python/system installation is performed.');
      try { if ((await lstat(venv)).isSymbolicLink()) throw error('Private venv cannot be a symlink', 'FORBIDDEN'); }
      catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
      const uvCandidates = [...new Set([join(dirname(base), 'Scripts', process.platform === 'win32' ? 'uv.exe' : 'uv'), join(dirname(base), process.platform === 'win32' ? 'uv.exe' : 'uv'), 'uv'].filter(Boolean))];
      let uv;
      for (const candidate of uvCandidates) {
        try { await command([candidate, '--version'], signal); uv = candidate; break; }
        catch { signal?.throwIfAborted(); }
      }
      const requirements = join(packageDir, 'python', 'requirements-lock.txt');
      if (uv) {
        await command([uv, 'venv', venv, '--python', base, '--allow-existing', '--no-python-downloads'], signal, 120000);
        await command([privatePython, '-I', '-c', 'import pathlib,sys;assert pathlib.Path(sys.prefix).resolve()==pathlib.Path(sys.argv[1]).resolve() and sys.prefix!=sys.base_prefix', venv], signal);
        await command([uv, 'pip', 'install', '--python', privatePython, '--only-binary', 'pyqlib', '--index-url', 'https://pypi.org/simple', '--requirement', requirements, '--quiet'], signal, 540000);
      } else {
        await command([base, '-I', '-m', 'venv', venv], signal, 120000);
        await command([privatePython, '-I', '-c', 'import pathlib,sys;assert pathlib.Path(sys.prefix).resolve()==pathlib.Path(sys.argv[1]).resolve() and sys.prefix!=sys.base_prefix', venv], signal);
        await command([privatePython, '-I', '-m', 'pip', 'install', '--only-binary=pyqlib', '--disable-pip-version-check', '--no-input', '--requirement', requirements, '--quiet'], signal, 540000);
      }
      const result = await probe(privatePython, signal);
      await save(result);
      return result;
    })();
    preparations.set(root, task);
    try { return await task; }
    finally { if (preparations.get(root) === task) preparations.delete(root); }
  }
  return { inspect, prepare };
}
