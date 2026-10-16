// SPDX-License-Identifier: GPL-3.0-only
import { bars, check, finite, integer, parameters, runCli } from './runtime.mjs';

function average(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function trueRange(row, previousClose) {
  if (previousClose === null) return row.high - row.low;
  return Math.max(row.high - row.low, Math.abs(row.high - previousClose), Math.abs(row.low - previousClose));
}

function percentileRank(values, value) {
  const below = values.filter(v => v < value).length;
  const equal = values.filter(v => v === value).length;
  return (below + 0.5 * equal) / values.length;
}

function maxAvailable(rows, start, end) {
  let latest = rows[start].available_at;
  for (let i = start + 1; i <= end; i += 1) if (rows[i].available_at > latest) latest = rows[i].available_at;
  return latest;
}

function boundedText(value, name) {
  check(typeof value === 'string' && /^[A-Z][A-Z0-9_./:-]{1,31}$/.test(value), `${name}: declared uppercase code required`);
  return value;
}

function sizingContext(input) {
  check(input.account && typeof input.account === 'object' && !Array.isArray(input.account), 'account: object required');
  check(input.instrument && typeof input.instrument === 'object' && !Array.isArray(input.instrument), 'instrument: object required');
  const context = {
    equity: finite(input.account.equity, 'account.equity', Number.MIN_VALUE, 1e18),
    account_currency: boundedText(input.account.currency, 'account.currency'),
    price_currency: boundedText(input.instrument.price_currency, 'instrument.price_currency'),
    quantity_unit: input.instrument.quantity_unit === undefined ? null : boundedText(input.instrument.quantity_unit, 'instrument.quantity_unit'),
    point_value: input.instrument.point_value === undefined ? null : finite(input.instrument.point_value, 'instrument.point_value', Number.MIN_VALUE, 1e12),
  };
  check((context.quantity_unit === null) === (context.point_value === null), 'instrument.quantity_unit and instrument.point_value must be supplied together');
  return context;
}

export function analyze(input) {
  const rows = bars(input);
  const context = sizingContext(input);
  const p = parameters(input, ['atr_window', 'atr_stop_multiple', 'risk_fraction', 'kelly_win_probability', 'kelly_avg_win_loss_ratio', 'kelly_fraction_cap', 'kelly_fraction_multiplier', 'price_rank_window']);
  const atrWindow = integer(p.atr_window ?? 14, 'atr_window', 2, 200);
  const atrStopMultiple = finite(p.atr_stop_multiple ?? 2, 'atr_stop_multiple', 0.1, 100);
  const riskFraction = finite(p.risk_fraction ?? 0.01, 'risk_fraction', 0, 0.2);
  const kellyWinProbability = finite(p.kelly_win_probability ?? 0.5, 'kelly_win_probability', 0, 1);
  const kellyAvgWinLossRatio = finite(p.kelly_avg_win_loss_ratio ?? 1, 'kelly_avg_win_loss_ratio', Number.MIN_VALUE, 1000);
  const kellyFractionCap = finite(p.kelly_fraction_cap ?? 0.25, 'kelly_fraction_cap', 0, 1);
  const kellyFractionMultiplier = finite(p.kelly_fraction_multiplier ?? 0.5, 'kelly_fraction_multiplier', 0, 1);
  const priceRankWindow = integer(p.price_rank_window ?? 60, 'price_rank_window', 2, 1000);

  const trValues = rows.map((row, i) => trueRange(row, i === 0 ? null : rows[i - 1].close));
  const series = rows.map((row, i) => {
    const atr = i + 1 >= atrWindow ? average(trValues.slice(i + 1 - atrWindow, i + 1)) : null;
    const prices = i + 1 >= priceRankWindow ? rows.slice(i + 1 - priceRankWindow, i + 1).map(item => item.close) : null;
    const atrStart = i + 1 >= atrWindow ? Math.max(0, i + 1 - atrWindow - 1) : i;
    const priceStart = i + 1 >= priceRankWindow ? i + 1 - priceRankWindow : i;
    const usedAvailableAt = maxAvailable(rows, Math.min(atrStart, priceStart), i);
    const rawKelly = kellyWinProbability - (1 - kellyWinProbability) / kellyAvgWinLossRatio;
    const cappedKellyFraction = Math.min(kellyFractionCap, Math.max(0, rawKelly));
    const kellyFraction = cappedKellyFraction * kellyFractionMultiplier;
    if (atr === null || prices === null) return { time: row.time, available_at: row.available_at, used_available_at: usedAvailableAt, status: 'warmup', atr, price_rank: prices ? percentileRank(prices, row.close) : null };
    const riskAmount = context.equity * riskFraction;
    const priceRisk = atr * atrStopMultiple;
    const undefinedRisk = !(priceRisk > Number.EPSILON * Math.max(1, row.close));
    const cashPerPricePoint = undefinedRisk ? null : riskAmount / priceRisk;
    const boundedCashPerPricePoint = cashPerPricePoint !== null && Number.isFinite(cashPerPricePoint) && cashPerPricePoint <= 1e15 ? cashPerPricePoint : null;
    const riskStatus = boundedCashPerPricePoint === null ? 'undefined_price_risk' : 'ready';
    return {
      time: row.time,
      available_at: row.available_at,
      used_available_at: usedAvailableAt,
      status: riskStatus,
      atr,
      atr_stop_price_distance: priceRisk,
      risk_amount: riskAmount,
      risk_amount_currency: context.account_currency,
      sizing_output_unit: context.point_value === null ? `${context.account_currency}_cash_per_${context.price_currency}_price_point` : context.quantity_unit,
      cash_per_price_point_estimate: boundedCashPerPricePoint,
      quantity_estimate: boundedCashPerPricePoint !== null && context.point_value !== null ? boundedCashPerPricePoint / context.point_value : null,
      fractional_kelly_capital: context.equity * kellyFraction,
      raw_kelly_fraction: rawKelly,
      capped_kelly_fraction: cappedKellyFraction,
      kelly_fraction_multiplier: kellyFractionMultiplier,
      effective_kelly_fraction: kellyFraction,
      price_rank: percentileRank(prices, row.close),
    };
  });

  return {
    parameters: { atr_window: atrWindow, atr_stop_multiple: atrStopMultiple, risk_fraction: riskFraction, kelly_win_probability: kellyWinProbability, kelly_avg_win_loss_ratio: kellyAvgWinLossRatio, kelly_fraction_cap: kellyFractionCap, kelly_fraction_multiplier: kellyFractionMultiplier, price_rank_window: priceRankWindow },
    observations: { decision_available_at: maxAvailable(rows, 0, rows.length - 1), account: { equity: context.equity, currency: context.account_currency, scenario: 'constant_equity_hypothetical_not_historical_account_trajectory' }, instrument: { price_currency: context.price_currency, quantity_unit: context.quantity_unit, point_value: context.point_value }, latest: series[series.length - 1], series },
    limitations: [
      'The account equity is a constant-equity hypothetical scenario applied to each row, not a historical account trajectory.',
      'Without instrument.point_value and instrument.quantity_unit, sizing is labelled as mathematical cash per price point rather than broker units.',
      'Kelly inputs are supplied assumptions and must not be inferred from the same evaluation sample without holdout controls.',
      'This independently rewritten baseline references ABU ATR/Kelly/price-rank sizing ideas without copying ABU code.',
    ],
  };
}

runCli(import.meta.url, analyze);
