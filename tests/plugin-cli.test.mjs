import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../scripts/plugin.mjs';
import { readPackageDirectory, writeYaml } from '../plugins/protocol/directory.mjs';
import { verifyCases } from '../plugins/protocol/evaluation/verify-cases.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sesame-contribution-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, kind] of [['api-v1', 'core'], ['optional-api-v1', 'optional']]) {
    const dir = join(root, 'plugins', name);
    mkdirSync(join(dir, 'packages'), { recursive: true });
    writeFileSync(join(dir, 'bundle-profile.json'), JSON.stringify({
      schemaVersion: 1, kind, engines: { sesame: '>=0.2.0-0' }, discover: true, exclude: [],
    }));
  }
  mkdirSync(join(root, '.github'));
  copyFileSync(new URL('../.github/application-release.json', import.meta.url), join(root, '.github/application-release.json'));
  writeFileSync(join(root, 'plugins/api-v1/inventory-policy.json'), '{}\n');
  return root;
}

test('contributors create all starter types, repair stale locks and verify tracked data without importing packages', async t => {
  const root = fixture(t), core = join(root, 'plugins/api-v1/packages'), optional = join(root, 'plugins/optional-api-v1/packages');
  await main(['new', 'sesame/core-method'], root);
  renameSync(join(optional, 'core-method'), join(core, 'core-method'));
  for (const type of ['knowledge', 'function', 'adapter', 'workflow']) {
    const name = type + '-sample';
    await main(['new', 'community/' + name, '--type', type], root);
    const pkg = readPackageDirectory(join(optional, name));
    assert.equal(pkg.manifest.id, 'community/' + name);
    assert.equal(pkg.manifest.default_state, 'discoverable');
    assert.equal(pkg.tools.length, type === 'knowledge' ? 0 : 1);
    assert.ok(pkg.manifest.license && pkg.manifest.license === JSON.parse(readFileSync(join(optional, name, 'package.json'))).license);
  }
  await assert.rejects(main(['new', '../escape'], root));
  await assert.rejects(main(['new', 'sesame/core-method'], root));
  await assert.rejects(main(['new', 'community/function-sample'], root));
  await assert.rejects(main(['new', 'other/invalid', '--publisher', 'other'], root));
  await assert.rejects(main(['release', '--pr', '0'], root));
  await assert.rejects(main(['release', '--pr', '1', '--include', 'community/one', '--include', 'community/one'], root), /one --include/);
  const func = join(optional, 'function-sample');
  writeFileSync(join(func, 'index.js'), 'throw new Error("candidate was executed");\n');
  const first = await main(['check', '--fix'], root);
  assert.deepEqual(first.packages, { core: 1, optional: 4 });
  assert.equal(first.evaluation.cases, 5);
  assert.equal((await main(['sync'], root)).changed, 0);
  const surface = join(func, 'surface.lock.json'), previous = readFileSync(surface, 'utf8');
  writeFileSync(join(func, 'instructions.md'), 'Updated contributor instructions.\n');
  await assert.rejects(main(['check'], root), /lock/i);
  assert.equal(readFileSync(surface, 'utf8'), previous);
  await main(['check', '--fix'], root);
  assert.notEqual(readFileSync(surface, 'utf8'), previous);
  assert.equal((await main(['sync'], root)).changed, 0);
  assert.equal(existsSync(join(root, 'plugins/api-v1/inventory.json')), true);

  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { stdio: 'pipe' });
  git('init', '--quiet');
  git('add', '.');
  git('commit', '--quiet', '-m', 'Fixed plugin source for release');
  const include = ['community/function-sample', 'community/adapter-sample'];
  const result = await main(['release', '--pr', '17', '--include', include[0], '--include', include[1]], root);
  assert.deepEqual(result.include, include);
  assert.equal(result.pullRequest, 17);
  const plan = JSON.parse(readFileSync(join(root, result.path)));
  assert.deepEqual(result.profiles, plan.profiles.map(p => ({
    profile: p.profile, packages: p.packages.length, lockSha256: p.lockSha256, archiveSha256: p.archiveSha256,
  })));

  // The trusted PR evaluator validates replay assertions, including any in
  // sandbox cases, while leaving the native business call to the local sandbox.
  const call = readPackageDirectory(func).tools[0].name;
  const path = join(func, 'evals/cases/sum.yaml');
  const sandbox = {
    id: 'native-sum', environment: { mode: 'sandbox' },
    steps: [{ operation: 'server/discover' }, { operation: 'tools/call', params: { name: call, arguments: { values: [1, 2] } } }],
    expect: [{ step: 0, pointer: '/serverInfo/name', equals: 'community/function-sample' }, { step: 1, pointer: '/total', equals: 3 }],
  };
  writeFileSync(path, writeYaml(sandbox));
  const staticResult = verifyCases(root, { staticOnly: true });
  assert.equal(staticResult.sandboxCallsDeferred, 1);
  assert.equal(staticResult.assertions, 6);
  sandbox.expect[0].equals = 'wrong';
  writeFileSync(path, writeYaml(sandbox));
  assert.throws(() => verifyCases(root, { staticOnly: true }), /function-sample/);
});
