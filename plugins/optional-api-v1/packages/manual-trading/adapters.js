import { randomUUID } from 'node:crypto';
import { Decimal } from '@sesame/plugin-sdk/decimal';
import { canonical } from '@sesame/plugin-sdk/protocol';

export const check = (ok, code, message) => { if (!ok) throw Object.assign(new Error(message), { code }); };
export const sameAccount=(a,b)=>a?.accountId===b?.accountId && typeof a?.accountId==='string' && (typeof a.server==='string'?a.server===b.server && b.connectionId===undefined:typeof a.connectionId==='string' && a.connectionId===b.connectionId && b.server===undefined);
export const decimal = value => { const v=String(value); check(v.length<=40 && /^(0|[1-9]\d*)(\.\d+)?$/.test(v) && Decimal.compare(v,'0')>0,'SOURCE_DATA_INVALID','Expected a positive decimal amount'); return v; };
// MT5 uses zero IDs when a timed-out request has no confirmed order/deal. Zero
// must never join unrelated history (such as balance/credit adjustments).
const nativeId=value=>typeof value==='string' && /^[1-9]\d{0,19}$/.test(value)?value:typeof value==='number' && Number.isSafeInteger(value) && value>0?String(value):null;
const positive=value=>['string','number'].includes(typeof value) && Number.isFinite(Number(value)) && Number(value)>0;
const mt5Pending=(row,record)=>String(row.type)===(record.side==='buy'?'2':'3') && ['1','3'].includes(String(row.state)) && positive(row.volume_current);
const qmtOwned=(row,record,remark)=>typeof remark==='string' && remark.length>0 && row.account_id===record.account.accountId && row.stock_code===record.symbol && row.order_remark===remark && nativeId(row.order_id)!==null && String(row.order_type)===(record.side==='buy'?'23':'24');
const qmtPending=row=>['48','49','50','55'].includes(String(row.order_status)) && positive(row.order_volume) && Number(row.traded_volume)>=0 && Number(row.traded_volume)<Number(row.order_volume);
export function payload(result) {
  check(!result?.isError,'BACKEND_ERROR','Backend tool returned an error; inspect its receipt');
  if (result && Object.hasOwn(result,'details')) return result.details;
  if (result?.content) {
    const blocks=result.content.filter(x=>x.type==='text');
    check(blocks.length===1,'SOURCE_DATA_INVALID','Expected a single backend JSON result');
    const data=JSON.parse(blocks[0].text); check(!data?._tool_output_truncated,'SOURCE_DATA_INVALID','Backend JSON was truncated'); return data;
  }
  return result;
}
export function createAdapters(host, {now=Date.now}={}) {
  async function call(backend,name,args,signal) {
    const pluginId=`sesame/${backend}`;
    check(typeof host.tools.call==='function','PREREQUISITE_REQUIRED','This host needs the public tools.call plugin composition port');
    check(host.plugins.isActive(pluginId),'PREREQUISITE_REQUIRED',`Load ${pluginId} in this conversation first; disabled plugins are not enabled automatically`);
    return payload(await host.tools.call({pluginId,name,arguments:args},signal));
  }
  async function py(method,args,signal,commandId=`manual-read-${randomUUID()}`) {
    const command=await call('mt5',method==='order_send'?'mt5_trade':'mt5_python',{server:'python',tool:method,arguments:args,command_id:commandId},signal);
    check(command?.status==='returned' && !command.result?.error && command.result?.result!==null && command.result?.result!==undefined,'SOURCE_UNAVAILABLE',`MT5 ${method} did not return a confirmed result`);
    return command.result.result;
  }
  async function identity(backend,signal) {
    if(backend==='mt5') {
      const {settings}=await call('mt5','mt5_settings',{},signal);
      check(settings?.account?.login && settings.account.server,'PREREQUISITE_REQUIRED','MT5 account must already be configured');
      return {accountId:String(settings.account.login),server:settings.account.server,revision:String(settings.version)};
    }
    const {configuration:c}=await call('qmt','qmt_environment',{action:'inspect'},signal);
    check(c?.account_id && c.connection_id,'PREREQUISITE_REQUIRED','QMT account must already be configured');
    return {accountId:c.account_id,connectionId:c.connection_id,revision:String(c.version)};
  }
  async function snapshot(backend,symbol,signal) {
    const began=now(), account=await identity(backend,signal);
    if(backend==='mt5') {
      const catalog=await call('mt5','mt5_catalog',{server:'python',query:'order_send'},signal);
      const order=catalog.items?.find(x=>x.server==='python')?.tools?.find(x=>x.name==='order_send');
      check(order?.callable && order.inputSchema?.properties?.execution_guard,'PREREQUISITE_REQUIRED','Use sesame/mt5 1.3.0+ with a connected Python SDK and execution_guard; pure MCP quotes do not establish UTC freshness');
      const [info,terminal,spec,positions]=await Promise.all([py('account_info',{},signal),py('terminal_info',{},signal),py('symbol_info',{symbol},signal),py('positions_get',{symbol},signal)]);
      check(String(info.login)===account.accountId && info.server===account.server,'ACCOUNT_MISMATCH','MT5 current account differs from configured account');
      check(terminal.connected===true,'SOURCE_UNAVAILABLE','MT5 is not connected to its broker');
      check(spec.name===symbol && Array.isArray(positions),'SOURCE_DATA_INVALID','Native symbol/positions omitted');
      const quote=await quoteFor(backend,symbol,signal);
      return {account,symbol,spec,positions,quote,readStartedAt:began,capturedAt:now(),captureMs:now()-began,accountSummary:{balance:info.balance??null,equity:info.equity??null,currency:info.currency??null,tradeAllowed:info.trade_allowed===true && info.trade_expert===true}};
    }
    // Older QMT packages must not silently discard the final-mile guard.
    const installed=host.plugins.inspect('sesame/qmt');
    check(/^1\.(?:[2-9]|[1-9]\d)\./.test(installed?.version??''),'PREREQUISITE_REQUIRED','Use sesame/qmt 1.2.0+ with native execution guards');
    const [specResult,asset,positions]=await Promise.all([call('qmt','qmt_read',{action:'describe',symbols:[symbol]},signal),call('qmt','qmt_read',{action:'asset'},signal),call('qmt','qmt_read',{action:'positions',page:{limit:200}},signal)]);
    for(const read of [specResult,asset,positions]) check(read.connection?.id===account.connectionId && read.connection.revision===account.revision,'CONNECTION_CHANGED','QMT connection changed during observation');
    check(specResult.items?.length===1 && specResult.items[0].symbol===symbol && !positions.nextCursor,'SOURCE_DATA_INVALID','Incomplete native symbol/positions snapshot; narrow the account before automated preflight');
    check(String(asset.asset?.account_id)===account.accountId,'ACCOUNT_MISMATCH','QMT asset belongs to another account');
    const quote=await quoteFor(backend,symbol,signal);
    return {account,symbol,spec:specResult.items[0].detail,positions:positions.items,quote,readStartedAt:began,capturedAt:now(),captureMs:now()-began,accountSummary:asset.asset};
  }
  async function quoteFor(backend,symbol,signal) {
    const startedAt=now();
    const tick=backend==='mt5'?await py('symbol_info_tick',{symbol},signal):(await call('qmt','qmt_read',{action:'quotes',symbols:[symbol]},signal)).items?.find(x=>x.symbol===symbol)?.tick;
    const sourceTimeMs=Number(backend==='mt5'?tick?.time_msc:tick?.time);
    check(Number.isSafeInteger(sourceTimeMs) && sourceTimeMs>=1000000000000,'SOURCE_DATA_INVALID','Quote has no verified UTC epoch milliseconds; reception time is not source time');
    return {sourceTimeMs,receivedAt:now(),requestMs:now()-startedAt,bid:decimal(backend==='mt5'?tick?.bid:tick?.bidPrice?.[0]),ask:decimal(backend==='mt5'?tick?.ask:tick?.askPrice?.[0])};
  }
  const guardFor=(observation,args)=>({observed_at:observation.quote.sourceTimeMs,expires_at:observation.expiresAt,max_quote_age_ms:5000,max_quote_to_send_ms:1000,price_limit:args.price_limit});
  function orderRequest(observation,args) {
    const {spec,symbol}=observation, volume=decimal(args.quantity), limit=decimal(args.price_limit);
    check(['buy','sell'].includes(args.side),'INVALID_ARGUMENT','Choose buy or sell');
    check(['market','limit','close'].includes(args.action),'INVALID_ARGUMENT','Unsupported order action');
    check(args.action==='limit'||args.limit_price===undefined,'INVALID_ARGUMENT','limit_price is only valid for limit orders');
    check(args.action==='close'||args.position_id===undefined,'INVALID_ARGUMENT','position_id is only valid for close');
    if(args.action==='close') check(args.position_id && observation.backend==='mt5','UNSUPPORTED_CAPABILITY','Close targets a MT5 position ticket; QMT reductions use sell quantity');
    if(args.action==='limit') {
      const price=decimal(args.limit_price);
      check(args.side==='buy'?Decimal.compare(price,limit)<=0:Decimal.compare(price,limit)>=0,'INVALID_ARGUMENT','Limit price crossed authorized boundary');
    }
    if(observation.backend==='qmt') {
      check(args.action==='limit' && /^[1-9]\d*$/.test(volume),'UNSUPPORTED_CAPABILITY','QMT supports only limit orders for positive integer STOCK shares');
      check(args.stop_loss===undefined && args.take_profit===undefined,'UNSUPPORTED_CAPABILITY','QMT does not provide attached stop loss or take profit through these tools');
      return {operation_id:args.operation_id,user_authorized:true,account_id:observation.account.accountId,connection_revision:observation.account.revision,symbol,side:args.side,shares:volume,price:args.limit_price,execution_guard:guardFor(observation,args)};
    }
    check(Decimal.compare(volume,decimal(spec.volume_min))>=0 && Decimal.compare(volume,decimal(spec.volume_max))<=0 && Decimal.compare(Decimal.quantize(volume,decimal(spec.volume_step),'floor'),volume)===0,'INVALID_ARGUMENT','Quantity violates native lot minimum, maximum or step');
    check(Number.isFinite(Number(volume)) && Number(volume)>0,'INVALID_ARGUMENT','Native volume cannot represent this amount');
    // Choose only an actually supported fill policy. Pending orders use RETURN;
    // market IOC/FOK comes from SYMBOL_FILLING_MODE bit flags, not guessed enums.
    const fill=args.action==='limit'?'ORDER_FILLING_RETURN':(Number(spec.filling_mode)&2)?'ORDER_FILLING_IOC':(Number(spec.filling_mode)&1)?'ORDER_FILLING_FOK':Number(spec.trade_exemode)!==2?'ORDER_FILLING_RETURN':null;
    check(fill,'UNSUPPORTED_CAPABILITY','No supported native filling mode');
    const request={action:args.action==='limit'?'TRADE_ACTION_PENDING':'TRADE_ACTION_DEAL',symbol,volume:Number(volume),type:args.side==='buy'?(args.action==='limit'?'ORDER_TYPE_BUY_LIMIT':'ORDER_TYPE_BUY'):(args.action==='limit'?'ORDER_TYPE_SELL_LIMIT':'ORDER_TYPE_SELL'),type_filling:fill,type_time:'ORDER_TIME_GTC',deviation:0,comment:args.remark};
    if(args.action==='limit') request.price=Number(args.limit_price);
    if(args.action==='close') request.position=args.position_id;
    if(args.stop_loss!==undefined) request.sl=Number(decimal(args.stop_loss));
    if(args.take_profit!==undefined) request.tp=Number(decimal(args.take_profit));
    return {server:'python',tool:'order_send',arguments:{request,execution_guard:{...guardFor(observation,args),side:args.side,expected_account:observation.account.accountId,expected_server:observation.account.server}},command_id:args.backendCommandId};
  }
  async function submit(observation,args,signal) {
    const request=orderRequest(observation,args);
    return await call(observation.backend,observation.backend==='mt5'?'mt5_trade':'qmt_order',request,signal);
  }
  async function status(record,signal,expectedCurrent) {
    const backend=record.backend,current=await identity(backend,signal);
    check(sameAccount(current,record.account),'CONNECTION_CHANGED','Cannot recover against a different account or connection');
    check(!expectedCurrent || canonical(current)===canonical(expectedCurrent),'CONNECTION_CHANGED','Configuration changed before recovery reads');
    const verifyConfiguration=async()=>check(canonical(await identity(backend,signal))===canonical(current),'CONNECTION_CHANGED','Configuration changed during recovery reads');
    const command=await call(backend,backend==='mt5'?'mt5_command':'qmt_command',backend==='mt5'?{command_id:record.backendCommandId}:{operation_id:record.id},signal);
    if(backend==='mt5') {
      const verifyNativeAccount=async()=>{const info=await py('account_info',{},signal);check(String(info.login)===record.account.accountId && info.server===record.account.server,'ACCOUNT_MISMATCH','Do not recover an order against a different logged-in account');};
      await verifyNativeAccount();
      const [orders,deals,positions]=await Promise.all([py('orders_get',{symbol:record.symbol},signal),py('history_deals_get',{date_from:new Date(record.createdAt-60000).toISOString(),date_to:new Date(now()+1000).toISOString()},signal),py('positions_get',{symbol:record.symbol},signal)]);
      await verifyNativeAccount();await verifyConfiguration();
      const orderId=nativeId(command.result?.result?.order), dealId=nativeId(command.result?.result?.deal);
      const ownSymbol=x=>x.symbol===record.symbol,ownRemark=x=>typeof record.remark==='string' && record.remark.length>0 && x.comment===record.remark;
      const matchesDeal=x=>ownSymbol(x) && ['0','1'].includes(String(x.type)) && nativeId(x.ticket)!==null && nativeId(x.order)!==null && (ownRemark(x) || orderId!==null && nativeId(x.order)===orderId || dealId!==null && nativeId(x.ticket)===dealId);
      return {command,orders:orders.filter(x=>ownSymbol(x) && nativeId(x.ticket)!==null && (ownRemark(x) || orderId!==null && nativeId(x.ticket)===orderId) && (record.action!=='limit'||mt5Pending(x,record))),deals:deals.filter(matchesDeal),positions:positions.filter(x=>ownSymbol(x) && nativeId(x.ticket)!==null && ownRemark(x)),coverage:'Native queried range; missing matches do not prove no order was sent'};
    }
    const reads=await Promise.all(['orders','fills'].map(action=>call('qmt','qmt_read',{action,page:{limit:200}},signal)));
    for(const read of reads) check(read.connection?.id===current.connectionId && read.connection.revision===current.revision,'CONNECTION_CHANGED','Cannot recover against a different QMT connection');
    await verifyConfiguration();
    return {command,orders:reads[0].items.filter(x=>qmtOwned(x,record,command.remark) && qmtPending(x)),deals:reads[1].items.filter(x=>qmtOwned(x,record,command.remark) && typeof x.traded_id==='string' && x.traded_id.length>0 && positive(x.traded_volume)),coverage:reads.some(x=>x.nextCursor)?'truncated_current_day':'current_trading_day_only',complete:false};
  }
  const command=(record,signal)=>call(record.backend,record.backend==='mt5'?'mt5_command':'qmt_command',record.backend==='mt5'?{command_id:record.backendCommandId}:{operation_id:record.id},signal);
  async function cancel(record,operationId,signal) {
    let request;
    try {
    const identityNow=await identity(record.backend,signal);
    check(sameAccount(identityNow,record.account),'CONNECTION_CHANGED','Cancellation account/connection changed');
    check(record.action==='limit','UNCONFIRMED_ORDER','Cancellation requires a pending limit order');
    const original=await call(record.backend,record.backend==='mt5'?'mt5_command':'qmt_command',record.backend==='mt5'?{command_id:record.backendCommandId}:{operation_id:record.id},signal);
    if(record.backend==='qmt') {
      check(original.status==='submitted'||original.status==='outcome_unknown'&&original.intent?.symbol===record.symbol&&original.intent?.side===record.side&&original.intent?.shares===record.quantity,'UNCONFIRMED_ORDER','Stored QMT order intent cannot establish a recoverable cancellation');
      const read=await call('qmt','qmt_read',{action:'orders',page:{limit:200}},signal);
      check(read.connection?.id===identityNow.connectionId && read.connection.revision===identityNow.revision,'CONNECTION_CHANGED','QMT cancellation connection changed');
      check(!read.nextCursor,'SOURCE_DATA_INVALID','Cannot prove a unique pending order from a partial order page');
      const candidates=read.items.filter(x=>qmtOwned(x,record,original.remark));
      const knownId=nativeId(original.result?.order_id);
      check(candidates.length===1 && qmtPending(candidates[0]) && (knownId===null||nativeId(candidates[0].order_id)===knownId),'UNCONFIRMED_ORDER','A unique matching active QMT order is required');
      request={operation_id:operationId,user_authorized:true,account_id:record.account.accountId,connection_revision:identityNow.revision,original_operation_id:record.id,order_id:nativeId(candidates[0].order_id)};
    } else {
      const [info,orders]=await Promise.all([py('account_info',{},signal),py('orders_get',{symbol:record.symbol},signal)]);
      check(String(info.login)===record.account.accountId && info.server===record.account.server,'ACCOUNT_MISMATCH','Connected cancellation account changed');
      const candidates=orders.filter(x=>x.symbol===record.symbol && x.comment===record.remark && nativeId(x.ticket)!==null),knownId=nativeId(original.result?.result?.order);
      check(candidates.length===1 && mt5Pending(candidates[0],record) && (knownId===null||nativeId(candidates[0].ticket)===knownId),'UNCONFIRMED_ORDER','A unique matching active pending order is required');
      const ticket=nativeId(candidates[0].ticket);
      request={server:'python',tool:'order_send',arguments:{request:{action:'TRADE_ACTION_REMOVE',order:ticket},cancellation_guard:{expected_account:record.account.accountId,expected_server:record.account.server,symbol:record.symbol,remark:record.remark,order:ticket,side:record.side}},command_id:operationId};
    }
    check(canonical(await identity(record.backend,signal))===canonical(identityNow),'CONNECTION_CHANGED','Configuration changed during cancellation preflight');
    } catch(error) {error.details={...error.details,submission_attempted:false};throw error;}
    return call(record.backend,record.backend==='mt5'?'mt5_trade':'qmt_cancel',request,signal);
  }
  return {snapshot,identity,submit,status,cancel,orderRequest,command};
}
