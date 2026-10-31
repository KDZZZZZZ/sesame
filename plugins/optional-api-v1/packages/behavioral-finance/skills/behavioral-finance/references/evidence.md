# 证据、时间与产出

这是本技能的研究记录约定，不是新的 Sesame 合同、SVL 类型或提供方接口。

## 开始前

记录问题、资产/来源身份、截止时刻、价格基础（bid/ask/last 等）、复权/交易时段、币种和量的单位。市场数据的 `SourceTime` 按原样保存：wall 时钟不要加 Z 或猜偏移；UTC 与未知 broker clock 不可直接排序。`coverage.complete:false` 不能写成完整历史；缺量是 null，tick count 不等于成交手数。

材料可以是 observed/derived/user_input/demo。固定行情 DataRef 含 `id/revision/digest/kind/schemaVersion`，同时保留原始响应 `raw`。网页文献保留精确 URL、标题、作者/机构、发布与访问日期、短摘录/页码定位；网页快照需按现有来源/报告工具保存，禁止编造 ArtifactRef。

## 证据台账最小列

`evidence_id`、`claim_or_observation`、`value_and_unit`、`source_reference`、`event_time`、`available_at`、`retrieved_at`、`vintage_or_revision`、`source_cluster`、`eligible_at_cutoff`、`limitations`。没有时间写 unknown 并解释，不能以采集时间冒充原始发布时间。截止后材料可在后验附录讨论，但不得加入事前特征。

对“超预期”先找截止前留存的预期分布、调查或合约口径。实际值减前值并不等于实际值减预期。FRED/ALFRED 官方 real-time period 区分现在所知历史与当时版本；日期级 vintage 仍未证明盘中某秒已经可得。[官方说明](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html)

## 本方法内的竞争性解释表

每行填写：机制名称；支持/反对的 evidence IDs；传导中间环节；最强替代解释；尚不能观察的变量；可区分的后续测量；明确反证；适用期限。不能把“数据不反对”写成“支持”。控制窗口/样本的选择需在看结果前固定或完整披露所有尝试。

## 最小报告

1. 一段回答当前资料能与不能回答什么。
2. 样本和时间版本表；图轴有单位、来源时钟、形成中柱/缺口标识。
3. 本方法内至少两个解释候选/基线对照，明确共同原因和不可识别部分。
4. 有条件的观察计划：触发、更新时间、预期观察、反证与不行动分支。
5. 来源、计算与可复现边界。原始资料不支持的资金流、持仓或因果效应保持未知。

在可选 judgment 插件创建判断时，保留其正式 outcome/复核流程；本指南不创建另一个判断账本。无统计执行的纯解释报告可引用资料，不伪造 execution_id。示例中的 demo 证据不得换标题冒充真实调查。
