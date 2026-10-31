---
name: abu-model-lab
description: Fit a train-only linear baseline and evaluate on later chronological rows.
---

# 轻量模型基线

这是可修改、可验证的研究基线，不是标准答案。改进公式或参数时保留原结果、修改假设和对照证据。

能力 `abu_model_lab_analyze`：使用明确分离的训练/评估数据拟合小型线性回归或逻辑回归，并输出可解释的参数和时间顺序评估。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 feature_names 为 1..50 个唯一名称；rows 含 time、available_at、label_available_at、split:"train"|"eval"、features:{各名称:有限数值}、label，可选唯一 id。至少 2 条 train 和 1 条 eval，time 不重复。当前契约要求 available_at == time <= label_available_at <= as_of；所有训练 time 和训练 label_available_at 必须早于第一条 eval.time。logistic 的 label 只能为 0/1。train 条数*(特征数+1)*iterations <= 5000000。

observations.train_rows/eval_rows 为样本数；scaler、coefficients 只由 train 拟合；chronological_eval 含 predictions、mse 和 accuracy（仅 logistic 非 null）。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

时间顺序验证不独立证明输入是真正未见样本。小型模型是可改进基线，不提供自动特征选择、模型部署或最优参数保证。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。

`references/method.md` 解释公式和原版差异；包根目录 `examples/input.json` 提供合成样例。两者用于需要时核对，不是调用前的固定步骤。
