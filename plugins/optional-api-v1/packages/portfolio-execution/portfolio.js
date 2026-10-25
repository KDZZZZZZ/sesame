import { Decimal } from '@sesame/plugin-sdk/decimal';
import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { check } from './adapters.js';
import { invoke } from './calls.js';
import { createService } from './service.js';
import { adapterOperation, adapterResult } from './adapter-contract.js';
const cleanError = error => ({ code: error?.code ?? 'EXECUTION_FAILED', message: String(error?.message ?? error).slice(0, 1000) });

const dec = value => { const text = String(value); check(/^(0|[1-9]\d*)(\.\d+)?$/.test(text), 'SOURCE_DATA_INVALID', 'Native quantity is not a nonnegative decimal'); return text; };
const min = (a, b) => Decimal.compare(a, b) <= 0 ? a : b;
const positive = value => Decimal.compare(value, '0') > 0;
const workingOrders = (_backend, symbol, orders) => {
  check(Array.isArray(orders), 'SOURCE_DATA_INVALID', 'Execution projection must include outstanding orders');
  return orders.some(order => order.symbol === symbol && order.working !== false);
};

// Business sizing uses the declared native projection, never SDK fields/enums.
// Include positions opened by other strategies; zero closes both hedged legs.
export function targetOrders(backend, target, positions) {
  check(Array.isArray(positions), 'SOURCE_DATA_INVALID', 'Execution projection must include positions');
  const held = positions.filter(row => row.symbol === target.symbol).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  check(held.every(row => typeof row.id === 'string' && row.id.length > 0 && ['buy', 'sell'].includes(row.side)), 'SOURCE_DATA_INVALID', 'Position projection requires an exact identity and side');
  if (backend === 'qmt') {
    check(held.every(row => row.side === 'buy'), 'SOURCE_DATA_INVALID', 'STOCK holdings must be long shares');
    const current = held.reduce((sum, row) => Decimal.add(sum, dec(row.quantity)), '0');
    const delta = Decimal.sub(target.quantity, current);
    if (Decimal.compare(delta, '0') === 0) return [];
    const side = Decimal.compare(delta, '0') > 0 ? 'buy' : 'sell', quantity = Decimal.abs(delta);
    if (side === 'sell') check(Decimal.compare(quantity, held.reduce((sum, row) => Decimal.add(sum, dec(row.availableQuantity)), '0')) <= 0, 'POSITION_UNAVAILABLE', 'QMT reduction exceeds currently sellable shares (including T+1 restrictions)');
    return [{ action: 'limit', side, quantity }];
  }
  const desired = Decimal.abs(target.quantity), side = Decimal.compare(target.quantity, '0') < 0 ? 'sell' : 'buy';
  const matching = held.filter(row => row.side === side), opposing = held.filter(row => row.side !== side);
  const close = (row, quantity = dec(row.quantity)) => ({ action: 'close', side: row.side === 'buy' ? 'sell' : 'buy', quantity, position_id: row.id });
  const orders = opposing.map(row => close(row));
  let excess = Decimal.sub(matching.reduce((sum, row) => Decimal.add(sum, dec(row.quantity)), '0'), desired);
  for (const row of matching) if (positive(excess)) { const quantity = min(excess, dec(row.quantity)); orders.push(close(row, quantity)); excess = Decimal.sub(excess, quantity); }
  if (Decimal.compare(excess, '0') < 0) orders.push({ action: 'market', side, quantity: Decimal.abs(excess) });
  return orders;
}

function priceLimit(observation, side, bps) {
  const quote = side === 'buy' ? observation.quote.ask : observation.quote.bid;
  const factor = Decimal.div(String(10000 + (side === 'buy' ? bps : -bps)), '10000');
  const tick = observation.projection?.priceStep;
  check(positive(dec(tick)), 'SOURCE_DATA_INVALID', 'Executable price tick unavailable');
  return Decimal.quantize(Decimal.mul(quote, factor), tick, side === 'buy' ? 'ceil' : 'floor');
}

export async function applyPortfolio(host, run, { now = Date.now, signal, assertActive, authorizeRequest = (_name, args) => args, checkpoint = () => {}, service } = {}) {
  const plan = run.plan, execution = { startedAt: now(), status: 'checking', pauses: [], orders: [], after: null, targetReached: null };
  const persist = () => checkpoint({ executionProgress: structuredClone(execution) });
  const call = (name, args) => invoke(host, `sesame/${plan.backend}`, name, args, signal);
  const snapshot = async () => {
    const selected = await adapterOperation(host, plan.backend, 'snapshot', { delegated: true });
    return adapterResult(await invoke(host, selected.pluginId, selected.id, { history_days: 1 }, signal), plan.backend);
  };
  const trader = service ?? createService(host, { now, authorize: assertActive, authorizeRequest, ownerConversationId: plan.ownerConversationId });
  try {
    assertActive();
    check(Number.isSafeInteger(run.decidedAt) && now() - run.decidedAt >= 0 && now() - run.decidedAt <= 300000, 'DECISION_EXPIRED', 'Saved target is over five minutes old; obtain a new decision');
    const before = await snapshot();
    check(canonical(before.account) === canonical(plan.account), 'ACCOUNT_CHANGED', 'Execution account differs from frozen plan');
    execution.before = before; persist();
    for (const pause of run.decision.pause_strategies) {
      assertActive(); check(plan.backend === 'mt5', 'UNSUPPORTED_CAPABILITY', 'This backend has no mounted-strategy stop implementation');
      const pendingPause = { deployment_id: pause.deployment_id, reason: pause.reason, status: 'preparing' };
      execution.pauses.push(pendingPause); persist();
      const result = await call('mt5_trading_pause', authorizeRequest('mt5_trading_pause', { deployment_id: pause.deployment_id, account: plan.account, reason: pause.reason }));
      Object.assign(pendingPause, result); persist();
      check(result.status === 'stopped' || result.deployment?.status === 'stopped', 'PAUSE_UNCONFIRMED', 'EA stop is not confirmed; do not proceed with competing orders');
    }
    for (const target of run.decision.targets) {
      assertActive();
      // Pending broker orders can change the target after this run. Do not place
      // a competing replacement while their eventual fills remain outstanding.
      check(!workingOrders(plan.backend, target.symbol, before.projection?.orders), 'WORKING_ORDERS', 'Symbol has outstanding orders; reconcile or cancel them before applying a new target');
      let observation = await trader.observe({ backend: plan.backend, symbol: target.symbol }, signal);
      const orders = targetOrders(plan.backend, target, observation.projection?.positions);
      for (let index = 0; index < orders.length; index++) {
        assertActive(); if (index > 0) observation = await trader.observe({ backend: plan.backend, symbol: target.symbol }, signal);
        check(now() - run.decidedAt <= 300000, 'DECISION_EXPIRED', 'Target expired during execution');
        check(canonical(observation.account) === canonical(plan.account), 'ACCOUNT_CHANGED', 'Account changed before target order');
        check(!workingOrders(plan.backend, target.symbol, observation.projection?.orders), 'WORKING_ORDERS', 'New outstanding orders appeared after the account snapshot; stop and reconcile');
        const order = orders[index];
        if (index > 0) check(canonical(targetOrders(plan.backend, target, observation.projection?.positions)[0] ?? null) === canonical(order), 'POSITION_CHANGED', 'Positions changed beyond confirmed prior orders; stop instead of applying an old delta');
        if (order.position_id) {
          const position = observation.projection.positions.find(row => row.id === order.position_id);
          check(position && Decimal.compare(dec(position.quantity), order.quantity) >= 0 && position.side === (order.side === 'sell' ? 'buy' : 'sell'), 'POSITION_CHANGED', 'Position changed during target application; stop and reassess');
        }
        const limit = priceLimit(observation, order.side, plan.slippageBps);
        const operationId = `target_${digest([run.id, target.symbol, index]).slice(7, 47)}`;
        const pendingOrder = { symbol: target.symbol, target: target.quantity, operationId, receipt: { status: 'preparing' } };
        execution.orders.push(pendingOrder); persist();
        const receipt = await trader.execute({ ...order, operation_id: operationId, observation_id: observation.observation_id, user_authorized: true, timeframe: '5m', price_limit: limit,
          ...(order.action === 'limit' ? { limit_price: limit } : {}) }, signal);
        pendingOrder.receipt = receipt; persist();
        check(['execution_reported', 'execution_observed'].includes(receipt.status), 'EXECUTION_INCOMPLETE', 'Order is not fully confirmed; stop this target batch and inspect receipts before any new decision');
      }
    }
    assertActive();
    const after = await snapshot();
    check(canonical(after.account) === canonical(plan.account), 'ACCOUNT_CHANGED', 'Account changed during reconciliation');
    execution.after = after;
    execution.targetReached = run.decision.unchanged ? null : run.decision.targets.every(target => targetOrders(plan.backend, target, after.projection?.positions).length === 0);
    execution.status = run.decision.unchanged ? 'unchanged' : execution.targetReached ? 'target_observed' : 'reconciliation_required';
  } catch (error) { execution.status = 'blocked'; execution.error = cleanError(error); }
  execution.completedAt = now(); persist(); return execution;
}
