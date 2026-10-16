---
name: abu-parameter-search
description: Rank supplied development trials over a finite grid and preserve a fixed holdout.
---

# 参数实验基线

这是可修改、可验证的研究基线，不是标准答案。改进公式或参数时保留原结果、修改假设和对照证据。

能力 `abu_parameter_search_analyze`：对已完成实验的有限网格指标排序，冻结开发期选型，再核对该固定选型的留出期证据；不运行策略。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 grid 是 1..10 个任意参数名到候选数组的映射，每数组 1..100 个有限数值/字符串/布尔值，组合数 <= max_grid_points。trials:[{split:"development"|"holdout",available_at,parameters,metrics}]，每个 parameters 必须精确对应某个网格点，metrics[objective_metric] 为有限值。development 阶段至少 1 条开发试验，不接受 holdout 或 frozen_selection。holdout 阶段传回开发运行的完整 frozen_selection、相同 grid/目标/开发 trials，加上只属于选中参数的 holdout trials；保持选型和哈希原值，selected_at 必须早于 holdout.available_at <= as_of。

observations.development_rank 是仅按开发指标排序的排名；frozen_selection 含 parameters、selected_at 和全部核验哈希；fixed_holdout_evidence 仅含选中参数的留出期指标；grid_points 是网格组合数。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

留出验证依赖先前真实的开发选型记录；若只有一阶段的证据，结果只支持该阶段的结论。缺少选型时不要编造哈希或把留出结果改标为开发结果。 哈希只能核对记录内一致性；外部固定保存的开发工件才支持先选型后验证的时序证据。传入的是已有指标，本能力不会执行任意策略或表达式。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。

`references/method.md` 解释公式和原版差异；包根目录 `examples/input.json` 提供合成样例。两者用于需要时核对，不是调用前的固定步骤。
