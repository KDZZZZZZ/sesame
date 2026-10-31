# 历史同类情景与概率校准

本包是独立确定性计算工具，消费固定资料，交出可检查的匹配与校准结果。它不选择投资流派、不搜索行情、不跑 Agent、不生成报告或交易指令。没有账号、密钥、网络或持久配置；参数在每次显式输入的计划中冻结。

| 能力 | 实际输入 | 实际输出与边界 |
| --- | --- | --- |
| `historical_evidence_match` | 完整 inline `cases`、当前 `query`、自选特征/尺度/规则/窗口、固定计划与来源标签 | 三种历史范围、每个条件组的匹配、距离、样本、结果、基线、反例、缺失、扩展原因；经验频率不是校准概率 |
| `historical_evidence_calibrate` | 原固定预测、当时模型训练截止、预测可得时间、成熟标签、真实方法计划与 prospective/exploratory 模式、明确时间切分、当前无标签 queries | 各品种/条件组独立 PAVA 映射、后续分离样本上的 Brier/可靠性/基线；只有原计划及独立评价条件满足才给当前映射概率 |
| `historical_evidence_from_ref` | `{operation:"match"|"calibrate",input_ref:DataRef,operation_id?:string}`，固定 `json-rows` 成果仅包含一行完整输入对象 | 验证确切修订并执行相同算法，将完整原样结果发布成固定 `result_ref`；返回紧凑摘要，声明 `resources.read/create/publish` |

`DataRef` 为 `{id,revision,digest:"sha256:…",kind:"data",schemaVersion:"1.0.0"}`。前两项中的 `source_refs`、`plan.ref` 和 `prediction_ref` 只作来源标签，不解引用；它们只消费传入行，effects 为 `[]`，声明 `researchDataAccess:{schemaVersion:1,reads:"input-only",writes:"derived-artifacts-only"}`。结果为普通 JSON，不发布或删除工件。任何资源读取必须使用第三项；第三项没有 input-only 声明，不能因此获得 Strategy 的隔离留出。

refs 入口要求输入成果 manifest 为 `kind:data`、`format:json-rows`、`rowCount:1`，其 dependencies 包含输入的计划、来源与原预测引用。独立核对 manifest 的规范序列化摘要、唯一内容项、字节数与内容摘要，以及每一分页的固定引用、偏移、长度和总量；最多读取8 MiB。完整结构见 [匹配算例](examples/match.json) 和 [校准算例](examples/calibration.json)。这两份是虚构软件算例，里面的引用为示意标签，不是本机已有成果；实际 refs 调用要使用正式发布返回的真实 DataRefs。

## 完整结果交接

1.1.2 只改固定引用入口的交付；算法标识 `method_version:"1.1.1"`、匹配与校准方法、参数和数值结果保持不变。`result_ref` 是返回首字段，指向 `kind:data / format:json-rows` 的不可变成果；`rows.json` 仅有一行，该行就是完整原结果，包含可靠性分箱、逐行记录、匹配样本、反例、输入身份与完整性验证。`result_data` 给出路径、字节数与内容 SHA256。`summary` 最多列 8 个条件组及主要样本、频率/基线或 Brier；组数超过上限或名称缩短均显式标记，不用摘要替代全集。

下游把完整 `result_ref` 交给下一阶段和报告的来源集合，使用正式 `data_read`（其大小预算内）或分页 `resources.read` 取 JSON，然后在代码中挑选图表所需字段。不要把所有行读回模型，也不要从有界工具预览拼接可靠性曲线。输入与输出都是数据成果，不上传 HTML。固定结果本身不会重复执行匹配或校准。

结果直接依赖原输入 Ref 及其全部明确 dependencies，按完整引用去重；最多 256 个引用，超出就明确失败而不丢失血缘。发布前读取这些固定依赖的 manifest：输入或任一直接依赖为 `demo` 时结果仍是 `demo`，否则为 `derived`；从不标成新的 `observed`。完整输出上限 32 MiB，超出不发布截断数据。

省略 `operation_id` 时，按精确输入引用、操作和交付版本生成稳定发布身份。重试沿用同一个显式 ID 和输入；换输入却重用 ID 会拒绝。宿主资源日志、幂等操作及原子发布/CAS 保证重复调用、并发调用或确认丢失后的恢复返回同一个固定成果，不更新旧修订。显式新操作可另建成果，但不改变方法或统计。没有新增插件状态集合，两个内联能力仍不读取或发布任何资源。

## 时间与选择

全部时间使用带时区的 ISO 时间戳。匹配特征的 `available_at`、条件组的 `regime_available_at` 不能晚于该历史观察的 `at`；结果 `end_at` 必须等于 `at + horizon_seconds`，且 `available_at` 不早于窗口结束。匹配的 `decision_at` 固定等于 `query.at`：结果在该决策时点就须成熟且可得，即使计算快照 `as_of` 更晚也不能使用后来结果。校准记录按 `as_of` 筛查成熟结果，当前 query 还须晚于全部所用评价证据可得时点。未知可得性、未成熟结果、目标窗口不一致都单列排除原因。

1.1.1 匹配支持显式 `origin:"historical_replay"`：今天冻结计划，保留原历史 query.at，以独立的真实生成/观察与虚拟前缀/结果时钟做探索性匹配。必须携固定代码和输入引用；原始观察分支不放宽，当前概率仍为空。字段及精度适配边界见 [REPLAY.md](REPLAY.md)。`distance` 可省略不参与该方法的 tolerance；`rules` 仍必须给明确非负阈值。

`prospective` 要求计划冻结早于保留样本；`exploratory` 允许回顾性找假设，但始终标明探索，不可用已知结果调整特征后宣称前瞻有效。代码只从 `features` 计算距离/规则，不读取结果标签选匹配。输入中声称的历史可得性或预注册日期仍需原来源支持；本包不能证明调用方提供的日期真实。

优先检查同品种近期，再扩大同品种历史，最后考虑明确列出比较条件的其他品种。每个范围都按 `instrument + regime_id` 单列结果，不把不同品种或条件拼成一个平均胜率。跨品种也逐个选择、逐个给基线，同期市场事件不是多份独立支持。用户给出的 `minimum_samples` 是选择范围时的样本目标，未达标仍可保留有条件的描述结论；它不是所有研究合格与否的硬门槛。

## 概率的含义

匹配输出 `empirical_frequency`，同时固定 `forecast_probability:null`、`calibration_status:"not_calibrated"`。当前经验频率可以作为校准入口的一项 query 分数，但校准训练必须是过去同一预测系统真实固定的预测与后来标签，不能把同一批匹配结果伪装成独立预测日志。

校准仅使用 `fit_end` 之前已成熟且已可得的记录拟合，`evaluation_start` 必须在拟合截止及时间间隔之后。`plan.mode:"prospective"` 要求方法、分箱和最小样本条件在 `fit_end` 前就有真正的固定计划记录；`frozen_at`、`prediction_available_at` 等日期来自真实日志和固定引用，**禁止为通过检查而回填虚构旧日期**。今天第一次从历史日志选择方法，或无法确认原方法选择过程，使用 `mode:"exploratory"` 与今天真实冻结时间。它仍计算分离拟合/评价的回顾诊断，但不标为独立于方法选择的验证，不给 `calibrated_grid` 或当前 `calibrated_probability`。已有一段历史日志并不等于历史上预先固定了今天选的方法。

1.1.0另支持明确的 `record.origin:"historical_replay"`：今天在真实历史快照上滚动前推生成分数，保留今天真实生成/可得时间，与历史decision_at/prefix截止分开；代码、资料和回放分数日志均有固定引用。它只能exploratory，输出仅称时间分割回放，当前概率保持null。不能将原记录分支的时间回填为过去来规避限制。完整字段与执行约束见 [REPLAY.md](REPLAY.md)。

评价结果不参与拟合或再调参数；后续调参需另留未查看的未来评价期间。每个品种/条件组独立给出原分数、校准分数和固定拟合期频率基线的 Brier；指标变差也如实保留，不能因没有所有指标同时通过便抹掉适用条件。代码仅核对声明的时间一致性，不能替代核查原始计划和预测日志。

`minimum_fit`、`minimum_evaluation` 默认是 Agent 的 advisory 样本目标。实际至少有2条不重叠拟合记录、两类 label/score 与1条真正分离且可评分的评价记录时，未达建议目标仍可保留点估计，但当前项标为 `status:"limited"` 并给实际 n、目标、适用范围和原因，不能称为可靠或已验证的概率。可选 `sample_policy:{mode:"required",source:"user",reason:"用户明确提出的原因"}` 才会将自定 minimum 变成硬要求；Agent 自选阈值不能声明 required。用户硬要求未达时保留诊断但不给当前概率，不能为得到输出自动降低数值或改成 advisory；更改须来自用户授权的新固定计划。省略 sample_policy 等于 `advisory/agent`。

`current_predictions` 没有 label 字段，其 ID 不能复用任何历史拟合/评价记录 ID。满足条件时输出当前映射后的 `calibrated_probability`；探索模式、结构性训练变化不足、没有独立可评分记录、用户硬要求未达或超出训练分数支持域时返回 null 与具体原因。用户可明确选择域外裁剪，此时保留 `clipped:true`。固定计划保存原 sample_policy 和目标，回执另给解析后的规则与实际样本；本工具不认证调用方自称的用户来源。

Wilson 区间描述样本事件频率；评价分箱区间描述该分箱的观察事件率，**不是当前单个预测参数的置信区间**。后者没有计算，返回 null 和原因。去重叠后的数量也不能称为已证明独立的有效样本数。

## 与 Research、Strategy 配合

Research 明确选择本包后，取证阶段准备固定输入包，分析阶段调用 refs 入口并将返回的 `result_ref` 加入 `evidence_refs`；后续阶段直接读取固定结果，工具摘要只供判断方向。报告只展示算出的结果、适用条件、反例与监测要求，不从 Report 字段推导算法。

```json
{
  "research": {
    "plugins": ["sesame/historical-evidence"],
    "tools": ["sesame/historical-evidence#historical_evidence_from_ref"]
  },
  "evidence_refs": ["替换为真实完整固定输入DataRef对象"]
}
```

上段仅展示 Research 选择位置，字符串占位必须替换为完整 DataRef，不能原样调用。Strategy 的 restricted 研究角色只选前两项、只传工作流已裁剪的开发行；最终 evaluator 与隔离留出不因使用本包改变。用户要求优先，适用条件、失效条件和监测均由输入计划明确记录，不设置固定流派或默认胜率门槛。

## 验证

`node --test tests/*.test.js` 执行独立数学与时间边界回归。仓库 `plugins/optional-api-v1/tests/historical-evidence-host.test.mjs` 使用隔离 Store/Runtime 实际安装与调用；不接触日常安装、凭据、网络或真实模型。理论依据和原创代码边界见 [PROVENANCE](PROVENANCE.md)。
