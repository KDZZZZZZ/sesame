// This catalogue is shared by validation, generation and the inspectable graph.
// Platform adapters are explicit boundaries; user functions are always expanded.
export const HOOKS = {
  signal: { Configure: ['bool'], Advance: ['void'], ConsumeSignal: ['void'], LongCondition: ['int'], ShortCondition: ['int'], StopLossPoints: ['double'], TakeProfitPoints: ['double'], CloseLong: ['bool'], CloseShort: ['bool'] },
  money: { Configure: ['bool'], Lots: ['double', 'double', 'double', 'bool'] },
  position: { Configure: ['bool'], Refresh: ['void'], OnTransaction: ['void'], Manage: ['bool'] },
  trailing: { Configure: ['bool'], StopLoss: ['double', 'bool', 'double', 'double'], TakeProfit: ['double', 'bool', 'double', 'double'] },
  risk: { Configure: ['bool'], Refresh: ['void'], OnTransaction: ['void'], AllowNewRisk: ['bool'] },
  expert: { Configure: ['bool'], Observe: ['void'], Processing: ['bool'] },
};
export const QUERIES = new Set(['Configure', 'LongCondition', 'ShortCondition', 'StopLossPoints', 'TakeProfitPoints', 'CloseLong', 'CloseShort', 'Lots', 'StopLoss', 'TakeProfit', 'AllowNewRisk']);
export const ADAPTERS = {};
const add = (names, returns, args, effect = 'snapshot', modules = null) => { for (const name of names.split(' ')) ADAPTERS[name] = { returns, args, effect, modules }; };
add('MathAbs MathSqrt MathFloor MathCeil MathRound MathExp MathLog MathSin MathCos', 'double', ['double'], 'pure');
add('MathMin MathMax MathPow', 'double', ['double', 'double'], 'pure');
add('ToInt', 'int', ['double'], 'pure');
add('Bars PositionCount', 'int', []);
add('Open High Low Close Volume', 'double', ['int']);
add('BarTime', 'long', ['int']);
add('Bid Ask Point TickSize TickValueLoss TickValueProfit Equity Balance FreeMargin LotMin LotMax LotStep', 'double', []);
add('Time TransactionOrder TransactionDeal TransactionPosition', 'long', []);
add('TransactionType', 'int', []);
add('TransactionVolume TransactionPrice', 'double', []);
add('PositionVolume PositionPrice PositionSL PositionTP', 'double', ['int']);
add('PositionTicket', 'long', ['int']);
add('PositionIsBuy', 'bool', ['int']);
add('NativeProcessing NativeOpen NativeReverse NativeClose NativeTrail', 'bool', [], 'native_dispatch', ['expert']);
add('ClosePosition', 'bool', ['int', 'double'], 'trade_intent', ['position', 'risk']);
add('ProtectPosition', 'bool', ['int', 'double', 'double'], 'trade_intent', ['position', 'risk']);

export const LIMITS = Object.freeze({ array_capacity: 512, loop_iterations: 512, module_tokens: 50000, ir_nodes: 12000, event_steps: 200000, call_depth: 32, memory_bytes: 1024 * 1024, snapshot_bars: 512, snapshot_positions: 64 });
