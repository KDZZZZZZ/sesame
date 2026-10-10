import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, cpSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const packages = fileURLToPath(new URL('../../optional-api-v1/packages/', import.meta.url));
for (const name of ['web-extract', 'rss-collect', 'market-data-parser']) {
  test(`${name}: aliased package roots read bundled samples while external paths and symlinks remain rejected`, { skip: process.platform === 'win32' ? 'This filesystem alias regression uses POSIX symlinks; Windows native path behavior has not been validated.' : false }, t => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sesame-mcp-root-'))); t.after(() => rmSync(root, { recursive: true, force: true }));
    const real = join(root, 'real'), alias = join(root, 'alias'), outside = join(root, 'outside');
    mkdirSync(real); mkdirSync(outside); cpSync(join(packages, name), join(real, name), { recursive: true }); symlinkSync(real, alias, 'dir');
    const source = join(real, name), manifest = JSON.parse(readFileSync(join(source, 'plugin.json')));
    const sample = manifest.extensions['bot.sesame'].tests.find(item => item.arguments.file_path); assert.ok(sample);
    const external = join(outside, 'external-data'); writeFileSync(external, readFileSync(join(source, sample.arguments.file_path)));
    symlinkSync(external, join(source, 'escape-file')); symlinkSync(outside, join(source, 'escape-directory'), 'dir');
    const operations = [sample.arguments, { file_path: external }, { file_path: '../../outside/external-data' }, { file_path: 'escape-file' }, { file_path: 'escape-directory/external-data' }].map((args, index) => ({ jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name: sample.tool, arguments: args } }));
    const run = spawnSync('python3', ['-I', join(alias, name, 'server.py')], { cwd: join(alias, name), encoding: 'utf8', env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' }, timeout: 10000, maxBuffer: 1024 * 1024, input: operations.map(item => JSON.stringify(item)).join('\n') + '\n' });
    assert.equal(run.status, 0, run.stderr); const responses = run.stdout.trim().split('\n').map(line => JSON.parse(line)); assert.equal(responses.length, operations.length);
    assert.equal(responses[0].result.isError, false); assert.deepEqual(responses[0].result.structuredContent, sample.expected);
    for (const response of responses.slice(1)) { assert.equal(response.result.isError, true); assert.match(response.result.structuredContent.error, /relative to the plugin package/); }
  });
}
