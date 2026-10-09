import test from 'node:test';
import assert from 'node:assert/strict';
import { createHook } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilerSnapshotFrames } from '../packages/mt5/backend/compiler-snapshot.js';

const tempRoot = fileURLToPath(new URL('../../../.test-output/compiler/', import.meta.url));
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

test('cancellation during final metadata I/O cannot emit the commit end record', async t => {
  await fs.mkdir(tempRoot, { recursive: true });
  const root = await fs.mkdtemp(join(tempRoot, 'compiler-snapshot-review-'));
  t.after(async () => {
    assert.equal(dirname(root), tempRoot.replace(/[\\/]$/, ''));
    await fs.rm(root, { recursive: true, force: true });
  });
  const payload = Buffer.from('controlled compiler fixture; never executed');
  await fs.mkdir(join(root, '.compiler'));
  await fs.writeFile(join(root, '.compiler/MetaEditor64.exe'), payload);
  const manifest = Buffer.from(JSON.stringify({
    compiler_sha256: digest(payload),
    files: { '.compiler/MetaEditor64.exe': { bytes: payload.length, sha256: digest(payload) } },
  }));
  await fs.writeFile(join(root, 'manifest.json'), manifest);
  const controller = new AbortController();
  const iterator = compilerSnapshotFrames(root, digest(manifest), { signal: controller.signal });
  for (;;) {
    const next = await iterator.next();
    assert.equal(next.done, false);
    if (JSON.parse(next.value).type === 'file_end') break;
  }
  let injected = false;
  const hook = createHook({
    init(_id, type) {
      if (type === 'FSREQPROMISE' && !injected) {
        injected = true;
        controller.abort(new Error('controlled cancellation during final lstat'));
      }
    },
  });
  hook.enable();
  try {
    await assert.rejects(iterator.next(), /controlled cancellation during final lstat/);
    assert.equal(injected, true, 'The test must cancel inside final filesystem I/O');
  } finally {
    hook.disable();
    await iterator.return();
  }
});
