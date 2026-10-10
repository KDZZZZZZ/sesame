import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installation, fileManifest, compileNative } from '../../optional-api-v1/packages/mt5/backend/native.js';
import { execute } from '../../optional-api-v1/packages/mt5/backend/compiler-worker.js';
import { digest } from '../../optional-api-v1/packages/mt5/backend/support.js';

// Explicit opt-in: copies the installed compiler read-only, compiles a harmless
// script, and never starts a trading terminal, logs in, or executes the script.
// Windows/Linux execution must be checked on those real platforms separately.
test('installed native MetaEditor compiles a frozen source and reports syntax errors without a VM', { skip: process.env.MT5AGENT_NATIVE_TESTS !== '1', timeout: 600000 }, async t => {
  const native = installation(); assert.ok(native, 'Install/configure MT5 before opting into native acceptance');
  const root = await mkdtemp(join(tmpdir(), 'sesame-native-acceptance-')); let retain = false;
  t.after(async () => { if (!retain) await rm(root, { recursive: true, force: true }); else t.diagnostic(`Unconfirmed native cleanup retained at ${root}`); });
  const compile = async (name, text) => {
    const directory = join(root, name); await mkdir(join(directory, 'Experts'), { recursive: true }); await mkdir(join(directory, '.compiler')); await mkdir(join(directory, 'Include'));
    await copyFile(native.editor, join(directory, '.compiler', 'MetaEditor64.exe'));
    await writeFile(join(directory, 'Experts', 'Strategy.mq5'), text);
    const files = await fileManifest(directory), manifest = JSON.stringify({ files, compiler_sha256: files['.compiler/MetaEditor64.exe'].sha256 });
    await writeFile(join(directory, 'manifest.json'), manifest);
    try {
      const result = await compileNative(native, directory, AbortSignal.timeout(240000), digest(manifest), undefined,
        { executeWorker: (_entry, payload, options) => execute(payload, { signal: options.signal, directory: root }) });
      return { directory, result };
    } catch (error) { retain ||= error.code === 'runtime_cleanup_failed'; throw error; }
  };
  const good = await compile('valid', '#property strict\nvoid OnStart() { Print("Sesame compile-only acceptance"); }\n');
  assert.equal(good.result.success, true, good.result.diagnostics); assert.equal(good.result.execution.backend, 'native');
  assert.equal(good.result.execution.cleanup.activeProcesses, 0); assert.equal(good.result.ex5_sha256, digest(await readFile(join(good.directory, 'Experts', 'Strategy.ex5'))));
  const bad = await compile('invalid', '#property strict\nvoid OnStart() { MissingSymbol(); }\n');
  assert.equal(bad.result.success, false); assert.match(bad.result.diagnostics, /MissingSymbol/); assert.equal(bad.result.ex5_sha256, null);
  assert.equal(bad.result.execution.cleanup.activeProcesses, 0);
});
