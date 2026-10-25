import { records } from './records.js';
import { exclusive, currentTask } from './execution.js';
import { check, canonical, digest } from '@sesame/plugin-sdk/protocol';
import { assertTradingTask, tradingAccount, verifyExecutionAuthorization } from './trading-context.js';
import { accountRef, instrumentRef, metadata } from './mapping.js';

/** All order entry paths retain this authorization and durable submission boundary. */
export function createCommands(host, transport, { now = Date.now } = {}) {
  const { current, connection, instrumentSymbol, account, read } = transport;
  const storedCommand=id=>{try{return records(host).get('qmt_commands',id)}catch(error){if(error.code==='not_found'||error.code==='NOT_FOUND')return undefined;throw error}};
  return {
    commandRecord(id,scope=host.context,taskHost){
      const scoped = scope?.kind !== 'main';
      if(scoped) { check(taskHost && taskHost.context === scope,'Command receipts require a matching plan task','FORBIDDEN'); assertTradingTask(taskHost,tradingAccount(host)); }
      const record=storedCommand(id);check(record,'QMT command not found','NOT_FOUND');
      if(taskHost) { const c=current(), owner=scoped?currentTask().input.tradingPlan.ownerConversationId:scope.sessionId;
        check(record.accountId===c.account_id && record.connection?.id===c.connection_id,'Command receipt belongs to another account','ACCOUNT_MISMATCH');
        check(record.ownerConversationId===undefined ? !scoped : record.ownerConversationId===owner,'Command receipt belongs to another owner','FORBIDDEN'); }
      return record;
    },
    async command(action,args,signal,scope=host.context,taskHost,authorizationAction=`qmt_trading_${action}`){
      const scoped = scope?.kind !== 'main';
      const signedParameters = args;
      const ownerConversationId = scoped ? currentTask()?.input?.tradingPlan?.ownerConversationId : scope?.sessionId;
      if(scoped) {
        check(taskHost && taskHost.context === scope,'Trading requires a matching plan task','FORBIDDEN');
        args = verifyExecutionAuthorization(assertTradingTask(taskHost,tradingAccount(host),true), authorizationAction, signedParameters, now(), taskHost);
        if(action==='order') check(args.execution_guard && typeof args.execution_guard==='object','Plan orders require a native execution guard','INVALID_ARGUMENT');
        if(action==='order') check(Array.isArray(args.execution_guard.expected_positions),'Plan execution requires a full symbol position expectation','INVALID_ARGUMENT');
      }
      else { const { authorization: _authorization, ...nativeArgs } = args; args = nativeArgs; }
      check(args.user_authorized===true,'Require an explicit user trading instruction','FORBIDDEN');
      const c=current();account(c,accountRef(c));check(args.account_id===c.account_id&&args.connection_revision===String(c.version),'Explicit account/revision changed','CONNECTION_CHANGED');
      check(typeof args.operation_id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(args.operation_id),'Invalid operation ID','INVALID_ARGUMENT');
      if(action==='order'){instrumentSymbol(c,instrumentRef(c,args.symbol));check(['buy','sell'].includes(args.side)&&typeof args.shares==='string'&&/^[1-9]\d*$/.test(args.shares)&&BigInt(args.shares)<=2147483647n,'Use explicit buy/sell and positive integer shares','INVALID_ARGUMENT');check(typeof args.price==='string'&&/^(0|[1-9]\d*)(\.\d+)?$/.test(args.price)&&Number(args.price)>0&&Number.isFinite(Number(args.price)),'Invalid positive limit price','INVALID_ARGUMENT');}
      return exclusive(host,async()=>{
        if(scoped) verifyExecutionAuthorization(assertTradingTask(taskHost,tradingAccount(host),true), authorizationAction, signedParameters, now(), taskHost);
        check(canonical(connection(current()))===canonical(connection(c)),'Connection changed before submission','CONNECTION_CHANGED');
        const fingerprint=digest({action,args,connection:connection(c)}),old=storedCommand(args.operation_id);
        if(old){check(old.fingerprint===fingerprint,'Operation ID already used for different input','IDEMPOTENCY_CONFLICT');check(old.ownerConversationId===undefined ? !scoped : old.ownerConversationId===ownerConversationId,'Operation ID belongs to another owner','FORBIDDEN');return old;}
        let payload={...args,remark:'S'+digest(args.operation_id).slice(7,30)};
        if(action==='cancel'){
          const original=storedCommand(args.original_operation_id),accepted=original?.status==='submitted'&&original.result?.order_id===args.order_id,recoverable=original?.status==='outcome_unknown'&&original.intent;
          const originalAccountMatches=original?.accountId===c.account_id || original?.accountId===undefined && original?.connection?.revision===String(c.version);
          check(original?.action==='order'&&(accepted||recoverable)&&original.connection?.id===c.connection_id&&originalAccountMatches,'Cancel requires an accepted order or a recoverable original intent on this account/connection','INVALID_ARGUMENT');
          check(original.ownerConversationId===undefined || original.ownerConversationId===ownerConversationId,'Original order belongs to another owner','FORBIDDEN');
          payload.remark=original.remark;
          if(original.intent) payload.original_intent=original.intent;
        }
        let record={id:args.operation_id,action,fingerprint,connection:connection(c),accountId:c.account_id,remark:payload.remark,status:'outcome_unknown',createdAt:now()};
        if(ownerConversationId!==undefined)record.ownerConversationId=ownerConversationId;
        if(action==='order')record.intent={symbol:args.symbol,side:args.side,shares:args.shares,price:args.price};
        records(host).put('qmt_commands',record); // durable boundary before native submission; never replay unknown intent.
        try{signal?.throwIfAborted();const r=await read(c,action,payload,signal);check(r.result.status===(action==='order'?'submitted':'cancel_requested')&&/^[1-9]\d*$/.test(r.result.order_id??''),'Native submission receipt is invalid','SOURCE_DATA_INVALID');check(action!=='cancel'||r.result.order_id===args.order_id,'Cancel receipt order ID differs','SOURCE_DATA_INVALID');record={...record,status:r.result.status,result:r.result,meta:metadata(r)};records(host).put('qmt_commands',record);return record;}
        catch(error){const notSent=error.details?.submission_attempted===false;record={...record,status:error.code==='BROKER_REJECTED'||notSent?'rejected':'outcome_unknown',error:{code:error.code??'SOURCE_UNAVAILABLE',message:notSent?'Native execution guard rejected before submission.':'Submission outcome is unconfirmed; inspect native orders/fills before taking another action.'}};records(host).put('qmt_commands',record);throw error;}
      });
    },
  };
}
