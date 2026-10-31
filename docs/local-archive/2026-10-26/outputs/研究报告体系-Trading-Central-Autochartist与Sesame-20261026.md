# 研究报告体系：Trading Central、Autochartist 与 Sesame

2026-10-26 · 产品研究与改进方案 · 基于官方资料和当前源码

**建议把 Sesame 报告升级为“业务问题驱动的模块组合”：每个模块约定所需字段、判断方法和可视化，主 agent 按任务选择一个或多个模块。** Trading Central 适合参考研究维度、条件情景和多维综合；Autochartist 适合参考技术事件结构、生命周期、几何数据和历史统计。Sesame 已有相当部分数据与计算底座，优先补齐字段契约、点时数据和方法验证，收益会比重新制作一套报告页面更大。

这份文档覆盖原稿的16类研究输出，补入 Autochartist，并扩展到 **20类TC报告/模块、18类AC分析/聚合/交付形式和3类Sesame延伸报告**。它们不是41个独立官方产品或API。附录把字段合并为 **244个业务字段组、13类**，再完整归类本次查到的 Autochartist 机器字段。所有数字示例均为合成，彼此独立；官方事实、自有设计和当前实现分开表述。

[TOC]

## 1. 原材料哪些可以保留，哪些需要修正

原稿方向正确：研究产出可以同时包括事实、状态诊断、候选机会、模型预测、条件行动和综合解释。需要修正的是评分尺度、数据来源、方法版本，以及“有产品介绍”与“已经知道API字段”的差别。

| 原稿或常见推断 | 核对后的结论 | 对Sesame的影响 |
| --- | --- | --- |
| 16种报告等于16种官方接口 | 原稿已说明是按用途归类；其中止损、估值是组件，日报是组合，FIBI是叙述层 | 用“模块—组合—交付”三层目录，避免重复建设 |
| 所有0–100分数都可互相比较 | TC旧教程1–10和2024起可见的0–100实例并存；情绪、趋势、质量又是不同对象 | 保存原尺度、标签、模型版本；不自行乘10或当作概率。[旧教程][T06]、[2024实例][T28] |
| 公允价值、12月目标价、分析师目标价是一项 | 分别是估值模型、TC价格模型和分析师共识；更新时间与期限也不同 | 三列并排，不能相互补空或合并取平均。[估值][T08]、[目标价FAQ][T07]、[共识][T09] |
| 新闻库有社交，因此情绪分必用社交 | 当前Buzz FAQ把Stocktwits等单独显示，不纳入该情绪评分；Fear Index又有自身来源口径 | 每种情绪产品独立记录语料与版本。[Buzz][T14]、[Fear][T17] |
| 情绪强弱、趋势直方图、Confidence是同一信号 | 分别描述文本倾向、情绪变化趋势和证据量等级；不是同一种置信度 | 72分情绪与46分趋势直方图可以同时存在，后者低于50不等于价格必跌。[教程][T15]、[Monitor][T16] |
| Strategy Builder只知道大概思路 | 官方FAQ公开了AND筛选、排名和回测规则；任意OR未核实 | 可学习规则透明度，但不能照搬后便称充分验证。[方法FAQ][T20] |
| Autochartist字段都不公开 | 技术、波动、风险、事件、情绪、历史统计有公开API文档；识别器与部分评分公式不完整 | 可以设计适配器；原厂结果仍需授权，不用猜接口。[开发者目录][A01] |
| 质量70%或历史达标70%就是交易胜率70% | 质量是形态拟合；达标统计看目标是否触及，可能没考虑先止损、成本或实际入场 | 质量、目标触及率、条件方向频率、净盈利率分别存储。[质量][A04]、[统计][A06] |
| AC统一看过去6个月 | 当前Performance/Favorites主要写12个月，波动率帮助另用超过6个月样本 | 保存每次真实from/to与方法版本，不全局写死。[统计][A06]、[Favorites][A17]、[波动方法][A08] |
| 看见通用执行工具，就等于分析方法已实现 | Sesame有取数、计算和执行环境，但很多专业模型仍需固定规则 | 区分“已有算法”与“有原料、可以开发”，详见第5节 |

**历史例子处理。** 原稿Kohl’s旧官方链接本次先读到匹配缓存、随后404；非农“70k、67.2/−37.7pip”原文未重新独立取得；2022日报文字可核实，但不代表当前观点。本报告用可复算的合成例子解释字段，不继续把未核实旧数字当作当前证据。另有官方期权文章出现风险与盈利金额不完全闭合的疑点，详见[核对笔记](Trading-Central-非技术领域核对-20261026.md)。

## 2. Trading Central：报告与分析模块目录

下面的字段是**适合Sesame采用的业务结构**；只有明确写“原始键”的名称才是在官方资料中确认的机器字段。诸如分析师人数、期权流动性、事件置信区间等有助于研究，但不保证每个TC接口都返回。

### 2.1 技术、形态与风险

| 编号 / 类型 | 解决的问题与字段 | 合成示例 | 公开判断方法与实现判断 |
| --- | --- | --- | --- |
| **TC01 Technical Views：技术交易情景** | 标的、参考价、发布时间、日内/短中期方向；主备情景、入场价/区域、Pivot失效位、止损、目标1/2、关键位重要性、理由、标注图 | 现价100；收盘突破103后观察回踩；98失效；目标110/115；跌破98则原多头观点失效 | 人工分析与技术工具结合；Pivot不是传统OHLC公式支点。2026版补入entry zone、RR和多期限叙述。Sesame已有原料，需统一情景规则。[FAQ][T01]、[更新][T05] |
| **TC02 Technical Insight：技术事件/形态** | Event Type/Date、pattern、方向、形成/完成/失败、技术汇总、RSI/MACD/MA/stochastic/volume、SR、目标区域、事件历史 | 矩形高度10，在57突破；自有高度法目标67；均线金叉只记录事件，不硬配67目标 | 部分经典几何形态可用突破±高度；振荡器/均线交叉没有同样的目标公式。Sesame已能做基础指标/突破，完整形态库仍缺。[方法FAQ][T02] |
| **TC03 Stop & Risk：风险/止损组件** | 当前价、持仓方向、波动、结构位、tight/medium/loose trailing stop、止损表现、预算与规模 | 价格100；自定义三档止损98/96/92，固定风险下仓位随止损距离增大而下降 | TC按波动给止损偏移；完整参数未公开。Sesame有ATR退出与仓位基线，可制定自有三档，不冒充TC系数。[FAQ][T02] |
| **TC19 Alpha Generation：平台指标模块** | Technical Views叠加、Adaptive Candlesticks形态、ADC快慢线/振荡器、触发时刻与方向 | 某闭合bar出现吞没形态，同时ADC由负转正；保留两项事实 | 官方教程描述16种自适应蜡烛形态及ADC框架；自适应周期/过滤器未完整公开。可接授权结果或做不同名称的自有指标。[教程][T04] |

Technical Insight 教程里的短期2–6周、中期6–39周、长期9个月至2年以上，是其研究期限定义，不能机械映射成H1/H4/D1。TC历史技术方法中的偏好RR也不应升格为所有任务强制门槛。[Technical Insight][T02]、[历史方法][T03]

### 2.2 基本面、估值与分析师

| 编号 / 类型 | 关键字段 | 合成示例 | 方法与当前Sesame差距 |
| --- | --- | --- | --- |
| **TC04 Fundamental Insight：五因子基本面** | 公司/行业、价格/市值/表现、综合分、Value/Growth/Momentum/Income/Quality、标签、财务指标、同业排名、周期适配 | 自有综合68/100；Value82、Growth54、Momentum63、Income43、Quality71；40家同业中第8 | 原厂权重与全套标准化未公开。Sesame已有SEC/FMP财务原料，需补TTM、比率、行业主表和自有评分模型。[教程][T06]、[因子方法][T25] |
| **TC05 Fair Value & Target：估值和模型目标** | Fair Value、相对现价上行/相对公允值折价、自有12月目标、模型日期、假设、敏感性 | 现价100，FV120：上行20%、相对FV折价16.67%；12月目标112：上行12% | TC FV采用两阶段剩余收益，月15日更新；自有目标固定月更。内部假设未全公开。Sesame需实现估值模型并单列市场价格预测。[Fair Value][T08]、[目标][T07] |
| **TC06 Analyst Consensus：共识** | 总体评级、评级数量/分布、目标均值/低/高、覆盖、日期、期限与分歧 | 12 Buy/6 Hold/2 Sell（自有展示例）；目标85/115/145，现价100 | 目标与评级是意见汇总，不等同TC自有模型；人数明细是否由TC返回需授权schema确认。Sesame现有FMP grades只有变动事件，需新增共识端点。[官方说明][T09] |
| **TC20 Quant Indices：指数/组合方法** | 投资池、因子、成分、权重、行业控制、再平衡、基准、实际/模拟业绩 | 50股各2%，按月再平衡 | TC指数方法与Strategy Builder的季度筛选回测是两套规则；Sesame适合把它作为组合构建报告，而非塞入普通个股评级。[方法][T25] |

2026发布记录确有 `growthLabel / incomeLabel / momentumLabel / qualityLabel / valuationLabel / quantamentalLabel`，示例包含`id/name`；**原始分、原始尺度、标签和版本一起保存**，没有分档阈值时不反推。[发布记录][T07]

### 2.3 宏观、事件、新闻与情绪

| 编号 / 类型 | 关键字段 | 合成示例 | 方法与当前Sesame差距 |
| --- | --- | --- | --- |
| **TC07 Economic Insight：事件影响** | 事件、国家/货币、发布时间、actual/forecast/previous、预期差类别、资产、观察窗、TR/pips、净变动、历史组统计与图 | 数据90k、预期70k、前值60k；EURUSD发布后1h净变动−30pip、TR60pip；同组历史12次 | 按预期差分组研究历史反应；不把“高于预期”一概判利多。Sesame缺结构化首发共识与事件样本匹配层。[教程][T10] |
| **TC08 Economic Calendar：宏观时间表** | 指标/国家/货币、时间与时区、确认状态、前值/预期/实际、单位、重要性、频率 | 就业数据周五13:30Z公布；actual尚空 | 发布日历是事实，重要性为供应商或方法判断；FRED历史值不能替代未来预期表。[经济资源][T11] |
| **TC09 Corporate Calendar：公司事件** | earnings/meeting/dividend/split、公司、日期/盘前盘后、财季、EPS预期与实际、股息日期金额、拆股比例 | 财报盘后；EPS预期1.20；股息0.50USD；拆股2:1 | TC官方确认类别；详细业务字段需授权确认。Sesame应补专用公司行为/事件来源。[产品][T12] |
| **TC10 Market Buzz：新闻关注** | 新闻/提及数量、时间窗、基准热度、来源、主题、事件、标题与链接、价格反应、历史关注曲线 | 去重后24h320篇，基准80篇，自有量比4倍；订单与监管是主话题 | 4倍量比是可复算自有值，不是TC Buzz Score。Sesame有新闻/RSS/网页原料，缺稳定覆盖、去重与历史基准。[教程][T13] |
| **TC11 Crowd/Sentiment/Fear：情绪诊断** | 情绪强弱、方向、主观性、证据量Confidence、趋势/直方图、同业、历史、Fear Index | 强弱72；主观性81；证据量Average；趋势46；情绪偏正但正在转弱 | 各量表分别解释；Fear是独立维度，非VIX。Sesame有文本与Reddit样本，尚无等价原厂评分。[情绪][T15]、[趋势][T16]、[Fear][T17] |

### 2.4 期权、筛选和综合交付

| 编号 / 类型 | 关键字段 | 合成示例 | 方法与当前Sesame差距 |
| --- | --- | --- | --- |
| **TC12 Options Volatility：期权波动仪表盘** | 同步标的价、IV/HV、IV Rank、历史、上下行/期限偏斜、曲面/锥、预期波动、同业和事件 | IV30%，自身历史20%–40%，自有IVR50；近端比远端更贵 | IV来自期权报价而非现货ATR；预期移动不是价格目标。Sesame缺期权链与历史IV，不能仅靠画图补齐。[教程][T18]、[偏斜][T19] |
| **TC13 Options Strategy：结构与损益** | 方向/幅度/目标/风险偏好、首选/替代、各腿、权利金、到期盈亏平衡/最大损益、payoff、POP | 买K100卖K110 call、同到期，净付3/股、乘数100：亏损上限300、盈利上限700、BE103 | 到期payoff可确定性计算；POP及到期前风险需模型与真实链。Sesame可补自有计算，原厂排名/POP不能假造。[教程][T18] |
| **TC14 Strategy Builder：筛选与历史验证** | 目标、投资池、条件/逻辑、匹配与排名、模拟持仓、回测窗、净值/CAGR/基准、换仓与更新 | 18匹配，前10等权；5年净值1→1.8，CAGR12.47%；基准1→1.6，CAGR9.86% | 公开FAQ为AND筛选、前10等权、13周换仓、收盘成交；实际回测还要检查成本、退市和点时处理。Sesame有因子评价/回测，缺完备选股数据层。[方法][T20] |
| **TC15 Featured Ideas：机会卡** | 标的、方向、技术事件/形态、检测时间、bar周期、预期持有期、预期行为、理由、图、详情、观察/交易入口 | H1上升三角完成突破，列出形成依据与预计时间范围 | 卡片不保证每条都有入场/止损/目标；“Trade Action”是入口，不是成交事实。Sesame可把现有技术事件组合成候选卡。[产品][T29] |
| **TC16 Panoramic View：资产总览** | 价值状态、各期限技术状态、新闻情绪、24h关注度、报告链接、持仓上下文 | 价值有吸引力；短期弱/长期强；新闻中性/关注高 | 并列维度不等于万能总分；融合动作要另有可解释规则。适合Sesame目录、个股概览与组合审阅。[发布][T22] |
| **TC17 Newsletter / Newsbrief / Video：简报** | 日期/区域/时段、市场回顾、指数板块、驱动、风险指标、商品FX加密、事件、精选机会；视频加媒体URL/稿 | 亚洲早报：市场变化、3条重要驱动、2个机会、今日事件 | 组合与投递方式；不重复计算底层信号。视频/RSS、专题筛选可以扩展交付，但无需新增一套研究模型。[Newsletter][T23]、[Video][T24] |
| **TC18 FIBI Storyteller：自然语言综合** | Technical/Trading/Fundamental/News/Options/Economic Story、Market Outlook；事实引用、冲突、条件行动 | 估值便宜但短线受阻，先等103突破；事件前控制风险；给已取证据链接 | 叙述应建立在已有研究上。已公开`/fibi/v2/economic-insights/`及`/stream`、`get_storyteller_economics`，但不能由工具名猜完整响应。[发布记录][T11] |

TC的MCP有正式官方入口；页面自身工具总数存在57/59等不一致，接入以实际授权的`tools/list`及契约为准，不把营销数量写成产品常量。[官方MCP][T26]

## 3. Autochartist：补齐检测、统计与机会生命周期

Autochartist最值得学习的是：**每个结果有身份、阶段、检测时刻、几何依据、有效期和统计出处**。这些结构让“发现一个形态”能继续转化为可跟踪的研究对象。

### 3.1 技术检测与附属质量

| 编号 / 模块 | 已公开字段或业务结构 | 合成示例 | 方法公开程度 / Sesame现状 |
| --- | --- | --- | --- |
| **AC01 图形形态** | `result_uid/result_type/symbol/interval/pattern/complete/direction/identified/age/length/expires_at`；边界端点、目标区间/期限、analysis_text | EURUSD H1上升三角，40根形成中；阻力1.1050；目标暂空 | 阶段/几何字段公开；识别容差、全目标算法未完整公开。Sesame基础拐点与突破能复用，完整头肩/旗形/三角等仍需算法或授权。[API][A02]、[Scanner][A03] |
| **AC02 Fibonacci形态** | A/B/C/D/X价格时间、`ratioQuality/averageQuality`、多个`target03…target16` | GBPUSD H4 ABCD；ratioQuality0.84；目标阶梯含1.2800 | 当前Scanner还列Gartley/Butterfly等；比例质量不是概率。Sesame已有简单Fib水平，未等价完整谐波模式。[Scanner][A03]、[API][A02] |
| **AC03 水平关键位** | `patternPrice`、触碰时间、qtyTP、approaching区域/时间、突破状态、预测窗 | USDJPY H1阻力150，4次触碰，当前149.85：接近中 | 教育页描述窄区间至少3次触碰，但容差未公开。Sesame已有聚类水平，需规范接近/突破事件。[关键位][A05] |
| **AC04 Japanese Candlesticks** | 通用事件字段、形态名、解释/图；本次文档的专属字段列表为None | Hammer于闭合H1识别；不给未提供的命中率 | 蜡烛形态是独立模块；不要与连续同色蜡烛异常混淆。自研需明确实体/影线/前置趋势阈值。[Scanner][A03]、[API][A02] |
| **AC05 形态质量（附属组件）** | `quality/clarity/uniformity/initial_trend/breakout/volume`；Fib的`ratioQuality/timeQuality` | quality0.70、clarity0.80；未突破时breakout=-1按契约映射不适用 | 原始质量0–1，精确子项与缺失处理未完整公开。Sesame没有这些原厂分，不能用模型随手给“70%”。[质量][A04] |

### 3.2 概率、波动和风险

| 编号 / 模块 | 字段 | 合成示例 | 方法与边界 |
| --- | --- | --- | --- |
| **AC06 Performance Statistics：达标历史** | broker/group、emerging/breakout、类别/桶、`from/to/total/correct/percentage` | 200个结果、140达标→70%，保留统计起止 | 公开公式correct/total×100；不是含执行成本的交易盈利率。Sesame需积累检测器事件库与路径结果。[API][A06] |
| **AC07 Volatility：分时波动区间** | `closing_price/datetime/timezone`、15/30/60/240/1440分钟low/high、日内/周内图与rank | 基准1.1000；H1 1.0985–1.1015；H4 1.0970–1.1030 | 官方帮助按星期/日内切片历史波动，以1σ/约68%解释范围；完整分布与校准未公开。区间是双侧幅度而非看多目标。[API][A07]、[方法][A08] |
| **AC08 Risk Calculator：风险金额→手数** | `account_currency/trade_pair/contract_type/account_risk/entry_level/stop_loss`→`lot_size/risk_in_pips` | 风险100USD，50pip止损，每标准手每pip10USD→0.20手 | 参数公开；账户风险输入是金额。Sesame已有仓位数学和MT5无下单计算，补合约/换汇与步长衔接即可。[API][A09] |
| **AC15 Our Favorites：统计筛选视图** | 技术结果身份；`probabilities.percent`与按时段/标的/形态的correct/total/percent；forecast | 总值68.5；标的组132/200；时段70/100；形态140/210 | 原厂总值组合未公开，不能用边际频次自行拼等价联合概率。它是筛选层，不是新形态算法。[API][A17] |
| **AC16 Correlating Alerts：同向共振** | symbol/direction/time；`patterns[]`及周期/图/ID；突破价/目标/概率/叙述 | H1形态与H4水平突破同向，保留两个结果ID | 至少两种setup同意方向；不是跨资产相关矩阵，也不能假定两个价格指标独立。[API][A18] |

### 3.3 宏观、异常、情绪和内容形式

| 编号 / 模块 | 字段 | 合成示例 | 方法与边界 |
| --- | --- | --- | --- |
| **AC09 Economic Event Forecast：事件条件方向** | 事件ID/时间/国家/实际；`items[].symbol/sample_size/time_frame`；`opportunities[].id/probability/trend_direction/delta_sign/mean_mov*_`；history中的expected/actual/delta | 在actual>forecast条件组，EURUSD未来120分钟历史下行频次75%；条件样本数另记 | 不是“本次数据高于预期概率75%”。正文与响应样例层级有出入，接入必须验证授权样例。[API][A10] |
| **AC10 Event Volatility / EEVI：事件幅度** | event/no_event各自n/min/p25/median/p75/max/mean/std及pip/金额；差异与比例 | 正常中位12pip、事件中位30pip：高150% | 幅度与方向分开。EEVI当前是18个FX对/61类事件的特定方案，不能与方向产品覆盖混用。[API][A11]、[EEVI][A12] |
| **AC11 Big/Extreme Movement：异常幅度** | from/to_price、movement、percentile、识别/有效时间 | H1从1.1000至1.1060；历史第98百分位 | 描述已经发生的异常；并不说明98%会延续。不同文档percentile可能为0–1或0–100。[Market Alerts][A13] |
| **AC12 Consecutive Candles：连续蜡烛** | qty_candles、历史方向、起止价、percentile、预测方向 | H4连续6根上涨，历史稀有；原厂预测也可能向下 | 官方说明最多600根经验分布和95%异常阈值；自研必须规定doji、方向和样本。不要把这套说明套给Big Movement。[方法][A14] |
| **AC13 Round Numbers：整数关口** | 标的、关口、接近/穿越、时间、解释（本表为业务结构） | BTC接近100000 | 产品存在，但本次未找到专属raw schema；不能假造字段名说是API已支持。[产品][A15] |
| **AC14 News Sentiment：新闻情绪** | ticker/sector、sentiment_score/indicator、sources/mentions、分值变化、历史 | 原分20→55，变化35；8来源60提及 | 字符串分值需解析；35是分值变化，不是35%收益。模型与完整尺度未公开。[API][A16] |
| **AC17 Market Snapshot/Report：时段快照** | report_id/uid/generated/session、messages、symbol_reports、各项事件/方向/期限/levels、RSI/MA辅助叙述 | EU开盘前生成，含3个机会、24h movers及未来事件 | 聚合已有分析；报告时间不能覆盖单信号检测/失效时间。已有JSON与图数据接口。[API][A19]、[产品][A20] |
| **AC18 Portal/Scanner/邮件/网站/ContentCast：容器与分发** | channel、language、源URL、抓取/生成时刻、底层模块ID、素材URL | 门户展示H1信号；邮件引用同一个ID | 不新增独立分析方法。ContentCast可捕获客户文章，“analyst report”例子不证明有独立署名报告API。[ContentCast][A21] |

**值得单独学习的接口细节。** 质量、概率和异常分位必须保留尺度；`identified/expires_at/prediction_time_to/generated`各有含义；形态ID可能超过JavaScript安全整数；价格-1、1900/1970日期等占位只按各字段契约处理。公开样例里还出现顶层/详情complete冲突与字段拼写差异，不能直接由文档生成“已验证”的SDK。[Technical][A02]、[Alerts][A13]、[Snapshot][A19]

## 4. 哪些判断方法能借鉴，哪些必须自己验证

### 4.1 可复现计算、公开框架、专有算法分层

| 方法层 | 可以直接借鉴的内容 | 仍要明确的参数/证据 | Sesame落点 |
| --- | --- | --- | --- |
| 价格与技术基础 | OHLC、收益、均线、RSI/MACD、TR/ATR、波动、确认拐点、区间突破 | 价格基准、闭合bar、窗口、预热、首值/平滑、公司行为 | 复用现有计算插件；以method_id固定版本 |
| 几何模式 | 形态由转折点、边界、触碰、突破组成；部分目标由高度投射 | 拐点确认延迟、拟合容差、最小持续长度、触碰判定、失败/到期与去重 | 先少量形态做确定性检测；复用PA/ABU拐点，别先追求所有名称 |
| 风险与仓位 | 风险金额除以每单位止损损失；到期payoff可计算 | 合约乘数、汇率、手数步长、成本、跳空、保证金 | ABU sizing与MT5计算配合，report只展示结果 |
| 财务因子/估值 | 可比期增长、倍数、ROE、FCF收益率；剩余收益/DCF框架 | 数据首次可得时间、TTM/累计期、负分母、行业、预测、资本成本与终值 | financial-research供事实；研究方法插件计算；evaluator评估预测价值 |
| 新闻研究 | 实体识别、转载去重、主题与情绪分类、时间窗聚合 | 语料覆盖、标注样本、阈值、新闻延迟与实体歧义 | 先限定资产/语言做可量化语料库；不把网页搜索前几条当全市场分布 |
| 事件研究 | actual−forecast分组，对齐t0，比较条件收益/幅度分布 | 初值/修订、日历/DST、并发事件、同窗口对照、条件样本n | 新事件方法层；行情和FRED仍复用，但需新增共识/事件源 |
| 期权研究 | 合约payoff、报价反解IV、IVR/分位、偏斜/期限结构 | 美/欧式、股息利率、流动性、到期时间、历史同口径和分布假设 | 先接链与历史，再开发；不从现货图臆造IV |
| 供应商专有模型 | 原厂质量、综合分、预期区间/POP、筛选总概率作为外部结果 | 许可、版本、尺度、方法公开程度、样本与更新 | 授权接入；自有替代模型另命名，不能声称数值等价 |

公开的TC技术方法还给出指数→板块→个股的相对强弱思路；适合做证据组织，不意味着每个市场都必须拥有股票行业数据。[历史方法][T03] TC Labs有新闻情绪研究论文，可学习资产/日聚合与回测设计；论文实验阈值和费用不等于2026产品算法。[论文][T27]

### 4.2 关键公式与例子：把同名不同义拆开

| 字段 | 自有可复现计算 / 例子 | 解释 |
| --- | --- | --- |
| TR | `max(H−L, abs(H−prevClose), abs(L−prevClose))`；再除pip大小 | TR不总等于H−L；ATR还需指定平滑。现有ABU不同基线首TR处理并不一致 |
| 多头RR | `(target−entry)/(entry−stop)`；103入场、98止损、113目标→2R | 成本未扣的名义RR；价格偏离会改变RR |
| 风险规模 | `riskCash / (abs(entry−stop) × 每价格点每单位价值)` | 金额先同币种，最后按实际步长向下取整；不推断下单权限 |
| FV上行 vs 折价 | 100对120：`120/100−1=20%`；`(120−100)/120=16.67%` | 两个分母不同，均可展示但名称不可混 |
| 剩余收益框架 | `股权价值 = 当前账面权益 + Σ(预测净利−k×期初权益)/(1+k)^t + 终值折现` | 自有估值框架；TC用两阶段模型，但未公开全部内部假设。[来源][T08] |
| IV Rank vs Percentile | `100×(当前IV−窗内min)/(max−min)`；percentile看历史有多少观测不高于当前 | 固定期限/价内外条件；max=min时结果未定义。不是收益概率 |
| 波动近似 | 自有简化：`σ_ann×sqrt(T)`；30%×sqrt(30/365)≈8.60% | 需显式分布/年化假设；不是TC/AC原厂预测公式，也非精确校准区间 |
| 牛市看涨价差到期损益 | `[max(S−100,0)−max(S−110,0)−3]×100` | 不含费税；到期前价格、行权和保证金问题另算 |
| 历史达标率 | `correct/total`；140/200=70% | 只是明确样本内的达标比例；不自动带有策略盈利含义。[定义][A06] |
| 自有比例区间 | 对140/200，以二项Wilson95%区间演示，约63.3%–75.9% | 区间计算建立在相应独立样本近似；重叠形态可能需要分组/分块统计 |
| Brier | `mean((p−y)^2)`，y为事前定义的0/1结果 | 既要同基准比较，也要检查校准；不能事后换目标和窗口 |

### 4.3 验证应回答具体问题，不把所有测试变成每份报告的门槛

| 研究问题 | 适用测试 | 不适用/无法运行时如何继续 |
| --- | --- | --- |
| 因子是否只是偶然配合数据 | 安慰剂、bootstrap区间、真正留出样本 | 先完成可运行的描述/基础验证；把未验证的问题留在研究状态，不伪造结论 |
| 参数是否只在一点上“最好” | 参数敏感性、walk-forward | 无长历史时缩小结论范围，继续补数据；不阻塞其他独立研究 |
| 收益路径扰动下会怎样 | 明确生成机制的蒙特卡洛、路径压力 | 当前已有经验分块重采样诊断收益；交易执行顺序仿真等需另实现 |
| 是否只在某种行情有效 | 点时市场状态分层、跨资产/跨期样本外 | 单品种仍可做时序研究；不能因此拒绝使用工作流 |
| 信号声称70%是否可信 | 前瞻登记、样本数/区间、Brier、分档校准 | 样本不够时提供原始计数与证据，不临时生成概率 |

这些测试在当前 `factor-evaluator` 中已有特定实现，但其完成状态不等于科学意义上的“通过”。例如当前walk-forward评估固定候选并使用训练期阈值，不等于每窗重新训练或选参。测试计划应按用户目标选择；评估器不能越俎代庖地把轻量观察强行变成全部统计实验。

## 5. Sesame当前能拿到什么、能算什么

本节是源码审计：插件仓库`7f5c7a8`、宿主`1bd1d26`。**有实现不代表这台运行实例已安装、配置或拥有源权限。** 当前profile含11 core与48 optional；这与公开安装目录、打包归档、用户挂载状态是四件事，不能拿旧catalog推断当前运行能力。

### 5.1 信息渠道与计算底座

| 现有能力 | 真的已实现 | 仍不能据此声称 |
| --- | --- | --- |
| data-access + MT5 | 固定行情DataRef、OHLCV/闭合状态、来源/覆盖；终端报价、合约、账户/持仓；原生利润/保证金计算 | 所有券商都有同一深度历史、真实成交量、可靠交易日历 |
| CCXT / Binance / AKShare / QMT | CCXT为Kraken/Coinbase/OKX公共现货；Binance现货含市场/账户；AKShare七个A股白名单；QMT日线/报价/账户 | 全CCXT交易所/衍生品、全AKShare财务宏观期权、完整QMT标准订单历史 |
| financial-research | SEC申报与companyfacts；FMP价格/三表/新闻/评级变动/内部人；FRED观测及元数据；Reddit有限样本；CFTC期货持仓 | 当前分析师共识/目标价、未来宏观/公司日历、期权链、全网情绪和全量点时样本 |
| web-sources / web-extract / rss-collect | URL内容、JSON/CSV文本、RSS标题/链接/时间与摘要，固定原文证据 | 抓到网页便有持续结构化覆盖，或有全文/商业再分发许可 |
| ABU基础计算 | 指标、波动、拐点/水平/Fib、突破、退出、仓位、交易绩效等确定性基线 | 已有完整Autochartist形态库/质量/命中模型，或与交易平台默认公式完全等价 |
| PA / ICT / factor-research | 原生capabilities为空但有有限可执行资源脚本；含确认拐点/突破、三bar不重叠、因子IC/选择/留出 | “纯知识”就没有计算，或反过来称已实现完整ICT/PA策略 |
| factor-evaluator / 回测引擎 | 因子AST、IC/冗余/净诊断收益、七类评估；Backtrader/vn.py/MT5 Tester与绩效计算 | close-to-close因子诊断等同真实订单闭环、IC等同交易胜率 |
| judgment-evolution | 事前判断登记、冻结依据、到期标量核验、Brier与校准 | 已有多年校准事件库；当前最新标量核验能表达“先止损还是先到目标” |
| reports | 26种图型、通用outline、数据绑定、发布/检查/导出 | 已有每一种专业报告的业务字段schema；渲染成功等于分析正确 |

关键源码：[financial-research sources](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/financial-research/sources.js:82)、[factor diagnostics](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/factor-evaluator/diagnostics.js:3)、[judgment核验](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/judgment-evolution/service.js:131)、[reports图型目录](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/skills/report-design/chart-catalog.md:7)。其余接口、算法与限制详见[源码审计表](Sesame-研究字段能力核对-20261026.md)。

### 5.2 按报告族看可交付程度

| 报告族 | 可以先做 | 产品化仍需补的部分 | 优先顺序 |
| --- | --- | --- | --- |
| 技术情景/基础风险 | 真实K线+指标/拐点/突破+可解释主备情景+ATR风险计算 | 统一事件状态/目标方法；少量成熟形态；历史路径评估 | 第一批 |
| 因子/策略研究 | 固定输入、已有evaluator/回测、参数/状态/OOS诊断、绩效图 | 业务报告schema、适用测试选择、成本/数据语义完整性 | 第一批 |
| 日报/市场概览 | 组合已有行情、新闻事实、当前研究、未来事件网页证据 | 稳定事件表、多资产主数据、增量更新/去重 | 第一批但按实际来源缩范围 |
| 公司财务/自有估值 | 已有SEC/FMP三表输入；显式假设下比率/估值 | TTM/同比/行业中性、公司行为、预期、估值方法与敏感性 | 第二批 |
| 分析师共识 | 现有评级变动事件列表 | 共识/目标价端点、样本与时间、历史快照 | 第二批，较小适配增量 |
| 宏观事件影响 | FRED历史序列+行情基础 | 首发/共识/日历、t0对齐、修订与条件历史样本 | 第二批 |
| 新闻情绪/热度 | 有限语料的主题与定性解读 | 授权语料/去重/实体、历史覆盖、评分验证 | 第二批，先限定资产语言 |
| 完整Autochartist式扫描 | 简单突破/拐点/整数位自有事件 | 形态识别全库、质量算法、机会持久库、达标历史或授权接入 | 自研小集合或采购并行评估 |
| 期权链/IV/POP | 结构数学与静态合成说明 | 合约链/报价/历史IV、事件/利率股息、模型/风险验证 | 数据源到位后单独试点 |

字段级结论在附录A。没有用“支持率80%”这类总数掩盖关键字段差异：一个报告几十个描述字段都能生成，缺期权报价或历史预测记录时，核心结论仍然不成立。

## 6. 信息渠道与分析方法怎么改进

### 6.1 渠道：先填真正缺的输入

| 顺序 | 增补内容 | 现有基础与具体改动 | 得到的字段/报告 |
| --- | --- | --- | --- |
| **P0** | 证券身份、单位与点时证据 | 复用SourceRef/DataRef；增加字段来源路径、单位/尺度、可得时间、调整方式、合约主数据、字段缺失原因；把已有快照用于后续历史 | 所有报告能去重与对齐；财务/事件回测减少前视 |
| **P1** | 分析师评级/目标价共识 | financial-research在`/stable/grades`之外加明确白名单端点`grades-consensus`、`price-target-consensus`；新增实际样本验证 | Buy/Hold/Sell分布、均/高/低/中位目标价；不能把当前快照当历史。[评级文档](https://site.financialmodelingprep.com/developer/docs/stable/grades-summary)、[目标文档](https://site.financialmodelingprep.com/developer/docs/stable/price-target-consensus) |
| **P1** | 未来经济/公司日历与预期 | 官方统计日历负责发布时间；供应商日历提供estimate/actual/previous；公司行为另取可靠结构源 | 事件提醒、预期差、EPS/股息/拆股；官方机构日历本身没有经济学家共识。[BLS](https://www.bls.gov/schedule/news_release/empsit.htm)、[FMP文档](https://site.financialmodelingprep.com/developer/docs) |
| **P1** | 财务标准化和历史版本 | 继续用SEC companyfacts/FMP三表；统一财期、单位、累计转单季/TTM、公司行为；同时约束available_at、content_available_at与retrieved_at；补行业/退市全集 | 同业、五因子、估值、点时选股。当前FMP/Reddit/CFTC历史as_of仅复用截止前已采集的匹配快照，无快照不能用今天取到的旧日期记录替代。[SEC API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)、[FRED vintage](https://fred.stlouisfed.org/docs/api/fred/series_observations.html) |
| **P2** | 限定范围的新闻库 | 按资产/语言存原始文章与转载簇，保留时间/许可；逐步积累可比热度基准 | 可解释Buzz、主题、情绪历史；网页搜索继续补漏，不能冒充全量库 |
| **P2** | 原厂TC/AC研究结果 | TC可评估官方MCP/API；AC已核实REST/JSON/OpenAPI，本次未找到官方MCP文档；数据适配插件独立接入 | 直接获得原厂专有分数/信号。安装插件不等于拥有供应商权限。[TC][T26]、[AC][A01] |
| **P3** | 期权链和可比历史 | 按目标市场采购/连接报价与合约；Cboe美国期权数据是可评估入口，含可选IV/Greeks；先固定期限/价内外定义再算历史IVR | 波动/价差/偏斜/POP研究。[报价数据](https://datashop.cboe.com/option-quote-intervals)、[历史EOD](https://datashop.cboe.com/option-eod-summary) |

以上是渠道候选与字段增益，不代表已获得套餐权限或当前数据已验收。商业原文、图、衍生摘要、缓存和LLM处理范围应在接入合同中确认；对应凭据放统一配置入口，并绑定需要它的能力，不放进报告或提示词正文。已有免费/公开事实渠道不因专有源缺失而整体停工。

### 6.2 方法：把“会说”变为“能重复得到同一结果”

1. **先统一技术事件模型。** 以现有确认拐点/突破为首批，记录事件类型、方向、检测/确认时刻、锚点、有效期和方法版本。每次更新沿用结果身份，避免同一机会重复出现。
2. **将计算与叙述拆开。** 价格位、比率、仓位、统计先由确定性脚本/插件生成固定结果；agent解释市场意义、冲突和条件。用户问“为什么”能回到对应输入和规则。
3. **新增研究方法按实际需求选。** 财务标准化、少量几何模式、事件冲击、新闻实体/去重与情绪分别实现，不塞进一个巨大的“分析万能工具”。
4. **建立前瞻结果闭环。** 事前冻结目标、期限和结果定义；到期取得真实路径，再计算触及、先后、MAE/MFE、成本后收益和校准。现有judgment继续管理登记/标量/校准，路径计算放回测或事件计算层。
5. **评估按问题匹配。** 轻量问答无需全套实验；因子挖掘按目标选择安慰剂/蒙特卡洛/OOS/walk-forward/敏感性/状态/bootstrap。某项因源或环境不能做，保留原因，继续其他有意义分支。
6. **用稳定的报告结果校准未来研究。** 不只统计“方向看对”，同时看触发率、目标触及、先止损、成本后结果及相对基准，避免看起来漂亮但无实际收益的研究评分。

## 7. 报告改成一个或多个结构组合：建议设计

### 7.1 研究对象、方法和页面各归其位

| 层 | 责任 | 现有载体 / 需要补的最小内容 |
| --- | --- | --- |
| 数据适配 | 获取实际事实、权限/覆盖、单位、时间、原始字段 | MT5/CCXT/Binance/financial-research/web等；只扩必要端点 |
| 数据证据 | 固定输入、查询、复用、来源与版本 | data-access + DataRef/ArtifactRef；不另造平行证据仓库 |
| 研究方法 | 形态/比率/估值/事件/情绪/风险的确定性计算与领域解释 | 现有ABU/PA/ICT/因子等；新增方法有单独版本和适用输入 |
| 编排与综合 | 按问题选报告组合、找插件、并行取证、阶段性研究、处理冲突 | investment-research / orchestration / ultra按真实任务使用；研究输出有业务schema |
| 报告 | 将业务结果映射为统一视觉、图表、目录、发布/导出 | reports存模块的呈现recipe与图表绑定；不接管定价/信号算法 |
| 结果验证 | 前瞻登记、真实outcome、校准、研究改进 | judgment + evaluator/回测；补路径型结果契约 |
| 宿主 | 配置、插件发现/调度、数据与产物、界面基础 | 沿用底座；初期无需在宿主硬编码“TC报告类型”或大改通用接口 |

**业务结果契约与展示recipe分开，但共享一个模块ID。** 例如`technical_scenario@1`的输入、结果、必需/可选字段属于研究契约；K线、情景树、风险行和证据的排版属于reports。这样一个结果能用于日报卡、完整报告或目录预览，不需要分析三遍。

### 7.2 组合规则

每份报告有小型公共头：研究问题、资产/市场、数据截点、研究期限、核心结论和来源引用。下面按需装入模块，每个模块至少声明：

| 属性 | 用途 | 例子 |
| --- | --- | --- |
| `module_id / schema_version` | 固定业务定义 | technical_scenario@1 |
| `required_fields / conditional_fields / optional_fields` | 明确此任务真正需要什么 | 技术情景需价格/条件/期限；没做期权不要求IV |
| `input_refs / method / result_ref` | 引用已计算结果，避免重复取数 | 同一个OHLCV DataRef供多个技术模块 |
| `status` | 完成/部分完成/不可用/不适用分别处理 | 无期权源→该模块不可用；技术与宏观继续 |
| `findings / conflicts / conditional_actions` | 形成用户能用的观点 | 结构突破待确认，事件后再评估 |
| `visual_recipe` | 统一图表投影 | candle + decision-tree + risk metrics |
| `monitoring / outcome_definition` | 连接后续观察与验证 | 4小时内先触目标还是止损 |

**不要强行补齐所有空字段。** 模块非核心可省略；核心输入缺失时先从其他已发现插件找来源，或调整为有证据支持的研究模块。报告中只解释会改变判断的信息，不自动附“适用范围”“未证明完整”“失效与覆盖”等泛化章节。

### 7.3 组合配方：不同问题得到不同报告

| 用户任务 | 推荐组合 | 正文主要呈现 | 避免的冗余 |
| --- | --- | --- | --- |
| 外汇日内机会 | TC01技术情景 + AC01/03形态/水平 + TC07或AC09事件 + AC07/08风险 | 条件情景、关键价格、事件窗口、规模计算 | 不生成股票财务/期权章节 |
| 单只股票投资想法 | TC04基本面 + TC05估值 + TC06共识 + TC10新闻 + TC01技术 | 估值与盈利依据、共识分歧、催化、入场观察条件 | 不把五种原厂分数硬平均成万能分 |
| 重大宏观事件 | TC08日历 + TC07/AC09方向条件 + AC10幅度 + 风险 | 实际值相对预期的分支树、历史样本分布、时间窗口 | 不用新闻摘要替代事件历史，也不把幅度当方向 |
| 最大努力挖掘因子 | SX01因子与稳健性 + TC14筛选/回测 + SX03结果 | 并行候选、冻结选择、样本外/成本/状态差异、下一步 | 不强制与目标无关的测试；单品种用时序路线 |
| 期权方向或收益结构 | TC12波动 + TC13结构 + TC09公司事件 | 真实链、偏斜/期限、首选/替代payoff、风险与成本 | 未接链时不生成像实盘的报价和POP |
| 每日市场/盯盘 | TC16总览 + TC17/AC17简报 + AC15/16候选 + 事件 | 相比上一版的新变化、重要机会、下一事件 | 不重写全部静态背景；同一结果ID去重 |
| 持仓诊断 | SX02敞口/执行 + 原有技术/财务模块 + SX03追踪 | 组合暴露、成本与偏差、继续/减仓的条件依据 | 账户事实与建议分开；报告不暗中执行交易 |

**Sesame延伸报告不是厂商缺什么就全补什么，而是服务我们的完整任务：**

| 编号 | 结构与字段 | 合成例子 |
| --- | --- | --- |
| **SX01 因子与稳健性研究** | 假设、数据/点时、表达式、IC/收益、选择过程、留出、成本、选定验证、失败候选与下一步 | 12候选→训练保留3→留出只评一次；IC与成本后收益分列 |
| **SX02 组合/执行质量** | 持仓/币种/行业、相关/压力、订单成交、点差滑点、成本、资金占用与归因 | 方向判断正确但成本侵蚀；指出发生在哪个成交环节 |
| **SX03 前瞻判断复盘** | 原报告/条件、登记概率与基准、期限、实际路径、触及与先后、净收益、校准 | 目标最终到达，但此前先触止损→不能标为成功交易 |

### 7.4 一份组合报告应长什么样

以**合成的“EURUSD未来4小时”任务**为例，选技术情景、事件冲击、风险三模块，正文可以是：

> EURUSD仍在1.1050阻力下方。优先观察H1收盘能否突破并站稳；未确认前保留观察。1小时后有重要数据，历史同类事件的波动明显高于普通时段，入场条件与风险规模应按数据公布后的实际价格更新。

随后是一张真实输入驱动的K线图、一个条件情景树、一张事件分布小图和一行风险计算。相同资产/时间/价格不在每个模块重复。原始方法、来源与细表可展开查看。

条件树可表达为下表，制作时用现有内置decision-tree，不把逻辑句重复塞进叶子：

| 内部判断节点 | 分支 | 叶子动作/结果 |
| --- | --- | --- |
| H1是否收盘站上1.1050？ | 否 | 保持观察 |
| 站上后，回踩是否守住1.1030？ | 否 | 继续观察回踩结构 |
| 回踩守住，事件是否已公布？ | 否 | 等待事件 |
| 事件已公布，按实时入场计算的成本后RR是否满足既定计划？ | 是 / 否 | 准备该计划 / 跳过本次入场 |

这是结构示例，不预设真实市场一定存在该机会；具体价位和条件应由实际研究产生。日常问答可以只给简短回答；研究、复杂和数据量大的任务生成报告。

### 7.5 统一视觉只做最后一层映射

沿用现有报告主题与26种图型：价格用默认candlestick；条件用可拖拽/缩放decision-tree；事件分布用boxplot/strip；比率比较用hbar/parallel；参数/状态用matrix/heatmap；绩效用line/drawdown；归因用waterfall；敞口用treemap。26种是图型并集，其中area/hbar/heatmap经reportKit，不能全部假装是`report_template.kind`。

报告发布前检查实际内容、引用、数值/单位与渲染，并查看视觉是否经过统一模板；**rendered只证明渲染成功，不证明研究或视觉设计全部合格**。不额外发明一套主题；单文件报告直接保存，只有确有多个独立产物才分目录。

## 8. 预期效果、代价与试点顺序

### 8.1 预期会改变什么

| 维度 | 当前容易出现的情况 | 模块化后的预期效果 | 怎么验证 |
| --- | --- | --- | --- |
| 研究完整性 | 正文很长但缺期限/目标依据/样本 | 每种问题有明确字段与方法，缺口容易定位 | 抽检“适用必需字段”完成情况，不要求所有可选项 |
| 可读性 | 报告结构临时发挥，说明过多 | 结论+证据+条件为主，同类报告容易比较 | 相同任务对比阅读时间、找到关键行动的成功率 |
| 工具使用 | 凭记忆写结论，或反复查同一行情 | 先按模块发现插件，再复用固定DataRef和计算结果 | 重复请求数、证据引用比例、工具失败后的替代完成率 |
| 研究效率 | 主agent包办，阶段产物难复用 | 可并行的模块交给subagent，主agent负责综合和下一步 | 首个有效结果耗时、总延迟、模型成本与重复工作量 |
| 可验证性 | 方向/评分和实际收益混在一起 | 原判断冻结，按预定期限和路径评价 | 目标触及/先止损/净盈利/Brier分别统计 |
| 扩展性 | 新供应商牵动整套页面 | 新源映射同一业务模块，图表和组合复用 | 新源接入改动范围、原有报告回归结果 |

这些是设计预期，**不是已经测得的节省比例，也不保证投资收益提高**。真正的收益来自更好的信息、假设检验与执行；模板主要帮助它们被稳定使用和表达。

### 8.2 应避免的设计代价

- **模板过硬。** 所有模块都必做会增加时延，agent为补字段胡编或频繁问用户。采用任务相关必需字段，其他按需。
- **分数过多。** 模型分、历史频次、情绪量表、异常分位并列，不生成没有验证的综合“信心”。
- **多模块重复。** 同一事件/新闻/价格由ID去重；同源技术指标不视作独立证据。
- **过早复制商业算法。** 能公开复现的规则先做，专有值走授权；自有模型保持名称与方法透明。
- **只验页面不验语义。** 需要源时间、尺度、数值运算、事件状态、路径结果和统一渲染一起检查。

### 8.3 推荐落地顺序

| 阶段 | 最小交付 | 完成判据 |
| --- | --- | --- |
| **1：业务结构，不改宿主大接口** | technical_scenario、event_snapshot、factor_research三种结果schema；reports组合recipe；字段来源映射 | 同一结果能生成完整报告与简报卡；单模块/组合均可；没有重复事实和假字段 |
| **2：已有能力先组合** | 技术情景+风险、单资产因子研究、市场简报三条真实数据试点 | 每条数值有输入/方法；价格单位时间正确；实际生成报告并通过统一渲染检查 |
| **3：补高价值数据** | 共识与日历、财务标准化、少量形态生命周期；预期差历史与路径结果 | 缺失/权限/修订状态可处理；旧快照不伪装历史；触及与先后结果准确 |
| **4：概率与复杂市场** | 自有质量/历史校准、期权链与波动、持仓压力/执行复盘；按需要接原厂 | 在真实可得历史上验证，不用合成样例证明策略有效 |

本次交付是研究与方案，**没有改动插件、宿主、运行工作区或交易配置**。建议下一步先审阅报告模块和字段字典，再把第一批业务契约落入研究插件与reports呈现层。


## 附录 A：统一业务字段字典

这张字典是 **Sesame 建议业务模型**，并非 TC 或 Autochartist 的完整授权接口。原稿字段的同义词合并为一项，数组与结构化对象按业务单元归类；原厂机器字段另见附录 B。示例均为合成。每行的获取路线说明当前实现及补建工作。

**状态**：取＝当前代码可有条件获取；算＝已有确定性实现；编＝需补可复现、带版本的计算或判断方法；源＝还缺结构化来源、覆盖或历史；授＝若要原厂专有值需授权接入；呈＝组织、状态或展示能力。多状态表示同一字段在不同来源/部分子项上的差异，不统计为一个笼统“支持率”。


### 01 身份、时间、单位与来源

| 规范键 / 字段 | 性质 / 当前状态 | 合成示例 | 获取、推导与缺口 |
| --- | --- | --- | --- |
| `report.id`<br>报告ID、report_uid | 管理<br>**呈** | demo-eurusd-01 | reports ArtifactRef；与供应商结果ID分开 |
| `report.kind`<br>报告种类、report_type | 管理<br>**呈** | technical_scenario | 新增业务模块目录，映射现有outline |
| `report.provider`<br>机构、产品、publisher | 来源<br>**取/呈** | Sesame / 自有技术研究 | 取真实来源；自研结果不标为TC/AC |
| `instrument.id`<br>Instrument、symbol、ticker、标的 | 事实<br>**取** | EURUSD / broker-symbol | data-access + 对应market source；保留来源标识 |
| `instrument.name`<br>公司名、资产名、logo | 事实<br>**取/源** | 示例公司；logo未提供 | 行情目录可取名称；公司品牌/标识需资产主数据 |
| `instrument.market`<br>市场、exchange、region、asset_class | 事实<br>**取/源** | FX / broker / USD报价 | market source；区域和上市地需主数据补全 |
| `instrument.sector`<br>行业、sector、industry | 事实<br>**源** | 示例半导体行业 | 当前财务工具未建立统一公司行业主表 |
| `instrument.currency`<br>报价/报表/账户币种 | 事实<br>**取** | quote=USD，account=USD | 各源分别取；不能用报价币种替代财务币种 |
| `instrument.contract`<br>tick/pip、lot步长、乘数、合约类型 | 事实<br>**取/源** | pip=0.0001；标准手100000 | MT5/Binance/QMT已部分覆盖；pip需明确定义 |
| `scope.horizon`<br>Investment/Holding Horizon、forecast_minutes | 定义<br>**呈** | 未来4小时 | 与K线周期、回测区间分别保存 |
| `scope.bar_size`<br>Bar Size、interval/granularity | 事实<br>**取** | 1h | data-access spec；不要从持有期反推 |
| `scope.universe`<br>投资范围、同业范围、国家与筛选池 | 定义<br>**编/源** | 同行业40家公司 | 固定证券全集及纳入/退市规则 |
| `time.as_of`<br>as_of、data_as_of、Report Time | 来源<br>**取/呈** | 2026-10-26T12:00:00Z | 拆成数据截点与报告生成时间 |
| `time.observed_at`<br>价格/指标实际观察时刻 | 来源<br>**取** | 2026-10-26T11:59:00Z | 各适配器源时间；未知时不冒充UTC |
| `time.available_at`<br>首次可得/披露时间、acceptanceDateTime | 来源<br>**取/源** | 财报11月5日才可得 | financial-research已有外壳；缺原始发布档案需补 |
| `time.retrieved_at`<br>采集时间 | 来源<br>**取** | 2026-10-26T12:01:00Z | DataRef来源；不等于历史首次发布时间 |
| `time.timezone`<br>市场时区、session、calendarRevision | 来源<br>**取/源** | UTC；EU session | 券商墙钟需明确转换；未知日历保留未知 |
| `source.refs`<br>source_refs、URL、raw_ref、原文 | 来源<br>**取/呈** | 固定DataRef + URL | data-access / financial-research；报告绑定引用 |
| `source.version`<br>provider/version/endpoint/path、model_version | 来源<br>**取/编** | method=sesame.breakout.v1 | 现有hash/版本复用；新增供应商字段路径映射 |
| `source.status`<br>缺失状态、覆盖、许可、修订 | 来源<br>**取/编** | unknown / not_applicable | 已有coverage/status；许可与字段级状态需补 |
| `value.unit_scale`<br>单位、精度、score scale | 定义<br>**取/编** | 0.72 fraction；72 percent | 同时保留raw值与原尺度，禁止凭数值猜尺度 |

### 02 行情、技术指标与市场状态

| 规范键 / 字段 | 性质 / 当前状态 | 合成示例 | 获取、推导与缺口 |
| --- | --- | --- | --- |
| `price.reference`<br>Current/Reference Price、closing_price | 事实<br>**取** | 1.1000 USD/EUR | 同一来源和价格基准；market_read |
| `price.ohlcv`<br>OHLCV、时间、闭合状态 | 事实<br>**取** | H1收盘1.1000；tick volume | market_read；volume类型与单位单列 |
| `price.bid_ask`<br>bid、ask、spread | 事实/计算<br>**取/编** | 1.0999/1.1001；2 pip | MT5/Binance/QMT报价；ask-bid后换单位 |
| `price.return`<br>涨跌额、涨跌幅、Price Performance | 计算<br>**算/编** | 100→103；+3% | ABU收益/波动；基准与复权须一致 |
| `price.relative_strength`<br>相对板块/指数强弱 | 计算<br>**编/源** | 20日资产+4%，行业+1% | 两条同口径序列；额外行业/基准来源 |
| `market.trend`<br>trend、短/中/长期方向 | 判断<br>**编** | 日内偏弱；长期上升 | 指标/确认拐点可用；固定判定方法 |
| `market.volatility_regime`<br>volatility_regime、低/高波动状态 | 模型<br>**编** | 波动处于自身历史第80百分位 | 现有波动值+训练窗分位阈值 |
| `market.liquidity`<br>liquidity、成交活跃度/深度 | 事实/模型<br>**取/编/源** | 点差2pip；深度未取 | 报价可取部分；完整深度与冲击历史缺 |
| `indicator.ma`<br>SMA/EMA、MA20/MA50 | 计算<br>**算** | SMA20=102；SMA50=100 | abu-indicators；显式算法/初始化 |
| `indicator.rsi`<br>RSI | 计算<br>**算** | RSI14=58 | 当前实现均值法，不能默认为Wilder |
| `indicator.macd`<br>MACD、signal、histogram | 计算<br>**算** | DIF=0.5；signal=0.3 | abu-indicators；参数与预热一致 |
| `indicator.stochastic`<br>随机指标、K/D | 计算<br>**编** | K14=70，D3=65 | 需补版本化计算与平滑参数 |
| `indicator.bollinger`<br>Bollinger上下轨与带宽 | 计算<br>**算** | 中轨100；上104；下96 | abu-indicators；ddof/窗口固定 |
| `indicator.tr_atr`<br>True Range、ATR、ATR% | 计算<br>**算** | TR=60pip；ATR14=35pip | ABU各基线首TR不同；方法ID锁定 |
| `indicator.vwap`<br>VWAP | 计算<br>**算** | 样本累计VWAP=100.4 | abu-volatility；不是默认交易所当日VWAP |
| `indicator.hv`<br>收益标准差、年化HV | 计算<br>**算** | 日频HV=24% | abu-volatility；交易日数/收益定义固定 |
| `indicator.gap`<br>跳空幅度与标记 | 计算<br>**算** | 开盘较前收+1.2% | abu-volatility；公司行为与停市先解释 |
| `indicator.adc`<br>Adaptive Divergence Convergence | 专有<br>**授/编** | 原厂值缺；自研另命名 | TC公开框架但自适应周期不完整 |
| `market.snapshot`<br>指数/板块/商品/FX/加密表现 | 事实/汇总<br>**取/编/源** | 指数+0.6%；能源领先 | 行情可拼接；跨市场全集/行业源待补 |
| `market.risk_gauges`<br>VIX、国债收益率、DXY等 | 事实<br>**取/源** | 10Y收益率4.0% | FRED/行情按实际series与授权；无统一实时包 |

### 03 技术事件、几何、质量与生命周期

| 规范键 / 字段 | 性质 / 当前状态 | 合成示例 | 获取、推导与缺口 |
| --- | --- | --- | --- |
| `event.id`<br>result_uid、技术事件ID | 管理<br>**取/编/授** | demo-pattern-01 | 现有计算生成事件；原厂结果须接入；大ID用字符串 |
| `event.type`<br>Event Type、pattern_name、形态名称 | 判断<br>**算/编/授** | 已确认前高收盘突破 | 已有突破/有限PA/ICT；完整形态库未有 |
| `event.direction`<br>Idea Direction、bullish/bearish | 判断<br>**算/编/授** | forecast=up | 历史走势方向与预测方向分开 |
| `event.stage`<br>emerging/complete/failed/expired | 判断/管理<br>**编/授** | forming；尚未突破 | 现有confirmed事件基础；需机会生命周期 |
| `event.detected_at`<br>Detection/identified | 来源<br>**算/编/授** | 10:00检测，11:00确认 | AC内部found应忽略；检测时间不等于实际可行动时间 |
| `event.confirmed_at`<br>确认时间 | 来源<br>**算** | 右侧第3根闭合后确认 | PA/ICT源bar结束仅为确认下界；不证明当时已送达 |
| `event.earliest_action`<br>earliest_action、最早可行动时间 | 来源/方法<br>**取/编** | bar确认后，数据实际可得且市场可交易 | ABU依赖输入available_at；真实延迟/会话需补，未知不填确认时间 |
| `event.age_length`<br>age、length、形态起止 | 事实<br>**算/编/授** | 长40根；年龄2根 | 起止时间、长度单位与更新事件独立 |
| `event.expiry`<br>expires_at、relevant、失效原因 | 管理/判断<br>**编/授** | 16:00到期；未达标 | 需设超时/破坏/替代事件规则 |
| `event.history`<br>事件历史、bullish/bearish计数 | 统计<br>**编/源** | 近30日8多5空 | 先固定检测器与去重，再积累事件库 |
| `pattern.anchors`<br>摆动点、A/B/C/D/X、时间价位 | 计算<br>**算/编/授** | 高点A=103；确认时刻已记录 | ABU/PA提供拐点；谐波组合另算 |
| `pattern.point_count`<br>图形qty_tp、Fibonacci qtyTP | 计算<br>**算/编/授** | 5个形态转折点 | 按端点和路径解释；不当作水平位触碰次数 |
| `pattern.boundaries`<br>支撑/阻力线端点、几何边界 | 计算<br>**编/授** | resistance=(t1,103)-(t2,103) | 趋势线拟合/容差需新增；绘图只呈现 |
| `pattern.height`<br>形态高度 | 计算<br>**编** | 区间57−47=10 | 明确形态/基底；不能对所有事件套高度法 |
| `pattern.ratios`<br>Fibonacci比例与阶梯 | 计算<br>**算/编/授** | 回撤0.618；target10=1.2800 | ABU有最近高低点水平；完整ABCD/Gartley需补 |
| `pattern.continuation`<br>Continuation/Reversal、trend_change | 判断<br>**编/授** | continuation | 以前置趋势和形态定义判定 |
| `levels.values`<br>Key Levels、support/resistance | 计算<br>**算/编** | 支撑98、阻力103/110 | ABU聚类水平；原厂值需授权 |
| `levels.significance`<br>Level Significance、星级/重要性 | 判断<br>**编/授** | 强/中/弱；自有规则v1 | 触碰数/距离可算；TC星级精确规则未公开 |
| `levels.touches`<br>Key Level qtyTP、触碰时刻 | 计算<br>**算/编/授** | 4次确认触碰 | ABU聚类已有；仅水平位路径适用，图形/Fib点数另存 |
| `levels.approach`<br>接近区、approachingTime/Price | 判断<br>**编/授** | 距150阻力0.15 | 需定义阈值；接近不等于反转 |
| `levels.round`<br>整数关口与穿越状态 | 判断<br>**编/授** | BTC接近100000 | 自有粒度规则；AC专属raw schema待验 |
| `quality.overall`<br>Technical Score、quality、averageQuality | 专有/模型<br>**授/编** | AC原始quality=0.70 | 自研质量必须另命名；不是70%胜率 |
| `quality.components`<br>clarity/uniformity/initial_trend/breakout/volume | 专有<br>**授/编** | clarity=0.80；breakout不适用 | 原厂0–1；子项公式未完整公开 |
| `quality.fibonacci`<br>ratioQuality、timeQuality | 专有<br>**授/编** | ratioQuality=0.84 | 几何拟合；不能转换成交易成功率 |
| `anomaly.movement`<br>from/to_price、movement | 计算<br>**编/授** | 1.1000→1.1060，60pip | 现有价格输入可算；检测/分位需固定窗口 |
| `anomaly.consecutive`<br>qty_candles、连续方向 | 计算<br>**编/授** | 连续6根上涨 | doji/平价定义与样本窗明确 |
| `anomaly.percentile`<br>异常百分位、统计基准 | 统计<br>**编/源/授** | 历史第98百分位 | ≥95与0.98端点尺度不同；不是反转概率 |
| `chart.annotations`<br>Annotated/Reference Chart、drawing | 展示<br>**呈/编** | K线+拐点+目标区域 | reports内置candlestick；图元来自真实计算 |

### 04 观点、情景与执行计划

| 规范键 / 字段 | 性质 / 当前状态 | 合成示例 | 获取、推导与缺口 |
| --- | --- | --- | --- |
| `thesis.summary`<br>thesis.summary、Comment、Market Outlook | 判断<br>**编** | 突破前等待确认 | 基于已取证据与方法；不是取数结果 |
| `thesis.direction`<br>Strategy、Long/Short/Neutral | 判断<br>**编/授** | conditional-long | 条件未成立时不写已触发 |
| `thesis.status`<br>thesis.status、Decision、Value Status | 判断<br>**编** | watching | 区分观点状态与实际订单状态 |
| `scenario.primary`<br>Preferred Scenario、primary_scenario | 判断<br>**编/授** | 收盘突破103后观察回踩 | 原厂情景授权；自有规则可组合 |
| `scenario.alternative`<br>Alternative Scenario、trigger/action | 判断<br>**编/授** | 跌破98后退出原多头观点 | 条件是业务信息，避免无意义免责声明 |
| `scenario.entry`<br>Entry Price/reference/zone/condition | 判断<br>**编/授** | 103确认；候选入场103–104 | 价格、区域、触发、执行方式分开 |
| `scenario.invalidation`<br>Pivot、invalidation_price | 判断<br>**编/授** | 98失效 | 技术失效位不等于传统OHLC Pivot点 |
| `scenario.stop`<br>Stop Price/stop_loss | 判断/计算<br>**算/编** | 计划止损98 | 已有ATR退出；结构止损规则需定 |
| `scenario.targets`<br>Target1/2、target_level | 判断/计算<br>**编/授** | 110/115 | 来源可为结构/高度/原厂；保存期限 |
| `scenario.target_region`<br>预测价格范围与期限 | 模型<br>**编/源/授** | 未来4h目标110–112 | 双侧波动区间另列；概率区间需校准 |
| `scenario.expected_action`<br>Expected Price Action、Signal Rationale | 判断<br>**编/授** | 趋势延续；先确认再执行 | 含证据与条件，避免仅报“看多” |
| `scenario.reward_risk`<br>reward_risk_at_entry_reference | 计算<br>**编** | entry103，stop98，T1=113→2R | (target-entry)/(entry-stop)，费用另计 |
| `evidence.supporting`<br>evidence[].type/finding/source/timeframe | 来源/判断<br>**取/编** | H1收盘突破；固定数据引用 | 分离原始事实与解释 |
| `evidence.conflicts`<br>conflicting_evidence、evidence_conflicts | 判断<br>**编** | H1强、D1仍受阻 | 不同周期不必视为数据错误 |
| `evidence.independence`<br>同源/独立证据与共振 | 定义/统计<br>**编** | RSI和MACD来自同一价格序列 | 不简单累加或相乘“概率” |
| `monitoring.recheck`<br>monitoring.recheck_on、提醒条件 | 管理/判断<br>**呈/编** | 突破103/事件公布后复查 | 由编排/监控实现；报告保存条件 |

### 05 波动、账户风险与规模

| 规范键 / 字段 | 性质 / 当前状态 | 合成示例 | 获取、推导与缺口 |
| --- | --- | --- | --- |
| `risk.account`<br>equity/balance、currency、margin | 事实<br>**取** | 权益10000USD | MT5/QMT；Binance未换汇资产余额不冒充净值 |
| `risk.position`<br>side/quantity/averagePrice/PnL | 事实<br>**取** | 多头0.2手 | 对应账户source；PnL维持原红绿色义 |
| `risk.budget_fraction`<br>max_portfolio_risk_fraction | 决策<br>**编** | 0.005，即0.5% | 用户/策略预算；不是供应商默认授权 |
| `risk.cash`<br>account_risk、risk_amount | 计算<br>**算** | 10000×0.5%=50USD | ABU sizing；金额与比例不同字段 |
| `risk.stop_variants`<br>Tight/Medium/Loose、trailing offset | 计算<br>**算/编** | ATR×1/2/3（自有示例） | ABU已有ATR退出；三档参数另定，非TC系数 |
| `risk.stop_distance`<br>risk_in_pips、ATR stop distance | 计算<br>**算/编** | 入场1.1000至1.0950=50pip | 合约单位/币种转换需一致 |
| `risk.quantity`<br>lot_size、quantity_estimate | 计算<br>**算/编** | 风险100USD、50pip→0.20手 | ABU需point_value/quantity_unit；MT5可算单量盈亏；统一跨币种/任意止损/步长衔接需补 |
| `risk.profit_margin_calc`<br>order_calc_profit/margin | 计算<br>**算** | 0.2手50pip风险100USD | MT5原生只计算；不等于发单 |
| `risk.costs`<br>点差、佣金、滑点、融资/借券 | 事实/模型<br>**取/编/源** | 双边成本8USD | 历史成交部分可取；冲击/未来滑点需模型与样本 |
| `risk.event`<br>event_risk、跳空/财报等风险 | 判断<br>**取/编/源** | 1小时后就业数据 | 结构化未来日历需补源 |
| `risk.expected_ranges`<br>low/high_15/30/60/240/1440 | 模型<br>**编/源/授** | H1范围1.0985–1.1015 | 自研需历史分布和回测；不是方向目标 |
| `risk.seasonality`<br>日内/周内波动 | 统计<br>**编/源/授** | 纽约开盘时段较活跃 | 时区/DST/交易日历与半年以上样本 |
| `risk.relative_volatility`<br>rank/rank_rounded、标的相对波动排序 | 统计<br>**编/源/授** | 当前返回集合中排名第3 | 保留排名集合与时刻；不是星期或日内季节性 |
| `risk.stress`<br>压力情景、组合损失/敞口 | 模型<br>**编/源** | 跳空2ATR时损失150USD | 同步持仓/相关资产/跨币种风险源 |

### 06 财务事实、比率与周期

| 规范键 / 字段 | 性质 / 当前状态 | 合成示例 | 获取、推导与缺口 |
| --- | --- | --- | --- |
| `fund.period`<br>报告期、fiscalYear/period、TTM | 事实/计算<br>**取/编** | 2026Q2；TTM由4季相加 | SEC/FMP原始期可取；TTM需处理年度/累计口径 |
| `fund.filing`<br>accession、form、filingDate、公告链接 | 事实<br>**取** | 10-Q / 原始文档URL | financial-research SEC索引；正文需另读 |
| `fund.revenue`<br>营收、revenue | 事实<br>**取** | 1000M USD | SEC/FMP实际返回，币种/财期明确 |
| `fund.net_income`<br>净利润、EPS、稀释股数 | 事实<br>**取/源** | 净利100M；EPS2.0 | SEC/FMP；股数概念/稀释口径需映射 |
| `fund.balance`<br>资产/负债/权益/现金/债务 | 事实<br>**取** | 资产2000M；权益1000M | SEC/FMP三表原料 |
| `fund.cashflow`<br>经营现金流、资本开支、FCF | 事实/计算<br>**取/编** | CFO150M；capex50M；FCF100M | FCF定义明确；原表符号先标准化 |
| `fund.market_cap`<br>Market Cap | 计算/事实<br>**编/源** | 50M股×100=5000M | 当前源未保证profile市值；点时流通/总股数 |
| `fund.pe`<br>P/E、Trailing P/E | 计算<br>**编** | price100/EPS5=20 | TTM/forward分开；负EPS不硬填正常倍数 |
| `fund.pb`<br>P/B | 计算<br>**编** | 市值5000M/权益2500M=2 | 权益归属和价格时间一致 |
| `fund.ps`<br>Price/Sales | 计算<br>**编** | 市值5000M/营收2500M=2 | TTM和稀释股本口径固定 |
| `fund.fcf_yield`<br>自由现金流收益率 | 计算<br>**编** | FCF250M/市值5000M=5% | CFO-capex、企业/股权口径不能混 |
| `fund.growth`<br>Revenue/EPS增长 | 计算<br>**编** | 营收1000→1100M，+10% | 同比可比期；基数为负另处理 |
| `fund.margins`<br>利润率/现金转化率 | 计算<br>**编** | 净利100/营收1000=10% | 研发/一次性项等调整单独版本 |
| `fund.roe`<br>ROE、ROA、质量指标 | 计算<br>**编** | 净利100/平均权益1000=10% | 平均期初期末权益；不使用期末替代未说明 |
| `fund.leverage`<br>杠杆、偿债能力、利息覆盖 | 计算<br>**编** | 净债务/EBITDA=2 | 所需EBITDA/利息实际字段映射 |
| `fund.dividend`<br>股息、Dividend Yield、Payout | 事实/计算<br>**源/编** | 年股息2/价格100=2% | 独立股息/公司行为源待补；比率方法可算 |
| `fund.revisions`<br>分析师盈利预测及修正 | 事实/统计<br>**源/编** | EPS预期2.0→2.2 | grades不是盈利预期数据 |
| `fund.insiders`<br>内部人交易/持股变动 | 事实<br>**取** | 申报买入1000股 | FMP insider事件；不推断内幕动机 |
| `fund.peer_rank`<br>Peer Comparison、Sector Ranking | 统计<br>**编/源** | 同业40家中第8 | 行业全集+点时比较口径 |
| `macro.series`<br>FRED序列值/单位/频率/季调 | 事实<br>**取** | 实际GDP、季度、季调年率 | FRED series+observations；不是事件共识日历 |
| `macro.vintage`<br>realtime_start/end、修订版本 | 来源<br>**取/源** | 当时可见vintage | FRED保守as_of已有；精确发布时间仍需源 |
| `macro.cycle`<br>Nowcasting、经济阶段/风格适配 | 模型<br>**编/源/授** | 增长放缓、质量风格适配 | 原厂周期模型未全公开；自有方法另标 |
| `cot.positions`<br>CFTC各类多空/OI/交易者数 | 事实<br>**取** | M-money long10000/short8000 | Disaggregated Futures Only；公布时刻需补 |
| `cot.net`<br>净仓、占OI、历史分位 | 计算<br>**编** | 净多2000；占OI10% | 相同合约/周度/历史窗口；不是散户投票 |

### 07 综合评分、估值与共识

| 规范键 / 字段 | 性质 / 当前状态 | 合成示例 | 获取、推导与缺口 |
| --- | --- | --- | --- |
| `score.quantamental`<br>Quantamental Rating、综合信号 | 专有/模型<br>**授/编** | 自有68/100 | 原厂需授权；自有权重/标准化/缺失规则公开 |
| `score.factors`<br>Value/Growth/Momentum/Income/Quality | 专有/模型<br>**授/编** | 自有82/54/63/43/71 | 现有因子工具可测，不是现成TC评分 |
| `score.labels`<br>六个*Label、评级解释 | 专有/判断<br>**授/编** | valuationLabel=very-strong | TC标签存在；阈值未全公开；自有映射另定义 |
| `score.technical`<br>Technical Summary、趋势评分 | 专有/模型<br>**授/编** | short=bullish；long=neutral | 原厂版本/期限保留，不与五因子硬均分 |
| `valuation.fair_value`<br>Fair Value | 模型<br>**编/源/授** | 120USD | 自研剩余收益/DCF需假设；TC输出需授权 |
| `valuation.gap`<br>Valuation Gap、折价/上行空间 | 计算<br>**编** | 现价100对FV120：上行20%，折价16.67% | 分母明确：相对现价 vs 相对公允值 |
| `valuation.target`<br>TC Target Price 12M、自有模型目标 | 模型<br>**编/源/授** | 12月目标112 | 估值不自动等于12月市场价格模型 |
| `valuation.target_return`<br>Target Return、目标上行 | 计算<br>**编** | 112/100−1=12% | 目标与参考价各有时刻；是否含股息 |
| `valuation.assumptions`<br>盈利预测、资本成本、增长/终值 | 模型输入<br>**编/源** | k=10%；永续g=3% | 自有假设可设，但须标假设并做敏感性 |
| `valuation.sensitivity`<br>牛/基/熊估值区间 | 模型<br>**编** | 95/120/145 | 不叫统计置信区间；DCF/剩余收益情景 |
| `valuation.update`<br>更新频率、模型日期 | 来源<br>**授/编** | FV月15日；模型目标月更 | 各产品不同；不统一为实时 |
| `analyst.grade_events`<br>评级变动、机构、新旧评级 | 事实<br>**取** | Hold→Buy | financial-research FMP grades |
| `analyst.consensus`<br>Analyst Consensus、总体Buy/Hold/Sell | 统计<br>**源/编/授** | Buy | 新增共识端点；事件列表不能替代当前持有评级 |
| `analyst.counts`<br>Buy/Hold/Sell人数、样本数 | 统计<br>**源** | 12/6/2，共20 | 去重机构/分析师、最新日期/覆盖 |
| `analyst.targets`<br>mean/high/low target | 统计<br>**源/编/授** | 115/145/85 | FMP目标共识端点待接；不是TC模型目标 |
| `analyst.dispersion`<br>目标分歧、修订趋势/期限 | 统计<br>**编/源** | 高低差60；期限未提供 | 需要逐条预期或供应商汇总；不默认12月 |

### 08 经济、公司事件与历史冲击

| 规范键 / 字段 | 性质 / 当前状态 | 合成示例 | 获取、推导与缺口 |
| --- | --- | --- | --- |
| `calendar.identity`<br>event_uid/name/type、country/currency | 事实<br>**源/取** | US就业 / USD | FRED有观测；未来结构化事件表缺，网页可补证 |
| `calendar.release`<br>Release Time、盘前/盘后、确认状态 | 事实<br>**源** | 2026-11-06 13:30Z，confirmed | 日历源/DST；预计日期与正式日期分开 |
| `calendar.importance`<br>Importance、事件类别/频率 | 供应商判断<br>**源/编/授** | high / monthly | 供应商分档或明确自有规则；不是概率 |
| `calendar.values`<br>Actual/Forecast/Previous、单位 | 事实<br>**取/源** | 90k/70k/60k | 实际宏观序列部分可取；共识/首发/前值同表缺 |
| `calendar.surprise`<br>actual−forecast、above/below/inline | 计算<br>**编/源** | +20k，above | 来源齐备才算；等于容差/修订固定 |
| `calendar.corporate`<br>earnings/meeting/dividend/split | 事实<br>**源** | 财报盘后；拆股2:1 | SEC索引不是完整未来公司日历 |
| `calendar.earnings`<br>fiscal quarter、EPS consensus/actual | 事实<br>**源/取** | 预期1.20；实际未公布 | 实际报表部分已取；预期与未来时间需新源 |
| `calendar.dividend`<br>除息/登记/支付日、每股金额 | 事实<br>**源** | 每股0.50USD；除息11月10日 | 公司行动专用源，避免从报道拼完整全集 |
| `calendar.split`<br>拆股生效日/比例、复权因子 | 事实<br>**源** | 2:1 | 要与行情复权统一 |
| `impact.window`<br>5m/15m/30m/1h/4h、trend_length | 定义<br>**编/授** | 事件后60分钟 | 固定t0、交易日历/价格基准 |
| `impact.move`<br>价格净变动、方向、pips | 计算<br>**编** | 1.1000→1.0970，−30pip | 同一来源事件窗行情 |
| `impact.true_range`<br>事件TR、历史平均TR、ATR-based | 计算/统计<br>**算/编** | 前收1.1000、高1.1020、低1.0960，TR60pip | TR基础已有；事件样本匹配与聚合需新增 |
| `impact.condition`<br>delta_sign、趋势方向 | 定义/判断<br>**编/授** | actual>forecast，价格趋势向下 | 不能把经济数字高低当资产利好利空 |
| `impact.sample`<br>sample_size、条件样本/历史窗口 | 统计<br>**编/源/授** | 总12；above组8 | 总样本和条件样本分别统计 |
| `impact.frequency`<br>历史涨跌频次、probability | 统计/专有<br>**编/源/授** | above组6/8下跌=75% | 条件频次，不是本次实际高于预期概率 |
| `impact.distributions`<br>正常/事件min/p25/median/p75/max/mean/std | 统计<br>**编/源/授** | 正常中位12pip；事件30pip | 成对同时间窗样本；n与单位随分布保存 |
| `impact.difference`<br>volatility_diff/percent/value | 计算<br>**编/授** | (30−12)/12=150% | 标注比较统计量；差值std可为负 |
| `impact.money`<br>mean_mov_value、pip_value、换汇时刻 | 计算<br>**编/授** | 18pip×每pip10USD=180USD/手 | 合约/账户币种/汇率时刻 |
| `impact.history`<br>历次date/expected/actual/delta/trend | 事实/统计<br>**源/编** | 12次首发事件及1h路径 | 必须点时版本，当前修订宏观值不替代 |
| `impact.concurrent`<br>同时事件、样本排除/对照 | 方法<br>**编/源** | 同时发布失业率；无法单因果归因 | 事件研究设计，记录混杂因素 |

### 09 新闻、情绪、关注度与传播

| 规范键 / 字段 | 性质 / 当前状态 | 合成示例 | 获取、推导与缺口 |
| --- | --- | --- | --- |
| `news.article`<br>headline/title、URL、正文/摘要 | 事实<br>**取** | 某公司发布新订单 | FMP stock news、web、RSS；摘要非全文 |
| `news.source`<br>source_info、来源/类型/作者 | 来源<br>**取/编** | 新闻社 / news | 原文归属与转载聚类需补 |
| `news.published`<br>publication time、语言、版本 | 来源<br>**取** | 2026-10-26T09:00Z | 原始发布时间/采集时间分开 |
| `news.entity_topic`<br>资产实体、topic、event type | 模型<br>**编/授** | DEMO / 订单 / 监管 | 需要实体链接/去重/分类规则 |
| `news.mentions`<br>News Volume、Buzz Volume、total_mentions | 统计<br>**编/源/授** | 24h去重提及320 | 当前有限分页≠全网统计；限定语料范围 |
| `news.baseline`<br>基准量、volume_ratio、Buzz Score | 统计/专有<br>**编/源/授** | 320/80=4倍 | 自有量比可算，不能叫TC原厂Buzz公式 |
| `news.channels`<br>news/web/social来源占比 | 统计<br>**编/源** | news70%、blog20%、social10% | 源全集与同一窗口；社交是否计分按产品 |
| `sentiment.score`<br>Sentiment Score、News Sentiment | 模型/专有<br>**编/授** | 原厂72/100 | NLP模型/语料/尺度版本须记录 |
| `sentiment.signal`<br>Bullish/Bearish/Neutral | 判断<br>**编/授** | bullish | 阈值依模型，不自动来自市场收益 |
| `sentiment.subjectivity`<br>Subjectivity Score | 专有<br>**授/编** | 81/100 | 文本主观性不是新闻真假 |
| `sentiment.confidence`<br>Confidence Index、证据量等级 | 专有/统计<br>**授/编** | Average | 不同于预测置信区间或上涨概率 |
| `sentiment.trend`<br>Sentiment Trend/Monitor/Histogram | 模型<br>**编/源/授** | 强弱72，趋势直方图46 | 近期/历史情绪；TC直方图50阈值只属该指标 |
| `sentiment.history`<br>情绪/价格历史、sentiment_change | 统计<br>**编/源/授** | 365日序列；70→65 | 缺历史语料/旧分数时不能回填伪历史 |
| `sentiment.fear`<br>Fear Index、市场比较 | 专有<br>**授/编** | 90交易日历史；原值待取 | TC Fear不等于VIX；未公开阈值不捏造 |
| `sentiment.peer`<br>Peer Comparison、sector sentiment | 统计<br>**编/源/授** | 同业中位情绪55 | 同一模型、语料时间与行业全集 |
| `social.sample`<br>Reddit score/comments/upvote_ratio | 事实<br>**取** | 30帖；单帖42评论 | 当前有限社区样本；不代表全市场散户态度 |
| `media.asset`<br>视频/文章标题、语言、时间、URL/稿 | 事实/展示<br>**取/呈/源** | 3分钟市场短评及文字稿 | 网页媒体引用；商业媒体全文/分发许可另核 |

### 10 期权合约、波动率与组合

| 规范键 / 字段 | 性质 / 当前状态 | 合成示例 | 获取、推导与缺口 |
| --- | --- | --- | --- |
| `option.contract`<br>代码、call/put、strike、expiry、乘数 | 事实<br>**源** | DEMO call K100，乘数100 | 当前无结构化期权链；不能从现货推出 |
| `option.quote`<br>bid/ask/last、报价时刻、volume/OI | 事实<br>**源** | 3.0/3.2；OI1000 | 同步underlying；低流动性报价过滤 |
| `option.exercise`<br>美/欧式、结算、交割与公司行为 | 事实<br>**源** | 美式、实物交割 | 决定提前行权和模型，链源需明确 |
| `option.iv`<br>IV、Volatility Levels | 模型<br>**源/编/授** | 30%年化 | 真实权利金+合约+利率股息+定价模型 |
| `option.iv_history`<br>历史IV、HV比较 | 事实/模型<br>**源/编** | 过去252交易日IV | 今日链不能还原历史报价与IV |
| `option.iv_rank`<br>IV Rank、IV Percentile | 统计<br>**源/编/授** | IVR75；IV百分位另存 | 100×(IV-min)/(max-min)；max=min未定义；历史窗与可比IV序列固定，百分位另算 |
| `option.skew`<br>上/下行偏斜、期限偏斜 | 模型<br>**源/编/授** | 同到期90%put IV35%，110%call IV28% | 执行价偏斜用同到期；期限结构固定delta/moneyness再跨到期 |
| `option.surface_cone`<br>IV曲面、期限结构、波动锥 | 模型/统计<br>**源/编/授** | strike×expiry矩阵 | 需真实链和历史；插值方法与空洞保留 |
| `option.expected_move`<br>预期波动范围/到期价格区间 | 模型<br>**源/编/授** | 30日±8.6%（自有近似） | σ√T需假设；不是原厂区间/确定目标 |
| `option.greeks`<br>Delta/Gamma/Vega/Theta/Rho | 模型<br>**源/编** | Delta=0.55 | 非本次证实TC必返字段；自有扩展 |
| `option.preference`<br>方向、幅度、目标、风险偏好 | 决策输入<br>**呈** | 温和看涨、限定最大损失 | 由需求给出，不从分数推断用户权限 |
| `option.strategies`<br>首选/替代策略、排名理由 | 判断/模型<br>**编/源/授** | bull call spread / long call | 需真实可成交价格、事件和成本后比较 |
| `option.legs`<br>每腿方向、类型、执行价、到期、数量 | 计划<br>**编/源** | 买100call，卖110call，同到期 | 组合乘数一致、合约标识唯一 |
| `option.premium`<br>净付/净收权利金 | 计算<br>**编/源** | debit3/股，合计300 | mid估值与可成交bid/ask分开 |
| `option.max_loss`<br>最大亏损 | 计算<br>**编/源** | 300USD | 到期结构的确定性计算；裸卖可能无界 |
| `option.max_profit`<br>最大收益 | 计算<br>**编/源** | 700USD | 不等于期望收益 |
| `option.breakeven`<br>到期盈亏平衡 | 计算<br>**编/源** | 103USD | 到期前还受IV/时间影响 |
| `option.payoff`<br>到期损益曲线/情景损益 | 计算<br>**编/源/呈** | S=108时净收益500USD | 明确到期/估值时点；reports展示 |
| `option.pop`<br>Probability of Profit | 模型/专有<br>**编/源/授** | P(净损益>0)=0.60（合成概率） | 需分布/风险中性或真实概率区分、成本与验证；不是期望利润 |
| `option.expected_profit`<br>Expected Profit、期望利润 | 模型<br>**编/源/授** | 0.6×100+0.4×(−200)=−20USD | E[净损益]以金额/收益率表示；高胜率仍可负期望 |

### 11 筛选、策略、组合与回测

| 规范键 / 字段 | 性质 / 当前状态 | 合成示例 | 获取、推导与缺口 |
| --- | --- | --- | --- |
| `screen.name`<br>Strategy Name/Description/Objective | 定义<br>**呈** | 零售价值筛选 | 将目的与实际规则分开 |
| `screen.conditions`<br>Filters、逻辑组合 | 定义<br>**编** | marketCap≥300M AND P/S≤1 | 当前自有筛选可写；TC任意OR未证实 |
| `screen.matches`<br>匹配数、名单、TopN | 计算<br>**编/源** | 18匹配，选10 | 证券全集与缺失排除可追溯 |
| `screen.rank`<br>rank、score、排序/并列规则 | 模型<br>**编** | 归一化因子均值排序 | factor-evaluator可测因子；非现成选股器 |
| `portfolio.constituents`<br>当前/新增/移除成分及权重 | 事实/计算<br>**取/编/源** | 10股等权；两只替换 | 实际持仓与模拟组合分开；指数方案可复用 |
| `portfolio.rebalance`<br>换仓频率/日期、权重约束 | 定义<br>**编** | 每13周换仓（TC筛选示例） | TC指数月调50股与筛选回测不同 |
| `portfolio.exposure`<br>行业/资产/币种/相关性敞口 | 计算<br>**编/源** | 科技40%、USD80% | 真实持仓+资产主数据+汇率/相关历史 |
| `backtest.window`<br>Start/End、训练/验证/留出区间 | 定义<br>**算/编** | 2021–2025训练，2026留出 | evaluator固定计划；样本可得时间需成立 |
| `backtest.equity`<br>Equity Curve、Historical Performance | 计算<br>**算** | 初值1，5年终值1.8 | 回测引擎输出；清楚现金/保证金模型 |
| `backtest.return`<br>Total Return、CAGR | 计算<br>**算** | 1.8^(1/5)−1=12.47% | ABU trade-metrics；实际期限不是行数 |
| `backtest.benchmark`<br>Benchmark、超额收益 | 计算<br>**算/编/源** | 基准CAGR9.86%，差2.61pp | 收益差不称风险调整alpha |
| `backtest.drawdown`<br>Max Drawdown、回撤路径 | 计算<br>**算** | 最大回撤−15% | ABU metrics/evaluator；值域与符号明确 |
| `backtest.sharpe`<br>Sharpe、波动风险 | 统计<br>**算** | Sharpe0.9 | 频率、无风险率和自相关假设 |
| `backtest.trades`<br>成交/交易数、win rate、profit factor | 统计<br>**算** | 100笔、55盈利；PF1.3 | 必须真实模拟成交日志；因子IC不替代 |
| `backtest.costs`<br>费用、滑点、换手与融资 | 模型/统计<br>**算/编/源** | 毛收益12%，成本2%，净10% | 引擎实际设定与数据；缺成本不默认完备 |
| `backtest.assumptions`<br>成交价/停牌/退市/股息/复权 | 方法<br>**编/源** | 次根开盘成交；股息再投 | 点时全集/公司行为源是关键 |
| `backtest.attribution`<br>逐策略/因子/资产收益贡献 | 计算<br>**算/编** | 趋势+6%，均值回归−1% | ABU有策略归因；因子归因需额外模型 |
| `backtest.update`<br>报告更新、Daily/Weekly/Monthly alerts | 管理<br>**呈/编** | 每周五更新 | 调度通知与投资指标分开 |
| `idea.card`<br>Headline/Idea Details、候选机会 | 判断/展示<br>**编/呈/授** | H1三角突破候选 | 组合事件+理由+时间；未触发不叫已下单 |
| `idea.watch_trade`<br>Watchlist Status、Trade Action/URL | 管理/展示<br>**呈/编** | 加入观察；打开交易计划 | UI操作入口不视作已成交或交易授权 |

### 12 统计验证、概率与结果跟踪

| 规范键 / 字段 | 性质 / 当前状态 | 合成示例 | 获取、推导与缺口 |
| --- | --- | --- | --- |
| `stats.sample`<br>total/correct、样本/分组/起止 | 统计<br>**算/编/源/授** | 200事件、140达标 | evaluator能评诊断；形态事件库需另建 |
| `stats.hit_rate`<br>percentage、历史目标触及率 | 统计<br>**编/源/授** | 140/200=70% | 不含止损先后/成本则不叫盈利率 |
| `stats.favorites`<br>percent、hod/symbol/pattern分组统计 | 专有<br>**授/编** | percent=68.5；分组各有n | AC总值组合未公开；自研不反推等价 |
| `stats.correlating`<br>Correlating Alerts percent_probability | 专有<br>**授/编** | 同向聚合原厂值72% | 与Favorites分开；完整共振算法未公开，不用两个概率相乘 |
| `stats.confidence_interval`<br>bootstrap/Wilson区间 | 统计<br>**算/编** | 140/200的Wilson95%约63.3–75.9% | evaluator有bootstrap；比例Wilson需新增 |
| `factor.ic`<br>IC、rank IC、coverage、net return | 统计<br>**算** | time-series IC0.04 | factor-evaluator/CLI；单资产可做时序 |
| `factor.redundancy`<br>因子相关/冗余、选择回执 | 统计<br>**算** | 训练集相关0.92，保留一项 | train-only筛选；不能用留出集调阈值 |
| `validation.placebo`<br>安慰剂测试 | 统计<br>**算** | 打乱标签对照 | evaluator已有；检验何种null需明确 |
| `validation.monte_carlo`<br>蒙特卡洛模拟 | 统计<br>**算** | 经验分块重采样诊断收益路径 | 当前不是交易执行顺序仿真；其他生成机制需另实现 |
| `validation.out_of_sample`<br>样本外测试 | 统计<br>**算** | 冻结后评未参与选择的数据 | holdout需真正未使用 |
| `validation.walk_forward`<br>滚动前推测试 | 统计<br>**算** | 固定候选在前推窗评估，阈值来自训练期 | 当前不等于每窗重新训练/选参；不能全样本先选参再伪前推 |
| `validation.sensitivity`<br>参数敏感性 | 统计<br>**算** | 窗口10/15/20 | 关注稳定区间，避免只报最好点 |
| `validation.regimes`<br>市场状态分层 | 统计<br>**算/源** | 高波动/低波动分别评估 | regime标签必须点时可得 |
| `validation.bootstrap`<br>bootstrap置信区间 | 统计<br>**算** | 分块重采样收益均值区间 | 样本依赖决定重采样单元 |
| `forecast.probability`<br>事前概率、基准概率 | 模型/判断<br>**编/呈** | P=0.65；base=0.5 | 概率由研究方法产生；judgment登记而不估计事前概率 |
| `outcome.definition`<br>outcome、期限、标量/路径判据 | 定义<br>**呈/编** | 4h内先触110还是98 | 当前judgment只核验窗口内最新标量；路径需补 |
| `outcome.realized`<br>实际结果、MAE/MFE、达标/到期 | 统计<br>**算/编/源** | 先止损；随后才达目标 | 回测路径层生成；同bar双触需更细数据/明确规则 |
| `outcome.calibration`<br>Brier、baseline_Brier、confidence_calibration | 统计<br>**算/编** | n=100，Brier0.22 | judgment有Brier/5档校准；不能声称已有成熟历史库 |
| `outcome.attribution`<br>原因归因、模型/数据/执行差异 | 判断/统计<br>**编** | 方向对，成本后亏损 | 固定原判断，不能事后改目标与期限 |

### 13 叙述、展示与交付

| 规范键 / 字段 | 性质 / 当前状态 | 合成示例 | 获取、推导与缺口 |
| --- | --- | --- | --- |
| `report.modules`<br>一个或多个报告模块、sections | 管理<br>**呈/编** | 技术情景+事件影响+风险 | 需新增业务recipe；复用reports outline |
| `report.summary`<br>简明结论、Market Commentary/Wrap | 判断/展示<br>**编/呈** | 先说机会与触发条件 | 主agent综合固定研究结果 |
| `report.story`<br>FIBI各Story、自然语言解释 | 展示/判断<br>**编/授** | 技术/基本面/新闻故事 | 自有agent可综合；TC FIBI需授权 |
| `report.charts`<br>图表/Reference Chart/Payoff等 | 展示<br>**呈** | candlestick / decision-tree / boxplot | reports已有26种图型；图表不创造数据 |
| `report.details`<br>Research Detail、关联报告/组合上下文 | 管理<br>**呈** | 引用估值报告与实际持仓 | ArtifactRef去重；避免相同报告重复出现 |
| `report.risk_text`<br>原稿Risk Disclosure/风险披露 | 文案<br>**呈** | 仅保留影响决策的具体事件风险 | 供应商必要署名/许可文本按合同；不默认生成空泛章节 |
| `report.publish`<br>生成/发布版本、文件路径、状态 | 管理<br>**呈** | 单文件HTML；固定revision | reports publish/check，报告存在才可引用 |
| `report.export`<br>PDF/PNG导出与状态 | 管理<br>**呈** | 导出成功短提示 | 已有export检查；本研究交付HTML/MD/CSV |
| `report.delivery`<br>channel/language/frequency/session | 管理<br>**呈/编** | EU早报 / zh / daily | 邮件、视频、Portal是交付形式，不新增信号 |

## 附录 B：Autochartist 已公开机器字段的完整分组归类

以下完整保留本次官方文档核对中出现的字段组，补上归类与业务映射。`priceA/B/...`、`x0…x9` 等缩写需在真正接入时展开；同名 `value`、`direction`、`percent` 必须连同端点与 JSON 路径识别。这里包括传输字段，**不应把所有字段都塞入报告正文**。生产空值、枚举、许可及样例冲突仍待授权样本验证。[开发者目录][A01]

| 原始来源/层级 | 文档出现的字段 | 归类 → 业务映射 |
| --- | --- | --- |
| 通用响应封装 | date, query, page, items, new, data, links；分页 number, limit, offset, total_items, total_pages；链接 rel, href, display, enabled, active | 传输与分页元数据 → source.refs/source.status；不进投资正文 |
| Technical / Market Alerts 顶层结果 | result_type, result_uid, direction, prediction_time_to, prediction_price_from, prediction_price_to, pip, exchange, group_name, symbol, symbol_name, symbol_id, interval, pattern, pattern_list, complete, identified, age, length, found, analysis_text, analysis_text_list, analysis_text_template, expires_at, signal_levels, detail, drawing, target_period_list, symbol_pip；多语项 locale, text | 身份、事件、生命周期、文本、来源 → event.*、scenario.*、time.*、instrument.* |
| signal_levels（正文/样例） | entry_level, stop_loss, target_level, target_period；Market Alerts样例另有 target_period_in_min | 入场、止损、目标与期限 → scenario.entry/stop/targets、scope.horizon |
| 详情共用 | symbol, exchange, short_name, long_name, age, complete, direction, granularity, forecast_minutes, is_new, length, pattern_start_time, pattern_end_time, pattern_name, relevant, result_uid；样例另有 pattern_id, symbol_id, prediction_pip_profit, symbol_pip | 身份、周期、事件状态 → instrument.*、event.*、scope.* |
| 图形形态详情 | breakout, clarity, initial_trend, quality, uniformity, volume, trend_change, qty_tp, prediction_price_from, prediction_price_to, prediction_time_to, resistance_x0, resistance_x1, resistance_y0, resistance_y1, support_x0, support_x1, support_y0, support_y1, pattern_start_price, pattern_end_price；样例有 stop_loss, take_profit | 几何、质量、目标 → pattern.*、quality.*、scenario.target_region |
| Fibonacci详情 | averageQuality, priceA, priceB, priceC, priceD, priceX, timeA, timeB, timeC, timeD, timeX, ratioQuality, target03, target05, target06, target07, target10, target12, target16；Snapshot另列 clarity, patternEndPrice, patternStartPrice, qtyTP, timeQuality；内部项 priceAdjustment, instrumentId, bandwidth, temporaryPattern | Fibonacci几何、质量、内部参数 → pattern.ratios/anchors、quality.fibonacci；内部参数保留原文 |
| Key Level详情 | patternPrice, approachingRegion, approachingTime, atBarIdentified, atPriceIdentified, furthestPrice, predictionPriceFrom, predictionPriceTo, predictionTimeFrom, predictionTimeBars, x0, x1, x2, x3, x4, x5, x6, x7, x8, x9；样例另有 bandwidth, errorMargin, qtyTP, priceE, barsE, temporaryPattern | 水平位、触碰、接近与目标 → levels.*、scenario.target_region |
| Big Movement / 连续蜡烛 | from_price, to_price, movement, percentile, statistical_movement；qty_candles, statistical_qty_candles, use_relevance_logic；Market Alerts样例另有 use_exact_pattern_end_time, use_exact_pattern_start_time | 已发生异常与历史稀有度 → anomaly.*；历史方向与预测方向拆开 |
| drawing | symbol, arrow, length, timeZone, forecast, timeFrame, originalLines, eventLine, chartType, interval, lines, priceRange, direction, predictionRectangle；图元 point1Name, point2Name, name, x1, x2, y1, y2；timeFrame.from/to；priceRange.low/to（保持原样，不擅改成high） | 图元与显示约定 → chart.annotations；不另计为分析信号 |
| Performance Stats | brokerId, from, to, group, name, breakout, emerging, category, data, value, total, correct, percentage | 历史达标统计 → stats.sample/hit_rate |
| Our Favorites | defaultGroupId, symbolGroups, id, name；结果共用字段；probabilities.result_uid, percent, hod_percent, hod_correct, hod_total, symbol_percent, symbol_correct, symbol_total, pattern_percent, pattern_correct, pattern_total, forecast | 历史分组筛选与组合值 → stats.favorites；不同边际样本不合并 |
| Volatility | datetime, result_uid, groupid/group_id, broker_id, symbol, longname, display_name/display_symbol, exchange, symbolid/symbol_id, hourly_symbolid/hourly_symbol_id, day_of_week, from_time, closing_price, low_15, high_15, low_30, high_30, low_60, high_60, low_240, high_240, low_1440, high_1440, timezone_offset, timezone, rank, rank_rounded, returnSymbols；正文/样例命名有差异 | 波动区间、相对排序、时段与来源 → risk.expected_ranges/relative_volatility/seasonality、time.* |
| Risk输入/输出 | account_currency, trade_pair, contract_type, account_risk, entry_level, stop_loss → lot_size, risk_in_pips | 合约、风险输入与规模 → instrument.contract、risk.* |
| Economic Forecast事件 | country, country_name, name, description, event_type_code, event_uid, category, released_at, value, items；category.code/name/base_code/group/frequency；组与频率均有 code/name | 事件身份、类别与发布 → calendar.* |
| Economic Forecast机会 | uid, sample_size, time_frame, symbol, trend_length, opportunities；symbol.id/name/interval/exchange/pip_size/pip_value/value_currency/value_lot_size/value_date_time；opportunities.id/probability/trend_direction/delta_sign/mean_mov/mean_mov_pips/mean_mov_value | 条件方向、样本、幅度与单位 → impact.* |
| Economic Forecast条件名称与历史 | delta_gt_up, delta_lt_up, delta_eq_up, delta_gt_down, delta_lt_down, delta_eq_down（样例里作为opportunities.id值）；date, expected, actual, delta, delta_float, trend, trend_direction, delta_sign | 条件枚举与历史事件 → impact.condition/history；id值不误作顶层字段 |
| Event Volatility / EEVI | 事件元数据同上；symbol_volatility, symbol, no_event_volatility, no_event_volatility_value, event_volatility, event_volatility_value, volatility_diff, volatility_diff_percent, volatility_diff_value；分布 sample_size, min, min_pips, p25, p25_pips, median, median_pips, p75, p75_pips, max, max_pips, mean, mean_pips, std_dev | 事件/正常分布与差异 → impact.distributions/difference/money |
| Correlating Alerts | id, gmt_time_found, broker_id, base_group_name, broker_symbol_group_id, symbol, symbol_id, direction, breakout_price, forecast_price, forecast_pips, percent_probability, nlg_text, patterns, online_translate；nlg_text.TITLE/FULL/TEASER/CTA；patterns.type/name/result_uid/time_granularity/chart_url | 同向结果聚合与叙述 → evidence.independence、stats.correlating、report.story |
| News Sentiment | ticker_info, name, sector；sentiment_score, sentiment_indicator, total_sources, total_mentions, mentions_volume, top_mentioned, current_news, source_info；变化 datetime_from, sentiment_change_value, score_from, score_to；历史 quantity_indicator；ticker与日期常为动态对象键 | 新闻计数、情绪与变化 → news.*、sentiment.* |
| Market Snapshot报告 | report_id, report_uid, generated, session, messages, symbol_reports；类型目录 name, last_updated；messages.name/heading/session/report_description/indicator_description/date | 报告身份、交易时段与模块 → report.*、time.* |
| Market Snapshot单标的 | type, result_uid, symbol_report_id, direction, rsi_direction, ma_direction, symbol, symbol_display, interval, forecast_length, forecast_time, pattern_end_time, favourite, levels, messages；levels.type/label/level/date_time；文字样例 symbol_name, analysis, data_interval, resistance_level, support_level, target_level, target_period, chart_start_date, chart_end_date, supporting_indicator, pattern_length, identified, pattern_name；价位文字对象 level/label/description | 单标的技术快照 → event.*、levels.*、indicator.*、report.story |
| 鉴权与查询（不是报告业务指标） | broker_id, user, account_type, expire, token；正文亦出现 brokerid/accounttype/expiry 拼写。技术查询 group, locale, locales, timezone, include_detail, include_drawing, page_limit, page_offset, since；Favorites result_limit, probability_percentage；情绪 search, sector, sentiment, strong_sentiment, include_detail, date_input；共振 start_time, base_group_name, symbol, direction, online_translate | 鉴权、查询与筛选参数 → 安全配置/请求元数据；不进研究正文，不保存密钥到报告 |

字段依据：[Autochartist Technical Analysis API][A02]、[Autochartist Performance Stats API][A06]、[Autochartist Volatility API][A07]、[Autochartist Risk Calculator API][A09]、[Autochartist Economic Event Forecast API][A10]、[Autochartist Economic Event Volatility API][A11]、[Autochartist Market Alerts API][A13]、[Autochartist News Sentiment API][A16]、[Autochartist Our Favorites API][A17]、[Autochartist Correlating Alerts API][A18]、[Autochartist Market Snapshot API][A19]。

## 附录 C：原稿 JSON 与专有标签映射

| 原稿字段 | 归类/本研究业务键 |
| --- | --- |
| report_type / provider / instrument / market / as_of / horizon | report.kind / report.provider / instrument.id / instrument.market / time.as_of / scope.horizon |
| market_state.trend / volatility_regime / liquidity | market.trend / market.volatility_regime / market.liquidity |
| thesis.direction / summary / status | thesis同名字段 |
| primary_scenario.entry_condition / entry_reference / targets / invalidation_price | scenario.entry / scenario.targets / scenario.invalidation |
| alternative_scenario.trigger / direction / action | scenario.alternative；触发条件与动作保留为结构 |
| evidence[].type / finding / source / timeframe | evidence.supporting + scope.bar_size + source.refs |
| conflicting_evidence[].type / finding；evidence_conflicts | evidence.conflicts |
| risk.max_portfolio_risk_fraction / reward_risk_at_entry_reference / event_risk | risk.budget_fraction / scenario.reward_risk / risk.event |
| monitoring.recheck_on[] | monitoring.recheck |
| data_as_of / source_refs / model_version / confidence_calibration / outcome | time.as_of / source.refs / source.version / outcome.calibration / outcome.definition + realized |
| growthLabel / incomeLabel / momentumLabel / qualityLabel / valuationLabel / quantamentalLabel | score.labels；各保留id/name与供应商尺度版本，不能自行推阈值 |
| Instrument IDs / Countries / get_storyteller_economics | instrument.id / calendar.identity；工具名与API路径是接口元数据，不是报告指标 |

## 来源与审计范围

核对日期：2026-10-26。外部事实以官方产品、教程、公开 API 文档、发布记录及论文为依据；自有设计与合成示例已单独标明。Sesame审计基于插件仓库 `7f5c7a8`、宿主仓库 `1bd1d26` 的源码，没有读取账户配置、调用付费行情/交易或测试授权供应商接口。

详细核对记录：

- [Sesame源码与70处证据](Sesame-研究字段能力核对-20261026.md)
- [Autochartist逐模块/API核对](Autochartist-官方核对-20261026.md)
- [Trading Central非技术领域与历史实例核对](Trading-Central-非技术领域核对-20261026.md)

[T01]: https://investor.tradingcentral.com/technical-views "TC Technical Views 官方FAQ"
[T02]: https://investor.tradingcentral.com/technical-insight "TC Technical Insight 官方FAQ"
[T03]: https://global.tradingcentral.com/www/pdf/methodology_web_sites_en.pdf "TC 历史技术分析方法PDF"
[T04]: https://investor.tradingcentral.com/tutorials/getting-started-with-alpha-generation-8b775 "TC Alpha Generation 教程"
[T05]: https://www.tradingcentral.com/blog/new-in-technical-views-smarter-trading-strategies-with-storyteller "TC 2026 Technical Views Storyteller"
[T06]: https://investor.tradingcentral.com/tutorials/getting-started-with-fundamental-insight "TC Fundamental Insight 教程"
[T07]: https://employee.tradingcentral.com/resources/fundamental-insight "TC Fundamental Insight 发布记录与FAQ"
[T08]: https://www.tradingcentral.com/blog/tc-fair-value-available-by-trading-central "TC Fair Value 剩余收益模型"
[T09]: https://www.tradingcentral.com/blog/analyst-consensus-rating-target-price "TC 分析师共识"
[T10]: https://investor.tradingcentral.com/tutorials/getting-started-with-economic-insight "TC Economic Insight 教程"
[T11]: https://employee.tradingcentral.com/resources/economic-insight "TC Economic Insight / FIBI 发布记录"
[T12]: https://www.tradingcentral.com/tc-products/tc-corporate-calendar "TC 公司事件日历"
[T13]: https://investor.tradingcentral.com/tutorials/getting-started-with-market-buzz "TC Market Buzz 教程"
[T14]: https://employee.tradingcentral.com/resources/market-buzz "TC Market Buzz 当前FAQ"
[T15]: https://investor.tradingcentral.com/tutorials/premium-sentiment-analysis-3ff89 "TC 情绪分析教程"
[T16]: https://www.tradingcentral.com/blog/stay-ahead-of-market-moving-sentiment-trends-with-sentiment-monitor "TC 2026 Sentiment Monitor"
[T17]: https://www.tradingcentral.com/blog/when-emotion-moves-markets-keep-your-investors-ahead-with-tc-fear-index "TC Fear Index"
[T18]: https://investor.tradingcentral.com/tutorials/getting-started-with-options-insight "TC Options Insight 教程"
[T19]: https://www.tradingcentral.com/blog/how-to-manage-market-crisis-using-options "TC 波动率、偏斜与市场危机"
[T20]: https://employee.tradingcentral.com/resources/strategy-builder "TC Strategy Builder 方法FAQ"
[T21]: https://www.tradingcentral.com/tc-products/tc-strategy-builder "TC Strategy Builder 产品"
[T22]: https://www.tradingcentral.com/blog/trading-central-releases-summary-scores-in-panoramic-view "TC Panoramic View"
[T23]: https://investor.tradingcentral.com/tutorials/getting-started-with-tc-newsletters-47de0 "TC Newsletter 教程"
[T24]: https://www.tradingcentral.com/tc-products/tc-videos "TC Videos"
[T25]: https://www.tradingcentral.com/financial-products/methodology "TC Quant Indices 方法"
[T26]: https://www.tradingcentral.com/solutions/mcp "TC MCP 官方入口"
[T27]: https://aclanthology.org/2025.jeptalnrecital-industrielle.2/ "TC Labs 2025 情绪研究论文"
[T28]: https://www.tradingcentral.com/blog/techs-quantum-leap-unearthing-u-s-tech-stocks-set-for-explosive-growth "TC 2024 已使用0–100的官方实例"
[T29]: https://www.tradingcentral.com/tc-products/tc-featured-ideas "TC Featured Ideas"
[A01]: https://www.autochartist.com/developer-apis/ "Autochartist 开发者与API目录"
[A02]: https://www.autochartist.com/ac_api_docs/Technical_Analysis_API.html "Autochartist Technical Analysis API"
[A03]: https://www.autochartist.com/products/market-scanner/ "Autochartist Market Scanner"
[A04]: https://tradersupport.autochartist.com/en/knowledgebase/article/pattern-results-details "Autochartist 形态质量说明"
[A05]: https://tradersupport.autochartist.com/en/knowledgebase/article/horizontal-support-resistance-levels "Autochartist 水平关键位"
[A06]: https://www.autochartist.com/ac_api_docs/Performance_Stats_API.html "Autochartist Performance Stats API"
[A07]: https://www.autochartist.com/ac_api_docs/Volatility_Analysis_API.html "Autochartist Volatility API"
[A08]: https://tradersupport.autochartist.com/en/knowledgebase/article/volatility-analysis "Autochartist 波动率方法"
[A09]: https://www.autochartist.com/ac_api_docs/Risk_Calculator_API.html "Autochartist Risk Calculator API"
[A10]: https://www.autochartist.com/ac_api_docs/Economic_Event_Forecast_API.html "Autochartist Economic Event Forecast API"
[A11]: https://www.autochartist.com/ac_api_docs/Economic_Event_Volatility_API.html "Autochartist Economic Event Volatility API"
[A12]: https://www.autochartist.com/economic-event-volatility-intelligence/ "Autochartist EEVI"
[A13]: https://www.autochartist.com/ac_api_docs/Market_Alerts_API.html "Autochartist Market Alerts API"
[A14]: https://tradersupport.autochartist.com/en/knowledgebase/article/consecutive-bullbear-candles "Autochartist 连续蜡烛方法"
[A15]: https://www.autochartist.com/statistical-analysis/ "Autochartist 统计异常分析"
[A16]: https://www.autochartist.com/ac_api_docs/News_Sentiment_API.html "Autochartist News Sentiment API"
[A17]: https://www.autochartist.com/ac_api_docs/Our_Favorites_API.html "Autochartist Our Favorites API"
[A18]: https://www.autochartist.com/ac_api_docs/Correlating_Alerts_API.html "Autochartist Correlating Alerts API"
[A19]: https://www.autochartist.com/ac_api_docs/Market_Snapshot_API.html "Autochartist Market Snapshot API"
[A20]: https://www.autochartist.com/products/messaging-and-alerts/market-report/ "Autochartist Market Report"
[A21]: https://www.autochartist.com/contentcast/ "Autochartist ContentCast"
