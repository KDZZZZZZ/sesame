---
name: auto-factor-mining
description: 主 Agent 直接组织因子搜索、Qlib 计算、纯因子评价和入库；策略独立选用因子。
---

# 因子研究方法

当策略需要某种信号、发现可能可提取的规律，或需要复核现有因子时使用。先读取 [接口](../../references/contracts.md) 与相关知识方法，定义预期用途、可观测特征和检验目标。

1. 用 factor_library 查询已有定义与评价。核对数据、时间、目标、环境、profile 和参考身份；由 Agent 决定是否可复用。
2. 用 factor_environment inspect 核验实际环境；缺依赖时 prepare 私有环境。用 factor_prepare 冻结数据和开发/留出区间，读取原生 Run 的 snapshotRef。
3. 已有公式直接 factor_compute。需要新公式则 factor_search open 固定字段、算子、窗口、复杂度、种子/模板、目标与搜索预算；propose 一次只请求一批。
4. 明确调用 factor_compute 计算 development。独立公式批次或研究方向可以并行。需要 regimes/sensitivity 辅助值时，在 compute 的 diagnostics 中明确给出选项；参考公式也单独计算。
5. 用 factor_evaluate 评价 valuesRef，传同一快照、分区和引擎的 referenceValues；无参考时传 []。成功评价自动存入库，包括不充分和无效结果，不自动选入策略池。
6. 根据结果决定下一批、调整方向或停止。搜索反馈只传该搜索候选的真实 development `{factorId,evaluationId}`；变更搜索空间/profile 建立新会话。候选选定后，显式请求 holdout 计算与评价，记录选择依据与留出暴露，不把留出反馈给搜索器。
7. 研究任务使用报告插件交付可见报告并校验统一视觉。因子池由外部策略明确 decide；策略回测和应用反馈另做，应用效果不覆盖纯因子评价。

每个数值调用得到宿主 Run 回执，用 read/wait 观察完成；function Run 完成不会自动续写主 Agent，不应发出后就宣称研究完成。取消/暂停使用宿主已有能力，恢复限制见 [执行说明](../../references/execution.md)。

Formula 为 qlib-expr/1 类型树；Ref 正滞后，Rank 为滚动时序排名。固定网格保留缺失柱和预热；开发标签禁止越界。单品种可做时序评价，多品种按问题选择横截面评价。可选诊断不完整不妨碍其他独立步骤，required 不完整不能记为通过。

搜索器接收结构化空间，不理解自然语言来替你规划研究；need 是假设说明。没有自动查库、连续研究总控、隐式参考计算、前八名留出选择或自动报告步骤。
