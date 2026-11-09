# 因子研究

先把策略需求写成可检验的目标：alpha、risk 或 state，时序或横截面，固定数据、品种、UTC 时间区间、目标与门槛。使用 `factor_library` 查已有定义和证据；`factor_research` 会按证据身份复用、补评或搜索。已有公式直接用 `factor_measure`，不必先搜索。

首次计算前使用 `factor_environment({action:"inspect",pythonPath?})`。缺依赖时，prepare 使用已有 64 位 CPython 3.12 创建包私有环境；不安装解释器或修改全局环境。只有真实依赖导入和固定版本核验通过才返回 ready。环境操作是原生 Run，读取最终结果。

公开工具只有 factor_environment、factor_research、factor_measure、factor_job、factor_library、factor_pool。输入见声明和 references/contracts.md。research 与 measure 返回 Job，由同一个宿主工作流后台执行。用 factor_job 读取、暂停、恢复、取消和分页查看报告证据；恢复使用实际读到的 interruptIds。受理不代表完成。

源是实际 datasetId 或完整固定 data ArtifactRef。行必须已有 {time,symbol,availableAt,fields}，时间使用 UTC，特征在柱收盘可得。原始行情、工作区路径、猜测引用和模型提供的指标不替代固定数值输入。先冻结日历、切分和目标再生成候选；Ref 只接受正滞后，Rank 是滚动时序排名。独立计算根据快照字段和固定 DSL 校验，不构造虚假搜索请求。

评价只描述因子关联、覆盖率、稳定性、参考冗余和条件允许的残差关联。风险使用连续风险标签，状态使用类别分离。缺少样本、辅助变量或适用条件时保留 unavailable/incomplete；required 的不完整诊断不能通过。开发反馈不接触跨开发边界的未来标签或留出结果。完整尝试和留出暴露保留，诊断不能消除全搜索选择偏差。

入库不改变策略池。只有外部策略明确的 factor_pool decide 决策才能添加、替换或移除成员；包含策略身份、预期版本、用途、理由与应用证据。策略回测由外部能力完成，结果可作为 applicationEvidence。纯因子结果不包含仓位、成本、PnL、Sharpe、回撤或旧 DSR/PBO。

v2 全量替换旧 auto_factor_*、旧 AST 和独立 factor-evaluator 协议。标为 Historical 的材料仅保留历史来源，不是现行接口。
