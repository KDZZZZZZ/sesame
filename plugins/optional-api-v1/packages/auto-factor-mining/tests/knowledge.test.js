import {readPackageDirectory} from '@sesame/plugin-sdk/surface';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const declaration = readPackageDirectory(root).capabilities;
const currentKnowledge = [
  'instructions.md', 'README.md', 'PROVENANCE.md', 'VALIDATION.md',
  'skills/auto-factor-mining/SKILL.md',
  'references/contracts.md', 'references/evaluation.md',
  'references/search.md', 'references/execution.md',
  'references/external-factor-sources.md',
];
const retiredPaths = [
  "examples/report.demo.html",
  "examples/demo-run.json",
  "references/research-guide.md",
  "references/factor-method.md",
  "references/factor-cli.md",
  "references/strategy-evidence.md",
  "references/strategy-cli.md",
  "scripts/reference-factor.mjs",
  "scripts/reference-experiment.mjs",
  "examples/reference-factor/development.demo.json",
  "examples/reference-factor/holdout.demo.json",
  "examples/reference-factor/plan.demo.json",
  "examples/reference-strategy/input.demo.json",
  "examples/reference-strategy/plan.demo.json",
  "examples/reference-strategy/timing.demo.json",
  "examples/reference-strategy/trials.demo.json",
  "references/native-validation.md",
  "examples/native-roundtrip.py"
];

test('Agent discovery exposes only the current factor research guides', () => {
  assert.deepEqual(declaration.knowledge.map(item => item.path).sort(), [...currentKnowledge].sort());
  for (const item of declaration.knowledge) {
    assert.doesNotMatch(item.description, /Historical v1/);
    assert.ok(existsSync(new URL(item.path, root)), item.path);
  }
});

test('retired material is absent from the package and current guide links resolve', () => {
  for (const path of retiredPaths) {
    assert.equal(existsSync(new URL(path, root)), false, path);
  }
  for (const path of currentKnowledge) {
    const contents = read(path);
    for (const retired of retiredPaths) assert.ok(!contents.includes(retired), `${path} references ${retired}`);
    for (const [, target] of contents.matchAll(/\]\(([^\s)]+)\)/g)) {
      if (/^[a-z][a-z\d+.-]*:|^#/i.test(target)) continue;
      assert.ok(existsSync(new URL(target, new URL(path, root))), `${path} -> ${target}`);
    }
  }
});

test('declared workflows are discoverable separately from knowledge', () => {
  assert.ok(readPackageDirectory(root).workflows.length);
});
