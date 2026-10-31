// SPDX-License-Identifier: GPL-3.0-only
import { array, bars, check, finite, instant, parameters, runCli, text, validateInput } from './runtime.mjs';

const allowed = ['expected_engine'];

function visible(row, asOf, name) {
  check(row && typeof row === 'object' && !Array.isArray(row), `${name}: object required`);
  const time = instant(row.time, `${name}.time`);
  const available = instant(row.available_at, `${name}.available_at`);
  check(time <= available && available <= Date.parse(asOf), `${name}: not visible at as_of`);
  return { time, available };
}

export function analyze(input) {
  validateInput(input);
  const p = parameters(input, allowed);
  const expectedEngine = p.expected_engine ?? input.engine?.name ?? 'native-engine';
  text(expectedEngine, 'expected_engine');
  if (input.engine?.name !== undefined) check(input.engine.name === expectedEngine, 'engine.name must match expected_engine');
  const sourceBars = input.bars ? bars(input) : [];
  const orders = array(input.orders ?? [], 'orders', 0, 10000).map((row, i) => {
    const v = visible(row, input.as_of, `orders[${i}]`);
    return {
      id: text(row.id, `orders[${i}].id`),
      time: v.time,
      symbol: text(row.symbol, `orders[${i}].symbol`),
      side: row.side,
      quantity: finite(row.quantity, `orders[${i}].quantity`, Number.MIN_VALUE, 1e18),
      limit_price: row.limit_price === undefined ? null : finite(row.limit_price, `orders[${i}].limit_price`, Number.MIN_VALUE, 1e15),
    };
  });
  check(new Set(orders.map(o => o.id)).size === orders.length, 'orders: duplicate id');
  const trades = array(input.trades ?? [], 'trades', 0, 10000).map((row, i) => {
    const v = visible(row, input.as_of, `trades[${i}]`);
    const orderId = text(row.order_id, `trades[${i}].order_id`);
    return {
      id: text(row.id, `trades[${i}].id`),
      order_id: orderId,
      time: v.time,
      symbol: text(row.symbol, `trades[${i}].symbol`),
      quantity: finite(row.quantity, `trades[${i}].quantity`, Number.MIN_VALUE, 1e18),
      price: finite(row.price, `trades[${i}].price`, Number.MIN_VALUE, 1e15),
      cost: finite(row.cost, `trades[${i}].cost`, 0, 1e18),
    };
  });
  check(new Set(trades.map(t => t.id)).size === trades.length, 'trades: duplicate id');
  const issues = [];
  const byOrder = new Map(orders.map(o => [o.id, o]));
  for (const o of orders) if (!['buy', 'sell'].includes(o.side)) issues.push({ severity: 'error', code: 'order_side', id: o.id, message: 'order side must be buy or sell' });
  for (const t of trades) {
    const o = byOrder.get(t.order_id);
    if (!o) issues.push({ severity: 'error', code: 'unknown_order', id: t.id, message: 'trade references missing order' });
    else {
      if (t.time < o.time) issues.push({ severity: 'error', code: 'fill_before_order', id: t.id, message: 'fill time is before order time' });
      if (t.symbol !== o.symbol) issues.push({ severity: 'error', code: 'symbol_mismatch', id: t.id, message: 'trade symbol differs from order symbol' });
      if (o.limit_price !== null && o.side === 'buy' && t.price > o.limit_price) issues.push({ severity: 'error', code: 'buy_limit_breached', id: t.id, message: 'buy fill price exceeds limit' });
      if (o.limit_price !== null && o.side === 'sell' && t.price < o.limit_price) issues.push({ severity: 'error', code: 'sell_limit_breached', id: t.id, message: 'sell fill price is below limit' });
    }
  }
  const filledByOrder = new Map();
  const bySymbol = new Map();
  for (const t of trades) {
    filledByOrder.set(t.order_id, (filledByOrder.get(t.order_id) ?? 0) + t.quantity);
    const order = byOrder.get(t.order_id);
    const signed = order?.side === 'sell' ? -t.quantity : t.quantity;
    const prev = bySymbol.get(t.symbol) ?? { gross_quantity: 0, buy_quantity: 0, sell_quantity: 0, net_quantity: 0, cost: 0 };
    bySymbol.set(t.symbol, {
      gross_quantity: prev.gross_quantity + t.quantity,
      buy_quantity: prev.buy_quantity + (order?.side === 'buy' ? t.quantity : 0),
      sell_quantity: prev.sell_quantity + (order?.side === 'sell' ? t.quantity : 0),
      net_quantity: prev.net_quantity + signed,
      cost: prev.cost + t.cost,
    });
  }
  for (const o of orders) {
    const filled = filledByOrder.get(o.id) ?? 0;
    if (filled > o.quantity + 1e-9) issues.push({ severity: 'error', code: 'overfill', id: o.id, message: 'filled quantity exceeds order quantity' });
    if (filled === 0) issues.push({ severity: 'warning', code: 'unfilled_order', id: o.id, message: 'order has no supplied fill evidence' });
  }
  const cost = trades.reduce((a, t) => a + t.cost, 0);
  return {
    parameters: { expected_engine: expectedEngine },
    observations: {
      evidence_counts: { bars: sourceBars.length, orders: orders.length, trades: trades.length },
      audit: { issue_count: issues.length, issues },
      fills: { total_cost: cost },
      fills_by_symbol: Object.fromEntries(bySymbol),
      native_engine_handoff: {
        recommended: true,
        reason: 'Use the existing native replay/backtest engine for matching, portfolio accounting and slippage; this plugin only audits supplied replay evidence and assumptions.',
      },
    },
    limitations: [
      'This is not a matching engine or a new backtester; it audits supplied replay evidence, chronology, costs and fill assumptions.',
      'Fill quantities are reported per symbol as gross, buy, sell and net quantities; cross-symbol quantity is deliberately not aggregated.',
      'Bar availability is checked when bars are provided, but order generation logic is not reconstructed.',
    ],
  };
}

runCli(import.meta.url, analyze);
