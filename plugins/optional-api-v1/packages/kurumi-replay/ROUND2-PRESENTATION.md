# 继续Run权威更新：UI public 0.2.2 receivers

最新交付与接口差异见 `UI-PUBLIC022-RECEIVER-HANDOFF.md`。它替代下方旧交付中关于script raw visible keys、报告opener/operationId/asOf/evidence字段以及“后续才允许主Agent验收”的假设。用户现已授权主Agent正式公开validate/test/update/inspect/load和真实有界短测；UI不执行安装或模型调用。

四个receiver已修：真源闭合H1预热保留null/unknown tick元数据和原始H1 limitation；正常4H PK整块真实roleDecision/fills；canonical公开正文ack和native客户端可见性分离；inspect chart runtime与artifacts.receipts native-report page分别接收真实字段。source/calculation keys只能证明本地程序，不是像素比较。

**下面保留的旧说明仅供历史追溯，不是当前验收契约。** 首轮/financial/fills/327CHF strict保护不变；原生像素、正式SDK、真实UTC周报模型仍须主协调者实际验收。

---

# 第二轮展示与周报接线（独立草稿，中文）

状态：实现源与孤立fixture正在验收；**未安装、未加载、未调用角色/周报付费模型、未作当前SDK布局变更、未获真实client rendered回执**。正式dev.4与第一轮存储/环境不在本任务修改范围。当前SDK/client及原生50x验收均pending，由主Agent未来授权验收。

## 文件所有权与公开hook

本UI分支只改 providers.js、markers.js、report.js、新 replay-presentation.js、weekly-reports.js、analysis-plan.js、tests/round2-presentation*.test.mjs、tests/weekly*.test.mjs、本文。不改 service/index/tools/engine/native/profile/lifecycle。CORE必须逐层 await：

```js
await onReplayCommitted(host, service, context, signal);
await onWeeklyBoundary(host, service, weeklyContext, signal);
// 只有这两步持久化成功，才 emit market/account subscriptions，并允许下一H1。
// 模型生成不在上述hook内，后续授权worker才显式 drainWeeklyQueue。
```

默认context={engine, previousEngine, consumedTicks?, chapterEnded?, terminal?, runId, replayCutoffMs}。额外展示字段：chartId（仅主会话的明确观众图）、markerFromMs（有界窗口，超预算报错不丢标记）、eventEvidence（真实actor任务/证据映射）、verifyClientReceipt（匹配新SDK的真实回执核验器）。service host不可调用layout；hook会持久化todo，主会话显式重接后刷新。导出`await refreshReplayAudience(mainHost,service,{chartId,markerFromMs?,eventEvidence?,verifyClientReceipt?},signal)`供真实display/tool消费持久todo；它不启动模型或注入主会话。mount/unchanged后仅在版本截止仍匹配时清needsMainRefresh，client gate原始pending另存。不可通过虚构beforeMessage请求启动模型。

## consumed-tick bridge（不是lastQuote或H1 OHLC拟造）

已读dev.4真实路径：native-engine.py把消费前缀保存到engine.nativeJournal；native-engine.js把inline ticks改成不可变ticksRef{path,digest,rowCount,bytes,sourceTimeBasis}。终止小时保存的是消费前缀，不能拿advance输入的整个quoteTicks切片代替。

CORE在原子H1提交后：
1. 对previousEngine→engine核对一次version+1且nativeJournal长度+1；取实际追加的最后step，按原native规则检查owned steps路径/regular file/no symlink后只读ticksRef bytes。**本展示模块不读私有路径、不猜位置**。
2. `batchFromCommittedJournal(engine, previousEngine, step, bytes)`额外校验digest/bytes/count；输出batch{batchId,runId,commitVersion,chapter,symbol,from,toExclusive,cutoffMs,sequenceStart:0,intervalComplete,rows,sourceRefs,sourceDigest}。
3. 完成小时cutoffMs=step.to，bankrupt小时cutoffMs=最后实际消费tick.time、intervalComplete=false；`onReplayCommitted`接收batch做CAS持久化。仅lastQuote时返回CONSUMED_TICKS_REQUIRED，不声称已构造完整forming。
4. 若CORE提供真实消费中增量，只能从消费循环追加已消费tick，sequenceStart=已消费数量；batchId固定且不可复用不同内容，cutoff不能回退。它不是计时器插值，也不改变交易节奏。完整H1可原子提交多个实际前缀供播放，但时间推进仍需CORE明确许可；本任务未实现/声称tick级推送已接线。
5. service增加公开`getReplayPresentation(){ return readConsumedView(this.host,this.getState().id); }`，用于providers/markers/report同一提交版本读取；第二轮显式`presentationEnabled=true`或profile.round=2。provider核对view.commitVersion==engine.version，不允许新账户+旧行情混称atomic。新run初始化不得复用旧view/supplement；warmup如需显示也须另行提供真实已消费历史tick，不直接使用全未来H1 OHLC。

`reduceConsumedTicks`从实际bid/ask形成同一柱修订与独立cutoff；形成柱endTime是予定H1结束而非已知截止，真实截止保留native.revealedThrough/lastConsumedTick。closed只由intervalComplete与精确边界共同决定。tick数不是real volume，未知volume不补零。仅lastQuote没有高低开闭路径，不制造假OHLC。327早期CHFJPY缺口不变；CHFJPY本身没有桥数据时返回缺数据/不完整，绝不推算。

## 标记与真实指标

每次原子H1刷新一份有界不可变indicator artifact，并替换该图当前真实宿主实例。重复同状态不重新挂载，lost reply按完全相同ArtifactRef恢复；用户锁/删图/换绑定只留pending，不自动夺回布局。绑定必须来自现有provider发现流程，hook不建立第二broker。

原作素材仍只来自markers.js ORIGINAL_REFERENCES与附件digest。attachment_claim、fitted、calculated、事件锚分别声明，未知成交时点留区间。原作release=chapter_complete/window_end，不能提前泄漏结局；所有原作内容只给spectator，不传role DTO/allowlist。演员=Kurumi-original vs Sesame真实模拟动作，没有第二付费角色和漫画账本。

真实fills附actor/ledger/order/nativeEvent证据；决定/订单/风险退出/仓位标记是有证据的状态事件，不能再算一次成交。无成交周明确显示零成交。typed marker只用circle/arrow_up/arrow_down与公开position，不发明矩形/区间遮罩。事件真实时刻留在文本，H1显示锚不是成交时刻。实际fill价格与精确时间保持Decimal/UTC。

同一typed indicator还真正计算消耗价格line与SMA20（forming include，binary64、保留12dp显示）；无20柱预热不补零。此方法是本包明示公式，**不是已采用technical-analysis-theory或ICT证明**。

`presentationGate`通过public layout.inspect + await layout.script(read)读取当前artifact/实例/generation的原始信息。未提供匹配SDK verifier则pending。CORE核验器必须对真实最近client回执逐项核对chart/instance/artifact/generation/layout；返回rendered须附证据。fixture的view或test通过不能成为真实屏幕验收。

## 周界冻输入与财务口径

每章起点（首次已揭示账户）、每H1、章settlement及terminal调用onWeeklyBoundary。增加weeklyContext字段：
- account={engineVersion,asOfMs,balance,equity,unrealizedJpy,margin,freeMargin,quoteTimeMs?}：由同一已提交引擎公开snapshot提供，金额Decimal string，未知用{status:'unknown',reason}；asOfMs为披露截止，实际quoteTimeMs独立。
- market=同cutoff的readConsumedView；不传则hook读自己持久视图。
- chapter=刚结算的旧章（engine已经跨章时传旧章、旧章settlement snapshot），engine必须保留实际全部已揭示ledger但positions/account是旧章结算截止的真实状态；不能用下一章新报价或reset后的观察。
- openingContext：如第一次hook已在第一H1之后，要给真实章起点固定snapshot；否则第一hook自身是起始snapshot。**不能回头拿当前余额补造周初**。
- boundarySnapshots：真实周界snapshot列表；周末缺交易hour跨过UTC周界时，须在未来第一tick之前冻结上一周account/positions等，不能拿周一费用和新仓位回填。缺snapshot报BOUNDARY_SNAPSHOT_REQUIRED保留pending，绝不静默混入 later data。
- methods：计划/实际采用记录（采用须含精确plugin/version/method/inputRefs/outputRef）；roleEvidence是真实只截止的actor证据；originalComparison仅buildMarkerSnapshot已释放观众rows。
- sourceCoverage：保留327 unresolved gate、strict60s FX、新run重绑要求；不宣称全章数据完整。

UTC周从周一00:00开始。按章独立cursor，initialPartial/finalPartial分别标注，末章不足周与终止小时都可freeze。财政：逐行Decimal余额=开账余额+realized−commission−financing，fill costs/PnL与monetary ledger精确相等；权益、未实现、保证金各单列；drawdown为已提交H1/实际消费标记的观测回撤，不宣称逐tick最大值。不造原作总资产。

## 幂等、CAS、恢复与生成

存储独立round2-presentation/round2-weekly collections，get(...,true)用于首启，transaction内revision CAS；key含runId/章/UTC起止。输入先完整存入持久record，再要求archiveFileSafe成功回执，再publish固定json-rows DataRef。缺recorder返回null同样失败，不静默丢输出。CORE让archive失败阻断后续付费角色/下一H1，不能吞hook异常。

周报状态：input_frozen → queued → submitting → submitted(agents)/output_saved(inference) → publishing → sealed。input_archive_failed/output_archive_failed/publish_failed保留原始输入/完整输出，可恢复；unknown/failed/interrupted/cancelled不自动重付费。submitting进程丢失/回复未知→unknown，不能重发inference（requestId本身不幂等）。`reconcileWeeklyOutput`只凭现有request的公开真实证据补齐，不发模型/交易。

`drainWeeklyQueue(host,service,{authorizeGeneration:true,model,transport:'inference'|'agents',...},signal)`是后续验收授权worker；queue hook从不调用。真实模型描述符必须与host.inference.models完全一致。
- inference：一次自由中文正文，保存整个result含text/usage/inputDigest/model；完整输入受真实1MiB预算，超出报错须显式分区，不能截断。
- agents：公开submit/inspect/wait/cancel，固定input与no player/tools:[]，40KB真实预算。必须提供`collectFullAgentOutput(taskId,waitResult,signal)`并从公开持久final artifact/refs收集全输出；summary不算完整。返回{complete:true,output,artifactRefs}。无collector不提交。等待取消需显式cancel，未知保留；本任务不编造host全量输出export字段。

报告自由表达，不限制Agent观点/叙事/可视化选择；baseline financial/evidence另外绑定完整固定数据。HTML沿用assets/editorial.css/report-kit.js、reportKit.render/rows/track；全文用textContent防注入。每份full-output、request、input、HTML、artifactrefs/receipt全部归档。inspect真实receipt失败/待定不改称rendered；sealed表示完整保存，不代表屏幕可见验收通过。

## 分析计划与交付门槛

analysis-plan.js保存2026-10-12实际查询目录digest与精确固定price-action/ICT/institutional/narrative/strategy-authoring/Backtrader/vnpy版本、源commit/treeDigest。当前只是proposed，正式安装/采用必须后续授权。Backtrader/vnpy可发现ready不代表本轮已运行；technical-analysis-theory0.1.0实际安装记录无效、failed，不激活/不修复/不称采用。verifyMethodUse需真实成功调用receipt和可读固定input/output，否则拒绝。

pending：CORE真实消费前缀路径resolver/H1与章终hook/初始bootstrap；matching SDK真实storage往返与CAS；native50x；动态client generation rendered；真实周报模型和完整公开Agent输出收集；新玩家无外部Movie私有路径安装；327 FX覆盖；终态第一轮全归档门槛。fixture只覆盖实现逻辑，不代替以上验收。


## 完成后的孤立验证（非前端验收）

最终执行日志位于 ../private/round2-presentation-final-tests-v6.log：公开typed indicator schema只读核对、真实本包代码fixture、legacy回归；两个opt-in SDK/production frontend测试明确skip，并不计为通过。另 ../private/round2-presentation-core-integration-v4.log 为CORE新接线模块与真实Recorder独立目录fixture，未运行匹配引擎/真实SDK/client/付费模型。

CORE已在本独立副本提供committed-hooks持久outbox、consumedInterval的owned-file resolver、getReplayPresentation和逐层await H1/周界调用；其孤立接线测试通过。**这仅说明模块接线逻辑可用，不证明正式加载、真实tick级观看或原生client验收已完成。** 早期新run预热、周末跨UTC周界boundarySnapshots及主会话chart/todo消费者仍须未来验收接线；缺少精确snapshot时会暂停，不使用下一周数据回填。

动态刷新改用固定json-rows marker DataRef输入+有界纯compute代码，完整事件/actor/evidence不再随静态代码字数被截断。首次put无script_id，后续替换/重复/删图/丢失memo/lost reply保持真实单实例或明确pending。全章marker dataset超过预算时明确失败需指定窗口，不默删账本。

周报可传`renderWeeklyHTML(frozenInput, fullOutput, signal)`返回{html,assets:[{path,mediaType,content}]}，Agent可自由编写自定义HTML/图表/布局。返回内容先完整存入job.authoredPresentation，所有必需财务和完整输出DataRef仍作为weekly/agent-output绑定固定；完整HTML/资产归档、inspect实际回执。默认无callback时沿用Sesame reportKit骨架。自由表达不等于可访问当前行情；真实前端验收要核对必需财务与证据确实可见。稳定publication+receipt在final archive前CAS保存，archive lost reply不会产生第二模型或改变已归档receipt。Agent全输出artifactRefs随DataRef/report dependencies固定，summary alone不算complete。

正式dev.4三份原文件hash与开发前公开读取hash复核一致；不检查/干预第一轮实时进度，也不声称其账户因本任务停止变化。用户任务边界的0次正式控制/0次付费生成/0次broker/0次draft加载安装声明指本任务实际调用范围，非其它Agent正在运行的全局活动。


## 最新范围更新（有界原生体验）

旧67项/完整三章计划由ROUND2-NATIVE-EXPERIENCE.md及verification/round2-presentation-experience-acceptance.json替代。最新UI/legacy回归78项：76 pass、0 fail、2 SDK/frontend skip；CORE最后一轮6项：5 pass、1结算snapshot失败（其所有权保留，未修改）。主Agent须核对正式native回执与fresh50x/working native cache；不得把mock或旧日志当上屏证据。新增PK/main交付与native report消费者、消费prefix checkpoint、CORE spectator projection以及bounded_partial UTC阶段报告接口均已测试；两个解说实现不得双调用。


最新账户补充已消费：nativeClientOrderId分组与明确parentDecision/source links；真实固定58fills/66ledger、空仓、124 monetary history保留并断言engine完整bytes hash不变，all/working与完整订阅无错误。最新回归80项78pass/0fail/2 SDK/client skip；CORE最新版独立联调6/6（其负责人已修早前快照问题，UI未改CORE），旧76和5/6只是历史日志。正式原生5效果仍pending。


严格gate最新：真实自动UTC周界不可用partial/manual替代；正常非破产forming与20真源形状warmup/SMA/闭合subscription新增测试；同图诚实原作候选区间+实际stop非空；main复用coordinator及claim/full-output/真实ack receiver；request<=28KB synopsis、完整inputRefs/archives另存、周一事件严格排除旧周；7来源身份已同步全部proposed_not_adopted。最新86项84pass/0fail/2真实SDK/client skip、CORE6/6；只是孤立测试。CORE main handler/Skill/automatic trigger/warmup producer/真实message契约接线未实证之前，不可开始正式安装验收。


本Run一次性ABI/mainchat补充已消费：nativeOrderTrace actual producer标准DTO已对齐并按eventCount/time前缀过滤，同毫秒future取消不泄漏，0 fills仍显示actual accepted protective stop，nativeStatus原值/cumulative filled guard保留。CORE actual tasks/messages normal-response claim/append-boundary/ack路线由CORE wiring，UI额外PK inference已disabled，不等writer。最新87项85pass/0fail/2 SDK/client skip，CORE新7/7（都孤立fixture，非native可见）；旧ledger不变。本补充不新建Run/任务链、不启模型/安装/停recorders。
