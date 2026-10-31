# 方法与结果解释

所有特征、尺度、匹配阈值、条件定义、窗口、置信水平、分箱与样本目标来自本次冻结计划。工具不搜索“最好看”的参数，也不改变用户选择。

## 匹配

`distance` 使用加权标准化欧氏距离：数值差除以调用方给定的正尺度，类别相同记0、不同记1；距离是加权平方差均值的平方根。尺度由固定计划提供，不用全部样本或未来结果重新拟合。此模式不使用 tolerance，可省略；若提供则只校验非负有限值，不影响匹配，rules_pass 为 null。`rules` 要求每个数值差在明确的非负 tolerance 内、类别相同；它不额外套用距离门槛。两者都输出逐特征差异。数值溢出明确报错。

只在特征、条件组及成熟结果满足时间要求的行中匹配。先按距离、再按较近时间及稳定 ID 排序，处理窗口重叠和 gap，最后截取 `max_matches`；任何一步都不按 label 排序。同一输入改变标签可以改变频率与反例，不能改变匹配 ID。基线是同一范围/条件组的所有合格观察，独立做按时间的去重叠，不仅使用匹配成功者。

三个范围分别输出，近期范围包含于同品种全部历史，不能当两份独立支持。跨品种只接受冻结计划明确列出的品种与可比条件，并始终按品种和条件组分别统计，不能拼成更大的样本。`regime_id` 由调用方基于当时已知信息定义，`regime_available_at` 不可晚于观察时点；分组不通过后来结果自动发现。匹配的决策截止为 `query.at`，不是可能更晚的计算快照 `as_of`；之后才成熟或得知的结果被排除。

每个品种/条件组内按时间区间去重叠：已保留区间的结束后增加显式 gap，与它相交或触边的后续候选不再计数。保留被排除 ID 和冲突 ID。不同品种/条件组没有相加的总样本量或总概率；同时发生的市场事件不能凭分组就当多份独立支持。去重叠不能消除其余序列相关，`n_nonoverlapping` 不是统计学有效样本量。

## 校准与独立评价

同一品种和条件组内，先按原分数合并 ties，使用带样本数权重的相邻违反合并算法 PAVA 最小化单调约束平方误差。重复分数共享均值；相邻均值递减时合并。新分数在相邻拟合结点间线性插值。域外默认策略由用户显式指定为 unavailable 或 clip；没有隐式外推。算法依据 [PAVA 算法论文](https://www.jstatsoft.org/article/view/v032i05) 与 [scikit-learn 的 IsotonicRegression 文档](https://scikit-learn.org/stable/modules/generated/sklearn.isotonic.IsotonicRegression.html)，本包未导入其中代码。

原预测必须有固定 prediction_ref、预测可得时间、模型训练截止和后来实际标签；拟合行的标签在 fit_end 前已可得。evaluation_start 晚于 fit_end 加 gap，不随机打散时间。评价只用其后与拟合分离的区间；评价数据不重新拟合，也不改变 bins、方法或阈值。时间顺序与 gap 的依据见 [TimeSeriesSplit 官方说明](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)。这些代码检查不能证明外部预测日志从未事后改写。

独立于拟合不等于独立于方法选择。prospective 声明只有在真实旧计划及原日志支持时才能用；若方法在今天才选定，或历史选择过程无法确认，必须用 exploratory 和真实冻结时间，不能把日期回填到 fit_end 前。探索模式保留 Brier、分箱和诊断映射，但不给当前校准概率或可用校准网格，也不声称方法已经独立验证。之后可按真正冻结的新计划积累未查看的未来评价。当前 query ID 不得复用任一历史预测记录 ID，且不允许携带未来标签。

Brier 为同一被评分评价集合上的 `mean((p-y)^2)`；基线概率为拟合期正例频率，并在同一评价集合评分。域外无法评分的行单列，给 coverage，不能悄悄当作全部评价集通过。Brier skill 为 `1 - calibrated_brier / baseline_brier`，基线分母为0时为 null。可靠性使用预先指定等宽概率 bins，给每箱样本、平均概率和观察频率。Brier 同时受区分度与可靠性影响，较低 Brier 不能独自证明更好校准，见 [概率校准官方说明](https://scikit-learn.org/stable/modules/calibration.html)。

Wilson score 区间按固定置信水平计算样本比例的上下界，公式依据 [NIST 手册](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm)。本实现支持80%、90%、95%、99%、99.9%双侧水平，样本为0时不计算。区间以独立、可比伯努利观察为前提；没有把金融序列的相关性或模型拟合不确定性塞进普通二项区间。

结构性最低条件为2条实际不重叠拟合行、label和score均有变化、至少1条真正分离且可评分的评价行；未知、未到期或不存在的样本不能补造。未满足时返回 `insufficient_data` 和 null 当前概率，保留审计数据。

用户/Agent自定 minimum_fit/minimum_evaluation 默认为 advisory 目标；有上述实际样本而未达目标时输出 limited 点估计、真实 n、范围与原因，不能称为可靠或已验证的概率。只有显式 sample_policy={mode:"required",source:"user",reason} 才据自定目标阻止当前输出；仍计算诊断映射和实际指标，不降低原用户要求。重新选方法或修改硬要求须有相应授权的新固定计划，不能通过改标签伪装为同一计划。已得到评价但表现差时，保留分组指标、反例和警告；用户可以依据明确的有效条件、失败条件和监测决定是否条件使用。不会生成“所有检验通过才可研究”的结论。
