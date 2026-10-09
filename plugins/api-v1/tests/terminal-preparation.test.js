import { mt5Import, mt5Path } from './mt5-path.js';
import test from 'node:test';
import assert from 'node:assert/strict';
const { prepareTerminal, terminalStartupDiagnostic } = await mt5Import('terminal.js');

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

test('startup diagnostics expose only permission-relevant evidence, never log credentials',()=>{const file='/tmp/managed-terminal.ini',expected='Z:\\tmp\\managed-terminal.ini';const clean=terminalStartupDiagnostic('Startup successfully initialized from start config "'+expected+'"',file);assert.equal(clean.managedConfigInitialized,true);assert.equal(clean.competingStartupObserved,false);assert.deepEqual(terminalStartupDiagnostic('Terminal terminal process already started\nTerminal cannot load config "Z:\\other\\connect_fixture.ini" Login=secret Password=secret',file),{managedConfigInitialized:false,competingStartupObserved:true});assert.equal(terminalStartupDiagnostic('Terminal cannot load config "'+expected+'"',file).competingStartupObserved,false);});

test('managed restart retains ownership through verification and disabled recovery cleanup',async()=>{const {mkdtemp,mkdir,readFile,rm,access}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');for(const enabled of [true,false]){const directory=await mkdtemp(join(tmpdir(),'mt5-preparation-lifecycle-'));await mkdir(join(directory,'mt5'));const scope={login:'7001',server:'Fixture-Demo'};let starts=0,waits=0;const client={workspace:{structuredContent:{workspace:{mql5_folder:'C:\\Fixture\\MQL5',common_folder:'C:\\Common'}}},call:async tool=>({structuredContent:tool==='get_trading_open_positions'?{positions:[],orders:[]}:{charts:[]}}),close(){}};const mt5={native:{directory},storage:{directory},official:{config:{account:scope},clients:new Map(),jobs:new Set(),client:()=>client,redact:x=>x},market:{connected:async()=>({scope,info:{terminal:{mcp_trade_allowed:true,experts_trade_allowed:false}}})},tester:{pending:new Set()},deployments:{list:()=>[]}};const deps={resolveNativePath:async()=>directory,control:async(_,action)=>{if(action==='close')assert.equal(mt5.terminalPreparing,true);},start:async(_n,_t,_a,file)=>{assert.equal(mt5.terminalPreparing,true);assert.match(await readFile(file,'utf8'),new RegExp('AllowLiveTrading='+ (++starts===1?'1':'0')));},wait:async()=>{assert.equal(mt5.terminalPreparing,true);return {terminal:{mcp_trade_allowed:true,experts_trade_allowed:++waits===1?enabled:false}};}};try{const operation=prepareTerminal(mt5,undefined,{},deps);if(enabled)assert.equal((await operation).verified,true);else await assert.rejects(operation,{code:'native_config_not_applied'});assert.equal(mt5.terminalPreparing,false);assert.equal(mt5.terminalPreparationEpoch,1);assert.equal(starts,enabled?1:2);await assert.rejects(access(join(directory,'mt5/managed-terminal.ini')));}finally{await rm(directory,{recursive:true,force:true});}}});
