import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scaffold, writeDraft, createNativeDraft } from '../packages/plugin-manager/scaffold.js';

const run = promisify(execFile), cli = fileURLToPath(new URL('../packages/plugin-manager/scripts/create-plugin.mjs', import.meta.url));
const input = { name: 'research-note', publisher: 'fixture', description: 'Turn "notes" into conclusions.\nPreserve sources.' };
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
    const { createTools } = await import(pathToFileURL(join(output, 'index.js')));
    if (template === 'skill') assert.deepEqual(createTools(), []);
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
  const long = JSON.parse(scaffold({ ...input, name: 'a'.repeat(64) }).files['tools.json'])[0].name;
  assert.ok(long.length <= 64, 'generated names fit common model tool-name limits');
  assert.notEqual(JSON.parse(scaffold(input).files['tools.json'])[0].name, JSON.parse(scaffold({ ...input, publisher: 'other' }).files['tools.json'])[0].name);
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
  for (const kind of ['subagent', 'service']) await assert.rejects(createNativeDraft({ scope: { kind } }, input), /Only the main Agent/);
});
