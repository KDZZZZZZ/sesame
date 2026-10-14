// SPDX-License-Identifier: GPL-3.0-only
import { array, check, finite, instant, parameters, runCli, text, validateInput } from './runtime.mjs';

const allowed = ['periods_per_year', 'risk_free_rate'];
const pct = (a, b) => b === 0 ? null : a / b;
const sum = rows => rows.reduce((a, b) => a + b, 0);
const avg = rows => rows.length ? sum(rows) / rows.length : null;
const sd = rows => {
  const m = avg(rows);
  return m === null ? null : Math.sqrt(avg(rows.map(v => (v - m) ** 2)));
};

function visibleRow(row, asOf, name) {
  check(row && typeof row === 'object' && !Array.isArray(row), `${name}: object required`);
  const time = instant(row.time, `${name}.time`);
  const available = instant(row.available_at, `${name}.available_at`);
  check(time <= available && available <= instant(asOf, 'as_of'), `${name}: not visible at as_of`);
  return { time, available };
}

function maxDrawdown(equity) {
  let peak = equity[0].equity, peakTime = equity[0].time, value = 0, maxPeakTime = equity[0].time, maxTroughTime = equity[0].time;
  for (const row of equity) {
    if (row.equity > peak) { peak = row.equity; peakTime = row.time; }
    const dd = peak === 0 ? 0 : (row.equity - peak) / peak;
    if (dd < value) { value = dd; maxPeakTime = peakTime; maxTroughTime = row.time; }
  }
  return { value, peak_time: maxPeakTime, trough_time: maxTroughTime };
}

export function analyze(input) {
  validateInput(input);
  const p = parameters(input, allowed);
  check(input.portfolio && typeof input.portfolio === 'object' && !Array.isArray(input.portfolio), 'portfolio declaration required');
  const currency = text(input.portfolio.currency, 'portfolio.currency');
  check(['adjusted_equity', 'closed_trade_equity'].includes(input.portfolio.basis), 'portfolio.basis: adjusted_equity or closed_trade_equity required');
  check(input.portfolio.no_external_flows === true, 'portfolio.no_external_flows: true required for return metrics');
  const effective = {
    periods_per_year: p.periods_per_year === undefined ? 252 : finite(p.periods_per_year, 'periods_per_year', 1, 100000),
    risk_free_rate: p.risk_free_rate === undefined ? 0 : finite(p.risk_free_rate, 'risk_free_rate', -1, 1),
  };
  const equity = array(input.equity_curve, 'equity_curve', 2, 10000).map((row, i) => {
    visibleRow(row, input.as_of, `equity_curve[${i}]`);
    return { time: row.time, equity: finite(row.equity, `equity_curve[${i}].equity`, Number.MIN_VALUE, 1e18) };
  });
  for (let i = 1; i < equity.length; i++) check(Date.parse(equity[i].time) > Date.parse(equity[i - 1].time), 'equity_curve: time must increase');
  const returns = [];
  for (let i = 1; i < equity.length; i++) returns.push(equity[i].equity / equity[i - 1].equity - 1);
  const total_return = equity[equity.length - 1].equity / equity[0].equity - 1;
  const years = (Date.parse(equity[equity.length - 1].time) - Date.parse(equity[0].time)) / (365.25 * 24 * 3600 * 1000);
  const rawCagr = years > 0 ? (equity[equity.length - 1].equity / equity[0].equity) ** (1 / years) - 1 : null;
  const cagr = rawCagr !== null && Number.isFinite(rawCagr) && Math.abs(rawCagr) < 1e6 ? rawCagr : null;
  const warnings = [];
  if (rawCagr !== cagr) warnings.push('CAGR omitted because the calendar span is too short or the annualized value is not finite.');
  const volatility = sd(returns);
  const sharpe = volatility && volatility > 0 ? ((avg(returns) * effective.periods_per_year) - effective.risk_free_rate) / (volatility * Math.sqrt(effective.periods_per_year)) : null;

  const trades = array(input.closed_trades ?? [], 'closed_trades', 0, 10000).map((row, i) => {
    check(row && typeof row === 'object' && !Array.isArray(row), `closed_trades[${i}]: object required`);
    text(row.id ?? `trade-${i}`, `closed_trades[${i}].id`);
    const entry = instant(row.entry_time, `closed_trades[${i}].entry_time`);
    const exit = instant(row.exit_time, `closed_trades[${i}].exit_time`);
    const available = instant(row.available_at, `closed_trades[${i}].available_at`);
    check(entry <= exit && exit <= available && available <= Date.parse(input.as_of), `closed_trades[${i}]: chronology invalid`);
    return {
      id: row.id ?? `trade-${i}`,
      strategy: row.strategy === undefined ? 'unclassified' : text(row.strategy, `closed_trades[${i}].strategy`),
      gross_pnl: finite(row.gross_pnl, `closed_trades[${i}].gross_pnl`, -1e18, 1e18),
      net_pnl: finite(row.net_pnl, `closed_trades[${i}].net_pnl`, -1e18, 1e18),
      cost: finite(row.cost, `closed_trades[${i}].cost`, -1e18, 1e18),
    };
  });
  check(new Set(trades.map(t => t.id)).size === trades.length, 'closed_trades: duplicate id');
  for (const t of trades) check(Math.abs((t.gross_pnl - t.net_pnl) - t.cost) <= Math.max(1e-9, Math.abs(t.gross_pnl) * 1e-9), `closed_trades.${t.id}: cost must equal gross_pnl - net_pnl within tolerance`);
  const net = trades.map(t => t.net_pnl);
  const wins = trades.filter(t => t.net_pnl > 0);
  const losses = trades.filter(t => t.net_pnl < 0);
  const byStrategy = Object.create(null);
  for (const t of trades) {
    byStrategy[t.strategy] ??= { trades: 0, net_pnl: 0, gross_pnl: 0, costs: 0 };
    byStrategy[t.strategy].trades += 1;
    byStrategy[t.strategy].net_pnl += t.net_pnl;
    byStrategy[t.strategy].gross_pnl += t.gross_pnl;
    byStrategy[t.strategy].costs += t.cost;
  }
  return {
    parameters: effective,
    observations: {
      equity: {
        start: equity[0].equity,
        end: equity[equity.length - 1].equity,
        total_return,
        cagr,
        max_drawdown: maxDrawdown(equity),
        periodic_sharpe: sharpe,
        periods: returns.length,
        currency,
        basis: input.portfolio.basis,
        warnings,
      },
      closed_trades: {
        count: trades.length,
        win_rate: pct(wins.length, trades.length),
        net_pnl: sum(net),
        gross_profit: sum(wins.map(t => t.net_pnl)),
        gross_loss: sum(losses.map(t => t.net_pnl)),
        profit_factor: losses.length ? pct(sum(wins.map(t => t.net_pnl)), Math.abs(sum(losses.map(t => t.net_pnl)))) : null,
        total_costs: sum(trades.map(t => t.cost)),
        attribution_by_strategy: byStrategy,
      },
    },
    limitations: [
      'Metrics summarize supplied equity and closed-trade evidence only; fills, broker statements and cash movements are not independently reconstructed.',
      'CAGR assumes calendar time between first and last equity point; periodic Sharpe uses declared periods_per_year.',
    ],
  };
}

runCli(import.meta.url, analyze);
