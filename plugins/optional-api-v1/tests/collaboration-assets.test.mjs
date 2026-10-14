import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('independently installable trading and factor plugins ship identical collaboration UI', () => {
  const trading = new URL('../packages/manual-trading/', import.meta.url);
  const factor = new URL('../packages/auto-factor-mining/', import.meta.url);
  const assets = readdirSync(new URL('assets/', trading)).filter(name => name.startsWith('collaboration'));
  for (const path of ['live-viewer.js', ...assets.map(name => `assets/${name}`)]) {
    assert.deepEqual(readFileSync(new URL(path, trading)), readFileSync(new URL(path, factor)), path);
  }
});
