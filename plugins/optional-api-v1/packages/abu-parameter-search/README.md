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

这两个文件是配套的合成示例。真实使用须先运行开发阶段，再把实际返回的选择记录复制到留出输入，不沿用示例摘要。原生工具 `abu_parameter_search_analyze({input})` 自动保存输入及结果数据集，返回 `input_artifact` 与 `result_artifact`；CLI 不自动登记数据集，且拒绝覆盖已有输出文件。

## 范围和改进

摘要检验声明的网格、目标、开发证据和选择是否自洽，不能证明调用者从未看到留出数据。ABU 原框架有更完整的因子搜索；本包不执行策略或任意表达式，全部指标由固定 JSON 提供。Agent 可以改进搜索和选择方法，但应保留原基线、每次试验及同一固定样本外对照。

## API 2 调用契约

`abu_parameter_search_analyze({input})`：对已完成实验的有限网格指标排序，冻结开发期选型，再核对该固定选型的留出期证据；不运行策略。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 grid 是 1..10 个任意参数名到候选数组的映射，每数组 1..100 个有限数值/字符串/布尔值，组合数 <= max_grid_points。trials:[{split:"development"|"holdout",available_at,parameters,metrics}]，每个 parameters 必须精确对应某个网格点，metrics[objective_metric] 为有限值。development 阶段至少 1 条开发试验，不接受 holdout 或 frozen_selection。holdout 阶段传回开发运行的完整 frozen_selection、相同 grid/目标/开发 trials，加上只属于选中参数的 holdout trials；保持选型和哈希原值，selected_at 必须早于 holdout.available_at <= as_of。

observations.development_rank 是仅按开发指标排序的排名；frozen_selection 含 parameters、selected_at 和全部核验哈希；fixed_holdout_evidence 仅含选中参数的留出期指标；grid_points 是网格组合数。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

留出验证依赖先前真实的开发选型记录；若只有一阶段的证据，结果只支持该阶段的结论。缺少选型时不要编造哈希或把留出结果改标为开发结果。 哈希只能核对记录内一致性；外部固定保存的开发工件才支持先选型后验证的时序证据。传入的是已有指标，本能力不会执行任意策略或表达式。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。
