历史证据工具只处理已给定资料。用户优先决定特征、规则、条件组、窗口、方法和阈值；不要因报告存在某字段就强制套用特定方法。

- **历史匹配**：优先同品种近期，其次同品种历史，最后在明确可比条件下看其他品种；按品种与条件组分别保留反例、基线、缺失与降级，不把跨品种汇总冒充独立支持。`decision_at` 等于 `query.at`，所有特征/条件须当时可知、结果窗口须已到期；事后选特征仅作探索，经验条件频率不是校准概率。
- **概率校准与样本政策**：拟合与评价严格按时间隔离。`prospective` 须提前固定计划与原日志日期；事后选方法用 `exploratory` 和今日真实冻结时间，只给回顾诊断、不给当前校准概率。`minimum_fit`/`minimum_evaluation` 默认为 advisory（样本不足时保留 limited 点估计与实际 n/理由，不称已验证）；仅 `sample_policy` 为 `source:user` 且 `mode:required` 时作硬门槛，不擅自改宽松或将 Agent 偏好标为用户要求。
- **入口区分**：`match`/`calibrate` 的 `inline` 入口不读 Ref；`refs` 入口真实读取固定输入包。Strategy 受限角色只传已授权开发行，不为此开放留出集。详细方法见 `README.md`、`METHOD.md`、`examples/`。
- **显式历史回放**：无原始历史预测日志时不得回填旧日期；使用 `origin:historical_replay`（仅允许 `exploratory`，当前概率为空）并保留今日真实生成/观察时间与固定代码/数据引用，完整字段与时钟契约按需先读 `REPLAY.md`。
