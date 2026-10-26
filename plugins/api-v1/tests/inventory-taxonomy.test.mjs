import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInventory } from '../scripts/inventory.mjs';
import { engineWithinProfile } from '../scripts/plugin-lock.mjs';
import { FUNCTIONAL_CATEGORIES, IMPLEMENTATION_KINDS, validateInventoryPolicy, deriveImplementationKinds } from '../scripts/plugin-taxonomy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const policy = JSON.parse(readFileSync(join(root, 'inventory-policy.json')));

test('task responsibility groups guides with workflows and knowledge with reusable analysis independently of implementation', () => {
  const byId = Object.fromEntries(buildInventory().packages.map(item => [item.id, item]));
  for (const name of ['ict', 'price-action', 'abu-trend', 'factor-evaluator', 'strategy-authoring', 'web-extract', 'rss-collect', 'market-data-parser']) {
    assert.equal(byId[`sesame/${name}`].functionalCategory, 'analysis', name);
  }
  for (const name of ['factor-research', 'strategy-research', 'auto-factor-mining', 'investment-research', 'trading-decision', 'portfolio-execution', 'judgment-evolution', 'kurumi-replay', 'ultra']) {
    assert.equal(byId[`sesame/${name}`].functionalCategory, 'business', name);
  }
  for (const name of ['mt5', 'qmt', 'binance', 'web-sources', 'financial-research', 'backtrader', 'vnpy', 'data-access', 'quantskills-catalog']) {
    assert.equal(byId[`sesame/${name}`].functionalCategory, 'integration', name);
  }
  for (const name of ['canvas-control', 'reports']) assert.equal(byId[`sesame/${name}`].functionalCategory, 'presentation', name);
  for (const name of ['configuration', 'plugin-manager', 'workspace', 'memory', 'orchestration', 'user-guide']) assert.equal(byId[`sesame/${name}`].functionalCategory, 'platform', name);
  assert.deepEqual(byId['sesame/ict'].implementationKinds, ['knowledge']);
  assert.deepEqual(byId['sesame/factor-research'].implementationKinds, ['knowledge']);
  assert.deepEqual(byId['sesame/auto-factor-mining'].implementationKinds, ['workflow']);
  assert.deepEqual(byId['sesame/abu-trend'].implementationKinds, ['function']);
});

test('all 59 plugins have one reviewed functional group and valid implementation kinds without replacing legacy categories', () => {
  const inventory = buildInventory();
  assert.equal(inventory.packages.length, 59);
  assert.equal(new Set(inventory.packages.map(item => item.id)).size, 59);
  assert.deepEqual(inventory.taxonomy, { functionalCategories: FUNCTIONAL_CATEGORIES, implementationKinds: IMPLEMENTATION_KINDS });
  const counts = field => Object.fromEntries([...new Set(inventory.packages.map(item => item[field]))].sort().map(value => [value, inventory.packages.filter(item => item[field] === value).length]));
  assert.deepEqual(counts('functionalCategory'), { analysis: 31, business: 9, integration: 11, platform: 6, presentation: 2 });
  assert.deepEqual(counts('category'), { backend: 7, data: 6, research: 33, strategy: 6, workspace: 7 });
  for (const item of inventory.packages) {
    assert.equal(item.category, policy[item.id.slice('sesame/'.length)].category);
    assert.ok(item.implementationKinds.length > 0);
    for (const kind of item.implementationKinds) assert.ok(IMPLEMENTATION_KINDS.some(entry => entry.id === kind));
  }
  const byId = Object.fromEntries(inventory.packages.map(item => [item.id, item]));
  assert.deepEqual(byId['sesame/ict'].implementationKinds, ['knowledge']);
  assert.deepEqual(byId['sesame/mt5'].implementationKinds, ['adapter']);
  assert.deepEqual(byId['sesame/binance'].implementationKinds, ['adapter']);
  assert.deepEqual(byId['sesame/investment-research'].implementationKinds, ['workflow']);
  assert.deepEqual(byId['sesame/ultra'].implementationKinds, ['workflow', 'service']);
  assert.deepEqual(byId['sesame/orchestration'].implementationKinds, ['knowledge']);
  assert.deepEqual(byId['sesame/user-guide'].implementationKinds, ['knowledge']);
});

test('inventory projects current declared abilities and versions, including research follow-up questions', () => {
  const inventory = buildInventory();
  for (const item of inventory.packages) {
    const directory = join(root, '../..', item.sourcePath);
    const manifest = JSON.parse(readFileSync(join(directory, 'plugin.json')));
    const declaration = JSON.parse(readFileSync(join(directory, manifest.capability_manifest)));
    assert.equal(item.version, manifest.version);
    assert.deepEqual(item.permissions, manifest.permissions ?? { scopes: [], calls: [] });
    assert.deepEqual(item.tools, declaration.capabilities.filter(capability => capability.consumers.includes('agent')).map(capability => capability.id));
    assert.deepEqual(item.capabilities, declaration.capabilities.map(({ id, kind, consumers, execution }) => ({ id, kind, consumers, execution })));
  }
  assert.ok(inventory.packages.find(item => item.id === 'sesame/investment-research').tools.includes('investment_research_ask'));
});

test('remediation version pairs exceed documented installed QA floors without reading live state', () => {
  // Frozen facts from 发布-dev-本地差异与测试修改汇总-20261021.md, sections 4/7.
  // These are installed-version floors, not expected current-source versions.
  // Keeping them in the test makes clean checkouts independent of local reports
  // and AppData; changing implementation bytes must not reuse these versions.
  const installed = [
    ['api-v1', 'data-access', '3.0.1'],
    ['api-v1', 'memory', '3.1.1'],
    ['api-v1', 'workspace', '3.0.1'],
    ['optional-api-v1', 'judgment-evolution', '3.0.2'],
    ['optional-api-v1', 'quantskills-catalog', '3.0.1'],
    ['optional-api-v1', 'vnpy', '2.0.3'],
  ];
  const newer = (candidate, floor) => candidate !== floor && engineWithinProfile(`>=${candidate}`, `>=${floor}`);
  assert.equal(newer('3.0.1', '3.0.1'), false, 'reusing an installed label must fail');
  assert.equal(newer('2.0.2', '2.0.3'), false, 'a source label below the installed version must fail');
  for (const [distribution, name, floor] of installed) {
    const directory = join(root, '..', distribution, 'packages', name);
    const manifest = JSON.parse(readFileSync(join(directory, 'plugin.json')));
    const npm = JSON.parse(readFileSync(join(directory, 'package.json')));
    assert.equal(npm.version, manifest.version, `${name}: paired version files differ`);
    assert.equal(newer(manifest.version, floor), true, `${name}: source ${manifest.version} must exceed known installed ${floor}`);
  }
});

test('configuration readers and workflow probes explicitly declare truthful read-only effects', () => {
  for (const [name, id, effects] of [
    ['financial-research', 'financial_research_status', ['state.read']],
    ['trading-decision', 'trading_decision_workflow_dependencies', ['read']],
    ['auto-factor-mining', 'auto_factor_dependencies', ['read']],
  ]) {
    const declaration = JSON.parse(readFileSync(join(root, '../optional-api-v1/packages', name, 'capabilities.json')));
    const capability = declaration.capabilities.find(item => item.id === id);
    assert.equal(capability.kind, 'function');
    assert.equal(capability.execution, 'immediate');
    assert.deepEqual(capability.effects, effects, id);
    assert.deepEqual(capability.configurationRequirements ?? [], [], 'configuration reads/probes cannot require the configuration they inspect');
    if (name === 'financial-research') {
      assert.equal(declaration.configuration.fields.length, 5);
      assert.ok(declaration.configuration.fields.every(field => field.binding.read === id));
    }
  }
});

test('permission requests follow actual privileged ports, not category or native subprocess labels', () => {
  const expectedScopes = {
    ultra: ['capabilities.compose'],
    'canvas-control': ['capabilities.compose'], configuration: ['application.configure'], 'data-access': ['capabilities.compose'], memory: ['workspace.messages.read'], 'plugin-manager': ['plugins.manage'], workspace: ['process.execute'],
    'auto-factor-mining': ['capabilities.compose', 'plugins.manage'], backtrader: ['process.execute'], ccxt: ['process.execute'], 'financial-research': ['application.configure'], 'investment-research': ['capabilities.compose'],
    'judgment-evolution': ['capabilities.compose', 'workspace.messages.read'], 'kurumi-replay': ['plugins.manage', 'workspace.messages.read'], 'market-data-parser': ['process.execute'], mt5: ['workspace.messages.read'], 'rss-collect': ['process.execute'], 'trading-decision': ['capabilities.compose'], vnpy: ['process.execute'], 'web-extract': ['process.execute'],
  };
  const packages = buildInventory().packages, byId = new Map(packages.map(item => [item.id, item]));
  for (const item of packages) {
    assert.deepEqual(item.permissions.scopes, expectedScopes[item.id.slice('sesame/'.length)] ?? [], item.id);
    assert.equal(Object.hasOwn(item.permissions, 'granted'), false);
    for (const call of item.permissions.calls) if (typeof call === 'object') {
      const target = byId.get(call.pluginId);
      assert.ok(target, `Unknown selected plugin ${call.pluginId}`);
      const service = target.hostContributions.services.find(item => item.id === call.serviceId);
      assert.ok(service?.operations?.[call.operation], `Unknown selected service operation ${JSON.stringify(call)}`);
    }
  }
  // Report publication and template authoring have two fixed native cross-package
  // calls; neither requires a blanket composition scope or an automatic grant.
  const reports = byId.get('sesame/reports');
  assert.deepEqual(reports.permissions.scopes, []);
  assert.deepEqual(reports.permissions.calls, ['host.artifacts.query', 'host.records.query', 'sesame/data-access#data_snapshot', 'sesame/workspace#write']);
  // Portfolio supports exactly the declared MT5/QMT adapter services, not any
  // dynamically selected publisher. Raw SDK subprocesses are not host.exec.
  const portfolio = byId.get('sesame/portfolio-execution');
  assert.deepEqual(portfolio.permissions.scopes, []);
  assert.equal(portfolio.permissions.calls.filter(call => typeof call === 'object').length, 14);
  assert.deepEqual(portfolio.permissions.calls.filter(call => typeof call === 'string'), ['sesame/mt5#mt5_trading_pause']);
  for (const id of ['sesame/mt5', 'sesame/qmt']) assert.equal(byId.get(id).permissions.scopes.includes('process.execute'), false);
});

test('minimal implementation comes from exposed declarations, not scripts, effects, duration or authority', () => {
  const manifest = { id: 'fixture/example', execution: 'native', entry: 'index.js' };
  const declaration = { capabilities: [], sources: [], services: [], views: [], hooks: [], knowledge: [{ path: 'scripts/observe.py' }] };
  const files = ['index.js', 'scripts/observe.py', 'reference.js'];
  assert.deepEqual(deriveImplementationKinds(manifest, declaration, files), ['knowledge']);
  assert.throws(() => deriveImplementationKinds(manifest, declaration, files, { implementationKinds: ['function'], implementationReason: 'A reference script exists but is not an exposed operation.' }), /cannot create or hide/);
  const functionDeclaration = { ...declaration, capabilities: [{ kind: 'function', execution: 'run', effects: ['process'], binding: { type: 'native', name: 'calculate' } }], stateCollections: [{ name: 'receipts' }] };
  assert.deepEqual(deriveImplementationKinds({ ...manifest, permissions: { scopes: ['capabilities.compose'], calls: [] } }, functionDeclaration, files), ['function']);
  assert.throws(() => deriveImplementationKinds(manifest, functionDeclaration, ['scripts/observe.py']), /packaged entry/);
  assert.throws(() => deriveImplementationKinds(manifest, functionDeclaration, files, { implementationKinds: ['service'] }), /implementationReason/);
  assert.deepEqual(deriveImplementationKinds(manifest, functionDeclaration, files, { implementationKinds: ['service'], implementationReason: 'The functions adapt a host-owned persistent service.' }), ['service']);
  assert.deepEqual(deriveImplementationKinds(manifest, { ...functionDeclaration, hooks: [{ id: 'dispose' }] }, files), ['service']);
  assert.deepEqual(deriveImplementationKinds(manifest, { ...functionDeclaration, sources: [{ id: 'market' }], services: [{ id: 'execution' }], hooks: [{ id: 'dispose' }] }, files), ['adapter']);
  const workflow = { ...functionDeclaration, capabilities: [{ ...functionDeclaration.capabilities[0], kind: 'workflow' }] };
  assert.deepEqual(deriveImplementationKinds(manifest, workflow, files), ['workflow']);
  assert.throws(() => deriveImplementationKinds(manifest, workflow, files, { implementationKinds: ['function'], implementationReason: 'A workflow cannot be silently described as a calculation.' }), /cannot hide a declared workflow/);
  const mcp = { ...declaration, capabilities: [{ kind: 'function', binding: { type: 'mcp' } }] };
  assert.deepEqual(deriveImplementationKinds({ ...manifest, execution: 'mcp' }, mcp, ['mcp.json']), ['adapter']);
  assert.throws(() => deriveImplementationKinds(manifest, mcp, []), /packaged server/);
});

test('reviewed classification rejects stale coverage, unknown values and metadata that could override source identity', () => {
  const names = Object.keys(policy), example = names[0];
  assert.doesNotThrow(() => validateInventoryPolicy(policy, names));
  assert.throws(() => validateInventoryPolicy(policy, [...names, example]), /Duplicate package/);
  assert.throws(() => validateInventoryPolicy(policy, names.slice(1)), /absent packages/);
  assert.throws(() => validateInventoryPolicy(policy, [...names, 'new-plugin']), /Missing reviewed package/);
  for (const change of [{ functionalCategory: 'unknown' }, { functionalCategory: 'research' }, { implementationKinds: [] }, { implementationKinds: ['adapter', 'adapter'] }, { implementationKinds: ['native'] }, { category: 'unknown' }, { id: 'sesame/override' }]) {
    assert.throws(() => validateInventoryPolicy({ ...policy, [example]: { ...policy[example], ...change } }, names), /category|classification|implementation|Unknown policy/);
  }
});
