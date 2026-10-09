import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute } from '../worker.js';
import { activate, createTools } from '../index.js';
import { Type } from '@sesame/plugin-sdk/schema';
test('activation and discovery never initialize/download Python dependencies', async () => { let calls = 0, registered; const lifecycle = await activate({ providers: { register: (descriptor, implementation) => { registered = { descriptor, implementation }; return () => { calls++; }; } }, environment: { executeWorker: () => { throw Error('activation attempted environment'); } } }); assert.deepEqual(registered.descriptor.capabilities, ['instruments.search', 'instruments.describe', 'bars.history','quotes.subscribe','bars.subscribe']); await lifecycle.dispose(); assert.equal(calls, 1); });
test('offline missing environment and unsupported executable fail honestly', async (t) => { const directory = await mkdtemp(join(tmpdir(), 'sesame-akshare-test-')); t.after(() => rm(directory, { recursive: true, force: true })); const ctx = { directory, signal: AbortSignal.timeout(3000) }; assert.equal((await execute({ operation: 'status' }, ctx)).ready, false); await assert.rejects(execute({ operation: 'query', interface: 'stock_zh_a_hist' }, ctx), /not prepared/); await assert.rejects(execute({ operation: 'prepare', pythonPath: join(directory, 'nonexistent-python') }, ctx), e => e.code === 'UNSUPPORTED_PLATFORM'); });
test('tools declare matching discovery metadata and bound research output', async () => { const host = { tools: { Type, string: description => Type.String({ description }), optional: description => Type.Optional(Type.String({ description })), define: (name, description, properties, execute) => ({ name, parameters: Type.Object(properties), execute }) }, environment: { executeWorker: async () => ({ ok: true, rows: Array.from({ length: 150 }, (_, i) => ({ i })) }) } }; const tools = createTools(host), query = tools.find(t => t.name === 'akshare_query'); const result = await query.execute({ interface: 'stock_zh_a_spot_em' }); assert.equal(result.rows.length, 100); assert.equal(result.totalRows, 150); assert.equal(result.truncated, true); });

test('configured existing environment is reused without venv/pip/upgrade operations', {skip:process.platform==='win32'}, async t => {
    const directory=await mkdtemp(join(tmpdir(),'sesame-akshare-existing-'));t.after(()=>rm(directory,{recursive:true,force:true}));
    const python=join(directory,'controlled-python-fixture'),log=join(directory,'calls.jsonl');
    // Controlled executable models successful native inspect/import; no network or real package install.
    await writeFile(python,`#!/usr/bin/env node
const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+'\\n');const code=process.argv.at(-1);if(code.includes('struct'))console.log(JSON.stringify({version:[3,13,0],bits:64,platform:process.platform,arch:process.arch}));else if(code.includes('import akshare'))console.log(JSON.stringify({python:${JSON.stringify(python)},version:'1.19.1'}));else process.exit(42);
`,{mode:0o700});
    const ctx={directory,signal:AbortSignal.timeout(3000)};
    const found=await execute({operation:'discover',pythonPath:python},ctx);assert.equal(found.ready,true);assert.equal(found.mode,'existing-readonly');
    const prepared=await execute({operation:'prepare',pythonPath:python},ctx);assert.equal(prepared.reused,true);assert.equal(prepared.python,python);
    const calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.ok(calls.every(args=>args.includes('-B')&&args.includes('-I')&&!args.includes('pip')&&!args.includes('venv')));
});
