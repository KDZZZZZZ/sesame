import { execute as executeCompiler } from '../packages/mt5/backend/compiler-worker.js';
import { mt5Import, mt5Path } from './mt5-path.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const { installation, compilerDependencies, compileNative } = await mt5Import('native.js');

async function createTerminal(directory, dataDirectory = directory) {
  await mkdir(directory, { recursive: true });
  await mkdir(join(dataDirectory, 'MQL5', 'Include'), { recursive: true });
  await writeFile(join(directory, 'MetaEditor64.exe'), 'compiler');
  await writeFile(join(directory, 'terminal64.exe'), 'terminal');
}

function restoreEnv(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test('MT5 installation supports a separate terminal data directory on Windows', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mt5agent-installation-'));
  const previous = process.env.MT5AGENT_MT5_DATA_DIR;
  try {
    const program = join(root, 'Program Files', 'MetaTrader 5'), data = join(root, 'Terminal data');
    await createTerminal(program, data);
    process.env.MT5AGENT_MT5_DATA_DIR = data;
    const native = installation(program);
    assert.ok(native, 'The Include library belongs to the terminal data directory');
    assert.equal(native.directory, program);
    assert.equal(native.dataDirectory, data);
    assert.equal(native.include, join(data, 'MQL5', 'Include'));
    assert.equal(installation(join(root, 'missing')), null, 'An explicit invalid installation must not fall back to a different terminal');
  } finally {
    if (previous === undefined) delete process.env.MT5AGENT_MT5_DATA_DIR;
    else process.env.MT5AGENT_MT5_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('MT5 installation discovers one Windows terminal through origin.txt', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mt5agent-origin-'));
  const previous = {
    APPDATA: process.env.APPDATA,
    ProgramFiles: process.env.ProgramFiles,
    'ProgramFiles(x86)': process.env['ProgramFiles(x86)'],
    MT5AGENT_MT5_DIR: process.env.MT5AGENT_MT5_DIR,
    MT5AGENT_MT5_DATA_DIR: process.env.MT5AGENT_MT5_DATA_DIR,
  };
  try {
    const program = join(root, 'Broker Terminal'), data = join(root, 'Roaming', 'MetaQuotes', 'Terminal', 'abc');
    await createTerminal(program, data);
    await mkdir(data, { recursive: true });
    await writeFile(join(data, 'origin.txt'), Buffer.from('\uFEFF' + program, 'utf16le'));
    process.env.APPDATA = join(root, 'Roaming');
    process.env.ProgramFiles = join(root, 'empty-program-files');
    process.env['ProgramFiles(x86)'] = join(root, 'empty-program-files-x86');
    delete process.env.MT5AGENT_MT5_DIR;
    delete process.env.MT5AGENT_MT5_DATA_DIR;
    const native = installation();
    assert.ok(native, 'origin.txt should discover the broker-specific terminal');
    assert.equal(native.directory, program);
    assert.equal(native.dataDirectory, data);
    assert.equal(native.include, join(data, 'MQL5', 'Include'));
  } finally {
    restoreEnv(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test('MT5 installation returns null when Windows origin discovery finds multiple terminals', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mt5agent-origin-many-'));
  const previous = {
    APPDATA: process.env.APPDATA,
    ProgramFiles: process.env.ProgramFiles,
    'ProgramFiles(x86)': process.env['ProgramFiles(x86)'],
    MT5AGENT_MT5_DIR: process.env.MT5AGENT_MT5_DIR,
    MT5AGENT_MT5_DATA_DIR: process.env.MT5AGENT_MT5_DATA_DIR,
  };
  try {
    const roaming = join(root, 'Roaming');
    const first = join(root, 'Broker A'), firstData = join(roaming, 'MetaQuotes', 'Terminal', 'a');
    const second = join(root, 'Broker B'), secondData = join(roaming, 'MetaQuotes', 'Terminal', 'b');
    await createTerminal(first, firstData);
    await createTerminal(second, secondData);
    await writeFile(join(firstData, 'origin.txt'), first);
    await writeFile(join(secondData, 'origin.txt'), second);
    process.env.APPDATA = roaming;
    process.env.ProgramFiles = join(root, 'empty-program-files');
    process.env['ProgramFiles(x86)'] = join(root, 'empty-program-files-x86');
    delete process.env.MT5AGENT_MT5_DIR;
    delete process.env.MT5AGENT_MT5_DATA_DIR;
    assert.equal(installation(), null, 'Multiple discovered terminals require an explicit selection');
  } finally {
    restoreEnv(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test('MT5 installation returns null for one origin terminal plus a different default portable terminal', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mt5agent-origin-default-many-'));
  const previous = {
    APPDATA: process.env.APPDATA,
    ProgramFiles: process.env.ProgramFiles,
    'ProgramFiles(x86)': process.env['ProgramFiles(x86)'],
    MT5AGENT_MT5_DIR: process.env.MT5AGENT_MT5_DIR,
    MT5AGENT_MT5_DATA_DIR: process.env.MT5AGENT_MT5_DATA_DIR,
  };
  try {
    const roaming = join(root, 'Roaming');
    const originProgram = join(root, 'Broker Terminal'), originData = join(roaming, 'MetaQuotes', 'Terminal', 'origin');
    const defaultProgramFiles = join(root, 'Program Files'), defaultProgram = join(defaultProgramFiles, 'MetaTrader 5');
    await createTerminal(originProgram, originData);
    await createTerminal(defaultProgram);
    await writeFile(join(originData, 'origin.txt'), originProgram);
    process.env.APPDATA = roaming;
    process.env.ProgramFiles = defaultProgramFiles;
    process.env['ProgramFiles(x86)'] = join(root, 'empty-program-files-x86');
    delete process.env.MT5AGENT_MT5_DIR;
    delete process.env.MT5AGENT_MT5_DATA_DIR;
    assert.equal(installation(), null, 'Origin and default portable terminals are distinct installations that require selection');
  } finally {
    restoreEnv(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test('MT5 installation ignores invalid Windows origins and deduplicates directories', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mt5agent-origin-dedupe-'));
  const previous = {
    APPDATA: process.env.APPDATA,
    ProgramFiles: process.env.ProgramFiles,
    'ProgramFiles(x86)': process.env['ProgramFiles(x86)'],
    MT5AGENT_MT5_DIR: process.env.MT5AGENT_MT5_DIR,
    MT5AGENT_MT5_DATA_DIR: process.env.MT5AGENT_MT5_DATA_DIR,
  };
  try {
    const roaming = join(root, 'Roaming');
    const program = join(root, 'Broker Terminal');
    const firstData = join(roaming, 'MetaQuotes', 'Terminal', 'a');
    const secondData = join(roaming, 'MetaQuotes', 'Terminal', 'b');
    const staleData = join(roaming, 'MetaQuotes', 'Terminal', 'stale');
    await createTerminal(program, firstData);
    await mkdir(join(secondData, 'MQL5', 'Include'), { recursive: true });
    await mkdir(staleData, { recursive: true });
    await writeFile(join(firstData, 'origin.txt'), program);
    await writeFile(join(secondData, 'origin.txt'), program);
    await writeFile(join(staleData, 'origin.txt'), join(root, 'missing'));
    process.env.APPDATA = roaming;
    process.env.ProgramFiles = join(root, 'empty-program-files');
    process.env['ProgramFiles(x86)'] = join(root, 'empty-program-files-x86');
    delete process.env.MT5AGENT_MT5_DIR;
    delete process.env.MT5AGENT_MT5_DATA_DIR;
    const native = installation();
    assert.ok(native, 'Duplicate origin entries for one terminal should count as one installation');
    assert.equal(native.directory, program);
    assert.ok([firstData, secondData].includes(native.dataDirectory));
  } finally {
    restoreEnv(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test('MT5 installation keeps a valid discovered data directory when a stale origin appears first', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mt5agent-origin-stale-first-'));
  const previous = {
    APPDATA: process.env.APPDATA,
    ProgramFiles: process.env.ProgramFiles,
    'ProgramFiles(x86)': process.env['ProgramFiles(x86)'],
    MT5AGENT_MT5_DIR: process.env.MT5AGENT_MT5_DIR,
    MT5AGENT_MT5_DATA_DIR: process.env.MT5AGENT_MT5_DATA_DIR,
  };
  try {
    const roaming = join(root, 'Roaming');
    const program = join(root, 'Broker Terminal');
    const staleData = join(roaming, 'MetaQuotes', 'Terminal', '0-stale');
    const validData = join(roaming, 'MetaQuotes', 'Terminal', '1-valid');
    await createTerminal(program, validData);
    await mkdir(staleData, { recursive: true });
    await writeFile(join(staleData, 'origin.txt'), program);
    await writeFile(join(validData, 'origin.txt'), program);
    process.env.APPDATA = roaming;
    process.env.ProgramFiles = join(root, 'empty-program-files');
    process.env['ProgramFiles(x86)'] = join(root, 'empty-program-files-x86');
    delete process.env.MT5AGENT_MT5_DIR;
    delete process.env.MT5AGENT_MT5_DATA_DIR;
    const native = installation();
    assert.ok(native);
    assert.equal(native.directory, program);
    assert.equal(native.dataDirectory, validData);
  } finally {
    restoreEnv(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test('MT5 installation falls back to the default Windows directory when origins are invalid', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mt5agent-origin-fallback-'));
  const previous = {
    APPDATA: process.env.APPDATA,
    ProgramFiles: process.env.ProgramFiles,
    'ProgramFiles(x86)': process.env['ProgramFiles(x86)'],
    MT5AGENT_MT5_DIR: process.env.MT5AGENT_MT5_DIR,
    MT5AGENT_MT5_DATA_DIR: process.env.MT5AGENT_MT5_DATA_DIR,
  };
  try {
    const roaming = join(root, 'Roaming');
    const staleData = join(roaming, 'MetaQuotes', 'Terminal', 'stale');
    const programFiles = join(root, 'Program Files');
    const program = join(programFiles, 'MetaTrader 5');
    await createTerminal(program);
    await mkdir(staleData, { recursive: true });
    await writeFile(join(staleData, 'origin.txt'), join(root, 'missing'));
    process.env.APPDATA = roaming;
    process.env.ProgramFiles = programFiles;
    process.env['ProgramFiles(x86)'] = join(root, 'empty-program-files-x86');
    delete process.env.MT5AGENT_MT5_DIR;
    delete process.env.MT5AGENT_MT5_DATA_DIR;
    const native = installation();
    assert.ok(native);
    assert.equal(native.directory, program);
    assert.equal(native.dataDirectory, program);
  } finally {
    restoreEnv(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test('MT5 installation treats an unreadable Windows origin root as undiscovered', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mt5agent-origin-unreadable-'));
  const previous = {
    APPDATA: process.env.APPDATA,
    ProgramFiles: process.env.ProgramFiles,
    'ProgramFiles(x86)': process.env['ProgramFiles(x86)'],
    MT5AGENT_MT5_DIR: process.env.MT5AGENT_MT5_DIR,
    MT5AGENT_MT5_DATA_DIR: process.env.MT5AGENT_MT5_DATA_DIR,
  };
  try {
    const roaming = join(root, 'Roaming');
    const terminalRoot = join(roaming, 'MetaQuotes', 'Terminal');
    const programFiles = join(root, 'Program Files');
    const program = join(programFiles, 'MetaTrader 5');
    await createTerminal(program);
    await mkdir(join(roaming, 'MetaQuotes'), { recursive: true });
    await writeFile(terminalRoot, 'not a directory');
    process.env.APPDATA = roaming;
    process.env.ProgramFiles = programFiles;
    process.env['ProgramFiles(x86)'] = join(root, 'empty-program-files-x86');
    delete process.env.MT5AGENT_MT5_DIR;
    delete process.env.MT5AGENT_MT5_DATA_DIR;
    const native = installation();
    assert.ok(native);
    assert.equal(native.directory, program);
  } finally {
    restoreEnv(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows compilation rejects a manifest changed after the build was frozen', {
  skip: process.platform !== 'win32' || process.env.MT5AGENT_NATIVE_TESTS !== '1',
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mt5agent-frozen-manifest-'));
  try {
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ files: {}, compiler_sha256: 'changed' }));
    await assert.rejects(compileNative({ editor: join(directory, '.compiler', 'MetaEditor64.exe') }, directory, undefined, `sha256:${'0'.repeat(64)}`, undefined, { executeWorker: (entry, payload, options) => executeCompiler(payload, { directory, signal: options.signal }) }), /清单摘要/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Windows compiler uses the installed isolated WSL execution environment', {
  skip: process.platform !== 'win32' || process.env.MT5AGENT_NATIVE_TESTS !== '1',
}, () => {
  assert.equal(compilerDependencies(), true, 'The Windows backend must discover the WSL compiler');
});

test('MT5 doctor recognizes the native Windows terminal and WSL compiler', {
  skip: process.platform !== 'win32' || process.env.MT5AGENT_NATIVE_TESTS !== '1',
}, () => {
  const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(new URL('../packages/mt5/scripts/mt5.mjs', import.meta.url)), 'doctor'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const status = JSON.parse(result.stdout);
  assert.equal(status.installed, true);
  assert.equal(status.compiler, true);
});
