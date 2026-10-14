import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeParameterValue } from '../../optional-api-v1/packages/mt5/backend/parameters.js';
import { stageFrozenBuild } from '../../optional-api-v1/packages/mt5/backend/frozen-compiler.js';
import { digest } from '../../optional-api-v1/packages/mt5/backend/support.js';

test('small numeric SVL scalars expand exponent notation without losing significant digits', () => {
  for (const type of ['decimal', 'price', 'quantity', 'money']) {
    for (const [value, expected] of [[1e-7, '0.0000001'], [-1.234e-8, '-0.00000001234'], [Number.MIN_VALUE, `0.${'0'.repeat(323)}5`]]) {
      assert.equal(nativeParameterValue({ type }, value), expected);
      assert.equal(Number(expected), value);
    }
    for (const value of [Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '1e-7']) assert.throws(() => nativeParameterValue({ type }, value));
  }
});

test('frozen inputs allow dot-prefixed names while rejecting parent traversal', async t => {
  const root = await mkdtemp(join(tmpdir(), 'mt5-input-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), staging = join(root, 'staging');
  await mkdir(join(source, '.compiler'), { recursive: true });
  await writeFile(join(source, '.compiler', 'MetaEditor64.exe'), 'compiler');
  await writeFile(join(source, '..hidden.mq5'), 'expert');
  const manifest = { compiler_sha256: digest('compiler'), files: {
    '.compiler/MetaEditor64.exe': { bytes: 8, sha256: digest('compiler') },
    '..hidden.mq5': { bytes: 6, sha256: digest('expert') },
  } };
  const save = async () => { const text = JSON.stringify(manifest); await writeFile(join(source, 'manifest.json'), text); return digest(text); };
  await stageFrozenBuild(source, await save(), staging);
  assert.equal(await readFile(join(staging, '..hidden.mq5'), 'utf8'), 'expert');
  manifest.files['../outside.mq5'] = { bytes: 6, sha256: digest('expert') };
  await assert.rejects(stageFrozenBuild(source, await save(), staging), /路径/);
});
