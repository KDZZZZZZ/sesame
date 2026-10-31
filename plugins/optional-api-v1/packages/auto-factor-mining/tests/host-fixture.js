import { MiningRuntime } from '../runtime.js';
import { digest, ID } from '../shared.js';

export const iso = day => new Date(Date.UTC(2024, 0, day)).toISOString();
export const rows = Array.from({ length: 13 }, (_, day) => Array.from({ length: 4 }, (_, i) => ({ time: iso(day + 1), availableAt: iso(day + 1), symbol: `S${i}`, fields: { close: 100 * (1 + i / 100) ** day, signal: i } }))).flat();
export const models = [{ provider: 'fixture', id: 'main', configurationDigest: 'fixed' }, { provider: 'fixture', id: 'review', configurationDigest: 'review-fixed' }];
export const input = () => ({ request_id: 'one', title: 'Synthetic test', goal: 'Measured synthetic factor test', dataset_id: 'data', config: { model: models[0], agentModels: { reviewer: models[1] }, rounds: 1, directions: ['momentum'], evaluator: { plugin_id: 'sesame/factor-evaluator', tool: 'factor_evaluate', arguments: { dataset: { trainEnd: iso(5), validationEnd: iso(9), holdoutEnd: iso(13) } } } } });
const error = (code, message) => Object.assign(new Error(message), { code });
export const poll = async condition => { for (let i = 0; i < 500; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 2)); } throw new Error('Fixture did not settle'); };
export async function fixture({ storage, onTask, onEvaluate, beforeResource, evaluator } = {}) {
  const saved = storage ?? { records: new Map(), resources: new Map(), operations: new Map(), artifacts: new Map(), sequence: 0 }, requests = [], jobs = saved.jobs ??= new Map();
  saved.emitted ??= []; saved.artifactRecords ??= new Map();
  const datasets = new Map([['data', { id: 'data', rows: structuredClone(rows), provenance: { source_kind: 'synthetic' } }]]);
  const manifests = new Map([['sesame/factor-evaluator', { id: 'sesame/factor-evaluator', version: '1', revision: 'fixture-evaluator', capabilities: [{ id: 'factor_evaluate', consumers: ['host','agent'] }] }]]);
  let runtime;
  function hostFor(context, agent, workflow) {
    const host = { context: { pluginId: ID, storageRoot: 'fixture-storage', pluginRevision: 'fixture', models, ...context } };
    host.plugins = { read(id, { part }) { if (!manifests.has(id)) throw error('NOT_FOUND','Unknown plugin'); return part === 'manifest' ? structuredClone(manifests.get(id)) : { id, state: 'mounted', runtime_status: 'ready', agent_scope: 'all', loaded: true }; }, setEnabled: async () => ({}) };
    host.data = { sources: ({ contract }) => ({ items: [{ ref: { providerId: 'host#' + contract.split('.')[1].split('/')[0], revision: 'host:2' }, available: true }] }), query: async ({ source, input, limit, cursor }) => {
      if (source.providerId === 'host#messages') return { items: [] };
      const data = datasets.get(input.datasetId); if (!data) throw error('NOT_FOUND','Dataset not found'); const { rows, ...metadata } = data;
      const offset = Number(cursor ?? 0); return { items: rows.slice(offset, offset + limit), metadata, ...(offset + limit < rows.length ? { nextCursor: String(offset + limit) } : {}) };
    } };
    const owner = host.context.pluginId;
    host.state = {
      query: async ({ collection }) => ({ items: [...saved.records.entries()].filter(([key]) => key.startsWith(owner + ':' + collection + ':')).map(([,value]) => structuredClone(value)) }),
      read: async key => { const value = saved.records.get(`${owner}:${key.collection}:${key.key}`); if (!value) throw error('NOT_FOUND','State not found'); return structuredClone(value); },
      commit: async changes => { for (const change of changes) { const key = `${owner}:${change.key.collection}:${change.key.key}`, previous = saved.records.get(key); if ((previous?.version ?? 0) !== change.expectedVersion) throw error('VERSION_CONFLICT','CAS conflict'); if (Buffer.byteLength(JSON.stringify(change.value)) > 256*1024) throw Error('State payload too large'); }
        for (const change of changes) { const key = `${owner}:${change.key.collection}:${change.key.key}`; saved.records.set(key, { key: change.key, value: structuredClone(change.value), version: change.expectedVersion + 1 }); } return {}; },
    };
    const resource = ref => { const item = saved.resources.get(ref.id); if (!item || item.owner !== owner || item.removed) throw error('NOT_FOUND','Resource not found'); return item; };
    host.resources = {
      create: async (spec, opts = {}) => {
        await beforeResource?.(spec); const key = owner + ':' + opts.operationId;
        if (opts.operationId && saved.operations.has(key)) return structuredClone(saved.operations.get(key));
        const ref = { id: 'resource_' + ++saved.sequence, kind: spec.kind, version: 1 }, parent = spec.parent ? resource(spec.parent) : null;
        const report = spec.source?.report ? { ...spec.source.report, id: ref.id } : parent?.report ? { space: parent.report.space, path: (parent.report.path ? parent.report.path + '/' : '') + spec.name, id: ref.id } : null;
        const value = { ref, owner, name: spec.name, parent: spec.parent?.id ?? null, kind: spec.kind, content: spec.source?.content ?? '', ...(report ? { report } : {}) };
        saved.resources.set(ref.id,value); if (opts.operationId) saved.operations.set(key,ref); return structuredClone(ref);
      },
      read: async (ref, { part, offset = 0, entry }) => {
        if (saved.artifactRecords.has(ref.id)) { const a=saved.artifactRecords.get(ref.id); if(part==='manifest')return structuredClone(a.manifest); if(part==='metadata')return {ref}; ref=a.resource; }
        const item = resource(ref); if (part === 'metadata') return structuredClone(item);
        if (item.deleted) throw error('NOT_FOUND','Removed resource');
        const selected = entry ? [...saved.resources.values()].find(value => value.parent === ref.id && value.name === entry) : item;
        if (!selected) throw error('NOT_FOUND','Missing resource entry');
        const bytes = Buffer.from(selected.content), end = Math.min(offset + 262144, bytes.length); return { ref: item.ref, content: bytes.subarray(offset,end).toString('base64'), encoding: 'base64', offset, length: end-offset, total: bytes.length, ...(end < bytes.length ? { nextOffset: end } : {}) };
      },
      publish: async (ref, manifest, opts) => { const key = owner + ':' + opts.operationId; if (!saved.artifacts.has(key)) { const artifact={ id: 'artifact_' + ++saved.sequence, revision: '1', kind:manifest.kind, schemaVersion:manifest.schemaVersion, digest:digest(manifest) };saved.artifacts.set(key,artifact);saved.artifactRecords.set(artifact.id,{ref:artifact,resource:ref,manifest:structuredClone(manifest)}); } return { ref: saved.artifacts.get(key), receipt: {} }; },
    };
    host.runs = {
      read: async ref => ({ run: structuredClone(jobs.get(ref.id)?.value ?? { id: ref.id, status: 'unknown' }) }),
      wait: async (ref, { signal } = {}) => { const job = jobs.get(ref.id); if (!job) return { reason: 'settled', run: { id: ref.id, status: 'unknown' } }; if (signal?.aborted) throw signal.reason;
        return new Promise((resolve,reject) => { const abort=()=>reject(signal.reason);signal?.addEventListener('abort',abort,{once:true});job.promise.then(run=>resolve({reason:run.status==='interrupted'?'interrupted':'settled',run}),reject).finally(()=>signal?.removeEventListener('abort',abort)); }); },
      cancel: async ref => { const job = jobs.get(ref.id); if (job && !['completed','cancelled'].includes(job.value.status)) { job.controller.abort(error('CANCELLED','Cancelled')); job.finish({ status:'cancelled' }); } return {}; },
      interrupt: async ref => {
        const job = jobs.get(ref.id), reason = error('RUN_INTERRUPTED','Fixture interruption');
        for (const child of jobs.values()) if (child.parentRunId === ref.id && !['completed','cancelled'].includes(child.value.status)) { child.controller.abort(reason); child.finish({status:'interrupted'}); }
        job.controller.abort(reason);
        if (job.capability === 'host.agent.run') job.finish({status:'interrupted'});
        await job.promise; return {run:structuredClone(job.value)};
      },
      resume: async (ref, { interruptIds } = {}) => {
        const job = jobs.get(ref.id);
        const pending = (job.value.interrupts ?? []).filter(item => !item.resolvedAt);
        if (!Array.isArray(interruptIds) || !interruptIds.length) throw error('INVALID_ARGUMENT', 'Resume requires explicit interrupt IDs');
        if (!interruptIds.every(id => pending.some(item => item.id === id))) throw error('run_interrupt_conflict', 'Unknown or stale interrupt ID');
        if (job.capability.endsWith('#auto_factor_workflow')) {
          const readiness=runtime.dependencies(host,job.args.run_id);
          if(!readiness.available)return {run:structuredClone(job.value),reason:readiness.reason};
        }
        const interrupts = job.value.interrupts.map(item => interruptIds.includes(item.id) ? { ...item, resolvedAt: Date.now() } : item);
        job.value = { ...job.value, interrupts };
        if (interrupts.some(item => !item.resolvedAt)) return {run:structuredClone(job.value)};
        launch(job);
        for(const child of jobs.values())if(child.parentRunId===ref.id&&child.value.status==='interrupted')launch(child);
        return {run:structuredClone(job.value)};
      },
    };
    host.capabilities = { invoke: async (id, args, options = {}) => {
      if (id === 'sesame/factor-evaluator#factor_evaluate') {
        await onEvaluate?.(args); const target = hostFor({ ...host.context, pluginId: 'sesame/factor-evaluator' });
        const provenance = { caller: { pluginId: ID, runId:host.context.runId }, ...(workflow?{workflow}:{}), chain: [{ pluginId: ID, capabilityId: ID+'#workflow' }, { pluginId: 'sesame/factor-evaluator', capabilityId: id }], ...(agent?{agent}: {}) };
        if (!evaluator) throw error('NO_EVALUATOR','This domain fixture did not supply an evaluator implementation');
        return { type:'result', value:await evaluator(target,args,options.signal,{provenance}) };
      }
      if (![ID + '#auto_factor_workflow','host.agent.run'].includes(id)) throw error('NOT_FOUND','Unknown declared capability');
      const existing=[...jobs.values()].find(job=>job.operationId===options.operationId&&job.capability===id);
      if(existing)return {type:'run',run:{id:existing.value.id},receipt:{}};
      const ref = { id:'job_'+ ++saved.sequence };
      const job = {value:{...ref,status:'queued',output:null},capability:id,args:structuredClone(args),context:structuredClone(host.context),workflow:structuredClone(workflow),operationId:options.operationId,parentRunId:host.context.runId??null,options:structuredClone({...options,signal:undefined})};
      jobs.set(ref.id,job);launch(job,options.signal);
      return { type:'run',run:ref,receipt:{} };
    } };
    return host;
  }
  function launch(job, signal) {
    const {capability:id,args,context:hostContext,workflow}=job,ref={id:job.value.id},controller=new AbortController();let settle;
    job.controller=controller;job.value={...job.value,status:'running',error:undefined};job.attempt=(job.attempt??0)+1;job.promise=new Promise(resolve=>{settle=resolve;});
    job.finish=update=>{
      if(['completed','cancelled','interrupted'].includes(job.value.status))return;
      if(update.status==='interrupted'){
        const root=jobs.get(job.parentRunId)??job;
        let interrupts=root.value.interrupts??[];
        if(!interrupts.some(item=>!item.resolvedAt))interrupts=[...interrupts,{id:'interrupt_'+ ++saved.sequence,sourceRunId:job.value.id,reason:update.error?.message??'Fixture interruption',requirements:[],resolvedAt:null}];
        root.value={...root.value,interrupts};update={...update,interrupts};
      }
      job.value={...job.value,...update};settle(job.value);
    };
    signal?.addEventListener('abort',()=>{controller.abort(signal.reason);job.finish({status:signal.reason?.code==='RUN_INTERRUPTED'?'interrupted':'cancelled'});},{once:true});
    queueMicrotask(async()=>{try{
        if (id.endsWith('#auto_factor_workflow')) {
          const preflight=runtime.dependencies(hostFor(hostContext),args.run_id);
          if(!preflight.available){runtime.update(args.run_id,{status:'interrupted'});await runtime.checkpoints.flush();job.finish({status:'interrupted',interruption:{reason:preflight.reason}});return;}
          const proof={runId:ref.id,sessionId:'workflow_'+ref.id,ownerSessionId:runtime.get(args.run_id).ownerConversationId};const executor=hostFor({...hostContext,kind:'subagent',sessionId:proof.sessionId,runId:ref.id},undefined,proof);
          const execution={run:ref,attempt:job.attempt,resume:job.attempt>1,checkpointState:job.checkpointState,checkpoint:async state=>{job.checkpointState=structuredClone(state);controller.signal.throwIfAborted();},interrupt:async value=>{job.checkpointState=value.state;throw Object.assign(error('RUN_INTERRUPTED',value.reason),{details:value});},provenance:{caller:{pluginId:ID},workflow:proof},progress:data=>saved.emitted.push({runId:ref.id,type:'progress',data}),emit:(type,data)=>saved.emitted.push({runId:ref.id,type,data})};
          const value=await runtime.workflow(executor,args.run_id,controller.signal,execution);job.finish({status:'completed',output:value});return;
        }
        requests.push(structuredClone(args)); const proof={pluginId:ID,taskId:'native_'+ref.id,runId:ref.id,sessionId:ref.id,inputDigest:digest(args.input),input:structuredClone(args.input)};
        const child=hostFor({kind:'subagent',sessionId:ref.id,runId:ref.id},proof,workflow),execution={provenance:{agent:proof,workflow}};
        job.value.progress={sessionId:ref.id,status:'running'};
        if (await onTask?.({request:args,child,execution,runtime,job})==='hold')return;
        const {runId,mode}=args.input,context=runtime.context(child,runId,'team',0,20,execution);
        const candidate=args.input.round?{op:'add',args:[{op:'field',name:'signal'},{op:'constant',value:args.input.round}]}:{op:'field',name:'signal'};
        const output={plan:{directions:['momentum'],stop:false,reason:'Fixed fixture direction'},hypothesis:{hypothesis:'Synthetic ordering',rationale:'Numerical fixture, no market claim'},code:{candidate,explanation:'Observed fixture feature'},review:{verdict:'accept',reason:'Measured IC passes threshold'},reflection:{summary:'Measured synthetic ordering',lessons:['Check independent data'],stop:false},selection:{trialIds:context.trials.items.filter(t=>t.status==='accepted').slice(0,1).map(t=>t.id),reason:'Freeze one eligible candidate without redundant copies'}}[mode];
        await runtime.submit(child,runId,output,controller.signal,execution);job.finish({status:'completed',output:{text:'Fixture done',sessionId:ref.id,toolCalls:[],turns:2,model:args.model}});
      }catch(e){job.finish({status:['RUN_INTERRUPTED','DEPENDENCY_UNAVAILABLE'].includes(e.code)||!controller.signal.aborted?'interrupted':'cancelled',error:{code:e.code??'ERROR',message:e.message}});}});
  }
  const host=hostFor({kind:'service',sessionId:null}), main=hostFor({kind:'main',sessionId:'main'});runtime=await new MiningRuntime(host).start();
  return {host,main,runtime,requests,jobs,saved,datasets,manifests,hostFor};
}
export async function finished(f,id) { await poll(()=>!f.runtime.running.has(id)&&!['queued','running'].includes(f.runtime.get(id).status));return f.runtime.get(id); }
