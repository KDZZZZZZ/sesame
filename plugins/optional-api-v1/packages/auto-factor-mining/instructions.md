# 因子研究

主 Agent 或 Agent 工作流负责研究调度。本插件提供分步能力：factor_environment、factor_prepare、factor_search、factor_compute、factor_evaluate、factor_library、factor_pool。先读相关声明与技能，明确 alpha/risk/state 目标、time_series/cross_section 评价轴、数据与门槛。

从研究需求到合格因子入库的步骤与产物依赖声明为工作流 `factor.development`（`workflows/factor.development.yaml`）。主 Agent 开展完整的因子开发时，用 `workflow_plan` 以该工作流开立计划，按流程提示逐步执行并用 `workflow_step` 上报；只做其中一两步（如给已有公式补评）时不必建计划。

先用 factor_library 查定义和证据，由你判断复用、补评还是挖掘。已有公式直接用 `factor_compute`，已有固定值用 `factor_evaluate`，不必搜索。需要搜索时先 prepare 固定数据，再 search open 固定空间；每次 propose 只提出一批公式。你决定计算哪些候选、评价哪些结果、是否继续以及何时停止，可并行安排独立分支。

外部因子库是按需参考来源，见 references/external-factor-sources.md。使用现有检索能力读取选中的定义，核对字段和算子语义，将适配后的类型树连同名称、假设、固定来源版本、许可证和改写说明，用 factor_library register 保存到用户工作区的因子库。官方插件只维护参考链接与用法，不批量内置上游公式或替换数值引擎。登记无需先计算；登记本身不产生评价。

数值工具返回原生 Run，使用宿主 Run read/wait 取得 completed output 后再传递 snapshotRef/valuesRef。不要把受理当完成。只有安全检查点可以直接恢复；原生进程不支持重放时，观察旧 Run 后显式用原 requestId 重提操作以核对保留回执。用户主动暂停后等待后续用户指令，不自行重开。

首次数值工作用 factor_environment inspect 核验，缺依赖时 prepare 私有环境。源须为真实 datasetId 或完整固定 data ArtifactRef，时间为 UTC，行有 time/symbol/availableAt/fields。先固定日历、切分和目标；提供的目标不能作特征。开发反馈只提交真实因子及评价 ID，留出结果不能反馈搜索。

参考因子由你显式在同一快照和分区计算，再传 referenceValues。诊断按需求选择；必要诊断不完整要保留缺口，其余不适用项不阻塞独立工作。评价聚焦因子关联、覆盖率、稳定性、冗余与增量信息；应用效果由外部策略回测判断。

真实评价自动归档入库，相同定义合并证据并保留登记来源；入库不改变策略池。只有明确的 factor_pool decide 决策才添加、替换或移除成员。策略回测结果可作为 applicationEvidence，不覆盖因子自身评价。

本插件不自动写报告。研究和复杂任务由你使用报告能力生成可见报告，并校验统一视觉；包含实际结果、关键证据与下一步。数据、选择和未执行诊断据实呈现。
