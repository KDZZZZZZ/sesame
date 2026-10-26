import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';

const root = new URL('../packages/', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));

test('product help and collaboration have independent default knowledge owners', async () => {
  const skills = new Set();
  for (const [name, skill] of [['orchestration', 'coordinate-research'], ['user-guide', 'sesame-user-guide']]) {
    const manifest = await json(`${name}/plugin.json`);
    const declarations = await json(`${name}/capabilities.json`);
    assert.equal(manifest.id, `sesame/${name}`);
    assert.equal(manifest.default_state, 'mounted');
    assert.equal(manifest.entry, undefined);
    assert.deepEqual(declarations.capabilities, []);
    assert.deepEqual(declarations.knowledge.filter(item => item.kind === 'prompt').map(item => item.path), ['prompt.md']);
    assert.deepEqual(declarations.knowledge.filter(item => item.kind === 'skill').map(item => item.path), [`skills/${skill}/SKILL.md`]);
    for (const resource of declarations.knowledge) {
      const body = await readFile(new URL(`${name}/${resource.path}`, root), 'utf8');
      assert.ok(body.trim(), `${name}/${resource.path} must be readable`);
      if (resource.kind === 'skill') {
        const declaredName = /^name: (.+)$/m.exec(body)?.[1].trim();
        assert.equal(declaredName, skill);
        assert.ok(!skills.has(declaredName), 'a skill must have only one owner');
        skills.add(declaredName);
        for (const [, link] of body.matchAll(/\]\((references\/[^)]+\.md)\)/g)) {
          const path = posix.join(posix.dirname(resource.path), link);
          assert.ok(declarations.knowledge.some(item => item.kind === 'reference' && item.path === path), `${name}/${path} must be declared`);
        }
      }
    }
  }
});
