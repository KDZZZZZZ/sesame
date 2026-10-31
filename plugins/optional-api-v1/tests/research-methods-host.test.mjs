// Opt-in integration against a matching host checkout. All state is temporary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const hostRoot = process.env.SESAME_HOST_ROOT;
test('Strategy formally installs its merged reference resources, executes the optional CLIs and reopens', { skip: !hostRoot, timeout: 60000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const { Store } = await load('modules/agent/store.js'), { Runtime } = await load('modules/agent/runtime.js');
  const { createHostContextV2 } = await load('modules/plugins/host-v2/context.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sesame-integrated-methods-')));
  const source = fileURLToPath(new URL('../packages/auto-factor-mining/', import.meta.url));
  const originalFetch = globalThis.fetch; let store, runtime, main, requests = 0;
  const close = async () => { await runtime?.close(); runtime = null; store?.close(); store = null; };
  t.after(async () => { await close(); globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); });
  globalThis.fetch = async () => { requests++; throw new Error('Integrated reference fixture prohibits network'); };
  const open = async () => {
    store = new Store(join(root, 'state'));
    runtime = await new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: join(root, 'empty') }).init();
    main = createHostContextV2(runtime, runtime.capabilities.hostEntry, 'conv_main');
  };
  await open();
  const packagePath = join(runtime.workspaces.root('conv_main'), 'strategy-package');
  await cp(source, packagePath, { recursive: true });
  const installed = await main.plugins.install({ path: packagePath });
  assert.equal(installed.plugin.id, 'sesame/auto-factor-mining');
  assert.equal(installed.plugin.state, 'discoverable');
  await main.plugins.setEnabled('sesame/auto-factor-mining', true, { scope: 'session' });
  const paths = ['references/research-guide.md', 'references/factor-method.md', 'references/strategy-evidence.md',
    'scripts/reference-experiment.mjs', 'scripts/reference-factor.mjs',
    ...['plan', 'timing', 'trials', 'input'].map(name => `examples/reference-strategy/${name}.demo.json`),
    ...['plan', 'development', 'holdout'].map(name => `examples/reference-factor/${name}.demo.json`)];
  const copied = join(runtime.workspaces.root('conv_main'), 'reference-checks');
  for (const path of paths) {
    const result = main.plugins.read('sesame/auto-factor-mining', { part: 'resource', path });
    assert.equal(result.content, await readFile(join(source, path), 'utf8'));
    const target = join(copied, path); await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, result.content);
  }
  for (const id of ['sesame/factor-research', 'sesame/strategy-research']) assert.throws(() => main.plugins.read(id, { part: 'status' }), { code: 'plugin_not_found' });
  assert.throws(() => main.plugins.read('sesame/auto-factor-mining', { part: 'resource', path: 'scripts/factor.mjs' }), { code: 'NOT_FOUND' });
  const run = args => {
    const result = spawnSync(process.execPath, args, { cwd: copied, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout && JSON.parse(result.stdout);
  };
  for (const args of [['plan', 'plan'], ['timing', 'plan', 'timing'], ['ledger', 'plan', 'trials']]) {
    const result = run(['scripts/reference-experiment.mjs', args[0], ...args.slice(1).map(name => `examples/reference-strategy/${name}.demo.json`)]);
    assert.equal(result.provenance, 'demo'); assert.equal(result.nativeEngineExecuted, false);
  }
  const plan = 'examples/reference-factor/plan.demo.json';
  run(['scripts/reference-factor.mjs', 'screen', plan, 'examples/reference-factor/development.demo.json', '--out', 'screen.json']);
  run(['scripts/reference-factor.mjs', 'select', plan, 'screen.json', 'rank_signal', '--out', 'selection.json']);
  run(['scripts/reference-factor.mjs', 'holdout', plan, 'examples/reference-factor/holdout.demo.json', 'screen.json', 'selection.json', '--out', 'holdout.json']);
  const result = JSON.parse(await readFile(join(copied, 'holdout.json'), 'utf8'));
  assert.equal(result.selected.factor, 'rank_signal'); assert.equal(result.otherCandidatesEvaluated, false);
  await close(); await open();
  assert.equal(main.plugins.read('sesame/auto-factor-mining', { part: 'status' }).loaded, true);
  assert.equal(main.plugins.read('sesame/auto-factor-mining', { part: 'resource', path: 'scripts/reference-factor.mjs' }).content, await readFile(join(source, 'scripts/reference-factor.mjs'), 'utf8'));
  assert.equal(requests, 0, 'No external source or model request was made');
});
