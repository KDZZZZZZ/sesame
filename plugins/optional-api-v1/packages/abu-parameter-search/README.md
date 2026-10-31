# abu-parameter-search

参考 ABU 网格搜索与交叉验证，来源固定至 `d602d847677e4c2b77b0a122df30816ea68b5710`。本包展开有限参数网格，对调用者提供的实验指标排序，并校验开发选择与留出验证的交接记录。

定位是**已完成实验的输入指标选型**，不是回测引擎或执行 optimizer。`grid_points` 只统计声明空间，未提供试验的组合不会自动运行，也不会补分。需要实际搜索时先选符合用户/交易平台要求的引擎，再优先它已提供的原生优化器；本工具仍可独立处理不同计算方法的开发记录，或核对已有选择。原生回执已包含相同选型证据时直接复用，不额外强制本工具。因子 IC、DSR/PBO 与工作流隔离仍由真正的 evaluator/工作流负责。

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

## 文件与能力边界

`abu_parameter_search_analyze` 声明 `researchDataAccess:{schemaVersion:1,reads:"input-only",writes:"derived-artifacts-only"}`，可与 Strategy（auto-factor-mining）内置的研究知识一起用于 restricted 研究角色。只传入该角色已获得的开发试验；不为了调用本工具开放完整面板、data_read 或外部来源。留出证据仍由工作流冻结选择后评价。

原生路径只消费 args.input；其中的 ID、Ref、路径只作为来源标签保存，均不解引用。唯一文件读取是固定的本包 baseline.mjs 和 runtime.mjs 实现摘要；不取行情、账户或保留状态，不调用其他能力。create/publish 只保存本次输入及结果，并在发布后清理本次新建临时 blob，不能读写或删除已有资源。CLI 读取显式文件路径是独立入口，未作为研究工具授权。该约定由代码审计和真实执行回归支持，不是沙箱；修改数据访问路径时须重新声明并由新运行核对。

本包属于 `analysis / function`，提供给定证据上的局部确定性处理。算法和调用身份保持独立；研究目标、方法组合、数据来源、原生回测及交易交由调用方选择。

| 文件 | 职责 |
| --- | --- |
| `index.js` | 绑定现有能力，处理调用前取消，委托计算和成果登记 |
| `scripts/baseline.mjs` | 本包算法、参数约束、观察值和局限；保留原 CLI 入口 |
| `scripts/runtime.mjs` | 输入/时间校验、证据摘要、固定成果和 CLI 协议，独立包内交付 |
| `skills/abu-parameter-search/` | 用法与按需公式参考，不重复实现算法或调度研究 |
| `examples/input.json`、`tests/baseline.test.mjs` | 合成输入、手算预期与异常回归 |

共用 runtime 的源码在仓库 `plugins/optional-api-v1/scripts/abu-runtime.mjs` 维护，以 `sync-abu-runtime.mjs --check/--write` 核验或同步。安装包只导入自己的副本，不相对引用其它插件；公式只在本包 baseline 修改。`implementation_sha256` 继续包含原算法和 runtime 字节，既有固定成果不会重绑。

无需额外配置、API Key 或账户连接；计算参数仍是本次输入，不能移成全局配置。已有固定输入和输出由宿主资源接口管理，无私有研究调度器或交易状态。
