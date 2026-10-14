import { Decimal } from '@sesame/plugin-sdk/decimal';
import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { check, payload } from './adapters.js';
import { createService } from './service.js';
import { cleanError } from './plans.js';

const dec = value => { const text = String(value); check(/^(0|[1-9]\d*)(\.\d+)?$/.test(text), 'SOURCE_DATA_INVALID', 'Native quantity is not a nonnegative decimal'); return text; };
const min = (a, b) => Decimal.compare(a, b) <= 0 ? a : b;
const positive = value => Decimal.compare(value, '0') > 0;
const workingOrders = (backend, symbol, orders = []) => orders.some(order => (order.symbol ?? order.stock_code) === symbol &&
  (backend === 'mt5' || !['53', '54', '56', '57'].includes(String(order.order_status))));

// Plan absolute quantities from the actual account snapshot, including positions
// opened by other strategies. Explicit zero closes both legs of a hedged symbol.
export function targetOrders(backend, target, positions) {
  if (backend === 'qmt') {
    const held = positions.filter(row => row.stock_code === target.symbol);
    const current = held.reduce((sum, row) => Decimal.add(sum, dec(row.volume)), '0');
    const delta = Decimal.sub(target.quantity, current);
    if (Decimal.compare(delta, '0') === 0) return [];
    const side = Decimal.compare(delta, '0') > 0 ? 'buy' : 'sell', quantity = Decimal.abs(delta);
    if (side === 'sell') check(Decimal.compare(quantity, held.reduce((sum, row) => Decimal.add(sum, dec(row.can_use_volume)), '0')) <= 0, 'POSITION_UNAVAILABLE', 'QMT reduction exceeds currently sellable shares (including T+1 restrictions)');
    return [{ action: 'limit', side, quantity }];
  }
  const held = positions.filter(row => row.symbol === target.symbol).sort((a, b) => String(a.ticket).localeCompare(String(b.ticket)));
  check(held.every(row => /^[1-9]\d*$/.test(String(row.ticket)) && [0, 1].includes(Number(row.type))), 'SOURCE_DATA_INVALID', 'MT5 position requires a native ticket and side');
  const desired = Decimal.abs(target.quantity), side = Decimal.compare(target.quantity, '0') < 0 ? 'sell' : 'buy';
  const matching = held.filter(row => (Number(row.type) === 0 ? 'buy' : 'sell') === side), opposing = held.filter(row => !matching.includes(row));
  const close = (row, quantity = dec(row.volume)) => ({ action: 'close', side: Number(row.type) === 0 ? 'sell' : 'buy', quantity, position_id: String(row.ticket) });
  const orders = opposing.map(row => close(row));
  let excess = Decimal.sub(matching.reduce((sum, row) => Decimal.add(sum, dec(row.volume)), '0'), desired);
  for (const row of matching) if (positive(excess)) { const quantity = min(excess, dec(row.volume)); orders.push(close(row, quantity)); excess = Decimal.sub(excess, quantity); }
  if (Decimal.compare(excess, '0') < 0) orders.push({ action: 'market', side, quantity: Decimal.abs(excess) });
  return orders;
}

function priceLimit(observation, side, bps) {
  const quote = side === 'buy' ? observation.quote.ask : observation.quote.bid;
  const factor = Decimal.div(String(10000 + (side === 'buy' ? bps : -bps)), '10000');
  const tick = observation.backend === 'qmt' ? '0.01' : String(observation.spec.trade_tick_size || observation.spec.point);
  check(positive(dec(tick)), 'SOURCE_DATA_INVALID', 'Executable price tick unavailable');
  return Decimal.quantize(Decimal.mul(quote, factor), tick, side === 'buy' ? 'ceil' : 'floor');
}

export async function applyPortfolio(host, run, { now = Date.now, signal, assertActive, authorizeRequest = (_name, args) => args, checkpoint = () => {}, service } = {}) {
  const plan = run.plan, execution = { startedAt: now(), status: 'checking', pauses: [], orders: [], after: null, targetReached: null };
  const persist = () => checkpoint({ executionProgress: structuredClone(execution) });
  const call = async (name, args) => payload(await host.tools.call({ pluginId: `sesame/${plan.backend}`, name, arguments: args }, signal));
  const trader = service ?? createService(host, { now, authorize: assertActive, authorizeRequest, ownerConversationId: plan.ownerConversationId });
  try {
    assertActive();
    check(Number.isSafeInteger(run.decidedAt) && now() - run.decidedAt >= 0 && now() - run.decidedAt <= 300000, 'DECISION_EXPIRED', 'Saved target is over five minutes old; obtain a new decision');
    const before = await call(`${plan.backend}_trading_context`, { action: 'snapshot', history_days: 1 });
    check(canonical(before.account) === canonical(plan.account), 'ACCOUNT_CHANGED', 'Execution account differs from frozen plan');
    execution.before = before; persist();
    for (const pause of run.decision.pause_strategies) {
      assertActive(); check(plan.backend === 'mt5', 'UNSUPPORTED_CAPABILITY', 'This backend has no mounted-strategy stop implementation');
      const result = await call('mt5_trading_pause', authorizeRequest('mt5_trading_pause', { deployment_id: pause.deployment_id, account: plan.account, reason: pause.reason }));
      execution.pauses.push(result); persist();
      check(result.status === 'stopped' || result.deployment?.status === 'stopped', 'PAUSE_UNCONFIRMED', 'EA stop is not confirmed; do not proceed with competing orders');
    }
    for (const target of run.decision.targets) {
      assertActive();
      // Pending broker orders can change the target after this run. Do not place
      // a competing replacement while their eventual fills remain outstanding.
      check(!workingOrders(plan.backend, target.symbol, before.orders), 'WORKING_ORDERS', 'Symbol has outstanding orders; reconcile or cancel them before applying a new target');
      let observation = await trader.observe({ backend: plan.backend, symbol: target.symbol }, signal);
      const orders = targetOrders(plan.backend, target, observation.positions);
      for (let index = 0; index < orders.length; index++) {
        assertActive(); if (index > 0) observation = await trader.observe({ backend: plan.backend, symbol: target.symbol }, signal);
        check(now() - run.decidedAt <= 300000, 'DECISION_EXPIRED', 'Target expired during execution');
        check(canonical(observation.account) === canonical(plan.account), 'ACCOUNT_CHANGED', 'Account changed before target order');
        check(!workingOrders(plan.backend, target.symbol, observation.orders), 'WORKING_ORDERS', 'New outstanding orders appeared after the account snapshot; stop and reconcile');
        const order = orders[index];
        if (index > 0) check(canonical(targetOrders(plan.backend, target, observation.positions)[0] ?? null) === canonical(order), 'POSITION_CHANGED', 'Positions changed beyond confirmed prior orders; stop instead of applying an old delta');
        if (order.position_id) {
          const position = observation.positions.find(row => String(row.ticket) === order.position_id);
          check(position && Decimal.compare(dec(position.volume), order.quantity) >= 0 && Number(position.type) === (order.side === 'sell' ? 0 : 1), 'POSITION_CHANGED', 'Position changed during target application; stop and reassess');
        }
        const limit = priceLimit(observation, order.side, plan.slippageBps);
        const operationId = `target_${digest([run.id, target.symbol, index]).slice(7, 47)}`;
        const receipt = await trader.execute({ ...order, operation_id: operationId, observation_id: observation.observation_id, user_authorized: true, timeframe: '5m', price_limit: limit,
          ...(order.action === 'limit' ? { limit_price: limit } : {}) }, signal);
        execution.orders.push({ symbol: target.symbol, target: target.quantity, operationId, receipt }); persist();
        check(['execution_reported', 'execution_observed'].includes(receipt.status), 'EXECUTION_INCOMPLETE', 'Order is not fully confirmed; stop this target batch and inspect receipts before any new decision');
      }
    }
    assertActive();
    const after = await call(`${plan.backend}_trading_context`, { action: 'snapshot', history_days: 1 });
    check(canonical(after.account) === canonical(plan.account), 'ACCOUNT_CHANGED', 'Account changed during reconciliation');
    execution.after = after;
    execution.targetReached = run.decision.unchanged ? null : run.decision.targets.every(target => targetOrders(plan.backend, target, after.positions).length === 0);
    execution.status = run.decision.unchanged ? 'unchanged' : execution.targetReached ? 'target_observed' : 'reconciliation_required';
  } catch (error) { execution.status = 'blocked'; execution.error = cleanError(error); }
  execution.completedAt = now(); persist(); return execution;
}
