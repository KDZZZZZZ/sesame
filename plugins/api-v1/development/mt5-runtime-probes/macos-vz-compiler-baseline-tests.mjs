import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMacCompilerBaselineCases } from './macos-vz-compiler-baseline-cases.mjs';
import { buildCompileCases } from './managed-vm/compile-cases.mjs';
import { buildGuestHardeningCase } from './managed-vm/guest-hardening-cases.mjs';
import { buildPosixToolCases } from './managed-vm/posix-tool-cases.mjs';

const cases = await buildMacCompilerBaselineCases();
test('baseline preserves every shared request and the original Mac compiler budget', async () => {
  assert.deepEqual(cases.map(item => item.name), ['compile-success', 'compile-error', 'guest-seccomp',
    'block-readonly', 'gnu-bash-semantics', 'npm-version', 'offline-npx-stdio']);
  for (const [index, fixture] of (await buildCompileCases({ hostPlatform: 'darwin' })).entries()) {
    assert.deepEqual(cases[index].request(), fixture.request());
    assert.equal(cases[index].request().timeout, 300);
  }
  assert.deepEqual(cases[2].request(), buildGuestHardeningCase().request);
  for (const [index, fixture] of (await buildPosixToolCases()).entries()) {
    assert.deepEqual(cases[index + 4].request(), fixture.request());
  }
});

const response = () => ({ exitCode: 0, stopped: null, stderr: '', files: {},
  stdout: JSON.stringify({ readonly: true, write_denied: true, errno: 30 }),
  wall_ms: 20, elapsed_ms: 19, cleanup_ms: 1,
  metrics: { 'memory.max': '402653184', 'memory.swap.max': '0', 'pids.max': '64',
    'cpu.max': '100000 100000', 'cgroup.events': 'populated 0\nfrozen 0\n',
    'memory.events': 'oom 0\noom_kill 0\n', 'memory.peak': '16777216', 'pids.peak': '3' } });

test('baseline checks the read-only mount and original task accounting', () => {
  assert.equal(cases[3].validate(response()).accepted, true);
});
test('relaxed resources, uncleared descendants and deadline violations cannot pass', () => {
  const invalid = [
    value => { value.metrics['memory.max'] = '2147483648'; },
    value => { value.metrics['memory.swap.max'] = 'max'; },
    value => { value.metrics['pids.max'] = '256'; },
    value => { value.metrics['cpu.max'] = 'max 100000'; },
    value => { value.metrics['cgroup.events'] = 'populated 1\n'; },
    value => { value.metrics['memory.events'] = 'oom_kill 1\n'; },
    value => { value.metrics['memory.peak'] = '402653185'; },
    value => { value.metrics['pids.peak'] = '65'; },
    value => { value.cleanup_ms = 2001; },
    value => { value.wall_ms = 15001; },
    value => { value.elapsed_ms = 15001; },
    value => { value.stdout = JSON.stringify({ readonly: false, write_denied: false, errno: 0 }); },
  ];
  for (const mutate of invalid) {
    const value = response(); mutate(value);
    assert.throws(() => cases[3].validate(value));
  }
});
