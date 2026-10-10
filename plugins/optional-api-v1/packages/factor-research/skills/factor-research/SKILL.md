---
name: factor-research
description: 按需提出可反驳因子、验证数据时点、做有界截面评估与固定样本外；不强制具体挖掘方法。
license: MIT
---

# 因子创意到固定证据

1. 用 `plugin_read`，`plugin_id:"sesame/factor-research"`，先读
   `skills/factor-research/references/execution.md`、`references/method.md`
   （完整路径同 skill 目录）和包根 `PROVENANCE.md`。
2. 固定研究范围与字段。先查实际 provider 与公开目录，再使用 data-access 获得固定 DataRef。
   不把目录里的 skill 名当已安装能力。不能从 OHLCV 推造财报、资金流、订单簿、借券或机构身份。
3. 因子候选各写机制、可反驳条件、输入/单位、表达式、方向、窗口、available-at 和来源。
   用户指定方法就只用该方法。默认是用户选择的有界候选列表，不自动生成 Alpha158 或跑遗传/因果搜索。
4. 因子计算在现有 workspace 执行并冻结脚本/参数。按各标的时序计算，不使用未来 shift、全期拟合
   或最终修订财报。数据 schema 的时间是原始 SourceTime；只有证据充分才转成脚本所需 UTC，
   未知 authority/zone/fold 不猜。附历史成分、退市、复权与公告版本证据。
5. 按执行参考构造固定 development/holdout 两个文件及摘要。用本包 CLI `screen` 检查
   PIT/缺失/切分和 rank IC、覆盖率、训练样本相关性。先看数据失败，再看因子优劣。
   重叠持有区间、未来特征、缺失 eligible 收益会被拒绝，不能删掉问题行绕过。
6. 在训练/验证上按预声明标准做一次明确选择，`select` 冻结因子/方向/计划/开发结果摘要，
   将选择保存为不可变成果后再打开 holdout。`holdout` 只算选定因子，不输出其它候选的留出成绩。
7. 每次改变表达式、窗口、方向或样本都计入试验账本。公开失败、缺失、常量和负结果。
   CLI 只做描述性统计，不给 p 值/DSR/PBO；不能把无显著性输出改说“显著”。
   需要正式推断时按原始论文和完整试验矩阵另做选择，不强制加载无关统计理论。
8. 多因子组合的权重、归一化或中性化仅在训练段拟合；本版不自动拟合组合。先锁定因子再把
   组合/目标仓位交 strategy-authoring 和真实已选引擎。用真实数据及成本/限制检验，不把
   简化 long/short 诊断的曲线当券商权益。
9. reports 使用固定结果引用，区分观察/推导/demo，列覆盖率、未知、全部试验、成本及样本外。
   strategy-research 是可选的实验流程帮手，本包不强制依赖它，也不替代 judgment-evolution。
