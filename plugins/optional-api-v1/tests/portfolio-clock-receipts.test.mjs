import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdapters} from '../packages/portfolio-execution/adapters.js';

function backendHost(execute){
  return {context:{kind:'main',sessionId:'fixture-clock-receipt'},plugins:{read:async()=>({state:'mounted',runtime_status:'ready'})},
    capabilities:{invoke:async(id,input)=>({type:'result',value:await execute(id.split('#')[1],input)})}};
}

const now=1792575202000,orderId='9007199254740993',dealId='9007199254740995',positionId='9007199254740997';
const nativeFailure={status:'failed',result:{result:null,last_error:[-2,'Terminal: Invalid params']}};
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
  return {state,record,fill,historyOrder,queries:tool=>state.calls.filter(call=>call.tool===tool).map(call=>call.arguments),
    status:()=>createAdapters(host,{now:()=>now}).status(record)};
}

test('known order resolves a different native position ID and returns only that order fills despite server-wall history',async()=>{
  const f=fixture();
  f.state.deals.push({...f.fill,ticket:'9007199254740999',order:'9007199254741001',comment:f.record.remark});
  f.state.deals.push({...f.fill,ticket:'9007199254741003',type:2});
  const result=await f.status();
  assert.deepEqual(f.queries('history_orders_get'),[{ticket:orderId}]);
  assert.deepEqual(f.queries('history_deals_get'),[{position:positionId}]);assert.notEqual(positionId,orderId);
  assert.deepEqual(result.deals,[f.fill]);assert.equal(result.deals[0].time_msc,now+10800000);
  assert.ok(f.state.calls.findIndex(call=>call.tool==='history_orders_get')<f.state.calls.findIndex(call=>call.tool==='history_deals_get'));
});

test('partially filled pending order can prove its position before a matching history order exists',async t=>{
  for(const historic of [[],[{ticket:orderId,symbol:'FIXTURE',position_id:'0'}]])await t.test(historic.length?'zero historical position':'not in history',async()=>{
    const f=fixture();f.record.action='limit';f.state.historyOrders=historic;
    const active={ticket:orderId,position_id:positionId,symbol:f.record.symbol,comment:f.record.remark,type:2,state:3,volume_current:0.05};
    f.state.orders=[active];
    const result=await f.status();
    assert.deepEqual(f.queries('history_deals_get'),[{position:positionId}]);assert.deepEqual(result.orders,[active]);assert.deepEqual(result.deals,[f.fill]);
  });
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

test('wrong or conflicting native order-position identities fail closed before querying deals',async t=>{
  const cases=[
    ['wrong historical ticket',f=>{f.state.historyOrders[0].ticket=dealId;}],
    ['wrong historical symbol',f=>{f.state.historyOrders[0].symbol='OTHER';}],
    ['duplicate history',f=>{f.state.historyOrders.push({...f.historyOrder});}],
    ['invalid position',f=>{f.state.historyOrders[0].position_id='invalid';}],
    ['conflicting position',f=>{f.state.orders=[{...f.historyOrder,position_id:'9007199254741001'}];}],
    ['duplicate active order',f=>{f.state.orders=[{...f.historyOrder},{...f.historyOrder}];}],
    ['malformed history',f=>{f.state.historyOrders={};}],
  ];
  for(const [name,change]of cases)await t.test(name,async()=>{
    const f=fixture();change(f);await assert.rejects(f.status(),{code:'SOURCE_DATA_INVALID'});assert.deepEqual(f.queries('history_deals_get'),[]);
  });
});

test('failed native order or position-history reads retain their exact SDK error instead of returning partial success',async t=>{
  for(const method of ['history_orders_get','history_deals_get'])await t.test(method,async()=>{
    const f=fixture();f.state.failures[method]=nativeFailure;f.state.orders=[{...f.historyOrder}];
    await assert.rejects(f.status(),error=>error.code==='SOURCE_UNAVAILABLE' && error.details.method===method && error.details.nativeCode===-2 && error.details.nativeMessage==='Terminal: Invalid params');
    if(method==='history_orders_get')assert.deepEqual(f.queries('history_deals_get'),[]);
  });
});

test('position-history recovery preserves final native account and configuration checks',async t=>{
  for(const field of ['account','configuration'])await t.test(field,async()=>{
    const f=fixture();f.state.onRead=method=>{if(method==='history_deals_get'){if(field==='account')f.state.account.login='other';else f.state.version++;}};
    await assert.rejects(f.status(),{code:field==='account'?'ACCOUNT_MISMATCH':'CONNECTION_CHANGED'});
  });
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
