import { mt5Import } from './mt5-path.js';
import test from 'node:test';
import assert from 'node:assert/strict';
const { prepareTerminal, terminalStartupDiagnostic } = await mt5Import('terminal.js');
import { mkdtemp, mkdir, readFile, readdir, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
const { launch, winePath } = await mt5Import('process.js');

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mt5 preparation with spaces-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'mt5'));
  const scope = { login: '7001', server: 'Fixture-Demo' }, events = [], paths = [];
  const client = { workspace: { structuredContent: { workspace: { mql5_folder: 'C:\\Fixture\\MQL5', common_folder: 'C:\\Common' } } },
    call: async tool => ({ structuredContent: tool === 'get_trading_open_positions' ? { positions: [], orders: [] } : { charts: [] } }), close() {} };
  const mt5 = { native: { directory }, storage: { directory },
    official: { config: { account: { ...scope, password: 'fixture-password' } }, clients: new Map(), jobs: new Set(), client: () => client, redact: x => x },
    market: { connected: async () => ({ scope, info: { terminal: { mcp_trade_allowed: true, experts_trade_allowed: false } } }) },
    tester: { pending: new Set() }, deployments: { list: () => [] } };
  const ports = { resolveNativePath: async () => directory,
    control: async (_, action) => { events.push(action); },
    start: async (_native, _tool, _args, file) => {
      events.push('start'); paths.push(file);
      assert.equal(mt5.terminalPreparing, true);
      assert.match(await readFile(file, 'utf8'), /Password=fixture-password/);
      if (process.platform !== 'win32') {
        assert.doesNotMatch(file, /\s/);
        assert.equal((await stat(dirname(file))).mode & 0o777, 0o700);
        assert.equal((await stat(file)).mode & 0o777, 0o600);
      }
    },
    wait: async () => ({ terminal: { mcp_trade_allowed: true, experts_trade_allowed: true } }) };
  return { mt5, ports, events, paths, directory };
}

test('space-containing storage uses a unique private INI directory, cleans every run and only starts after closing', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 2; i++) {
    assert.equal((await prepareTerminal(f.mt5, undefined, {}, f.ports)).verified, true);
    await assert.rejects(access(dirname(f.paths[i])), { code: 'ENOENT' });
  }
  assert.notEqual(f.paths[0], f.paths[1]);
  assert.deepEqual(f.events, ['inspect', 'close', 'start', 'inspect', 'close', 'start']);
  assert.equal(f.mt5.terminalPreparing, false);
});

test('failed preparation recovery retains one private INI and removes it after verification', async t => {
  const f = await fixture(t); let waits = 0;
  f.ports.wait = async () => ({ terminal: { mcp_trade_allowed: true, experts_trade_allowed: false } });
  const original = f.ports.start;
  f.ports.start = async (...args) => { await original(...args); assert.match(await readFile(args[3], 'utf8'), new RegExp(`AllowLiveTrading=${waits++ === 0 ? 1 : 0}`)); };
  await assert.rejects(prepareTerminal(f.mt5, undefined, {}, f.ports), { code: 'native_config_not_applied' });
  assert.deepEqual(f.events, ['inspect', 'close', 'start', 'close', 'start']);
  assert.equal(f.paths[0], f.paths[1]);
  await assert.rejects(access(dirname(f.paths[0])), { code: 'ENOENT' });
  assert.equal(f.mt5.terminalPreparing, false);
});

test('a terminal refusing to close is never replaced by a second instance', async t => {
  const f = await fixture(t);
  f.ports.control = async (_, action) => { f.events.push(action); if (action === 'close') throw new Error('refuse to close occupied terminal'); };
  await assert.rejects(prepareTerminal(f.mt5, undefined, {}, f.ports), /refuse to close/);
  assert.deepEqual(f.events, ['inspect', 'close']); assert.deepEqual(f.paths, []);
  assert.equal(f.mt5.terminalPreparing, false);
});

test('concurrent preparation cannot replace the active INI or start another terminal', async t => {
  const f = await fixture(t); let release, started;
  const running = new Promise(resolve => { started = resolve; });
  f.ports.wait = async () => { started(); await new Promise(resolve => { release = resolve; }); return { terminal: { mcp_trade_allowed: true, experts_trade_allowed: true } }; };
  const first = prepareTerminal(f.mt5, undefined, {}, f.ports);
  await running;
  await assert.rejects(prepareTerminal(f.mt5, undefined, {}, f.ports), { code: 'terminal_preparing' });
  assert.equal(f.paths.length, 1); assert.equal(f.mt5.terminalPreparing, true);
  release(); await first;
  assert.equal(f.events.filter(action => action === 'start').length, 1);
  await assert.rejects(access(dirname(f.paths[0])), { code: 'ENOENT' });
});

test('Windows spaced TEMP reaches the real launcher with value quotes, private credentials and cleanup on success or recovery', async t => {
  for (const succeeds of [true, false]) {
    const f = await fixture(t), privateTemp = join(f.directory, 'Jane Doe 芝麻 TEMP');
    await mkdir(privateTemp);
    f.mt5.native.terminal = 'C:\\Program Files\\MetaTrader 5\\terminal64.exe';
    f.ports.platform = 'win32'; f.ports.temporaryDirectory = () => privateTemp;
    const launches = [], progress = []; let waits = 0;
    f.ports.wait = async () => ({ terminal: { mcp_trade_allowed: true, experts_trade_allowed: succeeds && ++waits === 1 } });
    f.ports.start = async (native, tool, args, file, agent, signal) => {
      f.events.push('start'); f.paths.push(file);
      assert.equal(dirname(dirname(file)), privateTemp);
      assert.match(file, /Jane Doe 芝麻 TEMP/);
      const body = await readFile(file, 'utf8');
      assert.match(body, /Password=fixture-password/);
      assert.match(body, new RegExp(`AllowLiveTrading=${f.paths.length === 1 ? 1 : 0}`));
      if (process.platform !== 'win32') {
        assert.equal((await stat(dirname(file))).mode & 0o777, 0o700);
        assert.equal((await stat(file)).mode & 0o777, 0o600);
      }
      return launch(native, tool, args, file, agent, signal, { platform: 'win32', spawnProcess: (program, argv, options) => {
        assert.equal(f.events.at(-2), 'close', 'Every launch follows a confirmed close');
        assert.equal(options.windowsVerbatimArguments, true);
        assert.equal(options.argv0, `"${f.mt5.native.terminal}"`);
        assert.equal(argv.find(flag => flag.startsWith('/config:')), `/config:"${file}"`);
        assert.doesNotMatch(argv.join(' '), /fixture-password|\/password:/);
        launches.push({ program, argv, argv0: options.argv0 });
        const child = new EventEmitter(); child.pid = 12345; child.unref = () => {};
        queueMicrotask(() => child.emit('spawn')); return child;
      } });
    };
    const operation = prepareTerminal(f.mt5, value => progress.push(value), {}, f.ports);
    if (succeeds) assert.equal((await operation).verified, true);
    else await assert.rejects(operation, { code: 'native_config_not_applied' });
    assert.equal(launches.length, succeeds ? 1 : 2);
    if (!succeeds) assert.equal(f.paths[0], f.paths[1], 'Disabled recovery keeps the same owned config until verified');
    assert.equal(f.mt5.terminalPreparing, false);
    assert.deepEqual(await readdir(privateTemp), [], 'No credential directory remains after either outcome');
    assert.doesNotMatch(JSON.stringify({ launches, progress }), /fixture-password/);
  }
});

test('Windows spaced TEMP is cleaned if the existing terminal refuses to close', async t => {
  const f = await fixture(t), privateTemp = join(f.directory, 'Jane Doe 芝麻 TEMP');
  await mkdir(privateTemp);
  f.ports.platform = 'win32'; f.ports.temporaryDirectory = () => privateTemp;
  f.ports.control = async (_, action) => { f.events.push(action); if (action === 'close') throw new Error('refuse to close occupied terminal'); };
  await assert.rejects(prepareTerminal(f.mt5, undefined, {}, f.ports), /refuse to close/);
  assert.deepEqual(f.events, ['inspect', 'close']); assert.deepEqual(f.paths, []);
  assert.deepEqual(await readdir(privateTemp), []);
  assert.equal(f.mt5.terminalPreparing, false);
});

test('automatic mounting preserves occupied terminals and native permission boundaries before touching files or processes', async () => {
  const scope = { login: '7001', server: 'Demo' };
  let nativeAllowed = true, positions = [], orders = [], charts = [], calls = [];
  const mt5 = {
    official: { config: { account: scope }, jobs: new Set(), client: () => ({ call: async tool => {
      calls.push(tool);
      return { structuredContent: tool === 'get_trading_open_positions' ? { positions, orders } : { charts } };
    } }) },
    market: { connected: async () => ({ scope, info: { terminal: { mcp_trade_allowed: nativeAllowed, experts_trade_allowed: true } } }) },
    tester: { pending: new Set() }, deployments: { list: () => [] },
  };
  nativeAllowed = false;
  await assert.rejects(prepareTerminal(mt5, undefined, { restart: true }), /原生 MCP/);
  assert.deepEqual(calls, []);
  nativeAllowed = true; positions = [{ ticket: '1' }];
  await assert.rejects(prepareTerminal(mt5, undefined, { restart: true }), /持仓或挂单/);
  positions = []; orders = [{ ticket: '2' }];
  await assert.rejects(prepareTerminal(mt5, undefined, { restart: true }), /持仓或挂单/);
  orders = []; charts = [{ chart_id: '3', expert: 'Existing EA' }];
  await assert.rejects(prepareTerminal(mt5, undefined, { restart: true }), /已有 EA/);
  assert.ok(calls.every(tool => tool.startsWith('get_') || tool === 'list_open_charts'));
  await assert.rejects(prepareTerminal(mt5, undefined, { deployment: { status: 'preparing', ...scope, id: 'deploy_ok', build_id: '../other' }, inputs: { Product_RunId: 'deploy_ok', Product_EnableLive: true } }), /受管理挂载配置无效/);
});

test('startup diagnostics expose only permission-relevant evidence, never log credentials',()=>{const file=join(tmpdir(),'managed-terminal.ini'),expected=winePath(file);const clean=terminalStartupDiagnostic('Startup successfully initialized from start config "'+expected+'"',file);assert.equal(clean.managedConfigInitialized,true);assert.equal(clean.competingStartupObserved,false);assert.deepEqual(terminalStartupDiagnostic('Terminal terminal process already started\nTerminal cannot load config "Z:\\other\\connect_fixture.ini" Login=secret Password=secret',file),{managedConfigInitialized:false,competingStartupObserved:true});assert.equal(terminalStartupDiagnostic('Terminal cannot load config "'+expected+'"',file).competingStartupObserved,false);});

test('managed restart retains ownership through verification and disabled recovery cleanup',async()=>{const {mkdtemp,mkdir,readFile,rm,access}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');for(const enabled of [true,false]){const directory=await mkdtemp(join(tmpdir(),'mt5-preparation-lifecycle-'));await mkdir(join(directory,'mt5'));const scope={login:'7001',server:'Fixture-Demo'};let starts=0,waits=0;const client={workspace:{structuredContent:{workspace:{mql5_folder:'C:\\Fixture\\MQL5',common_folder:'C:\\Common'}}},call:async tool=>({structuredContent:tool==='get_trading_open_positions'?{positions:[],orders:[]}:{charts:[]}}),close(){}};const mt5={native:{directory},storage:{directory},official:{config:{account:scope},clients:new Map(),jobs:new Set(),client:()=>client,redact:x=>x},market:{connected:async()=>({scope,info:{terminal:{mcp_trade_allowed:true,experts_trade_allowed:false}}})},tester:{pending:new Set()},deployments:{list:()=>[]}};const deps={resolveNativePath:async()=>directory,control:async(_,action)=>{if(action==='close')assert.equal(mt5.terminalPreparing,true);},start:async(_n,_t,_a,file)=>{assert.equal(mt5.terminalPreparing,true);assert.match(await readFile(file,'utf8'),new RegExp('AllowLiveTrading='+ (++starts===1?'1':'0')));},wait:async()=>{assert.equal(mt5.terminalPreparing,true);return {terminal:{mcp_trade_allowed:true,experts_trade_allowed:++waits===1?enabled:false}};}};try{const operation=prepareTerminal(mt5,undefined,{},deps);if(enabled)assert.equal((await operation).verified,true);else await assert.rejects(operation,{code:'native_config_not_applied'});assert.equal(mt5.terminalPreparing,false);assert.equal(mt5.terminalPreparationEpoch,1);assert.equal(starts,enabled?1:2);await assert.rejects(access(join(directory,'mt5/managed-terminal.ini')));}finally{await rm(directory,{recursive:true,force:true});}}});
