# abu-parameter-search

参考 ABU 网格搜索与交叉验证，来源固定至 `d602d847677e4c2b77b0a122df30816ea68b5710`。本包展开有限参数网格，对调用者提供的实验指标排序，并校验开发选择与留出验证的交接记录。

这是可验证的基线，不是标准答案。Agent 可以改进搜索策略，但必须把原始网格、假设、变更、每次试验和固定 holdout 结果完整保存。

## 两阶段使用

输入包含 `schema_version: 1`、`source`、规范 UTC `as_of`、`grid` 和 `trials`。每条试验声明 `parameters`、`split`、`available_at` 及 `metrics`。在 `parameters` 中设置 `phase`、`objective_metric`、`direction`（`maximize` 或 `minimize`）和可选 `max_grid_points`。

1. `development`：只接受开发期指标，拒绝传入 `frozen_selection` 和留出指标。按指定目标排序，选择排名首位的参数，以 `as_of` 作为选择时点，输出新的 `observations.frozen_selection`。
2. 在对话之外冻结这份选择记录和开发证据。
3. `holdout`：传入相同开发试验、完整原始 `frozen_selection`，以及仅针对选中参数的留出指标。选择时点不得晚于当前 `as_of`，必须不早于开发证据可得时间，并严格早于留出证据可得时间。

```bash
node scripts/baseline.mjs examples/development.json --out development-result.json
node scripts/baseline.mjs examples/input.json --out holdout-result.json
```

这两个文件是配套的合成示例。真实使用须先运行开发阶段，再把实际返回的选择记录复制到留出输入，不沿用示例摘要。原生工具 `abu_parameter_search_analyze({input})` 自动保存输入及结果数据集，返回 `input_dataset_id` 与 `dataset_id`；CLI 不自动登记数据集，且拒绝覆盖已有输出文件。

## 范围和改进

摘要检验声明的网格、目标、开发证据和选择是否自洽，不能证明调用者从未看到留出数据。ABU 原框架有更完整的因子搜索；本包不执行策略或任意表达式，全部指标由固定 JSON 提供。Agent 可以改进搜索和选择方法，但应保留原基线、每次试验及同一固定样本外对照。
