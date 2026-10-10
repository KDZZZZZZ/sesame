import { ApiError } from '../support.js';

export const LANGUAGE = 'visual-mql-v1';
export const COMPILER = '1.0.0';
export const MODULES = ['signal', 'money', 'position', 'trailing', 'risk', 'expert'];
export const filename = module => `Include/Strategy/${module[0].toUpperCase() + module.slice(1)}.mqh`;
export function invalid(at, message, code = 'visual_mql_invalid') {
  throw new ApiError(422, code, JSON.stringify({ code, recoverable: true, message,
    diagnostics: [{ file: at.file, line: at.line, column: at.column, message }],
    next_step: '修改当前 checkout 中对应源码，save 新 revision 后重新编译。不要修改生成物或重复提交未修改的代码。' }));
}

// A closed grammar, not a blacklist or best-effort C++ AST. Every token must be
// consumed; unknown syntax never becomes an opaque executable node.
function tokenize(source, file) {
  const out = []; let offset = 0, line = 1, column = 1;
  const consume = text => { for (const c of text) { if (c === '\n') { line++; column = 1; } else column++; } offset += text.length; };
  while (offset < source.length) {
    const rest = source.slice(offset), at = { file, line, column, offset };
    const whitespace = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(rest);
    if (whitespace) { consume(whitespace[0]); continue; }
    const match = /^(?:"(?:[^"\\\r\n]|\\["\\nrt])*"|[A-Za-z][A-Za-z0-9_]*|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?|==|!=|<=|>=|&&|\|\||\+\+|--|\+=|-=|\*=|\/=|[{}()[\];,:?.+*/%<>=!\-])/.exec(rest);
    if (!match) invalid(at, '不支持此语法。预处理、include、class、指针、引用、宏和宿主接口不属于严格模块语法。');
    const value = match[0], kind = value[0] === '"' ? 'string' : /^[A-Za-z]/.test(value) ? 'id' : /^[\d.]/.test(value) && value !== '.' ? 'number' : 'punct';
    out.push({ value, kind, ...at, end: offset + value.length }); consume(value);
    if (out.length > 50000) invalid(at, '单个模块超过 50000 个语法 token。');
  }
  out.push({ value: '<eof>', kind: 'eof', file, line, column, offset, end: offset }); return out;
}

const precedence = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
const primitive = new Set(['void', 'bool', 'int', 'long', 'double', 'string']);
export function parse(source, file, module) {
  const tokens = tokenize(source, file); let pos = 0, serial = 0, depth = 0;
  const types = new Set(primitive), peek = () => tokens[pos], take = () => tokens[pos++];
  const is = value => peek().value === value;
  const eat = value => is(value) ? take() : null;
  const expect = value => { if (!is(value)) invalid(peek(), `需要 ${value}，实际为 ${peek().value}`); return take(); };
  const ident = () => { const t = take(); if (t.kind !== 'id' || primitive.has(t.value) || /^(?:V_|Product_|OnInit$|OnTick$|OnTimer$|OnTrade$|OnDeinit$)/.test(t.value)) invalid(t, '名称无效或属于平台保留范围'); return t.value; };
  const node = (kind, at, fields = {}) => ({ id: `${module}.n${++serial}`, kind, source: { file, line: at.line, column: at.column, start: at.offset, end: tokens[Math.max(0, pos - 1)].end }, ...fields });
  const type = () => { const t = take(); if (!types.has(t.value)) invalid(t, `未知类型 ${t.value}`); return t.value; };
  const size = () => { if (!eat('[')) return null; const n = take(); if (n.kind !== 'number' || !/^\d+$/.test(n.value) || +n.value < 1 || +n.value > 512) invalid(n, '数组容量必须为 1–512 的整数常量'); expect(']'); return +n.value; };
  function expr(min = 0) {
    if (++depth > 80) invalid(peek(), '表达式嵌套超过 80 层');
    const at = peek(); let value;
    if (eat('(')) { value = expr(); expect(')'); }
    else if (['!', '-', '+'].includes(peek().value)) { const op = take().value; value = node('unary', at, { op, value: expr(7) }); }
    else if (peek().kind === 'number') { const raw = take().value; if (!Number.isFinite(+raw) || !/[.eE]/.test(raw) && !Number.isSafeInteger(+raw)) invalid(at, '数值常量超出支持范围'); value = node('literal', at, { value: +raw, type: /[.eE]/.test(raw) ? 'double' : +raw > 2147483647 ? 'long' : 'int', raw }); }
    else if (peek().kind === 'string') { value = node('literal', at, { value: JSON.parse(take().value), type: 'string' }); }
    else if (is('true') || is('false')) { value = node('literal', at, { value: take().value === 'true', type: 'bool' }); }
    else { value = node('name', at, { name: ident() }); }
    for (;;) {
      if (eat('(')) {
        if (value.kind !== 'name') invalid(at, '调用目标必须是静态函数名');
        const args = []; if (!is(')')) { do { args.push(expr()); } while (eat(',')); } expect(')');
        value = node('call', at, { name: value.name, args });
      } else if (eat('[')) { const index = expr(); expect(']'); value = node('index', at, { object: value, index }); }
      else if (eat('.')) value = node('field', at, { object: value, field: ident() });
      else break;
    }
    while (precedence[peek().value] >= min) { const op = take().value; value = node('binary', at, { op, left: value, right: expr(precedence[op] + 1) }); }
    if (min === 0 && eat('?')) { const yes = expr(); expect(':'); value = node('select', at, { condition: value, yes, no: expr() }); }
    depth--; return value;
  }
  function declaration() {
    const at = peek(), qualifier = ['input', 'const'].includes(peek().value) ? take().value : 'memory';
    const valueType = type(), name = ident(), capacity = size(); let init = null;
    if (eat('=')) init = expr(); expect(';');
    return node('variable', at, { name, type: valueType, capacity, qualifier, init });
  }
  function block() {
    if (++depth > 80) invalid(peek(), '控制流嵌套超过 80 层');
    const at = expect('{'), body = []; while (!is('}')) { if (is('<eof>')) invalid(peek(), '代码块未结束'); body.push(statement()); } expect('}'); depth--; return node('block', at, { body });
  }
  function statement() {
    const at = peek();
    if (is('{')) return block();
    if (eat('if')) { expect('('); const condition = expr(); expect(')'); const yes = block(), no = eat('else') ? is('if') ? statement() : block() : null; return node('if', at, { condition, yes, no }); }
    if (eat('for')) {
      expect('('); expect('int'); const index = ident(); expect('='); const start = expr(); expect(';');
      const condition = expr(); expect(';'); const increment = ident(); expect('++'); expect(')');
      return node('for', at, { index, start, condition, increment, body: block() });
    }
    if (eat('switch')) {
      expect('('); const value = expr(); expect(')'); expect('{'); const cases = [];
      while (!is('}')) { const c = peek(); let label; if (eat('case')) label = expr(); else { expect('default'); label = null; } expect(':'); const body = block(); cases.push(node('case', c, { label, body })); }
      expect('}'); return node('switch', at, { value, cases });
    }
    if (eat('return')) { const value = is(';') ? null : expr(); expect(';'); return node('return', at, { value }); }
    if (is('break') || is('continue')) { const kind = take().value; expect(';'); return node(kind, at); }
    if (types.has(peek().value) || is('const')) return declaration();
    const target = expr();
    if (['=', '+=', '-=', '*=', '/='].includes(peek().value)) { const op = take().value, value = expr(); expect(';'); return node('assign', at, { target, op, value }); }
    if (is('++') || is('--')) { const op = take().value; expect(';'); return node('assign', at, { target, op: op === '++' ? '+=' : '-=', value: node('literal', at, { value: 1, type: 'int', raw: '1' }) }); }
    expect(';'); if (target.kind !== 'call') invalid(at, '只允许赋值或显式函数调用语句'); return node('expression', at, { value: target });
  }
  const declarations = [];
  while (!is('<eof>')) {
    const at = peek();
    if (eat('enum')) {
      const name = ident(); if (types.has(name)) invalid(at, '类型重名'); types.add(name); expect('{'); const values = [];
      do { values.push(ident()); } while (eat(',') && !is('}')); expect('}'); expect(';');
      declarations.push(node('enum', at, { name, values }));
    } else if (eat('struct')) {
      const name = ident(); if (types.has(name)) invalid(at, '类型重名'); expect('{'); const fields = [];
      while (!is('}')) fields.push(declaration()); expect('}'); expect(';'); types.add(name);
      declarations.push(node('struct', at, { name, fields }));
    } else {
      const saved = pos, returnType = ['input', 'const'].includes(peek().value) ? null : type();
      const name = returnType ? ident() : null;
      if (returnType && eat('(')) {
        const parameters = []; if (!is(')')) do { const t = peek(), valueType = type(), parameter = ident(); parameters.push(node('parameter', t, { name: parameter, type: valueType })); } while (eat(','));
        expect(')'); const body = block(); declarations.push(node('function', at, { name, type: returnType, parameters, body }));
      } else { pos = saved; declarations.push(declaration()); }
    }
  }
  return { module, file, declarations };
}
