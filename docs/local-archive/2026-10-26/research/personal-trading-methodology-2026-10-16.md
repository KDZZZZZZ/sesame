# 个人交易风格、规则与策略算法的沉淀方法研究

检索日期：2026-10-16。范围：从个人裁量交易、决策记录和复盘中积累可复用知识，逐步形成可检验规则和可执行策略。来源优先采用论文原文、作者公开稿、机构报告、原始采访及项目官方资料。未运行这些开源项目，也未检验任何用户账户或策略收益。

研究判断：值得组合的是“事前记录与案例库、决策知识提取、行为与绩效反馈、规则形式化、样本外验证”。本次检索没有找到获得充分独立验证的完整方案，能够仅凭个人聊天或成交记录，自动产生可靠的盈利策略。以下将来源发现与对 Sesame 的设计建议分开。

## 先把三种成果分开

| 成果 | 回答的问题 | 应包含的信息 | 不能自动推导的结论 |
| --- | --- | --- | --- |
| 个人交易风格 | 用户愿意怎样交易，实际怎样交易 | 市场、持有周期、可用时间、信息偏好；实际频率、持仓时长、风险暴露和执行习惯；观察窗口 | 偏好某种交易方式，不表示这种方式已经形成优势；历史习惯也可能是需要纠正的偏差 |
| 个人交易规则 | 哪些条件下采取什么动作，哪些条件下不做 | 背景、触发、排除条件、失效条件、仓位与退出、适用范围、来源和版本 | 遵守规则不表示规则本身有效；风险约束属于用户选择，无须伪装成收益预测 |
| 个人策略算法 | 能否依靠当时可用数据重现决策并接受测试 | 明确输入、可计算条件、动作与状态转换、成交假设、成本、数据和规则版本 | 拟合本人行为、成功生成代码或历史回测盈利，都不足以证明未来有效 |

这是综合研究后的区分。Schwager 的一手访谈明确区分个人适配、方法优势、风险管理和执行；偏好可识别性论文则指出，从行为恢复真实偏好需要额外假设。[CFA Institute 原始采访](https://blogs.cfainstitute.org/blog/2014/04/16/what-makes-a-great-trader-an-interview-with-jack-schwager/)、[Armstrong 与 Mindermann，2018](https://proceedings.neurips.cc/paper_files/paper/2018/file/d89a66c7c80a29b1bdbab0f2a1a94af8-Paper.pdf)。

## 直接可借鉴的方法

| 方法与来源 | 核实到的方法 | 对 Sesame 的转译（设计建议） | 证据边界 |
| --- | --- | --- | --- |
| **SMB PlayBook / Mike Bellafiore**，[出版社官方试读](https://ptgmedia.pearsoncmg.com/images/9780132937641/samplepages/0132937646.pdf)，2013 首印、版权页 2014 | 归档自己理解的交易形态，记录市场背景、基本面、技术、盘口、交易管理和复盘；模板可随个人交易方式调整 | 为每类 setup 建案例集，关联交易前证据、决策过程和反例；案例集服务学习，统计评估使用完整样本 | 职业交易台的训练经验。本次读的是官方试读，未声称读过全书；精选案例不能证明整体胜率 |
| **CME 交易计划**，[官方课程](https://www.cmegroup.com/education/courses/building-a-trade-plan/trading-strategies-in-your-trade-plan)，页面未注明发布日期 | 区分 setup（背景）和 trigger（触发）；事前写明进出场、风险和持仓管理，并给出会做与不会做的例子 | 把模糊判断整理为“背景＋触发＋排除＋失效＋动作”，保留尚需人工判断的条件 | 交易所教育方法；其中均线和风险比例示例没有构成有效性检验 |
| **ACTA 认知任务分析**，Militello 与 Hutton，1998，[期刊摘要](https://www.tandfonline.com/doi/abs/10.1080/001401398186108)；[NASA 应用报告，2021](https://ntrs.nasa.gov/citations/20210011503) | 通过任务梳理、知识访谈和情景访谈，把难以表达的判断线索与认知要求显式化 | 围绕具体交易追问“当时看到了什么、何时改变判断、什么变化会使你放弃”，减少泛泛要求用户总结心得 | 成熟的跨领域知识提取方法；将它用于交易是迁移设计，尚无此处已验证的收益结论 |
| **回放与针对性练习**，Brett Steenbarger，2017，[作者原文](https://traderfeed.blogspot.com/2017/03/the-real-way-to-develop-trading.html) | 把观察转成下一次目标；逐根回放，重走决策过程，练习未识别的机会 | 保存决策时点和可见信息，支持隐藏后续走势回放；追踪某项具体判断能力是否改善 | 作者实践与训练类比，没有收益提升的对照实验 |
| **个人规则随证据修订**，Adam Grimes，2013，[My Rules](https://www.adamhgrimes.com/my-rules/) | 规则适配个人和市场重点；重视预期未发生时的处理、空仓选择以及样本层面的概率 | 记录每次规则修订的反例、旧版、新版、适用条件与待验证问题 | 个人方法，不是通用交易规则。版本化和验证门槛是我们的设计建议 |
| **多次试验后的策略验证**，Bailey 等，[PBO，2017](https://escholarship.org/uc/item/4w1110bb)；Bailey 与 López de Prado，[DSR，2014](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf) | 处理从多套候选中选最好结果的偏差；DSR 还考虑样本长度和非正态收益 | 保存全部尝试及失败结果，做按时间隔离的评估、成本和参数敏感性分析；条件满足时计算多重检验相关指标 | PBO/DSR 不是未来收益保证；PBO 也不是实时亏损概率，不能替代数据和成交模型检查 |

## 论文与报告给出的关键边界

| 一手研究 | 样本、方法与主要发现 | 对本问题的意义与限制 |
| --- | --- | --- |
| Barber、Lee、Liu、Odean，2014，**The Cross-Section of Speculator Skill: Evidence from Day Trading**，[作者全文](https://faculty.haas.berkeley.edu/odean/papers/day%20traders/The%20Cross-Section%20of%20Speculator%20Skill.pdf) | 台湾 1992–2006 年交易资料，按上一年表现检验下一年；技能有持续性，但可预测且可靠取得扣费后正异常收益者不到总体 1% | 支持跨期检验个人优势；不能从少数盈利交易推断技能，也不能把历史比例推广到所有当前市场 |
| Seru、Shumway、Stoffman，2010，**Learning by Trading**，[作者研究页](https://www.stoffprof.com/SSS10) | 九年交易记录；部分人改善，部分人发现能力不足而退出，退出选择解释了相当部分总体改善 | 应记录停止某种交易和失败方向；活跃用户平均成绩提高不能直接算作产品训练效果。观察研究不证明某种训练有效 |
| Lo、Repin、Steenbarger，2005，**Fear and Greed in Financial Markets: A Clinical Study of Day-Traders**，[MIT 原文](https://web.mit.edu/Alo/www/Papers/AERPub.pdf) | 80 名志愿者，69 人贡献有效日报，最终问卷 33 份；强烈盈亏情绪反应与较差表现相关，未发现统一成功人格 | 风格画像宜以行为和情境为主；不能得出人格完全无关或情绪导致亏损，小样本及低统计功效是限制 |
| Cipriano、Jiao、Gruca，2020，**Can Investing Diaries be Hazardous to Your Financial Health?**，[期刊原文](https://www.ubplj.org/index.php/jpm/article/download/1805/1604/5822) | 四个电影票房真实资金预测市场。课程预测解释组更偏重支持自己预测的持仓，未发现总体当期收益下降 | 非随机分组；课程参与者与自选参与者有差异。它没有验证长期复盘，既不能证明日记提升收益，也不能证明日记降低收益 |
| Meyer、Urban、Ahlswede，2016，**Does Feedback on Personal Investment Success Help?**，[SAFE 工作论文](https://fif.safe-frankfurt.de/xmlui/bitstream/handle/123456789/2259/157_SSRN-id2880530.pdf?isAllowed=y&sequence=1) | 超过 1,500 名券商客户、18 个月反馈；匹配与双重差分分析发现反馈与减少交易、改善分散化和绩效有关 | 报告样式随机分配，订阅与否并非随机。支持试验成本和风险反馈产品，不能宣称 AI 复盘效果已获因果验证 |
| Armstrong、Mindermann，2018，**Occam’s Razor Is Insufficient to Infer the Preferences of Irrational Agents**，[NeurIPS 正式论文](https://proceedings.neurips.cc/paper_files/paper/2018/file/d89a66c7c80a29b1bdbab0f2a1a94af8-Paper.pdf) | 理论研究：未知决策机制时，相同行为可由不同偏好解释，简单性先验不足以唯一辨识 | 观察到“频繁加仓”不足以推出用户认可“亏损加仓规则”；需要意图、约束或额外建模假设。论文并非金融实证 |
| Baron、Hershey，1988，**Outcome Bias in Decision Evaluation**，[论文全文](https://bear.warrington.ufl.edu/brenner/mar7588/Papers/baron-hershey-jpsp1988.pdf) | 五项涉及医疗决策或金钱赌博的研究，已知好结果会提高人们对相同决策过程的评价 | 支持分别评价过程与结果；不能仅凭一笔赚钱就认可规则。将此转成交易复盘机制仍属应用推论 |
| Halperin、Liu、Zhang，2022，**Combining Reinforcement Learning and Inverse Reinforcement Learning for Asset Allocation Recommendations**，[预印本全文](https://arxiv.org/html/2201.01874v1) | 用 IRL 从基金经理历史操作推断奖励，再用 RL 优化；18 只基金、11 个行业的月度数据，2017–2018 年训练、2019 年测试 | 提供个人算法学习的研究路线，但对象是基金配置、测试期较短，不能推广为少量个人短线交易可自动学出可靠策略；不宜作为第一版主路线 |

其中日记研究特别值得反思：如果提示词只要求用户为原观点补充理由，记录过程可能伴随确认倾向。更合理的产品假设是增加事前预测、相反证据、放弃条件与后续核验，但这些改进应接受自己的验证，不能借论文之名宣称已经有效。

## 开源项目：可以借鉴哪些部分

维护信息按 2026-10-16 检索结果记录。项目功能和活跃程度只构成工程参考，不构成策略收益证据。

| 项目 | 可借鉴能力 | 边界 | 许可证与维护证据 |
| --- | --- | --- | --- |
| [TradeNote](https://github.com/Eleven-Trading/TradeNote) | 成交导入、日记、截图、标签与标签组、按交易规则评价交易和交易日；适合参考案例库和复盘交互。[官方功能](https://tradenote.co/) | 未找到自动学习个人风格或编译交易规则的功能；标签需要人提供 | GPL-3.0-or-later；[最后核到的提交](https://github.com/Eleven-Trading/TradeNote/commit/56eb096631f95c1cdf5d9ef416e7d0115c56465e)为 2025-04-14、19.0.3；[没有 GitHub releases](https://github.com/Eleven-Trading/TradeNote/releases)，近期维护证据较弱 |
| [Freqtrade](https://github.com/freqtrade/freqtrade) | Python 策略、回测、参数优化、模拟运行；尤其参考前视偏差及指标预热稳定性检查 | 面向加密资产；规则和参数空间需先定义；不提炼个人交易意图 | GPL v3；[2026.9 发布](https://github.com/freqtrade/freqtrade/releases/tag/2026.9)，2026-09-29 |
| [vn.py / VeighNa](https://github.com/vnpy/vnpy) | CTA 策略、事件驱动回测与执行、参数优化；可配置手续费和滑点，查看委托和成交。[官方回测文档](https://www.vnpy.com/docs/cn/community/app/cta_backtester.html) | 无原生个人风格提取；README 中另一产品的代码生成能力不能算成框架已有能力 | MIT；[4.5.0 发布](https://github.com/vnpy/vnpy/releases/tag/4.5.0)，2026-10-06 |
| [LEAN](https://github.com/QuantConnect/Lean) | 跨资产事件驱动引擎，以及成交、滑点、费用等现实建模。[官方文档](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/key-concepts) | 不承担个人日志和知识提炼；默认成交假设不能直接覆盖大额、低流动性交易 | Apache-2.0；[核到的提交](https://github.com/QuantConnect/Lean/commit/a54e9cc6cee9030e865d4f401c03c0e2373ba199)为 2026-10-15 |
| [vectorbt](https://github.com/polakowo/vectorbt) | 批量比较策略候选、参数与交易统计，适合研究阶段 | 不提取个人规则；不要混用 PRO 与社区功能；大量扫描需要记录试验数量 | [Apache 2.0 + Commons Clause](https://github.com/polakowo/vectorbt/blob/master/LICENSE.md)，属于附加限制的源码可见工具，不列作无附加限制的开源依赖；[v1.1.2](https://github.com/polakowo/vectorbt/releases/tag/v1.1.2)，2026-10-09 |

Freqtrade 的检查能力也有明确范围：`lookahead-analysis` 主要检查实际触发的信号，未触发分支可能漏检；`recursive-analysis` 比较不同预热长度下的指标，不能直接判定交易行为是否受影响。因此报告应写“本次检查覆盖了什么”，不将通过检查表述为策略已被证明正确。[前视检查说明](https://www.freqtrade.io/en/stable/lookahead-analysis/)、[递归指标检查说明](https://www.freqtrade.io/en/stable/recursive-analysis/)。

## 建议沉淀成的产品逻辑

以下是综合研究后的设计建议，尚不是已经做过收益实验的产品结论。

1. **保留可重建的决策证据。** 成交事实、用户事前表达、事后回忆和模型推断分别标注。事后补记不能伪装为事前计划；缺少原定风险额度时，不事后编造风险单位。机会记录应包括已交易、明确放弃和未决的情形，避免只留下成功案例。没有成交的机会不记作真实盈亏。

2. **输出有范围的行为画像。** 描述用户在特定时间、市场状态与策略版本下的实际行为分布，再与明确偏好比较。可观察持仓时长、进出时段、加减仓、计划执行率、费用和风险暴露。不用短期样本给人固定人格标签，也不从违规行为反推用户应遵守的新规则。

3. **分别评价执行、规则和个人适配。** 单笔可出现“按规则亏损”或“违反规则盈利”。执行评分取决于当时已经生效的规则；规则优势需要跨样本检验；个人适配还涉及时间、知识、情绪负担和用户意愿。

4. **候选规则有反例与生效版本。** 每条规则说明来源案例、反例、适用市场状态、什么证据会推翻它、仍需获取什么数据。风险上限等用户约束直接标注为约束；收益假设标为待检验。规则修改从生效时间向后应用，避免用新规则重写旧交易的合规性。

5. **逐步形式化策略。** 能直接表达的部分先写成规则或状态机；暂不能计算的部分保留明确的人类判断输入。行为模仿模型回答“本人可能怎么做”，结果预测模型回答“此条件下可能有什么结果”，两者分别评价。IRL 可作为后续研究支线，不能跳过意图确认和样本外评估。

6. **让验证独立于规则提炼。** 确定规则与候选范围后，用未参与规则选择的后续时间区间评估，纳入费用和执行约束，保留全部尝试。按市场状态分析时也记录切分次数，防止通过不断拆分样本找到偶然优势。依赖性强的交易不当作完全独立样本；没有一个通用的“达到若干笔就证明有效”门槛。最后进行前瞻模拟或影子跟踪，验证真实数据时点与可执行性。

7. **报告给出可复核的阶段性成果。** 每阶段报告新识别的模式、证据窗口与样本数、规则支持/反对案例、费用影响、验证差距和下一步最有价值的观察。被否定的方向及其条件也作为成果保存。未知值明确缺失；报告不为了显得有进展而补造结论。

| 阶段 | 可量化的产物 | 达不到条件时保留什么 |
| --- | --- | --- |
| 证据收集 | 可关联成交的决策比例、事前记录比例、数据缺失率 | 不完整案例及待补资料 |
| 风格画像 | 观察区间、样本数、行为分布、分组稳定性 | 描述性发现与不确定性 |
| 规则提炼 | 支持与反对案例数量、明确条件比例、历史例外 | 候选规则及未解决问题 |
| 规则执行 | 按版本计算的遵守率、偏离类型、决策可重现率 | 数据问题与执行偏差 |
| 策略检验 | 扣费结果、风险与回撤、时间外表现、参数敏感性、尝试数量 | 被否定的假设和样本不足结论 |
| 前瞻跟踪 | 模拟与实际输入差异、信号复现率、成交假设偏差 | 限定范围的试验报告 |

## 与 Sesame 长期记忆的关系

建议长期记忆保存稳定偏好、用户认可的风险约束、附适用范围的风格摘要，以及当前规则/策略和研究报告的版本引用。完整成交、决策证据、反例、各次回测与修订历史，继续由相应业务账本和成果存储承担。候选假设保留候选状态，不能因被反复提到就变为已验证事实。

在现有插件职责划分下，可以由交易插件保留交易事实和案例，判断复盘插件维护判断、核验与校准，策略研究能力负责实验；长期记忆负责跨任务召回结论与引用。这是对职责的建议，并未在本次研究中修改插件或接口。

优先值得验证的产品方向是“带反证的案例库＋条件化规则库＋独立验证报告”。不宜直接作为第一版目标的方向是“按人格自动分配交易流派”“仅凭少量成交反推真实目标”“由 LLM 自行把近期盈利总结成长期规则”。这些优先级来自本次证据综合，并非某一篇论文已经验证的整套系统。
