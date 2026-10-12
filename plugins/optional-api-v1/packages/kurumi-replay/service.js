import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { auditLedger } from './ledger.js';
import { revealedCutoff } from './reveal-cutoff.js';
import { createRun, snapshot, consumedInterval } from './native-engine.js';
import { archiveTerminal, createExperiment, experimentHistory } from './experiment-lifecycle.js';
import { resolveExperimentProfile, ROUND2_PROFILE_ID, canonical, sha256 } from './experiment-profiles.js';
import { join } from 'node:path';
import { prepareExperimentFx, publishExperimentFx } from './experiment-fx.js';
import { recordingSelection } from './recording-selection.js';
import { methodWorkflow } from './method-workflow.js';
import { playbackFrames,deltaBatch,waitPlayback } from './committed-playback.js';
import {audienceDriver} from './main-audience-driver.js';
import {freezeBeforeNative} from './utc-before-step.js';
import { mainChatWorkflow } from './main-chat-workflow.js';
import { createExperiencePlan,assertExperienceStart,applyExperienceStop,experienceUsage,EXPERIENCE_GATES } from './experience-plan.js';
import { prepareData, loadData, clearData } from './data.js';
import { Recorder } from './recording.js';
import { checkpointTextRepair } from './checkpoint-text-repair.js';
import { prepareFxSupplement, publishFxSupplement } from './fx-supplement.js';

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
const ARCHIVE_CODES = new Set(['ARCHIVE_WRITE_FAILED','ARCHIVE_CONFLICT','ARCHIVE_BUDGET','ARCHIVE_JOURNAL_CORRUPT']);
const isArchiveError = error => ARCHIVE_CODES.has(error?.code);
// 完整角色任务证据：最终文字与工具调用不再截断（0.1.2-dev.1 起；完整原始证据另入 recording 归档）。
function saveTaskEvidence(doc,active,task){if(!task?.id)return;const rows=doc.roleTasks??=[];if(rows.some(r=>r.taskId===task.id))return;rows.push({taskId:task.id,requestId:task.requestId??active?.requestId??null,conversationId:task.conversationId??null,actorRunId:task.runId??null,model:task.model??doc.model,status:task.status,decided:active?.decided??doc.lastTaskReceipt?.decided??false,inputSnapshot:active?.request?.input?.snapshot?clone(active.request.input.snapshot):null,turns:task.turns??null,toolCalls:Array.isArray(task.toolCalls)?clone(task.toolCalls):[],text:String(task.result?.text??''),textTruncated:false,createdAt:task.createdAt??null,completedAt:task.completedAt??null});}
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
const PLAYER_4H_SUFFIX = `本次为4小时决策模式：你的这一次决定执行第一根H1后，当时实际剩余仓位与止损将最多自动保持后续3根H1的真实撮合，期间不再询问你、不伪造你的新决定；止损/强平后保持空仓，绝不重新开仓；章边界/破产/缺数会提前停住并结算。`;

export class ReplayService {
  constructor(host) { this.host = host; this.newState=createRun; this.accountSnapshot=snapshot; this.data = null; this.listeners = new Set(); this.closed = false; this.waiting = new Set(); this.preparing = false; this.jobs = new Map(); this.recorder = null; this.verifyBackend = signal => this.host.environment.executeWorker('runtime-adapter.js',{action:'status',storageDirectory:this.host.storage.directory},{signal,timeoutMs:600000}); this.advance = async (storageDirectory,state,decision,data,{signal}={}) => this.host.environment.executeWorker('runtime-adapter.js',{action:'advance',storageDirectory,state,decision,data},{signal,timeoutMs:600000}); }
  getDocument() {
    const pointer=this.host.storage.get('experiments','current',true);
    if(pointer){const doc=this.host.storage.get(COLLECTION,pointer.documentId,true);assert(doc?.engine.id===pointer.runId,'Current experiment pointer is unknown; do not fall back/reset','TRANSACTION_UNKNOWN');return doc;}
    return this.host.storage.get(COLLECTION, DOCUMENT, true) ?? null;
  }
  archiveTerminal(args,signal) { return archiveTerminal(this,args,signal); }
  createExperiment(args,signal) { return createExperiment(this,args,signal); }
  experimentHistory() { return experimentHistory(this); }
  getSpectatorState() { const state=this.getState();if(!state)return null;const visible=this.host.storage.get('round2-visible-state',state.id,true);return visible?.financialVersion===state.version?visible.engine:state; }
  get presentationEnabled() { return this.getState()?.rules?.experimentProfile?.id===ROUND2_PROFILE_ID; }
  getReplayPresentation() { return this.host.storage.get('round2-presentation',this.getState()?.id,true)??null; }
  getState() { return this.getDocument()?.engine ?? null; }
  getData() { return this.data; }
  intervalHours(doc=this.getDocument()) { return doc?.settings?.decisionIntervalHours ?? 1; }
  simClock() { const state=this.getState(); if(!state||!this.data)return null; const frame=this.data.frames[state.chapter]?.[state.index]; return frame?frame.time+3600000:null; }
  emitSpectator(){this.emit();}
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(); } catch { /* Each consumer owns its errors. */ } } }
  mutate(expected, fn) {
    let result;
    this.host.storage.transaction(() => {
      const current = this.getDocument();
      assert(current, '先开始挑战');
      assert(!this.host.storage.get('experiment-history',current.engine.id,true),'Terminal history is immutable; create a separate experiment, never mutate/reset old continuous','HISTORY_SEALED');
      if (expected !== undefined) assert(current.revision === expected, '状态版本已改变，请读取最新状态', 'VERSION_CONFLICT');
      const next = clone(current); result = fn(next, current); next.revision++;
      this.host.storage.put(COLLECTION, next);
    });
    // A new-profile financial CAS is not broadcast until its consumed-only
    // presentation/weekly freeze hooks finish; no old/future OHLC flash.
    if(!(this.host.storage.list?.('committed-hooks')??[]).some(r=>r.runId===this.getState()?.id&&r.status!=='done'))this.emit();
    return result;
  }
  // 归档：追加哈希链原始证据；失败暂停后续付费回合（素材完整性是硬约束）。
  async archiveSafe(kind, payload, opts = {}) {
    assert(!this.recordingSelectionError,this.recordingSelectionError?.message??'Recorder selection pending',this.recordingSelectionError?.code??'ARCHIVE_MISSING');
    if (!this.recorder) return null;
    try { return await this.recorder.append(kind, payload, { simClockMs: opts.simClockMs ?? this.simClock() }); }
    catch (error) { this.markArchiveFailed(error, { pendingKind: kind, pendingPayload: payload }); throw error; }
  }
  async archiveFileSafe(relPath, content) {
    assert(!this.recordingSelectionError,this.recordingSelectionError?.message??'Recorder selection pending',this.recordingSelectionError?.code??'ARCHIVE_MISSING');
    if (!this.recorder) return null;
    try { return await this.recorder.file(relPath, content); }
    catch (error) { this.markArchiveFailed(error, { pendingFile: { path: relPath, ...(Buffer.isBuffer(content)||content instanceof Uint8Array?{encoding:'base64',content:Buffer.from(content).toString('base64')}:{content}) } }); throw error; }
  }
  markArchiveFailed(error, pending = {}) {
    if (this.closed) return;
    try { this.mutate(undefined, d => { d.control.running=false; d.control.remaining=0; d.control.phase='archive_failed_paused';
      const prev = d.control.archiveFailed && typeof d.control.archiveFailed === 'object' ? d.control.archiveFailed : null;
      const pendings = [...(prev?.pendings ?? (prev?.pendingKind || prev?.pendingFile ? [{ pendingKind: prev.pendingKind, pendingPayload: prev.pendingPayload, pendingFile: prev.pendingFile }] : []))];
      if (pending.pendingKind || pending.pendingFile) pendings.push(pending); // 后续错误（含清理/封存）不覆盖先前待补的已提交H1
      d.control.archiveFailed = { at: Date.now(), error: error.message, pendings, failures: [...(prev?.failures ?? []), ...(prev ? [{ at: prev.at, error: prev.error }] : [])] };
      d.control.error='归档失败，已暂停付费回合：'+error.message; }); }
    catch (persistenceError) { this.closed=true; this.loadError='归档失败且无法持久化暂停状态：'+persistenceError.message; }
  }
  clearArchiveFailed(reason) {
    const doc=this.getDocument();
    if (!doc?.control.archiveFailed) return;
    this.mutate(undefined, d => { d.control.archiveFailed=null; d.control.error=null; if(d.control.phase==='archive_failed_paused')d.control.phase='paused'; (d.archiveRecoveries??=[]).push({reason,recoveredAt:Date.now()}); });
  }
  async assertArchiveHealthy() {
    assert(!this.recordingSelectionError,this.recordingSelectionError?.message??'Recorder selection pending',this.recordingSelectionError?.code??'ARCHIVE_MISSING');
    const af = this.getDocument()?.control?.archiveFailed;
    if (!af) return;
    // 已提交但未写入归档的条目必须按 pendings 队列逐个先补齐（含后续失败时排队的全部条目），
    // 不能仅以探测成功解除暂停；任何一个补不齐都保持暂停并抛错。
    const pendings = af.pendings ?? (af.pendingKind || af.pendingFile ? [{ pendingKind: af.pendingKind, pendingPayload: af.pendingPayload, pendingFile: af.pendingFile }] : []);
    if (!pendings.length) await this.recorder.append('archive_recovery_probe', { reason: '付费回合恢复前的归档健康探测' }, { simClockMs: this.simClock() });
    for (const p of pendings) {
      if (p.pendingFile) {const f=p.pendingFile;const content=f.encoding==='base64'?Buffer.from(f.content,'base64'):f.content?.type==='Buffer'&&Array.isArray(f.content.data)?Buffer.from(f.content.data):f.content;await this.recorder.file(f.path,content);}
      else await this.recorder.append(p.pendingKind, p.pendingPayload ?? { recovered: true }, { simClockMs: this.simClock() });
    }
    this.clearArchiveFailed('pending_repair:' + (pendings.map(p => p.pendingFile?.path ?? p.pendingKind).join(',') || 'probe'));
  }
  async initialize() {
    if(!this.recorder){try{const selection=await recordingSelection(this.host.storage.directory);this.recordingSelection=selection;this.recorder=new Recorder(this.host.storage.directory,{mirrorRoot:selection.mirrorRoot});}catch(e){if(e.code!=='MIRROR_SELECTION_REQUIRED')throw e;this.recordingSelectionError={code:e.code,message:e.message};}}
    if(this.recorder)await this.recorder.initialize();
    if (this.getDocument()) {
      try { this.data = await loadData(this.host.storage.directory); } catch (e) { this.loadError = e.message; }
      const sealed=this.host.storage.get('experiment-history',this.getState().id,true);
      if(!sealed&&this.getState().status!=='complete')this.mutate(undefined, d => {
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
        // Pending spectator hooks are persisted separately; restart never executes paid tasks.
        if(d.control.hookFailure)d.control.phase='committed_hooks_pending';
        // continuation 占位原样保留：剩余自动延续由显式 start/continue 恢复，绝不自动发新付费模型。
      });
    }
  }
  async prepare(signal) {
    assert(!this.recordingSelectionError,'先显式固定已有归档mirror，不自动移动','MIRROR_SELECTION_REQUIRED');
    assert(!this.preparing, '数据准备正在进行');
    assert(!this.getDocument()?.control.running && !this.getDocument()?.control.active&&!this.getDocument()?.control.recovery, '活跃回合期间不能替换行情缓存');
    this.preparing = true;
    try {
      this.nativeEnvironment = await this.host.environment.executeWorker('runtime-adapter.js',{action:'prepare',storageDirectory:this.host.storage.directory},{signal,timeoutMs:600000});
      const prepared = this.getState()?{reused:true,status:'ready',nativeEnvironment:nativeSummary(this.nativeEnvironment)}:await prepareData(this.host.storage.directory, { signal });
      const data = await loadData(this.host.storage.directory);
      const prior = this.getState();
      if (prior) assert(isDeepStrictEqual(prior.dataDigests,data.digests), '当前挑战固定数据摘要不同，拒绝替换', 'DATA_CHANGED');
      this.data = data; this.loadError = null; this.emit();
      await this.archiveSafe('prepare',{prepared,nativeEnvironment:nativeSummary(this.nativeEnvironment),dataDigests:data.digests});
      return prepared;
    } finally { this.preparing = false; }
  }
  async clear(signal) { assert(!this.getDocument(), '已存在挑战账本，不能清除它所依赖的数据'); signal?.throwIfAborted(); return clearData(this.host.storage.directory); }
  async importFxSupplement({command_id,expected_version,bundle_directory},signal) {
    signal?.throwIfAborted(); const old=this.getDocument(), command={kind:'import_fx_supplement',expected_version,bundle_directory};
    assert(old && this.data,'先核对当前挑战与固定快照');
    if(repeat(old,command_id,command))return this.status();
    assert(old.revision===expected_version,'状态版本改变','VERSION_CONFLICT');
    assert(!this.preparing&&!old.control.running&&!old.control.active&&!old.control.recovery&&!old.control.archiveFailed,'补充数据只允许已暂停且归档健康时导入','DECISION_PENDING');
    assert(old.engine.status==='missing_data','仅补齐缺数暂停的未提交时段');
    const frames=this.data.frames[old.engine.chapter], next=frames[old.engine.index+1];
    assert(next,'没有可补充的下一小时'); this.preparing=true;
    try {
      const prepared=await prepareFxSupplement(bundle_directory,{runId:old.engine.id,from:next.time,toExclusive:frames.at(-1).time+3600000,
        snapshotDigest:this.data.digests.download,configDigest:this.data.digests.config});
      signal?.throwIfAborted();
      const archiveFiles=[];
      for(const [item,bytes] of prepared.files)archiveFiles.push(await this.archiveFileSafe(`data-supplements/${item.path}`,bytes));
      await this.archiveSafe('fx_supplement_verified',{index:prepared.index,rowCount:prepared.rowCount,archiveFiles,engineVersion:old.engine.version,
        note:'显式补入另一个来源的真实直接CHFJPY报价；原来源与已提交账本不变，只在原报价超过60秒时采用仍在60秒内的过去报价。'});
      assert(!this.closed&&this.getDocument().revision===old.revision,'导入期间状态改变；未发布','VERSION_CONFLICT');
      signal?.throwIfAborted();const result=await publishFxSupplement(this.host.storage.directory,prepared);
      this.mutate(expected_version,d=>{record(d,command_id,command);(d.fxSupplements??=[]).push({commandId:command_id,index:prepared.index,rowCount:prepared.rowCount,installedAt:Date.now()});});
      await this.archiveSafe('fx_supplement_installed',{commandId:command_id,index:prepared.index,engineVersion:old.engine.version,reused:result.reused});
      return {installed:true,reused:result.reused,rowCount:prepared.rowCount,engineUnchanged:true,engineVersion:old.engine.version,revision:this.getDocument().revision,index:prepared.index};
    } finally {this.preparing=false;}
  }
  async bindExperimentFx({command_id,expected_version,run_id,bundle_directory},signal) {
    assert(typeof command_id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(command_id),'Stable command id required','INVALID_ID');
    const input={kind:'bind_experiment_fx',expected_version,run_id,bundle_directory},prior=this.host.storage.get('experiment-commands',command_id,true);
    if(prior){assert(isDeepStrictEqual(prior.input,input),'Changed FX command content','IDEMPOTENCY_CONFLICT');if(prior.status==='committed')return clone(prior.result);}
    if(prior&&this.getDocument()?.control.archiveFailed)await this.assertArchiveHealthy();
    const old=this.getDocument();
    assert(old?.engine.id===run_id&&old.engine.rules.experimentProfile?.id===ROUND2_PROFILE_ID,'Explicit NEW50x run binding required','RUN_MISMATCH');
    assert(prior||old.revision===expected_version,'Stale document revision','VERSION_CONFLICT');
    assert(old.engine.version===1&&!old.control.running&&!old.control.active&&!old.control.recovery&&!old.control.continuation&&!old.control.archiveFailed&&!this.preparing,'Bind complete window before any new-run consumption','DECISION_PENDING');
    assert((this.host.storage.list('experiment-commands')??[]).filter(r=>r.status!=='committed').every(r=>r.id===command_id),'Unknown other lifecycle transaction blocks FX publication','TRANSACTION_UNKNOWN');
    const engineDigest=sha256(canonical(old.engine));if(prior)assert(prior.engineDigest===engineDigest,'Reserved FX engine changed','SOURCE_CHANGED');
    const chapter=old.engine.chapters.findIndex(c=>c.symbol.endsWith('CHF'));assert(chapter>=0,'No CHF chapter');
    const c=old.engine.chapters[chapter],frames=this.data.frames[chapter],from=frames[c.startIndex+1]?.time,toExclusive=frames[c.endIndex]?.time+3600000;
    assert(Number.isSafeInteger(from)&&Number.isSafeInteger(toExclusive),'Full eligible chapter window unavailable','SOURCE_UNAVAILABLE');
    this.preparing=true;try{
      const prepared=await prepareExperimentFx(bundle_directory,{runId:run_id,from,toExclusive,snapshotDigest:this.data.digests.download,configDigest:this.data.digests.config});
      if(prior)assert(isDeepStrictEqual(prior.index,prepared.index),'Reserved supplemental source changed','SOURCE_CHANGED');
      this.host.storage.transaction(()=>{assert(this.getDocument().engine.id===run_id&&sha256(canonical(this.getState()))===engineDigest,'Engine changed before FX reservation','VERSION_CONFLICT');if(!prior)this.host.storage.put('experiment-commands',{id:command_id,input,status:'binding_fx',engineDigest,index:prepared.index});});
      for(const[r,b]of prepared.files)await this.archiveFileSafe(`data-supplements/${r.path}`,b);
      await this.archiveSafe('experiment_fx_verified',{commandId:command_id,index:prepared.index,rowCount:prepared.rowCount});
      signal?.throwIfAborted();assert(!this.closed&&sha256(canonical(this.getState()))===engineDigest&&!this.getDocument().control.running,'State changed; no pointer publication','VERSION_CONFLICT');
      const published=await publishExperimentFx(this.host.storage.directory,prepared);
      const result={bound:true,runId:run_id,rowCount:prepared.rowCount,index:prepared.index,reused:published.reused,engineUnchanged:true,completeForArbitraryExposure:false};
      this.mutate(undefined,d=>{assert(sha256(canonical(d.engine))===engineDigest&&!d.control.running&&!d.control.active&&!d.control.recovery,'FX publication needs explicit reconciliation; engine changed','VERSION_CONFLICT');record(d,command_id,input);d.commands[command_id].result=result;(d.fxSupplements??=[]).push({commandId:command_id,index:prepared.index,rowCount:prepared.rowCount});this.host.storage.put('experiment-commands',{...this.host.storage.get('experiment-commands',command_id),status:'committed',result});});
      return result;
    }finally{this.preparing=false;}
  }
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
      recentDecisions: state.decisions.filter(e=>!e.decision.continuationOf).slice(-5).map(e=>({stepId:e.decision.stepId,target:e.decision.target,stop:e.decision.stop,reason:e.decision.reason.slice(0,500),utterance:e.decision.utterance?.slice(0,200),executionTime:e.executionTime})), recentFills: state.fills.slice(-8).map(e=>({id:e.id,time:e.time,instrument:e.instrument,signedQuantity:e.signedQuantity,price:e.price,reason:e.reason,realizedJpy:e.realizedJpy,commission:e.commission,balanceAfter:e.balanceAfter})),
      rules: { initialJPY: '300000', targetJPY: '20000000', externalFunding: false, leverage: view.leverage, stopOutRatio: view.stopout, quantityUnit: this.data.chapters[state.chapter].symbol.slice(0,3), quantityStep: '1000', commissionJPYPer1000EachSide: '3', financingJPYPer1000PerUTCDay: '10', decisionIntervalHours: this.intervalHours(), execution: '下一H1区间首个真实bid/ask报价执行；NautilusTrader消费真实逐报价，买ask卖bid，点差不重复扣；预算触发M1则当前profile暂停；止损跳空不保证触发价成交'+(this.intervalHours()===4?'；4小时决策模式：决定执行后实际剩余仓位与止损最多自动保持后续3根H1，期间不再询问、绝不重新开仓':'')+(this.data.chapters[state.chapter].symbol.endsWith('CHF')?'；有持仓或非零目标时须使用本时钟之前最新真实CHFJPY换汇，最大age60秒，超则暂停；步前空仓且原决定target=0/stop=null时不需要换汇，主报价仍真实消费，缺少FX明确留痕':''), experimentProfile:resolveExperimentProfile(state).id, experimentInterpretation:state.rules.experimentProfile?.content.interpretation??'legacy continuous experiment', modelMemoryLimitation: '预训练模型可能记得历史，不是严格盲测；同历史第二轮不是样本外' } };
  }
  status() {
    const doc = this.getDocument();
    let task = null;
    if (doc?.control.active?.taskId) { try { task = this.host.agents.inspect(doc.control.active.taskId); } catch (e) { task = { error: e.message }; } }
    return { simulated: true, prepared: !!this.data, nativeEnvironment: nativeSummary(this.nativeEnvironment), preparing: this.preparing, loadError: this.loadError ?? null, revision: doc?.revision ?? 0, runId: doc?.engine.id ?? null,
      state: doc ? { chapter: doc.engine.chapter + 1, index: doc.engine.index, status: doc.engine.status, balance: doc.engine.balance, position: doc.engine.position, decisions: doc.engine.decisions.length, fills: doc.engine.fills.length } : null,
      control: doc ? {audienceHold:doc.control.audienceHold??null,mainChatClaim:doc.control.mainChatClaim??null, phase: doc.control.phase, running: doc.control.running, remaining: doc.control.remaining, active: doc.control.active ? { requestId: doc.control.active.requestId, taskId: doc.control.active.taskId, stepId: doc.control.active.stepId, decided: doc.control.active.decided, attempt: doc.control.active.attempt } : null } : null,
      settings: { decisionIntervalHours: this.intervalHours(doc) },
      experiment:doc?.experiment??null,profile:doc?resolveExperimentProfile(doc.engine):null,
      experience:doc?.experience??null,experienceUsage:doc?.experience?experienceUsage(doc):null,recordingSelection:this.recordingSelection??null,recordingSelectionError:this.recordingSelectionError??null,
      hooks:{failure:doc?.control.hookFailure??null,pending:(this.host.storage.list?.('committed-hooks')??[]).filter(r=>r.runId===doc?.engine.id&&r.status!=='done').map(r=>({id:r.id,status:r.status}))},
      continuation: doc?.control.continuation ? { decisionId: doc.control.continuation.decisionId, remainingBars: doc.control.continuation.remainingBars, committedCount: doc.control.continuation.committedCount } : null,
      archive: { failed: !!doc?.control.archiveFailed, journalSeq: this.recorder?.seq ?? null, root: this.recorder?.root ?? null, mirror: this.recorder?.mirror ?? null },
      model: doc?.model ?? null, recovery:doc?.control.recovery?{commandId:doc.control.recovery.commandId,decisionId:doc.control.recovery.decisionId,originalEngineVersion:doc.control.recovery.originalEngineVersion??null,requiresReconcile:doc.control.recovery.requiresReconcile??false,cancelled:doc.control.recovery.cancelled??false}:null, reconciliation:doc?.lastRecoveryReconciliation??null, error:doc?.control.error??null, task };
  }
  chooseModel() {
    const model = this.host.inference.models().find(m => m.provider === 'openai' && m.id === 'gpt-6.1-sol');
    assert(model, '当前未配置 openai/gpt-6.1-sol；暂停，绝不切换其他模型', 'MODEL_UNAVAILABLE'); return clone(model);
  }
  async repairCheckpointText({ command_id, expected_version }, signal) {
    signal?.throwIfAborted();
    await this.assertArchiveHealthy();
    const old = this.getDocument(), command = { kind: 'repair_checkpoint_text', expected_version };
    assert(old, '尚无挑战');
    if (repeat(old, command_id, command)) return { ...old.commands[command_id].result, status: this.status() };
    assert(old.revision === expected_version, '状态版本已改变，请读取最新状态', 'VERSION_CONFLICT');
    assert(!old.control.running && !old.control.active && !old.control.recovery, '先停止并核对角色终态；不可在运行中修复检查点', 'DECISION_PENDING');
    assert(this.recorder, '原始归档未就绪', 'ARCHIVE_MISSING');
    const repair = await checkpointTextRepair(old, this.recorder.root);
    auditLedger(repair.before); auditLedger(repair.after);
    const directory = `repairs/${old.engine.id}/${command_id}`;
    const beforeFile = await this.archiveFileSafe(`${directory}/before-document.json`, JSON.stringify(old));
    const afterFile = await this.archiveFileSafe(`${directory}/after-engine.json`, JSON.stringify(repair.after));
    const receipt = { repaired: true, runId: old.engine.id, engineVersion: old.engine.version,
      beforeDigest: repair.beforeDigest, afterDigest: repair.afterDigest, changes: repair.changes, proofs: repair.proofs,
      beforeFile, afterFile, note: '仅恢复经原始角色会话验证的 UTF-8 损坏文本；旧档案不变，资金/订单/决定/游标不变，不调用模型或撮合。' };
    await this.archiveSafe('checkpoint_text_repair_prepared', { commandId: command_id, ...receipt });
    signal?.throwIfAborted();
    this.mutate(expected_version, d => {
      assert(!d.control.running && !d.control.active && !d.control.recovery && isDeepStrictEqual(d.engine, repair.before), '修复期间状态改变；不覆盖新状态', 'VERSION_CONFLICT');
      record(d, command_id, command); d.commands[command_id].result = receipt;
      d.engine = repair.after; (d.checkpointTextRepairs ??= []).push({ commandId: command_id, ...receipt });
      d.control.error = null; d.control.phase = 'checkpoint_text_repaired_paused';
    });
    await this.archiveSafe('checkpoint_text_repair_committed', { commandId: command_id, ...receipt });
    return { ...receipt, status: this.status() };
  }
  async configure({ command_id, expected_version, decision_interval_hours }, signal) {
    signal?.throwIfAborted();
    const old = this.getDocument(); assert(old, '尚无挑战；先开始挑战后调整决策间隔');
    const command = { kind: 'configure', decision_interval_hours };
    if (repeat(old, command_id, command)) return this.status();
    assert(!old.experience||decision_interval_hours===4,'Bounded first-chapter test freezes real4H cadence','INVALID_INTERVAL');
    assert(decision_interval_hours === 1 || decision_interval_hours === 4, '决策间隔只允许 1 或 4 小时', 'INVALID_INTERVAL');
    assert(!old.control.active && !old.control.recovery && !old.control.running && !old.control.continuation, '有任务在跑（含未核对角色任务/恢复/待完成自动延续）时不能修改决策间隔；先暂停并核对', 'DECISION_PENDING');
    this.mutate(expected_version, d => { record(d, command_id, command); d.settings = { ...(d.settings ?? {}), decisionIntervalHours: decision_interval_hours }; });
    await this.archiveSafe('configure', { decisionIntervalHours: decision_interval_hours, note: '决策间隔只改变角色决定节奏；4h=每4根可交易H1一次角色决定，末章不足4根提前结算' });
    return this.status();
  }
  async start({ command_id, expected_version, max_steps = 1 }, signal) {
    signal?.throwIfAborted(); assert(this.data && !this.preparing, '先准备并验证真实历史行情');
    const old = this.getDocument();
    const command={kind:'run',expected_version,max_steps};
    assert(!this.recordingSelectionError,'Recorder selection unresolved; no paid task','MIRROR_SELECTION_REQUIRED');
    if (repeat(old,command_id,command)) return this.status();
    if(old)assertExperienceStart(old,max_steps);
    if(old?.experience)assert(this.host.storage.get('initial-warmup',old.engine.id,true),'Bootstrap >=20 actual disclosed native H1 with verified sources before first/new model; no fabricated tick warmup','WARMUP_REQUIRED');
    assert(!old?.control.audienceHold,'Consume native UTC report/PK at held frontier before any next H1','AUDIENCE_HOLD');
    assert(!this.host.storage.list('pk-main-chat').some(r=>r.runId===old?.engine.id&&r.status!=='acknowledged_public_message'),'Acknowledge/reconcile existing native main response before next H1; hold exact frontier','MAIN_CHAT_PENDING');
    if(old?.experience)assert(!this.host.storage.list('round2-pk').some(r=>r.runId===old.engine.id&&r.engineVersion===old.engine.version&&r.cutoffMs===this.getReplayPresentation()?.cutoffMs&&r.status==='ready'&&r.deliveryStatus!=='public_main_message_acknowledged'),'Current4H/UTC facts require ordinary main output ACK, not merely no active claim','MAIN_CHAT_PENDING');
    assert(!old?.control.hookFailure,'Committed spectator/report hooks pending; explicitly retry before advancing','HOOKS_PENDING');
    assert(!(this.host.storage.list?.('experiment-commands')??[]).some(r=>r.status!=='committed'),'Unknown lifecycle transaction; explicitly reconcile the same command, no new task','TRANSACTION_UNKNOWN');
    const model = this.chooseModel();
    if (!old) {
      assert(expected_version === 0, '新挑战版本必须0');
      const engine = this.newState(`kurumi-${randomUUID()}`, this.data.chapters, this.data.digests);
      this.host.storage.transaction(() => {
        assert(!this.getDocument(), '挑战已存在', 'VERSION_CONFLICT');
        this.host.storage.put(COLLECTION, { id: DOCUMENT, revision: 1, engine, model, settings: { decisionIntervalHours: 4 }, commands: { [command_id]: {input:command} }, control: { phase: 'ready', running: true, remaining: max_steps, active: null, attempt: 0 } });
      }); this.emit();
      await this.archiveSafe('challenge_started', { runId: engine.id, model, settings: { decisionIntervalHours: 4 }, dataDigests: this.data.digests });
    } else {
      await this.assertArchiveHealthy();
      assert(isDeepStrictEqual(old.engine.dataDigests,this.data.digests),'私有行情快照与本Run固定来源不同；暂停，不用新下载数据悄悄续接旧资金','SOURCE_CHANGED');
      assert(!old.control.active&&!old.control.recovery, '当前决定尚未核对完成；先暂停并核对，不重发模型', 'DECISION_PENDING');
      assert(old.engine.status !== 'complete' && old.engine.outcome !== 'bankrupt' && !old.engine.balance.startsWith('-') && old.engine.balance !== '0', '挑战已结束或破产，不再付费推进');
      this.mutate(expected_version, d => { d.model = model; record(d,command_id,command); d.control.running = true; d.control.remaining = max_steps; d.control.phase = 'ready'; });
    }
    // 优先恢复中断的自动延续（不消耗付费决定数、不请求模型）；随后才正常调度。
    const chain = Promise.resolve()
      .then(() => this.getDocument()?.control.continuation ? this.resumeContinuation(signal) : undefined)
      .then(() => this.launch(signal));
    return chain.then(() => this.status());
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
          if (e.status!=='recovered_committed') {e.previousStatus=e.status;e.previousReceipt=clone(e.receipt??null);e.status='recovered_committed';e.recoveryCommandId=guard.commandId;}
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
  async pause({ command_id, expected_version }, signal) {
    signal?.throwIfAborted(); const old = this.getDocument(); assert(old, '尚无挑战');
    const command={kind:'pause',expected_version};
    if (repeat(old,command_id,command)) return this.status();
    this.mutate(expected_version, d => { record(d,command_id,command); d.control.running = false; d.control.remaining = 0; d.control.phase = 'paused'; if(d.experience)d.experience.manualPause={latched:true,commandId:command_id,at:Date.now()}; if (d.control.active) d.control.active.cancelled = true;if(d.control.recovery)d.control.recovery.cancelled=true; });
    if (old.control.active?.taskId) this.host.agents.cancel(old.control.active.taskId, '观众暂停久留美回放');
    await this.archiveSafe('paused', { note: '观众暂停；已提交决定与成交不撤销，自动延续在下一根前停住' });
    return this.status();
  }
  launch(signal) {
    const doc=this.getDocument();if(this.closed||!doc?.control.running||doc.control.active||doc.control.recovery||doc.control.continuation||doc.control.remaining<=0||doc.engine.status==='complete')return;
    if(this.launching)return this.launching;
    const accept=env=>{assert(env?.ready,'撮合后端未通过实际probe；先由主Agent显式prepare，不启动付费任务','NATIVE_NOT_PREPARED');this.nativeEnvironment=env;assert(this.getDocument()?.revision===doc.revision,'后端核对期间状态改变，不提交任务','VERSION_CONFLICT');return this.launchReady();};
    const pause=error=>{if(!this.closed&&this.getDocument()?.revision===doc.revision)this.mutate(undefined,d=>{d.control.running=false;d.control.remaining=0;d.control.phase='backend_not_ready_paused';d.control.error=error.message;});throw error;};
    try{const check=this.verifyBackend(signal);if(!check?.then)return accept(check);const job=check.then(accept).catch(pause);this.launching=job;job.then(()=>{this.launching=null;},()=>{this.launching=null;});return job;}catch(error){return pause(error);}
  }
  async launchReady() {
    const d = this.getDocument();
    if (this.closed || !d?.control.running || d.control.active || d.control.continuation || d.control.archiveFailed || d.control.hookFailure || d.engine.status === 'complete' || d.engine.status === 'missing_data' || d.control.remaining <= 0) return;
    const stop=applyExperienceStop(d);if(stop){this.mutate(undefined,next=>applyExperienceStop(next));return;}
    assertExperienceStart(d,1);
    const view = this.observe(), requestId = `${view.stepId}:attempt:${d.control.attempt}`;
    const authorization = randomUUID();
    const interval = this.intervalHours(d);
    const request = { requestId, title: `久留美 · 第${view.chapter}章 · ${new Date(view.asOf).toISOString()} H1决定${interval===4?'（4小时模式）':''}`, kind: 'strategy', instructions: (interval===4?PLAYER_INSTRUCTIONS+PLAYER_4H_SUFFIX:PLAYER_INSTRUCTIONS)+`当前冻结profile=${view.rules.experimentProfile}，本章杠杆${view.rules.leverage}x，强平比例${view.rules.stopOutRatio}。${view.rules.experimentInterpretation}。不得更改杠杆、费用或FX60秒。`,
      input: { authorization, snapshot: view,...(d.generalMethodBrief?{generalMethodBrief:clone(d.generalMethodBrief)}:{}) }, model: d.model, lane: `kurumi:${d.engine.id}`, queue: 'fifo',
      tools: [...PLAYER_TOOLS], maxTurns: 6, maxToolCalls: 4, timeoutMs: 900000 };
    assert(Buffer.byteLength(JSON.stringify(request))<=40000,'角色请求超过真实宿主40000字节预算；暂停，不截断决定或私自重付费','ROLE_INPUT_LIMIT');
    // 关键输入提交前落盘：完整请求（含 instructions/快照/模型/工具预算）先入归档，失败则不提交。
    await this.archiveSafe('role_request', { request, intervalHours: interval, note: '提交前完整角色输入落盘；角色输入不含未来' });
    // 归档等待期间的暂停/版本竞态防线：提交付费任务前重新核对，暂停后绝不提交。
    this.mutate(undefined, next => { assert(next.control.running === true && !next.control.active && !next.control.continuation && !next.control.recovery && !next.control.archiveFailed && ['ready','prepare'].includes(next.control.phase), '归档等待期间已暂停或状态改变；不提交新付费角色任务', 'CONFLICT'); });
    this.mutate(undefined, next => { if(next.experience){assertExperienceStart(next,1);const rows=next.paidRoleRequests??=[];assert(!rows.some(r=>r.requestId===requestId),'Known reservation cannot be paid again','REQUEST_ALREADY_RESERVED');rows.push({requestId,model:clone(d.model),reservedAt:Date.now(),status:'reserved_before_submit',unknownCountsAsSpent:true});}next.control.active = { requestId, stepId: view.stepId, authorization, taskId: null, request, decided: false, cancelled: false, attempt: next.control.attempt, chapterAtSubmit: next.engine.chapter }; next.control.phase = 'submitting'; });
    try {
      const task = this.host.agents.submit(request);
      assert(task?.id, '宿主未返回真实Agent任务ID', 'AGENT_SUBMIT_FAILED');
      this.mutate(undefined, next => { assert(next.control.active?.requestId === requestId, '任务已失效'); next.control.active.taskId = task.id;const reservation=next.paidRoleRequests?.find(r=>r.requestId===requestId);if(reservation)Object.assign(reservation,{status:'submitted',taskId:task.id,confirmedAt:Date.now()}); (next.control.taskIds ??= []).push(task.id); next.control.phase = 'waiting_for_kurumi'; });
      this.watch(task.id, requestId);
    } catch (error) {
      this.mutate(undefined, next => { next.control.running = false; next.control.phase = 'submission_unknown_requires_reconcile'; next.control.error = error.message; });
    }
  }
  watch(taskId, requestId) {
    if (this.waiting.has(taskId)) return; this.waiting.add(taskId);
    // Waiting is observation. No timer/market polling and no automatic retry.
    void this.host.agents.wait(taskId).then(async result => {
      if (this.closed || this.getDocument()?.control.active?.requestId !== requestId) return;
      if(!terminal(result?.status)){this.mutate(undefined,d=>{d.control.running=false;d.control.remaining=0;d.control.phase='unknown_task_status_paused';d.control.active.suspended=true;d.control.error='Wait未返回明确终态；保留原任务身份，仅显式核对，不重付费';});return;}
      this.mutate(undefined, d => {
        const active = d.control.active;
        d.lastTaskReceipt = { taskId, requestId, status: result?.status ?? null, decided: active.decided };
        saveTaskEvidence(d,active,this.host.agents.inspect(taskId));const reservation=d.paidRoleRequests?.find(r=>r.requestId===requestId);if(reservation)Object.assign(reservation,{status:'finished',taskStatus:result?.status??null,completedAt:Date.now()});
        if(d.experience?.pausedReason){d.control.running=false;d.control.phase='experience_paused_boundary';}
        else if (!active.decided || active.cancelled || active.suspended) { d.control.running = false; d.control.phase = active.decided ? 'paused_after_committed_step' : 'no_decision_paused'; }
        else if (d.engine.status === 'complete' || d.engine.outcome === 'bankrupt' || d.engine.balance.startsWith('-') || d.engine.balance === '0' || d.engine.status === 'missing_data' || d.control.remaining <= 0) { d.control.running = false; d.control.phase = d.engine.status === 'complete' ? 'complete' : d.engine.status === 'missing_data' ? 'missing_data_paused' : 'step_complete'; }
        else if (active.chapterAtSubmit !== d.engine.chapter) { d.control.running=false; d.control.phase='chapter_settled_display_next'; }
        else d.control.phase = 'ready';
        d.control.active = null; d.control.attempt = active.decided?0:active.attempt+1;applyExperienceStop(d);
      });
      // 完整角色任务证据（最终文字/全部工具调用）落归档后再调度下一步。
      const doc=this.getDocument();
      const row=(doc.roleTasks??[]).find(r=>r.taskId===taskId)??null;
      await this.archiveSafe('role_task_finished', { task: row, receipt: doc.lastTaskReceipt ?? null, note: '完整角色最终文字与全部工具请求/返回，未截断' });
      return this.launch();
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
  // 每根已提交 H1 的归档载荷：完整状态/账本/已揭示行情/tick 来源哈希；延续标明来源。
  stepArchivePayload(after, decision, { continuation }) {
    const last=after.decisions.at(-1),frame=this.data?.frames?.[last?.executedChapter??after.chapter]?.[last?.executedIndex??after.index]??null;
    return { continuation, continuationOf: decision.continuationOf ?? null,
      decision: clone(decision),
      engine: clone(after),
      revealedFrame: frame&&!after.bankrupt?roleBar(frame):null,
      ticksRefs: (after.nativeJournal ?? []).filter(item=>item.ticksRef).map(item=>clone(item.ticksRef)),
      note: continuation ? '自动延续H1：保持当时实际剩余仓位与止损，无新角色决定，不重开仓' : '角色决定执行的第一根H1' };
  }
  // Durable spectator outbox: enqueued in the SAME financial CAS. No hook is
  // allowed to mutate a role decision or use an unconsumed execution slice.
  enqueueCommittedHooks(before,after) {
    if(after.rules?.experimentProfile?.id!==ROUND2_PROFILE_ID)return;
    const id=`${after.id}:${after.version}`,old=this.host.storage.get('committed-hooks',id,true);
    if(old){assert(isDeepStrictEqual(old.engine,after),'Conflicting committed hook version','IDEMPOTENCY_CONFLICT');return;}
    const pre=this.host.storage.get('pre-step-boundaries',id,true);
    this.host.storage.put('committed-hooks',{id,runId:after.id,status:'pending',previousEngine:clone(before),engine:clone(after),preStep:pre?clone(pre.input):null});
  }
  dispatchCommittedHooks(signal) {
    if(this.dispatchingHooks)return this.dispatchingHooks;
    const promise=this.dispatchCommittedHooksOnce(signal);this.dispatchingHooks=promise;promise.then(()=>{this.dispatchingHooks=null;},()=>{this.dispatchingHooks=null;});return promise;
  }
  async dispatchCommittedHooksOnce(signal) {
    const runId=this.getState()?.id;
    const rows=(this.host.storage.list?.('committed-hooks')??[]).filter(r=>r.runId===runId&&r.status!=='done').sort((a,b)=>a.engine.version-b.engine.version);
    for(let row of rows) {
      signal?.throwIfAborted();
      try {
        const {ticks,interval,bytes}=await consumedInterval(this.host.storage.directory,row.engine,{signal});
        assert(interval,'Committed native quote interval is missing','INVALID_DATA');
        const presentation=await import('./replay-presentation.js'),weekly=await import('./weekly-reports.js');
        const batch=presentation.batchFromCommittedJournal(row.engine,row.previousEngine,row.engine.nativeJournal.at(-1),bytes);
        const cutoff=batch.cutoffMs,mark=row.engine.equity.at(-1),nativeIntervalDigest=batch.sourceDigest;
        assert(/^sha256:[a-f0-9]{64}$/.test(nativeIntervalDigest??''),'Verified committed source digest required for spectator proof','HASH_MISMATCH');
        assert(mark?.time===interval.lastTime&&mark.balance===row.engine.balance,'Committed account mark does not match actual consumed quote','SOURCE_MISMATCH');
        const rule=resolveExperimentProfile(row.engine).content.chapterRules[interval.chapter];
        const account={...clone(mark),asOfMs:cutoff,quoteTimeMs:mark.time,engineVersion:row.engine.version,leverage:rule.leverage,stopout:rule.stopout};
        const context={engine:clone(row.engine),previousEngine:clone(row.previousEngine),runId,consumedTicks:batch,account,chapter:interval.chapter,
          chapterEnded:row.engine.chapter!==row.previousEngine.chapter||row.engine.history.some(h=>h.type==='chapter_end'&&h.chapter===interval.chapter&&h.index===interval.index),
          terminal:row.engine.status==='complete',replayCutoffMs:cutoff,quoteCutoffMs:interval.lastTime,closedThroughMs:interval.complete?interval.toExclusive:null,
          consumedChapter:interval.chapter,consumedIndex:interval.index,decisionBoundary:(row.engine.version-1)%4===0,experiencePartial:this.getDocument()?.experience?.stoppedEngineVersion===row.engine.version};
        context.boundarySnapshots=clone(row.preStep?.boundaries??[]);
        if(row.preStep?.opening)context.openingContext=clone(row.preStep.opening);
        // First disclosure in a chapter: independently funded/settled flat pre-step account, no synthetic market prices.
        if(!context.openingContext&&row.previousEngine.version===1&&this.data.provenance?.inputKind==='observed')assert(false,'Actual initial H1 warmup/pre-native snapshot missing; not invent empty opening','BOUNDARY_SNAPSHOT_REQUIRED');
        if(!context.openingContext&&row.previousEngine.index===row.previousEngine.chapters[interval.chapter].startIndex){
          assert(!row.previousEngine.position,'Chapter opening must be settled flat','SOURCE_MISMATCH');
          context.openingContext={engine:clone(row.previousEngine),runId,chapter:interval.chapter,replayCutoffMs:interval.from,
            account:{balance:row.previousEngine.balance,equity:row.previousEngine.balance,unrealizedJpy:'0',margin:'0',freeMargin:row.previousEngine.balance,engineVersion:row.previousEngine.version,asOfMs:interval.from,priceStatus:'flat_no_conversion_required'},
            market:{runId,cutoffMs:interval.from,bars:[],sources:[]}};
        }
        assert(typeof presentation.onReplayCommitted==='function'&&typeof weekly.onWeeklyBoundary==='function','Spectator hook modules unavailable','HOOKS_UNAVAILABLE');
        const frames=playbackFrames(row.previousEngine,row.engine,ticks,interval),resume=Math.min(row.playbackCursor??0,frames.length);
        for(let i=resume;i<frames.length;i++){
          const point=frames[i],sequenceStart=i===0?0:frames[i-1].sequence+1;
          const prefix=point.unanimated?batch:deltaBatch(row.engine,row.previousEngine,row.engine.nativeJournal.at(-1),ticks,point,sequenceStart);
          this.host.storage.transaction(()=>this.host.storage.put('round2-visible-state',{id:runId,financialVersion:row.engine.version,engine:point.engine,cutoffMs:point.cutoffMs}));
          const account={...snapshot(point.engine,{time:interval.from}),engineVersion:point.engine.version,asOfMs:point.cutoffMs,quoteTimeMs:point.engine.lastQuote?.time??interval.lastTime};
          if(!point.intervalComplete&&!point.unanimated&&i<frames.length-1){
            assert(typeof presentation.onConsumedPrefix==='function','Native prefix presentation hook required','CONSUMED_CHECKPOINT_REQUIRED');
            const proof={kind:'native-consumed-checkpoint',engineDigest:presentation.digest(point.engine),accountDigest:presentation.digest(account),batchDigest:presentation.digest(prefix),nativeIntervalDigest:nativeIntervalDigest,nativeSequence:point.sequence,classification:'actual Nautilus trace checkpoint; display of already financially committed H1 facts'};
            await presentation.onConsumedPrefix(this.host,this,{...context,engine:point.engine,consumedTicks:prefix,replayCutoffMs:point.cutoffMs,account,nativeConsumedProof:proof},signal);
          }else{
            await presentation.onReplayCommitted(this.host,this,{...context,engine:point.engine,consumedTicks:prefix,replayCutoffMs:point.cutoffMs,account},signal);
            if(point.engine.chapter!==row.engine.chapter)this.host.storage.transaction(()=>this.host.storage.put('round2-spectator-checkpoint',{id:runId,runId,cutoffMs:point.cutoffMs,engine:point.engine,account,proof:{kind:'settled-consumed-chapter-checkpoint',nativeIntervalDigest:nativeIntervalDigest}}));
          }
          row={...row,playbackCursor:i+1};this.host.storage.transaction(()=>this.host.storage.put('committed-hooks',row));this.emit();
          if(i<frames.length-1)await waitPlayback(this.getDocument()?.experience?.content.playbackMsPerFrame??0,signal);
        }
        const weeklyResult=await weekly.onWeeklyBoundary(this.host,this,context,signal);
        context.weeklyJobs=weeklyResult.jobs??[];
        const roleDecision=row.engine.decisions.filter(r=>!r.decision?.continuationOf).at(-1);context.roleDecision=clone(roleDecision??null);context.decisionBlockFills=clone(row.engine.fills.filter(f=>f.time>=(roleDecision?.executionTime??cutoff)&&f.time<cutoff));
        const riskNew=row.engine.fills.slice(row.previousEngine.fills.length).some(f=>/stop|bankrupt|liquidat/.test(f.reason??''));
        if((context.decisionBoundary||riskNew||context.weeklyJobs.length||context.chapterEnded||context.terminal)&&typeof presentation.onPKBoundary==='function')await presentation.onPKBoundary(this.host,this,{...context,maxCommentariesPerChapter:this.getDocument()?.experience?.content.limits.maxNarrationEvents??32},signal);
        if(context.experiencePartial){assert(typeof weekly.onExperiencePartialBoundary==='function','Partial bounded investment report hook not yet connected','EXPERIENCE_PARTIAL_HOOK_REQUIRED');await weekly.onExperiencePartialBoundary(this.host,this,context,signal);}
        const generation=this.getDocument()?.settings?.weeklyGeneration;
        if(generation?.enabled===true){this.assertWeeklyBudget();await weekly.drainWeeklyQueue(this.host,this,{authorizeGeneration:true,transport:'inference',model:generation.model,generationTrigger:{kind:context.weeklyJobs.some(j=>j.period.reason==='utc_week')?'automatic_committed_utc_week':'automatic_committed_bounded_partial',automatic:true,caller:'service.committed-hooks',engineVersion:row.engine.version,cutoffMs:cutoff,utcJobIds:context.weeklyJobs.filter(j=>j.period.reason==='utc_week').map(j=>j.id)}},signal);}
        const utcJobs=context.weeklyJobs.filter(j=>j.period.reason==='utc_week');if(utcJobs.length)this.mutate(undefined,d=>{d.control.running=false;d.control.audienceHold={kind:'utc_week_report',engineVersion:row.engine.version,cutoffMs:cutoff,reportAsOfMs:utcJobs[0].period.toMs,jobIds:utcJobs.map(j=>j.id),requiresMainConsumer:true};d.control.phase='utc_week_audience_hold';});
        this.emit();
        this.host.storage.transaction(()=>this.host.storage.put('committed-hooks',{...row,status:'done',contextDigest:null}));
      }catch(error){
        this.host.storage.transaction(()=>this.host.storage.put('committed-hooks',{...(this.host.storage.get('committed-hooks',row.id,true)??row),status:'pending',error:{code:error.code??'HOOK_FAILURE',message:error.message}}));
        this.mutate(undefined,d=>{d.control.running=false;d.control.remaining=0;d.control.hookFailure={id:row.id,code:error.code??'HOOK_FAILURE',message:error.message};d.control.phase='committed_hooks_pending';});throw error;
      }
    }
    if(this.getDocument()?.control.hookFailure)this.mutate(undefined,d=>{d.control.hookFailure=null;d.control.phase='paused';});
    return {processed:rows.length,modelRequested:false,runId};
  }
  audienceControl(host,args,signal){return audienceDriver(host,this,args,signal);}
  methodWorkflow(host,args,signal) { assert(host.scope?.kind==='main','Actual main tool host required','SCOPE_DENIED');return methodWorkflow(host,this,args,signal); }
  narrationControl(host,args,signal) { assert(host.scope?.kind==='main','Actual main tool host required','SCOPE_DENIED');return mainChatWorkflow(host,this,args,signal); }
  async recordingControl({action,command_id,mirror_root,acknowledge_existing=false},signal) {
    if(action==='status')return {selection:this.recordingSelection??null,error:this.recordingSelectionError??null,default:'plugin-private recording-mirror'};
    assert(action==='pin'&&typeof command_id==='string','Explicit stable pin command required','INVALID_ARGUMENT');
    const doc=this.getDocument();assert(!doc?.control.running&&!doc?.control.active&&!doc?.control.recovery&&!this.preparing,'No active operations while pinning recorder','DECISION_PENDING');
    const input={action,mirror_root:mirror_root??null,acknowledge_existing},old=this.host.storage.get('recording-commands',command_id,true);
    if(old){assert(isDeepStrictEqual(old.input,input),'Changed recorder command','IDEMPOTENCY_CONFLICT');return old.result;}
    signal?.throwIfAborted();const selected=await recordingSelection(this.host.storage.directory,{mirrorRoot:mirror_root,acknowledgeExisting:acknowledge_existing});
    const recorder=new Recorder(this.host.storage.directory,{mirrorRoot:selected.mirrorRoot});await recorder.initialize();
    this.recorder=recorder;this.recordingSelection=selected;this.recordingSelectionError=null;
    const result={pinned:true,selection:selected.record,root:recorder.root,mirror:recorder.mirror,engineUnchanged:true};this.host.storage.transaction(()=>this.host.storage.put('recording-commands',{id:command_id,input,result}));return result;
  }
  async experienceControl(host,{action,command_id,expected_version,limits,gate,evidence_refs,verified_by_main=false,timeout_ms},signal) {
    assert(host.scope?.kind==='main','Actual main tool host required','SCOPE_DENIED');
    const old=this.getDocument();assert(old?.engine.rules.experimentProfile?.id===ROUND2_PROFILE_ID,'New50x experiment required','RUN_MISMATCH');
    if(action==='status')return {plan:old.experience,usage:experienceUsage(old)};
    if(action==='wait_boundary')return this.waitAudienceBoundary(timeout_ms??120000,signal);
    const input={action,expected_version,...(limits?{limits}:{}),...(gate?{gate,evidence_refs,verified_by_main}:{})};
    if(repeat(old,command_id,input))return clone(old.commands[command_id].result);
    assert(typeof command_id==='string'&&old.revision===expected_version,'Stable id and current revision required','VERSION_CONFLICT');
    assert(!old.control.running&&!old.control.active&&!old.control.recovery,'Pause and reconcile role before changing experience control','DECISION_PENDING');
    if(action==='configure')assert(old.engine.version===1&&!old.control.continuation,'Plan may be configured only before consumption','EXPERIENCE_PLAN_FROZEN');
    if(action==='record_gate'){
      assert(EXPERIENCE_GATES.includes(gate)&&verified_by_main===true&&Array.isArray(evidence_refs)&&evidence_refs.length,'Explicit main review with fixed native evidence required','NATIVE_EVIDENCE_REQUIRED');
      for(const ref of evidence_refs){assert(ref.id&&typeof ref.revision==='string'&&/^sha256:[a-f0-9]{64}$/.test(ref.digest??''),'Full fixed evidence reference required','NATIVE_EVIDENCE_REQUIRED');const evidence=await host.artifacts.read(ref);assert(evidence&&evidence.available_for_analysis!==false,'Native evidence unavailable','NATIVE_EVIDENCE_REQUIRED');}
    }
    signal?.throwIfAborted();let result;
    this.mutate(expected_version,d=>{
      if(action==='configure')d.experience=createExperiencePlan(limits??{});
      else if(action==='arm'){assert(d.experience,'Bounded plan missing');d.experience.manualPause={latched:false};d.experience.pausedReason=null;}
      else if(action==='record_gate')d.experience.gates[gate]={status:'passed',evidenceRefs:clone(evidence_refs),review:'explicit main review of fixed native evidence, not fixture-host certification'};
      else assert(false,'Unknown bounded action');
      applyExperienceStop(d);result={plan:clone(d.experience),usage:experienceUsage(d),modelRequested:false};record(d,command_id,input);d.commands[command_id].result=result;
    });await this.archiveSafe('experience_control',{commandId:command_id,action,result});return result;
  }
  waitAudienceBoundary(timeoutMs,signal) {
    assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=120000,'Bounded 120s wait only','INVALID_ARGUMENT');
    const finished=()=>{const d=this.getDocument();return d&&!d.control.running&&!d.control.active&&!d.control.recovery&&(!this.host.storage.list('committed-hooks').some(r=>r.runId===d.engine.id&&r.status!=='done')||d.control.hookFailure||d.control.archiveFailed);};
    if(finished())return Promise.resolve({status:'boundary_or_paused',checkpoint:this.status(),modelRequested:false});
    return new Promise((resolve,reject)=>{let off=()=>{},timer;const cleanup=()=>{off();clearTimeout(timer);signal?.removeEventListener('abort',abort);};const abort=()=>{cleanup();reject(Object.assign(Error('Wait cancelled; controller task not replayed'),{code:'CANCELLED'}));};off=this.subscribe(()=>{if(finished()){cleanup();resolve({status:'boundary_or_paused',checkpoint:this.status(),modelRequested:false});}});timer=setTimeout(()=>{cleanup();resolve({status:'still_pending',checkpoint:this.status(),modelRequested:false});},timeoutMs);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
  }
  assertWeeklyBudget() {
    const doc=this.getDocument();if(!doc?.experience)return;
    const jobs=this.host.storage.list('round2-weekly').filter(j=>j.id.startsWith('weekly_')&&j.input?.opening?.runId===doc.engine.id);
    const spent=jobs.filter(j=>j.requestId).length,queued=jobs.filter(j=>j.status==='queued'||j.status==='input_frozen'||j.status==='input_archive_failed').length;
    assert(spent+queued<=doc.experience.content.limits.maxWeeklyGenerations,'Weekly model cap reached/unknown requests remain spent; no model call','WEEKLY_BUDGET');
  }
  async drainConfiguredWeekly(signal,trigger){const generation=this.getDocument()?.settings?.weeklyGeneration;if(generation?.enabled!==true)return {status:'generation_disabled',modelRequested:false};this.assertWeeklyBudget();const weekly=await import('./weekly-reports.js');return weekly.drainWeeklyQueue(this.host,this,{authorizeGeneration:true,transport:'inference',model:generation.model,generationTrigger:trigger},signal);}
  async weeklyControl(args,signal) {
    const weekly=await import('./weekly-reports.js');
    if(args.action==='status')return {jobs:weekly.listWeeklyJobs(this.host).map(j=>({id:j.id,status:j.status,revision:j.revision,period:j.input?.period,inputRef:j.inputRef??null,reportRef:j.reportRef??null,error:j.error??null})),generation:this.getDocument()?.settings?.weeklyGeneration??null};
    const doc=this.getDocument();assert(doc?.engine.rules.experimentProfile?.id===ROUND2_PROFILE_ID,'Weekly control requires new50x experiment','RUN_MISMATCH');
    assert(typeof args.command_id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(args.command_id)&&Number.isSafeInteger(args.expected_version),'Stable command_id and expected_version required for non-status action','INVALID_ARGUMENT');
    const input={kind:'weekly',...args};delete input.command_id;
    if(repeat(doc,args.command_id,input))return clone(doc.commands[args.command_id].result);
    assert(doc.revision===args.expected_version,'Stale document revision','VERSION_CONFLICT');
    assert(!doc.control.running&&!doc.control.active&&!doc.control.recovery,'Pause/reconcile role before changing/report drain','DECISION_PENDING');
    let result;
    if(args.action==='enable'||args.action==='disable') {
      assert(args.action==='disable'||args.authorize_generation===true,'Explicit paid weekly authorization required','GENERATION_NOT_AUTHORIZED');
      result={enabled:args.action==='enable',model:args.action==='enable'?this.chooseModel():null,restartAutoReplay:false};
      this.mutate(args.expected_version,d=>{d.settings.weeklyGeneration=result;record(d,args.command_id,input);d.commands[args.command_id].result=result;});
      await this.archiveSafe('weekly_generation_configuration',{commandId:args.command_id,...result});return result;
    }
    assert(args.action==='drain'&&args.authorize_generation===true,'Explicit paid weekly generation authorization required','GENERATION_NOT_AUTHORIZED');
    this.assertWeeklyBudget();result=await weekly.drainWeeklyQueue(this.host,this,{authorizeGeneration:true,transport:'inference',model:doc.settings.weeklyGeneration?.model??this.chooseModel()},signal);
    this.mutate(undefined,d=>{record(d,args.command_id,input);d.commands[args.command_id].result=result;});return result;
  }
  async refreshPresentation(host,{chart_id},signal) {
    const presentation=await import('./replay-presentation.js'),state=this.getState(),view=this.getReplayPresentation();
    assert(this.presentationEnabled&&view?.commitVersion===state.version,'Consumed view not ready for current new experiment','SNAPSHOT_REQUIRED');
    const last=state.lastConsumedInterval;
    const result=await presentation.refreshReplayAudience(host,this,{chartId:chart_id},signal);
    await this.archiveSafe('presentation_main_refresh',{chartId:chart_id,runId:state.id,engineVersion:state.version,result});return result;
  }
  async retryCommittedHooks({command_id,expected_version},signal) {
    const old=this.getDocument(),input={kind:'retry_committed_hooks',expected_version};assert(old,'No current experiment');
    if(repeat(old,command_id,input))return clone(old.commands[command_id].result);
    assert(old.revision===expected_version,'Stale document revision','VERSION_CONFLICT');
    assert(!old.control.running&&!old.control.active&&!old.control.recovery,'Pause and reconcile role before retrying hooks','DECISION_PENDING');
    const result=await this.dispatchCommittedHooks(signal);
    this.mutate(undefined,d=>{record(d,command_id,input);d.commands[command_id].result=result;});return result;
  }
  // 4h 自动延续循环：最多3根；每根独立CAS提交；边界/破产/缺数/取消停住；中断保留下次恢复。
  async runContinuations(identity, signal) {
    let committed = 0;
    while (true) {
      signal?.throwIfAborted();
      const current = this.getDocument();
      const c = current?.control.continuation;
      if (!c || c.decisionId !== identity.decisionId || !current.control.running || current.control.hookFailure) break;
      if (c.remainingBars <= 0) break;
      if (current.control.active?.cancelled || current.control.active?.suspended || current.control.recovery) break;
      const engine = current.engine;
      if (engine.status === 'complete' || engine.outcome === 'bankrupt' || engine.bankrupt || engine.balance.startsWith('-') || engine.balance === '0') break; // missing_data 不跳出：advance 对同一未提交H1显式重试
      const continuationDecision = { id: `${c.decisionId}:cont:${(c.committedCount??0)+1}`, runId: engine.id, stepId: `${engine.id}:${engine.chapter}:${engine.index}`,
        expectedVersion: engine.version, target: engine.position?.quantity ?? '0', stop: engine.position?.stop ?? null,
        reason: `自动延续：保持角色决定 ${c.decisionId} 执行后的实际剩余仓位与止损；无新角色决定，禁止重新开仓`,
        utterance: '（自动延续，非角色发言）', continuationOf: c.decisionId };
      const before = this.getState();
      let after;
      try { await freezeBeforeNative(this,before,continuationDecision,signal);after = await this.advance(this.host.storage.directory, clone(before), continuationDecision, this.data, { signal }); }
      catch (error) {
        if (!isArchiveError(error)&&error.code!=='UTC_BEFORE_STEP_HOLD') this.mutate(undefined, d => { if(d.control.continuation?.decisionId===identity.decisionId){d.control.running=false;d.control.phase='continuation_error_paused';d.control.error=error.message;} });
        throw error;
      }
      signal?.throwIfAborted();
      let halt = false;
      this.mutate(undefined, d => {
        const cc = d.control.continuation;
        assert(cc?.decisionId === identity.decisionId && d.engine.version === before.version, '延续期间状态改变；保留已提交小时，不重放已成交段', 'VERSION_CONFLICT');
        assert(d.control.running === true && !d.control.active?.cancelled && !['paused','paused_after_committed_step'].includes(d.control.phase), '已暂停：进行中的撮合不提交，等待显式恢复', 'CONFLICT');
        if (after.status === 'missing_data') { d.engine = after; d.control.running = false; d.control.phase = 'missing_data_paused'; halt = true; } // 占位保留：同一未提交H1不消耗延续预算，数据补齐后经 start 显式重试
        else { assert(after.version === before.version + 1 && after.id === before.id, '原生结果未恰好推进一步'); this.enqueueCommittedHooks(before,after); d.engine = after; cc.committedCount = (cc.committedCount ?? 0) + 1; cc.remainingBars--; cc.lastCommittedAt = Date.now(); }
        if (after.status !== 'missing_data') {
          if (after.outcome === 'bankrupt' || after.balance.startsWith('-') || after.balance === '0') { d.control.running = false; d.control.remaining = 0; d.control.phase = 'bankrupt_stopped'; d.control.continuation = null; halt = true; }
          if (after.status === 'complete') { d.control.continuation = null; halt = true; }
          if (after.chapter !== before.chapter) { d.control.continuation = null; halt = true; } // 章边界：旧决定剩余小时不带入下一章
          else if (cc.remainingBars <= 0) { d.control.continuation = null;if(d.experience){d.control.running=false;d.control.remaining=0;d.control.phase='main_audience_boundary';} halt = true; }
        }
      });
      if(after.status!=='missing_data')this.mutate(undefined,d=>applyExperienceStop(d));
      if (after.status === 'missing_data') { await this.archiveSafe('h1_missing_data', { decisionId: identity.decisionId, missingData: this.getState()?.missingData ?? null, note: '自动延续遇真实报价缺失停住；已提交小时保留，不重放' }); break; }
      committed++;
      await this.archiveSafe('h1_committed', this.stepArchivePayload(this.getState(), continuationDecision, { continuation: true }));
      await this.dispatchCommittedHooks(signal);
      if (halt) break;
    }
    return committed;
  }
  // 显式 start/continue 恢复中断的自动延续：只继续真实撮合，绝不自动发新付费模型。
  async resumeContinuation(signal) {
    const doc = this.getDocument(), cont = doc?.control.continuation;
    if (!cont) return 0;
    assert(this.data, '真实行情未准备，无法恢复自动延续', 'SOURCE_UNAVAILABLE');
    const env = await this.verifyBackend(signal);
    assert(env?.ready, '撮合后端未通过实际probe；先显式prepare，不恢复延续', 'NATIVE_NOT_PREPARED');
    this.nativeEnvironment = env;
    const committed = await this.runContinuations(cont, signal);
    await this.archiveSafe('continuation_resumed', { decisionId: cont.decisionId, committedBars: committed, note: '中断自动延续的显式恢复；未请求模型、未重放已成交段' });
    return committed;
  }
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
        await freezeBeforeNative(this,before,decision,signal);
        const after = await this.advance(this.host.storage.directory, clone(before), decision, this.data, {signal});
        signal?.throwIfAborted(); assert(after && after.id===before.id, '原生适配器返回无效Run');
        let receipt;
        this.mutate(undefined, d => {
          const a=d.control.active;
          assert(a?.requestId===active.requestId&&!a.cancelled&&!a.suspended&&d.engine.version===before.version, '观众已暂停或本步状态改变；撮合结果未提交', 'VERSION_CONFLICT');
          if (after.status === 'missing_data') { d.engine=after; d.control.running=false; receipt={accepted:false,paused:true,stepId:active.stepId,reason:after.missingData?.message??'缺失真实报价'}; }
          else { assert(after.version===before.version+1,'原生结果未恰好推进一步'); this.enqueueCommittedHooks(before,after); d.engine=after; d.control.remaining--; receipt={accepted:true,decisionId:decision.id,nextStepId:`${after.id}:${after.chapter}:${after.index}`,engineVersion:after.version,balance:after.balance,status:after.status}; }
          a.processing=false; a.decided=true; a.decision=decision; a.receipt=receipt;
          d.control.phase=after.status==='missing_data'?'missing_data_paused':'committed_waiting_task_finish';
          if(after.outcome==='bankrupt'||after.balance.startsWith('-')||after.balance==='0') { d.control.running=false; d.control.remaining=0; d.control.phase='bankrupt_stopped'; }
          // 4小时模式：第一根真实成交后设置自动延续占位（最多3根），章内且未触发终止条件。
          if (receipt.accepted && this.intervalHours(d)===4 && after.status!=='missing_data' && after.status!=='complete' && after.chapter===before.chapter && after.outcome!=='bankrupt' && !after.balance.startsWith('-') && after.balance!=='0') {
            d.control.continuation={decisionId:decision.id,remainingBars:3,committedCount:0,startedAt:Date.now()};
          }
          applyExperienceStop(d);
          const evidence=d.roleEvidence.find(e=>e.requestId===a.requestId);assert(evidence,'缺少真实决定预约证据');Object.assign(evidence,{status:receipt.accepted?'committed':'paused_without_fill',receipt,observedAt:Date.now()});
        });
        if (receipt.accepted) {await this.archiveSafe('h1_committed', this.stepArchivePayload(this.getState(), decision, { continuation: false }));await this.dispatchCommittedHooks(signal);}
        else if (this.getState()?.status === 'missing_data') await this.archiveSafe('h1_missing_data', { decisionId: decision.id, stepId: active.stepId, missingData: this.getState()?.missingData ?? null, note: '角色决定的第一根H1缺失真实报价：不记为已提交账户更新，未请求新模型，已提交事实以引擎决定账本为准' });
        // 自动延续：失败不撤销已提交小时，占位保留供显式恢复；延续不再请求角色。
        if (receipt.accepted && this.getDocument()?.control.continuation?.decisionId === decision.id) {
          try { const continuations = await this.runContinuations(this.getDocument().control.continuation, signal); receipt = { ...receipt, continuations }; }
          catch (continuationError) { receipt = { ...receipt, continuations: 'paused', continuationPaused: continuationError.message }; }
        }
        if (receipt.accepted) {
          // 4小时块完成：回执与持久化证据更新为最终引擎状态；重复同一决定拿到同一个完成回执。
          // 用主视角 observe() 与 accountSnapshot 的当前账户（不经角色权限路径；decided 后 playerObserve 已关闭）。
          const final = this.getState(), finalView = this.observe(), finalFrame = this.data?.frames?.[final.chapter]?.[final.index] ?? null;
          let account = null; try { account = this.accountSnapshot(final, finalFrame); } catch { account = null; }
          const committedHours = final.version - before.version;
          receipt = { ...receipt, continuations: Math.max(0, committedHours - 1), engineVersion: final.version, balance: final.balance, equity: account?.equity ?? null, status: final.status, index: final.index, chapter: final.chapter, nextStepId: finalView.stepId, nextExpectedVersion: finalView.expectedVersion, finalBlock: { mode: `${this.intervalHours()}h`, committedHours, pendingHours: this.getDocument()?.control.continuation?.remainingBars ?? 0, note: '回执对应实际已提交的小时与当前账户；中途暂停同样返回真实进度，不退回第一小时状态' } };
          this.mutate(undefined, d => {
            if (d.control.active?.requestId === active.requestId) { d.control.active.receipt = receipt; d.control.active.engineVersion = final.version; }
            const evidence = d.roleEvidence?.find(e => e.requestId === active.requestId);
            if (evidence) evidence.receipt = receipt;
          });
        }
        return receipt;
      } catch(error) {
        // 归档写失败时已提交账本与证据保持 committed；归档层已自行暂停付费回合。
        if (this.getDocument()?.control.active?.requestId === active.requestId) {
          // 已提交事实以真实引擎决定账本为准：任何后续异常（归档/ENOSPC/EACCES/ENOENT）都不把 committed 改写成 failed_not_committed；
          // 归档失败已由 archiveSafe 记录 pending 指针并暂停，补齐后继续。
          const committed = this.getDocument()?.engine?.decisions?.some(e => e.decision?.id === decision.id) === true;
          if (!committed && !isArchiveError(error)) this.mutate(undefined,d=>{d.control.running=false;d.control.phase=error.code==='UTC_BEFORE_STEP_HOLD'?'utc_week_audience_hold':'native_error_paused';d.control.error=error.message;const evidence=d.roleEvidence?.find(e=>e.requestId===active.requestId);if(evidence)Object.assign(evidence,{status:'failed_not_committed',error:{code:error.code??'NATIVE_ERROR',message:error.message},observedAt:Date.now()});});
        }
        throw error;
      } finally {this.jobs.delete(active.requestId);}
    })();
    this.jobs.set(active.requestId,job); return job;
  }
  async recover({command_id,expected_version,decision_id},signal){
    signal?.throwIfAborted();const old=this.getDocument(),command={kind:'recover',expected_version,decision_id};assert(old,'尚无挑战');if(repeat(old,command_id,command))return this.status();
    assert(!this.preparing&&!old.control.active&&!old.control.recovery&&!old.control.running&&!old.control.continuation,'有未核对任务或恢复过程；不能重放','DECISION_PENDING');
    assert(isDeepStrictEqual(old.engine.dataDigests,this.data?.digests),'固定来源不同，不能恢复','SOURCE_CHANGED');
    assert(!old.experience?.manualPause.latched,'Explicit bounded arm required before recovery','MANUAL_PAUSE_LATCHED');
    const evidence=old.roleEvidence?.find(e=>e.decision?.id===decision_id);
    const missingDataAttempt=evidence?.status==='paused_without_fill'&&old.engine.status==='missing_data'&&old.engine.missingData&&evidence.receipt?.accepted===false&&evidence.receipt?.paused===true&&evidence.receipt?.stepId===evidence.stepId;
    assert(evidence?.status==='failed_not_committed'||missingDataAttempt,'仅恢复真实失败或缺数暂停且未提交的保存决定','RECOVERY_NOT_ALLOWED');
    assert(!old.experience||old.engine.version-1<old.experience.content.limits.maxCommittedHours,'Recovery cannot cross hard committed-hour cap','EXPERIENCE_STOP_CONDITION');
    const decision=clone(evidence.decision);assert(decision.runId===old.engine.id&&decision.stepId===old.engine.id+':'+old.engine.chapter+':'+old.engine.index&&decision.expectedVersion===old.engine.version,'保存决定不属于当前未推进版本','RECOVERY_NOT_ALLOWED');
    assert(!old.engine.decisions.some(e=>e.decision?.id===decision.id||e.decision?.stepId===decision.stepId),'此步已有提交，禁止重复恢复','ALREADY_COMMITTED');
    const task=this.host.agents.inspect(evidence.taskId);assert(terminal(task?.status)&&task.id===evidence.taskId&&task.requestId===evidence.requestId,'旧角色任务身份/终态未核对','DECISION_PENDING');
    assert(isDeepStrictEqual(task.model,evidence.model)&&task.model?.provider==='openai'&&task.model.id==='gpt-6.1-sol','原任务模型证据不匹配','RECOVERY_NOT_ALLOWED');
    assert(task.toolCalls?.some(c=>c.name==='kurumi_decide'&&c.status===(missingDataAttempt?'returned':'failed')),'没有对应终态的真实decide调用证据','RECOVERY_NOT_ALLOWED');
    const env=await this.verifyBackend(signal);assert(env?.ready,'撮合后端未实际可用；先显式prepare','NATIVE_NOT_PREPARED');this.nativeEnvironment=env;
    this.mutate(expected_version,d=>{assert(!this.closed&&!this.preparing&&!d.control.recovery&&!d.control.active&&!d.control.running,'后端核对期间状态改变；不能预约恢复','DECISION_PENDING');record(d,command_id,command);d.control.recovery={commandId:command_id,decisionId:decision.id,runId:old.engine.id,stepId:decision.stepId,originalEngineVersion:old.engine.version,originalDecisionCount:old.engine.decisions.length,originalFillCount:old.engine.fills.length,originalBalance:old.engine.balance,dataDigests:clone(old.engine.dataDigests),startedAt:Date.now(),cancelled:false};d.control.phase='recovery_matching_native';d.control.remaining=0;(d.recoveries??=[]).push({commandId:command_id,decisionId:decision.id,originalTaskId:task.id,originalRequestId:task.requestId,originalTaskStatus:task.status,status:'matching',originalEngineVersion:old.engine.version,startedAt:Date.now(),model:evidence.model});});
    this.recovering=true;try{await freezeBeforeNative(this,old.engine,decision,signal);const after=await this.advance(this.host.storage.directory,clone(old.engine),decision,this.data,{signal});signal?.throwIfAborted();assert(after?.id===old.engine.id&&after.version===old.engine.version+1&&after.decisions?.length===old.engine.decisions.length+1&&isDeepStrictEqual(after.decisions.at(-1)?.decision,decision)&&after.status!=='missing_data','恢复未恰好完成真实H1；不提交','NATIVE_RECOVERY_FAILED');
      assert(!this.closed,'恢复服务已中断；保留预约，重启后显式 reconcile','INTERRUPTED');
      this.mutate(undefined,d=>{assert(!this.closed&&d.control.recovery?.commandId===command_id&&!d.control.recovery.cancelled&&d.engine.version===old.engine.version&&!d.control.active,'恢复期间状态改变，不提交','VERSION_CONFLICT');this.enqueueCommittedHooks(old.engine,after);d.engine=after;d.control.running=false;d.control.remaining=0;d.control.recovery=null;d.control.phase='step_complete';d.control.error=null;const row=d.recoveries.find(r=>r.commandId===command_id);Object.assign(row,{status:'committed',completedAt:Date.now(),engineVersion:after.version,balance:after.balance});const e=d.roleEvidence.find(r=>r.decision?.id===decision.id);e.previousStatus=e.status;e.previousReceipt=clone(e.receipt??null);e.status='recovered_committed';e.recoveryCommandId=command_id;e.receipt={accepted:true,decisionId:decision.id,engineVersion:after.version,balance:after.balance};
        if(this.intervalHours(d)===4&&after.chapter===old.engine.chapter&&after.status!=='complete'&&after.outcome!=='bankrupt'&&!after.balance.startsWith('-')&&after.balance!=='0'){
          d.control.continuation={decisionId:decision.id,remainingBars:3,committedCount:0,startedAt:Date.now()};
          d.control.phase='continuation_ready';
        }
      });
      await this.archiveSafe('h1_committed',this.stepArchivePayload(this.getState(),decision,{continuation:false,recovery:true,commandId:command_id}));
      await this.dispatchCommittedHooks(signal);
      await this.archiveSafe('decision_recovered',{decisionId:decision.id,engineVersion:after.version,balance:after.balance,note:'保存决定的显式恢复；未重新请求模型'});
      return this.status();
    }catch(error){
      // A disposed worker must not access a closed Store, erase a restart guard,
      // or overwrite a later reconciliation/commit with stale failure evidence.
      if (!this.closed && !isArchiveError(error)) {
        try {
          const current=this.getDocument();
          if (current?.control.recovery?.commandId===command_id && !current.control.recovery.requiresReconcile && current.engine.version===old.engine.version)
            this.mutate(current.revision,d=>{const row=d.recoveries?.find(r=>r.commandId===command_id);if(row)Object.assign(row,{status:'failed_not_committed',error:{code:error.code??'NATIVE_ERROR',message:error.message},completedAt:Date.now()});d.control.recovery=null;d.control.phase='recovery_error_paused';d.control.error=error.message;});
        } catch(persistenceError) {this.closed=true;this.loadError='恢复失败无法持久化；保留预约，重启后显式核对：'+persistenceError.message;}
      }
      throw error;
    }finally{this.recovering=false;}
  }
  // 本插件实际提交过的角色 runId 判定：roleEvidence/roleTasks 的 actorRunId 兼容路径 +
  // 已提交任务ID集合（active.taskId 含未 decide/失败角色 + control.taskIds 登记）经 host.agents.inspect(taskId).runId 精确匹配。
  async #ownedRun(runId) {
    const doc = this.getDocument();
    if (!doc) return false;
    if ((doc.roleTasks ?? []).some(t => t.actorRunId === runId) || (doc.roleEvidence ?? []).some(e => e.actorRunId === runId)) return true;
    const taskIds = new Set();
    if (doc.control?.active?.taskId) taskIds.add(doc.control.active.taskId);
    for (const id of doc.control?.taskIds ?? []) taskIds.add(id);
    for (const t of [...(doc.roleTasks ?? []), ...(doc.roleEvidence ?? [])]) if (t?.taskId) taskIds.add(t.taskId);
    for (const taskId of taskIds) {
      try { const info = await this.host.agents.inspect(taskId); if (info?.runId === runId) return true; } catch { /* inspect 失败不视为匹配 */ }
    }
    return false;
  }
  // protectArtifacts 生命周期钩子：仅匹配本插件实际提交的角色 runId。
  async protectArtifacts(runId) {
    const owned = await this.#ownedRun(runId);
    if (!owned) return { artifacts: [], resources: [] };
    assert(!this.recordingSelectionError,'Explicit existing recorder selection required before task protection','MIRROR_SELECTION_REQUIRED');
    if (!this.recorder) {const selected=await recordingSelection(this.host.storage.directory);this.recorder=new Recorder(this.host.storage.directory,{mirrorRoot:selected.mirrorRoot});}
    try {
      const taskRootPath = this.host.workspace.taskRoot(runId);
      const result = await this.recorder.protectRun(runId, taskRootPath, { simClockMs: this.simClock() });
      // Sealing this role workspace does not repair earlier pending journal or
      // file writes. Only assertArchiveHealthy may clear that recovery state.
      return { artifacts: [], resources: [{ id: `kurumi-recording-${runId}`, path: `${this.recorder.root}/runs/${runId}/sealed.json`, digest: result.digest, reason: '久留美角色任务临时区完整封存（会话JSONL与runtime.sqlite一致快照），用于忠实还原的宣传素材原始证据' }] };
    } catch (error) {
      // 归档失败：持久标记暂停付费回合，并抛出让宿主保留现场（cleanup_failed 重试）。
      this.markArchiveFailed(error);
      throw error;
    }
  }
  async cleanupRun(runId) {
    const owned = await this.#ownedRun(runId);
    if (!owned) return;
    // 封存必须仍然存在；缺失则抛错阻止清理。recording 归档与原生环境是持久素材，不随任务删除。
    const { promises: fs } = await import('node:fs');
    try { await fs.access(`${this.recorder.root}/runs/${runId}/sealed.json`); }
    catch { throw Object.assign(new Error(`角色任务 ${runId} 的封存缺失，拒绝清理现场`), { code: 'ARCHIVE_MISSING' }); }
  }
  async dispose() { this.closed = true; this.listeners.clear(); /* Restart never submits or repeats a model request. */ }
}
