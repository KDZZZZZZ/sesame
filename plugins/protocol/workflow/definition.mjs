import { createHash } from 'node:crypto';
import { parseYaml } from '../package.mjs';
import schema from './schema.json' with { type:'json' };

export class WorkflowSyntaxError extends Error {
  constructor(line, detail) {
    super(`第 ${line} 行 ${detail}`);
    this.name = 'WorkflowSyntaxError';
    this.line = line;
    this.detail = detail;
  }
}

export const ARTIFACT_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;
export const OUTCOME_NAME = /^[a-z][a-z0-9_]{0,31}$/;
export const STEP_NAME = /^[a-z][a-z0-9_]{0,47}$/;
export const WORKFLOW_ID = /^[a-z][a-z0-9._-]{0,63}$/;
export const CONDITION_NAME = /^[a-z][a-z0-9_]{0,63}$/;
export function parseToken(token) {
  const text = String(token ?? '');
  const index = text.indexOf(':');
  if (index === -1) return { name: text, outcome: null };
  return { name: text.slice(0, index), outcome: text.slice(index + 1) };
}

export function formatRef(ref) {
  return ref?.outcome ? `${ref.name}:${ref.outcome}` : ref?.name ?? '';
}

function fail(line, detail) {
  throw new WorkflowSyntaxError(line, detail);
}


const PACKAGE = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;
const ELEMENT = /^(?:[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*:)?tool\/[a-z][a-z0-9_]{0,127}$/;
const mapping = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const assert = (test, detail) => { if (!test) fail(1, detail); };
function fields(value, keys, label) {
  assert(mapping(value), label + ' must be a mapping');
  for (const key of Object.keys(value)) assert(keys.includes(key), label + ': unknown field ' + key);
}
function list(value, regex, label) {
  assert(Array.isArray(value) && value.every(token => typeof token === 'string' && regex.test(token)), label + ': invalid list');
  assert(new Set(value).size === value.length, label + ': duplicate value');
  return value;
}
function safeName(value, regex) {
  return typeof value === 'string' && regex.test(value) && !(value in Object.prototype);
}

export function parseWorkflow(text, owner = '') {
  const doc = parseYaml(text, 'workflow');
  fields(doc, Object.keys(schema.properties), 'workflow');
  assert(safeName(doc.workflow, WORKFLOW_ID), 'invalid workflow ID');
  assert(safeName(doc.goal, ARTIFACT_NAME), 'invalid goal');
  for (const key of ['title','description']) assert(doc[key] === undefined || typeof doc[key] === 'string', 'invalid ' + key);
  assert(mapping(doc.steps) && Object.keys(doc.steps).length > 0, 'steps must be a nonempty mapping');
  const steps = Object.create(null), producers = Object.create(null), outcomes = Object.create(null);
  const imports = doc.imports ?? {}, declarations = doc.artifacts ?? {};
  assert(mapping(imports) && mapping(declarations), 'invalid artifacts/imports');
  for (const [name, provider] of Object.entries(imports)) {
    assert(safeName(name, ARTIFACT_NAME) && typeof provider === 'string' && PACKAGE.test(provider) && provider !== owner, 'invalid artifact import ' + name);
  }
  for (const [name, declaration] of Object.entries(declarations)) {
    assert(safeName(name, ARTIFACT_NAME), 'invalid artifact ' + name);
    fields(declaration, ['outcomes'], name);
    if (declaration.outcomes) outcomes[name] = list(declaration.outcomes, OUTCOME_NAME, name);
  }
  for (const [name, raw] of Object.entries(doc.steps)) {
    assert(safeName(name, STEP_NAME), 'invalid step ' + name);
    fields(raw, Object.keys(schema.$defs.step.properties), name);
    assert(typeof raw.title === 'string' && raw.title.trim(), name + ' requires a title');
    assert(raw.hint === undefined || typeof raw.hint === 'string', name + ': invalid hint');
    const item = { title:raw.title, hint:raw.hint ?? '', when:raw.when ?? null, fallback:raw.fallback ?? null };
    if (item.when) assert(safeName(item.when, CONDITION_NAME), 'invalid condition ' + item.when);
    if (item.fallback) {
      const parts = item.fallback.split(':');
      assert(parts.length <= 2 && (parts.length === 1 || PACKAGE.test(parts[0])) && WORKFLOW_ID.test(parts.at(-1)), 'invalid fallback ' + item.fallback);
      if (parts.length === 1 && owner) item.fallback = owner + ':' + item.fallback;
      assert(item.fallback !== (owner ? owner + ':' : '') + doc.workflow, 'fallback points to itself');
    }
    for (const key of ['requires','requires_any','requires_if_valid']) {
      item[key] = list(raw[key] ?? [], /^[A-Z][A-Za-z0-9]{0,63}(?::[a-z][a-z0-9_]{0,31})?$/, name+'.'+key).map(parseToken);
      for (const ref of item[key]) if (ref.outcome) assert(outcomes[ref.name]?.includes(ref.outcome), 'undeclared outcome '+formatRef(ref));
    }
    for (const key of ['uses','uses_any']) item[key] = list(raw[key] ?? [], ELEMENT, name+'.'+key);
    item.produces = list(raw.produces, ARTIFACT_NAME, name+'.produces');
    assert(item.produces.length > 0, name+' requires produces');
    for (const product of item.produces) {
      assert(!Object.hasOwn(producers,product) && !Object.hasOwn(imports,product), 'duplicate or imported product '+product);
      producers[product] = name;
    }
    steps[name] = item;
  }
  const referenced = new Set(Object.values(steps).flatMap(s => [...s.requires,...s.requires_any,...s.requires_if_valid].map(ref=>ref.name)));
  for (const name of Object.keys(imports)) assert(referenced.has(name), 'unused import '+name);
  if (!producers[doc.goal]) fail(1, `目标产物 ${doc.goal} 没有生产步骤`);
  const graph = new Map(Object.entries(steps).map(([name, step]) => [name, new Set()]));
  for (const [name, step] of Object.entries(steps)) {
    for (const ref of [...step.requires, ...step.requires_any, ...step.requires_if_valid]) {
      const producer = producers[ref.name];
      if (producer) graph.get(name).add(producer);
    }
  }
  const color = new Map();
  const stack = [];
  const visit = name => {
    color.set(name, 'gray');
    stack.push(name);
    for (const next of graph.get(name)) {
      if (color.get(next) === 'gray') fail(1, `依赖成环：${[...stack.slice(stack.indexOf(next)), next].join(' → ')}`);
      if (!color.has(next)) visit(next);
    }
    stack.pop();
    color.set(name, 'black');
  };
  for (const name of Object.keys(steps)) if (!color.has(name)) visit(name);
  const externals = [...referenced].filter(name => !producers[name]);
  const conditions = [...new Set(Object.values(steps).map(step => step.when).filter(Boolean))];
  return {
    id: doc.workflow, qualifiedId: owner ? owner + ':' + doc.workflow : doc.workflow, owner, title: doc.title ?? doc.workflow,
    goal: doc.goal,
    description: doc.description ?? '',
    outcomes, imports, declarations,
    steps,
    producers,
    externals,
    conditions,
    artifacts: [...new Set([...Object.keys(producers), ...referenced])],
  };
}

export function validateWorkflowSet(definitions) {
  const byId = new Map(definitions.map(definition => [definition.qualifiedId ?? definition.id, definition]));
  const color = new Map();
  const stack = [];
  const visit = id => {
    color.set(id, 'gray');
    stack.push(id);
    const definition = byId.get(id);
    const targets = new Set(Object.values(definition?.steps ?? {}).map(step => step.fallback).filter(target => target && byId.has(target)));
    for (const next of targets) {
      if (color.get(next) === 'gray') {
        const cycle = [...stack.slice(stack.indexOf(next)), next];
        return cycle;
      }
      if (!color.has(next)) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, 'black');
    return null;
  };
  for (const definition of definitions) {
    if (!color.has(definition.qualifiedId ?? definition.id)) {
      const cycle = visit(definition.qualifiedId ?? definition.id);
      if (cycle) return cycle;
    }
  }
  return null;
}

export function readWorkflowDefinitions(files, pluginId) {
  const entries = files instanceof Map ? files.entries() : Object.entries(files);
  const found = [];
  for (const [path, bytes] of entries) {
    if (!path.startsWith('workflows/')) continue;
    const match = /^workflows\/([a-z][a-z0-9._-]{0,63})\.yaml$/.exec(path);
    assert(match, 'invalid workflow path '+path);
    const text = Buffer.from(bytes).toString('utf8');
    assert(Buffer.byteLength(text) <= 256 * 1024, 'workflow definition too large');
    const definition = parseWorkflow(text, pluginId);
    assert(match[1] === definition.id, 'workflow filename must match workflow ID');
    found.push({path, sha256:createHash('sha256').update(text).digest('hex'), definition});
  }
  const cycle = validateWorkflowSet(found.map(item => item.definition));
  assert(!cycle, 'fallback cycle '+cycle?.join(' -> '));
  return found;
}
