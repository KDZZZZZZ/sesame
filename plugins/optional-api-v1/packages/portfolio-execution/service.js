import { records } from './records.js';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { createAdapters, check, decimal, sameAccount } from './adapters.js';
import { withAccountLock } from './execution-lock.js';

export const POLICY=Object.freeze({minimumTimeframe:'5m',maxDecisionAgeMs:60000,maxQuoteAgeMs:5000,maxQuoteToSendMs:1000,maxReadMs:10000,maxPreparationMs:180000,maxReceiptWaitMs:10000,m1Verified:false});
const accepted=new Set([10008,10009,10010]);
const rejected=new Set([10004,10006,10007,10013,10014,10015,10016,10017,10018,10019,10020,10021,10022,10024,10025,10026,10027,10028,10029,10030,10032,10033,10034,10035,10036,10038,10039,10040,10041,10042,10043,10044,10045,10046]);
export function outcome(backend,receipt) {
  if(backend==='qmt') return receipt?.status==='submitted'?'submitted':receipt?.status==='cancel_requested'?'cancel_requested':receipt?.status==='rejected'?'rejected':'outcome_unknown';
  const native=receipt?.result;
  if(native?.submission_attempted===false) return 'rejected';
  if(receipt?.status!=='returned' || !native?.result) return 'outcome_unknown';
  const retcode=Number(native.result.retcode);
  return accepted.has(retcode)?(retcode===10010?'partially_filled':retcode===10009?'execution_reported':'submitted'):rejected.has(retcode)?'rejected':'outcome_unknown';
}
export function createService(host,{now=Date.now,authorizeRequest,adapters=createAdapters(host,{now,authorizeRequest}),authorize,ownerConversationId}={}) {
  const stored=(kind,id)=>records(host).get(kind,id,true);
  const ownerId=()=>ownerConversationId??host.context?.sessionId;
  const main=()=>authorize ? authorize() : check(host.context?.kind==='main','FORBIDDEN','Manual trading belongs to the main user conversation');
  const manual=()=>check(!authorize && host.context?.kind==='main','FORBIDDEN','Authorized manual preparation belongs only to the main user conversation');
  const bounded=signal=>AbortSignal.any([AbortSignal.timeout(POLICY.maxReadMs),...(signal?[signal]:[])]);
  const preparing=signal=>AbortSignal.any([AbortSignal.timeout(POLICY.maxPreparationMs),...(signal?[signal]:[])]);
  const owner=record=>check(record?.conversationId===ownerId(),'FORBIDDEN','Record belongs to another conversation');
  const fresh=quote=>{
    const checkedAt=now(),valid=Number.isSafeInteger(quote?.sourceTimeMs),ageMs=valid?checkedAt-quote.sourceTimeMs:null;
    if(!valid || ageMs<0 || ageMs>POLICY.maxQuoteAgeMs)throw Object.assign(new Error('Source quote is stale or future-dated; wait for a fresh quote, do not replace its timestamp'),{code:'STALE_QUOTE',details:{submission_attempted:false,reason:!valid?'invalid_source_time':ageMs<0?'future_quote':'stale_quote',source:quote?.source??null,sourceTimeMs:quote?.sourceTimeMs??null,quoteClock:quote?.clock??null,receivedAt:quote?.receivedAt??null,checkedAt,ageMs,maxQuoteAgeMs:POLICY.maxQuoteAgeMs}});
  };
  const save=value=>records(host).put('commands',value);
  function commandId(id){check(typeof id==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(id),'INVALID_ARGUMENT','Use a stable operation ID');return `manual-${digest(id).slice(7,39)}`;}
  function recordFor(id){const record=stored('commands',id);check(record,'NOT_FOUND','Manual trade operation not found');owner(record);return record;}
  function requireOpen(record){check(['submitted','execution_reported','partially_filled','order_observed','execution_observed'].includes(record.status),'UNCONFIRMED_ORDER','Order result is not confirmed; query first, never resend blindly');}
  function source(args) {
    check(['mt5','qmt'].includes(args.backend),'UNSUPPORTED_CAPABILITY','Choose an actually supported trading backend');
    check(typeof args.symbol==='string' && args.symbol.length>0 && args.symbol.length<=100,'INVALID_ARGUMENT','Exact backend symbol required');
  }
  function uncertain(account,backend) {
    const previous=[...records(host).list('commands'),...records(host).list('legacy_blocks')].find(value=>value.kind==='order' && ['submitting','outcome_unknown'].includes(value.status) && value.backend===backend && sameAccount(value.account,account));
    check(!previous,'UNRESOLVED_ORDER',`An earlier account order has an unknown result (${previous?.id}); query it before new orders`);
  }
  const failure=(error,notSent)=>({code:error.code??'SOURCE_UNAVAILABLE',message:String(error.message??error).slice(0,2000),details:{...error.details,...(notSent?{submission_attempted:false}:{}),reason:error.details?.reason??String(error.message??error).slice(0,2000)}});
  const beforeSend=error=>{error.details={...error.details,submission_attempted:false,reason:error.details?.reason??String(error.message??error).slice(0,2000)};return error;};
  function saveObservation(observation,backend) {
    fresh(observation.quote);
    const record={...observation,id:randomUUID(),backend,conversationId:ownerId(),expiresAt:observation.quote.sourceTimeMs+POLICY.maxDecisionAgeMs,consumedBy:null};
    for(const prior of records(host).list('observations')) if(!prior.consumedBy && prior.expiresAt<now()-86400000) records(host).delete('observations',prior.id);
    records(host).put('observations',record);return record;
  }
  const observationResult=record=>({observation_id:record.id,backend:record.backend,symbol:record.symbol,account:record.account,accountSummary:record.accountSummary,quote:record.quote,positions:record.positions,...(record.orders ? {orders:record.orders} : {}),spec:record.spec,capturedAt:record.capturedAt,expiresAt:record.expiresAt,observation_request_ms:record.captureMs,...(record.preparation?{preparation:record.preparation}:{}),...(record.backendCapturedAt===undefined?{}:{backendCapturedAt:record.backendCapturedAt}),policy:POLICY});
  async function capturePrepared(args,account,signal,backendCommandId) {
    manual();
    const observation=await adapters.prepare(args.backend,args.symbol,{account,commandId:backendCommandId,userAuthorized:true},preparing(signal));
    check(sameAccount(account,observation.account),'ACCOUNT_MISMATCH','Preparation changed the selected native account');
    return saveObservation(observation,args.backend);
  }
  async function executeObservation(args,signal,fingerprint,observation,initial) {
    owner(observation);
    check(!observation.consumedBy,'OBSERVATION_CONSUMED','An observation supports one order intent; inspect its existing receipt');
    check(now()>=observation.capturedAt && now()<observation.expiresAt,'SIGNAL_EXPIRED','The model decision outlived the observed quote; reassess M5+ with a new observation');
    uncertain(observation.account,observation.backend);
    const began=initial?.createdAt??now(), request={...args,backendCommandId:commandId(args.operation_id),remark:`SMan${digest(args.operation_id).slice(7,27)}`};
    adapters.orderRequest(observation,request);
    let record={...initial,id:args.operation_id,fingerprint,kind:'order',backend:observation.backend,account:observation.account,symbol:observation.symbol,action:args.action,side:args.side,quantity:args.quantity,conversationId:ownerId(),backendCommandId:request.backendCommandId,remark:request.remark,status:'preparing',submission_attempted:false,createdAt:began,observationId:observation.id,timeframe:args.timeframe??'5m',signalSourceAt:observation.quote.sourceTimeMs,expiresAt:observation.expiresAt,
      timing:{...initial?.timing,observation_request_ms:observation.captureMs,model_round_trip_ms:initial?0:began-observation.capturedAt,signal_age_at_start_ms:now()-observation.quote.sourceTimeMs}};
    record.intent={priceLimit:args.price_limit,limitPrice:args.limit_price??null,positionId:args.position_id??null,stopLoss:args.stop_loss??null,takeProfit:args.take_profit??null};
    if(authorize)record.planExecution=true;
    records(host).transaction(()=>{records(host).put('observations',{...observation,consumedBy:record.id});save(record);});
    try {
      signal?.throwIfAborted();
      const account=await adapters.identity(record.backend,bounded(signal));
      check(canonical(account)===canonical(record.account),'CONNECTION_CHANGED','Account or configuration changed after observation');
      check(now()<record.expiresAt,'SIGNAL_EXPIRED','Decision expired during preparation');
      // The backend repeats account/specification/position/latest-quote guards in
      // its native process immediately before the one possible broker send.
      main();record=save({...record,status:'submitting',submission_attempted:null,dispatchAt:now()});
      const receipt=await adapters.submit(observation,request,bounded(signal));
      const timing=receipt?.result?.execution_timing;
      return save({...record,status:outcome(record.backend,receipt),submission_attempted:receipt?.result?.submission_attempted===false?false:record.backend==='qmt'?receipt?.status==='submitted'?true:null:receipt?.status==='returned'&&receipt.result?.result?true:null,receipt,completedAt:now(),timing:{...record.timing,wrapper_to_receipt_ms:now()-(initial?.requestStartedAt??began),...timing},recovery:'manual_trade_status; never resubmit an unknown result under a new ID'});
    } catch(error) {
      const notSent=record.status==='preparing' || error.details?.submission_attempted===false;
      return save({...record,status:notSent?'rejected':'outcome_unknown',submission_attempted:notSent?false:null,completedAt:now(),error:failure(error,notSent),timing:{...record.timing,wrapper_to_receipt_ms:now()-(initial?.requestStartedAt??began)}});
    }
  }
  return {
    inspect() {main();return {policy:POLICY,compositionAvailable:typeof host.capabilities.invoke==='function',backends:[{id:'mt5',plugin:'sesame/mt5',minimumPluginVersion:'2.1.7',channel:'Configured official Python SDK',actions:['prepare','market','limit','close','cancel','status'],requires:'Configured account, mt5_trading_prepare and verified quote_clock; raw tick.time_msc is retained, normalized UTC age must satisfy the final freshness guard'},{id:'qmt',plugin:'sesame/qmt',minimumPluginVersion:'1.2.0',channel:'Configured Windows MiniQMT STOCK',actions:['prepare','limit','cancel','status'],requires:'Existing broker-authorized native Windows session; preparation is read-only and no native broker acceptance has been tested'}],unavailable:[{id:'ccxt',reason:'Existing plugin is public market data only'},{id:'akshare',reason:'Research/market data only'},{id:'vnpy',reason:'Current plugin provides backtesting, no live gateway'},{id:'backtrader',reason:'Current plugin provides backtesting, no broker bridge'}],note:'M5+ is the default decision cadence, not a promise of profitability or fills. API timing alone does not measure model reasoning latency.'};},
    async observe(args,signal) {
      main();source(args);
      return observationResult(saveObservation(await adapters.snapshot(args.backend,args.symbol,bounded(signal)),args.backend));
    },
    async prepare(args,signal) {
      const requestStartedAt=now();
      try {
        manual();check(args.user_authorized===true,'FORBIDDEN','Preparation requires an existing explicit user trading instruction');
        source(args);commandId(args.operation_id);
      } catch(error){throw beforeSend(error);}
      const fingerprint=digest(args),previous=stored('preparations',args.operation_id);
      if(previous){owner(previous);check(previous.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','Operation ID already belongs to different preparation input');}
      let account;
      try {account=previous?.account??await adapters.identity(args.backend,bounded(signal));}
      catch(error){throw beforeSend(error);}
      return withAccountLock(host,{backend:args.backend,account},async()=>{
        manual();
        const prior=stored('preparations',args.operation_id);
        if(prior){owner(prior);check(prior.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','Operation ID already belongs to different preparation input');return prior.result??prior;}
        const began=now(),backendCommandId=`${commandId(args.operation_id)}-prepare`;
        let record=records(host).put('preparations',{id:args.operation_id,fingerprint,kind:'preparation',backend:args.backend,symbol:args.symbol,account,conversationId:ownerId(),backendCommandId,status:'preparing',submission_attempted:false,createdAt:began});
        try {
          signal?.throwIfAborted();uncertain(account,args.backend);
          const observation=await capturePrepared(args,account,signal,backendCommandId);
          const result={...observationResult(observation),operation_id:args.operation_id,status:'prepared',submission_attempted:false,timing:{preparation_request_ms:now()-began,total_request_ms:now()-requestStartedAt}};
          record=records(host).put('preparations',{...record,account:observation.account,status:'prepared',completedAt:now(),result});
          return record.result;
        } catch(error) {
          const result={operation_id:args.operation_id,backend:args.backend,symbol:args.symbol,status:'rejected',submission_attempted:false,error:failure(error,true),timing:{preparation_request_ms:now()-began,total_request_ms:now()-requestStartedAt}};
          records(host).put('preparations',{...record,status:'rejected',completedAt:now(),result});return result;
        }
      });
    },
    async execute(args,signal) {
      const requestStartedAt=now(),shortcut=args.observation_id===undefined;
      try {
        main();check(args.user_authorized===true,'FORBIDDEN','Use an existing explicit user trading instruction');
        commandId(args.operation_id);
        check(['5m','15m','30m','1h','4h','1d'].includes(args.timeframe??'5m'),'TIMEFRAME_UNSUPPORTED','Use M5 or longer. M1 is not enabled without measured model-to-execution evidence');
        decimal(args.quantity);decimal(args.price_limit);
        check(shortcut || args.backend===undefined && args.symbol===undefined,'INVALID_ARGUMENT','Choose observation_id or backend + symbol, never both');
        if(shortcut) {
          manual();source(args);
          check(['market','limit','close'].includes(args.action) && ['buy','sell'].includes(args.side),'INVALID_ARGUMENT','An exact user order action and side are required');
          check(args.action==='limit'||args.limit_price===undefined,'INVALID_ARGUMENT','limit_price is only valid for limit orders');
          check(args.action==='close'||args.position_id===undefined,'INVALID_ARGUMENT','position_id is only valid for close');
          if(args.action==='limit')decimal(args.limit_price);
          if(args.action==='close')check(args.backend==='mt5' && typeof args.position_id==='string' && /^[1-9]\d*$/.test(args.position_id),'INVALID_ARGUMENT','Close requires the exact MT5 position ticket');
          for(const amount of [args.stop_loss,args.take_profit])if(amount!==undefined)decimal(amount);
          check(args.backend!=='qmt'||args.action==='limit' && /^[1-9]\d*$/.test(args.quantity) && args.stop_loss===undefined && args.take_profit===undefined,'UNSUPPORTED_CAPABILITY','QMT supports limit orders in integer shares without attached stops');
        } else check(typeof args.observation_id==='string' && args.observation_id.length>0,'INVALID_ARGUMENT','A valid observation_id is required');
      } catch(error){throw beforeSend(error);}
      const fingerprint=digest(args),previous=stored('commands',args.operation_id);
      if(previous){owner(previous);check(previous.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','Operation ID already belongs to different input');}
      let lockRecord=previous;
      if(!lockRecord) {
        if(shortcut) {
          try {lockRecord={backend:args.backend,account:await adapters.identity(args.backend,bounded(signal))};}
          catch(error){throw beforeSend(error);}
        } else {
          lockRecord=stored('observations',args.observation_id);
          check(lockRecord,'NOT_FOUND','Read a fresh manual_trade_observe or manual_trade_prepare first');owner(lockRecord);
        }
      }
      return withAccountLock(host,lockRecord,async()=>{
        main();
        const prior=stored('commands',args.operation_id);
        if(prior){owner(prior);check(prior.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','Operation ID already belongs to different input');return prior;}
        if(!shortcut) {
          const observation=stored('observations',args.observation_id);check(observation,'NOT_FOUND','Read a fresh manual_trade_observe or manual_trade_prepare first');
          return executeObservation(args,signal,fingerprint,observation);
        }
        manual();
        const began=now();
        let record=save({id:args.operation_id,fingerprint,kind:'order',backend:args.backend,account:lockRecord.account,symbol:args.symbol,conversationId:ownerId(),backendCommandId:commandId(args.operation_id),action:args.action,side:args.side,quantity:args.quantity,status:'preparing',submission_attempted:false,createdAt:began,requestStartedAt,intent:{priceLimit:args.price_limit,limitPrice:args.limit_price??null,positionId:args.position_id??null,stopLoss:args.stop_loss??null,takeProfit:args.take_profit??null}});
        try {
          signal?.throwIfAborted();uncertain(record.account,record.backend);
          const observation=await capturePrepared(args,record.account,signal,`${record.backendCommandId}-execute-prepare`);
          record=save({...record,account:observation.account,preparation:observation.preparation,timing:{preparation_request_ms:now()-began}});
          return await executeObservation(args,signal,fingerprint,observation,record);
        } catch(error) {
          const latest=stored('commands',record.id)??record,notSent=latest.status==='preparing' || error.details?.submission_attempted===false;
          return save({...latest,status:notSent?'rejected':'outcome_unknown',submission_attempted:notSent?false:null,completedAt:now(),error:failure(error,notSent),timing:{...latest.timing,preparation_request_ms:latest.timing?.preparation_request_ms??now()-began,wrapper_to_receipt_ms:now()-requestStartedAt}});
        }
      });
    },
    async status(args,signal) {
      main();const lockRecord=recordFor(args.operation_id);if(!args.refresh)return lockRecord;
      return withAccountLock(host,lockRecord,async()=>{
      let record=recordFor(args.operation_id);
      if(!args.refresh || record.status==='preparing' || record.status==='rejected')return record;
      const current=await adapters.identity(record.backend,bounded(signal));check(sameAccount(current,record.account),'CONNECTION_CHANGED','Cannot recover against a different account/connection');
      const verifyCurrent=async()=>check(canonical(await adapters.identity(record.backend,bounded(signal)))===canonical(current),'CONNECTION_CHANGED','Configuration changed during recovery');
      if(record.kind==='cancel') {
        const original=recordFor(record.originalOperationId),evidence=await adapters.status(original,bounded(signal),current),receipt=await adapters.command(record,bounded(signal));
        await verifyCurrent();
        const result=outcome(record.backend,receipt),status=result==='rejected'?'rejected':['submitted','execution_reported','cancel_requested'].includes(result)?'cancel_requested':record.status;
        return save({...record,status,receipt,evidence,checkedAccount:current,checkedAt:now(),note:'This is original-order evidence. A cancel request/absence is not confirmation; inspect native final status and fills.'});
      }
      const evidence=await adapters.status(record,bounded(signal),current);
      await verifyCurrent();
      const confirmed=outcome(record.backend,evidence.command);
      let status=record.status;
      if(['submitting','outcome_unknown'].includes(status)) {
        if(confirmed!=='outcome_unknown')status=confirmed;
        else if(evidence.deals?.length)status='execution_observed';
        else if(evidence.orders?.length===1)status='order_observed';
      }
      record=save({...record,status,evidence,checkedAccount:current,checkedAt:now(),note:'A missing order/deal is not proof of rejection. Broker receipts and observed fills are distinct.'});
      if(!['preparing','submitting','outcome_unknown'].includes(status)) {
        for(const blocker of records(host).list('legacy_blocks')) if(blocker.originalOperationId===record.id && blocker.conversationId===record.conversationId && blocker.backend===record.backend && sameAccount(blocker.account,record.account)) records(host).delete('legacy_blocks',blocker.id);
      }
      return record;
      });
    },
    async cancel(args,signal) {
      main();check(args.user_authorized===true,'FORBIDDEN','Cancellation requires user trading intent');
      const backendCommandId=commandId(args.operation_id),fingerprint=digest(args);
      return withAccountLock(host,recordFor(args.original_operation_id),async()=>{
        const previous=stored('commands',args.operation_id);if(previous){owner(previous);check(previous.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','Cancellation ID already used');return previous;}
        const original=recordFor(args.original_operation_id);requireOpen(original);
        check(!records(host).list('commands').some(x=>x.kind==='cancel' && x.originalOperationId===original.id && ['submitting','outcome_unknown'].includes(x.status)),'UNRESOLVED_CANCEL','An earlier cancellation result is unknown; query that operation instead of replacing its ID');
        let record={id:args.operation_id,fingerprint,kind:'cancel',backend:original.backend,account:original.account,symbol:original.symbol,conversationId:ownerId(),originalOperationId:original.id,backendCommandId,createdAt:now(),status:'submitting'};save(record);
        try {const receipt=await adapters.cancel(original,original.backend==='qmt'?args.operation_id:backendCommandId,bounded(signal));record={...record,receipt,status:outcome(original.backend,receipt),completedAt:now()};if(['execution_reported','submitted'].includes(record.status))record.status='cancel_requested';}
        catch(error){const notSent=error.details?.submission_attempted===false;record={...record,status:notSent?'rejected':'outcome_unknown',error:{code:error.code??'SOURCE_UNAVAILABLE',message:notSent?'Cancellation preflight rejected before native dispatch.':'Cancellation unconfirmed; inspect the original order and fills'},completedAt:now()};}
        return save(record);
      });
    },
  };
}
