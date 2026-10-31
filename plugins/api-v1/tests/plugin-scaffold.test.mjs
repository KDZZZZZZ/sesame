import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scaffold, writeDraft, createNativeDraft, TEMPLATE_DETAILS } from '../packages/plugin-manager/scaffold.js';

const run = promisify(execFile), cli = fileURLToPath(new URL('../packages/plugin-manager/scripts/create-plugin.mjs', import.meta.url));
const input = { name: 'research-note', publisher: 'fixture', description: 'Turn "notes" into conclusions.\nPreserve sources.' };
const templates = ['native', 'skill', 'knowledge', 'function', 'adapter', 'workflow', 'service'];
const temporary = async t => {
  const root = await mkdtemp(join(tmpdir(), 'sesame-scaffold-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};

test('external CLI creates exactly the shared native and instruction-only recipes, with no host or SDK', async t => {
  const root = await temporary(t);
  for (const template of ['native', 'skill']) {
    const output = join(root, template);
    const { stdout } = await run(process.execPath, [cli, '--name', input.name, '--publisher', input.publisher, '--description', input.description, '--template', template, '--output', output], { cwd: root, env: { ...process.env, NODE_OPTIONS: '' } });
    const result = JSON.parse(stdout), recipe = scaffold({ ...input, template });
    assert.equal(result.id, 'fixture/research-note');
    for (const [path, content] of Object.entries(recipe.files)) assert.equal(await readFile(join(output, path), 'utf8'), content, path);
    await run(process.execPath, ['--check', join(output, 'index.js')]);
    const { createCapabilities } = await import(pathToFileURL(join(output, 'index.js')));
    if (template === 'skill') assert.deepEqual(createCapabilities(), []);
  }
});

test('creation refuses existing directories and symlinks without changing contents', async t => {
  const root = await temporary(t), output = join(root, 'draft');
  await writeDraft(output, scaffold(input));
  await writeFile(join(output, 'README.md'), 'Author edits');
  await assert.rejects(writeDraft(output, scaffold(input)), { code: 'EEXIST' });
  assert.equal(await readFile(join(output, 'README.md'), 'utf8'), 'Author edits');
  await mkdir(join(root, 'empty'));
  await assert.rejects(writeDraft(join(root, 'empty'), scaffold(input)), { code: 'EEXIST' });
  await symlink(output, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(writeDraft(join(root, 'link'), scaffold(input)), { code: 'EEXIST' });
  assert.equal(await readFile(join(output, 'README.md'), 'utf8'), 'Author edits');
});

test('invalid identities, versions and CLI arguments cannot create drafts', async t => {
  const root = await temporary(t);
  for (const bad of [{ name: '../escape' }, { name: 'con' }, { name: 'a'.repeat(65) }, { publisher: 'Wrong Name' }, { version: '01.0.0' }, { min_host: 'latest' }, { description: ' ' }, { template: 'unknown' }]) assert.throws(() => scaffold({ ...input, ...bad }));
  for (const args of [['--output'], ['--output', join(root, 'missing-name')], ['--name', 'sample', '--name', 'duplicate'], ['--unknown', 'value']]) {
    await assert.rejects(run(process.execPath, [cli, ...args], { cwd: root }), error => error.code === 1 && !error.stdout.trim());
  }
  assert.deepEqual(await readdir(root), []);
  const long = JSON.parse(scaffold({ ...input, name: 'a'.repeat(64) }).files['capabilities.json']).capabilities[0].id;
  assert.ok(long.length <= 64, 'generated names fit common model tool-name limits');
  assert.notEqual(JSON.parse(scaffold(input).files['capabilities.json']).capabilities[0].id, JSON.parse(scaffold({ ...input, publisher: 'other' }).files['capabilities.json']).capabilities[0].id);
});

test('invalid paths and canceled/failed writes leave no draft or escaped files', async t => {
  const root = await temporary(t), output = join(root, 'draft'), recipe = scaffold(input);
  for (const name of ['../escape', '/absolute', 'C:/escape', 'a\\escape', 'skills/con/SKILL.md']) await assert.rejects(writeDraft(output, { ...recipe, files: { [name]: 'x' } }), /portable relative paths/);
  await assert.rejects(writeDraft(output, { ...recipe, files: { 'A.md': 'x', 'a.md': 'y' } }), /case-insensitive/);
  await assert.rejects(writeDraft(output, recipe, AbortSignal.abort()), { name: 'AbortError' });
  await assert.rejects(writeDraft(output, { ...recipe, files: { 'first.txt': 'partial', collision: 'file', 'collision/child': 'cannot write' } }));
  assert.deepEqual(await readdir(root), []);
});

test('managed native drafts reject non-main scope before accessing files or storage', async () => {
  for (const kind of ['subagent', 'service']) await assert.rejects(createNativeDraft({ context: { kind } }, input), /Only the main Agent/);
});

test('functional templates keep portable entries, explicit knowledge, truthful execution and cancellation', async t => {
  const root = await temporary(t);
  for (const template of templates) {
    const recipe = scaffold({ ...input, template });
    const declaration = JSON.parse(recipe.files['capabilities.json']);
    for (const resource of declaration.knowledge) assert.equal(typeof recipe.files[resource.path], 'string', resource.path);
    const output = join(root, template);
    await writeDraft(output, recipe);
    const { createCapabilities } = await import(pathToFileURL(join(output, 'index.js')));
    const capabilities = createCapabilities({});
    assert.deepEqual(capabilities.map(item => item.name), declaration.capabilities.map(item => item.binding.name));
    if (['skill', 'knowledge'].includes(template)) {
      assert.deepEqual(capabilities, []);
      if (template === 'knowledge') assert.ok(recipe.files[`skills/${input.name}/references/validation.md`]);
      continue;
    }
    const execute = (...args) => Promise.resolve().then(() => capabilities[0].execute(...args));
    if (template === 'native') assert.deepEqual(await execute({ text: 'hello' }), { text: 'hello' });
    else if (template === 'function') {
      assert.deepEqual(await execute({ values: [1, 2, 3] }), { total: 6 });
      await assert.rejects(execute({ values: [Number.MAX_VALUE, Number.MAX_VALUE] }), RangeError);
    }
    else await assert.rejects(execute({}), { code: 'NOT_IMPLEMENTED' });
    await assert.rejects(execute({}, AbortSignal.abort()), { name: 'AbortError' });
    assert.equal(declaration.capabilities[0].execution, template === 'workflow' ? 'run' : 'immediate');
    assert.equal(declaration.capabilities[0].kind, template === 'workflow' ? 'workflow' : 'function');
    if (template !== 'native') assert.ok(Object.keys(recipe.files).some(path => path.startsWith('src/')));
  }
});

test('CLI exposes each functional template and documents the actual install operation', async t => {
  const root = await temporary(t);
  const { stdout: help } = await run(process.execPath, [cli, '--help']);
  assert.doesNotMatch(help, /plugin_validate|plugin_test|plugin_load/);
  for (const template of ['knowledge', 'function', 'adapter', 'workflow', 'service']) {
    assert.ok(help.includes(template));
    const output = join(root, template);
    const { stdout } = await run(process.execPath, [cli, '--name', input.name, '--description', input.description, '--template', template, '--output', output], { cwd: root });
    assert.equal(JSON.parse(stdout).template, template);
  }
});

test('legacy template aliases remain explicit without changing their original example contracts', () => {
  assert.equal(TEMPLATE_DETAILS.native.aliasFor, 'function');
  assert.equal(TEMPLATE_DETAILS.skill.aliasFor, 'knowledge');
  assert.equal(JSON.parse(scaffold(input).files['plugin.json']).engines.sesame, '>=0.3.0-dev.1 <0.4.0');
  assert.equal(JSON.parse(scaffold({ ...input, min_host: '1.0.0' }).files['plugin.json']).engines.sesame, '>=1.0.0', 'explicit author overrides retain their original minimum-only semantics');
  for (const template of templates) {
    const recipe = scaffold({ ...input, template });
    assert.deepEqual(JSON.parse(recipe.files['plugin.json']).permissions, { scopes: [], calls: [] });
    assert.ok(recipe.files['README.md'].includes(TEMPLATE_DETAILS[template].note));
    assert.match(recipe.files['README.md'], /Declared local scopes are enabled by default/);
    assert.match(recipe.files['README.md'], /saved user permission choices persist across updates/);
    assert.match(recipe.files['README.md'], /External messages\.ingress scopes require separate local authorization/);
  }
  assert.deepEqual(JSON.parse(scaffold(input).files['capabilities.json']).capabilities[0].inputSchema.required, ['text']);
  assert.deepEqual(JSON.parse(scaffold({ ...input, template: 'function' }).files['capabilities.json']).capabilities[0].inputSchema.required, ['values']);
  assert.deepEqual(JSON.parse(scaffold({ ...input, template: 'skill' }).files['capabilities.json']).capabilities, []);
});

test('root package permission requests are validated, normalized and covered by the package digest', { skip: !process.env.SESAME_HOST_ROOT }, async () => {
  const { inspectPackage } = await import(pathToFileURL(join(process.env.SESAME_HOST_ROOT, 'modules/agent/plugin-system/package.js')));
  const recipe = scaffold(input), manifest = JSON.parse(recipe.files['plugin.json']);
  const inspect = permissions => {
    const files = { ...recipe.files, 'plugin.json': JSON.stringify({ ...manifest, permissions }) };
    return inspectPackage(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, Buffer.from(text)])));
  };
  const absent = inspect(undefined);
  assert.deepEqual(absent.permissions, { scopes: [], calls: [] });
  const requested = { scopes: ['application.configure'], calls: ['host.resources.read', 'fixture/source#read', { pluginId: 'fixture/source', serviceId: 'market', operation: 'query' }] };
  const entry = inspect(requested);
  assert.deepEqual(entry.permissions, requested);
  assert.notEqual(entry.digest, absent.digest, 'root permissions must remain in the tree digest');
  assert.notEqual(entry.digest, inspect({ ...requested, scopes: ['plugins.manage'] }).digest);
  assert.equal(entry.granted, undefined, 'a request is not host grant storage');
  for (const permissions of [
    null, [], {}, { scopes: [] }, { calls: [] },
    { scopes: ['unknown'], calls: [] }, { scopes: ['plugins.manage', 'plugins.manage'], calls: [] },
    { scopes: [], calls: ['host.*'] }, { scopes: [], calls: ['fixture/source#*'] },
    { scopes: [], calls: ['fixture/../source#read'] }, { scopes: [], calls: ['host.resources.read\n'] },
    { scopes: [], calls: ['host.resources.read', 'host.resources.read'] },
    { scopes: [], calls: [{ pluginId: 'fixture/source' }] },
    { scopes: [], calls: [{ pluginId: 'fixture/source', serviceId: 123, operation: 'read' }] },
    { scopes: [], calls: [{ pluginId: 'fixture/source', serviceId: 'market', operation: '*' }] },
    { scopes: [], calls: [{ pluginId: 'fixture/source', serviceId: 'market', operation: 'read', grant: true }] },
    { scopes: [], calls: [{ pluginId: 'fixture/source', serviceId: 'market', operation: 'read' }, { operation: 'read', serviceId: 'market', pluginId: 'fixture/source' }] },
    { scopes: [], calls: [], grants: ['plugins.manage'] },
  ]) assert.throws(() => inspect(permissions), error => error.code === 'invalid_plugin_permissions', JSON.stringify(permissions));
});

test('all template declarations pass the real API 2 schema and binding validators', { skip: !process.env.SESAME_HOST_ROOT }, async t => {
  const root = await temporary(t);
  const hostRoot = process.env.SESAME_HOST_ROOT;
  await import(pathToFileURL(join(hostRoot, 'modules/plugins/sdk-loader.js')));
  const { validateCapabilityManifest, validateCapabilityBindings } = await import(pathToFileURL(join(hostRoot, 'modules/plugins/capability-contract.js')));
  const { inspectPackage } = await import(pathToFileURL(join(hostRoot, 'modules/agent/plugin-system/package.js')));
  for (const template of templates) {
    const recipe = scaffold({ ...input, template });
    const packageEntry = inspectPackage(Object.fromEntries(Object.entries(recipe.files).map(([path, text]) => [path, Buffer.from(text)])));
    assert.equal(packageEntry.id, recipe.id);
    assert.deepEqual(packageEntry.permissions, { scopes: [], calls: [] });
    assert.match(recipe.files['README.md'], new RegExp(`Implementation responsibility: ${TEMPLATE_DETAILS[template].implementation}`));
    const declaration = JSON.parse(recipe.files['capabilities.json']);
    const checked = await validateCapabilityManifest(declaration, { pluginId: recipe.id, files: recipe.files });
    assert.equal(checked.valid, true, `${template}: ${JSON.stringify(checked.diagnostics)}`);
    const path = join(root, template);
    await writeDraft(path, recipe);
    const { createCapabilities } = await import(pathToFileURL(join(path, 'index.js')));
    const bindings = validateCapabilityBindings(declaration, createCapabilities({}).map(item => ({ id: item.name, binding: { type: 'native', name: item.name } })), { pluginId: recipe.id });
    assert.equal(bindings.valid, true, `${template}: ${JSON.stringify(bindings.diagnostics)}`);
  }
});
