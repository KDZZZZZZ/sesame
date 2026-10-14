import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from '@sesame/plugin-sdk/schema';
import { digest } from '../../optional-api-v1/packages/mt5/backend/support.js';
import { stageFrozenBuild } from '../../optional-api-v1/packages/mt5/backend/frozen-compiler.js';
import { parseLosslessJson, stringifyLosslessJson, nativeValueForLosslessIds, assertNoUnsafeNativeIds } from '../../optional-api-v1/packages/mt5/backend/json.js';
import { MT5MCP } from '../../optional-api-v1/packages/mt5/backend/mcp.js';
import { MT5Official } from '../../optional-api-v1/packages/mt5/backend/official.js';
import { createTools as officialTools } from '../../optional-api-v1/packages/mt5/tools/official/index.js';

async function frozenFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mt5-frozen-')), source = join(root, 'source'), staging = join(root, 'staging');
  await mkdir(join(source, '.compiler'), { recursive: true }); await mkdir(join(source, 'Experts'), { recursive: true });
  const compiler = Buffer.from('compiler'), expert = Buffer.from('expert');
  await writeFile(join(source, '.compiler/MetaEditor64.exe'), compiler); await writeFile(join(source, 'Experts/Strategy.mq5'), expert);
  const manifest = { compiler_sha256: digest(compiler), files: { '.compiler/MetaEditor64.exe': { bytes: compiler.length, sha256: digest(compiler) }, 'Experts/Strategy.mq5': { bytes: expert.length, sha256: digest(expert) } } };
  const manifestText = JSON.stringify(manifest); await writeFile(join(source, 'manifest.json'), manifestText); t.after(() => rm(root, { recursive: true, force: true }));
  return { source, staging, hash: digest(manifestText), manifest };
}

test('frozen build containment uses native filesystem paths while manifest paths stay POSIX', async t => {
  const f = await frozenFixture(t); await stageFrozenBuild(f.source, f.hash, f.staging);
  assert.equal(await readFile(join(f.staging, 'Experts/Strategy.mq5'), 'utf8'), 'expert');
  f.manifest.files['..\\outside.mq5'] = { bytes: 1, sha256: digest('x') };
  await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.manifest));
  await assert.rejects(stageFrozenBuild(f.source, digest(JSON.stringify(f.manifest)), f.staging), /路径/);
});

test('lossless JSON preserves native 64-bit ids and rejects already-rounded JS id numbers', () => {
  const schema = { type: 'object', properties: { run_id: { type: 'integer', minimum: 10 } }, required: ['run_id'], additionalProperties: false };
  const stringSchema = { type: 'object', properties: { run_id: { type: 'string' } }, required: ['run_id'], additionalProperties: false };
  const value = parseLosslessJson('{"run_id":7696386599088186923,"nested":{"run_id":42}}');
  assert.equal(value.run_id, '7696386599088186923'); assert.equal(value.nested.run_id, 42);
  assert.equal(stringifyLosslessJson({ params: { arguments: { run_id: '7696386599088186923' } } }), '{"params":{"arguments":{"run_id":"7696386599088186923"}}}');
  assert.equal(JSON.stringify({ arguments: nativeValueForLosslessIds(schema, { run_id: '7696386599088186923' }) }), '{"arguments":{"run_id":7696386599088186923}}');
  assert.equal(JSON.stringify({ arguments: nativeValueForLosslessIds(stringSchema, { run_id: '7696386599088186923' }) }), '{"arguments":{"run_id":"7696386599088186923"}}');
  assert.throws(() => assertNoUnsafeNativeIds({ run_id: 7696386599088187000 }), { code: 'unsafe_native_id' });
});

const idSchema = property => `{"type":"object","properties":{"run_id":${property}},"required":["run_id"],"additionalProperties":false}`;
function nativeCallFixture(t, schemaText, beforeList = async () => {}) {
  const bodies = [], records = new Map(), previous = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    bodies.push(options.body);
    const message = JSON.parse(options.body);
    if (message.method === 'tools/list') await beforeList();
    const result = message.method === 'tools/list'
      ? `{"tools":[{"name":"tester_get_status","inputSchema":${schemaText}}]}`
      : '{"structuredContent":{"run_id":7696386599088186923},"content":[{"type":"text","text":"{\\"nested\\":{\\"run_id\\":7696386599088186923}}"}]}';
    return new Response(`{"jsonrpc":"2.0","id":${message.id},"result":${result}}`, { headers: { 'content-type': 'application/json' } });
  };
  const client = new MT5MCP({ url: 'http://127.0.0.1:1/mcp', token: 'test-token', server: 'terminal' });
  client.ready = Promise.resolve();
  t.after(() => { globalThis.fetch = previous; client.close(); });
  const official = Object.create(MT5Official.prototype);
  Object.assign(official, {
    config: { version: 1, servers: { terminal: { enabled: true, token: 'test-token' } }, account: {}, startup_ini: '' },
    jobs: new Map(), clients: new Map([['terminal', client]]), host: { datasets: { register() {} } },
    storage: { get: (_kind, id) => records.get(id), put: (_kind, value) => records.set(value.id, structuredClone(value)), transaction: fn => fn() },
    access: () => ({}), permission: () => 'standard',
  });
  return {
    official, bodies, records,
    calls: () => bodies.filter(body => JSON.parse(body).method === 'tools/call'),
    call: (args, command_id = 'native_id_request_0001') => official.call({ command_id, server: 'terminal', tool: 'tester_get_status', arguments: args }, 'test'),
  };
}

test('official calls validate exact numeric ids before sending their original digits', async t => {
  const cases = [
    ['u64 maximum', '{"type":"integer","minimum":0,"maximum":18446744073709551615}', '18446744073709551615'],
    ['high minimum', '{"type":"integer","minimum":9007199254740993}', '9007199254740993'],
    ['numeric enum', '{"type":"integer","enum":[7696386599088186923]}', '7696386599088186923'],
    ['numeric const', '{"type":"integer","const":7696386599088186923}', '7696386599088186923'],
    ['fractional multiple', '{"type":"integer","multipleOf":1.5}', '9007199254740993'],
    ['fractional maximum', '{"type":"number","maximum":10.5}', '10'],
    ['fractional high minimum', '{"type":"integer","minimum":9007199254740992.5}', '9007199254740993'],
    ['exponent bound', '{"type":"integer","maximum":9.007199254740993e15}', '9007199254740993'],
    ['exclusive bounds', '{"type":"integer","exclusiveMinimum":9007199254740992,"exclusiveMaximum":9007199254740994}', '9007199254740993'],
    ['safe numeric id with exact fraction', '{"type":"integer","exclusiveMinimum":1.999999999999999999}', 2],
  ];
  for (const [name, property, run_id] of cases) await t.test(name, async t => {
    const f = nativeCallFixture(t, idSchema(property)), args = { run_id };
    const result = await f.call(args);
    assert.equal(result.status, 'returned');
    assert.equal(f.calls().length, 1);
    assert.ok(f.calls()[0].includes(`"arguments":{"run_id":${run_id}}`));
    assert.equal(result.result.structuredContent.run_id, '7696386599088186923');
    assert.equal(result.result.content[0].text, '{"nested":{"run_id":7696386599088186923}}');
    assert.deepEqual(args, { run_id }, 'validation must not alter the caller arguments');
  });
});

test('official calls reject exact numeric constraint violations without native dispatch', async t => {
  const cases = [
    ['maximum', '{"type":"integer","maximum":100}', '7696386599088186923'],
    ['u64 overflow', '{"type":"integer","maximum":18446744073709551615}', '18446744073709551616'],
    ['fractional maximum', '{"type":"integer","maximum":10.5}', '11'],
    ['fractional multiple', '{"type":"integer","multipleOf":1.5}', '9007199254740994'],
    ['fractional high minimum', '{"type":"integer","minimum":9007199254740992.5}', '9007199254740992'],
    ['exponent bound', '{"type":"integer","maximum":9.007199254740993e15}', '9007199254740994'],
    ['exclusive minimum', '{"type":"integer","exclusiveMinimum":9007199254740993}', '9007199254740993'],
    ['exclusive maximum', '{"type":"integer","exclusiveMaximum":9007199254740993}', '9007199254740993'],
    ['enum mismatch', '{"type":"integer","enum":[7696386599088186923]}', '7696386599088186924'],
    ['const mismatch', '{"type":"integer","const":7696386599088186923}', '7696386599088186924'],
    ['string enum is not numeric', '{"type":"integer","enum":["7696386599088186923"]}', '7696386599088186923'],
    ['string const is not numeric', '{"type":"integer","const":"7696386599088186923"}', '7696386599088186923'],
    ['safe numeric id with exact maximum', '{"type":"integer","maximum":10.999999999999999999}', 11],
    ['safe numeric id with exact multiple', '{"type":"integer","multipleOf":1.000000000000000001}', 1],
  ];
  for (const [name, property, run_id] of cases) await t.test(name, async t => {
    const f = nativeCallFixture(t, idSchema(property));
    await assert.rejects(f.call({ run_id }), { code: 'invalid_request', details: { submission_attempted: false } });
    assert.deepEqual(f.calls(), []); assert.equal(f.records.size, 0);
  });
});

test('official calls fail closed for unsupported lossless schema constraints', async t => {
  const schemas = [
    idSchema('{"maximum":100,"anyOf":[{"type":"integer"}]}'),
    idSchema('{"type":"integer","allOf":[{"maximum":100}]}'),
    idSchema('{"type":["integer","null"]}'),
    idSchema('{"type":"integer","not":{"const":7696386599088186923}}'),
    idSchema('{"type":"integer","exclusiveMinimum":true}'),
    idSchema('{"$ref":"#/$defs/id"}'),
    '{"type":"object","properties":{"run_id":{"type":"integer"}},"allOf":[{"properties":{"run_id":{"maximum":100}}}]}',
    '{"type":"object","properties":{"run_id":{"type":"integer"}},"if":{"required":["run_id"]},"then":{"properties":{"run_id":{"maximum":100}}}}',
    '{"type":"object","properties":{"run_id":{"type":"integer"},"other":{"$ref":"#/properties/run_id"}}}',
    '{"type":"object","properties":{"run_id":{"type":"integer"}},"patternProperties":{"^run_":{"maximum":100}}}',
  ];
  for (const [index, schema] of schemas.entries()) await t.test(String(index + 1), async t => {
    const f = nativeCallFixture(t, schema);
    await assert.rejects(f.call({ run_id: '7696386599088186923' }), { code: 'unsupported_native_id_schema', details: { submission_attempted: false } });
    assert.deepEqual(f.calls(), []); assert.equal(f.records.size, 0);
  });
  await t.test('nested numeric ids', async t => {
    const f = nativeCallFixture(t, '{"type":"object","properties":{"nested":{"type":"object","properties":{"run_id":{"type":"integer"}}}}}');
    await assert.rejects(f.call({ nested: { run_id: '7696386599088186923' } }), { code: 'unsupported_native_id_schema', details: { submission_attempted: false } });
    assert.deepEqual(f.calls(), []); assert.equal(f.records.size, 0);
  });
  for (const [name, schema, args] of [
    ['numeric id in root composition', '{"allOf":[{"type":"object","properties":{"run_id":{"type":"integer","maximum":0.99999999999999999}}}]}', { run_id: 1 }],
    ['nested safe numeric id', '{"type":"object","properties":{"nested":{"type":"object","properties":{"run_id":{"type":"integer","maximum":0.99999999999999999}}}}}', { nested: { run_id: 1 } }],
  ]) await t.test(name, async t => {
    const f = nativeCallFixture(t, schema);
    await assert.rejects(f.call(args), { code: 'unsupported_native_id_schema', details: { submission_attempted: false } });
    assert.deepEqual(f.calls(), []); assert.equal(f.records.size, 0);
  });
});

test('official calls preserve string schemas, original object constraints, and safe-number validation', async t => {
  for (const run_id of ['7696386599088186923', 'opaque-id']) await t.test(run_id, async t => {
    const f = nativeCallFixture(t, idSchema('{"type":"string"}'));
    await f.call({ run_id });
    assert.deepEqual(JSON.parse(f.calls()[0]).params.arguments, { run_id });
  });
  await t.test('mixed schema keeps accepted string branch', async t => {
    const f = nativeCallFixture(t, idSchema('{"anyOf":[{"type":"integer"},{"type":"string","pattern":"^opaque-id$"}]}'));
    await f.call({ run_id: 'opaque-id' });
    assert.deepEqual(JSON.parse(f.calls()[0]).params.arguments, { run_id: 'opaque-id' });
  });
  const cases = [
    ['required sibling', '{"type":"object","properties":{"run_id":{"type":"integer"},"limit":{"type":"integer","maximum":10}},"required":["run_id","limit"],"additionalProperties":false}', { run_id: '7696386599088186923' }],
    ['sibling constraint', '{"type":"object","properties":{"run_id":{"type":"integer"},"limit":{"type":"integer","maximum":10}}}', { run_id: '7696386599088186923', limit: 11 }],
    ['extra property', idSchema('{"type":"integer"}'), { run_id: '7696386599088186923', extra: true }],
    ['safe number bounds', idSchema('{"type":"integer","maximum":10.5}'), { run_id: 11 }],
    ['numeric enum with string schema', idSchema('{"type":"string","enum":[7696386599088186923]}'), { run_id: '7696386599088186923' }],
  ];
  for (const [name, schema, args] of cases) await t.test(name, async t => {
    const f = nativeCallFixture(t, schema);
    await assert.rejects(f.call(args), { code: 'invalid_request', details: { submission_attempted: false } });
    assert.deepEqual(f.calls(), []); assert.equal(f.records.size, 0);
  });
  await t.test('unsafe JS numbers', async t => {
    const f = nativeCallFixture(t, idSchema('{"type":"integer"}'));
    await assert.rejects(f.call({ run_id: 7696386599088187000 }), { code: 'unsafe_native_id', details: { submission_attempted: false } });
    assert.deepEqual(f.calls(), []); assert.equal(f.records.size, 0);
  });
});

test('official lossless calls preserve concurrent reservation, replay, and fresh catalog validation', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = nativeCallFixture(t, idSchema('{"type":"integer","const":7696386599088186923}'), () => gate);
  const args = { run_id: '7696386599088186923' };
  const first = f.call(args), duplicate = f.call(args);
  await assert.rejects(f.call({ run_id: '7696386599088186924' }), { code: 'idempotency_conflict' });
  release();
  const results = await Promise.all([first, duplicate]);
  assert.deepEqual(results[0], results[1]); assert.equal(f.calls().length, 1);
  assert.deepEqual(await f.call(args), results[0]); assert.equal(f.calls().length, 1);
  await f.official.catalog('tester', '', undefined, 'test');
  await f.call(args, 'native_id_request_0002');
  assert.equal(f.calls().length, 2);
  assert.equal(f.bodies.filter(body => JSON.parse(body).method === 'tools/list').length, 3);
  assert.equal(f.official.jobs.size, 0);
});

test('MT5 MCP transport preserves incoming large ids and sends schema-normalized raw ids', async () => {
  const previous = globalThis.fetch, bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(options.body);
    return new Response('{"jsonrpc":"2.0","id":7,"result":{"structuredContent":{"run_id":7696386599088186923},"content":[{"type":"text","text":"{\\"run_id\\":7696386599088186923}"}]}}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = new MT5MCP({ url: 'http://127.0.0.1:1/mcp', token: 'token', server: 'terminal' });
    const result = await client.post({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'tester_get_status', arguments: nativeValueForLosslessIds({ type: 'object', properties: { run_id: { type: 'integer' } } }, { run_id: '7696386599088186923' }) } });
    assert.equal(bodies[0], '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"tester_get_status","arguments":{"run_id":7696386599088186923}}}');
    assert.equal(result.structuredContent.run_id, '7696386599088186923');
    assert.equal(result.content[0].text, '{"run_id":7696386599088186923}');
  } finally { globalThis.fetch = previous; }
});

test('mt5_catalog supports tester as a discovery alias for terminal tester tools', async () => {
  const official = Object.create(MT5Official.prototype);
  official.config = { servers: { terminal: { enabled: true, token: 'token' } } }; official.clients = new Map(); official.redact = x => x;
  official.permission = () => 'read'; official.access = () => ({});
  official.tools = async server => { assert.equal(server, 'terminal'); return [{ name: 'tester_get_status', description: 'Tester status', inputSchema: { type: 'object', properties: { run_id: { type: 'integer' } }, required: ['run_id'], additionalProperties: false } }, { name: 'chart_open', description: 'Chart', inputSchema: {} }]; };
  const result = await official.catalog('tester', '', undefined, 'conversation');
  assert.equal(result.items[0].server, 'terminal');
  assert.deepEqual(result.items[0].tools.map(tool => tool.name), ['tester_get_status']);
});

test('published MT5 metadata leaves read-only settings available outside main-only tools and documents tester/time contracts', async () => {
  const host = { scope: { conversationId: 'main' }, workspace: {}, tools: { Type, string: description => Type.String({ description, minLength: 1, maxLength: 20000 }), optional: description => Type.Optional(Type.String({ description, minLength: 1, maxLength: 20000 })), define: (name, description, properties) => ({ name, description, parameters: Type.Object(properties, { additionalProperties: false }) }) } };
  const tools = officialTools(host, { official: { catalog: () => {}, command: () => {} }, market: {} });
  const catalog = tools.find(tool => tool.name === 'mt5_catalog'), cache = tools.find(tool => tool.name === 'mt5_cache');
  assert.ok(catalog.description.includes('server:"tester"'));
  assert.ok(catalog.parameters.properties.server.anyOf.some(item => item.const === 'tester'));
  assert.match(cache.parameters.properties.from.description, /券商服务器墙钟/);
  const manifest = JSON.parse(await readFile(new URL('../../optional-api-v1/packages/mt5/plugin.json', import.meta.url), 'utf8'));
  assert.ok(manifest.tool_names.includes('mt5_settings')); assert.ok(!manifest.main_tool_names.includes('mt5_settings'));
});
