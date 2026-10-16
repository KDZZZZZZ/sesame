// P0 output-capacity fixtures. Synthetic .ex5 bytes are never compiled or run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const MIB = 1024 * 1024;
const CHUNK_BYTES = 65536;
const DIAGNOSTIC = 'Synthetic transport capacity fixture. No compiler was executed.\r\n';
const diagnosticBytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(DIAGNOSTIC, 'utf16le')]);
const limits = Object.freeze({
  compiler: { file: 32 * MIB, total: 40 * MIB, memory: 2 * 1024 * MIB, tasks: 256, cpu: '200000 100000' },
  research: { file: 8 * MIB, total: 16 * MIB, memory: 384 * MIB, tasks: 64, cpu: '100000 100000' },
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = new Map();

function patternHash(bytes) {
  if (hashes.has(bytes)) return hashes.get(bytes);
  const hash = createHash('sha256');
  const block = Buffer.from(Array.from({ length: CHUNK_BYTES }, (_, offset) => (offset * 31 + 7) & 255));
  for (let offset = 0, index = 0; offset < bytes; offset += CHUNK_BYTES, index++) {
    block.writeUInt32LE(index, 0);
    hash.update(block.subarray(0, Math.min(CHUNK_BYTES, bytes - offset)));
  }
  const digest = hash.digest('hex');
  hashes.set(bytes, digest);
  return digest;
}

function scriptFor(profile, specifications, diagnostic) {
  return `exec /usr/bin/python3 - <<'PY'
import hashlib, json
from pathlib import Path
specifications = ${JSON.stringify(specifications)}
work = Path('/work')
block = bytearray((offset * 31 + 7) & 255 for offset in range(${CHUNK_BYTES}))
files = {}
for item in specifications:
    path = work / item['name']
    digest = hashlib.sha256()
    remaining, index = item['bytes'], 0
    with path.open('xb') as target:
        while remaining:
            block[:4] = index.to_bytes(4, 'little')
            chunk = block[:min(len(block), remaining)]
            target.write(chunk)
            digest.update(chunk)
            remaining -= len(chunk)
            index += 1
    assert path.stat().st_size == item['bytes']
    files[item['name']] = {'bytes': path.stat().st_size, 'sha256': digest.hexdigest()}
${diagnostic ? `data = b'\\xff\\xfe' + ${JSON.stringify(DIAGNOSTIC)}.encode('utf-16le')
with (work / 'Capacity.log').open('xb') as target:
    target.write(data)
files['Capacity.log'] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
` : ''}print(json.dumps({'fixture': 'synthetic-compiler-transport-v1', 'compiler_executed': False,
                  'profile': '${profile}', 'files': files, 'total_bytes': sum(item['bytes'] for item in files.values())}))
PY`;
}

function bounded(value, maximum, label) {
  assert.ok(Number.isFinite(value) && value >= 0 && value <= maximum, `${label} exceeds ${maximum}`);
}

function validate(result, fixture) {
  const budget = limits[fixture.profile];
  assert.notEqual(result.type, 'error', result.message);
  assert.equal(result.id, fixture.name, 'Wrong capacity response');
  // Rejection happens during collection, after the controlled writer exited.
  assert.equal(result.exitCode, 0, result.stderr || result.message);
  assert.equal(result.stderr, '');
  assert.equal(result.stopped, fixture.rejected ? 'file_limit' : null);
  bounded(result.wall_ms, fixture.timeout * 1000, 'Host request duration');
  bounded(result.elapsed_ms, fixture.timeout * 1000, 'Guest request duration');
  bounded(result.cleanup_ms, 2000, 'Task cleanup duration');
  assert.ok(result.metrics && typeof result.metrics === 'object');
  for (const [key, value] of Object.entries({ 'memory.max': String(budget.memory), 'memory.swap.max': '0',
    'pids.max': String(budget.tasks), 'cpu.max': budget.cpu })) assert.equal(result.metrics[key], value, key);
  assert.match(result.metrics['cgroup.events'], /(?:^|\n)populated 0(?:\n|$)/);
  assert.match(result.metrics['memory.events'], /(?:^|\n)oom_kill 0(?:\n|$)/);
  const memoryPeak = Number(result.metrics['memory.peak']), pidsPeak = Number(result.metrics['pids.peak']);
  assert.ok(Number.isInteger(memoryPeak) && memoryPeak > 0 && memoryPeak <= budget.memory);
  assert.ok(Number.isInteger(pidsPeak) && pidsPeak > 0 && pidsPeak <= budget.tasks);
  assert.equal(typeof result.stdout, 'string');
  assert.ok(Buffer.byteLength(result.stdout) <= MIB, 'Capacity proof must fit the unchanged stdout allowance');
  assert.deepEqual(JSON.parse(result.stdout), { fixture: 'synthetic-compiler-transport-v1', compiler_executed: false,
    profile: fixture.profile, files: fixture.expected, total_bytes: fixture.totalBytes }, 'Controlled writer proof mismatch');
  assert.ok(result.files && typeof result.files === 'object' && !Array.isArray(result.files));
  const artifacts = {};
  if (fixture.rejected) {
    assert.deepEqual(result.files, {}, 'Over-budget output must be rejected atomically');
  } else {
    assert.deepEqual(Object.keys(result.files).sort(), Object.keys(fixture.expected).sort(), 'Partial or extra artifact set');
    for (const [name, expected] of Object.entries(fixture.expected)) {
      const encoded = result.files[name];
      assert.equal(typeof encoded, 'string');
      assert.equal(encoded.length, 4 * Math.ceil(expected.bytes / 3), `${name} encoded length`);
      const bytes = Buffer.from(encoded, 'base64');
      assert.equal(bytes.length, expected.bytes, `${name} byte length`);
      assert.equal(bytes.toString('base64'), encoded, `${name} canonical encoding`);
      assert.equal(sha256(bytes), expected.sha256, `${name} complete payload digest`);
      artifacts[name] = { bytes: bytes.length, sha256: sha256(bytes) };
    }
  }
  // This is a post-parse assertion; the transport still needs a bounded reader.
  const responseJsonBytes = Buffer.byteLength(JSON.stringify(result)) + 1;
  assert.ok(responseJsonBytes <= 64 * MIB, 'Response exceeds the existing worker envelope');
  return { name: fixture.name, profile: fixture.profile, synthetic_payload: true, compiler_executed: false,
    expected_observed: true, rejected: fixture.rejected, stopped: result.stopped,
    generated_bytes: fixture.totalBytes, transferred_bytes: fixture.rejected ? 0 : fixture.totalBytes,
    artifacts, wall_ms: result.wall_ms, elapsed_ms: result.elapsed_ms, cleanup_ms: result.cleanup_ms,
    memory_peak_bytes: memoryPeak, pids_peak: pidsPeak, resource_limits: { ...budget, swap: 0 },
    reencoded_response_json_bytes: responseJsonBytes,
    scope: 'Synthetic output capacity and rejection only; no compiler execution, input-bundle or backtest acceptance' };
}

/** Same request()/validate(result) interface as compile-cases.mjs; no VM launch. */
export async function buildCompilerTransportCases({ hostPlatform = 'linux' } = {}) {
  assert.ok(['linux', 'win32', 'darwin'].includes(hostPlatform), 'Unknown compiler host platform');
  const definitions = [
    { name: 'compiler-transport-exact-32mib', profile: 'compiler', diagnostic: true,
      specifications: [{ name: 'Capacity.ex5', bytes: 32 * MIB }], rejected: false },
    { name: 'compiler-transport-file-over-limit', profile: 'compiler',
      specifications: [{ name: 'Capacity.ex5', bytes: 32 * MIB + 1 }], rejected: true },
    { name: 'compiler-transport-total-over-limit', profile: 'compiler',
      specifications: [{ name: 'Capacity.ex5', bytes: 32 * MIB }, { name: 'extra.bin', bytes: 8 * MIB + 1 }], rejected: true },
    { name: 'research-transport-file-over-limit', profile: 'research',
      specifications: [{ name: 'payload.bin', bytes: 8 * MIB + 1 }], rejected: true },
    { name: 'research-transport-total-over-limit', profile: 'research',
      specifications: [{ name: 'one.bin', bytes: 8 * MIB }, { name: 'two.bin', bytes: 8 * MIB }, { name: 'tail.bin', bytes: 1 }], rejected: true },
  ];
  return definitions.map(definition => {
    const expected = Object.fromEntries(definition.specifications.map(item => [item.name, { bytes: item.bytes, sha256: patternHash(item.bytes) }]));
    if (definition.diagnostic) expected['Capacity.log'] = { bytes: diagnosticBytes.length, sha256: sha256(diagnosticBytes) };
    const fixture = { ...definition, expected, totalBytes: Object.values(expected).reduce((sum, file) => sum + file.bytes, 0),
      timeout: definition.profile === 'compiler' && hostPlatform === 'darwin' ? 300 : 120 };
    return {
      name: fixture.name,
      request() {
        return { id: fixture.name, profile: fixture.profile, timeout: fixture.timeout, files: {},
          ...(fixture.profile === 'compiler' && hostPlatform === 'darwin' ? { compilerBudget: 'macos' } : {}),
          script: scriptFor(fixture.profile, fixture.specifications, fixture.diagnostic) };
      },
      validate(result) { return validate(result, fixture); },
    };
  });
}
