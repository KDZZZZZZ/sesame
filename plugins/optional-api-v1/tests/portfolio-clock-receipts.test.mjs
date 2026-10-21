import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdapters} from '../packages/portfolio-execution/adapters.js';

function backendHost(execute){
  return {context:{kind:'main',sessionId:'fixture-clock-receipt'},plugins:{read:async()=>({state:'mounted',runtime_status:'ready'})},
    capabilities:{invoke:async(id,input)=>({type:'result',value:await execute(id.split('#')[1],input)})}};
}

test('MT5 receipt lookup uses the positive order ID even when server history is outside the UTC window',async()=>{
  const now=1792575202000,orderId='9007199254740993',dealId='9007199254740995',queries=[];
  const record={backend:'mt5',account:{accountId:'42',server:'FTMO-Demo',revision:'1'},symbol:'FIXTURE',createdAt:now,backendCommandId:'test-command',remark:'test-owned',action:'market'};
  const fill={ticket:dealId,order:orderId,symbol:'FIXTURE',comment:'test-owned',type:0,time_msc:now+10800000};
  const host=backendHost(async(name,args)=>{
    if(name==='mt5_settings')return {settings:{version:1,account:{login:'42',server:'FTMO-Demo'}}};
    if(name==='mt5_command')return {status:'returned',result:{result:{retcode:10009,order:orderId,deal:dealId}}};
    assert.equal(name,'mt5_python');
    if(args.tool==='history_deals_get'){queries.push(args.arguments);return {status:'returned',result:{result:args.arguments.ticket===orderId?[fill]:[]}};}
    return {status:'returned',result:{result:args.tool==='account_info'?{login:'42',server:'FTMO-Demo'}:[]}};
  });
  const result=await createAdapters(host,{now:()=>now}).status(record);
  assert.deepEqual(queries,[{ticket:orderId}]);assert.deepEqual(result.deals,[fill]);
});

test('a deal ID alone is never passed as the SDK history order-ticket selector',async()=>{
  const now=1792575202000,queries=[];
  const record={backend:'mt5',account:{accountId:'42',server:'FTMO-Demo',revision:'1'},symbol:'FIXTURE',createdAt:now,backendCommandId:'test-command',remark:'owned',action:'market'};
  const host=backendHost(async(name,args)=>{
    if(name==='mt5_settings')return {settings:{version:1,account:{login:'42',server:'FTMO-Demo'}}};
    if(name==='mt5_command')return {status:'returned',result:{result:{retcode:10012,order:'0',deal:'9007199254740995'}}};
    assert.equal(name,'mt5_python');if(args.tool==='history_deals_get')queries.push(args.arguments);
    return {status:'returned',result:{result:args.tool==='account_info'?{login:'42',server:'FTMO-Demo'}:[]}};
  });
  const result=await createAdapters(host,{now:()=>now}).status(record);
  assert.deepEqual(queries,[{date_from:new Date(now-60000).toISOString(),date_to:new Date(now+1000).toISOString()}]);assert.deepEqual(result.deals,[]);
});
