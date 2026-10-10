import { parse, invalid, LANGUAGE, MODULES, filename } from './parse.js';
import { check } from './check.js';
import { generate } from './generate.js';
import platform from '../template/observability/rules.json' with { type: 'json' };

export const VISUAL_TEMPLATE_VERSION = '3.0.0';
export const ENTRY = `#property strict
#property version "3.00"
#include <Product/VisualStrategy.mqh>
#include <Product/Results.mqh>
CStrategySignal *Signal;
int OnInit() {
 if(!MQLInfoInteger(MQL_TESTER)) return INIT_FAILED;
 if(!ProductTraceOpen()) return INIT_FAILED;
 V_Begin("init",InpMagic);
 if(!Expert.Init(_Symbol,_Period,true,InpMagic)) return INIT_FAILED;
 Signal=new CStrategySignal;
 if(!Expert.InitSignal(Signal)) return INIT_FAILED;
 CStrategyMoney *money=new CStrategyMoney; if(!Expert.InitMoney(money)) return INIT_FAILED;
 CStrategyTrailing *trailing=new CStrategyTrailing; if(!Expert.InitTrailing(trailing)) return INIT_FAILED;
 if(!Signal.Configure() || !money.Configure() || !trailing.Configure() || !Expert.Configure() || V_Fault) return INIT_PARAMETERS_INCORRECT;
 if(!Expert.ValidationSettings() || !Expert.InitIndicators()) return INIT_FAILED;
 EventSetTimer(1); return INIT_SUCCEEDED;
}
void OnTick() {
 if(ProductTestCanceled()) return;
 V_Begin("tick",InpMagic); ProductEquity(); Expert.Observe(); Signal.Advance(); Expert.OnTick(); Signal.ConsumeSignal();
}
void OnTimer() { if(!ProductTestCanceled()) { V_Begin("timer",InpMagic); Expert.Observe(); } }
void OnTrade() { V_Begin("trade",InpMagic); Expert.Observe(); }
void OnTradeTransaction(const MqlTradeTransaction &tx,const MqlTradeRequest &request,const MqlTradeResult &result) {
 V_Transaction=tx; V_Begin("transaction",InpMagic); ProductTransaction(tx,request,result); Expert.OnTransaction(tx,request,result);
}
double OnTester() { return ProductTesterResult(); }
void OnDeinit(const int reason) { EventKillTimer(); Expert.Deinit(); Signal=NULL; ProductTraceClose(); }
`;

const defaults = {
  signal: 'void Advance() {}\nvoid ConsumeSignal() {}\nint LongCondition() { return 0; }\nint ShortCondition() { return 0; }\ndouble StopLossPoints() { return 0.0; }\ndouble TakeProfitPoints() { return 0.0; }\nbool CloseLong() { return false; }\nbool CloseShort() { return false; }',
  money: 'double Lots(double price,double sl,bool buy) { return 0.0; }',
  position: 'void Refresh() {}\nvoid OnTransaction() {}\nbool Manage() { return false; }',
  trailing: 'double StopLoss(bool buy,double price,double current) { return 0.0; }\ndouble TakeProfit(bool buy,double price,double current) { return 0.0; }',
  risk: 'void Refresh() {}\nvoid OnTransaction() {}\nbool AllowNewRisk() { return false; }',
  expert: 'void Observe() {}\nbool Processing() { return NativeProcessing(); }',
};
export function visualTemplate() {
  return {
    'Experts/Strategy.mq5': ENTRY,
    'strategy.json': JSON.stringify({ template_version: VISUAL_TEMPLATE_VERSION, language: LANGUAGE, modules: Object.fromEntries(MODULES.map(key => [key, { mode: 'unimplemented', description: '' }])) }, null, 2),
    ...Object.fromEntries(MODULES.map(key => [filename(key), `// ${key}: checked module source. Platform generates the native class shell.\nbool Configure() { return false; }\n${defaults[key]}\n`])),
    'inputs/default.set': '',
    'README.md': `# Strict native strategy\n\nLanguage: ${LANGUAGE}. Template: ${VISUAL_TEMPLATE_VERSION}.\n\nThis is an empty, non-executable strategy. Read the sesame/mt5 visual-state-machines skill and its language reference before editing.\n\nEdit the six Include/Strategy/*.mqh files using the closed MQL5 module grammar, and describe each module in strategy.json. Source functions are compiled into fixed native CExpertSignal/CExpertMoney/CExpertTrailing/CProductExpert classes. Position and Risk are product modules. Do not add includes, macros, classes, alternative EA entries or hand-written graph JSON.\n\nUse typed scalar/enum/record memory, bounded arrays, functions, if/else, switch and constant-bounded for loops. Use Transition inside an explicit switch case on owned enum memory. Publish/Read/HasOutput are typed module ports. Unregistered calls are rejected. Input names exposed to Tester are Module_Name, e.g. Signal_Lookback.\n\nDefault Configure returns false. Complete actual functions and change module modes before testing. Save validates and generates IR/graphs; compile revalidates the frozen revision and builds generated MQL5 with MetaEditor. Diagnostic errors are recoverable. New code and graph always share a revision and digest.\n\nCurrent native data boundary: chart symbol/timeframe, 512 bars (index 0 is forming), account snapshot and at most 64 positions of this symbol/magic. External symbols, unknown EX5 and file/network access are unavailable. Reads outside available data latch a runtime fault; check Bars/PositionCount/HasOutput first.\n`,
  };
}

export function compileVisual(files) {
  const location = { file: 'strategy.json', line: 1, column: 1 };
  const contract = JSON.parse(files['strategy.json']);
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  if (!object(contract) || contract.language !== LANGUAGE || contract.template_version !== VISUAL_TEMPLATE_VERSION || Object.keys(contract).some(k => !['template_version', 'language', 'modules'].includes(k))) invalid(location, '严格工程必须使用 visual-mql-v1 和模板 3.0.0');
  if (!object(contract.modules) || Object.keys(contract.modules).length !== MODULES.length || MODULES.some(k => !object(contract.modules[k]))) invalid(location, '严格工程必须声明六个模块');
  const allowed = new Set(['Experts/Strategy.mq5', 'strategy.json', 'inputs/default.set', 'README.md', ...MODULES.map(filename)]);
  for (const path of Object.keys(files)) if (!allowed.has(path)) invalid({ ...location, file: path }, '严格工程不接受额外源码、手写规则或生成物；辅助函数和类型写在所属模块中');
  if (files['Experts/Strategy.mq5'] !== ENTRY) invalid({ ...location, file: 'Experts/Strategy.mq5' }, '严格 EA 入口由平台固定');
  const programs = MODULES.map(module => {
    const file = filename(module); if (typeof files[file] !== 'string') invalid({ ...location, file }, '缺少模块源码');
    return { ...parse(files[file], file, module), text: files[file] };
  });
  const checked = check(programs), result = generate(programs, checked);
  const rules = { ...result.rules, nodes: [...platform.nodes.filter(n => n.id.startsWith('platform.')), ...result.rules.nodes] };
  const modules = {};
  for (const module of MODULES) {
    const value = contract.modules[module];
    if (Object.keys(value).some(k => !['mode', 'description'].includes(k)) || !['unimplemented', 'custom', 'native'].includes(value.mode) || typeof value.description !== 'string' || value.description.length > 2000 || value.mode !== 'unimplemented' && !value.description.trim()) invalid(location, `${module} 仅接受 mode 和 description；节点归属自动生成。停用行为请显式编写无动作实现并说明。`);
    modules[module] = { ...value, node_ids: result.rules.nodes.filter(n => n.id.startsWith(`${module}.`)).map(n => n.id), state_machine_ids: result.rules.state_machines.filter(m => m.id.startsWith(`${module}.`)).map(m => m.id) };
  }
  return { ...result, rules, strategy_contract: { template_version: VISUAL_TEMPLATE_VERSION, language: LANGUAGE, modules } };
}
