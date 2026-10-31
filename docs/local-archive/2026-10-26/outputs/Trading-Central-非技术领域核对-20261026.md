# Trading Central 非技术领域核对笔记

核对日期：2026-10-26。范围：基本面、估值、分析师共识、经济及公司事件、新闻与情绪、期权、筛选回测、综合简报。材料：用户提供的 `Pasted text.txt`。本笔记只研究公开产品能力，不代表授权 API 响应，也不包含实时投资建议。

## 阅读规则

- **已确认**：公开官方页面、教程、研究实例直接支持的能力或业务字段。
- **Sesame 建议**：为报告可读、可验证而增加的业务字段，不伪装成 TC 字段。
- **合成示例**：以下标为 DEMO 的数值全部是假设数据，例子中的计算与解释由本研究组织。
- **未公开**：本次公开资料未提供完整计算规则；不等于 TC 对签约客户也不提供。
- 官方网页存在新旧内容并存、个别旧链接 404、页面缓存不同等情况。产品说明能证明某项能力，不能单凭营销文案推断精确 schema、枚举、覆盖率或更新 SLA。

## 需要先改正或补充的结论

1. **评分不是统一量纲。** 无日期的官方基本面教程写 TCQR 和五因子为 1–10；2024-02-27 的官方研究已明确使用 0–100。因此不能简单叙述成“2025 才改成 0–100”，也不能自行乘 10 转换。应保存数值、尺度、标签、产品/接口版本与时间。[基本面教程](https://investor.tradingcentral.com/tutorials/getting-started-with-fundamental-insight)、[2024 年 0–100 实例](https://www.tradingcentral.com/blog/techs-quantum-leap-unearthing-u-s-tech-stocks-set-for-explosive-growth)
2. **新标签字段属实。** 2026-07-24 公开发布记录列出 `growthLabel`、`incomeLabel`、`momentumLabel`、`qualityLabel`、`valuationLabel`、`quantamentalLabel`；示例结构为 `{"id":"very-strong","name":"Very Strong"}`。记录没有给出所有分档阈值或完整响应 schema。该资源页同时有旧的 3/5 测试评分，不能与 TCQR 混用。[发布记录](https://employee.tradingcentral.com/resources/fundamental-insight)
3. **有三种价格结论。** TC Fair Value、TC 自有 12 月目标价、Analyst Consensus Target Price 应是不同字段。公允价值官方写每月 15 日；自有目标价只确认固定月更、重大公告后不临时改；分析师共识目标价官方写每日更新。[Fair Value](https://www.tradingcentral.com/blog/tc-fair-value-available-by-trading-central)、[目标价 FAQ](https://employee.tradingcentral.com/resources/fundamental-insight)、[共识](https://www.tradingcentral.com/blog/analyst-consensus-rating-target-price)
4. **情绪内容范围有版本差异。** 旧教程泛称新闻、博客和社交。当前 Market Buzz 资源页 FAQ 明确说 Stocktwits 等社交内容作为单独补充视图，不纳入该情绪评分。不能把“内容库有社交”直接等同于“每个情绪模型都用社交”；Fear Index 的产品说明又单独声明使用新闻与社交，需按产品分别记载。[Buzz FAQ](https://employee.tradingcentral.com/resources/market-buzz)、[Fear Index](https://www.tradingcentral.com/blog/when-emotion-moves-markets-keep-your-investors-ahead-with-tc-fear-index)
5. **Sentiment Score 与趋势直方图须分开。** 旧教程情绪强弱为 1–100；2026-03-11 的 Sentiment Monitor 说明趋势派生直方图为 0–100，50 是趋势信号阈值。曲线与价格线的高低或交叉没有交易含义。上述数值都不是上涨概率。[教程](https://investor.tradingcentral.com/tutorials/premium-sentiment-analysis-3ff89)、[2026 Monitor](https://www.tradingcentral.com/blog/stay-ahead-of-market-moving-sentiment-trends-with-sentiment-monitor)
6. **筛选 AND/OR 不应一并声称。** 公开 FAQ 明确所有筛选条件必须满足，支持 AND 语义；未核实任意 OR 组合。该页还公开季度换仓等重要回测规则，原稿只写“依版本而定”遗漏了可用证据。[Strategy Builder FAQ](https://employee.tradingcentral.com/resources/strategy-builder)
7. **“16 种报告”是研究者的分类，不是官方产品清单。** 原稿混有产品、组件、分析指标、投递格式和生成叙述。建议再加入 Fear Index、波动偏斜/期限结构、专题/行业筛选、视频/新闻短评等模块，并将 Financial Products 独立列为相关研究输出。[TC Videos](https://www.tradingcentral.com/tc-products/tc-videos)、[官方 Newsletter 教程](https://investor.tradingcentral.com/tutorials/getting-started-with-tc-newsletters-47de0)

## 1. Fundamental Insight / TC Quantamental Rating

**目的与字段。** 评价股票相对财务吸引力。已确认业务内容：公司/证券身份、TCQR、Growth/Value/Income/Quality/Momentum 因子、同业比较、价格表现、Nowcasting、Fair Value 与 Target Price 等组件。五因子分别关注成长、估值、股息、财务质量及价格动量；官方金融产品方法页给出 P/E、P/B、自由现金流收益率、ROE、派息可持续性等代表性指标。[现行产品](https://www.tradingcentral.com/tc-products/tc-fundamental-insight)、[因子方法](https://www.tradingcentral.com/financial-products/methodology)

**公开方法边界。** 教程称综合分是五因子的加权平均，但未公开生产权重、标准化、财务缺失值或异常值完整规则。现行产品说“20 个财务指标”，资源页说“每个投资风格 5 个数据点”；不能据此强行推导唯一 20/25 指标清单。产品的相对排名也不等于预期收益率。

**合成字段示例。** DEMO 公司；`评分=68/100`；`Value=82，Growth=54，Quality=71，Income=43，Momentum=63`；`同业范围=指定行业且样本数40`；`结论=估值较有吸引力、分红较弱`。68 不声称由示例五数按 TC 权重算出；如果是 Sesame 自有分，必须同时附权重和变换方法。

**建议新增。** 每个评分带 `scale_min/max`、`label`、`comparison_universe`、财务期间/披露时间、同业样本数、缺失原因。Nowcasting 应单独保存经济阶段、适合的风格/规模/行业、公司适配结论，不强行融合为另一条买卖指令。相位识别公式及转折判断未公开。

## 2. Fair Value / 自有 Target Price

**已确认。** Fair Value 使用两阶段剩余收益模型，考察净利润相对股东权益要求回报的剩余部分；每月 15 日更新。内部资本成本、预测期、持续期、终值、增长假设未公开，不能把普通 DCF 或任意剩余收益实现称为 TC 算法。[2024-06-17 发布](https://www.tradingcentral.com/blog/tc-fair-value-available-by-trading-central)

TC 自有目标价为未来 12 个月的模型预测，输入含估值比率、盈利、成长和波动率；固定月度重算，期间不因大新闻临时修订。完整估计公式未公开。[目标价 FAQ](https://employee.tradingcentral.com/resources/fundamental-insight)

**合成字段示例。** DEMO 现价 $100，公允价值 $120，模型目标价 $112，目标期限 12 月。`相对现价上行空间=(120/100−1)=20%`；`相对公允价值折价=(120−100)/120=16.67%`；`目标价上行空间=12%`。三个百分比口径不能混写。

**Sesame 建议。** `estimate_type`、货币、价格与模型各自 as-of、模型版本、预测期限、更新规则、假设、敏感性区间、被新公告影响但尚未重算的状态。模型值不是可成交价格，是否“合理估值附近”的阈值需要真实定义。

## 3. Analyst Consensus Rating / Target Price

**已确认。** 共识评级对分析师评级求平均再归类 Buy/Hold/Sell；共识目标价提供平均、最低、最高预测，整合多个分析师并经 TC 自有 AI 增强，日更。公开文没有给出全部分析师覆盖数、去重、权重、异常值剔除、AI 增强步骤或固定预测期限。[2024-07-11 官方说明](https://www.tradingcentral.com/blog/analyst-consensus-rating-target-price)

**合成字段示例。** DEMO：总体 Buy；平均目标 $115，低 $85，高 $145；现价 $100；平均上行 15%；预测分散区间 $60。`Buy12/Hold6/Sell2` 可以作为 Sesame 演示数据，但不能说此明细统计必然由 TC 产品返回。也不能默认分析师共识目标与 TC 自有目标同为 12 月。

**Sesame 建议。** 分开存 `provider_model_target` 与 `analyst_consensus_target`；若数据可得，增加分析师数、最新/最旧预测日期、目标期限、评级变动、分散度和评级体系映射。其结论表达“意见集中度与分歧”，而非将多数票当作价格概率。

## 4. Economic Insight / 宏观事件影响

**已确认字段与方法。** 宏观事件按 actual 相对 forecast 分为低于、等于、高于；观察某 FX 对在事件后的 True Range pips、净价格变动、历史涨跌比例和一年平均 TR。TR 为 `max(H−L, abs(H−前收), abs(L−前收))`，再换成 pip，不能简单都称高低振幅。Volatility 页 5 档窗口覆盖 5 分钟至 4 小时；Impact 页 4 档从 15 分钟至 4 小时，使用 5 分钟图。风险回报、止盈止损为可调交易规划组件。[官方教程](https://investor.tradingcentral.com/tutorials/getting-started-with-economic-insight)

**合成字段示例。** 事件=DEMO 就业数据；actual=90k，forecast=70k，previous=60k；分组=above forecast；FX=EUR/USD；窗口=1小时；前收=1.1000，高=1.1020，低=1.0960，终价=1.0970，pip=0.0001；TR=60 pips；净变动=−30 pips。历史组样本=12，平均TR=42 pips，8次下跌：这些都是演示统计，不称下次下跌概率为66.7%。

**未公开/建议补足。** “符合预期”的容差、异常数据修订策略、同时公布事件如何归因、历史缺失样本和平均法细节未充分披露。Sesame 应记录事件发布时间/时区、指标单位、修订值、样本筛选规则、样本数、窗口、pip大小、分布/分位数、并发事件。现行产品自称38国实时数据，但覆盖与授权仍需按接口确认。[现行产品](https://www.tradingcentral.com/tc-products/tc-economic-calendar)

## 5. Economic Calendar / Corporate Calendar

**分类修正。** Economic Calendar 是宏观时间表；Corporate Calendar 是公司事件目录；Economic Insight 在时间表上加历史影响。三者不宜一张固定 schema。2026 公司产品明确包含 earnings、dividends、股东大会、拆股及其他事件，支持筛选；现行页称 36 国、10,000+ 股票。[产品](https://www.tradingcentral.com/tc-products/tc-corporate-calendar)、[2026-08-04 更新](https://www.tradingcentral.com/blog/meet-tc-corporate-calendar-market-intelligence-for-confident-investing-decisions)

**合成字段示例。** DEMO earnings：股票、事件种类、日期、预计盘后、财季、EPS共识1.20、实际null、状态scheduled；DEMO dividend：每股0.50、货币USD、除息日、登记日、支付日；DEMO split：2:1、生效日。这里盘前/盘后、EPS、细分股息日期、split ratio 是 Sesame 建议业务结构；仅凭上述营销文不能保证每项都在 TC 接口返回。

**判断方法。** 日历首先是事件事实，不是方向预测；事件影响评级、预期差、收益率和风险提示要区分原始数据与推导。Sesame 应特别区分 announced/estimated/confirmed 时间、取消与改期、数据源时间，不把缺失实际值当成0。

## 6. Market Buzz / 新闻热点

**已确认业务字段。** 总提及量、来源构成、提及历史、趋势分析、讨论主题、新闻流；可按国家/行业/时间及来源/主题过滤，24小时新闻激增会成为 buzzing。气泡大小代表讨论量。[官方教程](https://investor.tradingcentral.com/tutorials/getting-started-with-market-buzz)

**合成字段示例。** DEMO：24h提及320，明确选定的基准日均80，研究自算 `volume_ratio=4.0`；主题=订单/监管；来源=标题、发布者、发布时间、URL；情绪=positive。这个4倍是演示量比，不能称为 TC Buzz Score 公式或尺度。

**未公开/建议。** 本次资料没有充分公开 Buzz Score 精确标准化、去重、实体归属、来源权重和异常阈值。当前资源页把纯社交与情绪计分分开；FX Trend 在2025更新中改用 pips，价格变化单位不能统一写百分比。Sesame 应存原始新闻时间、去重簇、来源类型、原文链接、事件标签、分数出处及算法版本。[官方资源/更新](https://employee.tradingcentral.com/resources/market-buzz)

## 7. Crowd Insight / Sentiment Monitor / Fear Index

**旧教程可确认字段。** Sentiment Score 1–100；Subjectivity 0–100（TC 将其描述为理性到非理性）；Confidence Index 为 Low/Average/High，依据支持情绪的新闻证据量；同业对比和最多365日情绪/价格视图。Confidence 不等于价格预测置信区间，Subjectivity 也不能当新闻真假评分。[教程](https://investor.tradingcentral.com/tutorials/premium-sentiment-analysis-3ff89)

**2026方法补充。** 新 Monitor 将近期与较早文章的情绪收敛/分歧形成趋势线与0–100直方图，50为趋势方向阈值；公式未公开。官方报告505资产的相关系数中位数0.59，但未提供足够完整验证设计以当成实盘绩效证明；情绪线和价格线的相对高低/交叉无意义。[2026-03-11 说明](https://www.tradingcentral.com/blog/stay-ahead-of-market-moving-sentiment-trends-with-sentiment-monitor)

**合成字段示例。** DEMO：情绪强弱72/100；subjectivity81/100；evidence confidence=Average；trend histogram=46/100；signal=Bearish。强弱较正面而趋势转弱可以共存，必须按各自定义解释，不能强行归成同一个“看涨72%”。

**遗漏项：Fear Index。** 这是识别新闻/社交恐慌的维度，公开产品包括市场比较、个股与美国市场的90交易日历史；不是 VIX，也不等于一般正负情绪。本文没有核实其完整尺度/阈值/计算。DEMO可用 `fear_level=供应商原值`、`relative_market_fear`、`history_window=90 trading days`，不自行捏造阈值。[2025-10-21 发布](https://www.tradingcentral.com/blog/when-emotion-moves-markets-keep-your-investors-ahead-with-tc-fear-index)

## 8. Options Insight / 波动率与策略实验室

**应拆成两份业务报告。** 波动仪表盘：IV、HV、IV Rank、历史、IV/HV关系、上/下行偏斜、期限偏斜、未来月度到期的预期价格范围、财报/股息、同业比较。策略实验室：方向、幅度、主要目标/风险偏好，首选和替代策略、期权腿、权利金、最大收益/损失、盈亏平衡、损益图。教程明确预期移动基于期权权利金；2025-06-28起覆盖550+热门ETF期权，不只个股。[教程](https://investor.tradingcentral.com/tutorials/getting-started-with-options-insight)、[ETF更新](https://employee.tradingcentral.com/resources/options-insight)

**公开方法。** 官方说明IV来自期权价格，IVR用一年历史范围；上/下行偏斜比较相对现价对称的put/call IV（示例90%/110%），正值表示put更贵；期限偏斜对照近远期。预期波动来自IV，但未公开可据以复现的分布、置信水平、日数基准、插值、POP和策略排名公式。[2025-04-28 说明](https://www.tradingcentral.com/blog/how-to-manage-market-crisis-using-options)

**合成策略例。** DEMO 100/110 bull call spread，同到期、净付3/股、乘数100：到期损益=`[max(S−100,0)−max(S−110,0)−3]×100`；最大亏损300、最大收益700、盈亏平衡103。忽略费税和提前行权，不能用这张到期图声称到期前风险已穷尽。示例IVR75既不是75%胜率，也不足以单独建议卖期权。

**缺口。** 原稿遗漏 Probability of Profit、上下偏斜、期限偏斜、HV、IV/HV比，以及ETF覆盖。预期波动不是目标价或盈利概率。Sesame应再存每腿 bid/ask/quote time、合约乘数、行权/结算方式、流动性、成本、事件日期；完整Greeks和流动性并未由本次TC资料逐项确认，应标“自有扩展/待授权schema验证”。

## 9. Strategy Builder / 筛选与回测

**已确认输出。** 65+基本面/技术/量化筛选因子；专家策略、主题、预设及社区screen；匹配结果、排名、模拟历史表现和基准比较。主题/专家策略不是独立算法的保证，保存其实际条件才能复现。[产品](https://www.tradingcentral.com/tc-products/tc-strategy-builder)、[教程](https://investor.tradingcentral.com/tutorials/getting-started-with-strategy-builder)

**公开FAQ方法（压缩摘要）。** 条件须全部满足；排名对有方向性的筛选因子取相对位置平均，交易所等不参与，平分按公司名。回测使用当时数据，窗口5年截至最近周五，前10匹配股或较少数量等权，13周换仓，当日收盘买卖，持有期无止损，周频统计；剔除13周段年化回报超过200%的股票。窗口移动会改变换仓日及结果。页面含2011示例，仍应核对现行服务版本。[官方FAQ](https://employee.tradingcentral.com/resources/strategy-builder)

**合成字段示例。** DEMO：USA零售；市值≥300M、P/S≤1、P/E≤28、TCQR≥50、Value>50；18匹配/10入选；回测5年、季度再平衡；合成净值终值1.80，CAGR=`1.80^(1/5)−1=12.47%`；基准终值1.60、CAGR9.86%；年化差2.61个百分点，不能称风险调整alpha。

**必须写清的未核实项。** 费用、滑点、股息再投资、退市处理、幸存者偏差、历史财务修订处理、异常收益剔除执行时点、无匹配时现金收益。不要替供应商默认这些为零或已处理；Sesame最好报告未剔除和剔除后结果，并保留规则与实际成分轨迹。以上例子没有借用 TC 的真实收益数字。

## 10. Panoramic View / 组合式概览

**已确认。** 2020发布的概览把Value红黄绿、不同期限技术方向、新闻情绪及24小时关注量并列，可放在证券列表、持仓或自选页；这是组件整合，不是公开给出的“万能总分”公式。[官方发布](https://www.tradingcentral.com/blog/trading-central-releases-summary-scores-in-panoramic-view)

**合成字段示例。** DEMO：Value=green，短期技术=bearish，长期=bullish，news sentiment=neutral，attention=high。输出“长期价值与短期趋势存在分歧”即可；若Sesame得出综合动作，须另外公开融合规则和时间优先级。2020描述不保证当前所有渠道覆盖一致。

## 11. Newsletters / Newsbrief / TC Videos

**应视为组合与投递形式。** Newsletter可组合Panoramic View、Trending Charts、Technical Events、Analyst Views、Price Tables、Regional Snapshot、Earnings Expected、Economic Calendar、Newsbrief与WebTV。不是每封日报都有全部字段。TC Videos为分析师事件驱动视频、可经RSS集成。[Newsletter教程](https://investor.tradingcentral.com/tutorials/getting-started-with-tc-newsletters-47de0)、[TC Videos](https://www.tradingcentral.com/tc-products/tc-videos)

**合成字段示例。** DEMO日报：发布日期、时区/截点、区域、指数/行业表现表、主要驱动、当日事件表、3个研究机会、每条观点发布时间和来源。视频另有标题、讲者、录制/发布日期、语言、媒体URL、关联资产/事件和文字稿；后几项是Sesame媒体结构建议，非保证的TC RSS字段。

**现行交付补充。** 官方Newsletter说明可选资产、地区、语言和频率，研究带时间戳；交付/订阅/打开率属于分发运营数据，宜与投资报告正文分开。[现行产品](https://www.tradingcentral.com/tc-products/newsletters)

## 12. 相关但不宜并入同一种报告：TC Quant Indices

**可补充为指数/组合方法报告。** 官方方法：可投资股票池、五因子、TCQR、前50股等权、行业分散控制、每月再平衡。这是 Financial Products 的指数构建，与 Strategy Builder 的13周回测不是同一规则。[金融产品方法](https://www.tradingcentral.com/financial-products/methodology)

**Sesame建议字段。** 指数/组合标识、基准、选股空间、成分、权重、行业约束、再平衡日、换手、历史/实时表现标识、成本及回测区间。合成例：DEMO50股、各2%、月调仓；行业上限如未得到真实参数则留空，不擅填。

## 历史实例核对与可引用边界

| 实例 | 核对结果 | 应如何引用 |
| --- | --- | --- |
| Kohl’s，2025-11-25 | 浏览工具第一次从官方旧URL缓存读到：TCQR64，Value84，Momentum67，Quality61，Income57；12月目标21.60、上行37%；P/B0.46、Fair Value35.04；筛选门槛与材料一致。后续刷新旧URL及尝试新/blog路由均404。 | 可说“本次读取到的官方历史缓存文本与材料相符”；最终产物应注明原链接不稳定，不把缓存当当前行情，不凭缺失的Growth分数反推权重。[旧官方URL](https://www.tradingcentral.com/market-updates/promising-retail-stocks-poised-for-growth-ahead-of-black-friday-and-the-holidays) |
| 2026-03-02宏观周报，非农70k、EURUSD 67.2/−37.7 pips | 原URL当前404；搜索未找到能重新读取的官方正文。 | 本次未独立确认这些数值；不判为虚假，也不能延续写“已核实真实案例”。应保留待核验状态，或用已核实教程合成案例替代。[失败旧URL](https://www.tradingcentral.com/market-updates/tc-economic-insight---the-week-ahead-mar-2-6) |
| Daily Market Newsletter，2022-12-09 | 原文可读，日期确认。BTC/USD pivot16560；跌破看16190/15980；RSI>50、MACD正且在信号线上方；MA20与MA50原文均16826。 | 可用作历史正文结构例；正文没有明确多头止盈目标，不能补造。注意图像未纳入这一正文验证。[原文](https://newsletters.tradingcentral.com/acmarkets/index_mb_en.html) |
| WDC期权案例，2024-05-07 | 官方确认6月21日到期72.5/77.5 bull call spread，POP44%，与long call37%比较；同时写max risk184、max profit318。 | 可证明POP和首选/替代结构确有实际输出；但两金额相加502，与标准100乘数的$5价差宽度500不合，公开文无解释。应标源内数值疑点，不替其静默改数。[原文](https://www.tradingcentral.com/blog/western-digital-technical-breakout-provides-bullish-options) |

## 公开方法论文：可学习，但不是当前生产算法披露

TC Labs参与的2025论文在Dow30上测试新闻情绪策略：文章中识别公司实体并聚合相关句子，逐日汇总上次开盘到本次开盘的文章；比较分类模型与连续回归，归一到0–100；研究阈值为40/60，开盘成交、每笔固定金额、费率0.05%。范围为2020-01至2022-04。此为实验设置，不能替换2026 Monitor的50阈值或声称生产Felix完全照此执行。[正式论文PDF](https://aclanthology.org/anthology-files/pdf/jeptalnrecital/2025.jeptalnrecital-industrielle.2.pdf)、[官方论文介绍](https://www.tradingcentral.com/blog/tc-labs-presents-cutting-edge-research-on-sentiment-driven-trading-at-coria-taln-2025)

本研究的审阅提示：论文的门限选择需要独立样本外验证，资金闲置与基准满仓影响风险比较；表中28个月累计50.63%与“Annual Compound Return65.26%”口径不一致，不能直接采纳为年化绩效。这里只将论文用作方法参考，不把宣传性“已证明有效”当充分的策略验证。

## 给 Sesame 的最小业务结构建议

这些是自有设计，不是 TC API schema：

| 层 | 必要内容 | 为什么 |
| --- | --- | --- |
| 身份与适用范围 | report_kind、instrument、asset_class、currency、horizon、region | 基本面12月、技术日内和期权到期不能混成相同时限 |
| 数据与来源 | observation/value/unit、data_as_of、published_at、retrieved_at、URL、原始字段名、provider/product/version | 支持检查时效、溯源和新旧版本 |
| 分数语义 | raw_score、scale、label、comparison_universe、sample_size | 避免0–100误当概率或不同模型硬合并 |
| 方法 | method_name、formula_or_description、parameters、assumptions、disclosure_level | 明确可复现到什么程度 |
| 判断 | conclusion、supporting_evidence、conflicting_evidence、conditional_actions | 把事实、模型推断和行动建议分开 |
| 不确定性 | missing_data、known_limitations、source_conflicts、event_risk、staleness | 缺数据与悲观信号不同 |
| 结果跟踪 | forecast_target、measurement_window、realized_outcome、benchmark、costs | 对照原期限评价，不事后改口径 |

本次未调用授权数据API。`https://global.tradingcentral.com/api/doc.html` 可打开但浏览工具无正文，未据其推导任何完整schema。实际字段、枚举、权限、延迟、可用资产、货币与版本应以签约接口文档和实际响应为准。

## 来源登记

以上链接均于 **2026-10-26** 实际读取或尝试读取；成功来源的正文事实已经在对应段落引用。带明确发布日期的来源按原页记载；无发布日期教程不强行判断发布时间。

- 核心一手域：`www.tradingcentral.com`、`investor.tradingcentral.com`、公开可访问的 `employee.tradingcentral.com/resources/`、`newsletters.tradingcentral.com`。
- 论文一手出版入口：[ACL Anthology论文页](https://aclanthology.org/2025.jeptalnrecital-industrielle.2/)、[PDF](https://aclanthology.org/anthology-files/pdf/jeptalnrecital/2025.jeptalnrecital-industrielle.2.pdf)。官方链接的 `https://talnarchives.atala.org/TALN/TALN-2025/6.pdf` 本次503，因此改读正式出版镜像。
- 旧Panoramic教育页 `https://www.tradingcentral.com/education/introduction-to-panoramic-view` 后续返回404，已用2020官方发布页替代。
- 没有读取登录后账户、内部系统文件、凭据或客户资料；仅读取已公开页面的研究产品说明、公开FAQ与发布日志。

## 附：Sesame 数据渠道的最小补充核验

核验日期：2026-10-26；以下8条官方来源仅确认文档能力，未调用数据接口、未调查费用，也不表示账户已具备访问或再分发许可。

| 数据渠道与文档入口 | 字段增益与限制（每项一句） |
| --- | --- |
| [FMP Stock Grades Summary](https://site.financialmodelingprep.com/developer/docs/stable/grades-summary)；`/stable/grades-consensus?symbol=...` | 可补分析师Strong Buy/Buy/Hold/Sell/Strong Sell数量与总体共识，但这类分析师意见汇总须与FMP自身财务比率评分区分，历史时点、覆盖及权限需另验。 |
| [FMP Price Target Consensus](https://site.financialmodelingprep.com/developer/docs/stable/price-target-consensus)；`/stable/price-target-consensus?symbol=...` | 可补目标价最高、最低、中位数和平均共识，以展示预测分散度，但不能把当前快照当历史时点数据，或将报价聚合窗口当预测期限。 |
| [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)；`/api/xbrl/companyfacts/CIK##########.json` | 无需API key即可取得单家公司标准XBRL概念及不同计量单位的申报事实，为财务指标提供来源，但此聚合仅覆盖标准taxonomy且适用于整体申报实体的事实，不包含全部自定义/分部细节或分析师预期。 |
| [FRED series/observations](https://fred.stlouisfed.org/docs/api/fred/series_observations.html) | `vintage_dates`或`realtime_start/realtime_end`可恢复指定历史日期当时已知的宏观观测，便于避免修订值前视，但默认实时时段为今天且可用历史版本取决于具体序列。 |
| [BLS Employment Situation发布日历](https://www.bls.gov/schedule/news_release/empsit.htm) | 可补参考月份、发布日期、时间与可订阅日历，但该表是统计发布安排而非经济学家共识预测，不能由它生成forecast数值。 |
| [FMP经济日历文档](https://site.financialmodelingprep.com/developer/docs)；`/stable/economic-calendar` | 文档示例含`date/country/event/currency/previous/estimate/actual/impact/unit`，可补事件预期差结构，但`estimate`应标供应商预期，文档未在此解释调查样本、权重和截点，不能等同官方统计机构预测。 |
| [Cboe DataShop Option Quotes](https://datashop.cboe.com/option-quote-intervals) | 许可数据可按到期日、行权价、call/put和报价时间重建期权链，含NBBO/数量/OHLC/成交量、可选IV与Greeks，但日内文件延迟15分钟，覆盖美国股票/ETF/指数期权且不含期货期权和非美市场。 |
| [Cboe DataShop Option EOD Summary](https://datashop.cboe.com/option-eod-summary) | 提供2012年起的历史期权快照、OI及可选15:45 ET的IV/Greeks，能支撑历史波动报告，但IV为附加计算数据且必须固定期限/价内外口径后再计算IV Rank，不能把任意合约IV直接串成可比较序列。 |

实际落地时优先保存供应商原始字段、检索时间与独立的业务含义；这里的渠道是补齐Sesame事实和历史数据的候选，不表示可以复制Trading Central的专有评分或算法。
