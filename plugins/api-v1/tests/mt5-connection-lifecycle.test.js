import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, hostForStore } from './mt5-host.js';
import { connectMT5, ensureMT5Connection } from '../../optional-api-v1/packages/mt5/backend/connect.js';
import { MT5AutoConnection } from '../../optional-api-v1/packages/mt5/backend/auto-connect.js';
const account={login:'123456',server:'Fixture-Demo'},server={enabled:true,url:'http://127.0.0.1:22346/',token:'fixture-token'};
function fixture(){let launches=0,closes=0;const mt5={native:{directory:'/fixture',dataDirectory:'/fixture'},official:{config:{version:1,account,servers:{terminal:server}},jobs:new Set(),access:()=>({}),redact:x=>x,clients:new Map([['terminal',{close:()=>closes++}]])},tester:{pending:new Set()},deployments:{list:()=>[]}};const info={account,terminal:{server_connected:true}};const deps={readNativeSettings:async()=>({servers:{terminal:server},account}),startTerminal:async()=>{launches++;},probeAccount:async()=>info};return{mt5,deps,info,get launches(){return launches;},get closes(){return closes;}};}
const refused=()=>Object.assign(new Error('refused'),{cause:{code:'ECONNREFUSED'}});
test('preparation owns terminal: connection and monitor cannot probe or start',async()=>{const f=fixture();f.mt5.terminalPreparing=true;f.deps.probeAccount=()=>assert.fail('no probe during preparation');const result=await ensureMT5Connection(f.mt5,{},undefined,f.deps);assert.equal(result.code,'terminal_preparing');const monitor=new MT5AutoConnection({configuration:{assertIdle:()=>assert.fail('no config checks')}},f.mt5);assert.equal(await monitor.check(),monitor.retryMs);assert.equal(f.launches,0);assert.equal(f.closes,0);});
test('stale refusal is reprobed under ownership before launching a second terminal',async()=>{const f=fixture();let probes=0;f.deps.probeAccount=async()=>{if(++probes===1)throw refused();return f.info;};const result=await ensureMT5Connection(f.mt5,{},undefined,f.deps);assert.equal(result.status,'connected',JSON.stringify(result));assert.equal(probes,2);assert.equal(f.launches,0);assert.equal(result.started,false);});
test('preparation beginning or finishing during an old probe invalidates its mutation',async()=>{for(const active of [true,false]){const f=fixture();f.deps.probeAccount=async()=>{f.mt5.terminalPreparationEpoch=1;f.mt5.terminalPreparing=active;throw refused();};const result=await ensureMT5Connection(f.mt5,{},undefined,f.deps);assert.equal(result.code,'terminal_preparing');assert.equal(f.launches,0);assert.equal(f.closes,0);}});
test('successful stale probe also cannot reset a newly prepared terminal session',async()=>{const f=fixture();f.deps.probeAccount=async()=>{f.mt5.terminalPreparationEpoch=1;return f.info;};const result=await ensureMT5Connection(f.mt5,{},undefined,f.deps);assert.equal(result.code,'terminal_preparing');assert.equal(f.closes,0);});

test('abort and changed configuration after failed probe cannot launch',async()=>{for(const canceled of [false,true]){const f=fixture(),controller=new AbortController();let probes=0;f.deps.probeAccount=async()=>{if(++probes===2){if(canceled)controller.abort();else f.mt5.official.config.version++;}throw refused();};if(canceled)await assert.rejects(ensureMT5Connection(f.mt5,{},controller.signal,f.deps),{name:'AbortError'});else assert.equal((await ensureMT5Connection(f.mt5,{},controller.signal,f.deps)).code,'version_conflict');assert.equal(f.launches,0);assert.equal(f.closes,0);}});

async function queuedHost(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mt5-queued-connect-')), store = new Store(directory);
  let chain = Promise.resolve();
  store.exclusive = action => { const next = chain.then(action, action); chain = next.catch(() => {}); return next; };
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return { ...hostForStore(store, { sessionId: 'main' }), eventSink: store.events };
}

test('same connect command queued by plugin lock reuses the first receipt', async t => {
  const host = await queuedHost(t), mt5 = { official: { config: { version: 1, account: {}, servers: { terminal: { enabled: false, url: 'http://127.0.0.1:22346/mcp', token: '' } } }, redact: x => x, jobs: new Set(), access: () => ({}) }, tester: { pending: new Set() }, deployments: { list: () => [] } };
  const args = { command_id: 'same_connect_command', start_if_needed: true };
  const [first, second] = await Promise.all([connectMT5(host, mt5, args), connectMT5(host, mt5, args)]);
  assert.deepEqual(second, first); assert.equal(first.status, 'failed'); assert.equal(first.result.code, 'connection_disabled');
  assert.equal(host.eventSink.filter(event => event.type === 'workspace.mt5.configuration' && event.data.id === args.command_id).length, 1);
  await assert.rejects(connectMT5(host, mt5, { ...args, start_if_needed: false }), { code: 'idempotency_conflict' });
});
