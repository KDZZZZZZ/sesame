// SPDX-License-Identifier: GPL-3.0-only
import { bars, integer, mean, parameters, runCli, std } from './runtime.mjs';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function utcWeekday(time) {
  return new Date(time).getUTCDay();
}

function stats(values) {
  return { count: values.length, mean_return: mean(values), std_return: std(values) };
}

function maxAvailable(values) {
  return values.reduce((latest, row) => row.available_at > latest ? row.available_at : latest, values[0].available_at);
}

export function analyze(input) {
  const rows = bars(input);
  const p = parameters(input, ['min_samples']);
  const minSamples = integer(p.min_samples ?? 3, 'min_samples', 1, 500);

  const series = rows.map((row, i) => {
    const weekday = utcWeekday(row.time);
    const samples = [];
    const usedRows = [row];
    for (let j = 0; j + 1 < i; j += 1) {
      if (utcWeekday(rows[j].time) === weekday) {
        samples.push((rows[j + 1].close - rows[j].close) / rows[j].close);
        usedRows.push(rows[j], rows[j + 1]);
      }
    }
    const summary = stats(samples);
    const signal = samples.length >= minSamples ? (summary.mean_return > 0 ? 'positive_prior_utc_weekday_edge' : summary.mean_return < 0 ? 'negative_prior_utc_weekday_edge' : 'flat_prior_utc_weekday_edge') : null;
    const usedAvailableAt = maxAvailable(usedRows);
    return { time: row.time, available_at: row.available_at, used_available_at: usedAvailableAt, utc_weekday: WEEKDAYS[weekday], sample_count: samples.length, summary, signal, earliest_action_available_at: signal ? usedAvailableAt : null };
  });

  return {
    parameters: { min_samples: minSamples, calendar: 'UTC bar close weekday; close-to-next-close return samples from strictly prior completed pairs only' },
    observations: { decision_available_at: maxAvailable(rows), latest: series[series.length - 1], series },
    limitations: [
      'This baseline assumes UTC bar-close calendar buckets, not exchange-local sessions or holidays.',
      'Only prior completed close-to-next-close pairs are used; no full-month or future aggregate is read.',
      'The result is a conditional-return observation and does not rank symbols or construct a portfolio.',
    ],
  };
}

runCli(import.meta.url, analyze);
