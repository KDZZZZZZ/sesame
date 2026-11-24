import {readPackageDirectory} from '../../protocol/directory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';

const root = new URL('../packages/', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));

test('product help and collaboration have independent default knowledge owners', async () => {
  const skills = new Set();
  const guide = readPackageDirectory(new URL('user-guide/',root)).manifest;
  const guideDeclarations = readPackageDirectory(new URL('user-guide/',root)).capabilities;
  assert.equal(guide.id, 'sesame/user-guide');
  assert.equal(guide.default_state, 'mounted');
  assert.equal(guide.entry, undefined);
  assert.deepEqual(guideDeclarations.capabilities, []);
  assert.deepEqual(guideDeclarations.knowledge.filter(item => item.kind === 'prompt').map(item => item.path), ['instructions.md']);
  assert.deepEqual(guideDeclarations.knowledge.filter(item => item.kind === 'skill').map(item => item.path), ['skills/sesame-user-guide/SKILL.md']);
  const orchestration = readPackageDirectory(new URL('orchestration/',root)).manifest;
  const navigation = readPackageDirectory(new URL('orchestration/',root)).capabilities;
  assert.equal(orchestration.id, 'sesame/orchestration');
  assert.equal(orchestration.default_state, 'mounted');
  assert.equal(orchestration.entry, 'index.js');
  assert.deepEqual(navigation.capabilities.map(item => item.id), ['workflow_status', 'workflow_plan', 'workflow_step']);
  assert.deepEqual(navigation.hooks, []);
  assert.deepEqual(navigation.knowledge.filter(item => item.kind === 'prompt').map(item => item.path), ['instructions.md']);
  assert.deepEqual(navigation.knowledge.filter(item => item.kind === 'skill').map(item => item.path), ['skills/coordinate-research/SKILL.md']);
  for (const [name, declarations, skill] of [['user-guide', guideDeclarations, 'sesame-user-guide'], ['orchestration', navigation, 'coordinate-research']]) {
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
