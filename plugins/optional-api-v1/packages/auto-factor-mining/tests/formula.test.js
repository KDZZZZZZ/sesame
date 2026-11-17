import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonical, digest } from '../contracts.js';

test('Python and JavaScript canonical identities agree for numeric and Unicode edges', { skip: !process.env.PYTHON }, () => {
  const numbers = [1, 1.0, -0, 1e-7, 1e-6, 0.1, 1.0000000000000001e18, 1e21, 1e22, 1.2345678901234567, 5e-324];
  const value = { numbers, unicode: { '\uE000': '中', '\u{10000}': '\uD800', x: '😀' } };
  const tree = { call: 'Mean', args: [{ field: 'close' }, { constant: 2.0 }] };
  const source = 'import json,sys;sys.path.insert(0,sys.argv[1]);from formula import canonical_json,validate_and_compile,OPERATOR_DIGEST;v=json.loads(sys.stdin.buffer.read().decode("utf-8"));print(json.dumps({"canonical":canonical_json(v["value"]),"compiled":validate_and_compile(v["formula"],{"fields":["close"]}),"operatorDigest":OPERATOR_DIGEST}))';
  const result = spawnSync(process.env.PYTHON ?? 'python', ['-I', '-B', '-c', source, fileURLToPath(new URL('../python', import.meta.url))], { encoding: 'utf8', input: JSON.stringify({ value, formula: { dsl: 'qlib-expr/1', tree } }), timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.canonical, canonical(value));
  assert.equal(output.compiled.digest, digest({ dsl: 'qlib-expr/1', operatorDigest: output.operatorDigest, tree }));
});
