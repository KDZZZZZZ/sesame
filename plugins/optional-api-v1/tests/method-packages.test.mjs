import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildLock } from '../../api-v1/scripts/plugin-lock.mjs';

export const names = ['ict', 'price-action', 'elliott-wave', 'wyckoff', 'dow-theory', 'behavioral-finance', 'institutional-analysis', 'narrative-analysis'];
const packages = fileURLToPath(new URL('../packages/', import.meta.url));
const json = async path => JSON.parse(await readFile(path, 'utf8'));

test('eight independent zero-tool packages have complete resources, licenses and no cross-method dependency', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sesame-method-static-'));
  try {
    await mkdir(join(root, 'packages'));
    for (const name of names) {
      const path = join(packages, name), manifest = await json(join(path, 'plugin.json'));
      assert.equal(manifest.id, `sesame/${name}`); assert.equal(manifest.default_state, 'discoverable');
      assert.equal(manifest.engines.sesame, '>=0.2.0-0'); assert.deepEqual(manifest.tool_names, []);
      assert.deepEqual(manifest.provides, {}); assert.equal(manifest.migration, undefined); assert.equal(manifest.dependencies, undefined);
      const module = await import(new URL(`../packages/${name}/index.js`, import.meta.url));
      assert.deepEqual(module.createTools(), []); assert.equal(module.activate, undefined);
      assert.deepEqual(await json(join(path, 'tools.json')), []);
      const skill = await readFile(join(path, `skills/${name}/SKILL.md`), 'utf8');
      assert.match(skill, new RegExp(`name: ${name}`)); assert.ok(skill.length > 800);
      for (const resource of manifest.resources) await readFile(join(path, resource));
      assert.ok(manifest.resources.includes('PROVENANCE.md'));
      assert.ok(manifest.resources.includes('examples/expected.md'));
      const provenance = await readFile(join(path, 'PROVENANCE.md'), 'utf8');
      assert.match(provenance, /2026-10-10/); assert.match(provenance, /GPL-3.0/); assert.match(provenance, /未复制/);
      const prompt = await readFile(join(path, 'prompt.md'), 'utf8');
      for (const other of names.filter(n => n !== name)) assert.ok(!prompt.includes(`按 ${other} skill`));
      await cp(path, join(root, 'packages', name), { recursive: true });
    }
    assert.equal(buildLock(root).packages.length, 8);
    // These are copies of generic input validation, not an implicit method plugin dependency.
    assert.equal(await readFile(join(packages, 'ict/scripts/bar_input.py'), 'utf8'), await readFile(join(packages, 'price-action/scripts/bar_input.py'), 'utf8'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('six manual method fixtures expose concrete counterexamples rather than successful market claims', async () => {
  const read = name => json(join(packages, name, 'examples/case.json'));
  const elliott = await read('elliott-wave');
  assert.ok(Number(elliott.anchors[4].price) < Number(elliott.anchors[1].price)); // standard impulse overlap
  assert.match(await readFile(join(packages, 'elliott-wave/examples/expected.md'), 'utf8'), /failed-standard-impulse/);
  const wyckoff = await read('wyckoff'); assert.equal(wyckoff.participant_identity, 'unknown');
  assert.ok(wyckoff.observations.every(o => o.volume_kind === 'tick'));
  const dow = await read('dow-theory');
  assert.ok(dow.indices.some(o => Number(o.close) <= Number(o.threshold)));
  assert.ok(dow.future_observation.available_at > dow.as_of);
  const behavior = await read('behavioral-finance');
  assert.equal(behavior.investor_cost_basis, 'unknown'); assert.ok(behavior.evidence.some(e => e.available_at > behavior.as_of));
  const institutions = await read('institutional-analysis');
  assert.ok(institutions.policy.effective_at > institutions.as_of); assert.notEqual(institutions.case_a.collateral, institutions.case_b.collateral);
  const narrative = await read('narrative-analysis');
  const eligible = narrative.claims.filter(c => c.available_at <= narrative.as_of);
  assert.equal(eligible.length, 3); assert.equal(new Set(eligible.map(c => c.source_cluster)).size, 1);
  for (const name of names.filter(n => !['ict', 'price-action'].includes(n))) assert.equal((await read(name)).provenance_kind, 'demo');
});
