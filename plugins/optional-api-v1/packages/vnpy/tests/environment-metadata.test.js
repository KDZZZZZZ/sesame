import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { environment } from '../environment.js';

const exec = promisify(execFile);
test('environment inspection ignores unnamed distribution metadata while retaining actual named packages', async t => {
  const python = process.env.SESAME_TEST_PYTHON ?? 'python';
  try { await exec(python, ['-I', '-B', '-c', 'import sys; print(sys.version_info[:2])'], { windowsHide: true }); }
  catch { t.skip('An existing Python is required for the controlled metadata fixture; no dependencies are installed.'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'sesame-vnpy-metadata-'));
  t.after(async () => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); await rm(directory, { recursive: true, force: true }); });
  await mkdir(join(directory, 'workspace'));
  let output, inspected, executions = 0;
  const host = {
    context: { storageRoot: join(directory, 'private'), workspaceRoot: join(directory, 'workspace'), pythonPath: python },
    capabilities: { async invoke(id, input) {
      assert.equal(id, 'host.process.exec'); executions++;
      const args = [...input.argv.slice(1)], index = args.indexOf('-c') + 1;
      // Execute the product's exact probe with controlled stdlib metadata. No
      // VeighNa import occurs because required versions are genuinely absent.
      args[index] = `import importlib.metadata as m
class FixtureDistribution:
 def __init__(self, name, version): self.metadata={"Name":name}; self.version=version
m.distributions=lambda: [FixtureDistribution(None,"bad"),FixtureDistribution("","empty"),FixtureDistribution("Fixture_Pkg","2.0")]
` + args[index];
      try {
        const result = await exec(input.argv[0], args, { cwd: input.cwd, windowsHide: true });
        output = { exitCode: 0, ...result }; inspected = JSON.parse(await readFile(args.at(-1), 'utf8'));
      } catch (cause) { output = { exitCode: cause.code, stderr: cause.stderr }; }
      return { type: 'run', run: { id: 'synthetic-process' } };
    } },
    runs: { async wait() { return { reason: 'settled', run: { id: 'synthetic-process', status: 'completed', output } }; } },
  };
  const result = await environment(host, { action: 'inspect' });
  assert.equal(executions, 1);
  assert.equal(result.ready, false);
  assert.equal(result.findings[0].error, undefined);
  assert.deepEqual(result.findings[0].versions, { vnpy: null, vnpy_ctastrategy: null });
  assert.deepEqual(inspected.packages, { 'fixture-pkg': '2.0' });
});
