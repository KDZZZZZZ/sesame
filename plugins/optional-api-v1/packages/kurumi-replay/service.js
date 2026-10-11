import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { auditLedger } from './ledger.js';
import { revealedCutoff } from './reveal-cutoff.js';
import { createRun, snapshot } from './native-engine.js';
import { prepareData, loadData, clearData } from './data.js';

export const PLAYER_TOOLS = Object.freeze(['kurumi_observe', 'kurumi_decide']);
export const assert = (ok, message, code = 'INVALID_ARGUMENT') => { if (!ok) throw Object.assign(new Error(message), { code }); };
const clone = value => structuredClone(value);
const prices = q => ({open:q.open,high:q.high,low:q.low,close:q.close});
const roleBar=f=>({time:f.time,bid:prices(f.bid),ask:prices(f.ask),...(f.fx?{fx:{time:f.fx.time??f.time,bid:prices(f.fx.bid),ask:prices(f.fx.ask)}}:{})});
function repeat(doc,id,input) {if(!doc?.commands[id])return false; assert(isDeepStrictEqual(doc.commands[id].input,input),'同command_id不同请求被拒绝','IDEMPOTENCY_CONFLICT');return true;}
function record(doc,id,input) {assert(Object.keys(doc.commands).length<10000,'操作账本超过限额');doc.commands[id]={input};}
const COLLECTION = 'challenge';
const DOCUMENT = 'continuous';
const terminal = status => ['succeeded','completed','failed','cancelled','canceled','expired','interrupted','timed_out'].includes(status);
const services = new Map();
export function getService(host) { const s = services.get(host.storage.directory); assert(s, '回放服务未激活', 'SERVICE_UNAVAILABLE'); return s; }
export function setService(host, service) { services.set(host.storage.directory, service); }
export function removeService(host) { services.delete(host.storage.directory); }
function saveTaskEvidence(doc,active,task){if(!task?.id)return;const rows=doc.roleTasks??=[];if(rows.some(r=>r.taskId===task.id))return;rows.push({taskId:task.id,requestId:task.requestId??active?.requestId??null,conversationId:task.conversationId??null,actorRunId:task.runId??null,model:task.model??doc.model,status:task.status,decided:active?.decided??doc.lastTaskReceipt?.decided??false,inputSnapshot:active?.request?.input?.snapshot?clone(active.request.input.snapshot):null,turns:task.turns??null,toolCalls:(Array.isArray(task.toolCalls)?task.toolCalls:[]).slice(0,4).map(c=>({name:c.name,status:c.status,startedAt:c.startedAt,completedAt:c.completedAt})),text:String(task.result?.text??'').slice(0,4096),createdAt:task.createdAt??null,completedAt:task.completedAt??null});}
// Tool DTOs deliberately omit wheels, licenses and duplicate dependency receipts.
function nativeSummary(env) {
  if (!env) return null;
  const result = {ready:env.ready === true, engine:env.engine ?? 'nautilus-trader', version:env.engineVersion ?? env.version ?? null,
    configDigest:env.configDigest ?? env.dependencyReceipt?.configDigest ?? null};
  for (const key of ['status','platform','architecture','python','pythonPath','directory','receiptSource','reason','message'])
    if (env[key] !== undefined) result[key] = typeof env[key] === 'string' ? env[key].slice(0,2048) : env[key];
  return result;
}
// Only the durable challenge engine is the financial authority. A native cache
// candidate is not a committed account. Never replay while classifying a guard.
function recoveryFacts(doc) {
  const r=doc.control.recovery, engine=doc.engine;
  const evidence=doc.roleEvidence?.find(e=>e.decision?.id===r.decisionId), decision=evidence?.decision;
  const version=r.originalEngineVersion ?? decision?.expectedVersion;
  const facts={decisionId:r.decisionId,originalEngineVersion:version ?? null,currentEngineVersion:engine.version};
  const unknown=reason=>({...facts,status:'unknown',reason:reason+'；保留恢复占位。请用 kurumi_status / kurumi_export 核对原决定、版本与固定来源，再以新 command_id 显式 reconcile；不要 start/recover 或改写账本。'});
  if (!decision || !Number.isInteger(version) || decision.expectedVersion!==version || decision.runId!==engine.id || (r.runId && r.runId!==engine.id) || (r.stepId && r.stepId!==decision.stepId)) return unknown('原决定或原引擎版本/Run身份不完整或不一致');
  if (r.dataDigests && !isDeepStrictEqual(r.dataDigests,engine.dataDigests)) return unknown('恢复预约的固定来源与账户来源不一致');
  try {auditLedger(engine);} catch(error) {return unknown('持久财务账本无法对账：'+error.message);}
  if (!Array.isArray(engine.decisions) || !Array.isArray(engine.fills)) return unknown('持久决定/成交账本不完整');
  const sameStep=engine.decisions.filter(e=>e.decision?.id===decision.id || e.decision?.stepId===decision.stepId);
  if (sameStep.length===1 && isDeepStrictEqual(sameStep[0].decision,decision) && engine.version>=version+1)
    return {...facts,status:'committed',reason:'持久真实账户账本已有完全相同的原决定；只解除占位，不推进、不重复记账'};
  if (sameStep.length) return unknown('该步账本有冲突/重复决定，或提交版本不一致');
  if (engine.version!==version || decision.stepId!==`${engine.id}:${engine.chapter}:${engine.index}`) return unknown('账本版本/游标已变但未找到原决定');
  for (const [key,value] of [['originalDecisionCount',engine.decisions.length],['originalFillCount',engine.fills.length],['originalBalance',engine.balance]])
    if (r[key]!==undefined && r[key]!==value) return unknown('未提交版本的数量/余额与预约前不一致');
  if (evidence.status!=='failed_not_committed') return unknown('原决定证据状态不能确认为未提交');
  return {...facts,status:'not_committed',reason:'持久账户仍为原版本/游标且该步无决定提交；已解除占位，可用新 command_id 显式 recover 原决定'};
}

const PLAYER_INSTRUCTIONS = `你扮演一个非官方二创角色久留美，进行外汇模拟手动交易。你真心想把最初30万日元变成可结算2000万日元。你焦虑、珍惜曾见过的浮盈、偶尔贪心，但能够反省并学习止损。不要刻意输，也不要假装自己知道未来。只根据本任务给出的已收盘H1、模拟账户和已发生摘要决定。不得从预训练记忆主动引用之后的历史事件、政策变动或价格。此实验不是严格盲测。你只有两个工具：kurumi_observe与kurumi_decide。先observe核对本步与资金；随后decide提交一次目标基础货币数量（带符号整数，1000倍数；0为空仓；正多负空）和止损，可明确hold沿用当前quantity。提交后不再请求另一步，也不再尝试第二次不同决定。说简短原创角色短句，不抄漫画。工具决定才有效，最终聊天文本不能代替决定。不要请求文件、网络、配置、其他工具、记忆或委派。决定将在下一H1区间首个真实bid/ask报价执行，期间风险按已明示细粒度成熟引擎模型；止损/强平不保证触发价成交。非历史融资与手续费是模拟规则。提交成功后简短结束。`;

export class ReplayService {
  constructor(host) { this.host = host; this.newState=createRun; this.accountSnapshot=snapshot; this.data = null; this.listeners = new Set(); this.closed = false; this.waiting = new Set(); this.preparing = false; this.jobs = new Map(); this.verifyBackend = signal => this.host.environment.executeWorker('runtime-adapter.js',{action:'status',storageDirectory:this.host.storage.directory},{signal,timeoutMs:600000}); this.advance = async (storageDirectory,state,decision,data,{signal}={}) => this.host.environment.executeWorker('runtime-adapter.js',{action:'advance',storageDirectory,state,decision,data},{signal,timeoutMs:600000}); }
  getDocument() { return this.host.storage.get(COLLECTION, DOCUMENT, true) ?? null; }
  getState() { return this.getDocument()?.engine ?? null; }
  getData() { return this.data; }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(); } catch { /* Each consumer owns its errors. */ } } }
  mutate(expected, fn) {
    let result;
    this.host.storage.transaction(() => {
      const current = this.getDocument();
      assert(current, '先开始挑战');
      if (expected !== undefined) assert(current.revision === expected, '状态版本已改变，请读取最新状态', 'VERSION_CONFLICT');
      const next = clone(current); result = fn(next, current); next.revision++;
      this.host.storage.put(COLLECTION, next);
    });
    this.emit(); return result;
  }
  async initialize() {
    if (this.getDocument()) {
      try { this.data = await loadData(this.host.storage.directory); } catch (e) { this.loadError = e.message; }
      this.mutate(undefined, d => {
        d.control.running = false;
        d.control.remaining = 0;
        if (d.control.recovery) {
          const r=d.control.recovery; r.cancelled=true; r.suspended=true; r.requiresReconcile=true; r.interruptedAt ??= Date.now();
          const e=d.roleEvidence?.find(e=>e.decision?.id===r.decisionId);
          // Compatibility with dev.2 guards: original decision is immutable evidence.
          if (Number.isInteger(e?.decision?.expectedVersion)) r.originalEngineVersion ??= e.decision.expectedVersion;
          if (typeof e?.decision?.runId==='string') r.runId ??= e.decision.runId;
          if (typeof e?.decision?.stepId==='string') r.stepId ??= e.decision.stepId;
          const row=d.recoveries?.find(row=>row.commandId===r.commandId);
          if (row) {row.interruptedAt ??= r.interruptedAt; row.requiresReconcile=true;}
        }
        d.control.phase = d.control.recovery?'recovery_requires_reconcile':d.control.active ? 'restart_requires_explicit_continue' : 'paused';
        if (d.control.active) d.control.active.suspended = true;
      });
    }
  }
  async prepare(signal) {
    assert(!this.preparing, '数据准备正在进行');
    assert(!this.getDocument()?.control.running && !this.getDocument()?.control.active&&!this.getDocument()?.control.recovery, '活跃回合期间不能替换行情缓存');
    this.preparing = true;
    try {
      this.nativeEnvironment = await this.host.environment.executeWorker('runtime-adapter.js',{action:'prepare',storageDirectory:this.host.storage.directory},{signal,timeoutMs:600000});
      const prepared = this.getState()?{reused:true,status:'ready',nativeEnvironment:nativeSummary(this.nativeEnvironment)}:await prepareData(this.host.storage.directory, { signal });
      const data = await loadData(this.host.storage.directory);
      const prior = this.getState();
      if (prior) assert(isDeepStrictEqual(prior.dataDigests,data.digests), '当前挑战固定数据摘要不同，拒绝替换', 'DATA_CHANGED');
      this.data = data; this.loadError = null; this.emit(); return prepared;
    } finally { this.preparing = false; }
  }
  async clear(signal) { assert(!this.getDocument(), '已存在挑战账本，不能清除它所依赖的数据'); signal?.throwIfAborted(); return clearData(this.host.storage.directory); }
  observe() {
    const state = this.getState(); assert(state && this.data, this.loadError ?? '先准备行情并开始挑战');
    const frames = this.data.frames[state.chapter], current = frames[state.index];
    assert(current, '当前已揭示快照缺失', 'SOURCE_UNAVAILABLE');
    const view = this.accountSnapshot(state, current);
    const displayPosition=state.position?{quantity:state.position.quantity,entry:state.position.entry,stop:state.position.stop,instrument:state.position.instrument,lotCount:state.position.lots.length,recentLots:clone(state.position.lots.slice(-8))}:null;
    view.position=displayPosition;
    const stepId = `${state.id}:${state.chapter}:${state.index}`;
    // Only this explicitly built DTO crosses into the role-playing task. No
    // window endpoints, dataset path, future chapters or plot synopsis.
    return { runId: state.id, stepId, expectedVersion: state.version, chapter: state.chapter + 1,
      symbol: this.data.chapters[state.chapter].symbol, asOf: revealedCutoff(state,current),
      account: view, position: displayPosition, balance: state.balance,
      bars: frames.slice(0,state.index+1).filter(f=>f.time+3600000<=revealedCutoff(state,current)).slice(-32).map(roleBar),
      recentDecisions: state.decisions.slice(-5).map(e=>({stepId:e.decision.stepId,target:e.decision.target,stop:e.decision.stop,reason:e.decision.reason.slice(0,500),utterance:e.decision.utterance?.slice(0,200),executionTime:e.executionTime})), recentFills: state.fills.slice(-8).map(e=>({id:e.id,time:e.time,instrument:e.instrument,signedQuantity:e.signedQuantity,price:e.price,reason:e.reason,realizedJpy:e.realizedJpy,commission:e.commission,balanceAfter:e.balanceAfter})),
      rules: { initialJPY: '300000', targetJPY: '20000000', externalFunding: false, leverage: view.leverage, stopOutRatio: view.stopout, quantityUnit: this.data.chapters[state.chapter].symbol.slice(0,3), quantityStep: '1000', commissionJPYPer1000EachSide: '3', financingJPYPer1000PerUTCDay: '10', execution: '下一H1区间首个真实bid/ask报价执行；NautilusTrader消费真实逐报价，买ask卖bid，点差不重复扣；预算触发M1则当前profile暂停；止损跳空不保证触发价成交'+(this.data.chapters[state.chapter].symbol.endsWith('CHF')?'；本时钟之前最新真实CHFJPY换汇，最大age60秒，超则暂停':''), modelMemoryLimitation: '预训练模型可能记得历史，不是严格盲测' } };
  }
  status() {
    const doc = this.getDocument();
    let task = null;
    if (doc?.control.active?.taskId) { try { task = this.host.agents.inspect(doc.control.active.taskId); } catch (e) { task = { error: e.message }; } }
    return { simulated: true, prepared: !!this.data, nativeEnvironment: nativeSummary(this.nativeEnvironment), preparing: this.preparing, loadError: this.loadError ?? null, revision: doc?.revision ?? 0, runId: doc?.engine.id ?? null,
      state: doc ? { chapter: doc.engine.chapter + 1, index: doc.engine.index, status: doc.engine.status, balance: doc.engine.balance, position: doc.engine.position, decisions: doc.engine.decisions.length, fills: doc.engine.fills.length } : null,
      control: doc ? { phase: doc.control.phase, running: doc.control.running, remaining: doc.control.remaining, active: doc.control.active ? { requestId: doc.control.active.requestId, taskId: doc.control.active.taskId, stepId: doc.control.active.stepId, decided: doc.control.active.decided, attempt: doc.control.active.attempt } : null } : null,
      model: doc?.model ?? null, recovery:doc?.control.recovery?{commandId:doc.control.recovery.commandId,decisionId:doc.control.recovery.decisionId,originalEngineVersion:doc.control.recovery.originalEngineVersion??null,requiresReconcile:doc.control.recovery.requiresReconcile??false,cancelled:doc.control.recovery.cancelled??false}:null, reconciliation:doc?.lastRecoveryReconciliation??null, error:doc?.control.error??null, task };
  }
  chooseModel() {
    const model = this.host.inference.models().find(m => m.provider === 'openai' && m.id === 'gpt-6.1-sol');
    assert(model, '当前未配置 openai/gpt-6.1-sol；暂停，绝不切换其他模型', 'MODEL_UNAVAILABLE'); return clone(model);
  }
  start({ command_id, expected_version, max_steps = 1 }, signal) {
    signal?.throwIfAborted(); assert(this.data && !this.preparing, '先准备并验证真实历史行情');
    const old = this.getDocument();
    const command={kind:'run',expected_version,max_steps};
    if (repeat(old,command_id,command)) return this.status();
    const model = this.chooseModel();
    if (!old) {
      assert(expected_version === 0, '新挑战版本必须0');
      const engine = this.newState(`kurumi-${randomUUID()}`, this.data.chapters, this.data.digests);
      this.host.storage.transaction(() => {
        assert(!this.getDocument(), '挑战已存在', 'VERSION_CONFLICT');
        this.host.storage.put(COLLECTION, { id: DOCUMENT, revision: 1, engine, model, commands: { [command_id]: {input:command} }, control: { phase: 'ready', running: true, remaining: max_steps, active: null, attempt: 0 } });
      }); this.emit();
    } else {
      assert(isDeepStrictEqual(old.engine.dataDigests,this.data.digests),'私有行情快照与本Run固定来源不同；暂停，不用新下载数据悄悄续接旧资金','SOURCE_CHANGED');
      assert(!old.control.active&&!old.control.recovery, '当前决定尚未核对完成；先暂停并核对，不重发模型', 'DECISION_PENDING');
      assert(old.engine.status !== 'complete' && old.engine.outcome !== 'bankrupt' && !old.engine.balance.startsWith('-') && old.engine.balance !== '0', '挑战已结束或破产，不再付费推进');
      this.mutate(expected_version, d => { d.model = model; record(d,command_id,command); d.control.running = true; d.control.remaining = max_steps; d.control.phase = 'ready'; });
    }
    const pending=this.launch(signal);return pending?.then?pending.then(()=>this.status()):this.status();
  }
  reconcile({ command_id, expected_version }, signal) {
    signal?.throwIfAborted(); const old = this.getDocument(); assert(old, '尚无挑战');
    const command={kind:'reconcile',expected_version};
    if (repeat(old,command_id,command)) return this.status();
    assert(!this.recovering,'原生恢复尚在运行，不能解除预约','DECISION_PENDING');
    if (old.control.recovery) {
      const facts=old.control.active?{status:'unknown',decisionId:old.control.recovery.decisionId,reason:'恢复与角色预约同时存在；先暂停并核对原 taskId 与导出证据，不能清除任一占位'}:recoveryFacts(old);
      this.mutate(expected_version,d=>{
        const guard=d.control.recovery;
        record(d,command_id,command);
        const row=(d.recoveries??=[]).find(row=>row.commandId===guard.commandId);
        const observation={...facts,commandId:command_id,reconciledAt:Date.now()};
        d.lastRecoveryReconciliation=observation;
        if (row) { (row.reconciliations??=[]).push(observation); row.requiresReconcile=facts.status==='unknown'; }
        d.control.running=false; d.control.remaining=0;
        if (facts.status==='unknown') {
          guard.requiresReconcile=true; guard.cancelled=true; d.control.phase='recovery_reconcile_unknown'; d.control.error=facts.reason;
          return;
        }
        if (row) {row.status=facts.status==='committed'?'committed':'interrupted_not_committed';row.reconciledAt=observation.reconciledAt;}
        if (facts.status==='committed') {
          const e=d.roleEvidence.find(e=>e.decision?.id===guard.decisionId);
          if (e.status!=='recovered_committed') {e.previousStatus=e.status;e.status='recovered_committed';e.recoveryCommandId=guard.commandId;}
          e.receipt ??= {accepted:true,decisionId:guard.decisionId,engineVersion:facts.originalEngineVersion+1};
        }
        d.control.recovery=null; d.control.error=null;
        d.control.phase=facts.status==='committed'?'step_complete':'paused';
      });
      return this.status();
    }
    const a = old.control.active;
    assert(!a || a.taskId,'提交结果未知，没有宿主taskId；先按requestId核对实际宿主任务，不能清除并重付费','TASK_UNKNOWN');
    const knownTaskId=a?.taskId??old.lastTaskReceipt?.taskId;let knownTask=null;
    if (knownTaskId) {
      const task = knownTask=this.host.agents.inspect(knownTaskId);
      assert(terminal(task.status), '当前子任务仍在执行；先暂停/取消后再核对', 'DECISION_PENDING');
    }
    this.mutate(expected_version, d => {saveTaskEvidence(d,a,knownTask);record(d,command_id,command); d.control.running = false; d.control.remaining = 0; d.control.active = null; d.control.phase = 'paused'; d.control.attempt++; });
    return this.status();
  }
  pause({ command_id, expected_version }, signal) {
    signal?.throwIfAborted(); const old = this.getDocument(); assert(old, '尚无挑战');
    const command={kind:'pause',expected_version};
    if (repeat(old,command_id,command)) return this.status();
    this.mutate(expected_version, d => { record(d,command_id,command); d.control.running = false; d.control.remaining = 0; d.control.phase = 'paused'; if (d.control.active) d.control.active.cancelled = true;if(d.control.recovery)d.control.recovery.cancelled=true; });
    if (old.control.active?.taskId) this.host.agents.cancel(old.control.active.taskId, '观众暂停久留美回放');
    return this.status();
  }
  launch(signal) {
    const doc=this.getDocument();if(this.closed||!doc?.control.running||doc.control.active||doc.control.recovery||doc.control.remaining<=0||doc.engine.status==='complete')return;
    if(this.launching)return this.launching;
    const accept=env=>{assert(env?.ready,'撮合后端未通过实际probe；先由主Agent显式prepare，不启动付费任务','NATIVE_NOT_PREPARED');this.nativeEnvironment=env;assert(this.getDocument()?.revision===doc.revision,'后端核对期间状态改变，不提交任务','VERSION_CONFLICT');return this.launchReady();};
    const pause=error=>{if(!this.closed&&this.getDocument()?.revision===doc.revision)this.mutate(undefined,d=>{d.control.running=false;d.control.remaining=0;d.control.phase='backend_not_ready_paused';d.control.error=error.message;});throw error;};
    try{const check=this.verifyBackend(signal);if(!check?.then)return accept(check);const job=check.then(accept).catch(pause);this.launching=job;job.then(()=>{this.launching=null;},()=>{this.launching=null;});return job;}catch(error){return pause(error);}
  }
  launchReady() {
    const d = this.getDocument();
    if (this.closed || !d?.control.running || d.control.active || d.engine.status === 'complete' || d.control.remaining <= 0) return;
    const view = this.observe(), requestId = `${view.stepId}:attempt:${d.control.attempt}`;
    const authorization = randomUUID();
    const request = { requestId, title: `久留美 · 第${view.chapter}章 · ${new Date(view.asOf).toISOString()} H1决定`, kind: 'strategy', instructions: PLAYER_INSTRUCTIONS,
      input: { authorization, snapshot: view }, model: d.model, lane: `kurumi:${d.engine.id}`, queue: 'fifo',
      tools: [...PLAYER_TOOLS], maxTurns: 6, maxToolCalls: 4, timeoutMs: 900000 };
    assert(Buffer.byteLength(JSON.stringify(request))<=40000,'角色请求超过真实宿主40000字节预算；暂停，不截断决定或私自重付费','ROLE_INPUT_LIMIT');
    this.mutate(undefined, next => { next.control.active = { requestId, stepId: view.stepId, authorization, taskId: null, request, decided: false, cancelled: false, attempt: next.control.attempt, chapterAtSubmit: next.engine.chapter }; next.control.phase = 'submitting'; });
    try {
      const task = this.host.agents.submit(request);
      assert(task?.id, '宿主未返回真实Agent任务ID', 'AGENT_SUBMIT_FAILED');
      this.mutate(undefined, next => { assert(next.control.active?.requestId === requestId, '任务已失效'); next.control.active.taskId = task.id; next.control.phase = 'waiting_for_kurumi'; });
      this.watch(task.id, requestId);
    } catch (error) {
      this.mutate(undefined, next => { next.control.running = false; next.control.phase = 'submission_unknown_requires_reconcile'; next.control.error = error.message; });
    }
  }
  watch(taskId, requestId) {
    if (this.waiting.has(taskId)) return; this.waiting.add(taskId);
    // Waiting is observation. No timer/market polling and no automatic retry.
    void this.host.agents.wait(taskId).then(result => {
      if (this.closed || this.getDocument()?.control.active?.requestId !== requestId) return;
      if(!terminal(result?.status)){this.mutate(undefined,d=>{d.control.running=false;d.control.remaining=0;d.control.phase='unknown_task_status_paused';d.control.active.suspended=true;d.control.error='Wait未返回明确终态；保留原任务身份，仅显式核对，不重付费';});return;}
      this.mutate(undefined, d => {
        const active = d.control.active;
        d.lastTaskReceipt = { taskId, requestId, status: result?.status ?? null, decided: active.decided };
        saveTaskEvidence(d,active,this.host.agents.inspect(taskId));
        if (!active.decided || active.cancelled || active.suspended) { d.control.running = false; d.control.phase = active.decided ? 'paused_after_committed_step' : 'no_decision_paused'; }
        else if (d.engine.status === 'complete' || d.engine.outcome === 'bankrupt' || d.engine.balance.startsWith('-') || d.engine.balance === '0' || d.engine.status === 'missing_data' || d.control.remaining <= 0) { d.control.running = false; d.control.phase = d.engine.status === 'complete' ? 'complete' : d.engine.status === 'missing_data' ? 'missing_data_paused' : 'step_complete'; }
        else if (active.chapterAtSubmit !== d.engine.chapter) { d.control.running=false; d.control.phase='chapter_settled_display_next'; }
        else d.control.phase = 'ready';
        d.control.active = null; d.control.attempt = active.decided?0:active.attempt+1;
      }); return this.launch();
    }).catch(error => {
      try { if (!this.closed && this.getDocument()?.control.active?.requestId === requestId) this.mutate(undefined, d => { d.control.running = false; d.control.remaining=0; d.control.phase = 'wait_error_paused'; d.control.error = error.message; }); } catch (persistenceError) { this.closed=true;this.loadError='任务核对无法持久化，内存禁止继续提交：'+persistenceError.message; }
    }).finally(() => this.waiting.delete(taskId));
  }
  authorize(host) {
    assert(host.scope.kind === 'subagent', '只有本步角色子Agent可用', 'SCOPE_DENIED');
    const current = host.agents.current();
    const active = this.getDocument()?.control.active;
    assert(current && active && !active.cancelled && !active.suspended, '没有有效的当前角色任务', 'SCOPE_DENIED');
    // Identity comes from the host, never from caller arguments.
    const taskId = current.id ?? current.taskId ?? current.task?.id;
    const input = current.input ?? current.request?.input;
    assert(taskId === active.taskId && input?.authorization === active.authorization && input?.snapshot?.stepId === active.stepId,
      '当前子任务不属于这个回放步骤', 'SCOPE_DENIED');
    assert(!active.actorRunId || active.actorRunId === host.scope.runId, '角色Run不匹配', 'SCOPE_DENIED');
    return { current, active };
  }
  playerObserve(host) { const { active } = this.authorize(host); assert(!active.decided, '本步已提交，请结束任务'); return this.observe(); }
  async playerDecide(host, args, signal) {
    signal?.throwIfAborted(); const { active } = this.authorize(host);
    const decision = { id: `${active.requestId}:decision`, runId: args.run_id, stepId: args.step_id, expectedVersion: args.expected_version, target: args.target, stop: args.stop ?? null, reason: args.reason, utterance: args.utterance };
    if (active.decided) { assert(isDeepStrictEqual(active.decision,decision), '已决定，同一步不同内容被拒绝', 'IDEMPOTENCY_CONFLICT'); return clone(active.receipt); }
    assert(this.data, '真实行情未准备，暂停', 'SOURCE_UNAVAILABLE');
    if (active.processing) {
      assert(isDeepStrictEqual(active.pendingDecision,decision), '同一步正在撮合，不同决定被拒绝', 'IDEMPOTENCY_CONFLICT');
      assert(this.jobs.has(active.requestId), '撮合过程已中断；先由主Agent核对，不自动重放', 'INTERRUPTED');
      return this.jobs.get(active.requestId);
    }
    const before = this.getState();
    this.mutate(undefined, d => { const a=d.control.active; assert(a?.requestId===active.requestId&&!a.cancelled, '决定已失效'); a.processing=true; a.pendingDecision=decision; a.actorRunId=host.scope.runId; d.control.phase='matching_native'; (d.roleEvidence??=[]).push({taskId:a.taskId,requestId:a.requestId,actorRunId:host.scope.runId,conversationId:host.scope.conversationId,model:d.model,stepId:a.stepId,status:'matching',inputSnapshot:clone(a.request.input.snapshot),decision,receipt:null,submittedAt:Date.now()}); });
    const job = (async () => {
      try {
        // Native matching is deterministic and has no broker-side effects. Only
        // the following transaction may reveal its next interval or move money.
        const after = await this.advance(this.host.storage.directory, clone(before), decision, this.data, {signal});
        signal?.throwIfAborted(); assert(after && after.id===before.id, '原生适配器返回无效Run');
        let receipt;
        this.mutate(undefined, d => {
          const a=d.control.active;
          assert(a?.requestId===active.requestId&&!a.cancelled&&!a.suspended&&d.engine.version===before.version, '观众已暂停或本步状态改变；撮合结果未提交', 'VERSION_CONFLICT');
          if (after.status === 'missing_data') { d.engine=after; d.control.running=false; receipt={accepted:false,paused:true,stepId:active.stepId,reason:after.missingData?.message??'缺失真实报价'}; }
          else { assert(after.version===before.version+1,'原生结果未恰好推进一步'); d.engine=after; d.control.remaining--; receipt={accepted:true,decisionId:decision.id,nextStepId:`${after.id}:${after.chapter}:${after.index}`,engineVersion:after.version,balance:after.balance,status:after.status}; }
          a.processing=false; a.decided=true; a.decision=decision; a.receipt=receipt;
          d.control.phase=after.status==='missing_data'?'missing_data_paused':'committed_waiting_task_finish';
          if(after.outcome==='bankrupt'||after.balance.startsWith('-')||after.balance==='0') { d.control.running=false; d.control.remaining=0; d.control.phase='bankrupt_stopped'; }
          const evidence=d.roleEvidence.find(e=>e.requestId===a.requestId);assert(evidence,'缺少真实决定预约证据');Object.assign(evidence,{status:receipt.accepted?'committed':'paused_without_fill',receipt,observedAt:Date.now()});
        }); return receipt;
      } catch(error) {
        if(this.getDocument()?.control.active?.requestId===active.requestId) this.mutate(undefined,d=>{d.control.running=false;d.control.phase='native_error_paused';d.control.error=error.message;const evidence=d.roleEvidence?.find(e=>e.requestId===active.requestId);if(evidence)Object.assign(evidence,{status:'failed_not_committed',error:{code:error.code??'NATIVE_ERROR',message:error.message},observedAt:Date.now()});});
        throw error;
      } finally {this.jobs.delete(active.requestId);}
    })();
    this.jobs.set(active.requestId,job); return job;
  }
  async recover({command_id,expected_version,decision_id},signal){
    signal?.throwIfAborted();const old=this.getDocument(),command={kind:'recover',expected_version,decision_id};assert(old,'尚无挑战');if(repeat(old,command_id,command))return this.status();
    assert(!this.preparing&&!old.control.active&&!old.control.recovery&&!old.control.running,'有未核对任务或恢复过程；不能重放','DECISION_PENDING');
    assert(isDeepStrictEqual(old.engine.dataDigests,this.data?.digests),'固定来源不同，不能恢复','SOURCE_CHANGED');
    const evidence=old.roleEvidence?.find(e=>e.decision?.id===decision_id);assert(evidence?.status==='failed_not_committed','仅恢复真实失败但未提交的保存决定','RECOVERY_NOT_ALLOWED');
    const decision=clone(evidence.decision);assert(decision.runId===old.engine.id&&decision.stepId===old.engine.id+':'+old.engine.chapter+':'+old.engine.index&&decision.expectedVersion===old.engine.version,'保存决定不属于当前未推进版本','RECOVERY_NOT_ALLOWED');
    assert(!old.engine.decisions.some(e=>e.decision?.id===decision.id||e.decision?.stepId===decision.stepId),'此步已有提交，禁止重复恢复','ALREADY_COMMITTED');
    const task=this.host.agents.inspect(evidence.taskId);assert(terminal(task?.status)&&task.id===evidence.taskId&&task.requestId===evidence.requestId,'旧角色任务身份/终态未核对','DECISION_PENDING');
    assert(isDeepStrictEqual(task.model,evidence.model)&&task.model?.provider==='openai'&&task.model.id==='gpt-6.1-sol','原任务模型证据不匹配','RECOVERY_NOT_ALLOWED');
    assert(task.toolCalls?.some(c=>c.name==='kurumi_decide'&&c.status==='failed'),'没有失败的真实decide调用证据','RECOVERY_NOT_ALLOWED');
    const env=await this.verifyBackend(signal);assert(env?.ready,'撮合后端未实际可用；先显式prepare','NATIVE_NOT_PREPARED');this.nativeEnvironment=env;
    this.mutate(expected_version,d=>{assert(!this.closed&&!this.preparing&&!d.control.recovery&&!d.control.active&&!d.control.running,'后端核对期间状态改变；不能预约恢复','DECISION_PENDING');record(d,command_id,command);d.control.recovery={commandId:command_id,decisionId:decision.id,runId:old.engine.id,stepId:decision.stepId,originalEngineVersion:old.engine.version,originalDecisionCount:old.engine.decisions.length,originalFillCount:old.engine.fills.length,originalBalance:old.engine.balance,dataDigests:clone(old.engine.dataDigests),startedAt:Date.now(),cancelled:false};d.control.phase='recovery_matching_native';d.control.remaining=0;(d.recoveries??=[]).push({commandId:command_id,decisionId:decision.id,originalTaskId:task.id,originalRequestId:task.requestId,originalTaskStatus:task.status,status:'matching',originalEngineVersion:old.engine.version,startedAt:Date.now(),model:evidence.model});});
    this.recovering=true;try{const after=await this.advance(this.host.storage.directory,clone(old.engine),decision,this.data,{signal});signal?.throwIfAborted();assert(after?.id===old.engine.id&&after.version===old.engine.version+1&&after.decisions?.length===old.engine.decisions.length+1&&isDeepStrictEqual(after.decisions.at(-1)?.decision,decision)&&after.status!=='missing_data','恢复未恰好完成真实H1；不提交','NATIVE_RECOVERY_FAILED');
      assert(!this.closed,'恢复服务已中断；保留预约，重启后显式 reconcile','INTERRUPTED');
      this.mutate(undefined,d=>{assert(!this.closed&&d.control.recovery?.commandId===command_id&&!d.control.recovery.cancelled&&d.engine.version===old.engine.version&&!d.control.active,'恢复期间状态改变，不提交','VERSION_CONFLICT');d.engine=after;d.control.running=false;d.control.remaining=0;d.control.recovery=null;d.control.phase='step_complete';d.control.error=null;const row=d.recoveries.find(r=>r.commandId===command_id);Object.assign(row,{status:'committed',completedAt:Date.now(),engineVersion:after.version,balance:after.balance});const e=d.roleEvidence.find(r=>r.decision?.id===decision.id);e.previousStatus=e.status;e.status='recovered_committed';e.recoveryCommandId=command_id;e.receipt={accepted:true,decisionId:decision.id,engineVersion:after.version,balance:after.balance};});return this.status();
    }catch(error){
      // A disposed worker must not access a closed Store, erase a restart guard,
      // or overwrite a later reconciliation/commit with stale failure evidence.
      if (!this.closed) {
        try {
          const current=this.getDocument();
          if (current?.control.recovery?.commandId===command_id && !current.control.recovery.requiresReconcile && current.engine.version===old.engine.version)
            this.mutate(current.revision,d=>{const row=d.recoveries?.find(r=>r.commandId===command_id);if(row)Object.assign(row,{status:'failed_not_committed',error:{code:error.code??'NATIVE_ERROR',message:error.message},completedAt:Date.now()});d.control.recovery=null;d.control.phase='recovery_error_paused';d.control.error=error.message;});
        } catch(persistenceError) {this.closed=true;this.loadError='恢复失败无法持久化；保留预约，重启后显式核对：'+persistenceError.message;}
      }
      throw error;
    }finally{this.recovering=false;}
  }
  async dispose() { this.closed = true; this.listeners.clear(); /* Restart never submits or repeats a model request. */ }
}
