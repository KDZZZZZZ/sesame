// Fictional method outputs for the optional business fields. This file is only
// used by the fixture generator: no estimator is installed in Report itself.
export function domainFixtures(reference) {
  const round = value => Number(value.toFixed(4));
  const values = {}, charts = {}, findings = {}, chartOptions = {}, chartSources = {};
  const put = (module, fields) => { for (const [key, value] of Object.entries(fields)) values[`${module}.${key}`] = value; };
  const plot = (key, rows, takeaway, options = {}, source = '虚构演示数据；各数值保留原单位、口径和原始行。') => {
    if (key.startsWith('M17.')) options = { timezone: 'America/New_York', ...options };
    if (['M04.price_estimates_chart','M09.expected_move_chart'].includes(key)) options = { unit: 'USD', ...options };
    charts[key] = rows; findings[key] = takeaway; chartOptions[key] = options; chartSources[key] = source;
  };
  const evidence = [{ label: '固定演示结果', href: '#section-M02' }];
  const eventStates = [
    { id: 'pattern-detected', time: '2026-09-15T18:00:00Z', item: '突破观察', state: '形成中', evidence },
    { id: 'pattern-confirmed', time: '2026-09-16T18:00:00Z', item: '突破观察', state: '已确认', evidence },
    { id: 'pattern-invalidated', time: '2026-09-17T18:00:00Z', item: '突破观察', state: '回落失效', evidence },
  ];
  plot('M02.lifecycle_chart', eventStates, '同一技术事件从形成到确认，再因价格回落失效；三次状态分别保留时间。', {}, 'DEMO 虚构已发生事件 · UTC · 日线收盘状态。');
  put('M01', {
    reference_price: { 价格: '108.20', 币种: 'USD', 时点: '2026-10-01T14:00:00Z', 口径: '独立情景的假设参考价' },
    timeframe_states: [{ 观察周期: 'H1', 研究期限: '未来五个 H1 时段', 状态: '区间内' }, { 观察周期: 'D1', 研究期限: '未来二十个交易日', 状态: '中期上行背景' }],
  });
  const terms = [
    { 情景: '上方突破', 方向: '多', 触发: '收盘突破 110，并回测确认', 入场参考: '110–111 USD', 目标: '115 / 120 USD', 观点失效: '回落至 101 下方', 止损: '108 USD', 期限: '未来五个 H1 时段', 参考盈亏比: '入场 110、止损 108：2.5 / 5.0；未含成本' },
    { 情景: '未确认', 方向: '观察', 触发: '仍在 101–110 区域', 入场参考: null, 目标: null, 观点失效: '离开原观察区间', 止损: null, 期限: '下次闭合 H1 复核', 参考盈亏比: null },
  ];
  put('M02', {
    event_identity: [{ 事件: '突破观察', 类型: '方法定义的区间突破', 方向: '多', 来源: '虚构技术研究' }],
    event_times: [{ 事件: '突破观察', 检测: eventStates[0].time, 确认: eventStates[1].time, 最早可观察行动: '2026-09-16T18:00:01Z', 周期: 'D1', 闭合状态: '已闭合' }],
    event_lifecycle: eventStates.map(row => ({ 事件: row.item, 时点: row.time, 状态: row.state })),
    geometry: [{ 对象: '观察区间', 下边界: '101 USD', 上边界: '110 USD', 依据: '虚构固定研究区域', 重要性: '主要', 触碰次数: 3 }],
    research_horizons: [{ 情景: '上方突破', 周期: 'H1', 预测期限: '未来五个 H1 时段' }],
    entry_zone: { 方向: '多', 下界: '110', 上界: '111', 币种: 'USD', 条件: '突破并回测确认', 状态: '未触发' },
    targets: [{ 目标: '第一目标', 价格: '115 USD', 期限: '未来五个 H1 时段' }, { 目标: '第二目标', 价格: '120 USD', 期限: '未来五个 H1 时段' }],
    stop_plan: { 参考止损: '108 USD', 触发: '价格跌破止损线', 跟踪: '本例未设置跟踪止损', 与观点失效区别: '101 是观点失效线，108 是入场后的风险控制假设' },
    reward_risk: { 入场参考: '110 USD', 止损参考: '108 USD', 第一目标: 2.5, 第二目标: 5, 成本: '该比值未含交易成本', 含义: '潜在收益/潜在损失，不是胜率' },
  });
  put('M15', { scenario_terms: terms, objective: '依据价格与事件条件安排下一次观察', constraints: ['仅呈现研究情景，尚未形成交易指令'], review_at: '下一个 H1 收盘或事件发布后' });
  const factorRows = [
    { factor: '价值', score: 82, scale: '0–100', label: '较强' },
    { factor: '增长', score: 54, scale: '0–100', label: '中等' },
    { factor: '动量', score: 63, scale: '0–100', label: '中等' },
    { factor: '收益', score: 43, scale: '0–100', label: '偏弱' },
    { factor: '质量', score: 71, scale: '0–100', label: '较强' },
  ];
  plot('M03.factor_chart', factorRows, '五项演示分数中价值最高、收益最低；图表不计算综合分。', {}, '虚构自有量表 0–100；并非 TC 原厂评分，五项只是本例所选因子。');
  put('M03', {
    factor_results: factorRows.map(row => ({ 因子: row.factor, 分数: row.score, 原尺度: row.scale, 标签: row.label, 方法: '演示因子结果 v1' })),
    composite_assessment: { 结果: '经营质量较稳，股息维度较弱', 类型: '独立方法提供的定性评价', 日期: '2026-10-01' },
    income: [{ 财期: '2025 全年', 每股股息: '0.50 USD', 参考价格: '100 USD', 股息收益率: '0.5%', 每股收益: '2.50 USD', 支付率: '20%' }],
    cycle_context: { 阶段: '本例假设温和复苏', 适用性: '仍需结合行业周期', 来源: '独立演示研究结果' },
  });
  const estimates = [
    { estimate: '参考价格', price: 100, kind: '市场参考', horizon: '当前', as_of: '2026-10-01' },
    { estimate: '公允价值', price: 120, kind: '估值', horizon: '估值时点', as_of: '2026-10-01' },
    { estimate: '模型目标', price: 112, kind: '模型价格预测', horizon: '十二个月', as_of: '2026-10-01' },
    { estimate: '分析师目标均值', price: 115, kind: '意见汇总', horizon: '十二个月', as_of: '2026-10-01' },
  ];
  plot('M04.price_estimates_chart', estimates, '参考价 100，公允价值 120、模型目标 112、共识均值 115；三种结果含义分别保留。', {}, '虚构公司估计 · USD · 2026-10-01；仅模型和分析师目标对应十二个月期限。');
  put('M04', {
    valuation: { 公允价值: '120 USD', 估值时点: '2026-10-01', 方法: '示例估值模型结果' },
    market_comparison: { 市场价格: '100 USD', 相对现价上行空间: '20%', 相对公允价值折价: '16.6667%' },
    model_target: { 目标价: '112 USD', 期限: '十二个月', 预测起点: '2026-10-01', 方法: '独立示例价格模型 v1', 历史证据: '本例未提供，不能据此推导上涨概率' },
    update_schedule: { 估值模型日期: '2026-10-01', 价格模型日期: '2026-10-01', 复核条件: '新的财务资料公布或用户要求更新' },
  });
  plot('M05.ratings_chart', [{ rating: '买入', count: 12 }, { rating: '持有', count: 6 }, { rating: '卖出', count: 2 }], '20 位演示分析师中，12 位买入、6 位持有、2 位卖出；评级数量不表示胜率。');
  put('M05', {
    coverage: { 评级与价格目标覆盖: 20, EPS分歧图覆盖: 8, 截点: '2026-10-01', 口径: '不同目标各自保留覆盖范围' },
    rating_distribution: [{ 评级: '买入', 人数: 12 }, { 评级: '持有', 人数: 6 }, { 评级: '卖出', 人数: 2 }],
    analyst_count: 20,
    target_prices: { 均值: '115 USD', 最低: '85 USD', 最高: '145 USD', 期限: '十二个月', 覆盖人数: 20 },
    target_dates: { 截点: '2026-10-01', 期限: '十二个月', 最新修订: '2026-09-30', 去重: '每位分析师取截点前最新意见' },
  });
  put('M06', {
    event: { 名称: '虚构就业数据', 时间: '2026-10-05T12:30:00Z', 状态: '已公布' },
    expectations: { 预期: 80, 单位: '千人', 可得时间: '2026-10-04T18:00:00Z', 来源: '虚构共识样本' },
    release: { 实际: 90, 单位: '千人', 公布时间: '2026-10-05T12:30:00Z' },
    previous_values: { 前期初值: 70, 修订值: 72, 单位: '千人', 初值可得: '2026-09-04T12:30:00Z', 修订可得: '2026-10-05T12:30:00Z' },
    surprise: { 预期: 80, 实际: 90, 差值: 10, 单位: '千人', 分类: '高于预期', 分类方法: '演示：差值大于零', 方向判断: '由事件研究方法另行提供' },
    reaction_windows: [{ 窗口: '发布后 1 小时', 净变化: '-0.30%', 总区间: '0.60%', 状态: '已结束的独立事件反应示例' }],
    event_importance: { 类别: '就业', 频率: '每月', 标签: '高', 定义来源: '示例事件来源标签' },
  });
  put('M07', {
    coverage_details: { 窗口: '2026-09-01 至 2026-09-10', 渠道: '新闻与公开网页', 语言: '中文、英文', 去重: '按原始文章与转载关系去重', 比较窗口: '同一来源池的前十日', 社交数据: '未纳入本例评分' },
    source_mix: [{ 来源: '新闻', 数量: 36 }, { 来源: '公开网页', 数量: 18 }],
  });
  const sentimentDates = Array.from({ length: 12 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
  plot('M08.subjectivity_chart', sentimentDates.map((date, i) => ({ date, subjectivity: [65,67,66,70,72,71,76,80,78,81,79,81][i] })), '文本主观性由 65 升至 81；这描述文本表达，不是预测可靠性。', {}, '虚构主观性量表 0–100 · 与情绪趋势和证据量分别定义。');
  plot('M08.fear_chart', sentimentDates.map((date, i) => ({ date, fear: [55,57,52,50,48,47,49,45,43,42,44,41][i] })), '演示恐惧指标从 55 降至 41，使用独立语料与量表。', {}, '虚构恐惧量表 0–100；不代表 VIX 或任何厂商原始指数。');
  put('M08', {
    subjectivity: { 值: 81, 尺度: '0–100', 含义: '主观表达程度', 日期: '2026-09-12' },
    evidence_volume: { 文本数: 54, 等级: '中等', 定义: '按本例语料覆盖给定的证据量等级', 用途: '描述文本覆盖，不是行情预测置信度' },
    trend_indicator: { 值: 46, 尺度: '0–100', 中性参考: 50, 含义: '情绪趋势减弱', 方法: '独立演示趋势结果' },
    fear_index: { 值: 41, 尺度: '0–100', 含义: '数值越高，恐惧表达越多', 日期: '2026-09-12', 来源: '独立演示语料' },
  });
  const iv = [20,21,23,22,25,24,23,26,24,23,22,23];
  plot('M09.iv_history_chart', iv.map((value, i) => ({ date: sentimentDates[i], iv: value, hv: [18,18,19,19,20,20,19,20,21,20,19,19][i] })), '当前 30 天 IV 为 23%，高于同期口径 HV 的 19%。', {}, '虚构 30 天同口径年化波动 · 12 次观察 · %。');
  const ranges = [7,30,90].map((days, i) => ({ horizon: `${days} 天`, lower: round(100 * (1 - [.25,.23,.21][i] * Math.sqrt(days / 365))), upper: round(100 * (1 + [.25,.23,.21][i] * Math.sqrt(days / 365))) }));
  plot('M09.expected_move_chart', ranges, `30 天范围为 ${ranges[1].lower}–${ranges[1].upper} USD；期限越长，该演示范围越宽。`, {}, '演示方法：参考价 100，7/30/90 天年化 IV 为 25%/23%/21%，采用平方根时间近似的一倍波动范围；不是经历史校准的预测区间。');
  put('M09', {
    quote_context: { 标的参考价: '100 USD', 报价时点: '2026-09-12T20:00:00Z', 合约口径: '30 天、平值、假设报价', 方法: '演示 IV 输出 v1' },
    iv_history: { 开始: sentimentDates[0], 结束: sentimentDates.at(-1), 次数: iv.length, 最低: 20, 最高: 26, 当前: 23, 单位: '%', 年化口径: '年化' },
    iv_rank: { 值: 50, 尺度: '0–100', 定义: '当前 IV 在本例历史最小值与最大值之间的位置', 窗口: '12 次观察' },
    iv_percentile: { 值: round(iv.filter(value => value < 23).length / iv.length * 100), 尺度: '0–100', 定义: '严格低于当前值的观察数/全部观察数', 样本数: iv.length },
    expected_move: { 参考价格: 100, 单位: 'USD', 期限: '30 天', 下界: ranges[1].lower, 上界: ranges[1].upper, 含义: '一倍定价波动近似范围', 方法: '演示平方根时间近似', 验证状态: '未校准为真实发生概率' },
    volatility_surface: [30,90].flatMap(days => [90,100,110].map(strike => ({ 期限天数: days, 行权价: strike, IV百分数: days === 30 ? ({90:26,100:23,110:24})[strike] : ({90:22,100:21,110:22})[strike] }))),
    volatility_cone: [{ 天数: 30, 历史低分位: '15%', 中位: '19%', 高分位: '25%', 历史窗口: '独立演示历史范围' }],
    liquidity: [{ 合约: '演示 30 天 C100', 买价: '3.90 USD', 卖价: '4.10 USD', 价差: '0.20 USD', 成交量: 120, 未平仓量: 800, 时点: '2026-09-12T20:00:00Z' }],
  });
  const settlements = [96,103,108,112,106,99];
  const optionCases = settlements.map((price, i) => {
    const start = new Date(Date.UTC(2026, 3 + i, 1)), end = new Date(+start + 28 * 86400000);
    const payoff = Math.min(15, Math.max(0, price - 100)) - 4;
    return { case_id: `option-demo-${i + 1}`, fixture_kind: 'option_expiry', instrument: 'DEMO', started_at: start.toISOString(), settled_at: end.toISOString(), normalized_start: 100, terminal: price, long_strike: 100, short_strike: 115, net_cost: 4, net_payoff: payoff, horizon: '28 个自然日到期', outcome: payoff > 0 ? '净盈利' : '未净盈利' };
  });
  const profitable = optionCases.filter(row => row.net_payoff > 0).length;
  const optionBasis = {
    scenario: '归一化标的价 100，买 C100 卖 C115，28 天到期，含成本净付 4', matching_method_ref: 'demo/option-terms-match@1',
    target: '到期净损益大于零', horizon: '28 个自然日到期', window: { start: optionCases[0].started_at, end: optionCases.at(-1).settled_at, as_of: '2026-10-01' },
    sampling: { policy: 'same_instrument_recent_first', subject: 'DEMO', recent_window: { start: '2026-04-01', end: '2026-09-30' }, primary_search: { status: 'matched', eligible_count: 6, ref: reference }, selected_scope: 'same_instrument_recent', instruments: ['DEMO'] },
    sample: { matched: 6, resolved: 6, excluded: 0, pending: 0, effective: 6 }, outcomes: [{ label: '净盈利', count: profitable }, { label: '未净盈利', count: 6 - profitable }], refs: [reference],
    baseline: { status: 'unavailable', description: '本例未提供同到期与成本口径的替代结构基准。' }, dependence: '每月一个 28 天观察窗，六个观察窗不重叠。',
    uncertainty: '只有六个虚构案例，不据此证明稳定预测能力。', limitations: ['固定条款的虚构到期结果；未验证真实期权报价、提前行权或状态变化。'],
  };
  put('M10', {
    legs: [{ 合约: 'C100', 方向: '买', 数量: 1, 乘数: 100, 到期: '28 天' }, { 合约: 'C115', 方向: '卖', 数量: 1, 乘数: 100, 到期: '28 天' }],
    max_profit: { 每股净额: '11 USD', 每组净额: '1100 USD', 条件: '到期标的价达到或超过 115', 成本: '含每股 4 USD 总支出' },
    max_loss: { 每股净额: '4 USD', 每组净额: '400 USD', 条件: '到期标的价不超过 100' },
    breakevens: [{ 价格: '104 USD', 时点: '到期', 口径: '含全部示例成本' }],
    expected_profit: { 每股均值: round(optionCases.reduce((sum, row) => sum + row.net_payoff, 0) / optionCases.length), 单位: 'USD', 定义: '六个固定条款历史案例的平均净损益', 样本数: 6, 期限: '28 天到期' },
    greeks: [{ 指标: 'Delta', 组合值: 0.35, 单位: '每股标的变动对应的期权价格敏感度', 方法: '独立演示风险结果' }, { 指标: 'Vega', 组合值: 0.08, 单位: 'IV 每变动 1 个百分点的每股价格变化', 方法: '独立演示风险结果' }],
    liquidity: [{ 合约: 'C100', 买价: '5.10', 卖价: '5.30', 成交量: 120, 未平仓量: 800 }, { 合约: 'C115', 买价: '1.90', 卖价: '2.10', 成交量: 80, 未平仓量: 500 }],
    settlement: { 行权: '示例欧式', 结算: '现金', 乘数: 100, 到期: '28 天', 提前行权: '不适用', 权利金: '买入 5.30、卖出 1.90，净付 3.40 USD/股', 其他费用: '0.60 USD/股', 公司行为: '本例假设无' },
  });
  const stopRows = [{ variant: '较紧', distance: 2, quantity: 500, risk_cash: 1000 }, { variant: '中等', distance: 4, quantity: 250, risk_cash: 1000 }, { variant: '较宽', distance: 8, quantity: 125, risk_cash: 1000 }];
  plot('M12.stop_chart', stopRows, '同为 1,000 USD 风险预算，止损距离从 2 增至 8 时，假设规模从 500 降至 125 单位。', { unit: '横轴 USD/单位；纵轴数量' }, '虚构 100 USD 参考价 · 乘数 1 · 固定风险 1,000 USD · 此比较未含交易成本。');
  put('M12', {
    stop_variants: [{ 方案: '较紧', 价格: '98 USD', 方向: '多', 跟踪: '不跟踪' }, { 方案: '中等', 价格: '96 USD', 方向: '多', 跟踪: '不跟踪' }, { 方案: '较宽', 价格: '92 USD', 方向: '多', 跟踪: '不跟踪' }],
    stop_distances: stopRows.map(row => ({ 方案: row.variant, 距离: row.distance, 单位损失: row.distance, 单位: 'USD', 规模: row.quantity })),
    position_size: { 风险金额: '1000 USD', 单位损失: '4 USD', 估计数量: 250, 乘数: 1, 数量步长: 1, 汇率: 1, 方法: '演示固定风险/单位损失', 成本口径: '未含成本' },
    execution_costs: { 每单位佣金: '0.01 USD', 每单位滑点: '0.02 USD', 每单位价差: '0.01 USD', 用途: '独立成本假设，未加入上方仓位示例' },
    margin: { 类型: '假设账户', 币种: 'USD', 可用资金: '100000', 假设保证金比例: '20%', 中等方案名义额: '25000', 估计保证金: '5000' },
  });
  put('M11', {
    universe: { 范围: '三个虚构资产篮子', 截点: '2026-10-01', 覆盖: '三项完整覆盖' },
    selection_logic: { 逻辑: 'AND', 条件: '流动性门槛满足，且研究分数大于 50', 版本: '演示筛选 v1' },
    rank_rules: { 指标: '独立演示分数', 方向: '从高到低', 并列: '按稳定资产顺序', 数量: 3 },
    candidate_details: ['候选甲','候选乙','候选丙'].map((name, i) => ({ 候选: name, 检测: '2026-10-01T14:00:00Z', 周期: 'D1', 研究期限: '一个月', 状态: '待进一步研究', 参考分数: [72,64,58][i] })),
    backtest_refs: [{ 规则: '演示筛选 v1', 结果: 'M18 的固定模拟结果，见报告来源', 性质: '虚构示例' }],
  });
  const calendar = [
    { id: 'employment', time: '2026-10-05T12:30:00Z', item: '就业数据', state: '已公布', type: '经济数据', importance: '高' },
    { id: 'earnings', time: '2026-10-06T20:05:00Z', item: 'DEMO 财报', state: '待公布', type: '财报', importance: '高' },
    { id: 'ex-dividend', time: '2026-10-07T13:30:00Z', item: 'DEMO 除息', state: '日期已确认', type: '股息', importance: '中' },
    { id: 'rate', time: '2026-10-07T18:00:00Z', item: '利率决议', state: '待公布', type: '经济数据', importance: '高' },
    { id: 'meeting', time: '2026-10-08T14:00:00Z', item: 'DEMO 股东会', state: '日期已确认', type: '会议', importance: '中' },
    { id: 'split', time: '2026-10-09T13:30:00Z', item: 'DEMO 拆股', state: '日期已确认', type: '拆股', importance: '中' },
  ];
  const days = Array.from({ length: 7 }, (_, i) => `2026-10-${String(i + 5).padStart(2, '0')}`);
  const local = time => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }).format(new Date(time));
  plot('M17.timeline_chart', calendar.map(row => ({ ...row, evidence: [{ label: '事件明细', href: '#section-M17' }] })), '本周记录六个虚构事件；就业数据已公布，其余保留计划或确认状态。', {}, '虚构事件周历 · 截点 2026-10-05 09:00 America/New_York · 实际值仅填已公布事件。');
  plot('M17.calendar_chart', days.map(date => ({ date, count: calendar.filter(row => local(row.time).startsWith(date)).length, status: 'observed' })), '周三有两个已知事件，周末记录为零；零表示本例来源已覆盖而无事件。', { from: days[0], to: days.at(-1) }, '同一虚构来源覆盖整个七日窗口 · 每格为已知事件数量，非风险分数。');
  put('M17', {
    scope: { 开始: days[0], 结束: days.at(-1), 时区: 'America/New_York', 截点: '2026-10-05 09:00', 版本: '虚构周历 v1' },
    events: calendar.map(row => ({ 事件: row.item, 当地时间: local(row.time), 类型: row.type, 状态: row.state, 重要性: row.importance })),
    economic_releases: [{ 事件: '就业数据', 前值: 70, 修订值: 72, 预期: 80, 实际: 90, 单位: '千人', 频率: '每月' }, { 事件: '利率决议', 前值: 4, 修订值: null, 预期: 4, 实际: null, 单位: '%', 频率: '按会议日历' }],
    earnings: [{ 公司: 'DEMO', 财季: '2026 Q3', 时间: '2026-10-06 16:05', 时段: '盘后', EPS预期: '1.20 USD', EPS实际: null }],
    dividends: [{ 公司: 'DEMO', 宣告日: '2026-09-20', 除息日: '2026-10-07', 登记日: '2026-10-08', 支付日: '2026-10-23', 每股金额: '0.50 USD', 类别: '普通股息' }],
    splits: [{ 公司: 'DEMO', 生效日: '2026-10-09', 新旧股比例: '2:1', 价格复权因子: 0.5, 来源: '虚构公司公告' }],
    meetings: [{ 公司: 'DEMO', 类型: '股东大会', 时间: '2026-10-08 10:00', 时区: 'America/New_York', 状态: '已确认', 议题: '已披露的董事选举议题' }],
    schedule_changes: [{ 事件: 'DEMO 股东会', 原时间: '2026-10-08 09:30', 新时间: '2026-10-08 10:00', 修订公布: '2026-10-02', 时区: 'America/New_York' }],
    coverage: { 来源: '完整覆盖七日的虚构日历', 缺失天数: 0, 重要性: '来源标签，不是行情方向预测', 计划说明: '已确认日期不代表事件实际结果已知' },
  });
  const net = [.02,.015,-.025,.03,.012,-.01,.018,.025,-.012,.02,.015,.01];
  const bench = [.015,.01,-.03,.02,.01,-.012,.012,.018,-.016,.012,.01,.008];
  let equity = 1, baseline = 1, peak = 1, basePeak = 1, costCash = 0;
  const performance = [{ date: '2025-10-01', strategy: 1, benchmark: 1, strategy_drawdown: 0, benchmark_drawdown: 0 }];
  net.forEach((ret, i) => {
    costCash += equity * 100000 * .001;
    equity *= 1 + ret; baseline *= 1 + bench[i]; peak = Math.max(peak, equity); basePeak = Math.max(basePeak, baseline);
    performance.push({ date: new Date(Date.UTC(2025, 10 + i, 1)).toISOString().slice(0,10), strategy: Number(equity.toFixed(8)), benchmark: Number(baseline.toFixed(8)), strategy_drawdown: round((equity / peak - 1) * 100), benchmark_drawdown: round((baseline / basePeak - 1) * 100) });
  });
  const total = round((performance.at(-1).strategy - 1) * 100), baselineTotal = round((performance.at(-1).benchmark - 1) * 100);
  const drawdown = Math.min(...performance.map(row => row.strategy_drawdown));
  plot('M18.equity_chart', performance, `十二个月示例净收益 ${total}%，基准 ${baselineTotal}%；两条净值均从 1 开始。`, {}, '虚构月度模拟结果 · 2025-10-01 至 2026-10-01 · USD · 策略每月收益已扣 0.1% 成本假设，基准未扣策略交易费。');
  plot('M18.drawdown_chart', performance, `策略月度观测最大回撤为 ${Math.abs(drawdown)}%；这不是逐日最大回撤。`, {}, '由同一组未四舍五入月度模拟净值生成；回撤单位为 %，每月观察一次。');
  // Independent parameter-study fixture: its IDs/sample never masquerade as
  // the portfolio's monthly path. Selection is frozen before rendering.
  const trials = ['DEMO-A','DEMO-B'].flatMap((symbol,s) => ['H1','H4'].flatMap((timeframe,t) => [10,20,30].flatMap(lookback => [1,2].map(threshold => {
    const net_return = round(8 - Math.abs(lookback - 20) * .35 - (threshold - 1) * 1.2 + s * 1.4 - t * 2);
    return { trial_id: `${symbol}-${timeframe}-${lookback}-${threshold}`, symbol, timeframe, sample:'独立虚构参数训练集', parameters:{lookback,threshold}, lookback, threshold, status:'completed', selected:lookback===20&&threshold===1, net_return, sharpe:round(net_return/8), max_drawdown_pct:round(5+Math.abs(lookback-20)*.15), net_profit:round(net_return*1000) };
  }))));
  trials.push({trial_id:'DEMO-C-H1-failed',symbol:'DEMO-C',timeframe:'H1',sample:'独立虚构参数训练集',parameters:{lookback:20,threshold:1},lookback:20,threshold:1,status:'failed',selected:false,net_return:null,sharpe:null,max_drawdown_pct:null,net_profit:null});
  const grid=trials.filter(row=>row.selected||row.status==='failed');
  plot('M18.market_matrix_chart', grid, '展示四个预先选定组合；DEMO-C 失败格保留缺失，换颜色指标不会重新选优。', {}, '独立虚构参数试验 · 统一训练样本 · 净收益 %；与上方三资产篮子净值是两个独立示例。完整交互由原生回测报告承接。');
  plot('M18.parameter_heatmap', trials.filter(row=>row.symbol==='DEMO-A'&&row.timeframe==='H1'), '固定 DEMO-A / H1，展示 3 × 2 个已测试参数组合；本例预选 lookback=20、threshold=1。', {}, '独立虚构训练集 · 固定其余参数 · 每格保留 trial_id · 未使用留出数据选优。');
  plot('M18.parameter_sensitivity_chart', trials.filter(row=>row.symbol==='DEMO-A'&&row.timeframe==='H1'&&row.threshold===1), '固定 threshold=1 后比较 lookback；三个点均能回到完整试验记录。');
  const compounded = values => round((values.reduce((e,r)=>e*(1+r),1)-1)*100);
  const split=[{sample:'前 8 月 · 演示训练段',net_return:compounded(net.slice(0,8)),start:'2025-10-01',end:'2026-06-01',months:8},{sample:'后 4 月 · 演示留出段',net_return:compounded(net.slice(8)),start:'2026-06-01',end:'2026-10-01',months:4}];
  plot('M18.validation_chart',split,'同一固定月度序列按 8 / 4 个月分段；区间长度不同，累计收益不能直接评价孰优。',{},'虚构月度结果的分段展示 · 并非真实训练或已通过样本外验证 · 两段未用于参数优选。');
  plot('M18.funnel_chart',[{stage:'去重候选信号',count:100},{stage:'满足筛选条件',count:64},{stage:'通过风险条件',count:48},{stage:'模拟可成交',count:36}], '100 个候选依次剩余 64、48、36 个；这些是包含关系的阶段计数。',{},'独立虚构信号运行 · 100 个唯一候选 · 筛选排除 36、风险排除 16、成交排除 12；不与月度净值或参数试验混用。');
  const netCash=round((equity-1)*100000), totalCost=round(costCash);
  plot('M18.pnl_chart',[{component:'已实现毛损益',amount:round(netCash+totalCost),role:'start'},{component:'佣金与滑点',amount:-totalCost,role:'delta'},{component:'净损益',amount:netCash,role:'end'}],`同一月度路径的毛损益减去 ${totalCost} USD 成本，得到 ${netCash} USD 净损益。`,{},'虚构月度组合 · USD · 成本按当期净值计提；毛损益为逐期净损益加实际扣费，不是忽略复利后的另一次无成本回测。');
  put('M18', {
    hypothesis: '检查固定筛选规则下的模拟组合表现及其对成本的敏感性；此处只演示结果结构。',
    universe: { 类型: '三个虚构资产篮子', 范围: '权益、债券、商品', 点时口径: '本例固定成分，无真实退市记录' },
    selection: { 规则: '演示筛选 v1', 逻辑: 'AND', 排序: '分数降序', 数量: 3, 并列: '固定资产顺序' },
    simulation: { 初始资金: '100000 USD', 权重: '权益 55%、债券 30%、商品 15%', 换仓: '每月复核', 成交时点: '示例月末价格', 收益来源: '确定性生成的虚构月度结果；不是已运行的市场回测' },
    window: { 开始: '2025-10-01', 结束: '2026-10-01', 观察频率: '月度', 验证分割: '本例无训练/验证分割', 规则版本: '演示 v1' },
    metrics: [{ 指标: '累计净收益', 数值: total, 单位: '%' }, { 指标: '年化净收益', 数值: total, 单位: '%（恰好一年）' }, { 指标: '基准累计收益', 数值: baselineTotal, 单位: '%' }, { 指标: '最大月度观测回撤', 数值: Math.abs(drawdown), 单位: '%' }, { 指标: '观察期数', 数值: 12, 单位: '月' }],
    benchmark: { 名称: '虚构比较基准', 期间: '同一十二个月', 币种: 'USD', 初始净值: 1, 口径: '含收益分配，未扣策略交易费' },
    positions: [{ 时点: '2026-10-01', 资产: '权益篮子', 权重: '55%' }, { 时点: '2026-10-01', 资产: '债券篮子', 权重: '30%' }, { 时点: '2026-10-01', 资产: '商品篮子', 权重: '15%' }],
    trades: [{ 状态: '未生成逐笔成交', 原因: '该示例提供月度结果；完整逐笔回测可引用原生 run/result/trade 数据' }],
    costs: { 每月净值扣除: '期初净值的 0.1%', 十二个月金额: round(costCash), 币种: 'USD', 包含: '示例佣金和滑点合计', 融资: '无杠杆融资假设' },
    assumptions: ['收益序列是固定的虚构结果，不来自真实证券价格。', '月度回撤不覆盖月内路径。', '策略和基准使用同一初始日和币种。'],
    validation: { 状态: '展示用模拟结果', 方法验证: '未运行独立市场回测或样本外评价', 证据: '固定月度净值和成本结果随报告保留' },
    artifacts: [{ 内容: '月度净值、回撤与成本结果', 来源: '报告固定研究结果 DataRef；展开图表可看原始行' }],
    logic_graph: { 状态: '本例未提供真实可执行策略源码', 说明: '完整策略报告沿用原生源码逻辑图、函数展开与参数下钻；这里不虚构与执行代码无关的图。' },
    parameter_trials: trials,
    selection_rule: { 试验组: '独立虚构参数训练集', 指标: '净收益降序', 并列: '较低回撤，再按 trial_id', 留出: '未参与选优', 固定标识: 'selected', 说明: '结果已在演示生成器中固定，报告不选优' },
  });
  const weights = [{ asset: '权益', current: 55, target: 50 }, { asset: '债券', current: 30, target: 25 }, { asset: '商品', current: 15, target: 15 }, { asset: '现金', current: 0, target: 10 }];
  const changes = weights.map(row => ({ asset: row.asset, change: row.target - row.current }));
  plot('M19.weights_chart', weights, '目标将权益和债券各降低 5 个百分点，新增 10% 现金；当前和目标权重都合计 100%。');
  plot('M19.changes_chart', changes, '权益 −5、债券 −5、商品 0、现金 +10 个百分点；这是待复核方案。');
  put('M19', {
    objective: '保留分散配置并增加 10% 现金，用于未来一个月的流动性需求。',
    constraints: ['目标现金不少于 10%', '权益不高于 60%', '仅作方案，不自动交易'],
    current_weights: weights.map(row => ({ 资产: row.asset, 当前权重百分数: row.current, 口径: '同一假设账户净资产' })),
    target_weights: weights.map(row => ({ 资产: row.asset, 目标权重百分数: row.target, 口径: '含现金的非杠杆多头组合' })),
    changes: changes.map(row => ({ 资产: row.asset, 变更百分点: row.change, 状态: '待复核' })),
    weighting_rules: { 方法: '用户目标下的固定演示权重', 版本: '演示方案 v1', 输入: '现有权重、10% 现金目标和权益上限' },
    rebalance: { 复核日: '2026-10-05', 触发: '用户确认方案后另行处理', 单边换手: '10%', 双边绝对变更: '20%', 费用假设: '交易名义额的 0.1%', 状态: '未安排交易' },
    benchmark: { 名称: '原 55/30/15 组合', 含义: '衡量流动性调整前后的差异', 币种: 'USD' },
    performance_refs: [{ 结果: 'M18 展示原权重组合的虚构月度表现', 适用范围: '目标新权重尚未评估，不将旧组合业绩移作新组合结果' }],
    risk_refs: [{ 结果: 'M12 当前组合风险结果', 适用范围: '目标组合压力测试需由指定方法补充' }],
    action_status: '研究方案，未安排或执行交易。',
  });
  const specialRows = [{ section_id: 'M10', field: 'profit_probability', value: profitable / optionCases.length, method_ref: 'demo/option-expiry-frequency@1', historical_basis: optionBasis, validation: { status: 'historical_exploration', note: '六个虚构同条款历史案例的净盈利频率，未作样本外验证。' } }];
  return { values, charts, findings, chartOptions, chartSources, optionCases, specialRows };
}
