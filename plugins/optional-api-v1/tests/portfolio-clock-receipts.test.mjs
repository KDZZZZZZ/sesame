import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createAdapters} from '../packages/portfolio-execution/adapters.js';
import {createService} from '../packages/portfolio-execution/service.js';
import {records,closeRecords} from '../packages/portfolio-execution/records.js';
import {nativeAdapterFixture} from './portfolio-adapter-fixture.mjs';

function backendHost(execute){
  return {context:{kind:'main',sessionId:'fixture-clock-receipt'},plugins:{read:async()=>({state:'mounted',runtime_status:'ready'})},
    capabilities:{invoke:async(id,input)=>({type:'result',value:await execute(id.split('#')[1],input)})}};
}

const now=1792575202000,orderId='9007199254740993',dealId='9007199254740995',positionId='9007199254740997';
const nativeFailure={status:'failed',result:{result:null,last_error:[-2,'Terminal: Invalid params']}};
// Frozen pending-python/order-after-modify.json and order-history-final.json:
// preserve native values; replace ticket, symbol and comment with fixture IDs.
const observedActive={ticket:orderId,time_setup:1792591575,time_setup_msc:1792591575157,time_done:0,time_done_msc:0,time_expiration:0,
  type:2,type_time:0,type_filling:2,state:1,magic:'0',position_id:'0',position_by_id:0,reason:3,volume_initial:0.01,volume_current:0.01,
  price_open:156.901,sl:156.601,tp:157.201,price_current:158.01,price_stoplimit:0,symbol:'FIXTURE',comment:'test-owned',external_id:''};
const observedCanceled={...observedActive,time_done:1792591796,time_done_msc:1792591796372,state:2,price_current:158.009};
function fixture(){
  const record={backend:'mt5',account:{accountId:'42',server:'FTMO-Demo',revision:'1'},symbol:'FIXTURE',createdAt:now,backendCommandId:'test-command',remark:'test-owned',action:'market',side:'buy'};
  const fill={ticket:dealId,order:orderId,position_id:positionId,symbol:record.symbol,comment:record.remark,type:0,volume:0.1,time_msc:now+10800000};
  const historyOrder={ticket:orderId,position_id:positionId,symbol:record.symbol,comment:record.remark};
  const state={version:1,account:{login:'42',server:'FTMO-Demo'},command:{status:'returned',result:{result:{retcode:10009,order:orderId,deal:dealId}}},
    historyOrders:[historyOrder],orders:[],positions:[],deals:[fill],calls:[],failures:{}};
  const host=backendHost(async(name,args)=>{
    state.calls.push({name,...structuredClone(args)});
    if(name==='mt5_settings')return {settings:{version:state.version,account:{login:'42',server:'FTMO-Demo'}}};
    if(name==='mt5_command')return structuredClone(state.command);
    assert.equal(name,'mt5_python');assert.notEqual(args.tool,'order_send');
    await state.onRead?.(args.tool,args.arguments);
    if(state.failures[args.tool])return structuredClone(state.failures[args.tool]);
    // Reproduce the observed SDK 5.0.6231 ticket-selector failure. The order
    // history selector and the independently proved position selector work.
    if(args.tool==='history_deals_get' && Object.hasOwn(args.arguments,'ticket'))return structuredClone(nativeFailure);
    const values={account_info:state.account,orders_get:state.orders,positions_get:state.positions,history_orders_get:state.historyOrders,history_deals_get:state.deals};
    assert.ok(Object.hasOwn(values,args.tool),'Unexpected native method '+args.tool);
    return {status:'returned',result:{result:structuredClone(values[args.tool]),last_error:[1,'Success']}};
  });
  nativeAdapterFixture(host,{now:()=>now});
  return {host,state,record,fill,historyOrder,queries:tool=>state.calls.filter(call=>call.tool===tool).map(call=>call.arguments),
    status:signal=>createAdapters(host,{now:()=>now}).status(record,signal)};
}

test('observed active pending order refresh avoids the historical selector that rejected it',async()=>{
  const f=fixture();f.record.action='limit';f.state.orders=[structuredClone(observedActive)];
  f.state.failures.history_orders_get=nativeFailure;
  const result=await f.status();
  assert.deepEqual(result.orders,[observedActive]);assert.deepEqual(result.historicalOrders,[]);
  assert.deepEqual(f.queries('history_orders_get'),[]);assert.deepEqual(f.queries('history_deals_get'),[]);
  assert.match(result.coverage,/not queried/i);assert.deepEqual(result.command,f.state.command);
});

test('current orders and positions are scheduled together before conditional history',async()=>{
  const f=fixture();let releaseOrders,positionsStarted;
  const ordersGate=new Promise(resolve=>{releaseOrders=resolve;}),positionsGate=new Promise(resolve=>{positionsStarted=resolve;});
  f.state.onRead=method=>{if(method==='orders_get')return ordersGate;if(method==='positions_get')positionsStarted();};
  const pending=f.status();
  try {await positionsGate;assert.deepEqual(f.queries('history_orders_get'),[]);}
  finally {releaseOrders();}
  assert.deepEqual((await pending).historicalOrders,[f.historyOrder]);
  assert.deepEqual(f.queries('history_orders_get'),[{ticket:orderId}]);
});

test('observed canceled history survives refresh without rewriting original order or cancellation receipts',async t=>{
  for(const kind of ['order','cancel'])await t.test(kind,async t=>{
    const f=fixture();f.record.action='limit';f.state.historyOrders=[structuredClone(observedCanceled)];
    f.host.context.storageRoot=mkdtempSync(join(tmpdir(),'portfolio-clock-receipt-'));
    t.after(()=>{closeRecords(f.host);const root=resolve(f.host.context.storageRoot);assert.ok(root.startsWith(resolve(tmpdir(),'portfolio-clock-receipt-')));rmSync(root,{recursive:true,force:true});});
    const original={...f.record,id:'fixture-original',kind:'order',conversationId:f.host.context.sessionId,status:'execution_reported',receipt:structuredClone(f.state.command)};
    records(f.host).put('commands',original);
    const operation=kind==='order'?original:{...original,id:'fixture-cancel',kind:'cancel',originalOperationId:original.id,status:'cancel_requested'};
    if(kind==='cancel')records(f.host).put('commands',operation);
    const result=await createService(f.host,{now:()=>now}).status({operation_id:operation.id,refresh:true});
    assert.equal(result.status,operation.status);assert.deepEqual(result.receipt,operation.receipt);
    assert.deepEqual(result.evidence.historicalOrders,[observedCanceled]);assert.equal(result.evidence.historicalOrders[0].state,2);
    assert.deepEqual(result.evidence.orders,[]);assert.deepEqual(result.evidence.deals,[]);
    assert.deepEqual(f.queries('history_orders_get'),[{ticket:orderId}]);assert.deepEqual(f.queries('history_deals_get'),[]);
    assert.match(result.evidence.coverage,/position.*unverified/i);
  });
});

test('missing current and historical order preserves uncertainty instead of asserting cancellation',async()=>{
  const f=fixture();f.state.historyOrders=[];
  const result=await f.status();
  assert.deepEqual(result.orders,[]);assert.deepEqual(result.historicalOrders,[]);assert.deepEqual(result.deals,[]);
  assert.match(result.coverage,/do not prove/i);assert.deepEqual(f.queries('history_deals_get'),[]);
  assert.deepEqual(result.command,f.state.command);assert.equal(Object.hasOwn(result,'status'),false);
});

test('known order resolves a different native position ID and returns only that order fills despite server-wall history',async()=>{
  const f=fixture();
  f.state.deals.push({...f.fill,ticket:'9007199254740999',order:'9007199254741001',comment:f.record.remark});
  f.state.deals.push({...f.fill,ticket:'9007199254741003',type:2});
  f.state.deals.push({...f.fill,ticket:'9007199254741005',position_id:'9007199254741007'});
  const result=await f.status();
  assert.deepEqual(f.queries('history_orders_get'),[{ticket:orderId}]);
  assert.deepEqual(f.queries('history_deals_get'),[{position:positionId}]);assert.notEqual(positionId,orderId);
  assert.deepEqual(result.historicalOrders,[f.historyOrder]);
  assert.deepEqual(result.deals,[f.fill]);assert.equal(result.deals[0].time_msc,now+10800000);
  assert.ok(f.state.calls.findIndex(call=>call.tool==='history_orders_get')<f.state.calls.findIndex(call=>call.tool==='history_deals_get'));
});

test('partially filled pending order uses its real position and only its own fills without querying history orders',async()=>{
    const f=fixture();f.record.action='limit';f.state.failures.history_orders_get=nativeFailure;
    const active={ticket:orderId,position_id:positionId,symbol:f.record.symbol,comment:f.record.remark,type:2,state:3,volume_current:0.05};
    f.state.orders=[active];
    f.state.deals.push({...f.fill,ticket:'9007199254740999',order:'9007199254741001',comment:f.record.remark});
    const result=await f.status();
    assert.deepEqual(f.queries('history_orders_get'),[]);assert.deepEqual(result.historicalOrders,[]);
    assert.deepEqual(f.queries('history_deals_get'),[{position:positionId}]);assert.deepEqual(result.orders,[active]);assert.deepEqual(result.deals,[f.fill]);
});

test('unproved position identity retains uncertainty without scanning account history or assuming order equals position',async t=>{
  for(const row of [null,{position_id:'0'},{position_id:0},{}, {position_id:null}])await t.test(JSON.stringify(row),async()=>{
    const f=fixture();f.state.historyOrders=row?[{...f.historyOrder,position_id:undefined,...row}]:[];
    f.state.positions=[{ticket:orderId,identifier:positionId,symbol:f.record.symbol,comment:f.record.remark}];
    const result=await f.status();
    assert.deepEqual(f.queries('history_deals_get'),[]);assert.deepEqual(result.deals,[]);
    assert.match(result.coverage,/position.*unverified/i);assert.match(result.coverage,/not queried/i);
    assert.match(result.coverage,/do not prove/i);
    assert.equal(f.queries('account_info').length,2);assert.equal(f.state.calls.filter(call=>call.name==='mt5_settings').length,2);
  });
});

test('wrong or ambiguous native order-position identities fail closed before querying deals',async t=>{
  const cases=[
    ['wrong historical ticket',f=>{f.state.historyOrders[0].ticket=dealId;}],
    ['wrong historical symbol',f=>{f.state.historyOrders[0].symbol='OTHER';}],
    ['duplicate history',f=>{f.state.historyOrders.push({...f.historyOrder});}],
    ['invalid position',f=>{f.state.historyOrders[0].position_id='invalid';}],
    ['wrong current symbol',f=>{f.state.orders=[{...observedActive,symbol:'OTHER'}];}],
    ['invalid current position',f=>{f.state.orders=[{...observedActive,position_id:'invalid'}];}],
    ['inactive current pending order',f=>{f.record.action='limit';f.state.orders=[{...observedCanceled}];}],
    ['wrong current pending side',f=>{f.record.action='limit';f.state.orders=[{...observedActive,type:3}];}],
    ['duplicate active order',f=>{f.state.orders=[{...f.historyOrder},{...f.historyOrder}];}],
    ['malformed current orders',f=>{f.state.orders={};}],
    ['malformed positions',f=>{f.state.positions={};}],
    ['malformed history',f=>{f.state.historyOrders={};}],
  ];
  for(const [name,change]of cases)await t.test(name,async()=>{
    const f=fixture();change(f);await assert.rejects(f.status(),{code:'SOURCE_DATA_INVALID'});assert.deepEqual(f.queries('history_deals_get'),[]);
  });
});

test('necessary native reads retain their exact SDK error instead of returning partial success',async t=>{
  for(const method of ['orders_get','positions_get','history_orders_get','history_deals_get'])await t.test(method,async()=>{
    const f=fixture();f.state.failures[method]=nativeFailure;
    await assert.rejects(f.status(),error=>error.code==='SOURCE_UNAVAILABLE' && error.details.method===method && error.details.nativeCode===-2 && error.details.nativeMessage==='Terminal: Invalid params');
    if(method!=='history_deals_get')assert.deepEqual(f.queries('history_deals_get'),[]);
    if(['orders_get','positions_get'].includes(method))assert.deepEqual(f.queries('history_orders_get'),[]);
  });
});

test('active partial order does not hide a necessary deal-history failure',async()=>{
  const f=fixture();f.record.action='limit';f.state.orders=[{...observedActive,state:3,position_id:positionId}];
  f.state.failures.history_deals_get=nativeFailure;
  await assert.rejects(f.status(),error=>error.code==='SOURCE_UNAVAILABLE' && error.details.method==='history_deals_get' && error.details.nativeCode===-2);
  assert.deepEqual(f.queries('history_orders_get'),[]);
});

test('position-history recovery preserves final native account and configuration checks',async t=>{
  for(const field of ['account','configuration'])await t.test(field,async()=>{
    const f=fixture();f.state.onRead=method=>{if(method==='history_deals_get'){if(field==='account')f.state.account.login='other';else f.state.version++;}};
    await assert.rejects(f.status(),{code:field==='account'?'ACCOUNT_MISMATCH':'CONNECTION_CHANGED'});
  });
});

test('active and historical order-only recovery preserves final account and configuration checks',async t=>{
  for(const source of ['current','history'])for(const field of ['account','configuration'])await t.test(`${source} ${field}`,async()=>{
    const f=fixture();f.record.action='limit';
    if(source==='current')f.state.orders=[{...observedActive}];else f.state.historyOrders=[{...observedCanceled}];
    f.state.onRead=method=>{if(method===(source==='current'?'orders_get':'history_orders_get')){if(field==='account')f.state.account.login='other';else f.state.version++;}};
    await assert.rejects(f.status(),{code:field==='account'?'ACCOUNT_MISMATCH':'CONNECTION_CHANGED'});
  });
});

test('cancellation during current reads prevents history reads and a successful recovery result',async()=>{
  const f=fixture(),controller=new AbortController(),reason=new Error('Fixture cancelled');
  f.state.onRead=method=>{if(method==='positions_get')controller.abort(reason);};
  await assert.rejects(f.status(controller.signal),error=>error===reason);
  assert.deepEqual(f.queries('history_orders_get'),[]);assert.deepEqual(f.queries('history_deals_get'),[]);
});

test('a deal ID alone is never passed as the SDK history order-ticket selector',async()=>{
  const f=fixture();f.state.command.result.result={retcode:10012,order:'0',deal:dealId};f.state.deals=[{...f.fill,comment:'broker-replaced'}];
  const result=await f.status();
  assert.deepEqual(f.queries('history_orders_get'),[]);
  assert.deepEqual(f.queries('history_deals_get'),[{date_from:new Date(now-60000).toISOString(),date_to:new Date(now+1000).toISOString()}]);assert.deepEqual(result.deals,f.state.deals);
});

test('zero order and deal IDs keep the original bounded UTC branch and do not match non-trade entries',async()=>{
  const f=fixture();f.state.command.result.result={retcode:10012,order:0,deal:'0'};
  f.state.deals=[{...f.fill,order:'0'},{...f.fill,ticket:'0'},{...f.fill,type:2},{...f.fill,symbol:'OTHER'}];
  const result=await f.status();
  assert.deepEqual(f.queries('history_orders_get'),[]);
  assert.deepEqual(f.queries('history_deals_get'),[{date_from:new Date(now-60000).toISOString(),date_to:new Date(now+1000).toISOString()}]);assert.deepEqual(result.deals,[]);
});
