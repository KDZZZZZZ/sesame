import test from 'node:test';
import assert from 'node:assert/strict';
import { engineWithinProfile } from '../scripts/plugin-lock.mjs';

test('host lower bounds use the application includePrerelease policy without widening profiles', () => {
  for (const range of ['>=0.2.3-dev.5', '>=0.2.3', '>=1.0.0-alpha.1']) assert.equal(engineWithinProfile(range, '>=0.2.0-0'), true, range);
  assert.equal(engineWithinProfile('>=0.2.3-dev.5', '>=0.2.3-dev.4'), true);
  assert.equal(engineWithinProfile('>=0.2.3-dev.10', '>=0.2.3-dev.9'), true);
  assert.equal(engineWithinProfile('>=0.2.3', '>=0.2.3-dev.5'), true);
  for (const range of ['>=0.2.3-dev.4', '>=0.2.2', '>=0.2.3-dev.05', '>=0.2.3-dev.5 || >=0.1.4', '^0.2.3']) assert.equal(engineWithinProfile(range, '>=0.2.3-dev.5'), false, range);
  assert.equal(engineWithinProfile('>=0.2.3-dev.5', '>=0.2.3'), false);
});
