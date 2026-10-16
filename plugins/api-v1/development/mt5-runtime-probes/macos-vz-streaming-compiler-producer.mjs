// P0 transport adapter. Framing and input validation remain the production code.
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

const [modulePath, directory, manifestSha256, ...extra] = process.argv.slice(2);
assert.ok(modulePath && directory && /^sha256:[a-f0-9]{64}$/.test(manifestSha256) && !extra.length);
const { compilerSnapshotFrames, COMPILER_SNAPSHOT_LIMITS } = await import(pathToFileURL(modulePath));
assert.equal(COMPILER_SNAPSHOT_LIMITS.chunkBytes, 256 * 1024);
const controller = new AbortController();
for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => controller.abort());
try {
  await pipeline(Readable.from(compilerSnapshotFrames(directory, manifestSha256, { signal: controller.signal }),
    { objectMode: false, highWaterMark: 64 * 1024 }), process.stdout, { signal: controller.signal });
} catch (error) {
  process.stderr.write(`${error.code || error.name}: ${error.message}\n`);
  process.exitCode = 1;
}
