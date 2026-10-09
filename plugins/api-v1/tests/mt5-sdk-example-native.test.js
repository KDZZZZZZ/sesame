import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installation, fileManifest, compileNative } from '../packages/mt5/backend/native.js';
import { execute } from '../packages/mt5/backend/compiler-worker.js';
import { digest } from '../packages/mt5/backend/support.js';
import { SDK_VERSION } from '../packages/mt5/backend/contracts.js';

test('packaged Product lifecycle example compiles with installed native MetaEditor and actual SDK headers', { skip: process.env.MT5AGENT_NATIVE_TESTS !== '1', timeout: 300000 }, async t => {
  const native = installation(); assert.ok(native, 'Install/configure MT5 before native acceptance');
  const root = await mkdtemp(join(tmpdir(), 'sesame-sdk-example-')); let retain = false;
  t.after(async () => { if (!retain) await rm(root, { recursive: true, force: true }); else t.diagnostic(`Unconfirmed native cleanup retained at ${root}`); });
  await mkdir(join(root, 'Experts')); await mkdir(join(root, '.compiler'));
  await cp(native.include, join(root, 'Include'), { recursive: true });
  await rm(join(root, 'Include', 'Product'), { recursive: true, force: true });
  await cp(new URL('../packages/mt5/backend/sdk/', import.meta.url), join(root, 'Include', 'Product'), { recursive: true });
  await writeFile(join(root, 'Include', 'Product', 'Build.mqh'), `#define PRODUCT_BUILD_ID "compile_only_sdk_example"\n#define PRODUCT_SDK_VERSION "${SDK_VERSION}"\n`);
  await copyFile(native.editor, join(root, '.compiler', 'MetaEditor64.exe'));
  const source = await readFile(new URL('../packages/mt5/target/examples/Strategy.mq5', import.meta.url));
  await writeFile(join(root, 'Experts', 'Strategy.mq5'), source);
  const files = await fileManifest(root), manifest = JSON.stringify({ files, compiler_sha256: files['.compiler/MetaEditor64.exe'].sha256 });
  await writeFile(join(root, 'manifest.json'), manifest);
  let result;
  try { result = await compileNative(native, root, AbortSignal.timeout(240000), digest(manifest), undefined,
    { executeWorker: (_entry, payload, options) => execute(payload, { signal: options.signal, directory: root }) }); }
  catch (error) { retain = error.code === 'runtime_cleanup_failed'; throw error; }
  assert.equal(result.success, true, result.diagnostics);
  assert.equal(result.execution.backend, 'native'); assert.equal(result.execution.cleanup.activeProcesses, 0);
  assert.equal(result.ex5_sha256, digest(await readFile(join(root, 'Experts', 'Strategy.ex5'))));
  t.diagnostic(JSON.stringify({ source_sha256: digest(source), sdk_version: SDK_VERSION, compiler_sha256: files['.compiler/MetaEditor64.exe'].sha256, ex5_sha256: result.ex5_sha256, execution: result.execution, diagnostics: result.diagnostics }));
});
