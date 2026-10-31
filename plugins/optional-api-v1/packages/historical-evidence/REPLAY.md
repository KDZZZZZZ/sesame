# 明确标记的历史回放

`origin:"historical_replay"` 处理今天在真实历史资料上重算的预测分数。它不是当时公开的原始预测日志，不能改变时间字段来冒充原记录；仅允许 `plan.mode:"exploratory"`，不提供当前 `calibrated_probability` 或可用 `calibrated_grid`。返回的拟合诊断映射、Brier、可靠性、基线和分组结果只说明这次**时间分割回放评价**。

未提供 origin，或 `origin:"recorded_prediction"`，仍执行原始记录的严格可得时间检查。一次调用不能混合两类记录。回放例子 [calibration-replay.json](examples/calibration-replay.json) 是标明合成的软件输入，不是真实行情或可直接套用的实盘证据。

## 时间和来源契约

每条回放记录在原 calibration 结构上明确添加 `origin`、`decision_at`、`replay`。固定目标 horizon 和二元 label 的原规则保持不变。

| 字段 | 回放中的真实含义 |
| --- | --- |
| `plan.frozen_at` | 今天实际固定方法、阈值、切分的时间，不能回填旧日期 |
| `at`、`decision_at` | 相同的历史虚拟决策时点，明确不是今天执行时间 |
| `prediction_available_at` | 今天实际生成/发布这条回放分数的时间，必须不早于 generated_at、不晚于 as_of |
| `replay.generated_at` | 今天实际执行时间，不早于真实计划冻结，晚于历史决策、不晚于 as_of |
| `regime_available_at` | 此明确回放类型下条件定义使用的虚拟信息截止，不晚于历史决策 |
| `model_trained_through` | 此明确回放类型下训练数据的虚拟最大截止，不是宣称模型当时实际运行 |
| `replay.feature_cutoff` | 用于分数/条件的特征所依赖数据的最大虚拟信息时点，不能晚于历史决策 |
| `replay.training_label_cutoff` | 训练标签已到期且按回放信息时钟可知的最大截止，不能晚于历史决策；model_trained_through不得晚于这两个cutoff |
| `outcome.end_at` | 历史目标窗口结束，严格等于 at+horizon |
| `outcome.available_at` | 本次实际获得/观察该结果的时间，例如今天下载历史快照的时间，不回填为历史时点 |
| `replay.outcome_available_at` | 明确的虚拟结果可知时点，不早于窗口结束、不晚于实际观察；用于历史 fit_end 切分，不能假定尚未到期的标签已知 |
| `replay.code_ref`、`replay.data_refs` | 本次真实固定的回放代码和输入快照完整 DataRefs；代码可作为 json-rows 的代码正文/版本/摘要记录保存 |
| `replay.source_vintage` | 固定为 `current_snapshot_not_point_in_time`，不冒充当年数据版本 |
| `prediction_ref` | 今天真正发布的回放分数日志 DataRef，不能伪装历史发布成果 |

`replay` 的七个字段均必填。所有代码、输入快照、预测日志、计划和来源引用均须在固定输入包 `manifest.dependencies` 中声明；refs入口验证它们与输入内容的绑定。它只读取固定输入包，不自动执行代码或下载行情。inline入口不解引用；两种入口都只核对声明的截止一致性，不能替调用方证明回放程序没有看未来。

## 实际演练顺序

1. 下载公开历史原始响应，保存原字节、URL、实际获取时间和SHA256；把原始观察及真实元数据发布为固定DataRef。不要将最新下载当成当年的修订版本。
2. 真实固定本次代码/方法、用户要求、窗口、条件定义、训练与评价切分。每个历史决策只读取该虚拟时点前的输入；特征尺度只能来自先前训练前缀，不用全历史拟合。训练标签须已经完成其目标窗口。
3. 滚动前推生成每条原分数，保留真实今天的生成时间、各prefix cutoff和代码/资料引用。评价结果不参与原分数生成。原始前推训练与后续校准拟合是两层不同的训练，不能把校准评价标签回流任一层。
4. 在先前一段回放分数/标签拟合isotonic，仅在更晚、窗口隔离的一段回放评价；同品种/条件组分别给实际样本数、Brier、基线、可靠性、反例与不足。方法今天才选定，因而仍不是独立于方法选择的验证。
5. 报告称“真实历史行情上的时间分割回放”，保留当前概率为空以及当时发布预测日志的缺口。探索性结果可以支持条件使用或新假设，不能改称预注册或真实前瞻实测。

advisory/required样本政策、去重叠、支持域检查、固定Refs完整性和原始记录分支的时序要求均不因回放类型放宽。成熟标签为零或必要变化不足时仍不计算校准结论。

## 历史查询的匹配回放（1.1.1）

`historical_evidence_match` 也接受显式历史回放，完整合成输入见 [match-replay.json](examples/match-replay.json)。此处 `origin` 在顶层声明，因为一个请求只有一个历史 query；整批案例不能混用原始观察和回放时钟。省略 origin 或使用 `recorded_observation`，继续要求计划实际冻结在 query.at 之前，不接收下面的 replay 字段。

- 顶层 `origin:"historical_replay"`，`plan.mode:"exploratory"`；原 `plan.frozen_at` 保留真实计划日期，`query.at` 保留原历史决策日期。近期范围和结果成熟性仍相对这个历史 query.at 计算，不能把 query 改成今天来通过检查。
- 顶层 `replay` 必填五项：`generated_at` 是实际生成此回放特征/案例的时间；`observed_at` 是所用固定输入实际观察时间的最大值；`code_ref`、`data_refs` 是实际固定的代码和输入引用；`source_vintage` 为 `current_snapshot_not_point_in_time`。实际生成不得早于计划冻结或输入观察，必须晚于历史 query.at，且不晚于 as_of。
- `query.replay.feature_cutoff` 是查询特征及条件依赖的最大虚拟信息截止，不得晚于 query.at；所有 query.features 的 available_at 和 regime_available_at 也不得晚于此 cutoff。
- 每个 case 必填 `replay:{feature_cutoff,outcome_available_at}`。前者不晚于该 case.at；后者是虚拟结果可知时间，不早于 outcome.end_at、不晚于 query.at，也不晚于结果实际观察时间。`outcome.end_at` 仍严格等于 case.at + 固定 horizon。
- case 的 `outcome.available_at` 保留真实观察时间，不回填为虚拟结束日期；不得晚于顶层 observed_at 和生成时间。原 features.available_at、regime_available_at 在这个显式回放分支内表示虚拟前缀截止；顶层真实生成时间说明这些特征实际何时计算。未知/未来特征、未到期结果或时间不一致仍排除，不补为零。

返回 `observation_origin`、`evaluation_basis`、完整 `replay` 和 `clock`。每个匹配样本分别保留实际 `outcome_observed_at` 和 `virtual_outcome_available_at`。筛选、距离、排序、重叠排除、基线和样本不足政策沿用原算法，不重新选特征、阈值或窗口；`forecast_probability` 始终为空。今日固定的事后方法不是当时已执行，也不是独立于方法选择的验证。

固定 Ref 入口还要求顶层 replay 的代码/数据引用出现在输入包直接 dependencies 中，连同原计划、来源和逐案例来源一并核对；不降低 manifest、内容字节、分页、producer 和完整引用检查。inline 入口仍不访问宿主，不执行所引用代码；两者都不能仅凭声明证明回放程序没看未来。

时间解析保持毫秒精度契约。原来源若是微秒时间，不改原记录或固定 Ref：可在新的适配输入中向上取整到下一毫秒，并单独保留原值、精度差和比较边界检查。例如 `.415389+00:00` 转为 `.416Z` 只是一种保守适配，不是原精确时刻；若取整会越过 as_of/生成/决策等边界，应保留失败并处理精度问题，不能自动放宽截止。
