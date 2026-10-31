// Independent, deterministic demo calculations over fictional candles. This
// generator is not imported by report composition or by the browser renderer.
import { createHash } from 'node:crypto';

const decimal = value => Number(value.toFixed(4));
const day = 24 * 60 * 60 * 1000;
const pendingHistory = () => ({ status: 'pending', policy: 'same_instrument_recent_first', eligible_count: null, reason: '这些特征尚未执行历史匹配；160 个布尔方向示例不属于本次技术样本。' });

export function technicalFixtures(candles, { unit = 'USD', scenarioValues = {} } = {}) {
  if (!Array.isArray(candles) || !candles.length || typeof unit !== 'string' || !unit.trim()) throw new Error('Technical demo needs candles and a price unit');
  const prices = candles.map((row, index) => {
    const time = Date.parse(row.time);
    const values = Object.fromEntries(['open', 'high', 'low', 'close'].map(key => [key, Number(row[key])]));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.time) || !Number.isFinite(time) || index && time <= Date.parse(candles[index - 1].time)
      || ['open', 'high', 'low', 'close'].some(key => row[key] === null || String(row[key]).trim() === '' || !Number.isFinite(values[key]))
      || values.high < Math.max(values.open, values.close) || values.low > Math.min(values.open, values.close)) throw new Error(`Invalid fictional daily candle ${index}`);
    return values;
  });
  const closedAt = index => new Date(Date.parse(candles[index].time) + day).toISOString();
  const cutoff = closedAt(candles.length - 1);
  const inputRef = { id: 'demo-fixed-candles', revision: 'demo-v1', digest: `sha256:${createHash('sha256').update(JSON.stringify(candles)).digest('hex')}`, kind: 'data', schemaVersion: '1.0.0' };
  const shared = { input_ref: inputRef, instrument: 'DEMO', period: 'D1', timezone: 'UTC', unit, observation_start: candles[0].time, observation_end: candles.at(-1).time, as_of: cutoff, bar_state: 'closed', bar_time: '日线开始；首次可得时间为该日线结束', adjustment: '虚构未复权价格；没有真实市场或合约调整' };
  const sma = period => prices.map((_, i) => i + 1 < period ? null : decimal(prices.slice(i + 1 - period, i + 1).reduce((sum, row) => sum + row.close, 0) / period));
  const fast = sma(5), slow = sma(20), atr = [];
  const trueRanges = prices.map((row, i) => i === 0 ? row.high - row.low : Math.max(row.high - row.low, Math.abs(row.high - prices[i - 1].close), Math.abs(row.low - prices[i - 1].close)));
  let previousAtr;
  for (let i = 0; i < candles.length; i++) {
    if (i < 13) { atr.push(null); continue; }
    previousAtr = i === 13 ? trueRanges.slice(0, 14).reduce((sum, value) => sum + value, 0) / 14 : (previousAtr * 13 + trueRanges[i]) / 14;
    atr.push(decimal(previousAtr));
  }
  const gaps = [];
  for (let i = 2; i < candles.length; i++) {
    const before = prices[i - 2], current = prices[i];
    const side = current.low > before.high ? 'upward_geometry' : current.high < before.low ? 'downward_geometry' : null;
    if (!side) continue;
    const lower = side === 'upward_geometry' ? candles[i - 2].high : candles[i].high;
    const upper = side === 'upward_geometry' ? candles[i].low : candles[i - 2].low;
    const fill = prices.findIndex((row, index) => index > i && (side === 'upward_geometry' ? row.low <= Number(lower) : row.high >= Number(upper)));
    gaps.push({ id: `fvg-${i}`, index: i, time: candles[i].time, first_available_at: closedAt(i), side, lower, upper, filled_index: fill, filled_at: fill < 0 ? null : closedAt(fill), state: fill < 0 ? '未完全穿越' : '已完全穿越' });
  }
  const chartRows = candles.map((row, i) => ({ ...row, bar_closed_at: closedAt(i), sma5: fast[i], sma20: slow[i] }));
  const overlays = [
    { field: 'sma5', label: 'SMA 5', group: '均线方法', style: 'solid' },
    { field: 'sma20', label: 'SMA 20', group: '均线方法', style: 'dashed' },
  ];
  // Four recent geometric events keep the mapping below the renderer's twelve
  // column limit. All events remain in feature_signals; this is display selection.
  const displayedGaps = gaps.slice(-4);
  for (const [index, gap] of displayedGaps.entries()) {
    for (const boundary of ['lower', 'upper']) {
      const field = `fvg${index + 1}_${boundary}`;
      overlays.push({ field, label: `FVG ${gap.time} ${boundary === 'lower' ? '下界' : '上界'}`, group: 'FVG 几何区间', style: 'dashed' });
      for (let i = 0; i < chartRows.length; i++) {
        // Start at the next daily bar, after the third candle has closed. End at
        // the supplied demo method's full-crossing event, without extending it.
        chartRows[i][field] = i > gap.index && (gap.filled_index < 0 || i <= gap.filled_index) ? gap[boundary] : null;
      }
    }
  }
  const latest = prices.at(-1), trendReady = slow.at(-1) !== null, atrReady = atr.at(-1) !== null, breakoutReady = prices.length > 20;
  const trendState = !trendReady ? '预热数据不足' : fast.at(-1) > slow.at(-1) ? '快线高于慢线' : fast.at(-1) < slow.at(-1) ? '快线低于慢线' : '快慢线相等';
  const breakoutRange = breakoutReady ? { lower: decimal(Math.min(...prices.slice(-21, -1).map(row => row.low))), upper: decimal(Math.max(...prices.slice(-21, -1).map(row => row.high))) } : null;
  const breakoutSide = !breakoutReady ? null : latest.close > breakoutRange.upper ? 'above' : latest.close < breakoutRange.lower ? 'below' : null;
  const scans = [];
  const scan = (id, label, family, definition, parameters, status, firstAvailable, result) => {
    const entry = { id, method: label, family, method_ref: `demo/${id}@1`, implementation_version: '1', definition, parameters, input: structuredClone(shared), first_available_at: firstAvailable, status, result, historical_search: pendingHistory() };
    scans.push(entry); return entry;
  };
  const trend = scan('sma-trend', '均线相对位置', '趋势跟随', '按每个已收盘日线及此前 close 的简单平均，比较 SMA 5 与 SMA 20；只描述位置，不给方向概率。', { fast: 5, slow: 20, input: 'close', minimum_bars: 20 }, trendReady ? 'completed' : 'unavailable', prices.length >= 20 ? closedAt(19) : null, { state: trendState, reason: trendReady ? '输出同一截点的均线和价格位置。' : '至少需要 20 根已收盘日线。' });
  const fvg = scan('fvg-three-bar', '三根 K 线 FVG', '价格几何', '上向几何：第3根low>第1根high；下向几何：第3根high<第1根low；严格不等式，不加位移或最小宽度条件。只在第3根收盘后成立；后续穿越整个区间时结束叠加。', { bars: 3, minimum_width: 0, comparison: 'strict', direction_semantics: 'geometry_only' }, prices.length < 3 ? 'unavailable' : gaps.length ? 'completed' : 'no_signal', prices.length >= 3 ? closedAt(2) : null, { detected: gaps.length, remaining_at_cutoff: gaps.filter(gap => gap.filled_at === null).length, overlay_events: displayedGaps.map(gap => gap.id), reason: prices.length < 3 ? '至少需要三根已收盘日线。' : gaps.length ? '全部几何事件留档，最近四个用于价格图展示。' : '共同观察窗口内没有满足冻结三根几何定义的区间。' });
  const volatility = scan('atr-wilder', 'ATR 波动尺度', '波动', 'TR为high-low、|high-前收盘|、|low-前收盘|的最大值，首根用high-low；首个ATR取14个TR平均，之后用(前ATR×13+当前TR)/14。', { period: 14, smoothing: 'Wilder', initial_true_range: 'high-low', direction: 'none' }, atrReady ? 'completed' : 'unavailable', prices.length >= 14 ? closedAt(13) : null, { state: atrReady ? '描述型结果' : '预热数据不足', reason: 'ATR 原值表示价格波动尺度，不是价格目标或方向信号；没有放到价格轴。' });
  const breakout = scan('donchian-breakout', '20 根区间突破', '突破', '只检查末根已收盘close是否严格高于前20根high最大值或低于前20根low最小值；当前K线不进入参照区间。', { lookback: 20, evaluation: 'last_closed_bar_only', confirmation: 'close', threshold: 'strictly outside prior range' }, !breakoutReady ? 'unavailable' : breakoutSide ? 'completed' : 'no_signal', prices.length >= 21 ? closedAt(20) : null, { state: !breakoutReady ? '预热数据不足' : breakoutSide ? '末根已确认突破' : '末根未出突破信号', side: breakoutSide, reason: !breakoutReady ? '至少需要21根已收盘日线。' : '末根判定结果与整个输入窗口中是否曾有突破分别表达。' });
  scan('vwap', '成交量加权均价', '成交量与拍卖', '需要与每根K线对应的真实成交量及明确重置规则；OHLC不能代造成交量。', { required_input: 'volume', reset: 'observation_window_start' }, 'unavailable', null, { state: '缺少成交量', reason: '这组固定输入只有OHLC，未运行VWAP，不能写成无信号。' });
  const features = [];
  const feature = (method, item) => features.push({ method_ref: method.method_ref, input_ref: structuredClone(inputRef), observed_at: candles.at(-1).time, first_available_at: cutoff, historical_search: pendingHistory(), ...item });
  if (trendReady) feature(trend, { id: 'sma-latest', feature: '末根均线相对位置', status: 'observed', value: { sma5: fast.at(-1), sma20: slow.at(-1), close: candles.at(-1).close }, unit, state: trendState, condition: '两条均线均已具备完整预热数据并等到当根收盘。', invalidation: '后续收盘后位置关系可能改变；不是预先确定的方向。' });
  for (const gap of gaps) feature(fvg, { id: gap.id, feature: '三根 K 线 FVG 几何', status: 'observed', observed_at: gap.time, first_available_at: gap.first_available_at, value: { lower: gap.lower, upper: gap.upper }, unit, side: gap.side, state: gap.state, filled_at: gap.filled_at, condition: '严格三根高低区间非重叠，第三根已经收盘。', invalidation: '后续向原区间完整穿越仅结束该演示几何叠加，不等于策略止损或预测失败。' });
  if (atrReady) feature(volatility, { id: 'atr-latest', feature: 'ATR 14 原值', status: 'observed', value: atr.at(-1), unit: `${unit} price range`, state: '描述波动尺度', condition: '14根初始TR与后续Wilder递推，全部使用截点前闭合日线。', invalidation: '后续TR会改变尺度；该数值没有单独方向含义。' });
  if (breakoutReady) feature(breakout, { id: 'breakout-latest', feature: '末根区间突破判定', status: breakoutSide ? 'observed' : 'no_signal', value: { close: candles.at(-1).close, prior_lower: breakoutRange.lower, prior_upper: breakoutRange.upper }, unit, state: breakout.result.state, condition: '末根收盘必须严格越过前20根已完成高低区间。', invalidation: '下一根收盘重新判定；本次未触发不代表方法未运行。' });
  const evidence = [{ label: '同一输入上的固定演示方法结果', href: '#section-M02' }];
  const timeline = features.map(item => ({ id: item.id, time: item.first_available_at, item: scans.find(entry => entry.method_ref === item.method_ref).method, state: item.status === 'no_signal' ? '未出信号' : item.feature === '三根 K 线 FVG 几何' ? '几何区间确认' : item.state, evidence, method_ref: item.method_ref, observed_at: item.observed_at }));
  for (const entry of scans.filter(item => item.status === 'unavailable' || item.id === 'fvg-three-bar' && item.status === 'no_signal')) timeline.push({ id: `${entry.id}-${entry.status}`, time: cutoff, item: entry.method, state: entry.status === 'unavailable' ? '不可运行' : '未出信号', evidence, reason: entry.result.reason, method_ref: entry.method_ref });
  const lifecycle = gaps.flatMap(gap => [
    { id: `${gap.id}-detected`, event_id: gap.id, time: gap.first_available_at, item: `FVG ${gap.time}`, stage: 'detected', state: '几何区间确认', formation_bar: gap.time, first_available_at: gap.first_available_at, evidence, method_ref: fvg.method_ref, historical_search: pendingHistory() },
    ...(gap.filled_at ? [{ id: `${gap.id}-filled`, event_id: gap.id, time: gap.filled_at, item: `FVG ${gap.time}`, stage: 'filled', state: '完整穿越结束', crossing_bar: candles[gap.filled_index].time, first_available_at: gap.filled_at, evidence, method_ref: fvg.method_ref, historical_search: pendingHistory() }] : []),
  ]);
  for (const event of lifecycle.filter(event => event.stage === 'filled')) timeline.push({ ...event, item: fvg.method });
  const values = {
    'M02.method_scan': scans,
    'M02.feature_signals': features,
    'M02.event_identity': gaps.map(gap => ({ id: gap.id, event: `FVG ${gap.time}`, type: '三根高低区间非重叠', side: gap.side, direction_semantics: '几何朝向，不是上涨或下跌预测', method_ref: fvg.method_ref, input_ref: structuredClone(inputRef), historical_search: pendingHistory() })),
    'M02.event_times': gaps.map(gap => ({ id: gap.id, formation_bar: gap.time, bar_time_semantics: '第三根日线的开始日期，不是特征确认时间', detected_at: gap.first_available_at, confirmed_at: gap.first_available_at, first_available_at: gap.first_available_at, filled_at: gap.filled_at, period: 'D1', bar_state: 'closed', timezone: 'UTC' })),
    'M02.event_lifecycle': structuredClone(lifecycle),
    'M02.geometry': gaps.map(gap => ({ id: gap.id, lower: gap.lower, upper: gap.upper, unit, side: gap.side, source_bars: candles.slice(gap.index - 2, gap.index + 1).map(row => row.time), formation_bar: gap.time, first_available_at: gap.first_available_at, filled_at: gap.filled_at, state: gap.state, method_ref: fvg.method_ref, input_ref: structuredClone(inputRef), historical_search: pendingHistory() })),
  };
  const independentPlan = '独立条件方案，不是本次FVG/ATR推导的目标或已触发信号。';
  for (const key of ['entry_zone', 'targets', 'stop_plan', 'reward_risk']) {
    const source = scenarioValues[`M02.${key}`];
    if (source !== undefined) values[`M02.${key}`] = Array.isArray(source)
      ? source.map(item => ({ ...structuredClone(item), 方案性质: independentPlan }))
      : { ...structuredClone(source), 方案性质: independentPlan };
  }
  const lifecyclePlot = lifecycle.length ? lifecycle : [{ id: 'fvg-scan-result', event_id: null, time: cutoff, item: fvg.method, stage: 'scan_result', state: fvg.status === 'unavailable' ? '不可运行' : '未出信号', reason: fvg.result.reason, evidence, method_ref: fvg.method_ref, historical_search: pendingHistory() }];
  const takeaway = `同一组 ${candles.length} 根闭合日线：${trendState}，${prices.length < 3 ? 'FVG 预热数据不足' : `窗口内形成 FVG ${gaps.length} 处，截点尚未完整穿越 ${fvg.result.remaining_at_cutoff} 处`}${atrReady ? `，ATR 14 为 ${atr.at(-1)} ${unit}` : ''}；末根突破${!breakoutReady ? '预热数据不足' : breakoutSide ? '已触发' : '未触发'}，VWAP 缺少成交量。`;
  return {
    values,
    charts: { 'M02.price_chart': chartRows, 'M02.method_comparison_chart': timeline, 'M02.lifecycle_chart': lifecyclePlot },
    findings: { 'M02.price_chart': takeaway, 'M02.method_comparison_chart': '各方法使用同一份固定OHLC；时间线保留首次可得事件、末根未出信号与不可运行记录，历史匹配尚未执行。', 'M02.lifecycle_chart': gaps.length ? `${gaps.length} 个三根K线几何事件按首次可得时间确认，其中 ${gaps.filter(gap => gap.filled_at).length} 个已满足完整穿越条件；形成日线与可知时间分别留档。` : fvg.result.reason },
    chartOptions: { 'M02.price_chart': { unit, overlays }, 'M02.method_comparison_chart': { timezone: 'UTC', event: 'id', evidence: 'evidence', inspector: true }, 'M02.lifecycle_chart': { timezone: 'UTC', event: 'id', evidence: 'evidence', inspector: true } },
    chartSources: {
      'M02.price_chart': `虚构 DEMO · ${candles[0].time} 至 ${candles.at(-1).time} · D1 / UTC / ${unit}。均线仅用当根及此前收盘；FVG边界从首次可得后的下一根起显示，全部事件留在特征表。ATR未作为价格线；技术历史检索pending。`,
      'M02.method_comparison_chart': '虚构方法扫描 · 所有方法共享OHLC、截点与单位 · 事件使用first_available_at，无信号和不可运行使用本次评估截点；不展示评分或预测概率。',
      'M02.lifecycle_chart': `同${candles.length}根OHLC的演示FVG定义 · UTC · 第三根收盘后确认，后续闭合K线满足完整穿越条件时结束；历史匹配尚未执行。`,
    },
  };
}

// Authored explanations of the existing boolean-cohort fixture. These use its
// already supplied observations, without reassigning them to FVG or ATR methods.
export function directionalKnowledgeBasis(which) {
  const examples = {
    breakout: {
      theory_refs: ['demo/knowledge/breakout-hypothesis@1'],
      mechanism: '虚构研究假说：已定义的突破标签可能对应后续方向持续；这里的标签不代表刚计算的FVG、均线或ATR。',
      assumptions: ['仅对已有布尔标签、相同期末方向目标与未来五个H1时段比较。', '历史探索没有验证因果或样本外效果。'],
      expected_observation: '若假说成立，突破标签样本的上涨频率应高于同口径全部观察；相反结果构成反证。',
      agreement: 'supporting',
      interpretation: '已有80次突破标签观察中44次上涨（55%），全部160次观察中72次上涨（45%）；这支持本组虚构数据内的频率预期，不能外推为已校准预测。',
    },
    event: {
      theory_refs: ['demo/knowledge/event-context-hypothesis@1'],
      mechanism: '虚构研究假说：事件标签的方向关联依赖价格条件，同一事件标签可能出现不同结果。',
      assumptions: ['事件与突破标签来自同一批固定案例，部分样本重叠。', '分组比较是历史探索，未完成样本外复核。'],
      expected_observation: '事件条件的结果需在突破存在与不存在两组分别检查，保留不支持同一方向的组。',
      agreement: 'mixed',
      interpretation: '已有事件样本40/80上涨；其中突破同时成立的组26/40上涨，未有突破的组14/40上涨。支持与反对同一方向的分组并存，不把事件标签当独立方向票。',
    },
    joint: {
      theory_refs: ['demo/knowledge/joint-condition-hypothesis@1'],
      mechanism: '虚构研究假说：突破与事件同时成立时，联合条件可能对应不同于任一单项条件的后续结果。',
      assumptions: ['联合样本直接取两标签同时成立的案例。', '目标、期限与基准保持一致，不平均单项置信度。'],
      expected_observation: '单独统计联合条件的实际后续方向，并与单项及共同基准比较；若优势消失则不支持该假说。',
      agreement: 'supporting',
      interpretation: '已有联合样本26/40上涨（65%），单项分别为55%与50%，共同基准45%。联合结果保留独立分母；这些重叠样本不能相加，也不支持新技术特征的置信度。',
    },
  };
  if (!Object.hasOwn(examples, which)) throw new Error(`Unknown directional demo hypothesis ${which}`);
  return examples[which];
}
