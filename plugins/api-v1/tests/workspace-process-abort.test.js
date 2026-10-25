import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const workspaceTools = new URL('../packages/workspace/tools.js', import.meta.url).href;

for (const mode of ['synchronous', 'asynchronous']) {
  test(`process cancellation contains ${mode} rejection from the revoked Host port`, async () => {
    // A separate process proves that EventTarget does not surface a fatal
    // nextTick exception; no uncaughtException/unhandledRejection handler masks it.
    const script = `
      import assert from 'node:assert/strict';
      import { tmpdir } from 'node:os';
      import { setImmediate as turn } from 'node:timers/promises';
      import { executeProcess } from ${JSON.stringify(workspaceTools)};
      const controller = new AbortController(), entered = Promise.withResolvers();
      let cancellations = 0;
      const host = {
        capabilities: { invoke: async () => ({ type: 'run', run: { id: 'process-fixture' } }) },
        runs: {
          cancel: ${mode === 'asynchronous' ? 'async ' : ''}() => {
            cancellations++;
            controller.signal.throwIfAborted();
          },
          wait: (_ref, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            entered.resolve();
          }),
        },
      };
      const pending = executeProcess(host, { assertPath: async path => path }, { cwd: tmpdir(), argv: ['fixture'] }, controller.signal);
      const rejected = assert.rejects(pending, error => error === controller.signal.reason && error.name === 'AbortError');
      await entered.promise;
      controller.abort();
      await rejected;
      await turn();
      assert.equal(cancellations, 1);
      console.log('cancellation remained rejected; process survived');
    `;
    const result = await run(process.execPath, ['--input-type=module', '--eval', script], { timeout: 10000, windowsHide: true });
    assert.match(result.stdout, /cancellation remained rejected; process survived/);
    assert.equal(result.stderr, '');
  });
}
