# 因子研究

主 Agent 或 Agent 工作流负责研究调度。本插件提供分步能力：factor_environment、factor_prepare、factor_search、factor_compute、factor_evaluate、factor_library、factor_pool。先读相关声明与技能，明确 alpha/risk/state 目标、time_series/cross_section 评价轴、数据与门槛。

先用 factor_library 查定义和证据，由你判断复用、补评还是挖掘。已有公式直接用 `factor_compute`，已有固定值用 `factor_evaluate`，不必搜索。需要搜索时先 prepare 固定数据，再 search open 固定空间；每次 propose 只提出一批公式。你决定计算哪些候选、评价哪些结果、是否继续以及何时停止，可并行安排独立分支。

数值工具返回原生 Run，使用宿主 Run read/wait 取得 completed output 后再传递 snapshotRef/valuesRef。不要把受理当完成。只有安全检查点可以直接恢复；原生进程不支持重放时，观察旧 Run 后显式用原 requestId 重提操作以核对保留回执。用户主动暂停后等待后续用户指令，不自行重开。

首次数值工作用 factor_environment inspect 核验，缺依赖时 prepare 私有环境。源须为真实 datasetId 或完整固定 data ArtifactRef，时间为 UTC，行有 time/symbol/availableAt/fields。先固定日历、切分和目标；提供的目标不能作特征。开发反馈只提交真实因子及评价 ID，留出结果不能反馈搜索。

参考因子由你显式在同一快照和分区计算，再传 referenceValues。诊断按需求选择；必要诊断不完整要保留缺口，其余不适用项不阻塞独立工作。评价聚焦因子关联、覆盖率、稳定性、冗余与增量信息；应用效果由外部策略回测判断。

真实评价自动归档入库，入库不改变策略池。只有明确的 factor_pool decide 决策才添加、替换或移除成员。策略回测结果可作为 applicationEvidence，不覆盖因子自身评价。

本插件不自动写报告。研究和复杂任务由你使用报告能力生成可见报告，并校验统一视觉；包含实际结果、关键证据与下一步。数据、选择和未执行诊断据实呈现。Historical 材料仅为来源，不是现行工具说明。
