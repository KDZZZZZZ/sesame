// Mac P0 baseline: unchanged shared compiler, hardening and GNU/npm fixtures.
import assert from 'node:assert/strict';
import { buildCompileCases } from './managed-vm/compile-cases.mjs';
import { buildGuestHardeningCase } from './managed-vm/guest-hardening-cases.mjs';
import { buildPosixToolCases } from './managed-vm/posix-tool-cases.mjs';

const readonly = {
  name: 'block-readonly',
  request() {
    return { id: 'block-readonly', timeout: 15, files: {}, script: `exec python3 - <<'PY'
import errno,json,os
state=os.statvfs('/usr')
try:
 with open('/usr/.sesame-p0-denied','wb') as target: target.write(b'denied')
 denied=False; error=0
except OSError as failure:
 denied=True; error=failure.errno
print(json.dumps({'readonly':bool(state.f_flag & os.ST_RDONLY),'write_denied':denied,'errno':error}))
PY` };
  },
  validate(result) {
    assert.equal(result.exitCode, 0, result.stderr || result.message);
    assert.equal(result.stopped, null);
    assert.equal(result.stderr, '');
    assert.deepEqual(result.files, {});
    const proof = JSON.parse(result.stdout);
    assert.deepEqual(proof, { readonly: true, write_denied: true, errno: 30 });
    return proof;
  },
};

function resourceEvidence(result, request) {
  const compiler = request.profile === 'compiler';
  const memory = compiler ? 2147483648 : 402653184;
  const tasks = compiler ? 256 : 64;
  for (const [key, value] of Object.entries({ 'memory.max': String(memory), 'memory.swap.max': '0',
    'pids.max': String(tasks), 'cpu.max': compiler ? '200000 100000' : '100000 100000' })) {
    assert.equal(result.metrics?.[key], value, key);
  }
  assert.match(result.metrics['cgroup.events'], /(?:^|\n)populated 0(?:\n|$)/);
  assert.match(result.metrics['memory.events'], /(?:^|\n)oom_kill 0(?:\n|$)/);
  assert.ok(Number.isFinite(result.cleanup_ms) && result.cleanup_ms >= 0 && result.cleanup_ms <= 2000);
  for (const value of [result.wall_ms, result.elapsed_ms]) {
    assert.ok(Number.isFinite(value) && value >= 0 && value <= request.timeout * 1000);
  }
  const peak = Number(result.metrics['memory.peak']), pids = Number(result.metrics['pids.peak']);
  assert.ok(Number.isInteger(peak) && peak > 0 && peak <= memory);
  assert.ok(Number.isInteger(pids) && pids > 0 && pids <= tasks);
  return { wall_ms: result.wall_ms, elapsed_ms: result.elapsed_ms, cleanup_ms: result.cleanup_ms,
    memory_peak_bytes: peak, pids_peak: pids, metrics: result.metrics };
}

export async function buildMacCompilerBaselineCases() {
  const security = buildGuestHardeningCase();
  const cases = [...await buildCompileCases({ hostPlatform: 'darwin' }),
    { name: 'guest-seccomp', request: () => structuredClone(security.request), validate: security.validate },
    readonly, ...await buildPosixToolCases()];
  return cases.map(fixture => ({
    name: fixture.name,
    request: fixture.request,
    validate(result) {
      const proof = fixture.validate(result);
      const resources = resourceEvidence(result, fixture.request());
      return fixture.name.startsWith('compile-') ? { ...proof, ...resources }
        : { name: fixture.name, accepted: true, proof, ...resources };
    },
  }));
}
