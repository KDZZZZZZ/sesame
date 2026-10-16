// P0-only frozen compiler fixtures. No trading, terminal launch or release approval.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const frozen = Object.freeze({
  compiler_sha256: 'c4641eda510ffea814c627c922ea19e9eef51a22ff1a7244cda31345736c1d2e',
  include_manifest_sha256: '4a0462183e1bcec7d6d089536635bc00833729659746e0fb5b767785de868941',
  source_sha256: {
    success: '2d8850ba7ebb28b60bbc024b30c6a96245d4695224cbb837414c422a66040523',
    error: '27aa75906d772150dd43984666d2a6c7d31141d4240b44fa0c0d3c6d11a6723e',
  },
});

function bounded(value, maximum, label) {
  assert.ok(Number.isFinite(value) && value >= 0 && value <= maximum, `${label} must be within ${maximum}`);
}

function validate(result, kind, budget) {
  assert.notEqual(result.type, 'error', result.message);
  assert.equal(result.id, `compile-${kind}`);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout || result.message);
  assert.equal(result.stopped, null, 'Stopped compilation does not pass');
  assert.equal(result.stderr, '', 'Compiler logs must be returned as files');
  bounded(result.wall_ms, budget.seconds * 1000, 'Host request wall_ms');
  bounded(result.elapsed_ms, budget.seconds * 1000, 'Guest request elapsed_ms');
  bounded(result.cleanup_ms, 2000, 'Task process cleanup_ms');

  const metrics = result.metrics;
  assert.ok(metrics && typeof metrics === 'object', 'Compiler cgroup evidence is required');
  for (const [name, value] of Object.entries({
    'memory.max': '2147483648', 'memory.swap.max': '0', 'pids.max': '256', 'cpu.max': '200000 100000',
  })) assert.equal(metrics[name], value, `Incorrect compiler resource limit: ${name}`);
  assert.match(metrics['cgroup.events'], /(?:^|\n)populated 0(?:\n|$)/, 'Task descendants must be gone');
  assert.match(metrics['memory.events'], /(?:^|\n)oom_kill 0(?:\n|$)/, 'OOM is not a successful compilation');
  const memoryPeak = Number(metrics['memory.peak']);
  const pidsPeak = Number(metrics['pids.peak']);
  assert.ok(memoryPeak > 0 && memoryPeak <= 2147483648, 'Compiler memory peak exceeds its budget');
  assert.ok(Number.isInteger(pidsPeak) && pidsPeak > 0 && pidsPeak <= 256, 'Compiler task peak exceeds its budget');

  assert.ok(result.files && typeof result.files === 'object' && !Array.isArray(result.files));
  const expectedFiles = ['Fixture.mq5', 'Fixture.log', 'compile-result.json', 'wine.log', 'xvfb.log'];
  if (kind === 'success') expectedFiles.push('Fixture.ex5');
  assert.deepEqual(Object.keys(result.files).sort(), expectedFiles.sort(), 'Missing artifacts or exported private prefix files');
  const files = Object.fromEntries(Object.entries(result.files).map(([name, encoded]) => {
    assert.equal(typeof encoded, 'string', `Expected base64 guest artifact: ${name}`);
    const bytes = Buffer.from(encoded, 'base64');
    assert.equal(bytes.toString('base64'), encoded, `Noncanonical base64 artifact: ${name}`);
    return [name, bytes];
  }));
  const record = JSON.parse(files['compile-result.json'].toString('utf8'));
  assert.deepEqual(JSON.parse(result.stdout.trim()), record, 'Printed and persisted compiler evidence disagree');
  assert.equal(record.case, kind);
  assert.equal(record.error, undefined);
  assert.equal(record.cleanup_timeout, undefined);
  assert.equal(record.expected_observed, true);
  assert.ok(Number.isInteger(record.exit_code), 'Actual MetaEditor exit code is required');
  bounded(record.elapsed_ms, budget.seconds * 1000, 'Compiler fixture elapsed_ms');
  // Retain validation of the earlier standard-budget P0 evidence. Mac runs
  // must use the updated fixture and explicitly record the longer budget.
  if (budget.name === 'macos' || record.compiler_budget !== undefined) {
    assert.equal(record.compiler_budget, budget.name);
    assert.equal(record.timeout_seconds, budget.seconds - 5);
    assert.equal(record.request_timeout_seconds, budget.seconds);
  }
  assert.ok(Number.isInteger(record.prefix_bytes) && record.prefix_bytes > 0, 'Disposable Wine prefix evidence is required');
  assert.equal(record.compiler_sha256, frozen.compiler_sha256);
  assert.equal(record.include_manifest_sha256, frozen.include_manifest_sha256);
  assert.equal(record.source_sha256, frozen.source_sha256[kind]);
  assert.equal(sha256(files['Fixture.mq5']), frozen.source_sha256[kind], 'Returned source is not the controlled fixture');
  assert.equal(files['Fixture.log'].subarray(0, 2).toString('hex'), 'fffe', 'Expected real UTF-16LE MetaEditor diagnostics');
  // Python read_text uses universal newlines; preserve the original file bytes
  // while comparing that JSON view with the same explicit newline conversion.
  const diagnostics = files['Fixture.log'].toString('utf16le').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  assert.equal(record.diagnostics, diagnostics);
  assert.ok(diagnostics.includes('Z:\\work\\Fixture.mq5'));
  assert.ok(diagnostics.includes('Include\\Trade\\Trade.mqh'), 'Frozen standard Include was not compiled');
  if (kind === 'success') {
    assert.equal(record.success, true);
    assert.match(diagnostics, /Result: 0 errors, 0 warnings/);
    assert.ok(files['Fixture.ex5'].length > 0 && files['Fixture.ex5'].length <= 8 * 1024 * 1024);
    assert.equal(record.ex5_sha256, sha256(files['Fixture.ex5']), 'EX5 digest does not match the returned bytes');
  } else {
    assert.equal(record.success, false);
    assert.match(diagnostics, /undeclared identifier 'missing_compile_token'/);
    assert.match(diagnostics, /Result: 1 errors, 0 warnings/);
    assert.equal(record.ex5_sha256, null);
  }
  return {
    case: kind, expected_observed: true, compiler_success: record.success,
    compiler_budget: budget.name, request_timeout_seconds: budget.seconds,
    metaeditor_exit_code: record.exit_code, compiler_sha256: record.compiler_sha256,
    source_sha256: record.source_sha256, include_manifest_sha256: record.include_manifest_sha256,
    ex5_sha256: record.ex5_sha256, ex5_bytes: files['Fixture.ex5']?.length ?? 0,
    wall_ms: result.wall_ms, elapsed_ms: result.elapsed_ms, fixture_elapsed_ms: record.elapsed_ms,
    cleanup_ms: result.cleanup_ms, prefix_bytes: record.prefix_bytes,
    memory_peak_bytes: memoryPeak, pids_peak: pidsPeak, metrics,
    scope: 'Two small compile-only fixtures; full product artifact budgets and distribution are not accepted',
  };
}

/** Harness adds host wall_ms to the untouched guest result before validation.
 * The original Mac budget is opt-in; host detection must not extend other runs.
 */
export async function buildCompileCases({ hostPlatform = 'linux' } = {}) {
  assert.ok(['win32', 'linux', 'darwin'].includes(hostPlatform), 'Unknown compiler host platform');
  const budget = hostPlatform === 'darwin'
    ? { name: 'macos', seconds: 300 }
    : { name: 'standard', seconds: 120 };
  const budgetOption = budget.name === 'macos' ? ' --budget macos' : '';
  return ['success', 'error'].map(kind => ({
    name: `compile-${kind}`,
    request() {
      return {
        id: `compile-${kind}`, profile: 'compiler', timeout: budget.seconds, files: {},
        ...(budget.name === 'macos' ? { compilerBudget: budget.name } : {}),
        script: `export SESAME_COMPILER_P0=1; exec /usr/bin/python3 /usr/share/sesame-compiler-p0/compile-guest.py --case ${kind}${budgetOption} --timeout ${budget.seconds - 5}`,
      };
    },
    validate(result) { return validate(result, kind, budget); },
  }));
}
