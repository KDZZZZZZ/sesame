# 可选历史匹配与校准

本流程不把报告字段当成方法选择。用户/Agent 可以显式选择独立 `sesame/historical-evidence`，也可使用其他适合问题且实际可用的方法；新插件不是 Research 的强制依赖。

完整 Research 调用仍使用 `investment_research_start`、`model`、`research:{plugins,tools}` 和 `evidence_refs`。选择 `research.plugins:["sesame/historical-evidence"]`、`research.tools:["sesame/historical-evidence#historical_evidence_from_ref"]` 后，原四阶段按真实权限运行：

1. 需求阶段决定研究问题、用户优先的结果形式与适用边界；不计算市场结论。
2. 取证阶段复用或取得原资料，准备可靠的特征可得时间、原预测记录、成熟结果与固定计划。完整匹配/校准输入保存为单行 `json-rows` DataRef；manifest.dependencies 包含其计划、来源和原预测 refs。没有可靠历史版本就明确缺口，不能以今天抓取到文章为当时可知证明。
3. 分析阶段可调用 `historical_evidence_from_ref({operation:"match"|"calibrate",input_ref})`。1.1.2 起返回完整结果的 `result_ref` 和精简摘要；先读取固定结果中所需部分，再交接给综合阶段。不要把有界预览当成完整统计，也不把大 JSON 重写进 Markdown。该适配器只发布实际计算结果并绑定原输入；允许这一确切能力，不开放任意资源写入。前序固定引用通过 `evidence_refs` 和实际成员工具回执交接。完整输入见该插件公开 README/METHOD/examples。分析阶段不因此获得网络、配置、账户或交易权限。
4. 综合阶段消费真实计算结果和固定来源，用 Report 呈现所需结论、图表与证据；不在 Report 内植入算法，也不重新拟合校准。历史比较不足可以限制精度，并不自动否定有依据的条件判断。

匹配优先同品种近期，再扩大同品种历史，最后在明确可比条件下考虑跨品种。按条件组保留样本数量、匹配距离/规则、窗口、结果、基准、反例、缺失与降级。特征、条件组与尺度不能由后来结果倒推；探索性历史关联仍可用于生成假设，但不可声称前瞻验证。

经验条件频率与校准概率分开。需要校准时，用过去已经固定的预测及后来标签，保持时间顺序、分离拟合/评价、窗口隔离，报告 Brier、可靠性、基线、n 和区间含义。历史预测日志存在不代表今天选择的方法在过去已被固定：只有真实原计划和日志支持时才用prospective；今天首次选方法或旧选择不明，必须用exploratory和真实冻结时间，不能虚构旧日期。探索诊断可以有用，但不提供独立于方法选择的当前校准概率。

若只有真实历史行情、没有当时发布的预测日志，可显式选择historical-evidence 1.1.0的origin:historical_replay。先读其REPLAY.md，固定真实代码/资料/分数日志，保留今天的实际生成、获取和计划时间；历史decision_at及prefix/标签截止使用明确的虚拟时钟，不回填成实际发布时间。滚动前推分数只能用各决策前已知的特征和到期训练标签，校准再做时间分割；原分数训练与校准拟合是两层，评价标签不得回流。只用exploratory，报告说明“真实历史行情上的时间分割回放”，当前概率仍为空；不能称预注册、真实前瞻日志或原始历史数据版本。若未运行真实回放代码，不用示例数据替代实行情。

校准变差或某组失败也保留，不能把不同条件或品种强拼平均。匹配成熟结果截止为query.at，不能因为计算as_of更晚便用后来才知道的后果。当前待预测项不携未来 label，不复用历史预测记录ID。

样本目标默认advisory；真实样本满足结构性可算条件、但少于建议目标时，保留limited点估计、实际n/范围/原因，不称可靠或已验证概率。只有用户明确source:user、mode:required的sample_policy才据自定minimum阻止输出，Agent不能偷降用户硬要求或冒称自己的阈值由用户要求。结构性不足、没有独立可评分记录或未知支持时返回null；exploratory仍不提供当前概率。原固定计划与输入引用一并交接，不为得到结论改写要求。

用户可以结合已知有效条件、失效条件与监测条件使用局部结果，不要求所有检验一律通过。交接 `conditions`、`counterevidence`、`monitoring`，交代何时该更新或放弃判断。方法所需的真实前提仍不能伪造，例如未成熟结果、未来特征、拟合数据上的“独立评价”都不是可放宽成已完成的检查。

inline `historical_evidence_match` 与 `historical_evidence_calibrate` 只消费显式行，refs只作标签；Research已审查这两个精确 ID 的无副作用算术入口，不把任何未知空effects工具自动当安全能力。refs 入口声明真实 `resources.read`。Strategy 的隔离留出与 Research 的资料读取不是同一权限模型，不得拿这个读取入口绕过前者。
