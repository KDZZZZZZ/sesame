import test from 'node:test';
import assert from 'node:assert/strict';
import { engineWithinProfile } from '../scripts/plugin-lock.mjs';

test('a package may narrow a reviewed profile to require newer host features', () => {
  for (const range of ['>=0.2.0-0','>=0.2.0','>=0.2.1','>=0.2.0-beta.1','>=0.3.0','>=1.0.0']) {
    assert.equal(engineWithinProfile(range,'>=0.2.0-0'),true,range);
  }
  assert.equal(engineWithinProfile('>=0.2.1-beta.10','>=0.2.1-beta.2'),true);
  assert.equal(engineWithinProfile('>=0.2.1','>=0.2.1-beta.2'),true);
  assert.equal(engineWithinProfile('>=0.2.1-beta.2.1','>=0.2.1-beta.2'),true);
});

test('the validator refuses widened, unsupported and malformed engine ranges', () => {
  for (const range of ['>=0.2.1-0','>=0.3.0-beta.1','>=0.1.9','>=0.1.999','>=0.0.0','*','^0.2.1','>=0.2.1 || >=0.1.0','>=0.2.1 <0.3.0','>=0.02.1','>=0.2.1-01','>=0.2.1-',null,{},'>=0.2.1\n']) {
    assert.equal(engineWithinProfile(range,'>=0.2.0-0'),false,String(range));
  }
  assert.equal(engineWithinProfile('>=0.2.1-beta.2','>=0.2.1-beta.10'),false);
  assert.equal(engineWithinProfile('>=0.2.1-beta.2','>=0.2.1'),false);
  assert.equal(engineWithinProfile('>=0.2.1-beta.2','>=0.2.1-beta.2.1'),false);
  assert.equal(engineWithinProfile('>=0.2.1','invalid-profile'),false);
});
