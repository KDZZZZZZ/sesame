# 因子评估扩展调研与实施方案

日期：2026-10-24。研究范围是确定性数值评估，不取真实行情、不替用户做投资研究、不连接账户。七项清单用于检查本次调研覆盖，不是每次任务的必跑门槛。

| 评估项 | 定义／回答问题 | 适用数据与目标 | 本次实现方法 | 依赖与成本 | 可跳过条件 | 假设与解释边界 | 输出 | 覆盖状态 | 一手来源 | 验证方式 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 安慰剂测试 | 打乱信号与结果的对应，原关系是否超过无对齐关系的对照？ | 有因子值及同一截止日期内远期收益的面板／时序 | 截面在每个时间内置换标签；时序在每个品种内随机循环移位标签，保留标签自身的时间结构；固定种子；双侧绝对统计量及加一校正 | 无外部依赖，重复统计计算；有重复次数和工作量上限 | 未请求、无可测相关性、时序长度不足 | 循环移位以近似平稳且允许移位为前提；非平稳时不应解释为严格显著性；不是多重研究尝试校正 | 原统计量、对照均值／分位数、极端比例 p、次数、种子和方法 | 已实现；合成数据验证通过 | [SciPy permutation_test](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.permutation_test.html)、[Phipson & Smyth 原论文](https://arxiv.org/abs/1603.05766) | 已知信号比随机对照强；无信号基准；相同种子同结果；不读留出 |
| 蒙特卡洛模拟 | 有限样本下，观察到的方向收益路径可能出现多大的收益／回撤变化？ | 已计算的非重叠成本后诊断收益序列 | 循环区块有放回重采样，模拟相同长度路径；统计复利收益、最大回撤、亏损频率 | 本地计算，有界路径数；不要求券商或 Python | 未请求、可用收益区间不足、区块长度不适用 | 经验分布的路径情景；不是生成真实逐笔成交，也不预测未来价格分布；与 bootstrap 共享样本不能当独立确认 | 收益和回撤分位数、亏损路径比例、路径数、区块长度、种子 | 已实现；路径分布与复现验证通过 | [arch CircularBlockBootstrap](https://arch.readthedocs.io/en/latest/bootstrap/generated/arch.bootstrap.CircularBlockBootstrap.html)、[Forecasting: Principles and Practice](https://otexts.com/fpp3/toolbox.html) | 固定收益手算；亏损路径／破产标记；种子复现 |
| 样本外测试 | 开发期没有用于阈值估计的后续样本表现怎样？冻结选择后的留出表现怎样？ | 有按时间划定 train／validation；可选额外 holdout | validation 使用只在 train 拟合的阈值；明确 validation 可参与研究，只有 select 后 finalize 才计算封存 holdout | 基础计算已存在，增加状态与样本边界回执 | 未请求；development-only 没有封存留出则只报告开发期验证；无足够配对样本 | 因子可能由研究者参考 validation 后提出，不能称未受污染的最终样本外结果；留出隔离由调用工作流负责 | 分段指标、边界、validation 用途、holdout 的 deferred／not-requested／evaluated | 已实现；冻结／开发期协议验证通过 | [scikit-learn cross-validation](https://scikit-learn.org/stable/modules/cross_validation.html) | 篡改 holdout 不改变开发指标；freeze 前不返回留出 |
| Walk-forward 测试 | 固定因子在多个向前移动的时间窗口中是否稳定？ | 时间有序的开发期数据，足够训练与验证窗口 | 扩展训练窗、连续向前测试窗；每窗仅训练历史拟合时序阈值；标签越界 purge，支持 gap；不在每折偷看后续数据选公式 | 本地若干次重算，折数有界 | 未请求、某折数据不足；逐折状态不阻塞其他折 | 固定候选稳定性复核，不声称完成每折重新挖掘／重新选择候选的嵌套研究；有时间缺口时按时间点个数定义窗口 | 每折 train/test 边界、purge/gap、样本数、指标、完成折数 | 已实现；前向隔离验证通过 | [scikit-learn TimeSeriesSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html) | 在未来数据注入极值不影响先前折；训练标签端点早于测试起点 |
| 参数敏感性测试 | 参数附近的小改变是否让结果骤变？ | AST 有 rolling window 或有限数值常量 | 一次改变一个参数，窗口 ±1 或常量 ±10%；重算固定开发切分，返回邻域曲线与最差／最好变化，不自动改用最佳邻域 | 有界邻域数量，无搜索依赖 | 未请求、候选无可调参数、邻域越界或无法计算 | 局部单参数敏感性；不称 Sobol 全局贡献或参数交互分析；参考结果选参后需要新的留出 | 每个参数位置、原值、变体值、分数、范围、变化量 | 已实现；局部邻域验证通过 | [SALib basics](https://salib.readthedocs.io/en/latest/user_guide/basics.html)、[scikit-learn validation curves](https://scikit-learn.org/stable/modules/learning_curve.html) | 邻域确实改变指定参数；无参数标记不适用；保持输入不可变 |
| 市场状态分层测试 | 因子在哪些事前可识别的状态有效或失效？ | 数据中已有且在决策时可得的数值状态字段，例如 volatility/trend | 显式指定字段；仅训练样本确定分位点，再把验证样本分层计算同类 IC；每层记录数量，小样本不制造指标 | 无外部模型；依赖调用者提供真实 PIT 字段 | 未请求、状态字段不存在、训练值无变异或各层太小 | 现有字段的条件分层，不擅自宣称识别了隐藏 Markov 状态；避免事后按收益命名状态；细分增加多重比较 | 分层阈值来源、每层样本／IC、缺失量、小样本状态 | 已实现；缺字段／小样本验证通过 | [statsmodels regime switching example](https://www.statsmodels.org/stable/examples/notebooks/generated/markov_regression.html)、[scikit-learn leakage guidance](https://scikit-learn.org/stable/common_pitfalls.html) | 训练阈值不受未来影响；缺字段／小样本正确记录并继续 |
| Bootstrap 置信区间 | 所观察到的相关性统计量和平均诊断收益有多大抽样不确定性？ | 有时序依赖的 IC 点／单品种因子-标签对及收益序列 | 循环区块 bootstrap；配对重采样保留因子-标签对应，横截面以日期 IC 为单元；百分位 CI，用户可选区块长度与置信水平 | 本地有界重采样；无 SciPy 运行依赖 | 未请求、有效重采样不足、区块长度超过序列、序列过短 | 百分位区间不等于 BCa；区块长度影响覆盖率；假设局部依赖可由区块表示，不保证非平稳情况下的名义覆盖 | 统计量、上下界、置信水平、有效次数、blockSize、seed | 已实现；配对／共同时间区块验证通过 | [arch CircularBlockBootstrap](https://arch.readthedocs.io/en/latest/bootstrap/generated/arch.bootstrap.CircularBlockBootstrap.html)、[SciPy bootstrap](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html) | 完全正相关配对 CI 为 1；结果随块长可变化；种子复现；不把零有效重采样算通过 |

## 共同实现约定

- 保留 `prepare / candidate / select / finalize` 与 `sesame.factor-evaluator/v1`。
- `dataset.mode` 可为 `auto / cross-sectional / time-series`；auto 只按开发数据品种数决定，单品种不再因横截面四品种条件而无指标。时序 Rank IC 是预测相关性；收益为训练阈值固定后的理想化方向诊断，均不是经纪商逐笔成交结果。
- `options.diagnostics` 按名称请求以上项目；缺省无扩展诊断。各项结果是 `completed / partial / not-requested / not-applicable / unavailable / error` 加原因和数值，不给七项总的“通过”。未测不是已通过，也不是用户想法错误。
- 基础输入身份、数值合法性、时间因果性仍是产生可信结果所需条件；与扩展诊断逐项可跳过相区分。
- `minRankIC / minCoverage / maxCorrelation` 仅在调用方显式选择时作为门槛。没有基础可测量结果不得进入 eligible；无候选可选时允许空选择、继续 finalize 与报告。
- 选择前的扩展计算只使用开发期；涉及留出的结果延后到冻结选择后的 finalize。每次使用固定种子并记录实际方法、样本、计算配置，归档可复现。

## 初始验证

改动前 `node --test plugins/optional-api-v1/packages/factor-evaluator/tests/*.test.js`：53/53 通过。已将原插件目录快照到本目录 `before/factor-evaluator/`，保留原有工作区未提交修改。

## 最终覆盖与验证

七项均完成一手资料调研、适配说明、实际计算和合成回归验证，覆盖为 7/7；并不要求每次运行 7/7。扩展诊断默认不跑。多品种时序 bootstrap 共用市场时间区块，复制一个完全相关序列不会虚增独立信息或收窄区间。详见插件 `DIAGNOSTICS.md` 与 `tests/diagnostics.test.js`。

最终插件专项 71/71 通过，包括 15 个诊断专项、原数值／固定输入／权限／归档复现，以及新增显式门槛、部分失败、空选择与 OOS 冻结测试。node --check 和 git diff --check 通过。oxlint 无错误、无新增警告，仅既有 saveSession 排除字段解构产生的 4 个 unused 警告。

尚未实现的不同问题：执行级逐笔成交/止盈止损/R 倍数，完整多重假设或 PBO 校正，Sobol 全局参数交互，Markov 隐状态拟合，以及每折重新发现/拟合候选的嵌套 walk-forward。当前实现明确标出这些方法边界；它们不作为本次或每次工作的阻塞项。
