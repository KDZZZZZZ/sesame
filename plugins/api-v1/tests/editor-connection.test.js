import { mt5Import, mt5Path, hostForStore } from './mt5-host.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './mt5-host.js';
const { MT5Official } = await mt5Import('official.js');
const { editorTools } = await mt5Import('editor-connection.js');

test('MetaEditor starts on demand with broad system/trading plugins disabled, deduplicates startup and waits for HTTP readiness', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'editor-connection-')), store = new Store(directory);
  const token = 'editor-test-key', calls = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks)); calls.push(request.method);
    if (request.method.startsWith('notifications/')) { res.writeHead(202); res.end(); return; }
    const result = request.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'Editor fixture', version: '1' } }
      : request.method === 'tools/list' ? { tools: [{ name: 'compile_file', inputSchema: { type: 'object' } }] } : { content: [], structuredContent: { workspace: {} } };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const native = { directory, dataDirectory: directory }, official = await new MT5Official(hostForStore(store), native).init();
  official.policy = plugin => ({ state: ['mt5-trading', 'mt5-system'].includes(plugin) ? 'disabled' : 'discoverable' });
  const url = `http://127.0.0.1:${port}/mcp`;
  await official.configure({ expected_version: official.config.version, allow_trading: false, allow_host_operations: false, servers: { metaeditor: { url, token, enabled: true } } });
  await mkdir(join(directory, 'config')); await writeFile(join(directory, 'config/assistant.ini'), `[MCP.MetaEditor]\nEnable=1\nEndpoint=${url}\n`);
  t.after(async () => { await official.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); await rm(directory, { recursive: true, force: true }); });
  assert.equal(official.plugin('launcher', 'start_editor'), 'sesame/mt5');
  assert.equal((await official.catalog()).items.find(s => s.server === 'metaeditor').status, 'not_running');
  let starts = 0;
  const options = { pollMs: 5, startEditor: async (_native, tool, args) => { starts++; assert.equal(tool, 'start_editor'); assert.equal(args.portable, true); await new Promise(resolve => setTimeout(resolve, 10)); await new Promise(resolve => server.listen(port, '127.0.0.1', resolve)); } };
  const lists = await Promise.all([editorTools(official, undefined, options), editorTools(official, undefined, options)]);
  assert.equal(starts, 1); assert.ok(lists.every(list => list[0].name === 'compile_file'));
  assert.equal(official.config.allow_trading, false); assert.equal(official.config.allow_host_operations, false);
  await editorTools(official, undefined, options); assert.equal(starts, 1);
  assert.ok(!calls.includes('compile_file'), 'readiness probes only discover tools, never execute a strategy');
});

test('editor startup respects disabled plugin/service, custom endpoints, cancellation and authentication errors', async () => {
  let starts = 0, blocked = null, failure = Object.assign(new Error('offline'), { code: 'ECONNREFUSED' });
  const official = { native: {}, config: { version: 1, servers: { metaeditor: { enabled: true, url: 'http://127.0.0.1:22345/mcp' } } }, access: () => ({ blocked_reason: blocked }), client: () => ({ list: async () => { throw failure; } }) };
  let native = { enabled: true, url: 'http://127.0.0.1:22345/mcp' };
  const options = { readSettings: async () => ({ servers: { metaeditor: native } }), startEditor: () => { starts++; } };
  blocked = 'disabled plugin'; await assert.rejects(editorTools(official, undefined, options), /disabled plugin/);
  blocked = null; native = { ...native, enabled: false }; await assert.rejects(editorTools(official, undefined, options), /服务未运行/);
  native = { ...native, enabled: true, url: 'http://127.0.0.1:33333/mcp' }; await assert.rejects(editorTools(official, undefined, options), /服务未运行/);
  failure = Object.assign(new Error('HTTP 401'), { upstreamStatus: 401 }); await assert.rejects(editorTools(official, undefined, options), /401/);
  await assert.rejects(editorTools(official, AbortSignal.abort(new Error('canceled')), options), /canceled/);
  assert.equal(starts, 0);
});
