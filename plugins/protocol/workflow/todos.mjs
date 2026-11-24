import { STEP_NAME, parseToken } from './definition.mjs';
import {
  closestName, createPlanState, knownArtifacts, layersOf, reportStep, requirementAvailable,
  resolve, resumeAfterChild, revisePlan,
} from './resolver.mjs';

// A todo owns the user's iteration and Runs. A preset owns its input versions,
// outcomes and fallback. Only the preset resolver changes those latter records.
const terminal = todo => todo.status === 'done' || todo.status === 'skipped';
const unique = values => [...new Set(values)];
const nameOK = name => typeof name === 'string' && STEP_NAME.test(name) && !(name in Object.prototype);
const textOK = (value, max) => typeof value === 'string' && value.trim() && [...value].length <= max;

class InputError extends Error {
  constructor(code, vars) { super(code); this.detail = {code, vars}; }
}
function reject(code, vars) { throw new InputError(code, vars); }
function invalid(detail) { reject('invalid_plan', {detail}); }
function checked(operation, plan) {
  try { return operation(); }
  catch (error) {
    if (!(error instanceof InputError)) throw error;
    return {ok:false, error:error.detail, ...(plan ? {plan} : {})};
  }
}
function unpack(result) {
  if (!result.ok) reject(result.error.code, result.error.vars);
  return result;
}
function finish(definition, plan, details = {}) {
  const view = resolveTodos(definition, plan);
  plan.status = view.status;
  return {ok:true, plan, view, ...details};
}
function names(value, max, field) {
  if (!Array.isArray(value) || value.length > max || !value.every(nameOK) || unique(value).length !== value.length)
    invalid(field + ' 需要互不重复的有效名称');
  return value;
}
function requireReference(definition, input) {
  if (definition) return;
  for (const field of ['have','refs','conditions']) {
    if (input[field] !== undefined) reject('no_reference',{field});
  }
}
function fresh() {
  return {status:'pending', iteration:0, runs:[], note:null, violation:false, violationMissing:[], startedAt:null, endedAt:null};
}
function requireTodo(plan, name) {
  const todo = plan.todos.find(item => item.step === name);
  if (!todo) {
    const steps = plan.todos.map(item => item.step);
    reject('unknown_step',{step:name, steps, suggestion:closestName(name,steps)});
  }
  return todo;
}
function unknownPreset(preset, scope, presets) {
  reject('unknown_preset',{preset,scope,presets,suggestion:closestName(preset,presets)});
}
function validatePreset(definition, plan, preset) {
  if (!Object.hasOwn(definition.steps,preset)) unknownPreset(preset,definition.id,Object.keys(definition.steps));
  const condition = definition.steps[preset].when;
  if (condition && !plan.conditions[condition]) reject('preset_inactive',{preset,condition});
  if (plan.steps[preset]?.status === 'skipped') reject('step_skipped',{step:preset});
}
function checkAssignments(definition, plan) {
  const owners = new Map();
  for (const todo of plan.todos.filter(item => !terminal(item))) {
    for (const preset of todo.presets) {
      validatePreset(definition,plan,preset);
      if (owners.has(preset)) reject('preset_taken',{preset,step:owners.get(preset)});
      owners.set(preset,todo.step);
    }
  }
}
function editTodos(definition, plan, {steps, remove = []}) {
  names(remove,20,'remove');
  for (const name of remove) {
    const todo = requireTodo(plan,name);
    if (todo.status !== 'pending') reject('todo_locked',{step:name});
  }
  plan.todos = plan.todos.filter(todo => !remove.includes(todo.step));
  if (steps !== undefined) {
    if (!Array.isArray(steps) || !steps.length || steps.length > 20) invalid('steps 需要 1–20 条待办');
    names(steps.map(item=>item?.step),20,'steps');
    for (const item of steps) {
      const {step, title, description} = item;
      if (remove.includes(step)) invalid(step + ' 不能同时替换和移除');
      if (!textOK(title,40) || !textOK(description,200)) invalid(step + ' 需要不超过 40 字的 title 与不超过 200 字的 description');
      if (!definition && item.presets !== undefined) reject('no_reference',{field:'presets'});
      const presets = names(item.presets ?? [],20,step+'.presets');
      const after = names(item.after ?? [],19,step+'.after');
      const spec = {step,title:title.trim(),description:description.trim(),presets:[...presets],after:[...after]};
      const prior = plan.todos.find(todo => todo.step === step);
      if (!prior) plan.todos.push({...spec,...fresh()});
      else {
        if (!['pending','failed'].includes(prior.status) || prior.fallbackPlanId) reject('todo_locked',{step});
        Object.assign(prior,spec);
      }
    }
  }
  if (plan.todos.length > 20) invalid('一个计划最多 20 条待办');
  if (!definition && !plan.todos.length) reject('open_requires_one',{});
  const byName = new Map(plan.todos.map(todo => [todo.step,todo]));
  const visiting = new Set(), visited = new Set();
  function visit(name) {
    if (visited.has(name)) return;
    if (visiting.has(name)) invalid(name+' 的 after 成环');
    visiting.add(name);
    for (const dep of byName.get(name).after) {
      if (!byName.has(dep)) invalid(name+' 的 after 引用了计划外的 '+dep);
      visit(dep);
    }
    visiting.delete(name); visited.add(name);
  }
  for (const todo of plan.todos) visit(todo.step);
  checkAssignments(definition,plan);
}

export function createTodoPlan(input) {
  return checked(() => {
    const {id,title,definition=null,at=Date.now(),parent=null} = input;
    if (!textOK(title,120)) reject('title_required',{});
    requireReference(definition,input);
    const created = definition ? unpack(createPlanState({...input,definition,at})) : {
      plan:{id,title,definition:null,workflow:'adhoc',conditions:{},steps:{},artifacts:{},parent,status:'active',seq:0,createdAt:at,updatedAt:at,note:null},
      reused:{steps:[],artifacts:[]},
    };
    created.plan.todos = [];
    editTodos(definition,created.plan,input);
    return finish(definition,created.plan,{reused:created.reused});
  });
}

function nextIteration(todo) {
  Object.assign(todo, fresh(), {iteration:todo.iteration+1,fallbackTo:null,fallbackPlanId:null,fallbackPreset:null});
}
function reopenExpired(plan, expired, reportingStep) {
  const resetSteps = [];
  // A newer open todo may already own one of the old group's presets. Keep the
  // newer assignment when reopening; the event history retains the old group.
  const owners = new Map();
  for (const todo of plan.todos) if (!terminal(todo)) for (const p of todo.presets) owners.set(p,todo.step);
  for (const todo of plan.todos) {
    if (todo.step === reportingStep || todo.status !== 'done') continue;
    const affected = expired.filter(item => todo.presets.includes(item.step) && plan.steps[item.step]?.todo === todo.step);
    if (!affected.length) continue;
    nextIteration(todo);
    todo.presets = todo.presets.filter(p => !owners.has(p));
    for (const preset of todo.presets) owners.set(preset,todo.step);
    resetSteps.push({step:todo.step,because:unique(affected.flatMap(item => item.because))});
  }
  return resetSteps;
}

export function reviseTodoPlan(definition, plan, input = {}) {
  return checked(() => {
    requireReference(definition,input);
    const at = input.at ?? Date.now();
    const revised = definition ? unpack(revisePlan(definition,plan,{...input,at})) : {
      plan:structuredClone(plan),reused:{steps:[],artifacts:[]},
    };
    const next = revised.plan;
    const expired = Object.keys(next.steps).filter(step => plan.steps[step]?.status === 'done' && next.steps[step].iteration > plan.steps[step].iteration)
      .map(step => ({step,because:Object.keys(plan.steps[step].consumed ?? {}).filter(name => next.artifacts[name]?.version !== plan.steps[step].consumed[name] || next.artifacts[name]?.expired)}));
    const resetSteps = reopenExpired(next,expired);
    editTodos(definition,next,input);
    next.updatedAt = at;
    return finish(definition,next,{reused:revised.reused,expiry:{resetSteps,expiredArtifacts:Object.keys(next.artifacts).filter(name=>next.artifacts[name].expired && !plan.artifacts[name]?.expired)}});
  },plan);
}

function presetOrder(presets, layers) {
  return [...presets].sort((a,b)=>layers.get(a)-layers.get(b));
}
function assumedProducts(definition, preset, later) {
  const needed = later.flatMap(name => {
    const s = definition.steps[name];
    return [...s.requires,...s.requires_any,...s.requires_if_valid];
  });
  return definition.steps[preset].produces.filter(name=>definition.outcomes[name]?.length)
    .map(name=>({name,outcome:needed.find(ref=>ref.name===name && ref.outcome)?.outcome ?? definition.outcomes[name][0]}));
}
function missingReason(definition, plan, owners, tokens) {
  const steps = [], presets = [], inputs = [], skipped = [];
  let mismatch;
  for (const token of tokens) {
    const {name,outcome} = parseToken(token);
    const producer = definition.producers[name], product = requirementAvailable(definition,plan,name);
    if (outcome && product.available && product.outcome !== outcome) {
      const source = plan.artifacts[name]?.origin === 'step' && plan.steps[producer]?.todo;
      mismatch ??= {kind:'outcome',steps:source?[source]:[],artifact:name,actual:product.outcome,required:outcome};
    } else if (!producer) inputs.push(token);
    else if (plan.steps[producer]?.status === 'skipped') skipped.push(plan.steps[producer].todo);
    else if (owners.has(producer)) steps.push(owners.get(producer));
    else presets.push(producer);
  }
  if (steps.length || presets.length) return {kind:'wait',steps:unique(steps),presets:unique(presets)};
  if (inputs.length) return {kind:'external',inputs};
  if (mismatch) return mismatch;
  if (skipped.length) return {kind:'skipped',steps:unique(skipped.filter(Boolean))};
  return {kind:'wait',steps:[],presets:[]};
}
function pendingState(definition,plan,todo,ctx) {
  const dependencies = todo.after.map(name=>ctx.byName.get(name)).filter(item=>item.status!=='done');
  if (dependencies.length) {
    const skipped = dependencies.filter(item=>item.status==='skipped');
    const reason = {kind:skipped.length?'skipped':'wait',steps:(skipped.length?skipped:dependencies).map(item=>item.step)};
    return {state:'waiting',reason,missing:dependencies.map(item=>item.step)};
  }
  if (!todo.presets.length) return {state:'ready'};
  const remaining = todo.presets.filter(p=>plan.steps[p]?.status!=='done');
  if (!remaining.some(p=>ctx.presetView.necessary.has(p))) return {state:'not_needed'};
  const ordered = presetOrder(remaining,ctx.layers);
  let simulated = plan;
  for (const [index,preset] of ordered.entries()) {
    const attempt = reportStep(definition,simulated,{step:preset,status:'done',produced:assumedProducts(definition,preset,ordered.slice(index+1)),at:plan.updatedAt});
    if (!attempt.ok) return {state:'waiting',reason:{kind:'skipped',steps:[todo.step]},missing:[preset]};
    if (attempt.violation) return {state:'waiting',reason:missingReason(definition,simulated,ctx.owners,attempt.missing),missing:attempt.missing};
    simulated = attempt.plan;
  }
  return {state:'ready'};
}

export function resolveTodos(definition,plan) {
  const presetView = definition ? resolve(definition,plan) : null;
  const owners = new Map();
  const byName = new Map(plan.todos.map(todo=>[todo.step,todo]));
  for (const todo of plan.todos) if (!terminal(todo)) for (const preset of todo.presets) owners.set(preset,todo.step);
  const ctx = {presetView,owners,byName,layers:definition?layersOf(definition):null};
  const todos = plan.todos.map(todo=>{
    if (todo.fallbackPlanId) return {...todo,state:'waiting',reason:{kind:'fallback',workflow:todo.fallbackTo}};
    if (todo.status !== 'pending') return {...todo,state:todo.status};
    return {...todo,...pendingState(definition,plan,todo,ctx)};
  });
  const unarranged = presetView ? presetView.active.filter(p=>presetView.necessary.has(p) && !owners.has(p))
    .map(step=>({step,ready:presetView.ready.some(item=>item.step===step)})) : [];
  const states = new Set(todos.map(todo=>todo.state));
  const reasons = new Set(todos.filter(todo=>todo.state==='waiting').map(todo=>todo.reason.kind));
  const ended = todos.every(todo=>['done','skipped','not_needed'].includes(todo.state));
  let status = 'active';
  if (plan.closed) status = plan.status;
  else if (states.has('ready') || states.has('running') || states.has('failed') || definition && (!todos.length || unarranged.some(p=>p.ready))) status = 'active';
  else if (reasons.has('external') || presetView?.status==='needs_input') status = 'needs_input';
  else if (reasons.has('outcome') || reasons.has('skipped') || presetView?.status==='blocked') status = 'blocked';
  else if (ended && (!definition || presetView.status==='completed')) status = 'completed';
  const progress = {done:todos.filter(t=>t.state==='done').length,total:todos.filter(t=>t.state!=='skipped'&&t.state!=='not_needed').length};
  return {status,progress,todos,unarranged,presetView};
}

export function closeTodoPlan(definition,plan,{outcome,note,at=Date.now()}) {
  return checked(()=>{
    if (!['abandoned','completed'].includes(outcome)) invalid('close 的 outcome 只能是 completed 或 abandoned');
    if (outcome==='abandoned' && !textOK(note,500)) reject('note_required',{status:outcome});
    if (outcome==='completed') {
      const steps=resolveTodos(definition,plan).todos.filter(t=>!['done','skipped','not_needed'].includes(t.state)).map(t=>t.step);
      if (steps.length) reject('close_incomplete',{steps});
    }
    const next = {...structuredClone(plan),closed:true,status:outcome,note:note?.trim() || plan.note,updatedAt:at};
    return finish(definition,next);
  },plan);
}
function selectPresets(definition,todo,input) {
  if (input.presets !== undefined && !definition) reject('no_reference',{field:'presets'});
  if (input.presets !== undefined && !['failed','done'].includes(input.status)) invalid('presets 只用于 done 或 failed');
  const selected = input.presets === undefined ? (input.status==='done'?todo.presets:[]) : names(input.presets,20,'presets');
  for (const preset of selected) if (!todo.presets.includes(preset)) unknownPreset(preset,todo.step,todo.presets);
  return definition ? presetOrder(selected,layersOf(definition)) : [];
}
function suppliedProducts(definition,selected,input) {
  const declared = selected.flatMap(p=>definition.steps[p].produces);
  if (!Array.isArray(input.produced ?? [])) invalid('produced 必须为数组');
  const produced = (input.produced ?? []).map(value=>typeof value === 'string' ? parseToken(value) : value);
  for (const ref of produced) {
    if (!ref || !declared.includes(ref.name)) reject('unknown_artifact',{artifact:ref?.name,scope:input.step,suggestion:closestName(ref?.name,declared),artifacts:declared});
  }
  if (!definition && input.refs && Object.keys(input.refs).length) reject('no_reference',{field:'refs'});
  if (definition) for (const artifact of Object.keys(input.refs ?? {})) {
    const artifacts = knownArtifacts(definition);
    if (!artifacts.includes(artifact)) reject('unknown_artifact',{artifact,scope:definition.id,suggestion:closestName(artifact,artifacts),artifacts});
  }
  return produced;
}

export function reportTodo(definition,plan,input) {
  return checked(()=>{
    const {step:name,status,at=Date.now()} = input;
    const previous = requireTodo(plan,name);
    if (!['started','done','failed','skipped'].includes(status)) reject('invalid_status',{});
    if (previous.status==='skipped') reject('step_skipped',{step:name});
    if (previous.status==='done' && status==='done') reject('already_done',{step:name,attempt:previous.iteration+1});
    if (input.note != null && (typeof input.note !== 'string' || [...input.note].length>500)) invalid('note 不超过 500 字');
    if (['failed','skipped'].includes(status) && !input.note?.trim()) reject('note_required',{status});
    if (previous.fallbackPlanId) reject('todo_locked',{step:name});
    const selected = selectPresets(definition,previous,input);
    const produced = suppliedProducts(definition,selected,input);
    const declaredFallbacks = previous.presets.filter(p=>definition.steps[p].fallback);
    const candidates = input.fallback ? declaredFallbacks.filter(p=>definition.steps[p].fallback===input.fallback && !selected.includes(p)) : [];
    if (input.fallback && (status!=='failed' || candidates.length!==1))
      reject('fallback_undeclared',{step:name,workflow:input.fallback,declared:declaredFallbacks.map(p=>definition.steps[p].fallback).join('、') || '（无）'});
    const fallbackPreset = candidates[0] ?? null;
    const checkStart = status==='started' || status==='done';
    // A waiting dependency can change after a Run begins (or after a failed
    // attempt). Display status preserves "running"; check admission separately.
    const beforeReport = checkStart && previous.status!=='pending'
      ? {...plan,todos:plan.todos.map(t=>t.step===name ? {...t,status:'pending'} : t)}
      : plan;
    const priorView = resolveTodos(definition,beforeReport).todos.find(t=>t.step===name);
    const priorDeviation = checkStart && previous.status==='running' && previous.violation;
    let violation = Boolean(priorDeviation || (checkStart && priorView.state==='waiting'));
    const missing = new Set(priorDeviation ? previous.violationMissing : []);
    if (violation) for (const token of priorView.missing ?? []) missing.add(token);
    let next = structuredClone(plan);
    next.updatedAt = at;
    let todo = requireTodo(next,name);
    const renewed = [], expiredArtifacts = [], expired = [], affected = [];
    const released = status==='done' ? previous.presets.filter(p=>!selected.includes(p)) : [];

    if (status==='started' && previous.status==='running') {
      const runs = new Map(todo.runs.map(run=>[run.id,run]));
      for (const run of input.runs ?? []) runs.set(run.id,run);
      todo.runs=[...runs.values()];
      return finish(definition,next,{iteration:todo.iteration,alreadyRunning:{step:name,runs:[...runs.keys()]},violation:todo.violation,missing:todo.violationMissing,
        presets:[],fallbackPreset:null,released:[],renewed:[],expiry:{expiredArtifacts:[],resetSteps:[]}});
    }
    if ((status==='started' && terminal(previous)) || (previous.status==='failed' && status!=='skipped')) nextIteration(todo);
    if (status==='started') {
      todo.status='running'; todo.startedAt=at; todo.endedAt=null; todo.note=null;
    } else {
      const applyPreset = (preset,action,options={}) => {
        const result = unpack(reportStep(definition,next,{step:preset,status:action,note:input.note,at,...options}));
        next=result.plan;
        next.steps[preset].todo=name;
        if (result.violation) { violation=true; for (const token of result.missing) missing.add(token); }
        renewed.push(...result.renewed); expired.push(...result.expiry.resetSteps); expiredArtifacts.push(...result.expiry.expiredArtifacts);
      };
      for (const preset of selected) {
        if (next.steps[preset]?.status==='done') applyPreset(preset,'started');
        const products = definition.steps[preset].produces;
        applyPreset(preset,'done',{produced:produced.filter(ref=>products.includes(ref.name)),refs:input.refs ?? {}});
        affected.push(preset);
      }
      if (fallbackPreset) {
        applyPreset(fallbackPreset,'failed',{fallback:input.fallback,fallbackPlanId:input.fallbackPlanId});
        affected.push(fallbackPreset);
      } else if (status==='skipped' && definition) {
        for (const p of presetOrder(previous.presets,layersOf(definition))) {
          if (['done','skipped'].includes(next.steps[p]?.status)) continue;
          applyPreset(p,'skipped'); affected.push(p);
        }
      }
      todo = requireTodo(next,name);
      todo.status=status;
      todo.startedAt ??= at; todo.endedAt=at; todo.note=input.note?.trim() || null;
      if (status==='done') todo.presets=previous.presets.filter(p=>selected.includes(p));
      todo.fallbackTo=input.fallback ?? null; todo.fallbackPlanId=input.fallbackPlanId ?? null; todo.fallbackPreset=fallbackPreset;
    }
    todo.runs=input.runs ?? todo.runs;
    todo.violation=violation; todo.violationMissing=[...missing];
    const resetSteps=reopenExpired(next,expired,name);
    // A new iteration cannot reclaim a preset already assigned to a different todo.
    checkAssignments(definition,next);
    return finish(definition,next,{iteration:todo.iteration,violation,missing:[...missing],presets:affected,fallbackPreset,released,renewed:unique(renewed),expiry:{expiredArtifacts:unique(expiredArtifacts),resetSteps}});
  },plan);
}

export function resumeTodoAfterChild(definition,plan,name,at=Date.now()) {
  return checked(()=>{
    const prior=requireTodo(plan,name);
    if (!prior.fallbackPreset) invalid(name+' 没有待返回的回退步骤');
    const next=resumeAfterChild(definition,plan,prior.fallbackPreset,at).plan;
    nextIteration(requireTodo(next,name));
    return finish(definition,next);
  },plan);
}
