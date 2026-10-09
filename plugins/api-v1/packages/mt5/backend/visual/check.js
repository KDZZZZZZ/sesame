import { invalid, MODULES } from './parse.js';
import { ADAPTERS, HOOKS, QUERIES, LIMITS } from './catalog.js';

const numeric = type => ['int', 'long', 'double'].includes(type);
const compatible = (to, from) => to === from || to === 'double' && numeric(from) || to === 'long' && from === 'int';
export const walk = function* (value) {
  if (!value || typeof value !== 'object') return;
  if (value.kind) yield value;
  for (const [key, child] of Object.entries(value)) if (!['source', 'binding'].includes(key)) {
    if (Array.isArray(child)) { for (const item of child) yield* walk(item); } else if (child && typeof child === 'object') yield* walk(child);
  }
};
const fail = (node, message) => invalid(node.source, message);
const assert = (yes, node, message) => { if (!yes) fail(node, message); };
const terminal = statement => statement.kind === 'return' || statement.kind === 'block' && statement.body.some(terminal)
  || statement.kind === 'if' && terminal(statement.yes) && statement.no && terminal(statement.no)
  || statement.kind === 'switch' && statement.cases.some(c => !c.label) && statement.cases.every(c => terminal(c.body));
const rootName = node => node.kind === 'name' ? node.name : ['index', 'field'].includes(node.kind) ? rootName(node.object) : null;

export function check(programs) {
  const ports = new Map(), contexts = new Map();
  let count = 0;
  for (const program of programs) {
    const ctx = { program, symbols: new Map(), functions: new Map(), types: new Map(), machines: new Map() }; contexts.set(program.module, ctx);
    const bind = (name, item) => { assert(!ctx.symbols.has(name) && !ADAPTERS[name] && !['Transition', 'Publish', 'Read', 'HasOutput'].includes(name), item, `名称 ${name} 重复或占用原语名称`); ctx.symbols.set(name, item); };
    for (const item of program.declarations) {
      if (item.kind === 'enum') {
        ctx.types.set(item.name, item); assert(item.values.length <= 128, item, '枚举最多 128 项');
        for (const [value, name] of item.values.entries()) bind(name, { ...item, kind: 'enum_value', name, value, type: item.name, qualifier: 'const' });
      } else if (item.kind === 'struct') {
        ctx.types.set(item.name, item); const fields = new Set();
        for (const field of item.fields) { assert(!fields.has(field.name) && field.type !== 'void' && !field.init && field.qualifier === 'memory', field, '记录字段必须唯一，不支持字段初值或 input/const'); fields.add(field.name); }
      } else { bind(item.name, item); if (item.kind === 'function') ctx.functions.set(item.name, item); }
    }
    for (const [hook, signature] of Object.entries(HOOKS[program.module])) {
      const fn = ctx.functions.get(hook); assert(fn, { source: { file: program.file, line: 1, column: 1 } }, `缺少接入函数 ${signature[0]} ${hook}(${signature.slice(1).join(', ')})`);
      assert(fn.type === signature[0] && fn.parameters.length === signature.length - 1 && fn.parameters.every((p, i) => p.type === signature[i + 1]), fn, `接入函数 ${hook} 签名不匹配`);
    }
    for (const item of program.declarations) if (item.kind === 'variable' && item.qualifier === 'memory' && ctx.types.get(item.type)?.kind === 'enum') ctx.machines.set(item.name, item);
    for (const node of walk(program)) { count++; assert(count <= LIMITS.ir_nodes, node, '整个工程的中间表示超过节点上限'); }
  }
  // Ports declare their type at Publish with a literal prototype argument. Read
  // uses this static catalogue; there is no arbitrary cross-module field access.
  for (const ctx of contexts.values()) for (const call of walk(ctx.program)) if (call.kind === 'call' && call.name === 'Publish') {
    assert(call.args.length === 2 && call.args[0].kind === 'literal' && call.args[0].type === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(call.args[0].value), call, 'Publish("端口", 标量值) 需要静态端口名');
    const key = `${ctx.program.module}.${call.args[0].value}`; if (!ports.has(key)) ports.set(key, { module: ctx.program.module, name: call.args[0].value, type: null, calls: [] }); ports.get(key).calls.push(call);
  }

  // Resolve port types without assuming module order. Type inference here does
  // not authorize execution; the full scope/type/effect walk below still runs.
  const infer = (node, ctx, symbols) => {
    if (!node) return null;
    if (node.kind === 'literal') return node.type;
    if (node.kind === 'name') return (symbols.get(node.name) ?? ctx.symbols.get(node.name))?.type;
    if (node.kind === 'unary') return node.op === '!' ? 'bool' : infer(node.value, ctx, symbols);
    if (node.kind === 'binary') { if (['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(node.op)) return 'bool'; const a = infer(node.left, ctx, symbols), b = infer(node.right, ctx, symbols); return !a || !b ? null : a === 'double' || b === 'double' ? 'double' : a === 'long' || b === 'long' ? 'long' : 'int'; }
    if (node.kind === 'select') return infer(node.yes, ctx, symbols);
    if (node.kind === 'field') return ctx.types.get(infer(node.object, ctx, symbols))?.fields?.find(f => f.name === node.field)?.type;
    if (node.kind === 'index') return infer(node.object, ctx, symbols);
    if (node.kind === 'call') return node.name === 'HasOutput' ? 'bool' : node.name === 'Read' ? ports.get(`${node.args[0]?.value}.${node.args[1]?.value}`)?.type : ctx.functions.get(node.name)?.type ?? ADAPTERS[node.name]?.returns;
    return null;
  };
  for (let round = 0; round <= ports.size; round++) for (const ctx of contexts.values()) for (const fn of ctx.functions.values()) {
    const symbols = new Map([...fn.parameters, ...[...walk(fn.body)].filter(n => n.kind === 'variable')].map(n => [n.name, n]));
    for (const call of walk(fn.body)) if (call.kind === 'call' && call.name === 'Publish') { const port = ports.get(`${ctx.program.module}.${call.args[0].value}`); port.type ??= infer(call.args[1], ctx, symbols); }
  }

  function analyze(ctx) {
    const constant = (expr, visiting = new Set()) => {
      if (expr.kind === 'literal') return expr.value;
      if (expr.kind === 'name') {
        const value = ctx.symbols.get(expr.name); if (value?.kind === 'enum_value') return value.value;
        if (value?.qualifier === 'const' && value.init && !visiting.has(expr.name)) { visiting.add(expr.name); return constant(value.init, visiting); }
      }
      if (expr.kind === 'unary') { const value = constant(expr.value, visiting); if (value !== undefined) return expr.op === '-' ? -value : expr.op === '+' ? +value : !value; }
      return undefined;
    };
    const expression = (expr, scope, fn, allowEffect = false) => {
      let result;
      if (expr.kind === 'literal') result = expr.type;
      else if (expr.kind === 'name') {
        const item = scope.get(expr.name) ?? ctx.symbols.get(expr.name); assert(item && ['variable', 'parameter', 'enum_value'].includes(item.kind), expr, `未知变量 ${expr.name}`);
        expr.binding = { name: item.name, declaration_id: item.id ?? null, local: scope.has(expr.name), kind: item.kind, qualifier: item.qualifier ?? 'parameter', capacity: item.capacity ?? null };
        result = item.capacity ? `${item.type}[${item.capacity}]` : item.type;
      } else if (expr.kind === 'index') {
        const value = expression(expr.object, scope, fn), index = expression(expr.index, scope, fn), match = /^(\w+)\[(\d+)\]$/.exec(value);
        assert(match && ['int', 'long'].includes(index), expr, '下标只能应用到定长数组，且必须为整数'); expr.capacity = +match[2];
        const known = constant(expr.index); assert(known === undefined || known >= 0 && known < expr.capacity, expr, '数组常量下标越界'); result = match[1];
      } else if (expr.kind === 'field') {
        const type = expression(expr.object, scope, fn), field = ctx.types.get(type)?.fields?.find(f => f.name === expr.field);
        assert(field, expr, `类型 ${type} 没有字段 ${expr.field}`); result = field.capacity ? `${field.type}[${field.capacity}]` : field.type;
      } else if (expr.kind === 'unary') {
        const type = expression(expr.value, scope, fn); assert(expr.op === '!' ? type === 'bool' : numeric(type), expr, '一元运算类型不匹配'); result = expr.op === '!' ? 'bool' : type;
      } else if (expr.kind === 'binary') {
        const left = expression(expr.left, scope, fn), right = expression(expr.right, scope, fn);
        if (['&&', '||'].includes(expr.op)) { assert(left === 'bool' && right === 'bool', expr, '短路条件必须为 bool'); result = 'bool'; }
        else if (['==', '!='].includes(expr.op)) { assert(left === right && !ctx.types.get(left)?.fields && !left.includes('[') || numeric(left) && numeric(right), expr, '比较类型不兼容'); result = 'bool'; }
        else { assert(numeric(left) && numeric(right), expr, '算术和大小比较需要数值'); assert(expr.op !== '%' || left !== 'double' && right !== 'double', expr, '取余需要整数'); result = ['<', '>', '<=', '>='].includes(expr.op) ? 'bool' : left === 'double' || right === 'double' ? 'double' : left === 'long' || right === 'long' ? 'long' : 'int'; }
      } else if (expr.kind === 'select') {
        assert(expression(expr.condition, scope, fn) === 'bool', expr, '选择条件必须为 bool'); const yes = expression(expr.yes, scope, fn), no = expression(expr.no, scope, fn);
        assert(compatible(yes, no) || compatible(no, yes), expr, '三元分支类型不兼容'); result = compatible(yes, no) ? yes : no;
      } else if (expr.kind === 'call') {
        if (expr.name === 'Transition') {
          assert(allowEffect && expr.args.length === 3, expr, 'Transition 只能作为独立语句，参数为状态、目标枚举、转移 ID');
          const [state, target, id] = expr.args, variable = ctx.symbols.get(rootName(state));
          assert(variable?.kind === 'variable' && variable.qualifier === 'memory' && ctx.types.get(variable.type)?.kind === 'enum' && ['name', 'index'].includes(state.kind), expr, 'Transition 的状态必须为本模块枚举记忆或枚举数组元素');
          expression(state, scope, fn); expression(target, scope, fn);
          assert(target.kind === 'name' && ctx.symbols.get(target.name)?.kind === 'enum_value' && target.type === variable.type, expr, '目标必须为同一类型的静态枚举项');
          assert(id.kind === 'literal' && id.type === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(id.value), expr, '转移 ID 必须是静态标识符');
          expr.machine = variable.name; expr.effect = 'transition'; result = 'void';
          ctx.machines.set(variable.name, variable);
        } else if (['Publish', 'Read', 'HasOutput'].includes(expr.name)) {
          if (expr.name === 'Publish') {
            assert(allowEffect, expr, 'Publish 必须为独立动作'); const value = expression(expr.args[1], scope, fn);
            assert(['bool', 'int', 'long', 'double'].includes(value), expr, '输出端口需要 bool/int/long/double');
            const port = ports.get(`${ctx.program.module}.${expr.args[0].value}`);
            assert(!port.type || port.type === value, expr, '同一输出端口的类型不一致'); port.type = value; expr.port = `${port.module}.${port.name}`; expr.effect = 'publish'; result = 'void';
          } else {
            assert(expr.args.length === 2 && expr.args.every(a => a.kind === 'literal' && a.type === 'string'), expr, 'Read/HasOutput 需要静态模块和端口名称');
            const port = ports.get(`${expr.args[0].value}.${expr.args[1].value}`); assert(port, expr, '未声明的模块输出端口');
            expr.port = `${port.module}.${port.name}`; result = expr.name === 'HasOutput' ? 'bool' : port.type; assert(result, expr, '输出端口类型无法解析'); expr.effect = 'port_read';
          }
        } else {
          const target = ctx.functions.get(expr.name), adapter = ADAPTERS[expr.name]; assert(target || adapter, expr, `未登记调用 ${expr.name}；不能绕过受控原语`);
          const parameters = target ? target.parameters.map(p => p.type) : adapter.args;
          assert(parameters.length === expr.args.length, expr, `${expr.name} 参数数量不匹配`);
          expr.args.forEach((arg, i) => assert(compatible(parameters[i], expression(arg, scope, fn)), arg, `${expr.name} 的参数 ${i + 1} 需要 ${parameters[i]}`));
          if (adapter) { assert(!adapter.modules || adapter.modules.includes(ctx.program.module), expr, `${ctx.program.module} 无权调用 ${expr.name}`); expr.effect = adapter.effect; expr.adapter = expr.name; }
          else { expr.target = target.id; expr.effect = 'call'; }
          expr.effect_allowed = allowEffect; result = target?.type ?? adapter.returns;
        }
      } else fail(expr, `未支持的表达式 ${expr.kind}`);
      expr.type = result; return result;
    };
    const variable = (item, scope, fn, global = false) => {
      assert(item.type !== 'void', item, '变量不能为 void'); assert(!scope.has(item.name) && (global || !ctx.symbols.has(item.name)), item, '局部变量不能遮蔽参数、记忆、枚举项或函数');
      if (item.init) { assert(!item.capacity && compatible(item.type, expression(item.init, scope, fn)), item, '初始化类型不匹配或数组初值不受支持'); if (global) assert(constant(item.init) !== undefined, item, '模块记忆与 input 初值必须为常量'); }
      else assert(item.capacity || ctx.types.get(item.type)?.kind === 'struct', item, '标量必须显式初始化');
      assert(item.qualifier !== 'input' || global && !item.capacity && ['bool', 'int', 'long', 'double', 'string'].includes(item.type), item, 'input 仅能声明模块级标量参数');
      assert(item.qualifier !== 'const' || item.init, item, 'const 需要初值');
      if (!global) { item.qualifier = item.qualifier === 'const' ? 'const' : 'local'; scope.set(item.name, item); }
    };
    const statement = (node, scope, fn, context = {}) => {
      if (node.kind === 'block') { const inner = new Map(scope); for (const child of node.body) statement(child, inner, fn, context); }
      else if (node.kind === 'variable') variable(node, scope, fn);
      else if (node.kind === 'assign') {
        const targetType = expression(node.target, scope, fn), name = rootName(node.target), item = scope.get(name) ?? ctx.symbols.get(name);
        assert(['name', 'index', 'field'].includes(node.target.kind) && item?.kind === 'variable' && ['local', 'memory'].includes(item.qualifier) && !context.counters?.includes(name), node, '赋值目标必须为可写局部或本模块记忆，不能修改参数、input、循环计数器或其他模块');
        assert(!targetType.includes('[') && compatible(targetType, expression(node.value, scope, fn)) && (node.op === '=' || numeric(targetType)), node, '赋值类型不兼容');
        node.effect = scope.has(name) ? 'local_write' : 'memory_write'; node.storage = name;
      } else if (node.kind === 'expression') {
        expression(node.value, scope, fn, true);
        if (node.value.name === 'Transition') {
          assert(context.machine === node.value.machine && context.from, node, '转移必须位于 switch(对应状态) 的明确枚举 case 中');
          assert(!QUERIES.has(fn.name) && HOOKS[ctx.program.module][fn.name], node, '转移只能写在事件接入函数中，不能藏在辅助函数或查询中');
          node.value.from = context.from; node.value.trigger = fn.name; node.value.guards = context.guards ?? []; node.value.priority = node.source.start;
        }
      } else if (node.kind === 'return') {
        assert(node.value ? compatible(fn.type, expression(node.value, scope, fn, true)) : fn.type === 'void', node, '返回类型不匹配');
      } else if (node.kind === 'if') {
        assert(expression(node.condition, scope, fn, true) === 'bool', node, 'if 条件需要 bool');
        statement(node.yes, scope, fn, { ...context, guards: [...(context.guards ?? []), { node: node.condition.id, value: true }] });
        if (node.no) statement(node.no, scope, fn, { ...context, guards: [...(context.guards ?? []), { node: node.condition.id, value: false }] });
      } else if (node.kind === 'for') {
        const start = constant(node.start), bound = constant(node.condition.right ?? {});
        assert(!scope.has(node.index) && !ctx.symbols.has(node.index) && node.increment === node.index && node.condition.kind === 'binary' && ['<', '<='].includes(node.condition.op) && node.condition.left.kind === 'name' && node.condition.left.name === node.index && Number.isSafeInteger(start) && Number.isSafeInteger(bound) && start >= 0, node, 'for 必须使用独立整数计数器、常量起点/上限及 i++');
        node.iterations = Math.max(0, bound - start + (node.condition.op === '<=' ? 1 : 0)); assert(node.iterations <= LIMITS.loop_iterations && bound <= 2147483646, node, '循环超过静态上限');
        const inner = new Map(scope); inner.set(node.index, { kind: 'variable', name: node.index, type: 'int', qualifier: 'const' });
        expression(node.start, inner, fn); expression(node.condition, inner, fn);
        statement(node.body, inner, fn, { ...context, loop: true, counters: [...(context.counters ?? []), node.index] });
      } else if (node.kind === 'switch') {
        const type = expression(node.value, scope, fn); assert(['int', 'long'].includes(type) || ctx.types.get(type)?.kind === 'enum', node, 'switch 需要整数或枚举');
        const labels = new Set(); for (const branch of node.cases) {
          const value = branch.label ? constant(branch.label) : 'default'; assert(value !== undefined && !labels.has(value), branch, 'case 必须为唯一常量'); labels.add(value);
          if (branch.label) assert(expression(branch.label, scope, fn) === type, branch, 'case 类型不匹配');
          const last = branch.body.body.at(-1); assert(last && ['break', 'return', 'continue'].includes(last.kind), branch, 'case 必须以 break、return 或 continue 显式结束，不允许贯穿');
          statement(branch.body, scope, fn, { ...context, switch: true, machine: rootName(node.value), from: branch.label?.kind === 'name' ? branch.label.name : null });
        }
      } else if (node.kind === 'break') assert(context.loop || context.switch, node, 'break 不在循环或 switch 内');
      else if (node.kind === 'continue') assert(context.loop, node, 'continue 不在循环内');
      else fail(node, `未支持的语句 ${node.kind}`);
    };
    for (const item of ctx.program.declarations) if (item.kind === 'variable') variable(item, new Map(), null, true);
    for (const fn of ctx.functions.values()) {
      const scope = new Map(); for (const parameter of fn.parameters) { assert(parameter.type !== 'void' && !scope.has(parameter.name) && !ctx.symbols.has(parameter.name), parameter, '参数类型无效、重名或遮蔽模块名称'); scope.set(parameter.name, parameter); }
      statement(fn.body, scope, fn); assert(fn.type === 'void' || terminal(fn.body), fn, '非 void 函数的所有路径必须返回');
    }
    for (const node of walk(ctx.program)) if (node.kind === 'assign') assert(!ctx.machines.has(node.storage), node, '状态枚举只能通过 Transition 更新');
    for (const memory of ctx.machines.values()) {
      assert(memory.init?.kind === 'name' || memory.capacity, memory, '状态机需要显式初始枚举值');
      memory.machine_initial = memory.init?.name ?? ctx.types.get(memory.type).values[0];
    }
  }
  for (const ctx of contexts.values()) analyze(ctx);
  for (const ctx of contexts.values()) {
    const visiting = new Set(), done = new Map();
    const summarize = (fn, depth = 0) => {
      if (done.has(fn.name)) return done.get(fn.name);
      assert(!visiting.has(fn.name) && depth < LIMITS.call_depth, fn, '调用图包含递归或超过深度上限'); visiting.add(fn.name);
      const effects = new Set(); let cost = 1, callDepth = 1;
      for (const node of walk(fn.body)) {
        cost++; if (['memory_write'].includes(node.effect) || node.kind === 'call' && ['transition', 'publish', 'trade_intent', 'native_dispatch'].includes(node.effect)) effects.add(node.effect);
        if (node.kind === 'call' && node.target) {
          const child = summarize(ctx.functions.get(node.name), depth + 1); cost += child.cost; callDepth = Math.max(callDepth, child.callDepth + 1); child.effects.forEach(effect => effects.add(effect));
          assert(node.effect_allowed || child.effects.size === 0, node, '有副作用的辅助函数只能作为独立动作，不能藏在公式中');
        }
        if (node.kind === 'call' && ['trade_intent', 'native_dispatch'].includes(node.effect)) assert(node.effect_allowed, node, '平台动作不能藏在公式或参数中');
      }
      const expressionSteps = expression => !expression ? 0 : [...walk(expression)].reduce((sum, child) => sum + 1 + (child.kind === 'call' && child.target ? done.get(child.name)?.cost ?? 0 : 0), 0);
      const steps = block => {
        if (block.kind === 'block') return block.body.reduce((sum, child) => sum + steps(child), 1);
        if (block.kind === 'for') return 1 + expressionSteps(block.start) + (block.iterations + 1) * expressionSteps(block.condition) + block.iterations * (steps(block.body) + 1);
        if (block.kind === 'if') return 1 + expressionSteps(block.condition) + Math.max(steps(block.yes), block.no ? steps(block.no) : 0);
        if (block.kind === 'switch') return 1 + expressionSteps(block.value) + Math.max(0, ...block.cases.map(c => steps(c.body)));
        return expressionSteps(block);
      };
      cost = steps(fn.body); assert(cost <= LIMITS.event_steps, fn, '单个函数静态最坏步数超过预算');
      assert(callDepth <= LIMITS.call_depth, fn, '函数调用链超过深度预算');
      assert(!QUERIES.has(fn.name) || effects.size === 0, fn, `${fn.name} 是查询接口，不能修改记忆、发布或交易`);
      fn.effects = [...effects]; fn.max_steps = cost; visiting.delete(fn.name); const result = { effects, cost, callDepth }; done.set(fn.name, result); return result;
    };
    for (const fn of ctx.functions.values()) summarize(fn);
    const transitions = new Set(); for (const node of walk(ctx.program)) if (node.kind === 'call' && node.name === 'Transition') {
      const key = `${node.machine}.${node.args[2].value}`; assert(!transitions.has(key), node, '同一机器的转移 ID 重复'); transitions.add(key);
      for (const guard of node.guards) {
        const condition = [...walk(ctx.program)].find(n => n.id === guard.node);
        for (const part of walk(condition)) if (part.kind === 'call') assert(!['trade_intent', 'native_dispatch'].includes(part.effect) && (!part.target || done.get(part.name).effects.size === 0), part, '状态转移的守卫必须无副作用');
      }
    }
    const bytes = type => { const record = ctx.types.get(type); return record?.fields ? record.fields.reduce((n, f) => n + bytes(f.type) * (f.capacity ?? 1), 0) : type === 'string' ? 1024 : 8; };
    const memory = ctx.program.declarations.filter(d => d.kind === 'variable').reduce((n, d) => n + bytes(d.type) * (d.capacity ?? 1), 0);
    assert(memory <= LIMITS.memory_bytes, ctx.program.declarations[0], '模块记忆超过预算');
    for (const fn of ctx.functions.values()) {
      const frame = [...fn.parameters, ...[...walk(fn.body)].filter(n => n.kind === 'variable')].reduce((n,d) => n + bytes(d.type) * (d.capacity ?? 1), 0);
      assert(frame <= LIMITS.memory_bytes / LIMITS.call_depth, fn, '函数局部存储超过调用栈预算');
    }
  }
  return { contexts, ports };
}
