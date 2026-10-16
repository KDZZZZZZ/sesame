import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { execute } from '../worker.js';
import { createCapabilities } from '../index.js';
import declaration from '../capabilities.json' with { type: 'json' };

async function context(t) {
    const storageRoot = await mkdtemp(join(tmpdir(), 'sesame-akshare-test-'));
    t.after(() => rm(storageRoot, { recursive: true, force: true }));
    return { context: { storageRoot, pythonPath: join(storageRoot, 'controlled-python-fixture') } };
}

// Only the native Python process is simulated. API 2 capabilities, worker routing,
// private files, environment selection and query projection run their real code.
function nativePython(t, host, rows = []) {
    const calls = [];
    const spawn = t.mock.method(childProcess, 'spawn', (executable, args, options) => {
        assert.equal(executable, host.context.pythonPath);
        assert.equal(options.cwd, host.context.storageRoot);
        assert.ok(args.includes('-B') && args.includes('-I'));
        assert.ok(!args.includes('pip') && !args.includes('venv'), 'existing environments must never be installed or upgraded');
        const record = { executable, args, input: null }; calls.push(record);
        const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
        let input = '';
        child.stdin = new Writable({ write(chunk, _encoding, done) { input += chunk.toString(); done(); }, final(done) {
            queueMicrotask(() => {
                const code = args.at(-1); let result;
                if (code.includes('struct')) result = { version: [3, 13, 0], bits: 64, platform: process.platform, arch: process.arch };
                else if (code.includes('import akshare')) result = { python: host.context.pythonPath, version: '1.19.1' };
                else {
                    assert.match(code, /bridge\.py$/);
                    record.input = JSON.parse(input);
                    result = { ok: true, observedAt: 1728000000000, akshareVersion: '1.19.1', interface: record.input.interface, rows };
                }
                child.stdout.end(JSON.stringify(result)); child.stderr.end(); child.emit('close', 0);
            });
            done();
        } });
        return child;
    });
    syncBuiltinESMExports();
    t.after(() => { spawn.mock.restore(); syncBuiltinESMExports(); });
    return calls;
}

test('API 2 capability discovery and source binding never initialize/download Python dependencies', async t => {
    const host = await context(t), calls = nativePython(t, host), capabilities = createCapabilities(host);
    assert.deepEqual(capabilities.map(item => item.name).sort(), declaration.capabilities.map(item => item.binding.name).sort());
    const call = (name, args = {}) => capabilities.find(item => item.name === name).execute(args);
    const catalog = await call('akshare_catalog');
    assert.equal(catalog.provider.pluginId, 'sesame/akshare');
    const binding = await call('market_bind', { binding: {} });
    assert.equal(binding.sourceIds[0], 'akshare:eastmoney:a-share');
    await call('market_unbind', { binding });
    assert.deepEqual(await call('akshare_dispose'), { closed: true });
    assert.equal(calls.length, 0);
    assert.deepEqual(await readdir(host.context.storageRoot), []);
});

test('offline missing environment and unsupported executable fail honestly', async t => {
    const host = await context(t), directory = host.context.storageRoot, pythonPath = join(directory, 'nonexistent-python');
    const ctx = { directory, signal: AbortSignal.timeout(3000) };
    assert.equal((await execute({ operation: 'status', pythonPath }, ctx)).ready, false);
    await assert.rejects(execute({ operation: 'query', interface: 'stock_zh_a_hist' }, ctx), /not prepared/);
    await assert.rejects(execute({ operation: 'prepare', pythonPath }, ctx), error => error.code === 'UNSUPPORTED_PLATFORM');
});

test('API 2 query uses the private storage selection and bounds research output', async t => {
    const host = await context(t), rows = Array.from({ length: 150 }, (_, i) => ({ i })), calls = nativePython(t, host, rows);
    const capabilities = createCapabilities(host), call = (name, args = {}) => capabilities.find(item => item.name === name).execute(args);
    await call('akshare_discover', { python_path: host.context.pythonPath });
    const result = await call('akshare_query', { interface: 'stock_zh_a_spot_em' });
    assert.equal(result.rows.length, 100); assert.equal(result.totalRows, 150); assert.equal(result.truncated, true);
    assert.deepEqual(result.rows, rows.slice(0, 100));
    const complete = await call('akshare_query', { interface: 'stock_zh_a_spot_em', max_rows: 200 });
    assert.equal(complete.truncated, false); assert.deepEqual(complete.rows, rows);
    const queries = calls.filter(call => call.input);
    assert.equal(queries.length, 2);
    assert.ok(queries.every(call => call.input.operation === 'query' && call.input.interface === 'stock_zh_a_spot_em'));
});

test('configured existing environment is reused without venv/pip/upgrade operations', async t => {
    const host = await context(t), calls = nativePython(t, host), capabilities = createCapabilities(host);
    const call = (name, args = {}) => capabilities.find(item => item.name === name).execute(args);
    const found = await call('akshare_discover', { python_path: host.context.pythonPath });
    assert.equal(found.ready, true); assert.equal(found.mode, 'existing-readonly');
    const prepared = await call('akshare_prepare', { python_path: host.context.pythonPath });
    assert.equal(prepared.reused, true); assert.equal(prepared.python, host.context.pythonPath);
    assert.equal(calls.length, 4, 'discovery and preparation only inspect Python and import the pinned AKShare version');
    const selection = JSON.parse(await readFile(join(host.context.storageRoot, 'akshare-python-selection.json'), 'utf8'));
    assert.equal(selection.python, host.context.pythonPath);
    assert.deepEqual(await readdir(host.context.storageRoot), ['akshare-python-selection.json']);
});
