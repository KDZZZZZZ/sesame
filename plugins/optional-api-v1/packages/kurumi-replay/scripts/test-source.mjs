// Selected source regressions only. Keep npm test as the unfiltered suite.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const excluded = {
  'committed-playback.test.mjs': 'requires explicit native Python',
  'core-clock-workflow.test.mjs': 'requires explicit native Python',
  'native-engine.test.mjs': 'copies prepared native dependencies; separate opt-in',
  'profile-native50.test.mjs': 'requires explicit native Python',
  'profile-realcopy50.test.mjs': 'requires native Python and frozen private quote input',
  'cadence-recording.test.mjs': 'known old controller fixture / transaction-pointer failure',
  'checkpoint-text-repair.test.mjs': 'known old controller fixture / transaction-pointer failure',
  'fx-supplement.test.mjs': 'known old controller fixture / transaction-pointer failure',
  'service.test.mjs': 'known old storage fixture missing collection list support',
};
console.log('SELECTED source regressions, NOT the complete suite or native SDK acceptance.');
for (const [file, reason] of Object.entries(excluded)) console.log(`Not run: ${file}: ${reason}`);
console.log('The actual-message snapshot case is not run: it requires private observed input.');
const files = readdirSync(new URL('../tests/', import.meta.url)).sort()
  .filter(name => name.endsWith('.test.mjs') && !Object.hasOwn(excluded, name));
const result = spawnSync(process.execPath, [
  '--test', '--test-reporter=tap', '--test-concurrency=1',
  '--test-skip-pattern=actual supplied 0.2.2 snapshot array',
  ...files.map(name => `tests/${name}`),
], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
