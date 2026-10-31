# 按研究问题选择评估

九项是可组合的工具目录。选择能回答当前问题的项目即可；没有状态字段、候选没有参数、数据过短或某项配置有误，不影响其余项目继续。

```json
{
  "dataset": {
    "mode": "time-series",
    "trainEnd": "2024-04-30T00:00:00Z",
    "validationEnd": "2024-08-31T00:00:00Z",
    "holdoutEnd": "2024-12-31T00:00:00Z",
    "horizon": 1,
    "costBps": 10
  },
  "diagnostics": {
    "outOfSample": true,
    "bootstrap": { "samples": 199, "seed": 17, "blockSize": 5 },
    "regimes": { "field": "volatility", "bins": 3 }
  }
}
```

这些是 `factor_evaluate prepare` 的 `options`，也是 `auto_factor_start` 的 `config.evaluator.arguments`。输入仍需固定 `inputRef` 或注册 `dataset_id`。示例切分日期和状态字段必须对应实际数据，不增加品种来迎合评估器。

| 项目键 | 解决的问题与方法 | 配置（均可省略的字段） | 返回值与可跳过情况 |
| --- | --- | --- | --- |
| `placebo` | 因子与结果的对应关系是否强于打乱对照？截面逐日置换标签；时序逐品种循环移位标签。 | `samples` 默认 199，20–999；`seed` 默认 20261024，uint32 | 双侧绝对统计量、加一校正极端比例、对照分布摘要；无有效相关性或短序列时 unavailable。循环移位以近似平稳为前提，不是多重研究尝试校正。 |
| `monteCarlo` | 经验方向收益路径的终值和回撤可能怎样变化？对非重叠成本后收益作带放回循环区块重采样。 | `samples`、`seed`；`blockSize` 默认样本数立方根向上取整 | 终值／最大回撤分位、亏损路径比例、破产和无效路径数量。至少 8 期、至少两个区块。它是经验情景，既非显著性检验也非真实逐笔成交。 |
| `outOfSample` | 后续验证表现及冻结后留出结果如何？ | `true` 或 `{}` | train/validation 边界与指标；holdout 为 deferred、not-requested 或 evaluated。validation 可参与候选研究，不能称其为未接触最终留出。development-only 仍可完成验证分析。 |
| `walkForward` | 固定公式向前推进到不同时间段时是否稳定？扩展训练窗、连续测试窗、只在历史训练段确定方向阈值。 | `folds` 默认 3，2–8；`minTrain` 默认 20，8–20000；`minTest` 默认 10，4–20000；`gap` 默认 horizon，不能小于 horizon | 每折边界、间隔、阈值拟合截止时间、purge 数、指标与状态。不足的折记录 unavailable，其余继续。它不是每折重新挖掘候选的嵌套研究。 |
| `sensitivity` | 参数附近小变化是否让因子效果骤变？一次改变一个 AST 窗口或常量。 | `maxVariants` 默认 12，2–16；`windowStep` 默认 1，1–20；`constantFraction` 默认 0.1，>0–1 | 参数位置、原值、邻值、指标及变化范围。无可调参数是 not-applicable。它是局部邻域，不是 Sobol 全局敏感性，也不会自动采用最好的邻值。 |
| `regimes` | 不同事前市场状态下，因子关系如何？对显式状态字段按各品种训练期分位点分层。 | **`field` 必填**；`bins` 默认 3，2–5；`minObservations` 默认 8，4–20000 | 每层样本／IC、训练阈值、缺值和不足状态。缺字段 unavailable；小样本层不制造指标。字段必须在决策时可得，不是事后按收益划分，也不声称推断了隐藏状态概率。 |
| `bootstrap` | 测得的关联和平均诊断收益有多大抽样不确定性？配对循环区块百分位区间。 | `samples`、`seed`；`blockSize` 默认 max(horizon,样本数立方根向上取整)；`confidence` 默认 0.95，0.5–0.999 | IC 与平均方向收益置信区间、有效次数、区块长度。时序多品种共享市场时间区块，保留同时冲击；截面以逐期 IC 为单位。至少 8 个时间样本、至少两个区块、至少 20 个有效复样。区间是 percentile，不是 BCa；块长和非平稳会影响覆盖。 |

DSR/PBO 的配置和完整数据前提见下节。

`false` 或未设置的项目为 `not-requested`。每项结果都有 `status`：`completed` 表示算完；`partial` 表示有部分结果；`deferred` 表示必须等完整试验集合；`not-applicable` 表示方法不适合此对象；`unavailable` 表示缺少可计算条件；`error` 表示该项配置或计算失败。未测项目不能写成通过，也不能用来否定研究目标。需要逐笔胜率、盈亏比或止损结果时，组合研究知识与执行级回测工具。

随机诊断记录实际 `samples`、`requestedSamples` 和 seed。每项重采样的样本工作量预算为 1,000,000；超过时降低重复次数并在回执体现，不截掉行情数据。计算循环定期让出执行权检查取消。单品种时序、横截面、固定输入与冻结选择可以复用同一工作流协议。

一手方法参考：[SciPy 置换检验](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.permutation_test.html)、[Phipson & Smyth 置换 p 值](https://arxiv.org/abs/1603.05766)、[arch 循环区块 bootstrap](https://arch.readthedocs.io/en/latest/bootstrap/generated/arch.bootstrap.CircularBlockBootstrap.html)、[SciPy bootstrap](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html)、[scikit-learn 时间序列切分](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)、[validation curve](https://scikit-learn.org/stable/modules/learning_curve.html)、[SALib 方法边界](https://salib.readthedocs.io/en/latest/user_guide/basics.html)、[statsmodels 状态模型示例](https://www.statsmodels.org/stable/examples/notebooks/generated/markov_regression.html)。实现是本地 JavaScript 数值方法，无额外运行依赖。

## 任务评估计划

`evaluationPlan.tests` 的条目覆盖同名 `diagnostics`，可以显式设 false。`reasons` 为所选项目的短理由。示例仅演示输入形式，不是推荐阈值：

```json
{"evaluationPlan":{"tests":{"dsr":true,"pbo":{"blocks":4}},"reasons":{"pbo":"比较完整已尝试集合的选择风险"},"thresholds":[{"metric":"diagnostics.pbo.probability","value":0.4,"operator":"lte","mode":"advisory","source":"agent","reason":"任务采用的关注线，超过后需解释适用范围"}]}}
```

数值路径从 metrics 读取，例如 `validation.rankIC`、`diagnostics.regimes.strata.0.rankIC`、`diagnostics.dsr.probability`、`diagnostics.pbo.probability`；`redundancy.absoluteCorrelation` 在 select 按实际所选对解析。只支持 gte/lte/gt/lt/eq；不读取 holdout。要求来自用户时仍可能只是建议，只有 source=user 且 mode=required 才是硬要求。无法测量的硬要求不会算作满足。默认项目均不运行，默认阈值均不限制选择。

## DSR 与 PBO

**DSR** 采用 [Bailey 与 López de Prado (2014), equation (2), pp. 8–10](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf)。以每期 Sharpe `s`、样本长 `T`、偏度 `g3`、Pearson 峰度 `g4` 计算：

```
s0 = sqrt(var(trial Sharpes)) * ((1-gamma)*Phi^-1(1-1/N) + gamma*Phi^-1(1-1/(N*e)))
DSR = Phi((s-s0)*sqrt(T-1) / sqrt(1-g3*s+(g4-1)*s*s/4))
```

`gamma` 为 Euler–Mascheroni 常数。各试验 Sharpe 使用样本标准差，偏度／峰度使用总体标准化中心矩；跨试验方差用 N-1 分母。不推断年化倍数、无风险利率或置信度。输出明确记录 `riskFreeAssumption: "zero per diagnostic period"`：实际输入是扣成本后的理想化方向价格收益，假设每期无风险收益为零，并未扣除当期真实无风险收益。默认 N 为全试验数，并明确假设独立；可传 `{independentTrials:整数,reason:短文本}` 声明 1..试验数的独立数量，不能声称系统已估计相关性；N=1 时基准为 0。试验 Sharpe 近似正态、收益 IID 渐近近似及有限四阶矩是假设；自相关不在此公式修正，小 N 期望最大值近似较弱。DSR 不是未来获利概率，也不自动成为合格线。

**PBO** 采用 [Bailey 等, Algorithm 2.3 与 §3.1 (2015 author manuscript), pp. 11–14](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf)。将完整同步 T×N 收益矩阵切成 S 个连续等长块，枚举全部 C(S,S/2) 个 IS/OOS 互补组合；每组合以 IS Sharpe 最大者的 OOS 秩 `rank/(N+1)` 取 logit。PBO 是 logit<=0 的比例。原文未明确离散同分策略；本实现 IS 并列者均分权重、OOS 使用中秩，恰在中位数算入失败边界并明确披露，因此列重排不会改变数值。它评价最大 Sharpe 选模，不等同于任意 Agent 判断流程的过拟合概率。

配置 `pbo:{blocks:S}`：S 为 2..16 的偶数，必须整除收益期数，每块至少两期，绝不丢末尾数据。省略时在 8/6/4/2 中取首个满足条件者；若无可分方案则 unavailable。至少 8 期、2 个试验；任何子样本 Sharpe 未定义则不报告一个“只看有效折”的概率。所有组合都参与计算，展示最多 8 个组合及每组合 4 个并列赢家，省略数量明确记录；这是明细上限，不是计算截断。

两个项目在 select 收集**所有已登记候选**的开发验证期 `factorEvidence.returns`，不是已选赢家摘要，也不是原生券商回测。每列 time/endTime 必须完全一致；不对齐不补零、不取交集。失败尝试（含可修正的语法拒绝）、不可测／零方差收益及其原因保留，完整集合不成立时 unavailable。完整性只覆盖此会话，不能确认上游是否隐瞒试验。所有数字均由实际记录返回值计算；finalize 只复制其冻结结果，holdout 不参与矩阵、阈值或选模。

`conditional` 是研究使用范围，不是验证证书。开发集发现的条件明确标 exploratory，原结果中的不利层、空层及全局未达关注线同时保留。选择只表示存在可讨论的实际证据；它不会生成交易规则、推荐仓位或免除用户硬要求。
