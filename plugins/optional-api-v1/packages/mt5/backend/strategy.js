import { id, digest, now, requireValue } from './support.js';
import { rowSchema } from './support.js';

// Native SDK exports fixed 8-place decimals. Keep ledger arithmetic exact.
const units = value => { const [whole, fraction = ''] = value.replace(/^-/, '').split('.'); return (value.startsWith('-') ? -1n : 1n) * (BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0').slice(0, 8))); };
const money = value => `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 100000000n}.${String((value < 0n ? -value : value) % 100000000n).padStart(8, '0')}`;
export const passRows = (host, pass, role) => {
  for (const key of pass.dataset_ids) {
    try { const data = host.datasets.read(key); if (data.role === role) return data.rows; }
    catch (error) { if (!host.artifacts || !pass.archived_artifact && !pass.result_artifact) throw error; }
  }
  if (pass.result_artifact && host.artifacts) {
    const result = host.artifacts.read(pass.result_artifact);
    return result.manifest.content.data.filter(item => item.role === role).sort((a, b) => a.offset - b.offset).flatMap(item => {
      const data = host.artifacts.read(item.ref), blob = data.manifest.blobs.find(blob => blob.path === data.manifest.content.path);
      return JSON.parse(host.artifacts.readBlob(blob).toString('utf8'));
    });
  }
  if (pass.archived_artifact && host.artifacts) {
    const artifact = host.artifacts.read(pass.archived_artifact);
    for (const key of pass.dataset_ids) {
      const base = `datasets/${key}/`, metadata = artifact.manifest.blobs.find(blob => blob.path === `${base}metadata.json`);
      if (metadata && JSON.parse(host.artifacts.readBlob(metadata).toString('utf8')).role === role) return artifact.manifest.blobs.filter(blob => blob.path.startsWith(base) && blob.path !== metadata.path).sort((a, b) => Number(a.path.slice(base.length, -5)) - Number(b.path.slice(base.length, -5))).flatMap(blob => JSON.parse(host.artifacts.readBlob(blob).toString('utf8')));
    }
  }
  return [];
};

export function backtestTrades(host, pass) {
  let balance = 0n;
  return passRows(host, pass, 'deals').flatMap(deal => {
    const gross = units(deal.profit), costs = units(deal.commission) + units(deal.swap) + units(deal.fee), pnl = gross + costs;
    balance += pnl;
    if (!['DEAL_TYPE_BUY', 'DEAL_TYPE_SELL'].includes(deal.type)) return [];
    return [{ id: `${pass.id}_deal_${deal.ticket}`, pass_id: pass.id, time: deal.time, time_basis: 'broker_server_unspecified', symbol: deal.symbol,
      side: deal.type === 'DEAL_TYPE_BUY' ? 'buy' : 'sell', entry: deal.entry, reason: deal.reason, ticket: deal.ticket, order: deal.order, position_id: deal.position_id,
      volume: deal.volume, price: deal.price, gross_pnl: money(gross), cost: money(-costs), pnl: money(pnl), balance_after: money(balance), currency: pass.config.currency }];
  });
}

export function strategySources(host, backtestIds) {
  requireValue(Array.isArray(backtestIds) && backtestIds.length > 0 && backtestIds.length <= 32 && new Set(backtestIds).size === backtestIds.length, 'Strategy 报告需要 1–32 个唯一回测任务');
  const jobs = backtestIds.map(key => host.storage.get('mt5_backtest', key));
  requireValue(jobs.every(j => ['succeeded', 'failed', 'canceled'].includes(j.status)), '请等待回测结束后发布报告');
  const passes = host.storage.list('mt5_pass').filter(p => backtestIds.includes(p.backtest_id));
  requireValue(passes.some(p => p.status === 'succeeded'), 'Strategy 报告至少需要一组成功的真实 Tester 结果');
  const jobRow = j => ({ id: j.id, build_id: j.build_id, revision: j.revision, artifact_digest: j.artifact_digest, symbol: j.config.symbol, period: j.config.from_date.slice(0, 7),
    from_date: j.config.from_date, to_date: j.config.to_date, timeframe: j.config.period, model: j.config.model, deposit: j.config.deposit, currency: j.config.currency,
    status: j.status, mode: 'complete', criterion: 'net_profit', parameter_space: j.parameter_space, pass_count: j.pass_count, completed_pass_count: j.completed_pass_count, best_pass_id: j.best_pass_id, error: j.error });
  const passRow = p => {
    const points = passRows(host, p, 'equity'), step = Math.max(1, Math.ceil(points.length / 1499));
    const sampled = points.filter((_point, i) => i % step === 0 || i === points.length - 1);
    return { id: p.id, optimization_id: p.backtest_id, label: p.label, status: p.status, parameters: p.parameters, metrics: p.metrics,
      equity: sampled, sampling: { method: 'bar_open_and_end', original_points: points.length, display_points: sampled.length, truncated: p.equity_truncated ?? false, time_basis: 'broker_server_unspecified', drawdown_source: 'MT5 TesterStatistics' }, error: p.error };
  };
  const grid = { symbols: [...new Set(jobs.map(j => j.config.symbol))], periods: [...new Set(jobs.map(j => j.config.from_date.slice(0, 7)))], mode: 'complete', criterion: 'net_profit',
    cells: jobs.map(j => { const best = passes.find(p => p.id === j.best_pass_id); return { ...jobRow(j), optimization_id: j.id, parameters: best?.parameters ?? null, metrics: best?.metrics ?? null }; }) };
  const sets = { grid: [grid], optimization: jobs.map(jobRow), passes: passes.map(passRow), pass: passes.map(passRow), trades: passes.flatMap(p => backtestTrades(host, p).map(t => ({ ...t, optimization_id: p.backtest_id }))) };
  const sources = [], bindings = {};
  for (const [role, rows] of Object.entries(sets)) {
    const key = id('data'), provenance = { kind: 'derived', dataset_id: key, source_kind: 'derived', provider: 'mt5/strategy-tester', as_of: now(), data_hash: digest(JSON.stringify(rows)), engine_version: 'mt5-tester-report-v1', time_range: null, backtest_ids: backtestIds, artifacts: passes.map(pass => pass.result_artifact).filter(Boolean) };
    const required = role === 'grid' ? [] : role === 'pass' || role === 'trades' ? ['optimization_id', 'pass_id'] : ['optimization_id'];
    const parameters_schema = { type: 'object', additionalProperties: false, required, properties: Object.fromEntries(required.map(name => [name, { type: 'string', enum: name === 'optimization_id' ? backtestIds : passes.map(p => p.id) }])) };
    host.datasets.register({ id: key, title: `Strategy · ${role}`, rows, provenance, strategy_role: role, backtest_ids: backtestIds });
    sources.push({ id: key, title: `Strategy · ${role}`, description: '冻结的真实 Tester 结果；日期使用券商服务器时间。失败/取消的搜索不产生最佳参数。', parameters_schema, row_schema: rowSchema(rows), provenance });
    bindings[role] = key;
  }
  return { sources, component: { id: 'backtest', type: 'strategy_backtest', bindings } };
}

export function strategyQuery(dataset, parameters) {
  const role = dataset.strategy_role;
  const required = role === 'grid' ? [] : ['pass', 'trades'].includes(role) ? ['optimization_id', 'pass_id'] : ['optimization_id'];
  requireValue(Object.keys(parameters).length === required.length && required.every(k => typeof parameters[k] === 'string'), '策略组件查询参数无效');
  if (required.includes('optimization_id')) requireValue(dataset.backtest_ids.includes(parameters.optimization_id), '回测未绑定到报告', 403);
  if (role === 'grid') return dataset.rows;
  const rows = dataset.rows.filter(row => (role === 'optimization' ? row.id : row.optimization_id) === parameters.optimization_id);
  if (role === 'optimization') return rows;
  if (role === 'passes') return rows.slice().sort((a, b) => (a.metrics == null) - (b.metrics == null) || Number(b.metrics?.net_profit ?? 0) - Number(a.metrics?.net_profit ?? 0) || a.id.localeCompare(b.id));
  return rows.filter(row => (role === 'pass' ? row.id : row.pass_id) === parameters.pass_id);
}

export function tradeDetail(host, tradeId, report = null) {
  const match = /^(pass_[a-f0-9-]{36})_deal_(\d+)$/.exec(tradeId);
  requireValue(match, '成交 ID 无效', 404);
  const pass = host.storage.get('mt5_pass', match[1]), job = host.storage.get('mt5_backtest', pass.backtest_id);
  if (report) requireValue(report.content.data_sources.some(s => host.datasets.read(s.id).backtest_ids?.includes(job.id)), '成交不属于此报告', 403);
  const trade = backtestTrades(host, pass).find(t => t.id === tradeId); requireValue(trade, '成交不存在', 404);
  const events = passRows(host, pass, 'trace');
  // Correlate decisions only through an actual request result with matching tickets.
  // A broker-generated stop/exit does not inherit the EA's last signal decision.
  const trace = correlatedTrace(trade, events);
  const revision = host.storage.get('mt5_revision', `${job.project_id}:${job.revision}`);
  return { origin: { mode: 'backtest', backtest_id: job.id, pass_id: pass.id, report_id: report?.report_id ?? null, report_revision: report?.revision ?? null }, trade,
    fills: passRows(host, pass, 'deals').filter(d => d.ticket === trade.ticket), engine: revision.engine ?? null, rule_graph: { ...revision.rules, revision: job.revision, artifact_digest: job.artifact_digest, parameters: pass.parameters, risk_limits: pass.risk_limits },
    trace_status: trace.length ? 'partial' : 'unavailable', trace_reason: trace.length ? '仅展示已导出的原生 SDK 事件；未埋点的分支不推断。' : '没有可按真实订单/成交票据关联的决策埋点；券商止损等自动成交可不经过 EA 信号。',
    trace: { items: trace, snapshot_sequence: trace.at(-1)?.seq ?? 0, truncated: pass.trace_truncated ?? false, time_basis: 'broker_server_unspecified' } };
}

export function correlatedTrace(trade, events) {
  const matches = e => e.value?.deal === trade.ticket || e.value?.order === trade.order && trade.order !== '0';
  const decisions = new Set(events.filter(e => e.kind === 'request_result' && matches(e)).map(e => e.decision_id).filter(Boolean));
  return events.filter(e => decisions.has(e.decision_id) || e.kind === 'transaction' && matches(e));
}
