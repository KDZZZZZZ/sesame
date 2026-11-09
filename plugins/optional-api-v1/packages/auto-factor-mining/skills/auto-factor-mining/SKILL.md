---
name: auto-factor-mining
description: 按策略需求复用、补评或搜索因子；使用真实 Qlib 计算并保留纯因子证据，支持独立计算与评价。
---

# 因子研究

明确目标 alpha/risk/state、轴 time_series/cross_section、实际数据、UTC 切分、目标与门槛。读取现行 references/contracts.md，使用 factor_library 查询已有定义和匹配证据。

1. factor_environment inspect 核验真实 Python/Qlib/DEAP/Optuna 环境；缺依赖时 prepare 私有环境。不安装到全局 Python，不把元数据存在等同于可运行。
2. 新需求调用 factor_research({draft})。已有公式用 factor_measure compute/both；已有冻结 Values 用 evaluate。公开输入不接受模型提供的指标。
3. 用 factor_job 观察真实 Job 与分页证据。暂停等待安全点，恢复携带读到的 interruptIds，取消后不再提交结果。
4. 核验定义、数据/目标/日历、环境/算子、profile 与 reference 身份。缺失或不适用诊断保持 incomplete，required 的不完整项不能通过。
5. 入库与策略选择分别处理。只有外部策略明确决策才能调用 factor_pool decide，同时给出策略版本、预期池版本、理由、用途和应用证据。

Formula 使用 qlib-expr/1 类型树。Ref lag、滚动 window 为正整数，Rank 为滚动时序排名。源行已经有 time/symbol/availableAt/fields；缺失柱保留网格位置。开发反馈不接触跨开发边界的未来标签或留出结果。

评价聚焦关联、覆盖率、稳定性、冗余与条件允许的残差关联，状态使用类别分离。独立评价只消费冻结矩阵与辅助值，不重新取数或计算公式。应用策略回测由外部能力执行，不把因子证据当成仓位、成本、PnL 或可交易结论。

公开入口是六个 factor_* 工具；不要调用内部 factor_workflow 或旧 auto_factor_*。Historical 材料中的旧接口不再适用。
