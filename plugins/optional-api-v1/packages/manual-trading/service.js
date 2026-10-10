import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { createAdapters, check, decimal } from './adapters.js';

export const POLICY=Object.freeze({minimumTimeframe:'5m',maxDecisionAgeMs:60000,maxQuoteAgeMs:5000,maxQuoteToSendMs:1000,maxReadMs:10000,maxReceiptWaitMs:10000,m1Verified:false});
const queues=new Map();
async function exclusive(host,action) {
  const key=host.storage.directory;
  const prior=queues.get(key),next=Promise.resolve(prior).catch(()=>{}).then(action);
  queues.set(key,next);
  try{return await next;}finally{if(queues.get(key)===next)queues.delete(key);}
}
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
export function createService(host,{now=Date.now,adapters=createAdapters(host,{now})}={}) {
  const stored=(kind,id)=>host.storage.get(kind,id,true);
  const main=()=>check(host.scope?.kind==='main','FORBIDDEN','Manual trading belongs to the main user conversation');
  const bounded=signal=>AbortSignal.any([AbortSignal.timeout(POLICY.maxReadMs),...(signal?[signal]:[])]);
  const owner=record=>check(record?.conversationId===host.scope.conversationId,'FORBIDDEN','Record belongs to another conversation');
  const fresh=quote=>check(Number.isSafeInteger(quote?.sourceTimeMs) && now()-quote.sourceTimeMs>=0 && now()-quote.sourceTimeMs<=POLICY.maxQuoteAgeMs,'STALE_QUOTE','Source quote is stale or future-dated; wait for a fresh quote, do not replace its timestamp');
  const save=value=>host.storage.put('commands',value);
  function commandId(id){check(typeof id==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(id),'INVALID_ARGUMENT','Use a stable operation ID');return `manual-${digest(id).slice(7,39)}`;}
  function recordFor(id){const record=stored('commands',id);check(record,'NOT_FOUND','Manual trade operation not found');owner(record);return record;}
  function requireOpen(record){check(['submitted','execution_reported','partially_filled'].includes(record.status),'UNCONFIRMED_ORDER','Order result is not confirmed; query first, never resend blindly');}
  return {
    inspect() {main();return {policy:POLICY,compositionAvailable:typeof host.tools.call==='function',backends:[{id:'mt5',plugin:'sesame/mt5',minimumPluginVersion:'1.3.0',channel:'Configured official Python SDK',actions:['market','limit','close','cancel','status'],requires:'Verified UTC tick.time_msc and existing terminal trading permissions'},{id:'qmt',plugin:'sesame/qmt',minimumPluginVersion:'1.2.0',channel:'Configured Windows MiniQMT STOCK',actions:['limit','cancel','status'],requires:'Existing broker-authorized native Windows session; no native broker acceptance has been tested'}],unavailable:[{id:'ccxt',reason:'Existing plugin is public market data only'},{id:'akshare',reason:'Research/market data only'},{id:'vnpy',reason:'Current plugin provides backtesting, no live gateway'},{id:'backtrader',reason:'Current plugin provides backtesting, no broker bridge'}],note:'M5+ is the default decision cadence, not a promise of profitability or fills. API timing alone does not measure model reasoning latency.'};},
    async observe(args,signal) {
      main();check(['mt5','qmt'].includes(args.backend),'UNSUPPORTED_CAPABILITY','Choose an actually supported trading backend');
      check(typeof args.symbol==='string' && args.symbol.length>0 && args.symbol.length<=100,'INVALID_ARGUMENT','Exact backend symbol required');
      const observation=await adapters.snapshot(args.backend,args.symbol,bounded(signal));fresh(observation.quote);
      const record={...observation,id:randomUUID(),backend:args.backend,conversationId:host.scope.conversationId,expiresAt:observation.quote.sourceTimeMs+POLICY.maxDecisionAgeMs,consumedBy:null};
      // Expired observations are disposable; order receipts are retained for recovery.
      for(const prior of host.storage.list('observations')) if(!prior.consumedBy && prior.expiresAt<now()-86400000) host.storage.delete('observations',prior.id);
      host.storage.put('observations',record);
      return {observation_id:record.id,backend:record.backend,symbol:record.symbol,account:record.account,accountSummary:record.accountSummary,quote:record.quote,positions:record.positions,spec:record.spec,capturedAt:record.capturedAt,expiresAt:record.expiresAt,observation_request_ms:record.captureMs,policy:POLICY};
    },
    async execute(args,signal) {
      main();check(args.user_authorized===true,'FORBIDDEN','Use an existing explicit user trading instruction');
      commandId(args.operation_id);
      check(['5m','15m','30m','1h','4h','1d'].includes(args.timeframe??'5m'),'TIMEFRAME_UNSUPPORTED','Use M5 or longer. M1 is not enabled without measured model-to-execution evidence');
      decimal(args.quantity);decimal(args.price_limit);
      const fingerprint=digest(args);
      return exclusive(host,async()=>{
        const previous=stored('commands',args.operation_id);
        if(previous){owner(previous);check(previous.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','Operation ID already belongs to different input');return previous;}
        const observation=stored('observations',args.observation_id);check(observation,'NOT_FOUND','Read a fresh manual_trade_observe first');owner(observation);
        check(!observation.consumedBy,'OBSERVATION_CONSUMED','An observation supports one order intent; inspect its existing receipt');
        check(now()>=observation.capturedAt && now()<observation.expiresAt,'SIGNAL_EXPIRED','The model decision outlived the observed quote; reassess M5+ with a new observation');
        // An unknown send on this account blocks replacement IDs even after a fresh
        // quote. Only positive broker evidence can resolve it, never absence.
        const sameAccount=(a,b)=>a.accountId===b.accountId && (a.server??a.connectionId)===(b.server??b.connectionId);
        const uncertain=host.storage.list('commands').find(x=>x.kind==='order' && ['submitting','outcome_unknown'].includes(x.status) && x.backend===observation.backend && sameAccount(x.account,observation.account));
        check(!uncertain,'UNRESOLVED_ORDER',`An earlier account order has an unknown result (${uncertain?.id}); query it before new orders`);
        const began=now(), request={...args,backendCommandId:commandId(args.operation_id),remark:`SMan${digest(args.operation_id).slice(7,27)}`};
        adapters.orderRequest(observation,request); // reject invalid intent before consuming it
        let record={id:args.operation_id,fingerprint,kind:'order',backend:observation.backend,account:observation.account,symbol:observation.symbol,action:args.action,side:args.side,quantity:args.quantity,conversationId:host.scope.conversationId,backendCommandId:request.backendCommandId,remark:request.remark,status:'preparing',createdAt:began,observationId:observation.id,timeframe:args.timeframe??'5m',signalSourceAt:observation.quote.sourceTimeMs,expiresAt:observation.expiresAt,timing:{observation_request_ms:observation.captureMs,model_round_trip_ms:began-observation.capturedAt,signal_age_at_start_ms:began-observation.quote.sourceTimeMs}};
        record.intent={priceLimit:args.price_limit,limitPrice:args.limit_price??null,positionId:args.position_id??null,stopLoss:args.stop_loss??null,takeProfit:args.take_profit??null};
        host.storage.transaction(()=>{host.storage.put('observations',{...observation,consumedBy:record.id});save(record);});
        try {
          signal?.throwIfAborted();
          const account=await adapters.identity(record.backend,bounded(signal));
          check(canonical(account)===canonical(record.account),'CONNECTION_CHANGED','Account or configuration changed after observation');
          check(now()<record.expiresAt,'SIGNAL_EXPIRED','Decision expired during preparation');
          // Native final-mile guard repeats account/position/spec/quote checks after
          // any process startup or queue wait, immediately before the single send.
          record=save({...record,status:'submitting',dispatchAt:now()});
          const receipt=await adapters.submit(observation,request,bounded(signal));
          const timing=record.backend==='mt5'?receipt?.result?.execution_timing:receipt?.result?.execution_timing;
          record=save({...record,status:outcome(record.backend,receipt),receipt,completedAt:now(),timing:{...record.timing,wrapper_to_receipt_ms:now()-began,...timing},recovery:'manual_trade_status; never resubmit an unknown result under a new ID'});
          return record;
        } catch(error) {
          const rejectedBeforeSend=record.status==='preparing' || error.details?.submission_attempted===false;
          record=save({...record,status:rejectedBeforeSend?'rejected':'outcome_unknown',completedAt:now(),error:{code:error.code??'SOURCE_UNAVAILABLE',message:rejectedBeforeSend?'Preparation rejected before native dispatch.':'Native outcome is unconfirmed; query orders/fills before another intent.'},timing:{...record.timing,wrapper_to_receipt_ms:now()-began}});
          return record;
        }
      });
    },
    async status(args,signal) {
      main();return exclusive(host,async()=>{
      let record=recordFor(args.operation_id);
      if(!args.refresh || record.status==='preparing' || record.status==='rejected')return record;
      const current=await adapters.identity(record.backend,bounded(signal));check(canonical(current)===canonical(record.account),'CONNECTION_CHANGED','Cannot recover against a different account/configuration');
      if(record.kind==='cancel') {
        const original=recordFor(record.originalOperationId),evidence=await adapters.status(original,bounded(signal)),receipt=await adapters.command(record,bounded(signal));
        const result=outcome(record.backend,receipt),status=result==='rejected'?'rejected':['submitted','execution_reported','cancel_requested'].includes(result)?'cancel_requested':record.status;
        return save({...record,status,receipt,evidence,checkedAt:now(),note:'This is original-order evidence. A cancel request/absence is not confirmation; inspect native final status and fills.'});
      }
      const evidence=await adapters.status(record,bounded(signal));
      const confirmed=outcome(record.backend,evidence.command);
      let status=record.status;
      if(['submitting','outcome_unknown'].includes(status)) {
        if(confirmed!=='outcome_unknown')status=confirmed;
        else if(evidence.deals?.length)status='execution_observed';
        else if(evidence.orders?.length)status='order_observed';
      }
      record=save({...record,status,evidence,checkedAt:now(),note:'A missing order/deal is not proof of rejection. Broker receipts and observed fills are distinct.'});
      return record;
      });
    },
    async cancel(args,signal) {
      main();check(args.user_authorized===true,'FORBIDDEN','Cancellation requires user trading intent');
      const backendCommandId=commandId(args.operation_id),fingerprint=digest(args);
      return exclusive(host,async()=>{
        const previous=stored('commands',args.operation_id);if(previous){owner(previous);check(previous.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','Cancellation ID already used');return previous;}
        const original=recordFor(args.original_operation_id);requireOpen(original);
        check(!host.storage.list('commands').some(x=>x.kind==='cancel' && x.originalOperationId===original.id && ['submitting','outcome_unknown'].includes(x.status)),'UNRESOLVED_CANCEL','An earlier cancellation result is unknown; query that operation instead of replacing its ID');
        let record={id:args.operation_id,fingerprint,kind:'cancel',backend:original.backend,account:original.account,symbol:original.symbol,conversationId:host.scope.conversationId,originalOperationId:original.id,backendCommandId,createdAt:now(),status:'submitting'};save(record);
        try {const receipt=await adapters.cancel(original,original.backend==='qmt'?args.operation_id:backendCommandId,bounded(signal));record={...record,receipt,status:outcome(original.backend,receipt),completedAt:now()};if(['execution_reported','submitted'].includes(record.status))record.status='cancel_requested';}
        catch(error){record={...record,status:'outcome_unknown',error:{code:error.code??'SOURCE_UNAVAILABLE',message:'Cancellation unconfirmed; inspect the original order and fills'},completedAt:now()};}
        return save(record);
      });
    },
  };
}
