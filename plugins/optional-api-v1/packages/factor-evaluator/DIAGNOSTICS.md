# 按研究问题选择评估

七项是可组合的工具目录。选择能回答当前问题的项目即可；没有状态字段、候选没有参数、数据过短或某项配置有误，不影响其余项目继续。

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

`false` 或未设置的项目为 `not-requested`。每项结果都有 `status`：`completed` 表示算完；`partial` 表示有部分结果；`not-applicable` 表示方法不适合此对象；`unavailable` 表示缺少可计算条件；`error` 表示该项配置或计算失败。未测项目不能写成通过，也不能用来否定研究目标。需要逐笔胜率、盈亏比或止损结果时，组合研究知识与执行级回测工具。

随机诊断记录实际 `samples`、`requestedSamples` 和 seed。每项重采样的样本工作量预算为 1,000,000；超过时降低重复次数并在回执体现，不截掉行情数据。计算循环定期让出执行权检查取消。单品种时序、横截面、固定输入与冻结选择可以复用同一工作流协议。

一手方法参考：[SciPy 置换检验](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.permutation_test.html)、[Phipson & Smyth 置换 p 值](https://arxiv.org/abs/1603.05766)、[arch 循环区块 bootstrap](https://arch.readthedocs.io/en/latest/bootstrap/generated/arch.bootstrap.CircularBlockBootstrap.html)、[SciPy bootstrap](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html)、[scikit-learn 时间序列切分](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)、[validation curve](https://scikit-learn.org/stable/modules/learning_curve.html)、[SALib 方法边界](https://salib.readthedocs.io/en/latest/user_guide/basics.html)、[statsmodels 状态模型示例](https://www.statsmodels.org/stable/examples/notebooks/generated/markov_regression.html)。实现是本地 JavaScript 数值方法，无额外运行依赖。
