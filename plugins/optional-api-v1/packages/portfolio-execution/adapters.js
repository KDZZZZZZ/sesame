import { randomUUID } from 'node:crypto';
import { Decimal } from '@sesame/plugin-sdk/decimal';
import { canonical } from '@sesame/plugin-sdk/protocol';
import { invoke, requirePlugin, pluginStatus } from './calls.js';

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
export function createAdapters(host, {now=Date.now,authorizeRequest}={}) {
  const background=()=>host.context?.kind==='subagent';
  async function call(backend,name,args,signal) {
    const pluginId=`sesame/${backend}`;
    await requirePlugin(host, pluginId);
    if(background() && ['mt5_trading_order','mt5_trading_pause','qmt_trading_order','qmt_trading_cancel'].includes(name)) {
      check(typeof authorizeRequest==='function','FORBIDDEN','Backend write requires a live portfolio executor intent');
      args=authorizeRequest(name,args);
    }
    return invoke(host, pluginId, name, args, signal);
  }
  async function pyResult(method,args,signal,commandId=`manual-read-${randomUUID()}`) {
    signal?.throwIfAborted();
    const command=await call('mt5',method==='order_send'?'mt5_trade':'mt5_python',{server:'python',tool:method,arguments:args,command_id:commandId},signal);
    signal?.throwIfAborted();
    if (!(command?.status==='returned' && !command.result?.error && command.result?.result!==null && command.result?.result!==undefined)) {
      const native=command?.result?.last_error, failure=command?.error??command?.result?.error;
      const nativeCode=Array.isArray(native)?native[0]:null, nativeMessage=Array.isArray(native)?String(native[1]??'').slice(0,1000):null;
      const disconnected=nativeCode===-10004;
      throw Object.assign(new Error(`MT5 ${method}: ${failure?.message??nativeMessage??'did not return a confirmed result'}`), {
        code:disconnected?'MT5_PYTHON_UNAVAILABLE':failure?.code??'SOURCE_UNAVAILABLE',
        details:{transport:'python',requiredTransport:'python',method,commandId:command?.id??commandId,commandStatus:command?.status??null,nativeCode,nativeMessage,
          ...(disconnected?{retryable:false,recovery:'Reconnect the configured MetaTrader 5 Python terminal, verify the same account, then start a new workflow run. Terminal MCP connectivity alone does not establish Python IPC.'}:{})},
      });
    }
    return command.result;
  }
  const py=async(method,args,signal,commandId)=>(await pyResult(method,args,signal,commandId)).result;
  async function identity(backend,signal) {
    if(background()) return (await call(backend,`${backend}_trading_context`,{action:'identity'},signal)).account;
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
      check(order?.callable && order.inputSchema?.properties?.execution_guard,'PREREQUISITE_REQUIRED','Use a connected MT5 Python SDK with execution_guard; a separate MCP quote connection does not establish Python readiness');
      const info=await py('account_info',{},signal);
      check(String(info.login)===account.accountId && info.server===account.server,'ACCOUNT_MISMATCH','MT5 current account differs from configured account');
      const terminal=await py('terminal_info',{},signal);
      check(terminal.connected===true,'SOURCE_UNAVAILABLE','MT5 is not connected to its broker');
      const spec=await py('symbol_info',{symbol},signal), positions=await py('positions_get',{symbol},signal), orders=background()?await py('orders_get',{symbol},signal):undefined;
      check(spec.name===symbol && Array.isArray(positions) && (!background() || Array.isArray(orders)),'SOURCE_DATA_INVALID','Native symbol/positions/orders omitted');
      const quote=await quoteFor(backend,symbol,signal,account);
      return {account,symbol,spec,positions,...(orders ? {orders} : {}),quote,readStartedAt:began,capturedAt:now(),captureMs:now()-began,accountSummary:{balance:info.balance??null,equity:info.equity??null,currency:info.currency??null,tradeAllowed:info.trade_allowed===true && info.trade_expert===true}};
    }
    // Older QMT packages must not silently discard the final-mile guard.
    // Background identity already requires the guarded 1.3+ plan tool. The
    // public plugin-inspection port is main/service only.
    if(!background()) {
      const installed=await pluginStatus(host, 'sesame/qmt');
      check(/^1\.(?:[2-9]|[1-9]\d)\./.test(installed?.version??''),'PREREQUISITE_REQUIRED','Use sesame/qmt 1.2.0+ with native execution guards');
    }
    const [specResult,asset,positions,orders]=await Promise.all([call('qmt','qmt_read',{action:'describe',symbols:[symbol]},signal),call('qmt','qmt_read',{action:'asset'},signal),call('qmt','qmt_read',{action:'positions',page:{limit:200}},signal),background()?call('qmt','qmt_read',{action:'orders',page:{limit:200}},signal):undefined]);
    for(const read of [specResult,asset,positions,orders].filter(Boolean)) check(read.connection?.id===account.connectionId && read.connection.revision===account.revision,'CONNECTION_CHANGED','QMT connection changed during observation');
    check(specResult.items?.length===1 && specResult.items[0].symbol===symbol && !positions.nextCursor && (!background() || Array.isArray(orders?.items) && !orders.nextCursor),'SOURCE_DATA_INVALID','Incomplete native symbol/positions/orders snapshot; narrow the account before automated preflight');
    check(String(asset.asset?.account_id)===account.accountId,'ACCOUNT_MISMATCH','QMT asset belongs to another account');
    const quote=await quoteFor(backend,symbol,signal);
    return {account,symbol,spec:specResult.items[0].detail,positions:positions.items,...(orders ? {orders:orders.items} : {}),quote,readStartedAt:began,capturedAt:now(),captureMs:now()-began,accountSummary:asset.asset};
  }
  async function prepare(backend,symbol,{account,commandId,userAuthorized},signal) {
    check(host.context?.kind==='main' && userAuthorized===true,'FORBIDDEN','Only the main conversation may prepare authorized manual trading');
    if(backend==='qmt') {
      const observed=await snapshot(backend,symbol,signal);
      check(canonical(observed.account)===canonical(account),'CONNECTION_CHANGED','QMT account or configuration changed during preparation');
      return {...observed,preparation:{backend:'qmt',mode:'read-only',permissionsChanged:false}};
    }
    check(backend==='mt5','UNSUPPORTED_CAPABILITY','Choose an actually supported trading backend');
    const began=now(), value=await call('mt5','mt5_trading_prepare',{symbol,command_id:commandId,user_authorized:true,expected_account:account},signal);
    signal?.throwIfAborted();
    const receivedAt=now(), actual=value?.account, info=value?.summary, terminal=value?.terminal;
    check(sameAccount(actual,account) && typeof actual.revision==='string' && actual.revision.length>0,'ACCOUNT_MISMATCH','MT5 preparation returned a different account');
    check(String(info?.login)===actual.accountId && info?.server===actual.server,'ACCOUNT_MISMATCH','MT5 prepared native account differs from its binding');
    check(terminal?.connected===true,'SOURCE_UNAVAILABLE','Prepared MT5 terminal is not connected to its broker');
    check(info.trade_allowed===true && info.trade_expert===true && terminal.trade_allowed===true && terminal.tradeapi_disabled===false,'TRADING_NOT_ALLOWED','MT5 preparation did not establish native account and algorithmic trading permissions');
    check(value.spec?.name===symbol && Array.isArray(value.positions) && Array.isArray(value.orders) && [...value.positions,...value.orders].every(row=>row?.symbol===symbol),'SOURCE_DATA_INVALID','Prepared native symbol/positions/orders omitted or differ from the requested symbol');
    check(value.preparation?.status==='ready','SOURCE_DATA_INVALID','MT5 preparation did not return a ready preparation receipt');
    check(Number.isSafeInteger(value.readStartedAt) && Number.isSafeInteger(value.capturedAt) && value.capturedAt>=value.readStartedAt && value.capturedAt<=receivedAt,'SOURCE_DATA_INVALID','Prepared snapshot has invalid native capture timing');
    const quote=normalizeQuote('mt5',value.tick,{receivedAt,requestMs:null,sourceReceivedAt:value.capturedAt,preparationRequestMs:receivedAt-began},value.quote_clock,actual);
    return {account:actual,symbol,spec:value.spec,positions:value.positions,orders:value.orders,quote,readStartedAt:value.readStartedAt,capturedAt:receivedAt,captureMs:receivedAt-began,backendCapturedAt:value.capturedAt,
      accountSummary:{balance:info.balance??null,equity:info.equity??null,currency:info.currency??null,tradeAllowed:true},preparation:value.preparation};
  }
  function normalizeQuote(backend,tick,timing,clock,account) {
    const rawTime=backend==='mt5'?tick?.time_msc:tick?.time,source=backend==='mt5'?'mt5/python/symbol_info_tick':'qmt/quotes';
    let sourceTimeMs=Number(rawTime);
    if(backend==='mt5') {
      if(clock?.status!=='verified')throw Object.assign(new Error('MT5 quote clock is not verified for this server and period; inspect the native clock evidence'),{code:'QUOTE_CLOCK_UNVERIFIED',details:{submission_attempted:false,reason:clock?.reason??'missing_quote_clock',source,rawTimeMs:rawTime??null,receivedAt:timing.receivedAt}});
      check(clock.accountId===account?.accountId && clock.server===account?.server,'ACCOUNT_MISMATCH','MT5 quote clock belongs to a different native account');
      check(clock.source===source && ['utc','server-wall'].includes(clock.basis)
        && Number.isSafeInteger(rawTime) && clock.rawTimeMs===rawTime && Number.isSafeInteger(clock.sourceTimeMs)
        && Number.isInteger(clock.offsetMinutes) && Math.abs(clock.offsetMinutes)<=840
        && (clock.basis!=='utc'||clock.offsetMinutes===0) && clock.sourceTimeMs===rawTime-clock.offsetMinutes*60000
        && typeof clock.ruleId==='string' && clock.ruleId.length>0 && typeof clock.ruleRevision==='string' && clock.ruleRevision.length>0,
      'SOURCE_DATA_INVALID','MT5 quote clock evidence is incomplete or inconsistent with the original tick');
      sourceTimeMs=clock.sourceTimeMs;
    }
    if(!Number.isSafeInteger(sourceTimeMs) || sourceTimeMs<1000000000000)throw Object.assign(new Error('Quote has no valid source epoch milliseconds; reception time is not source time'),{code:'SOURCE_DATA_INVALID',details:{reason:'invalid_source_time',source,sourceTimeMs:rawTime??null,receivedAt:timing.receivedAt}});
    return {source,sourceTimeMs,...(backend==='mt5'?{clock:structuredClone(clock)}:{}),...timing,bid:decimal(backend==='mt5'?tick?.bid:tick?.bidPrice?.[0]),ask:decimal(backend==='mt5'?tick?.ask:tick?.askPrice?.[0])};
  }
  async function quoteFor(backend,symbol,signal,account) {
    const startedAt=now();
    const result=backend==='mt5'?await pyResult('symbol_info_tick',{symbol},signal):null;
    const tick=result?result.result:(await call('qmt','qmt_read',{action:'quotes',symbols:[symbol]},signal)).items?.find(x=>x.symbol===symbol)?.tick;
    return normalizeQuote(backend,tick,{receivedAt:now(),requestMs:now()-startedAt},result?.quote_clock,account);
  }
  function expectedPositions(observation) {
    const rows=observation.positions.filter(row=>(row.symbol??row.stock_code)===observation.symbol);
    check(rows.length<=1000,'SOURCE_DATA_INVALID','Position guard exceeds its bounded account snapshot');
    return rows.map(row=>{
      if(observation.backend==='mt5') {
        const ticket=nativeId(row.ticket),type=Number(row.type);
        check(ticket!==null && [0,1].includes(type),'SOURCE_DATA_INVALID','Position guard needs exact MT5 tickets and sides');
        return {ticket,type,volume:decimal(row.volume)};
      }
      check(row.account_id===observation.account.accountId && [row.volume,row.can_use_volume].every(value=>/^(0|[1-9]\d*)$/.test(String(value))),'SOURCE_DATA_INVALID','Position guard needs exact QMT account and share amounts');
      return {account_id:row.account_id,stock_code:row.stock_code,volume:String(row.volume),can_use_volume:String(row.can_use_volume)};
    });
  }
  const guardFor=(observation,args)=>({observed_at:observation.quote.sourceTimeMs,expires_at:observation.expiresAt,max_quote_age_ms:5000,max_quote_to_send_ms:1000,price_limit:args.price_limit,...(observation.backend==='mt5'?{quote_clock_revision:observation.quote.clock?.ruleRevision}:{}),...(background()?{expected_positions:expectedPositions(observation)}:{})});
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
    check(observation.quote.clock?.status==='verified' && typeof observation.quote.clock.ruleRevision==='string' && observation.quote.clock.ruleRevision.length>0,'QUOTE_CLOCK_UNVERIFIED','MT5 order requires an observation with verified quote-clock provenance');
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
    return await call(observation.backend,observation.backend==='mt5'?(background()?'mt5_trading_order':'mt5_trade'):background()?'qmt_trading_order':'qmt_order',request,signal);
  }
  async function status(record,signal,expectedCurrent) {
    const backend=record.backend,current=await identity(backend,signal);
    check(sameAccount(current,record.account),'CONNECTION_CHANGED','Cannot recover against a different account or connection');
    check(!expectedCurrent || canonical(current)===canonical(expectedCurrent),'CONNECTION_CHANGED','Configuration changed before recovery reads');
    const verifyConfiguration=async()=>check(canonical(await identity(backend,signal))===canonical(current),'CONNECTION_CHANGED','Configuration changed during recovery reads');
    const command=await call(backend,backend==='mt5'?(record.planExecution?'mt5_trading_command':'mt5_command'):background()?'qmt_trading_command':'qmt_command',backend==='mt5'?{command_id:record.backendCommandId}:{operation_id:record.id},signal);
    if(backend==='mt5') {
      const verifyNativeAccount=async()=>{const info=await py('account_info',{},signal);check(String(info.login)===record.account.accountId && info.server===record.account.server,'ACCOUNT_MISMATCH','Do not recover an order against a different logged-in account');};
      await verifyNativeAccount();
      const orderId=nativeId(command.result?.result?.order), dealId=nativeId(command.result?.result?.deal);
      const ownSymbol=x=>x.symbol===record.symbol,ownRemark=x=>typeof record.remark==='string' && record.remark.length>0 && x.comment===record.remark;
      let orders,deals,positions,coverage='Native queried range; missing matches do not prove no order was sent';
      if(orderId!==null) {
        // Observed terminal/SDK 5.0.6231 rejects history_deals_get(ticket=orderId). Resolve the
        // native position_id through this exact order; order/deal/position IDs
        // are distinct, and a current partial order may not be in history yet.
        let historical;
        [orders,historical,positions]=await Promise.all([py('orders_get',{symbol:record.symbol},signal),py('history_orders_get',{ticket:orderId},signal),py('positions_get',{symbol:record.symbol},signal)]);
        check(Array.isArray(orders) && Array.isArray(historical) && historical.length<=1 && historical.every(x=>x?.symbol===record.symbol && nativeId(x.ticket)===orderId),'SOURCE_DATA_INVALID','Native order history does not identify the exact requested order and symbol');
        const currentOrders=orders.filter(x=>ownSymbol(x) && nativeId(x.ticket)===orderId);
        check(currentOrders.length<=1,'SOURCE_DATA_INVALID','Native current order identity is ambiguous');
        const sources=[...historical,...currentOrders];
        check(sources.every(x=>x.position_id==null || String(x.position_id)==='0' || nativeId(x.position_id)!==null),'SOURCE_DATA_INVALID','Native order has an invalid position identifier');
        const positionIds=[...new Set(sources.map(x=>nativeId(x.position_id)).filter(x=>x!==null))];
        check(positionIds.length<=1,'SOURCE_DATA_INVALID','Native current and historical order position identifiers conflict');
        if(positionIds.length) {
          deals=await py('history_deals_get',{position:positionIds[0]},signal);
          coverage='Native position history filtered to the confirmed order; missing matches do not prove no order was sent';
        } else {
          deals=[];coverage='Native order position_id is unverified; deal history was not queried. Missing records do not prove no order was sent';
        }
      } else {
        const history={date_from:new Date(record.createdAt-60000).toISOString(),date_to:new Date(now()+1000).toISOString()};
        [orders,deals,positions]=await Promise.all([py('orders_get',{symbol:record.symbol},signal),py('history_deals_get',history,signal),py('positions_get',{symbol:record.symbol},signal)]);
      }
      check([orders,deals,positions].every(Array.isArray),'SOURCE_DATA_INVALID','Native order, deal or position snapshot is missing');
      await verifyNativeAccount();await verifyConfiguration();
      const matchesDeal=x=>ownSymbol(x) && ['0','1'].includes(String(x.type)) && nativeId(x.ticket)!==null && nativeId(x.order)!==null && (orderId!==null?nativeId(x.order)===orderId:ownRemark(x) || dealId!==null && nativeId(x.ticket)===dealId);
      return {command,orders:orders.filter(x=>ownSymbol(x) && nativeId(x.ticket)!==null && (ownRemark(x) || orderId!==null && nativeId(x.ticket)===orderId) && (record.action!=='limit'||mt5Pending(x,record))),deals:deals.filter(matchesDeal),positions:positions.filter(x=>ownSymbol(x) && nativeId(x.ticket)!==null && ownRemark(x)),coverage};
    }
    const reads=await Promise.all(['orders','fills'].map(action=>call('qmt','qmt_read',{action,page:{limit:200}},signal)));
    for(const read of reads) check(read.connection?.id===current.connectionId && read.connection.revision===current.revision,'CONNECTION_CHANGED','Cannot recover against a different QMT connection');
    await verifyConfiguration();
    return {command,orders:reads[0].items.filter(x=>qmtOwned(x,record,command.remark) && qmtPending(x)),deals:reads[1].items.filter(x=>qmtOwned(x,record,command.remark) && typeof x.traded_id==='string' && x.traded_id.length>0 && positive(x.traded_volume)),coverage:reads.some(x=>x.nextCursor)?'truncated_current_day':'current_trading_day_only',complete:false};
  }
  const command=(record,signal)=>call(record.backend,record.backend==='mt5'?(record.planExecution?'mt5_trading_command':'mt5_command'):background()?'qmt_trading_command':'qmt_command',record.backend==='mt5'?{command_id:record.backendCommandId}:{operation_id:record.id},signal);
  async function cancel(record,operationId,signal) {
    let request;
    try {
    const identityNow=await identity(record.backend,signal);
    check(sameAccount(identityNow,record.account),'CONNECTION_CHANGED','Cancellation account/connection changed');
    check(record.action==='limit','UNCONFIRMED_ORDER','Cancellation requires a pending limit order');
    const original=await call(record.backend,record.backend==='mt5'?(record.planExecution?'mt5_trading_command':'mt5_command'):background()?'qmt_trading_command':'qmt_command',record.backend==='mt5'?{command_id:record.backendCommandId}:{operation_id:record.id},signal);
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
    return call(record.backend,record.backend==='mt5'?(background()?'mt5_trading_order':'mt5_trade'):background()?'qmt_trading_cancel':'qmt_cancel',request,signal);
  }
  return {snapshot,prepare,identity,submit,status,cancel,orderRequest,command};
}
