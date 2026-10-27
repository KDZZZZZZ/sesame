# Autochartist 官方产品、报告与字段核对

检索日期：2026-10-26。范围：仅阅读公开官网、官方帮助中心与 API 文档；未登录、未访问客户数据、未调用分析数据接口或交易接口。本文是 Sesame 报告结构的研究输入，不是交易建议。

所有“合成示例”都是本次编写的结构示意，不是 Autochartist 当前输出、真实行情或历史回测。示例中的概率、价格与分数不得用作真实结论。下面的“原始字段”仅指官方文档正文或响应示例中实际出现的名称；“业务字段”是适合报告展示的概念；“建议字段”是 Sesame 可新增的元数据，不能冒充供应商 schema。

## 1. 核心结论与边界

1. Autochartist 有公开 REST API 文档及 OpenAPI 入口。技术形态、历史表现、事件分析、波动率、仓位计算、新闻情绪均有正式文档；不能笼统写成“具体字段不公开”。但识别器、子评分算法和若干概率汇总公式并未完整公开。[开发者目录](https://www.autochartist.com/developer-apis/)
2. “报告”至少要区分：单项分析结果、历史统计、风险计算、筛选/共振结果、市场快照与内容分发。Research Portal、MT4/5 Scanner、邮件和 ContentCast 是容器或交付方式，不应重复计成新的分析算法。[产品目录](https://www.autochartist.com/products/)、[Research Portal](https://www.autochartist.com/research-portal/)
3. 质量分、目标触及比例、事件条件概率、异常百分位、情绪分数和波动率区间是不同量。它们都不能直接命名为“交易胜率”。
4. 当前 Performance Stats、Our Favorites 文档与帮助页主要使用过去 12 个月；旧经纪商托管手册存在 6 个月说法。结构必须保存实际 from/to、版本及取数时间，不把窗口写死。[现行历史表现帮助页](https://tradersupport.autochartist.com/en/knowledgebase/article/performance-statistics)、[旧版托管手册，仅用于核对历史差异](https://d1fyjtrsl71uh.cloudfront.net/documents/tools-autochartist-user-manual.pdf)
5. API 是面向获得授权客户的服务，不是公开匿名行情 API。官方明确开发者产品不提供独立 Price data 或 Fundamental Data；Website Content 的营销页却提及 Fundamental Analysis 内容，两者属于不同交付范围，不能由内容名称推导出基础数据许可。[开发者目录](https://www.autochartist.com/developer-apis/)、[Website Content](https://www.autochartist.com/website-content/)

## 2. 分析模块

### A1. 图表形态：形成中 / 突破完成

已核实：三角形、通道、楔形、矩形、头肩、旗形、旗角形、双顶底等；当前 Scanner 页面还列出三重顶底。形成中说明形态尚未完成，突破结果说明价格穿过边界；形成中方向不能当作已经发生的突破。[技术分析](https://www.autochartist.com/technical-analysis/)、[Scanner](https://www.autochartist.com/products/market-scanner/)

| 最小业务字段 | 已公开的原始字段 | 使用要点 |
| --- | --- | --- |
| 结果、标的与周期 | result_type, result_uid, symbol, exchange, interval | 详情接口另用 granularity |
| 形态与阶段 | pattern, complete, direction | complete=false 为未完成；direction 是预测方向 |
| 时间与有效性 | identified, age, length, expires_at；详情 relevant | age/length 以蜡烛数计；失效与达标是不同状态 |
| 几何与目标 | support_x0/x1/y0/y1, resistance_x0/x1/y0/y1, prediction_price_from/to, prediction_time_to | 时间坐标、价格坐标与目标区域分开 |
| 解释 | analysis_text, trend_change | trend_change 为 Continuation / Reversal |

合成示例：EURUSD，60 分钟，Ascending Triangle，complete=false，identified=2026-10-26T10:00:00Z，length=40，预期向上但尚未确认；抵抗边界约 1.1050，目标暂缺。后续若收到 complete=true 的新/更新结果，再展示“已向上突破”。不是把同一行的未完成状态自行改成真实信号。

公开程度：形态几何、生命周期和解释字段公开；识别阈值、容差、去重规则及完整目标计算器未公开。官方公布了过期原则，包括年龄、转成完成形态及越过相关性边界等，但不足以逐点复现识别器。[Technical API](https://www.autochartist.com/ac_api_docs/Technical_Analysis_API.html)、[过期规则](https://tradersupport.autochartist.com/en/knowledgebase/article/autochartist-analysis-expiry-criteria)

### A2. Fibonacci 形态

已核实：当前 Scanner 列有 ABCD、3 Drive、3 Point Retracement、3 Point Extension、Gartley、Butterfly；旧帮助文只列四类，不能把旧列表当作当前完整目录。该模块同样有 emerging/complete，完成不等于突破形态同义词。[当前 Scanner](https://www.autochartist.com/products/market-scanner/)、[Fibonacci 帮助](https://tradersupport.autochartist.com/en/knowledgebase/article/benefits-of-fibonacci-patterns-for-identifying-support-and-resistance)

| 最小业务字段 | 已公开的原始字段 | 使用要点 |
| --- | --- | --- |
| 基础身份与阶段 | symbol, granularity, pattern_name, complete, direction | 沿用形态元数据 |
| 转折点价格和时间 | priceA/B/C/D/X, timeA/B/C/D/X | 这些斜杠表示展开的单独字段，不是一个字段名 |
| 比例/视觉/时间质量 | ratioQuality, averageQuality；快照详情另有 timeQuality, clarity | 保留原始量纲，不自行换算星级 |
| 目标阶梯 | target03, target05, target06, target07, target10, target12, target16 | 不自行将后缀解释为未经确认的百分比标签 |

合成示例：GBPUSD H4、ABCD、complete=true，A/B/C/D 四点有时间和价格；ratioQuality=0.84，averageQuality=0.72，target10=1.2800。报告文案：“转折比例较接近该模式的理想比例，给出若干潜在水平”，不能写“84% 获利概率”。

公开程度：点位与目标字段公开，ratioQuality 越接近 1 表示比例越接近理想；精确理想比例集合、容差及完整合成评分未公开。文档规定无适用点价格可为 -1、异常古老时间应忽略，需映射为缺失而非有效坐标。[Technical API](https://www.autochartist.com/ac_api_docs/Technical_Analysis_API.html)、[Market Snapshot API](https://www.autochartist.com/ac_api_docs/Market_Snapshot_API.html)

### A3. 水平关键位：接近 / 突破

已核实：水平支撑/阻力，以及 approaching 与 breakout。官方教育页说明窄幅范围内至少三次触碰构成关键位、触碰更多通常更显著；具体“窄幅”算法未给出。[关键位说明](https://tradersupport.autochartist.com/en/knowledgebase/article/horizontal-support-resistance-levels)

| 最小业务字段 | 已公开的原始字段 | 使用要点 |
| --- | --- | --- |
| 标的、周期、支撑/阻力与阶段 | symbol, granularity, pattern_name, complete, direction | approaching 不等于已经反弹 |
| 关键价、触碰点 | patternPrice, x0…x9；示例 qtyTP | 1970-01-01 触碰时间为占位符 |
| 接近/识别价和时间 | approachingRegion, approachingTime, atBarIdentified, atPriceIdentified | 接近区字段解释与样例尺度需接入验证 |
| 预测窗口 | predictionPriceFrom, predictionPriceTo, predictionTimeFrom, predictionTimeBars | 完成后有无目标仍以实际返回为准 |

合成示例：USDJPY H1，Resistance，关键位 150.00，历史触碰 4 次，识别价 149.85，complete=false；显示“正在接近阻力”，目标字段为空。不得把 150.00 自动写成止盈价或卖出建议。

公开程度：关键价与触碰、预测字段公开；触碰容差、显著性与突破确认参数未完整公开。[Technical API](https://www.autochartist.com/ac_api_docs/Technical_Analysis_API.html)

### A4. Japanese Candlesticks

已核实：Japanese Candlesticks 是当前技术分析模块，Scanner 示例包括 Hammer、Shooting Star、Engulfing、Harami 等。它不同于后面的“连续同方向蜡烛”统计异常。[技术分析](https://www.autochartist.com/technical-analysis/)、[Scanner](https://www.autochartist.com/products/market-scanner/)

| 最小业务字段 | 原始字段证据 | 使用要点 |
| --- | --- | --- |
| 标的、周期、名称、识别时刻 | 通用 symbol, interval/granularity, pattern/pattern_name, identified | 单一 result_type 枚举值未在本次公开样例中核实 |
| 阶段、方向、年龄、有效性 | 通用 complete, direction, age, expires_at/relevant | 不强加每类均有目标 |
| 解释与图 | 通用 analysis_text, drawing, links | 官方详情的专属字段列表为 None |

合成示例：某美股、H1、Hammer、识别时刻 2026-10-26T15:00:00Z、看涨含义、附图；不填未经来源提供的“蜡烛胜率”或自造专属质量分。

公开程度：类别、共用接口与解释公开；本次未查到该模块的完整形态判定阈值。[Technical API](https://www.autochartist.com/ac_api_docs/Technical_Analysis_API.html)

### A5. 形态质量指标（附属指标，不是独立概率报告）

| 最小业务字段 | 原始字段 | 公开解释 / 尺度 |
| --- | --- | --- |
| 总体质量 | quality | 图表形态原始值 0–1 |
| 清晰度、均匀性 | clarity, uniformity | 价格噪声/越界与形态内摆动分布，0–1 |
| 初始趋势 | initial_trend | 形成前趋势强度，0–1 |
| 突破与成交量 | breakout, volume | 0–1；breakout=-1 表示尚无突破，此时成交量评价不适用 |

合成示例：quality=0.70、clarity=0.80、uniformity=0.60、initial_trend=0.70；未突破时 breakout=-1。0.70 只能叫“原始质量分 0.70”，不能叫“70% 成功率”。

官方帮助将总体质量描述为其他质量指标的平均值，并解释各子项的考虑因素；各子分的精确计算、缺失项处理及不同资产成交量适用性没有足够公开细节。旧 UI 教育页谈到 10 格条形读数，这不能证明所有当前产品有星级或统一线性映射。Sesame 若自定星级，必须记为自己的展示转换。[质量说明](https://tradersupport.autochartist.com/en/knowledgebase/article/pattern-results-details)、[旧 UI 条形说明](https://tradersupport.autochartist.com/en/knowledgebase/article/getting-started-with-autochartist)、[原始 API 尺度](https://www.autochartist.com/ac_api_docs/Technical_Analysis_API.html)

### A6. Performance Statistics：历史预测表现

| 最小业务字段 | 原始字段 | 使用要点 |
| --- | --- | --- |
| 统计范围 | brokerId, group.name, breakout/emerging, category.name, value | 按资产/阶段/维度/桶分组 |
| 样本与达标数 | total, correct | correct 是触及指定目标的结果数 |
| 历史达标比例 | percentage | 文档明示 correct/total×100 |
| 窗口 | from, to | 原始日期优先于“过去 12 个月”文案 |

合成示例：2025-10-26 至 2026-10-26，EURUSD H1 某组 200 个结果，140 个触及指定目标，percentage=70。文案为“该历史分组目标触及率 70%（140/200）”。

公开程度：计数比例公式和分组字段公开；对所有模块一致的逐笔路径、止损先后、成本和获利计算不在此统计定义中。当前开发者概述着重 breakout chart patterns/key levels，详情与帮助又包含 emerging 分组，故不要凭概述删掉阶段维度。[Performance Stats API](https://www.autochartist.com/ac_api_docs/Performance_Stats_API.html)、[帮助页](https://tradersupport.autochartist.com/en/knowledgebase/article/performance-statistics)

### A7. 波动率分析与预期价格区间

| 最小业务字段 | 原始字段 / 公开形式 | 使用要点 |
| --- | --- | --- |
| 标的、计算时刻、时区 | symbol, datetime, timezone, timezone_offset | 区间不是持续实时成交价 |
| 基准价 | closing_price | 区间计算中心 |
| 多周期上下界 | low_15/high_15, low_30/high_30, low_60/high_60, low_240/high_240, low_1440/high_1440 | 周期为分钟；API 正文含 4h，目录摘要有省略 |
| 日内/周内图与排序 | day_of_week, from_time, rank, rank_rounded, links | 本次所见 schema 提供日内/周内图链接；未见完整逐桶数组 schema |

合成示例：EURUSD 基准 1.1000，1h 区间 1.0985–1.1015，4h 1.0970–1.1030，24h 1.0930–1.1070，计算时刻 12:00 UTC。此为双侧范围，并非看涨目标。

方法公开到：官方帮助称使用超过六个月历史，按星期和日内 15 分钟切片估计波动，以一标准差/约 68% 描述预期范围；API 每 15 分钟更新并提醒显示时注意最新价格偏移。未完整公开分布拟合、异常值处理、季节性估计、校准检验；68% 不是任意真实市场条件下的保证，更不是止盈概率。[波动率方法](https://tradersupport.autochartist.com/en/knowledgebase/article/volatility-analysis)、[Volatility API](https://www.autochartist.com/ac_api_docs/Volatility_Analysis_API.html)

### A8. 风险计算器：仓位规模

| 最小业务字段 | 原始字段 | 使用要点 |
| --- | --- | --- |
| 账户币种、交易对、合约类型 | account_currency, trade_pair, contract_type | contract_type 是 Standard/Micro/mini 等；大小写按实际契约验证 |
| 风险现金 | account_risk | API 说明为金额，不是未经转换的账户百分比 |
| 入场和止损 | entry_level, stop_loss | 与账户连接/自动下单无关 |
| 计算结果 | lot_size, risk_in_pips | 规模与止损距离 |

合成示例：USD 账户、EURUSD Standard，风险 $100，入场 1.1000、止损 1.0950。若约定 1 标准手=100,000 基础币且每 pip 每手=$10，则 50 pip、0.20 手。这是带明示合约假设的算例，不是调用供应商接口所得。

方法公开到：给定风险金额与价格距离求规模；接口输入输出公开。汇率转换时点、交易量步进和经纪商最小手数等必须由合同/实际接入确定。账户风险百分比、余额、敞口限额若需展示是额外业务字段，不冒充这个端点的已证实字段。[Risk Calculator API](https://www.autochartist.com/ac_api_docs/Risk_Calculator_API.html)

### A9. 宏观事件方向分析：事件前条件场景 / 事件后更新

| 最小业务字段 | 原始字段证据 | 使用要点 |
| --- | --- | --- |
| 事件与时刻 | country, country_name, name, event_type_code, event_uid, released_at, value | value 是已公布实际值；状态可据此派生但需标“派生” |
| 标的、样本、预测期限 | items[].symbol, sample_size, time_frame, trend_length | 总样本不一定是每个条件的样本数 |
| 条件与方向、概率、平均幅度 | opportunities[].id, probability, trend_direction, delta_sign, mean_mov, mean_mov_pips, mean_mov_value | 这些是实际响应示例的嵌套结构 |
| 历史事件行 | date, expected, actual, delta, delta_float, trend, trend_direction, delta_sign | 来自 history 端点 |

合成示例：虚构美国就业事件，发布前共参考 12 次历史事件；EURUSD，time_frame=120；一条场景为 delta_sign='>'、trend_direction=-1、probability=0.75、mean_mov_pips=18。应写“实际值高于共识的历史条件场景”，不写“本次公布值高于共识的概率 75%”。缺少该条件的 n 时须显示“条件样本数未提供”。

方法公开到：产品页称用最近 12 个月经济数据的 actual−expected，与预测期价格回归趋势做相关分析；最多高于、低于、等于共识三场景。API 有未来一周、最近公布、历史事件与内容端点。概率统计/筛选的完整计算未公开。[事件分析产品](https://www.autochartist.com/products/economic-event-analysis/)、[Economic Event Forecast API](https://www.autochartist.com/ac_api_docs/Economic_Event_Forecast_API.html)

核对限制：该 HTML 约 6.53 MB，web 阅读器超过 4 MB 限制；本次通过只读 HTTP 实际提取核对了字段正文与响应示例。正文把 delta_gt_up 等写成字段，样例则嵌套在 opportunities 并用 id 表示；delta_eq_down 文字说明还误写为 actual>consensus。这些是文档不一致，不能直接据此宣称真实生产 schema 已验证。

### A10. Economic Event Volatility / EEVI：事件幅度，不预测方向

| 最小业务字段 | 原始字段 | 使用要点 |
| --- | --- | --- |
| 事件元数据 | country, name, description, category, released_at | 类别含 group、frequency |
| 关联标的与估值约定 | symbol_volatility[].symbol；id, name, interval, exchange, pip_size, pip_value, value_currency, value_lot_size, value_date_time | 货币价值要随合约单位解释 |
| 正常/事件分布 | no_event_volatility, event_volatility | 内含 sample_size, min, p25, median, p75, max, mean, std_dev 及 *_pips |
| 金额与差异 | no_event_volatility_value, event_volatility_value, volatility_diff, volatility_diff_percent, volatility_diff_value | 差异对象不是新的概率分布 |

合成示例：某虚构 PMI 事件，EURUSD 事件后 1h，正常样本 n=900、median=12 pip，事件样本 n=24、median=30 pip；显示“事件条件下历史中位幅度高 150%”，不填看涨/看跌。所有 n 与数值均为合成。

EEVI 是确实存在的面向 FX dealing desk 的正式方案，且其“View API documentation”链接指向同一 Economic Event Volatility API。当前产品页写：滚动 12 个月、一小时事件窗口、每周末刷新、未来 7 天、18 FX pairs、61 events/九个国家或经济区域。它与广义事件方向产品宣称的 140+ 事件范围不是同一个覆盖契约。API 说明又写“next 10 items”，7 天和条数上限不能相互替代。[EEVI](https://www.autochartist.com/economic-event-volatility-intelligence/)、[Economic Event Volatility API](https://www.autochartist.com/ac_api_docs/Economic_Event_Volatility_API.html)

公开程度：分布输出与主要时间窗口公开；事件-标的关联判定、样本筛选完整实现未公开。volatility_diff.std_dev 可以为负，因为它是两种标准差之差；不能误判为“标准差必须非负”的原始分布字段。

### A11. 统计异常：Extreme/Big Movement、Consecutive Candles、Round Numbers

| 子类 | 最小业务字段 | 已公开原始字段 / 限制 | 合成示例 |
| --- | --- | --- | --- |
| Extreme / Big Movement | 标的、周期、起止价、幅度、异常百分位、识别时间 | 共用字段 + from_price, to_price, movement, percentile | EURUSD H1 从1.1000到1.1060；异常百分位按0–1尺度为0.98；不代表98%续涨 |
| Consecutive Candles | 标的、周期、连续方向与根数、百分位、预测方向 | 共用字段 + from_price, to_price, qty_candles, percentile | USDJPY H4连续6根上涨，percentile=0.97；预测 direction可另为-1，不能把历史上涨与预测下跌混为同字段 |
| Round Numbers | 标的、整数关口、接近/穿越状态、发生时间、解释 | 产品存在；本次未找到专属 raw 字段/枚举，勿把建议 round_level 当供应商字段 | BTCUSD 接近100000关口；关口值和状态按“业务字段”展示，尚待授权样例映射 |

已核实的连续蜡烛方法：最多回看 600 根，按标的、方向和周期建立经验分布，异常阈值描述为累计 95%，滚动更新。它是历史稀有程度；向前可以既被解读为延续也被解读为修正。Big Movement 帮助页的 Statistical Details 内容误用了连续蜡烛的说明，因此不能把这段复制文案当作 Big Movement 精确算法。[统计模块](https://www.autochartist.com/statistical-analysis/)、[连续蜡烛方法](https://tradersupport.autochartist.com/en/knowledgebase/article/consecutive-bullbear-candles)、[Big Movement 帮助中的不一致](https://tradersupport.autochartist.com/en/knowledgebase/article/identifying-large-movements)

raw 尺度必须谨慎：Market Snapshot 的说明写 percentile 通常≥95，Market Alerts 响应样例实际给 0.980000…；不能无条件统一乘100或直接加百分号。保留来源端点、原值和 scale，授权接入时验证。[Market Snapshot API](https://www.autochartist.com/ac_api_docs/Market_Snapshot_API.html)、[Market Alerts API](https://www.autochartist.com/ac_api_docs/Market_Alerts_API.html)

### A12. News Sentiment：新闻情绪及变化

| 最小业务字段 | 原始字段 | 使用要点 |
| --- | --- | --- |
| 标的、行业、观察时间 | ticker 为对象键；ticker_info.name/sector；ISO日期为对象键 | 不是一律 flat rows |
| 分数与类别 | sentiment_score, sentiment_indicator | 文档样例中分数常为字符串；不是0–1概率 |
| 来源与提及量 | total_sources, total_mentions, source_info, mentions_volume | 新闻覆盖度与情绪分开 |
| 情绪变化 | datetime_from, sentiment_change_value, score_from, score_to | extreme_score_change 端点 |
| 历史 | sentiment_score, mentions_volume, sentiment_indicator, quantity_indicator | 历史与当前端点同名 mentions_volume 存在不同表现 |

合成示例：AAPL、观察日2026-10-26，score_from='20'、score_to='55'、sentiment_change_value='35'，8个来源、60次提及、positive。35是分值变化，不能说“涨35%”或“上涨概率55%”。

官方覆盖主要货币和美国股票；API 还提供行业、来源、历史、显著情绪及极端变动查询。可确认的公开阈值：单日绝对分值变化达到30为极端变化；转入低于−60或高于60的区域为显著情绪。模型、来源加权与整体尺度上下限未在本次所读页面完整说明，不据此伪造可复现 NLP 模型。[产品](https://www.autochartist.com/products/news-sentiment-analysis/)、[News Sentiment API](https://www.autochartist.com/ac_api_docs/News_Sentiment_API.html)

## 3. 筛选、聚合与分发

### B1. Our Favourites / Favorites：历史表现筛选视图

| 最小业务字段 | 原始字段 | 使用要点 |
| --- | --- | --- |
| 形态身份 | result_uid, result_type, symbol, interval, pattern, identified | 来自技术机会流 |
| 概率总值 | probabilities.percent | 已是百分比尺度，不再乘100 |
| 时段/标的/形态统计 | hod_percent/correct/total, symbol_percent/correct/total, pattern_percent/correct/total | 三个边际维度不是同一个交叉样本 |
| 目标与生命周期 | probabilities.forecast, expires_at；可有 signal_levels | 不把筛选结果视为独立预测算法 |

合成示例：某 Falling Wedge，probabilities.percent=68.5，symbol_correct/total=132/200、hod_correct/total=70/100、pattern_correct/total=140/210。总值为合成供应商字段示意，不由这三个比例自行推算。

确认：它是 Technical Analysis 的历史筛选视图；现行文档使用12个月。筛选 probability_percentage 默认60，公开可选档位为60/65/70/75/80。总概率的组合权重、平滑或最低样本规则未公开，不能声称只是三者平均，也不能把其概率与视觉质量混用。[Our Favorites API](https://www.autochartist.com/ac_api_docs/Our_Favorites_API.html)、[产品说明](https://www.autochartist.com/products/our-favourites/)

### B2. Correlating Alerts：同向技术结果聚合

| 最小业务字段 | 原始字段 | 使用要点 |
| --- | --- | --- |
| 标的、方向与时间 | id, symbol, direction, gmt_time_found | direction示例契约1/-1 |
| 参与形态 | patterns[].type/name/result_uid/time_granularity/chart_url | 保留子结果引用和不同周期 |
| 突破价与目标 | breakout_price, forecast_price, forecast_pips | 一些数值以字符串返回 |
| 历史概率与文字 | percent_probability, nlg_text.TITLE/FULL/TEASER/CTA | 完整组合评分未公开 |

合成示例：EURUSD看涨，H1图形突破与H4水平阻力突破同时指向上方；patterns含两个来源，forecast_price='1.1120'、percent_probability='72'。只能称“两个结果同向”，不能称“两个独立证据使胜率相乘”。

方法公开到：至少两个 trade setups 同意潜在运动方向；复杂共振算法未公开。“Correlating”不是跨资产收益率相关系数报告。[产品说明](https://www.autochartist.com/products/messaging-and-alerts/correlating-alerts/)、[Correlating Alerts API](https://www.autochartist.com/ac_api_docs/Correlating_Alerts_API.html)

### B3. Market Report / Market Snapshot：分时段市场简报

| 最小业务字段 | 原始字段 | 使用要点 |
| --- | --- | --- |
| 报告身份与生成时刻 | report_id, report_uid, generated, session | session为US/EU/AS |
| 标题与摘要 | messages.name/heading/report_description/indicator_description/date | 此处 messages 实例为对象，正文有“array”说法 |
| 单标的结果 | symbol_reports[], symbol_report_id, result_uid, symbol, symbol_display, interval, type, direction | 不重复计算成新的独立信号 |
| 时间和价位 | forecast_length, forecast_time, pattern_end_time, levels[].type/label/level/date_time | 分离目标价与支撑/阻力 |
| 辅助指标与文字 | rsi_direction, ma_direction, favourite, messages, supporting_indicator | 快照可附辅助解释 |

合成示例：report_uid='synthetic-20261026-EU'、session='EU'、生成于06:00 UTC；包含3个技术机会、过去24小时显著波动摘要及未来8小时事件提示。每个机会仍保留自己的生成和失效时间，不能用整份简报日期覆盖。

确认：官方日邮件在东京、伦敦、纽约交易时段前每天3次；技术展望可覆盖8小时至5天，附24h movers与未来8h事件。它是市场技术快照和内容产品；并无证据说明每条由署名分析师手写。数据端有报告类型、实例、内容、图片和形态详情端点。[Market Report](https://www.autochartist.com/products/messaging-and-alerts/market-report/)、[Market Snapshot API](https://www.autochartist.com/ac_api_docs/Market_Snapshot_API.html)

### B4. 容器和分发：Research Portal、Scanner、邮件/消息、Website Content、ContentCast

| 交付产品 | 实际确认 | 最小业务字段（不冒充 raw schema） | 合成示例 |
| --- | --- | --- | --- |
| Research Portal / MT4/5 Scanner | 集合分析工具、搜索与展示入口 | 交付渠道、底层模块、来源结果ID、更新时间 | “门户中的H1形态结果”，引用原信号ID |
| 邮件/短信/Push/Telegram/LINE | 现有分析的通知渠道，含预事件/事件时提醒 | 通知类型、生成/事件/失效时间、模块引用、语言 | “事件前2小时通知”，携带A9场景 |
| Website Content | 可发布研究内容到CMS，官网称最高每天8次 | 标题、正文、发布日期、语言、主题、证据引用、作者/生成来源（若有） | “EURUSD技术展望”，作者未提供则留空 |
| ContentCast | 定期捕获客户已有网页内容，适配并分发至持久URL | 来源URL、捕获时间、资产URL、渠道、语言、内容版本 | 捕获客户07:00分析文章，再分发至邮件素材URL |

确认边界：ContentCast 页面提到 analyst report 是它可捕获的内容例子，不能据此新增“Autochartist 专业分析师署名报告 API”。Website Content 有研究文章服务，但本次未查到可通用于全部文章的公开内容 schema、作者签名要求或人工审稿流程。门户/渠道均不产生独立交易胜率。[Research Portal](https://www.autochartist.com/research-portal/)、[Messaging & Alerts](https://www.autochartist.com/products/messaging-and-alerts/)、[预事件邮件](https://www.autochartist.com/products/messaging-and-alerts/pre-event-trading-opportunities/)、[Website Content](https://www.autochartist.com/website-content/)、[ContentCast](https://www.autochartist.com/contentcast/)

## 4. 实际字段名称清单（可供字段词典使用）

以下汇总此次已读文档正文或样例中与报告相关的字段，不声称穷尽所有私有或已授权生产字段。斜杠/省略号只是为阅读压缩，最终 schema 应展开；同名字段须带 source_endpoint 与 JSON path，不能仅凭名字合并。

| 来源/层级 | 已确认名称 |
| --- | --- |
| 通用响应封装 | date, query, page, items, new, data, links；分页 number, limit, offset, total_items, total_pages；链接 rel, href, display, enabled, active |
| Technical / Market Alerts 顶层结果 | result_type, result_uid, direction, prediction_time_to, prediction_price_from, prediction_price_to, pip, exchange, group_name, symbol, symbol_name, symbol_id, interval, pattern, pattern_list, complete, identified, age, length, found, analysis_text, analysis_text_list, analysis_text_template, expires_at, signal_levels, detail, drawing, target_period_list, symbol_pip；多语项 locale, text |
| signal_levels（正文/样例） | entry_level, stop_loss, target_level, target_period；Market Alerts样例另有 target_period_in_min |
| 详情共用 | symbol, exchange, short_name, long_name, age, complete, direction, granularity, forecast_minutes, is_new, length, pattern_start_time, pattern_end_time, pattern_name, relevant, result_uid；样例另有 pattern_id, symbol_id, prediction_pip_profit, symbol_pip |
| 图形形态详情 | breakout, clarity, initial_trend, quality, uniformity, volume, trend_change, qty_tp, prediction_price_from, prediction_price_to, prediction_time_to, resistance_x0, resistance_x1, resistance_y0, resistance_y1, support_x0, support_x1, support_y0, support_y1, pattern_start_price, pattern_end_price；样例有 stop_loss, take_profit |
| Fibonacci详情 | averageQuality, priceA, priceB, priceC, priceD, priceX, timeA, timeB, timeC, timeD, timeX, ratioQuality, target03, target05, target06, target07, target10, target12, target16；Snapshot另列 clarity, patternEndPrice, patternStartPrice, qtyTP, timeQuality；内部项 priceAdjustment, instrumentId, bandwidth, temporaryPattern |
| Key Level详情 | patternPrice, approachingRegion, approachingTime, atBarIdentified, atPriceIdentified, furthestPrice, predictionPriceFrom, predictionPriceTo, predictionTimeFrom, predictionTimeBars, x0, x1, x2, x3, x4, x5, x6, x7, x8, x9；样例另有 bandwidth, errorMargin, qtyTP, priceE, barsE, temporaryPattern |
| Big Movement / 连续蜡烛 | from_price, to_price, movement, percentile, statistical_movement；qty_candles, statistical_qty_candles, use_relevance_logic；Market Alerts样例另有 use_exact_pattern_end_time, use_exact_pattern_start_time |
| drawing | symbol, arrow, length, timeZone, forecast, timeFrame, originalLines, eventLine, chartType, interval, lines, priceRange, direction, predictionRectangle；图元 point1Name, point2Name, name, x1, x2, y1, y2；timeFrame.from/to；priceRange.low/to（保持原样，不擅改成high） |
| Performance Stats | brokerId, from, to, group, name, breakout, emerging, category, data, value, total, correct, percentage |
| Our Favorites | defaultGroupId, symbolGroups, id, name；结果共用字段；probabilities.result_uid, percent, hod_percent, hod_correct, hod_total, symbol_percent, symbol_correct, symbol_total, pattern_percent, pattern_correct, pattern_total, forecast |
| Volatility | datetime, result_uid, groupid/group_id, broker_id, symbol, longname, display_name/display_symbol, exchange, symbolid/symbol_id, hourly_symbolid/hourly_symbol_id, day_of_week, from_time, closing_price, low_15, high_15, low_30, high_30, low_60, high_60, low_240, high_240, low_1440, high_1440, timezone_offset, timezone, rank, rank_rounded, returnSymbols；正文/样例命名有差异 |
| Risk输入/输出 | account_currency, trade_pair, contract_type, account_risk, entry_level, stop_loss → lot_size, risk_in_pips |
| Economic Forecast事件 | country, country_name, name, description, event_type_code, event_uid, category, released_at, value, items；category.code/name/base_code/group/frequency；组与频率均有 code/name |
| Economic Forecast机会 | uid, sample_size, time_frame, symbol, trend_length, opportunities；symbol.id/name/interval/exchange/pip_size/pip_value/value_currency/value_lot_size/value_date_time；opportunities.id/probability/trend_direction/delta_sign/mean_mov/mean_mov_pips/mean_mov_value |
| Economic Forecast条件名称与历史 | delta_gt_up, delta_lt_up, delta_eq_up, delta_gt_down, delta_lt_down, delta_eq_down（样例里作为opportunities.id值）；date, expected, actual, delta, delta_float, trend, trend_direction, delta_sign |
| Event Volatility / EEVI | 事件元数据同上；symbol_volatility, symbol, no_event_volatility, no_event_volatility_value, event_volatility, event_volatility_value, volatility_diff, volatility_diff_percent, volatility_diff_value；分布 sample_size, min, min_pips, p25, p25_pips, median, median_pips, p75, p75_pips, max, max_pips, mean, mean_pips, std_dev |
| Correlating Alerts | id, gmt_time_found, broker_id, base_group_name, broker_symbol_group_id, symbol, symbol_id, direction, breakout_price, forecast_price, forecast_pips, percent_probability, nlg_text, patterns, online_translate；nlg_text.TITLE/FULL/TEASER/CTA；patterns.type/name/result_uid/time_granularity/chart_url |
| News Sentiment | ticker_info, name, sector；sentiment_score, sentiment_indicator, total_sources, total_mentions, mentions_volume, top_mentioned, current_news, source_info；变化 datetime_from, sentiment_change_value, score_from, score_to；历史 quantity_indicator；ticker与日期常为动态对象键 |
| Market Snapshot报告 | report_id, report_uid, generated, session, messages, symbol_reports；类型目录 name, last_updated；messages.name/heading/session/report_description/indicator_description/date |
| Market Snapshot单标的 | type, result_uid, symbol_report_id, direction, rsi_direction, ma_direction, symbol, symbol_display, interval, forecast_length, forecast_time, pattern_end_time, favourite, levels, messages；levels.type/label/level/date_time；文字样例 symbol_name, analysis, data_interval, resistance_level, support_level, target_level, target_period, chart_start_date, chart_end_date, supporting_indicator, pattern_length, identified, pattern_name；价位文字对象 level/label/description |
| 鉴权与查询（不是报告业务指标） | broker_id, user, account_type, expire, token；正文亦出现 brokerid/accounttype/expiry 拼写。技术查询 group, locale, locales, timezone, include_detail, include_drawing, page_limit, page_offset, since；Favorites result_limit, probability_percentage；情绪 search, sector, sentiment, strong_sentiment, include_detail, date_input；共振 start_time, base_group_name, symbol, direction, online_translate |

清单依据：[Technical](https://www.autochartist.com/ac_api_docs/Technical_Analysis_API.html)、[Market Alerts](https://www.autochartist.com/ac_api_docs/Market_Alerts_API.html)、[Performance](https://www.autochartist.com/ac_api_docs/Performance_Stats_API.html)、[Favorites](https://www.autochartist.com/ac_api_docs/Our_Favorites_API.html)、[Volatility](https://www.autochartist.com/ac_api_docs/Volatility_Analysis_API.html)、[Risk](https://www.autochartist.com/ac_api_docs/Risk_Calculator_API.html)、[Event Forecast](https://www.autochartist.com/ac_api_docs/Economic_Event_Forecast_API.html)、[Event Volatility](https://www.autochartist.com/ac_api_docs/Economic_Event_Volatility_API.html)、[Correlating](https://www.autochartist.com/ac_api_docs/Correlating_Alerts_API.html)、[Sentiment](https://www.autochartist.com/ac_api_docs/News_Sentiment_API.html)、[Snapshot](https://www.autochartist.com/ac_api_docs/Market_Snapshot_API.html)。均于2026-10-26核查；文档标题多数为1.0.0，不代表生产数据已测试。

## 5. 尺度与 schema 风险：报告不能静默修正

| 情况 | 已看到的证据 | Sesame 建议处理（本研究建议） |
| --- | --- | --- |
| 原始质量与 UI | quality等0–1；旧UI出现10格条形 | 保存 raw_value/raw_scale；UI转换另记，不称星级或概率 |
| 异常百分位 | Snapshot描述≥95，Market Alerts样例约0.98 | 按端点版本明确scale，不靠数值猜测 |
| 概率尺度 | Favorites.percent≈69；事件probability≈0.75 | 分别percent与fraction，禁止直接比较或相加 |
| 机会方向 | 连续上涨样例的direction=-1，文本预测下跌 | 历史行为方向与预测方向分栏 |
| 阶段不一致 | Market Alerts样例顶层complete=true，detail.complete=false | 原值保留并标一致性问题；未验证前不能随意择一 |
| 空/占位 | 价格-1、目标0、1900/1970时间、未适用volume | 依字段契约归一化；不把0视作所有字段通用缺失 |
| 时间含义 | identified、expires_at、prediction_time_to、forecast_time、generated不同 | 分别表示检测、失效、目标期限、报告生成；不得共用updated_at替代 |
| 大整数ID | 示例包含约6×10^17的result_uid | JS Number会丢精度；接入前确认可用文本ID/无损JSON路径 |
| 文档与示例差异 | details/detail、groupid/group_id、display_name/display_symbol；messages正文array但样例object | 构建适配层前取授权样例/供应商确认；本文不是生产SDK契约 |
| 字符串数值 | 情绪分数、共振价格/概率等 | 同时保留原始表示，规范化用显式解析和失败状态 |

本表的代码风险判断是对公开样例的工程推论，不是已复现线上故障。不要复制文档里嵌入的示例 user/token，也不要把它们当可用授权。

## 6. 为什么这些方法不等同交易胜率

| 指标 | 实际衡量对象 | 不等同交易获利的原因 |
| --- | --- | --- |
| quality / ratioQuality | 几何或视觉拟合 | 没有记录一笔交易的资金、执行和盈亏 |
| Performance percentage / Favorites | 历史目标触及或筛选统计 | 触及目标前可能先经过止损；缺少入场规则、成本、滑点和仓位；分组也可能小样本 |
| 事件 probability | 给定经济数据意外方向时的历史价格趋势 | 不是事件结果本身发生概率，也不是用户实际可成交的盈利概率 |
| percentile | 已发生走势在历史分布中稀有程度 | 稀有可能接续也可能反转；不是反转概率 |
| 波动范围 / 事件幅度 | 运动大小或历史区间 | 双侧幅度不能提供上涨方向与止盈先后 |
| sentiment_score | 新闻文本情绪 | 情绪与价格反应、估值和成交时机之间没有一一对应关系 |
| 共振 | 同向预测的聚合 | 输入来自同一价格序列，不能默认统计独立或简单相乘 |
| Risk Calculator | 预设止损下的名义规模 | 不预测方向，也不保证跳空时按止损价成交 |

上述区别由各字段定义推导；收益还取决于完整策略与执行模型。官方也明确过去表现不能保证未来，内容属于一般市场评论。[官方免责声明](https://www.autochartist.com/disclaimer/)

## 7. API、许可与 MCP 可接入性

- 可核实：官方 REST/JSON/OpenAPI、图像/绘图数据/本地化文本、Web Components/iFrame、门户和平台插件；官方支持页还提到 XML/JSON 与需申请权限的 Zapier。公开文档不等于免费使用权。[开发者入口](https://www.autochartist.com/developer-apis/)、[官方集成选项](https://support.autochartist.com/en/knowledgebase/article/overview-of-autochartist-integration-options)
- 鉴权：文档要求供应商提供 broker_id 与 secret，使用 user/account_type/expire/token；secret不可交给终端用户。未申请或使用任何凭证。各接口字段拼写和LIVE/DEMO编码应按实际端点验证。
- 许可：公开条款是一般服务条款，本次没查到允许任意再分发、永久缓存、商业二次售卖或训练模型的通用授权。集成前应取得客户合同对展示渠道、用户/资产范围、缓存留存、截图/正文再分发、衍生摘要与LLM处理的授权；这是待确认清单，不是断言法律禁止。[服务条款](https://www.autochartist.com/terms-and-conditions/)
- MCP：检索了官网开发者目录、官方集成页，以及站内“MCP”“Model Context Protocol”查询，未发现官方公开 MCP server 文档。这是“本次未找到”，不是证明不存在。技术上可在已授权REST之外做只读MCP适配层；这属于 Sesame 的工程方案，不能宣称是现成官方MCP。
- 对 Sesame 的适合路径：先建立 provider/version/source_endpoint/source_path、retrieved_at/as_of、asset/timezone、raw_value/scale/unit、sample/window、state/expiry、method_disclosure/source_url 等自己的元数据层，再映射各模块。必须保留“未知/缺失/未公开”，而不是给缺失字段补一个看似完整的概率。

## 8. 留待授权接入验证的问题

1. 当前授权实际包含哪些模块、市场、周期、延迟、语言和历史深度；不能按总目录推断每个客户都有。
2. raw schema 与公开样例差异、ID精度、概率/percentile尺度、字段空值和时间区间语义。
3. Performance的准确达标窗口与路径判定、Our Favorites概率组合、最低样本阈值及实际from/to。
4. Round Numbers与Japanese Candlesticks的生产枚举/专属字段；本文保留业务结构而未自造raw键。
5. 所有图、文本、聚合摘要、缓存和二次分发许可；是否存在未公开的官方MCP/新版接口。

本次核查已完成；没有推测专有评分实现，也没有把任何合成例子冒充供应商真实输出。
