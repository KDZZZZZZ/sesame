import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Type } from '@sesame/plugin-sdk/schema';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { createService, outcome } from '../packages/manual-trading/service.js';
import { createAdapters, payload } from '../packages/manual-trading/adapters.js';
import { createTools } from '../packages/manual-trading/index.js';
import { MT5Official } from '../packages/mt5/backend/official.js';
import { PYTHON_TOOLS } from '../packages/mt5/backend/python-tools.js';

const clone=x=>x===undefined?undefined:structuredClone(x);
function fixture() {
  let time=1800000000000,submissions=0,refreshes=0,cancels=0;
  const rows=new Map(),account={accountId:'fixture-account',server:'Fixture-Demo',revision:'1'};
  const host={scope:{kind:'main',conversationId:'conv_fixture'},storage:{directory:`fixture-${Math.random()}`,get:(k,id)=>clone(rows.get(`${k}:${id}`)),put(k,v){rows.set(`${k}:${v.id}`,clone(v));return clone(v);},list:k=>[...rows.entries()].filter(([id])=>id.startsWith(`${k}:`)).map(([,v])=>clone(v)),delete:(k,id)=>rows.delete(`${k}:${id}`),transaction:fn=>fn()},tools:{},plugins:{}};
  const adapter={snapshot:async(backend,symbol)=>({account:clone(account),symbol,spec:{},positions:[],quote:{sourceTimeMs:time,receivedAt:time,requestMs:1,bid:'100',ask:'101'},capturedAt:time,captureMs:5}),identity:async()=>clone(account),orderRequest:()=>({}),submit:async()=>{submissions++;return {status:'returned',result:{result:{retcode:10009,order:'1001'},execution_timing:{quote_to_send_ms:1,send_to_receipt_ms:2}}};},status:async()=>{refreshes++;return {command:{status:'unknown'},orders:[],deals:[]};},cancel:async()=>{cancels++;return {status:'returned',result:{result:{retcode:10009}}};}};
  adapter.command=async()=>({status:'returned',result:{result:{retcode:10009}}});
  const create=()=>createService(host,{now:()=>time,adapters:adapter});
  const observation=()=>service.observe({backend:'mt5',symbol:'FIXTURE'},undefined);
  const intent=id=>({operation_id:id,observation_id:null,user_authorized:true,action:'market',side:'buy',quantity:'0.1',price_limit:'102'});
  const service=create();return {host,service,adapter,account,create,observation,intent,advance:ms=>time+=ms,get submissions(){return submissions;},get refreshes(){return refreshes;},get cancels(){return cancels;}};
}
async function prepared(f,id='once'){const o=await f.observation();return {...f.intent(id),observation_id:o.observation_id};}

test('one observed decision submits once, measures model latency, and survives duplicate calls/reload',async()=>{
  const f=fixture(),args=await prepared(f);f.advance(12000);
  const [a,b]=await Promise.all([f.service.execute(args),f.service.execute(args)]);
  assert.equal(a.status,'execution_reported');assert.deepEqual(a,b);assert.equal(f.submissions,1);assert.equal(a.timing.model_round_trip_ms,12000);assert.equal(a.timing.quote_to_send_ms,1);
  assert.equal(a.intent.priceLimit,args.price_limit);assert.equal(a.intent.positionId,null);
  assert.deepEqual(await f.create().execute(args),a);assert.equal(f.submissions,1);
  await assert.rejects(f.service.execute({...args,quantity:'0.2'}),{code:'IDEMPOTENCY_CONFLICT'});
  await assert.rejects(f.service.execute({...args,operation_id:'replacement'}),{code:'OBSERVATION_CONSUMED'});
});
test('source expiry and M1 refusal happen before any order; fast API cannot relabel old decisions',async()=>{
  const f=fixture(),args=await prepared(f);
  await assert.rejects(f.service.execute({...args,timeframe:'1m'}),{code:'TIMEFRAME_UNSUPPORTED'});
  f.advance(60001);await assert.rejects(f.service.execute(args),{code:'SIGNAL_EXPIRED'});assert.equal(f.submissions,0);
});
test('a concurrent status refresh cannot overwrite a receipt that just completed',async()=>{
  const f=fixture(),args=await prepared(f),original=f.adapter.submit;
  let release,entered;
  const gate=new Promise(resolve=>{release=resolve;}),dispatched=new Promise(resolve=>{entered=resolve;});
  f.adapter.submit=async()=>{entered();await gate;return original();};
  const execute=f.service.execute(args);await dispatched;
  const status=f.service.status({operation_id:args.operation_id,refresh:true});
  release();assert.equal((await execute).status,'execution_reported');
  assert.equal((await status).status,'execution_reported');
  assert.equal((await f.create().execute(args)).status,'execution_reported');assert.equal(f.submissions,1);
});
test('stale/future source time and unsupported backend cannot create observations',async()=>{
  const f=fixture();const original=f.adapter.snapshot;
  f.adapter.snapshot=async(...args)=>{const value=await original(...args);value.quote.sourceTimeMs-=5001;return value;};
  await assert.rejects(f.observation(),{code:'STALE_QUOTE'});
  f.adapter.snapshot=async(...args)=>{const value=await original(...args);value.quote.sourceTimeMs++;return value;};
  await assert.rejects(f.observation(),{code:'STALE_QUOTE'});
  await assert.rejects(f.service.observe({backend:'ccxt',symbol:'BTC/USD'}),{code:'UNSUPPORTED_CAPABILITY'});
});
test('account changes, cancellation and lost permissions before dispatch cannot send',async()=>{
  const f=fixture(),args=await prepared(f);f.account.revision='2';
  const result=await f.service.execute(args);assert.equal(result.status,'rejected');assert.equal(result.error.code,'CONNECTION_CHANGED');assert.equal(f.submissions,0);
  const g=fixture(),other=await prepared(g),controller=new AbortController();controller.abort();
  assert.equal((await g.service.execute(other,controller.signal)).status,'rejected');assert.equal(g.submissions,0);
});
test('typed MT5 permission rejection before native dispatch stays rejected without locking the account',async()=>{
  const f=fixture(),args=await prepared(f),official=new MT5Official({storage:f.host.storage,datasets:{register:()=>{}}},null);
  official.config={version:1,allow_trading:true,allow_host_operations:true,account:{login:f.account.accountId,server:f.account.server},servers:{},startup_ini:''};
  let sends=0,deny=true;
  official.tools=async()=>PYTHON_TOOLS;
  official.python={available:()=>true,call:async()=>{sends++;return {result:{retcode:10009,order:'700',deal:'701'}};}};
  f.adapter.submit=async(_observation,intent,signal)=>{
    if(deny){official.config.version=2;official.config.allow_trading=false;}
    return official.call({command_id:intent.backendCommandId,server:'python',tool:'order_send',arguments:{request:{action:'TRADE_ACTION_DEAL',symbol:'FIXTURE',volume:0.1,type:'ORDER_TYPE_BUY'}}},f.host.scope.conversationId,signal);
  };
  const rejected=await f.service.execute(args);assert.equal(rejected.status,'rejected');assert.equal(rejected.error.code,'mt5_permission_denied');
  assert.equal(sends,0);assert.equal(f.host.storage.list('mt5_command').length,0);
  deny=false;official.config.version=3;official.config.allow_trading=true;f.account.revision='3';
  const next=await prepared(f,'permission-restored');assert.equal((await f.service.execute(next)).status,'execution_reported');assert.equal(sends,1);
  official.python.call=async()=>{sends++;throw new DOMException('native reply interrupted','AbortError');};
  const interrupted=await prepared(f,'unknown-native');assert.equal((await f.service.execute(interrupted)).status,'outcome_unknown');assert.equal(sends,2);
  await assert.rejects(f.service.execute(await prepared(f,'cannot-replay-abort')),{code:'UNRESOLVED_ORDER'});
});
test('unknown sends persist and block new IDs on same account even after config revision change',async()=>{
  const f=fixture(),args=await prepared(f);f.adapter.submit=async()=>{throw new Error('response lost after native submission');};
  assert.equal((await f.service.execute(args)).status,'outcome_unknown');
  assert.equal((await f.create().execute(args)).status,'outcome_unknown');
  f.account.revision='2';const next=await prepared(f,'new-id');
  await assert.rejects(f.service.execute(next),{code:'UNRESOLVED_ORDER'});
  f.account.revision='1';assert.equal((await f.service.status({operation_id:args.operation_id,refresh:true})).status,'outcome_unknown');assert.equal(f.refreshes,1);
  f.adapter.status=async()=>({command:{status:'unknown'},orders:[{order:'1001'}],deals:[]});
  assert.equal((await f.service.status({operation_id:args.operation_id,refresh:true})).status,'order_observed');
});
test('native guard rejection is distinguished from timeout and return/retcode from a fill',()=>{
  assert.equal(outcome('mt5',{status:'failed',result:{submission_attempted:false}}),'rejected');
  assert.equal(outcome('mt5',{status:'returned',result:{result:{retcode:10012}}}),'outcome_unknown');
  assert.equal(outcome('mt5',{status:'returned',result:{result:{retcode:10019}}}),'rejected');
  assert.equal(outcome('mt5',{status:'returned',result:{result:{retcode:10008}}}),'submitted');
  assert.equal(outcome('mt5',{status:'returned',result:{result:{retcode:10010}}}),'partially_filled');
  assert.equal(outcome('qmt',{status:'submitted'}),'submitted');
});
test('zero native IDs and non-trade history cannot resolve an unknown order or unlock replacement IDs',async()=>{
  const f=fixture(),args=await prepared(f),submit=f.adapter.submit;
  f.adapter.submit=async()=>{throw new Error('native timeout');};
  const original=await f.service.execute(args);assert.equal(original.status,'outcome_unknown');
  const next=await prepared(f,'replacement');
  await assert.rejects(f.service.execute(next),{code:'UNRESOLVED_ORDER'});
  let deals=[
    {ticket:'700',order:'0',symbol:'',comment:'Balance correction',type:2},
    {ticket:'701',order:'800',symbol:'FIXTURE',comment:original.remark,type:2},
    {ticket:'702',order:'801',symbol:'OTHER',comment:original.remark,type:0},
    {ticket:'0',order:'802',symbol:'FIXTURE',comment:original.remark,type:0},
    {ticket:'703',order:'0',symbol:'FIXTURE',comment:original.remark,type:0},
  ];
  const host={plugins:{isActive:()=>true},tools:{call:async({name,arguments:a})=>{
    if(name==='mt5_command')return {details:{status:'returned',result:{result:{retcode:10012,order:'0',deal:'0'}}}};
    const values={account_info:{login:f.account.accountId,server:f.account.server},orders_get:[],positions_get:[],history_deals_get:deals};
    return {details:{status:'returned',result:{result:values[a.tool]}}};
  }}};
  f.adapter.status=createAdapters(host).status;
  const unresolved=await f.service.status({operation_id:args.operation_id,refresh:true});
  assert.equal(unresolved.status,'outcome_unknown');assert.deepEqual(unresolved.evidence.deals,[]);
  await assert.rejects(f.service.execute(next),{code:'UNRESOLVED_ORDER'});assert.equal(f.submissions,0);
  deals=[{ticket:'704',order:'803',symbol:'FIXTURE',comment:original.remark,type:0}];
  assert.equal((await f.service.status({operation_id:args.operation_id,refresh:true})).status,'execution_observed');
  f.adapter.submit=submit;assert.equal((await f.service.execute(next)).status,'execution_reported');assert.equal(f.submissions,1);
});
test('cancel is separately idempotent and reading its evidence never repeats cancellation',async()=>{
  const f=fixture(),args=await prepared(f);args.action='limit';await f.service.execute(args);
  const cancel={operation_id:'cancel-once',original_operation_id:args.operation_id,user_authorized:true};
  const result=await f.service.cancel(cancel);assert.equal(result.status,'cancel_requested');
  assert.deepEqual(await f.create().cancel(cancel),result);assert.equal(f.cancels,1);
  assert.equal((await f.service.status({operation_id:'cancel-once',refresh:true})).status,'cancel_requested');assert.equal(f.cancels,1);
});
test('MT5 timeout recovery can cancel one exact active pending order and rechecks it before sending',async()=>{
  const f=fixture(),args={...await prepared(f),action:'limit',limit_price:'99'};
  f.adapter.submit=async()=>{throw new Error('native timeout');};const original=await f.service.execute(args);
  const pending={ticket:'700',symbol:original.symbol,comment:original.remark,type:2,state:1,volume_current:'0.1'};
  let rows=[pending],cancels=0,revision=f.account.revision;
  const host={plugins:{isActive:()=>true},tools:{call:async({name,arguments:a})=>{
    if(name==='mt5_settings')return {details:{settings:{version:revision,account:{login:f.account.accountId,server:f.account.server}}}};
    if(name==='mt5_command')return {details:{status:'returned',result:{result:{retcode:10012,order:'0',deal:'0'}}}};
    if(name==='mt5_trade'){cancels++;assert.equal(a.arguments.request.order,'700');assert.equal(a.arguments.request.action,'TRADE_ACTION_REMOVE');return {details:{status:'returned',result:{result:{retcode:10009}}}};}
    const values={account_info:{login:f.account.accountId,server:f.account.server},orders_get:rows,positions_get:[],history_deals_get:[]};
    return {details:{status:'returned',result:{result:values[a.tool]}}};
  }}};
  const native=createAdapters(host);f.adapter.status=native.status;f.adapter.cancel=native.cancel;
  rows=[pending,{...pending,ticket:'701'}];assert.equal((await f.service.status({operation_id:args.operation_id,refresh:true})).status,'outcome_unknown');
  rows=[pending];assert.equal((await f.service.status({operation_id:args.operation_id,refresh:true})).status,'order_observed');
  const cancel={operation_id:'recovered-cancel',original_operation_id:args.operation_id,user_authorized:true};
  for(const [i,bad] of [[{...pending,state:4}],[{...pending,type:3}],[{...pending,ticket:'0'}],[{...pending,symbol:'OTHER'}],[{...pending,comment:'foreign'}],[pending,{...pending,ticket:'701'}]].entries()){
    rows=bad;assert.equal((await f.service.cancel({...cancel,operation_id:`invalid-cancel-${i}`})).status,'rejected');assert.equal(cancels,0);
  }
  rows=[pending];revision='other';assert.equal((await f.service.cancel({...cancel,operation_id:'changed-connection'})).status,'rejected');assert.equal(cancels,0);
  revision=f.account.revision;assert.equal((await f.service.cancel(cancel)).status,'cancel_requested');
  assert.equal((await f.service.cancel(cancel)).status,'cancel_requested');assert.equal(cancels,1);
});
test('QMT recovery binds each read to the account and connection, then cancels only one fresh exact order',async()=>{
  const f=fixture();delete f.account.server;f.account.connectionId='fixture-route';
  const observed=await f.service.observe({backend:'qmt',symbol:'600000.SH'});
  const args={...f.intent('qmt-unknown'),observation_id:observed.observation_id,action:'limit',quantity:'100',limit_price:'99'};
  f.adapter.submit=async()=>{throw new Error('native timeout');};const original=await f.service.execute(args);
  const command={status:'outcome_unknown',remark:'SOwnQmtOrder',intent:{symbol:original.symbol,side:'buy',shares:'100',price:'99'}};
  const pending={account_id:f.account.accountId,stock_code:original.symbol,order_remark:command.remark,order_id:'700',order_type:'23',order_status:'50',order_volume:'100',traded_volume:'0'};
  let rows=[pending],connection={id:f.account.connectionId,revision:f.account.revision},cancels=0;
  const host={plugins:{isActive:()=>true},tools:{call:async({name,arguments:a})=>{
    if(name==='qmt_environment')return {details:{configuration:{account_id:f.account.accountId,connection_id:f.account.connectionId,version:f.account.revision}}};
    if(name==='qmt_command')return {details:command};
    if(name==='qmt_cancel'){cancels++;assert.equal(a.order_id,'700');assert.equal(a.original_operation_id,args.operation_id);return {details:{status:'cancel_requested'}};}
    return {details:{connection,items:a.action==='orders'?rows:[],nextCursor:null}};
  }}};
  const native=createAdapters(host);f.adapter.status=native.status;f.adapter.cancel=native.cancel;
  connection={id:'other-route',revision:'2'};
  await assert.rejects(f.service.status({operation_id:args.operation_id,refresh:true}),{code:'CONNECTION_CHANGED'});
  assert.equal((await f.service.status({operation_id:args.operation_id})).status,'outcome_unknown');
  connection={id:f.account.connectionId,revision:f.account.revision};rows=[{...pending,account_id:'other'},{...pending,stock_code:'000001.SZ'}];
  assert.equal((await f.service.status({operation_id:args.operation_id,refresh:true})).status,'outcome_unknown');
  rows=[pending,{...pending,order_id:'701'}];assert.equal((await f.service.status({operation_id:args.operation_id,refresh:true})).status,'outcome_unknown');
  rows=[pending];assert.equal((await f.service.status({operation_id:args.operation_id,refresh:true})).status,'order_observed');
  const cancel={operation_id:'qmt-cancel',original_operation_id:args.operation_id,user_authorized:true};
  rows=[{...pending,order_status:'56'}];assert.equal((await f.service.cancel({...cancel,operation_id:'already-filled'})).status,'rejected');assert.equal(cancels,0);
  rows=[pending];assert.equal((await f.service.cancel(cancel)).status,'cancel_requested');assert.equal((await f.service.cancel(cancel)).status,'cancel_requested');assert.equal(cancels,1);
});
test('scope, user intent, and record ownership cannot be widened by the helper',async()=>{
  const f=fixture(),args=await prepared(f);
  await assert.rejects(f.service.execute({...args,user_authorized:false}),{code:'FORBIDDEN'});
  f.host.scope.kind='subagent';await assert.rejects(f.service.execute(args),{code:'FORBIDDEN'});
  f.host.scope.kind='main';f.host.scope.conversationId='other';await assert.rejects(f.service.execute(args),{code:'FORBIDDEN'});
});
test('adapter uses standard public ToolResult and refuses errors, truncation or implicit plugin activation',async()=>{
  assert.deepEqual(payload({details:{ok:true},content:[]}),{ok:true});
  assert.throws(()=>payload({isError:true,details:{ok:true}}),{code:'BACKEND_ERROR'});
  assert.throws(()=>payload({content:[{type:'text',text:'{"_tool_output_truncated":true}'}]}),{code:'SOURCE_DATA_INVALID'});
  const host={tools:{call:()=>assert.fail('must not call inactive plugin')},plugins:{isActive:()=>false}};
  await assert.rejects(createAdapters(host).identity('mt5'),{code:'PREREQUISITE_REQUIRED'});
});
test('native intent construction rejects unsupported features and passes final-mile guard to correct trading route',async()=>{
  const calls=[],host={tools:{call:async value=>{calls.push(value);return {details:{status:'returned'}};}},plugins:{isActive:()=>true}};
  const adapter=createAdapters(host),observation={backend:'mt5',symbol:'FIXTURE',account:{accountId:'42',server:'Fixture'},quote:{sourceTimeMs:1800000000000},expiresAt:1800000060000,spec:{volume_min:0.01,volume_max:10,volume_step:0.01,filling_mode:2,trade_exemode:2}};
  const args={operation_id:'fixture',backendCommandId:'manual-fixture-command',action:'market',side:'buy',quantity:'0.1',price_limit:'100',remark:'fixture'};
  await adapter.submit(observation,args);
  assert.equal(calls[0].name,'mt5_trade');assert.equal(calls[0].arguments.tool,'order_send');assert.equal(calls[0].arguments.arguments.execution_guard.expires_at,observation.expiresAt);assert.equal(calls[0].arguments.arguments.request.type_filling,'ORDER_FILLING_IOC');
  assert.throws(()=>adapter.orderRequest(observation,{...args,quantity:'0.015'}),{code:'INVALID_ARGUMENT'});
  const qmt={...observation,backend:'qmt'};
  assert.throws(()=>adapter.orderRequest(qmt,args),{code:'UNSUPPORTED_CAPABILITY'});
  assert.throws(()=>adapter.orderRequest(qmt,{...args,action:'limit',limit_price:'99',quantity:'100',stop_loss:'80'}),{code:'UNSUPPORTED_CAPABILITY'});
});
test('manifest, executable schemas and documented scope agree',async()=>{
  const host={tools:{Type,define:(name,description,properties,execute)=>({name,description,parameters:Type.Object(properties,{additionalProperties:false}),execute})},scope:{kind:'main'}};
  const tools=createTools(host),root=new URL('../packages/manual-trading/',import.meta.url),manifest=JSON.parse(await readFile(new URL('plugin.json',root))),schemas=JSON.parse(await readFile(new URL('tools.json',root)));
  assert.deepEqual(tools.map(x=>x.name),manifest.tool_names);assert.deepEqual(manifest.main_tool_names,manifest.tool_names);assert.equal(manifest.engines.sesame,'>=0.2.1');
  assert.deepEqual(tools.map(({name,description,parameters})=>JSON.parse(JSON.stringify({name,description,parameters}))),schemas);
  const shape=tools.find(t=>t.name==='manual_trade_execute').parameters;
  assert.equal(Value.Check(shape,{operation_id:'one',observation_id:'fixture',user_authorized:true,action:'market',side:'buy',quantity:'0.1',price_limit:'100'}),true);
  assert.equal(Value.Check(shape,{operation_id:'one',observation_id:'fixture',user_authorized:true,action:'market',side:'buy',quantity:'0.1',price_limit:'100',timeframe:'1m'}),false);
  for(const backend of ['mt5','qmt']){const m=JSON.parse(await readFile(new URL(`../packages/${backend}/plugin.json`,import.meta.url)));assert.ok(m.resources.includes('TRADING.md'));const doc=await readFile(new URL(`../packages/${backend}/TRADING.md`,import.meta.url),'utf8');assert.match(doc,/execution_guard/);assert.match(doc,/unknown/);}
});
