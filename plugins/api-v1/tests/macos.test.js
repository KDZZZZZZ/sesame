import { mt5Import, mt5Path } from './mt5-path.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const { installation, stageFrozenBuild } = await mt5Import('native.js');
const { macPrefix, wineCommand, winePrefix, wineEnvironment } = await mt5Import('platform.js');
import { digest } from '../packages/mt5/backend/support.js';

test('Tester uses the connected Wine profile for FILE_COMMON without changing the host environment', () => {
  const original = { USER: process.env.USER, LOGNAME: process.env.LOGNAME };
  const env = wineEnvironment('/tmp/demo-prefix/drive_c/MT5', 'C:\\users\\user\\AppData\\Roaming\\MetaQuotes\\Terminal\\Common');
  assert.equal(env.USER, 'user'); assert.equal(env.LOGNAME, 'user');
  assert.deepEqual({ USER: process.env.USER, LOGNAME: process.env.LOGNAME }, original);
  assert.equal(wineEnvironment(undefined, 'C:\\users\\..\\AppData\\Roaming\\MetaQuotes\\Terminal\\Common').USER, original.USER);
  assert.equal(wineEnvironment(undefined, 'D:\\custom-common').USER, original.USER);
});

test('Mac discovers the official prefix and launches the bundled Wine with spaced paths', { skip: process.platform !== 'darwin' }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'mt5agent mac '));
  const keys = ['HOME', 'MT5AGENT_MT5_DIR', 'MT5AGENT_MT5_DATA_DIR', 'MT5AGENT_WINEPREFIX', 'WINEPREFIX', 'MT5AGENT_WINE', 'MT5AGENT_MT5_APP'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.HOME = home;
    const directory = join(macPrefix(home), 'drive_c/Program Files/MetaTrader 5');
    await mkdir(join(directory, 'MQL5/Include'), { recursive: true });
    await writeFile(join(directory, 'terminal64.exe'), 'terminal');
    await writeFile(join(directory, 'metaeditor64.exe'), 'editor');
    assert.equal(installation().directory, directory);
    assert.equal(winePrefix(), macPrefix(home));
    const app = join(home, 'Applications/MetaTrader 5.app');
    process.env.MT5AGENT_MT5_APP = app;
    const binary = join(app, 'Contents/SharedSupport/wine/bin/wine64');
    await mkdir(join(binary, '..'), { recursive: true });
    await writeFile(binary, '#!/bin/sh\nprintf "%s\\n" "$WINEPREFIX" "$@"\n', { mode: 0o700 });
    assert.equal(wineCommand(), binary);
    const child = spawnSync(process.execPath, [...process.execArgv, 'packages/mt5/scripts/mt5.mjs', 'editor', '/profile:spaced name'], {
      cwd: resolve(import.meta.dirname, '..'), env: { ...process.env, DISPLAY: '' }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(child.stdout.trim().split('\n'), [macPrefix(home), installation().editor, '/profile:spaced name']);
    process.env.MT5AGENT_MT5_DIR = join(home, 'custom/drive_c/Program Files/Broker');
    assert.equal(winePrefix(), join(home, 'custom'));
    process.env.MT5AGENT_WINEPREFIX = join(home, 'explicit');
    assert.equal(winePrefix(), join(home, 'explicit'));
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(home, { recursive: true, force: true });
  }
});

test('frozen build transfers exclude host files and reject changed manifests, contents and links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mt5agent-freeze-'));
  const source = join(root, 'source'), staging = join(root, 'staging');
  await mkdir(join(source, '.compiler'), { recursive: true });
  await mkdir(staging);
  const compiler = Buffer.from('test compiler');
  await writeFile(join(source, '.compiler/MetaEditor64.exe'), compiler);
  await writeFile(join(source, 'private.txt'), 'never transferred');
  const manifest = { compiler_sha256: digest(compiler), files: { '.compiler/MetaEditor64.exe': { bytes: compiler.length, sha256: digest(compiler) } } };
  const save = async () => { const text = JSON.stringify(manifest); await writeFile(join(source, 'manifest.json'), text); return digest(text); };
  try {
    const hash = await save();
    await stageFrozenBuild(source, hash, staging);
    assert.deepEqual(await readFile(join(staging, '.compiler/MetaEditor64.exe')), compiler);
    await assert.rejects(readFile(join(staging, 'private.txt')), { code: 'ENOENT' });
    await assert.rejects(stageFrozenBuild(source, digest('wrong'), staging), /清单摘要/);
    await writeFile(join(source, '.compiler/MetaEditor64.exe'), 'fake compiler');
    await assert.rejects(stageFrozenBuild(source, hash, staging), /输入/);
    manifest.files['../escape'] = { bytes: 1, sha256: digest('x') };
    delete manifest.files['.compiler/MetaEditor64.exe'];
    await assert.rejects(stageFrozenBuild(source, await save(), staging), /路径/);
    delete manifest.files['../escape'];
    if (process.platform !== 'win32') {
      await symlink(join(source, 'private.txt'), join(source, 'link'));
      manifest.files.link = { bytes: 17, sha256: digest('never transferred') };
      await assert.rejects(stageFrozenBuild(source, await save(), staging), /输入/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
