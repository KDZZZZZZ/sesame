# UI → 主协调者 / CORE：公开 0.2.2 receiver 差异

这次是原 UI 会话继续 Run；原固定开发交付 `artifact_766b7a8c-b853-4efb-81ed-7bd239798949 / revision_2bf85f87-6e19-4f70-9ee9-bccd27b7cd34 / sha256:2d97c681f6bf36d7b7f90521613c5177ba48c810749e35b4210cbc2ab7fc8aac` 已读取。它不是投资周报或 SDK 证明。

权威公开契约纠偏已消费：`verification/round2-native-public-receipt-contract-review.json`，完整 sha256:8e93b170e04bf6339638ba5e57ed990b2b895d92d44880b4768a0fae92633552；CORE-CLOCK-HANDOFF 尾部旧第4项所称 script raw visible keys 不是实际公开字段，以此次用户纠偏为准。

## 所有权
只写 `replay-presentation.js`、`providers.js`、新增 `presentation-receipts.js`、`weekly-reports.js`、对应 UI tests/docs。没有修改 service/driver/clock/warmup/native/main-chat/index/tools/manifest，没有正式安装/更新草稿，没有启角色、周报模型或清理 recorders/首轮材料。只加载既有 dev.4 的会话可用工具，不更换全局运行版本。未创建下级或重复 UI 任务。

## 四个 receiver

1. `consumedBars` 接收 CORE 已写出的真源闭合 H1 `sourceKind: observed_native_h1_preheat_not_execution_ticks`。保留 Decimal OHLC、sourceRefs/sourceDigest/sourceResolution；lastConsumedTick 与 consumedCount 是 null，另有 unknown 状态理由。禁止 UTC(null)、补0、hourEnd-1、OHLC伪tick。H1必须闭合且无execution tick元数据。保留给入的 h1Limitation；provider/weekly 在 CORE 省略时仅匹配已披露同时间 immutable prepared frame 的metadata恢复原说明，不读未来OHLC。真实SMA20仍按现指标已声明 binary64 算法计算，19根不补零。CORE直接写view的初始化 ABI 不变。
2. `onPKBoundary` 的正常4H只认显式 `decisionBoundary===true`；不由第一H1的非continuation推测边界。优先 `context.roleDecision`（真实且在已提交 decisions 中的非continuation）及 `context.decisionBlockFills`，后者必须等于执行时间起、截止之前整个 ledger fill 范围；不完整/异源块拒绝。风险退出仍用新H1的真实suffix触发，正常4H的claims覆盖整块（包括早小时成交）。账户/市场/事件均同cutoff，未来quote/financial/decision拒绝。无新增解说inference。
3. `consumePKCommentary` 识别 CORE canonical `public_main_message_acknowledged + nativeMessageRef`，返回相同状态，`publicMessage.level=public_persisted_message_text`。实际公开正文已确认；`nativeVisibility.status=pending`仅指原生客户端可见性另验，不触发再次delivery/模型，也不因只认displayed阻塞consumer。整个main audience运行pending接受canonical ack；不把正文存储当像素证明。
4. 下述runtime/report契约内置receiver，不需要不存在的selectors。

## chart 程序 ABI（新增纯接收器）
`presentationGate` 保留 `raw={inspect: host.layout.inspect(), script: await host.layout.script(read)}`。script仅descriptor/source，不能索要rendered/layoutVersion/evidence/point keys。前后inspect同版本、当前chart binding/script_ids中准确instance、scripts中固定artifact，再匹配inspect.rendering的同版本target chart rendered。宿主确给instance.generation时保存并比对；缺generation如实返回 `chart_runtime_exact_mount_generation_unavailable`。receipt不含instance/generation时明确其不可用，不编原始字段。失败/错chart/旧version/绑定race不通过。全raw归档到 `audience/<run>/chart-runtime-<hash>.json`。

兼容 `verifyClientReceipt(raw,expected,signal)` 扩展：现在raw是上述inspect+script组合；旧CORE selectors不能使用script作renderer依据。内置实际契约结果不被旧mapping永久pending覆盖，extension另列诊断，也不能声称像素visible。source keys与本地pure indicator calculation keys被保留为program证据。

comparison.status可为 `program_evidence_ready`（非rendered）；runtimeStatus单列，`visibleComparison=false` 和 nativeVisibility=pending。不再用缺失visible keys永久阻塞运行pending。**主协调者必须另做真实同图原作区间+实际fill/stop的原生前端像素检查；source/calculation/runtime不取代它。** 首次尚无成交不是接收失败，更不能造fill满足图例。

## weekly native confirmation ABI
`consumeNativeWeeklyReports` 主会话直接读 **host.artifacts.receipts(job.reportRef)**，无需openNativeReport；用户正常点击原生卡片/页面即可。仅确切artifact且renderer.name='sesame-report'且status='rendered'的原始公开receipt确认native page；sesame-report-inspector一律不算native打开。实际viewInstanceId/observedAt保留，原始raw不添加operationId/asOf/evidence。

proof的 `derivedBinding={jobId,ref,inputRef,outputRef,period,inputDigest,bindingKind:'derived_from_frozen_job_not_rawreceipt'}` 来自已sealed固定job，不从rawreceipt猜。job.inputDigest、publication/ref一致性保持严格；完整raw和绑定分别归档成功后才nativeUiStatus='opened'。原opening/unknown的虚拟op状态允许实际read恢复，不重开、不重付费。旧报告可被确认，但返回synchronized=false，不能把旧截止解释成当前行情。像素层另列pending。

`reconcileNativeWeeklyUI`只接受同原生receipt契约，不接受旧verify伪造opened；先存 `receipt_observed_archive_pending`，下一consumer全raw归档后才opened，避免CORE release跳过归档。

## 请 CORE 自己完成的共享接线点（未抢写）
- main-audience-driver configure/pump的native_report_bridge及client_receipt_contract旧selectors已无必要；移除对不存在opener/operation/asOf/evidence/visible-key字段的要求，直接复用上述receiver，保留真实raw归档。
- release继续检查真正sealed周报和nativeUiStatus='opened'以及canonical public正文ack；SDK/frontend/pixel验收状态独立保存在主验收材料。不能只改措辞宣称完成。
- warmup-h1可把prepared frame的原始h1Limitation复制到bar（当前provider和weekly都有同截止metadata-only原文fallback；CORE自身canonical view仍建议直接保留，缺真实原文时不编造原文）。
- 两种自动UTC generationTrigger命名当前分别为 `automatic_committed_utc_week` 与driver的 `automatic_held_utc_week`；请CORE让frozen job真实记录同一自动UTC来源或更新明确验收契约，不把手工/final partial伪作自动周报。UI本次不改变真实触发证明。

## 主验收与禁止事项
用户当前已明确授权：稳定接线后由主Agent公开 validate/test/update/inspect/load、隔离新安装/重载及有界第二轮体验短测；不再等“后续允许”。我只交接UI实现，不执行正式管理。首轮complete v495 / 311576.78095JPY和旧链不动；新实验300000JPY/50x全章/4H/openai gpt-6.1-sol，同历史知情重放，原作区间对真实本轮fills。真实UTC周报、主chatPK解说和全留档必须实际验。327CHF缺口继续strict/no interpolation，代表第一章无需先补全。五效果通过后在提交决定边界暂停，保存checkpoint/open position，不强制平仓。连续connection failure保存检查点暂停，未知请求不盲重发。

## 回归口径
新名称verification/private证据保留完整源码、stdin（测试固定fixture代码）、stdout/stderr、冻结真实v495 engine及订单映射输入sha、源前后hash。回归清楚分类为公开shape/隔离程序/冻结真实ledger适配器；不是SDK或原生pixel。旧58/58是CORE原隔离native/synthetic+SQLite回归，不能搬作本次真实SDK证明。正式主验收仍须实际端口/renderer和native页面/像素。
