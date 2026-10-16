# abu-model-lab

这是受 ABU ML demo 启发的 chronological linear model 研究基线，参考上游 commit `d602d847677e4c2b77b0a122df30816ea68b5710`。**这里的具体代码是基线，不是标准答案；Agent 可以替换或改进模型，但必须保留训练/评估分离、原始输出、假设、变更、试验和固定 holdout。**

## 输入

输入需要 `feature_names` 和 `rows`。每行必须包含 `time`、`available_at`、`label_available_at`、`split`、`features` 和 `label`。`split` 只能是 `train` 或 `eval`。特征必须在 `time` 决策点前可见，当前实现要求 `available_at <= time`；标签必须满足 `time <= available_at <= label_available_at <= as_of`。

`task` 可以是 `regression` 或 `logistic`。logistic 标签只能是 `0` 或 `1`。参数包括 `learning_rate`、`iterations` 和 `l2`。训练预算限制为 `train_rows * (feature_count + 1) * iterations <= 5,000,000`。

## 输出

工具只用 train 行拟合均值、标准差和线性权重。所有 eval 行必须在所有 train 行之后，且所有训练标签必须在第一条 eval 决策前可见。输出包括训练/评估行数、训练集 scaler、线性系数，以及 eval 行的 prediction、actual、MSE；logistic 额外输出按 `0.5` 阈值计算的 accuracy。

CLI 示例：

```bash
node scripts/baseline.mjs examples/input.json --out result.json
```

通过 Sesame native 工具调用时，宿主会保存固定输入和输出数据集，并返回 `input_artifact` 与 `result_artifact`。CLI 只生成 JSON，不自动登记数据集。

## 局限

本包不是生产模型框架，不做交叉验证、调参搜索、特征选择或隐藏 refit。ABU 旧 demo 包含更广的 sklearn 包装和随机 fold；本包刻意保留一个小而可复核的 chronological baseline。不要把 eval 描述为样本外，除非输入 split 确实代表未来未见数据。Agent 若替换模型，必须保留 train-only scaler、固定 eval/holdout 和 baseline 对照。

## API 2 调用契约

`abu_model_lab_analyze({input})`：使用明确分离的训练/评估数据拟合小型线性回归或逻辑回归，并输出可解释的参数和时间顺序评估。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 feature_names 为 1..50 个唯一名称；rows 含 time、available_at、label_available_at、split:"train"|"eval"、features:{各名称:有限数值}、label，可选唯一 id。至少 2 条 train 和 1 条 eval，time 不重复。当前契约要求 available_at == time <= label_available_at <= as_of；所有训练 time 和训练 label_available_at 必须早于第一条 eval.time。logistic 的 label 只能为 0/1。train 条数*(特征数+1)*iterations <= 5000000。

observations.train_rows/eval_rows 为样本数；scaler、coefficients 只由 train 拟合；chronological_eval 含 predictions、mse 和 accuracy（仅 logistic 非 null）。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

时间顺序验证不独立证明输入是真正未见样本。小型模型是可改进基线，不提供自动特征选择、模型部署或最优参数保证。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。
