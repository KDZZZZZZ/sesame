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

通过 Sesame native 工具调用时，宿主会保存固定输入和输出数据集，并返回 `input_dataset_id` 与 `dataset_id`。CLI 只生成 JSON，不自动登记数据集。

## 局限

本包不是生产模型框架，不做交叉验证、调参搜索、特征选择或隐藏 refit。ABU 旧 demo 包含更广的 sklearn 包装和随机 fold；本包刻意保留一个小而可复核的 chronological baseline。不要把 eval 描述为样本外，除非输入 split 确实代表未来未见数据。Agent 若替换模型，必须保留 train-only scaler、固定 eval/holdout 和 baseline 对照。
