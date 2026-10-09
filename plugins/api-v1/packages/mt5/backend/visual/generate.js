import { digest } from '../support.js';
import { COMPILER, LANGUAGE } from './parse.js';
import { ADAPTERS, HOOKS, LIMITS } from './catalog.js';
import { walk } from './check.js';

export const GENERATED_FILE = 'Include/Product/VisualStrategy.mqh';
const quoted = value => JSON.stringify(value);
const prefix = (module, name) => `V_${module}_${name}`;
const fieldName = (module, value) => value.qualifier === 'input' ? `${module[0].toUpperCase() + module.slice(1)}_${value.name}` : prefix(module, value.name);
const portName = key => `V_port_${key.replace('.', '_')}`;

export function generate(programs, checked) {
  const lines = [], sourceMap = {}, nodes = [], edges = [], machines = [], rules = [], ruleEdges = [];
  const line = (text, at) => { lines.push(text); if (at) sourceMap[lines.length] = at; };
  const edge = (from, to, kind, label = '') => { if (from && to) edges.push({ from, to, kind, label }); };
  const functionGraphs = [];
  line('// Generated exclusively from checked visual-mql-v1 IR. Do not edit.');
  line('#include <Product/Visual.mqh>');
  for (const port of checked.ports.values()) { line(`${port.type} ${portName(`${port.module}.${port.name}`)}=0;`); line(`bool ${portName(`${port.module}.${port.name}`)}_ready=false;`); }
  const contexts = checked.contexts;
  for (const program of programs) {
    const ctx = contexts.get(program.module), mod = program.module;
    const type = value => ctx.types.has(value) ? prefix(mod, value) : value;
    const expr = (node, raw = false) => {
      let text;
      if (node.kind === 'literal') text = node.type === 'string' ? quoted(node.value) : node.type === 'double' ? node.raw ?? `${node.value}.0` : String(node.value);
      else if (node.kind === 'name') text = node.binding.local ? node.name : fieldName(mod, ctx.symbols.get(node.name));
      else if (node.kind === 'index') text = `${expr(node.object)}[V_Index(${expr(node.index)},${node.capacity},${quoted(node.id)})]`;
      else if (node.kind === 'field') text = `${expr(node.object)}.${node.field}`;
      else if (node.kind === 'unary') text = `(${node.op}${expr(node.value)})`;
      else if (node.kind === 'binary') {
        const left = expr(node.left), right = expr(node.right);
        if (['/', '%'].includes(node.op)) text = `${node.type === 'double' ? 'V_Div' : node.op === '%' ? 'V_Mod' : 'V_DivInt'}(${left},${right},${quoted(node.id)})`;
        else text = `(${left} ${node.op} ${right})`;
      } else if (node.kind === 'select') text = `(${expr(node.condition)} ? ${expr(node.yes)} : ${expr(node.no)})`;
      else if (node.kind === 'call') {
        if (node.name === 'Read') text = `(${portName(node.port)}_ready ? ${portName(node.port)} : (${type(node.type)})V_Missing(${quoted(node.id)}))`;
        else if (node.name === 'HasOutput') text = `${portName(node.port)}_ready`;
        else text = `${node.target ? prefix(mod, node.name) : node.name.startsWith('Math') ? node.name : `V_${node.name}`}(${node.args.map(a => expr(a)).join(',')})`;
      }
      if (!raw && node.type === 'bool' && !['name', 'literal'].includes(node.kind)) return `V_Bool(${quoted(node.id)},${text})`;
      if (!raw && node.type === 'double' && ['binary', 'unary', 'call'].includes(node.kind)) return `V_Number(${text},${quoted(node.id)})`;
      return text;
    };
    ctx.render = expr;
    for (const item of program.declarations) {
      if (item.kind === 'enum') line(`enum ${type(item.name)} { ${item.values.map(v => prefix(mod, v)).join(',')} };`, item.source);
      else if (item.kind === 'struct') {
        line(`struct ${type(item.name)} {`, item.source); for (const f of item.fields) line(`  ${type(f.type)} ${f.name}${f.capacity ? `[${f.capacity}]` : ''};`, f.source); line('};');
      } else if (item.kind === 'variable') {
        line(`${item.qualifier === 'input' ? 'input ' : item.qualifier === 'const' ? 'const ' : ''}${type(item.type)} ${fieldName(mod, item)}${item.capacity ? `[${item.capacity}]` : ''}${item.init ? `=${expr(item.init, true)}` : ''};`, item.source);
        if (ctx.machines.has(item.name)) line(`long ${prefix(mod, item.name)}_epoch${item.capacity ? `[${item.capacity}]` : '=0'};`);
      }
    }
    for (const fn of ctx.functions.values()) line(`${type(fn.type)} ${prefix(mod, fn.name)}(${fn.parameters.map(p => `${ctx.types.get(p.type)?.kind === 'struct' ? 'const ' : ''}${type(p.type)} ${ctx.types.get(p.type)?.kind === 'struct' ? '&' : ''}${p.name}`).join(',')});`);
  }
  for (const program of programs) {
    const mod = program.module, ctx = contexts.get(mod), expr = ctx.render;
    const type = value => ctx.types.has(value) ? prefix(mod, value) : value;
    const zero = type => type === 'void' ? '' : ctx.types.has(type) ? 'V_empty' : type === 'bool' ? 'false' : type === 'string' ? '""' : '0';
    for (const fn of ctx.functions.values()) {
      const exit = `return${zero(fn.type) ? ` ${zero(fn.type)}` : ''};`;
      line(`${type(fn.type)} ${prefix(mod, fn.name)}(${fn.parameters.map(p => `${ctx.types.get(p.type)?.kind === 'struct' ? 'const ' : ''}${type(p.type)} ${ctx.types.get(p.type)?.kind === 'struct' ? '&' : ''}${p.name}`).join(',')}) {`, fn.source);
      if (ctx.types.has(fn.type)) line(`  ${type(fn.type)} V_empty; ZeroMemory(V_empty);`);
      line(`  if(!V_Step(${quoted(fn.id)})) { ${exit} }`, fn.source);
      const emit = (node, indent = '  ') => {
        const put = text => line(indent + text, { ...node.source, node_id: node.id });
        if (node.kind === 'block') { put('{'); for (const child of node.body) emit(child, indent + '  '); put('}'); return; }
        put(`if(!V_Step(${quoted(node.id)})) { ${exit} }`);
        if (node.kind === 'variable') {
          put(`${node.qualifier === 'const' ? 'const ' : ''}${type(node.type)} ${node.name}${node.capacity ? `[${node.capacity}]` : ''}${node.init ? `=${expr(node.init)}` : ''};`);
          if (!node.init) put(`ZeroMemory(${node.name});`);
        } else if (node.kind === 'assign') {
          // Evaluate RHS before writing. Dynamic indices are checked by V_Index;
          // any runtime fault latches the event before another platform effect.
          const target = expr(node.target, true), value = expr(node.value);
          // A fixed platform helper binds the lvalue once, checks division and
          // finite results, and avoids writing after an index/evaluation fault.
          if (['double', 'int', 'long'].includes(node.target.type)) put(`V_Assign_${node.target.type}(${target},${value},${['=', '+=', '-=', '*=', '/='].indexOf(node.op)},${quoted(node.id)});`);
          else put(`${target} ${node.op} ${value};`);
          put(`V_Observe(${quoted(node.id)});`);
        } else if (node.kind === 'return') put(`return${node.value ? ` ${expr(node.value)}` : ''};`);
        else if (node.kind === 'break' || node.kind === 'continue') put(`${node.kind};`);
        else if (node.kind === 'if') {
          put(`if(${expr(node.condition)}) {`); emit(node.yes, indent + '  '); put('}');
          if (node.no) { put('else {'); emit(node.no, indent + '  '); put('}'); }
        } else if (node.kind === 'for') {
          put(`for(int ${node.index}=${expr(node.start)};${expr(node.condition)};${node.index}++) {`);
          put(`  if(!V_Step(${quoted(node.id)})) { ${exit} }`); emit(node.body, indent + '  '); put('}');
        } else if (node.kind === 'switch') {
          put(`switch(${expr(node.value)}) {`);
          for (const branch of node.cases) { put(`${branch.label ? `case ${expr(branch.label)}` : 'default'}: {`); emit(branch.body, indent + '  '); put('}'); }
          put('}');
        } else if (node.kind === 'expression') {
          const call = node.value;
          if (call.name === 'Publish') {
            const name = portName(call.port), valueType = call.args[1].type;
            const value = valueType === 'bool' ? `(${name} ? "true" : "false")` : valueType === 'double' ? `DoubleToString(${name},16)` : `IntegerToString(${name})`;
            put(`${name}=${expr(call.args[1])};`); put(`if(V_Fault) { ${exit} }`); put(`${name}_ready=true;`);
            put(`ProductEmit("output",${quoted(call.id)},"{\\\"event\\\":"+IntegerToString(V_Event)+",\\\"value\\\":"+${value}+"}");`);
          } else if (call.name === 'Transition') {
            const variable = ctx.machines.get(call.machine), name = prefix(mod, call.machine);
            const index = variable.capacity ? `V_Index(${expr(call.args[0].index)},${variable.capacity},${quoted(call.id)})` : '0';
            put(`{ int V_slot=${index}; if(V_Fault) { ${exit} }`);
            const state = `${name}${variable.capacity ? '[V_slot]' : ''}`, epoch = `${name}_epoch${variable.capacity ? '[V_slot]' : ''}`;
            put(`  if(${epoch}!=V_Event) { if(${state}!=${prefix(mod, call.from)}) { V_Fail(${quoted(call.id)},"state_source_mismatch"); ${exit} } ${state}=${expr(call.args[1])}; ${epoch}=V_Event;`);
            put(`    V_Transition(${quoted(`${mod}.${call.machine}`)},${quoted(call.args[2].value)},${quoted(call.from)},${quoted(call.args[1].name)},V_slot); } }`);
          } else put(`${expr(call)};`);
        }
      };
      emit(fn.body); line('}');
    }
  }
  // Explicit native adapters preserve virtual Standard Library hooks. Only
  // generated wrappers can reach CProductExpert and the managed trade object.
  line(nativeBridge());

  for (const program of programs) {
    const ctx = contexts.get(program.module), module = program.module;
    for (const node of walk(program)) {
      const label = program.file && node.source ? program.text.slice(node.source.start, node.source.end).replace(/\s+/g, ' ').slice(0, 180) : node.kind;
      nodes.push({ id: node.id, module, kind: node.kind, label, type: node.type ?? null, effect: node.effect ?? null, source: node.source, ...(node.binding ? { binding: node.binding } : {}) });
      if (node.binding?.declaration_id) edge(node.binding.declaration_id, node.id, 'data', `storage: ${node.binding.name}`);
      if (node.kind === 'call' && node.target) edge(node.id, node.target, 'call', node.name);
      if (node.kind === 'call' && node.port) for (const call of checked.ports.get(node.port).calls) if (node.name !== 'Publish') edge(call.id, node.id, 'port', node.port);
      for (const [key, child] of Object.entries(node)) {
        if (['source', 'binding', 'body', 'yes', 'no', 'cases'].includes(key)) continue;
        for (const value of Array.isArray(child) ? child : [child]) if (value?.kind && value.id) edge(value.id, node.id, 'data', key);
      }
    }
    for (const fn of ctx.functions.values()) {
      const exit = `${fn.id}.exit`; nodes.push({ id: exit, module, kind: 'exit', label: `${fn.name} return`, type: fn.type, source: fn.source });
      const flow = (node, next, breaks, continues) => {
        if (node.kind === 'block') { let first = next; for (const child of [...node.body].reverse()) first = flow(child, first, breaks, continues); return first; }
        if (node.kind === 'if') { edge(node.id, flow(node.yes, next, breaks, continues), 'control', 'true'); edge(node.id, node.no ? flow(node.no, next, breaks, continues) : next, 'control', 'false'); }
        else if (node.kind === 'for') { edge(node.id, flow(node.body, node.id, next, node.id), 'control', `iterate ≤ ${node.iterations}`); edge(node.id, next, 'control', 'done'); }
        else if (node.kind === 'switch') { for (const branch of node.cases) edge(node.id, flow(branch.body, next, next, continues), 'control', branch.label ? ctx.render(branch.label) : 'default'); if (!node.cases.some(c => !c.label)) edge(node.id, next, 'control', 'unmatched'); }
        else edge(node.id, node.kind === 'return' ? exit : node.kind === 'break' ? breaks : node.kind === 'continue' ? continues : next, 'control');
        return node.id;
      };
      edge(fn.id, flow(fn.body, exit, null, null), 'control', 'enter');
      functionGraphs.push({ id: fn.id, module, name: fn.name, parameters: fn.parameters.map(p => ({ name: p.name, type: p.type })), returns: fn.type, effects: fn.effects, max_steps: fn.max_steps, source: fn.source });
      rules.push({ id: fn.id, kind: 'compute', label: `${module}.${fn.name}`, operator: 'visual.function', config: { source: fn.source, effects: fn.effects, control_flow: fn.id } });
    }
    for (const variable of ctx.machines.values()) {
      const transitions = [...walk(program)].filter(node => node.kind === 'call' && node.name === 'Transition' && node.machine === variable.name);
      const machine = { id: `${module}.${variable.name}`, label: `${module}.${variable.name}`, initial_state: variable.machine_initial,
        states: ctx.types.get(variable.type).values.map(id => ({ id, label: id })), transitions: transitions.map(call => {
          const guard = `${call.id}.guard`, action = `${call.id}.action`;
          rules.push({ id: guard, kind: 'condition', label: `${call.args[2].value} · control path`, operator: 'visual.control_path', config: { guards: call.guards, source: call.source, control_flow_node: call.id, note: 'Ordered control flow, including earlier returns, is authoritative.' } });
          rules.push({ id: action, kind: 'action', label: `Transition ${call.args[2].value}`, operator: 'visual.transition', config: { source: call.source, priority: call.priority, instance: variable.capacity ? 'array_index' : 'single' } });
          return { id: call.args[2].value, from_state: call.from, to_state: call.args[1].name, trigger: call.trigger, guard_node_id: guard, action_node_ids: [action] };
        }) };
      machines.push(machine);
    }
  }
  const hook = (module, name) => ({ name: `${module}.${name}`, function_id: contexts.get(module).functions.get(name).id });
  const observe = [hook('risk', 'Refresh'), hook('position', 'Refresh'), hook('expert', 'Observe')];
  const engine = { language: LANGUAGE, compiler_version: COMPILER, verification: 'checked_source', limits: LIMITS,
    lifecycle: {
      tick: [{ name: 'snapshot' }, ...observe, hook('signal', 'Advance'), { name: 'CExpert.OnTick', function_id: contexts.get('expert').functions.get('Processing').id, boundary: 'Native readiness/refresh gate, then virtual Processing; native branches may return early.' }, hook('signal', 'ConsumeSignal')],
      timer: [{ name: 'snapshot' }, ...observe], trade: [{ name: 'snapshot' }, ...observe],
      transaction: [{ name: 'snapshot + transaction facts' }, hook('risk', 'OnTransaction'), hook('position', 'OnTransaction')],
    },
    modules: programs.map(p => ({ id: p.module, file: p.file, memory: p.declarations.filter(d => d.kind === 'variable').map(d => ({ name: d.name, type: d.type, capacity: d.capacity, qualifier: d.qualifier, initial: d.init, source: d.source })) })),
    functions: functionGraphs, nodes, edges, state_machines: machines,
    ports: [...checked.ports.values()].map(({ calls, ...port }) => ({ ...port, publishers: calls.map(c => c.id) })),
    adapters: ADAPTERS, ir: programs.map(({ text, ...p }) => p), generated_file: GENERATED_FILE, source_map: sourceMap };
  const generated = lines.join('\n') + '\n';
  engine.generated_digest = digest(generated); engine.digest = digest(JSON.stringify(engine));
  return { engine, generated, rules: { label: 'Source-derived strategy', nodes: rules, edges: ruleEdges, state_machines: machines } };
}

function nativeBridge() {
  return `
#include <Product/Expert.mqh>
#include <Expert/ExpertSignal.mqh>
#include <Expert/ExpertMoney.mqh>
#include <Expert/ExpertTrailing.mqh>
input ulong InpMagic=20260930;
class CStrategySignal : public CExpertSignal {
public:
 bool Configure() { return V_signal_Configure(); }
 void Advance() { V_signal_Advance(); StopLevel(V_signal_StopLossPoints()); TakeLevel(V_signal_TakeProfitPoints()); }
 void ConsumeSignal() { V_signal_ConsumeSignal(); }
 virtual int LongCondition() { return V_Fault ? 0 : V_signal_LongCondition(); }
 virtual int ShortCondition() { return V_Fault ? 0 : V_signal_ShortCondition(); }
 virtual bool CheckCloseLong(double &price) { price=V_Bid(); return !V_Fault && V_signal_CloseLong(); }
 virtual bool CheckCloseShort(double &price) { price=V_Ask(); return !V_Fault && V_signal_CloseShort(); }
};
class CStrategyMoney : public CExpertMoney {
public:
 bool Configure() { return V_money_Configure(); }
 virtual double CheckOpenLong(double price,double sl) { return V_Fault ? 0 : V_money_Lots(price,sl,true); }
 virtual double CheckOpenShort(double price,double sl) { return V_Fault ? 0 : V_money_Lots(price,sl,false); }
};
class CStrategyTrailing : public CExpertTrailing {
public:
 bool Configure() { return V_trailing_Configure(); }
 virtual bool CheckTrailingStopLong(CPositionInfo *position,double &sl,double &tp) {
   sl=V_trailing_StopLoss(true,position.PriceOpen(),position.StopLoss()); tp=V_trailing_TakeProfit(true,position.PriceOpen(),position.TakeProfit()); return !V_Fault && (sl>0 || tp>0);
 }
 virtual bool CheckTrailingStopShort(CPositionInfo *position,double &sl,double &tp) {
   sl=V_trailing_StopLoss(false,position.PriceOpen(),position.StopLoss()); tp=V_trailing_TakeProfit(false,position.PriceOpen(),position.TakeProfit()); return !V_Fault && (sl>0 || tp>0);
 }
};
class CStrategyExpert : public CProductExpert {
protected:
 virtual bool Processing() { return !V_Fault && V_expert_Processing(); }
 virtual bool CheckOpen() { return !V_Fault && V_risk_AllowNewRisk() && CProductExpert::CheckOpen(); }
 virtual bool CheckReverse() { return !V_Fault && V_risk_AllowNewRisk() && CProductExpert::CheckReverse(); }
 virtual bool CheckClose() { if(V_position_Manage()) return true; return !V_Fault && CProductExpert::CheckClose(); }
public:
 bool Configure() { return V_expert_Configure() && V_risk_Configure() && V_position_Configure(); }
 void Observe() { V_risk_Refresh(); V_position_Refresh(); V_expert_Observe(); }
 void OnTransaction(const MqlTradeTransaction &tx,const MqlTradeRequest &request,const MqlTradeResult &result) { V_risk_OnTransaction(); V_position_OnTransaction(); }
 bool PlatformProcessing() { return !V_Fault && CProductExpert::Processing(); }
 bool PlatformOpen() { return CheckOpen(); }
 bool PlatformReverse() { if(!SelectPosition()) return false; return CheckReverse(); }
 bool PlatformClose() { if(!SelectPosition()) return false; return CheckClose(); }
 bool PlatformTrail() { if(!SelectPosition()) return false; return !V_Fault && CProductExpert::CheckTrailingStop(); }
};
CStrategyExpert Expert;
bool V_NativeProcessing() { return Expert.PlatformProcessing(); }
bool V_NativeOpen() { return Expert.PlatformOpen(); }
bool V_NativeReverse() { return Expert.PlatformReverse(); }
bool V_NativeClose() { return Expert.PlatformClose(); }
bool V_NativeTrail() { return Expert.PlatformTrail(); }
bool V_Send(MqlTradeRequest &request,MqlTradeResult &result) { return !V_Fault && Expert.ManagedRequest(request,result); }
`;
}
