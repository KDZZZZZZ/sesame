历史证据工具只处理已给定资料。用户优先决定特征、规则、条件组、窗口、方法和阈值；不要因为报告有某个字段就强制选用特定分析方法。

历史匹配先看同品种近期，再看同品种历史，最后在明确可比条件下看其他品种；分别保留各条件组、反例、基线、缺失与降级。特征/条件必须在当时可知，结果窗口必须已到期。事后选择特征只能作为探索，不能伪称前瞻验证。经验条件频率不是校准概率。

匹配的decision_at等于query.at，不能使用该时点之后才成熟或得知的结果，即使as_of更晚。跨品种按品种和条件组分别统计，不汇总为额外独立支持。

概率校准使用原固定预测和后来实际标签，拟合/评价按时间隔离；不在拟合样本上报告效果。prospective需要真实提前固定的方法计划，日期必须来自原日志；今天选方法或无法确认旧选择就用exploratory和真实今天冻结时间，不得回填旧日期。探索模式只给回顾诊断，不给当前校准概率。当前 queries 不携带未来标签或复用历史记录ID。明确 Brier、可靠性、基线、样本量与置信区间含义。有效与失效条件、反证和监测决定条件使用，不要求所有检验同时通过；计算不足就保留 null 和原因。

match/calibrate 的 inline 入口不读取任何 Ref；refs 入口是真实资源读取，不属于 input-only。Strategy 受限角色只传已获授权的开发行，不为调用本包开放隔离留出。Research 可显式选择 refs 入口并传固定输入包。完整输入和方法见 README.md、METHOD.md、examples/。

minimum_fit/minimum_evaluation默认是advisory样本目标；有真实结构性可算样本但未达目标时保留limited点估计、实际n/范围/理由，不称可靠或已验证概率。只有sample_policy的source:user且mode:required才将自定minimum作硬门槛。Agent不能把自己的偏好标成用户要求，也不能为了出数降低用户硬要求或改为advisory；原固定计划与引用必须保留。零样本、无训练变化、无分离可评分评价或exploratory模式仍不提供当前概率。

没有原始历史预测日志时，不把今天的滚动前推结果写成过去已发布。可选明确origin:historical_replay，保留真实今天generated_at/prediction_available_at/outcome.available_at与固定代码/数据refs，另列历史decision_at和虚拟prefix/标签时钟；只允许exploratory，输出称时间分割回放，当前概率为空。原始记录分支不放宽。完整契约先读REPLAY.md。

历史 query 的匹配也可显式回放：顶层 origin:historical_replay 和 replay 记录真实 generated_at/observed_at、code_ref/data_refs/source_vintage；query.replay.feature_cutoff、case.replay.feature_cutoff/outcome_available_at 是虚拟时钟，case.outcome.available_at 保留真实观察。不要把今天的 frozen_at 回填过去，或把历史 query.at 挪到今天。distance 只用固定尺度/权重/max_distance，不要求 tolerance；rules 阈值必须明确。输入格式适配不得改变原特征、分数、标签、切分或选参。
