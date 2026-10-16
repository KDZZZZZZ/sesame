import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCatalogs } from './validate-api1-catalog.mjs';

test('a missing unified catalog or optional lock is an error rather than an omitted check', t => {
  const root = mkdtempSync(join(tmpdir(), 'sesame-required-catalog-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => validateCatalogs(root), /Required catalog input.*api-v1\/catalog\.json/);
  mkdirSync(join(root, 'plugins/api-v1'), { recursive: true }); writeFileSync(join(root, 'plugins/api-v1/catalog.json'), '{}');
  assert.throws(() => validateCatalogs(root), /Required catalog input.*optional-api-v1\/official-plugins\.lock\.json/);
});

test('trusted CI and publication call catalog validation outside candidate-controlled file guards', () => {
  for (const name of ['plugin-api-v1.yml', 'plugin-api1-release.yml']) {
    const workflow = readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8');
    const block = workflow.split('\n').filter(line => /validate-api1-catalog|if test -f|^\s+fi$/.test(line));
    assert.equal(block.length, 1, `${name}: no candidate file-existence guard may skip catalog validation`);
    assert.match(block[0], /validate-api1-catalog\.mjs/);
  }
});
