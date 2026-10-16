# 继续Run权威更新：UI public 0.2.2 receivers

最新交付与接口差异见 `UI-PUBLIC022-RECEIVER-HANDOFF.md`。它替代下方旧交付中关于script raw visible keys、报告opener/operationId/asOf/evidence字段以及“后续才允许主Agent验收”的假设。用户现已授权主Agent正式公开validate/test/update/inspect/load和真实有界短测；UI不执行安装或模型调用。

四个receiver已修：真源闭合H1预热保留null/unknown tick元数据和原始H1 limitation；正常4H PK整块真实roleDecision/fills；canonical公开正文ack和native客户端可见性分离；inspect chart runtime与artifacts.receipts native-report page分别接收真实字段。source/calculation keys只能证明本地程序，不是像素比较。

**下面保留的旧说明仅供历史追溯，不是当前验收契约。** 首轮/financial/fills/327CHF strict保护不变；原生像素、正式SDK、真实UTC周报模型仍须主协调者实际验收。

---

# 有界原生沉浸式PK体验：可移植入口与真实验收门槛

## 范围与事实

本版目标不是跑完第二轮三章，而是新玩家安装后在**代表性第一章AUDJPY**看到五种原生效果，完成后在真实已提交决定边界暂停。第一章无CHF转换要求；327处早期CHFJPY缺口不必为本次短片段补齐，若将来进入第三章仍严格60秒缺数据暂停。同历史重放不是样本外，模型预训练记忆不能排除；没有前瞻已验证专属规则。

最新用户提供并在orchestration中记录：旧第一轮终态空仓v495、494H、58fills、余额/权益311576.78095 JPY，已export/seal。本任务只读取固定归档作适配测试，没有改旧ledger，也没有正式安装草稿、调用角色/周报/解说付费模型或改当前图表。

## 玩家入口（主Agent将其写入正式可移植Skill，非一次性私有聊天）

可复制请求：
> 在原生工作台带我做一个第一章的有界50x PK体验：真实账户、消费tick形成中的K线和实时指标、原作久留美区间对照、自动首份UTC周报与主Agent解说。五项真实可见后在决定边界暂停，不跑完三章。

可重复流程：
1. 公共插件生命周期安装固定包 → 检查真实runtime_status/diagnostics → 加载Skill。包不含作者Movie路径、用户录制账本、数据库副本或模型密钥。
2. 只读发现当前Python/native engine/模型描述符/行情与账户provider；复用已存在依赖。缺失时由已声明prepare工具准备到host.storage.directory自有环境，诊断要指出缺包/版本/hash/网络/来源，不能用手工SQL或外部网站代替原生UI。
3. 明确新300000 JPY资金、全章固定50x、独立runId/recording选择及4H交易节奏。旧用户必须经过旧实验终态封存门槛；新玩家不应导入作者第一轮私有账本才能体验50x。
4. 公共品种发现/准确binding → 原生账户页和K线图 → 消费真实已揭示预热tick并挂typed指标。原作仅观众侧，角色allowlist不增加原作/绘图/报告工具。不能以完整future H1 OHLC或本小时终值账户播放早期forming。
5. 显式有界start/continue，必须运行至首个真实UTC周界并自动生成真实周报；初始不足周可明确标注，但manual/bounded_partial/final-partial不得替代本验收。预算提前按实际数据时钟配置，不能只跑默认短阶段就宣称weekly已通过。冻结周界账户/市场/原始事件/方法版本 → 后续授权worker自动生成并完整归档真实模型输出 → 固定DataRef/report refs → 原生报告UI打开与真实可见回执。没有真实输出时不能用测试样例充数。
6. 主Agent从持久PK队列消费同cutoff事实，在自己正常原生聊天里讲PK：真实动作、保证金/止损风险、证据明确的失误、盈亏压力和约66.7倍目标距离。不给每tick发模型，不造对手fill/PnL，不把解说当交易角色。模型/任务身份独立。
7. 五种真实UI证据齐备后到下一已提交决定边界pause，保存所有材料与checkpoint；resume重复命令返回相同结果，不重复模型/成交/周报/标记/消息。不是reset/recharge，也不需要完整第二轮三章。

### 当前公开工具schema的具体缺口（不能写成已经可用）

本草稿已有kurumi_prepare、kurumi_display、kurumi_start/continue/pause、kurumi_archive_terminal、kurumi_new_experiment和kurumi_retry_committed_hooks。start目前仅command_id/expected_version/max_steps；new_experiment目前要求previous_run_id。**fresh玩家首次直接创建50x与有界experience参数需要CORE补齐真实公开入口**，不能给现有start偷偷传不存在的profile_id，也不能让新用户先跑完旧500x第一轮。CORE现已有kurumi_experience(status/configure/arm/record_gate)、kurumi_weekly(status/enable/disable/drain)及kurumi_narration(status/drain)公共入口。有界限额由工具配置；UI adapter/verifier消费者仍需匹配SDK接入，不让用户手写存储。

读过的HostContext没有通用reports.open或main-chat append/injection API，但最新公开review给出了host.tasks.read/host.messages.read自有消息读取路线，不需要writer。本模块提供main消费者和可await的真实public adapter/verifier接线口；若匹配SDK仍无该开放能力，诊断为NATIVE_REPORT_PENDING/原生message proof pending，交由主Agent核对正式接口。**不读私有主会话、不改DOM/SQLite、不发明layout.openReport，不把inspector rendered等同原生报告页已打开。**

## 同一asof的消费路径

### 普通形成中K线，不只terminal小时

`await onConsumedPrefix(host,service,context,signal)`已实现。CORE从真实native消费循环提供**部分engine/account checkpoint**及已消费tick delta；不能把最终小时账户和更早forming图配对。

context增加：
- engine：本消费前缀真实状态，含真实已发生positions/orders/fills/ledger/equity/lastQuote；交易service.getState保持原金融CAS，不被展示模块覆盖。
- account={engineVersion,asOfMs,quoteTimeMs,balance,equity,unrealizedJpy,margin,freeMargin}，与同tick消费截止一致。
- consumedTicks：与onReplayCommitted相同batch字段，但intervalComplete=false、sequenceStart为已消费数量、cutoffMs=实际消费前缀截止，不是未来hour end。
- nativeConsumedProof={kind:'native-consumed-checkpoint',engineDigest,accountDigest,batchDigest}：实际CORE原始进度材料的摘要与来源。此是本包接线契约，不是假称SDK签名/已验收；不能用最终账户反算伪造中间checkpoint。
- `service.emitSpectator()`：CORE连接现有provider subscriptions，不能启动角色/付费模型。

模块自己持久化round2-spectator-checkpoint供market/account provider观众读取，交易/角色DTO不改。forming包含真实已消费bid/ask，价格line/SMA20由公开typed compute实际算；无20柱预热不补零。主会话refreshReplayAudience读取相同观众checkpoint；原子H1最终commit核对消费prefixDigest与真实nativeJournal全前缀，追加未展示suffix并闭合，一次finalize，重复不会再次数tick。只有实际commit清部分checkpoint，主display refresh不清账户前缀。

CORE现另有committed-playback.js及真实native lastPresentationTrace：从已提交实际tick/native mark构造最多8个消费前缀，用getSpectatorState提供部分账户并与独立exact snapshot核对，service emit驱动同asof订阅。本适配已连接该公开service spectator状态和accountSnapshot，兼容其逐delta onReplayCommitted。onConsumedPrefix是另一个直接真实消费checkpoint入口，不强迫CORE放弃已有bridge。二者均不制造lastQuote路径/不拿最终资金配早期图；**真实native执行、SDK订阅、typed client forming上屏仍必须实测，不能以fixture声称已可见**。

### 原生账户订单修复

已读取外部真实baseline/root-cause：不同native open/stop order共享decisionId，旧适配把绝对fill量相加，六组实际案例都大于requested；orders query和完整订阅抛错。

providers现按`nativeClientOrderId + chapter`真实订单身份分组，fills.orderId关联对应投影ID；nativeOrderId/nativeTradeId原值保留，decisionId只是来源关联，不再作成交订单身份。父决定连接明确保存在source.orderMapping的parentDecisionId/queryOrderId与native trace来源链接；内部分组保留parentDecisionIds和执行reason，不给标准SDK订单对象强塞未知字段。旧ledger/trace/决定不改。固定真实第一轮engine的58 fills全部映射58 native订单投影，snapshot/positions/orders/fills/history与完整account订阅的适配调用通过，不是新实盘或SDK UI验收。

**旧ledger只有fills而无完整native order缓存/accepted/cancelled trace**：投影quantity明确为executed fill-backed数量，原requested、未成交working stop、终态原生订单状态未知，不伪造filled/cancelled。nativeStatus/meta.source明确分类，coverage.complete=false。

CORE新增可选nativeOrderTrace公开输入：每条actual nativeClientOrderId、chapter、instrument、time（原生事件源UTCms）、createdAt、side、quantity（真实requested）、remainingQuantity、status、orderType、stopPrice。保留actual accepted/cancelled/rejected/filled事件。若完整缓存/trace有证明，给nativeOrderTraceCoverage={complete:true,engineVersion,asOfMs}；仅数组存在不能证明完整。真实working stop由此显示，不能从position.stop捏一个native order ID。消费prefix checkpoint也须带截止trace。缺trace是可操作数据能力诊断，非SQL修补理由。

## PK公开hook（无私有主会话API）

CORE目前已有独立narration-queue.js；以下是本UI模块更详细claims/固定refs的备选接线口，不要求重复建两个解说队列或调用两个模型。应选一条真实路径，融合后删除/停用未采用分支。原子H1已await展示/周界后：
```js
const weekly = await onWeeklyBoundary(host,service,context,signal);
await onPKBoundary(host,service,{...context,weeklyJobs:weekly.jobs,
  decisionBoundary: /* CORE真4H决定边界 */, maxCommentariesPerChapter:32},signal);
```

onPKBoundary仅真决定/风险退出/周界/章终创建固定resource与观众todo，逐条claims F1.../A1引用raw fill/native order/account version，目标距离用精确Decimal。普通H1/每tick不生成；cap保留输入并明确cadence_capped。原作只接受knownAt<=cutoff的观众投影，不造独立漫画资产。

主会话 `consumePKCommentary(mainHost,service,{deliverNativeChat?,verifyNativeChatReceipt?},signal)`只消费与当前观众source/cutoff一致的PK。无真正main公开交付adapter+真实message/asof/source verifier时返回待写正常原生回复的packet和pending，绝不说已displayed。`generatePKCommentary`旧兼容入口已明确禁用，返回NATIVE_MAIN_REPLY_REQUIRED；本流程不额外调用inference，而由真正主Agent自由写普通原生正文。历史unknown只恢复材料，不重发。`recoverPKArchives`与`reconcilePKNativeDelivery`恢复封存/未知显示，不触碰金融账本、不自动再次模型/再次消息。

## 自动周报的原生UI消费者

已补CORE调用的onExperiencePartialBoundary：真实有界停止后封存本UTC周剩余片段，kind=bounded_partial、chapterComplete=false，与周界时钟连续。重复同cutoff不再排队/不付费；不把8H冒称完整周。

`consumeNativeWeeklyReports(mainHost,service,{openNativeReport?,verifyNativeReportReceipt?},signal)`只读取已sealed的真实报告；固定report/data/output refs、inputDigest、asOfMs和稳定operationId交给真正native opener。与当前观众cutoff不一致先诊断，不混后来数据。无adapter/verifier则pending；已opened不重复，lost reply标unknown，`reconcileNativeWeeklyUI`只凭现有真实回执恢复。inspector receipt与native用户页打开的receipt独立。

Agent表达自由：默认reportKit与完整原文，或renderWeeklyHTML自定义HTML/图形/资产；财务/原始证据绑定和完整输出保存是硬约束。不得拿合成fixture文本冒充至少一份真实周报。

## 方法依赖与版本证据

包内消耗价格/SMA20明确公式、forming include、binary64/12dp显示、lookback预热语义；本任务真compute fixture已测，但没有正式本轮采用/预测有效性的声明。analysis-plan列精确官方目录与price-action/ICT/institutional/narrative/strategy-authoring/Backtrader/vnpy的版本/源/treeDigest，先发现是否安装/可用，不默认存在。最新七身份已与来源终结文件同步：price-action、dow-theory、strategy-authoring、strategy-research、backtrader、behavioral-finance、reports，全部proposed_not_adopted。早期ICT/institutional/narrative/vnpy提案不是这批来源所确认的七身份。technical-analysis-theory失败不激活。真正后续采用要有verifyMethodUse读取的成功调用receipt+固定input/output refs；只安装/读Skill不能算采用，也不能把负结果或同历史重放当样本外胜利。

## 当前五效果状态

账户mapping、消费-prefix/指标、原作/实际标记、周报/原生UI消费者、PK队列/原生main交付hook均已实际编码与孤立测试。**五项当前真正原生可见验收均pending**：草稿未挂载，CORE真实native trace执行与working order trace/SDK订阅及client generation回执、真实模型输出、原生UI打开/主消息证明、fresh50x公共入口及安全有界pause由主Agent/CORE后续验收。现有真实归档适配通过、mock视图或测试通过都不替代这些证据。

最新补充：已只读核对official-round1-terminal-seal.json与outer终态engine，确认同一58fills/66ledgerRows/空仓/311576.78095 JPY输入及既有hash。无需再次调用i02或封存工具；官方892日志/127原文镜像核验是主Agent固定回执的声明，本展示任务没有重跑或改写它们。终态适配断言all58 orders、working查询正常但lifecycle coverage仍未知、positions0、history124、full subscription及parentDecision/queryOrder链接，并检查完整engine bytes hash不变。

最新验证：展示/legacy/account增强后80项78pass/0fail/2 SDK/client skip；CORE owner现版本hooks6/6，此前flat快照失败已不复现，不把旧错误当当前阻塞。五种实际原生可见/正式新版本挂载仍未执行。


## 严格gate修订：实施不齐不得正式安装验收

已消费native-immersive-acceptance-gates.json与round2-native-experience-plan.json。不是只把UI proof留给将来：CORE包内main handler/Skill、真实warmup producer、自动UTC调度必须实际接线后才交正式安装。该接线尚未由本模块宣称已实现。

可复用包内main流程（CORE在自己的Skill/handler接入这些真实导出，UI不覆盖CORE文件）：
1. 从真实已取得且校验digest的pre-play ticks构造closed warmupBatches，await initializeReplayAudience；不改资金，不在首单之后造早前费用/仓位，不用平值补SMA。
2. 初始display/binding/typed indicator实际挂载后才启动有界一轮；正常非破产lastPresentationTrace走多个实际消费prefix，服务emit让已订阅原生K线/SMA看到forming，末prefix才closed。普通whole-H1只closed路径不足。
3. 每个main有界控制/status返回及有意义PK事件，await consumeMainAudience；它实际消needsMainRefresh，保留同一真实host instance并拉原生report/PK待办。service emit或一轮主聊天指令不是主消费者持久调度。client verifier除rendered/generation外要返回真实visibleKeys原作+actual，空legend/只有计算结果不算同图可见。
4. CORE捕捉精确UTC边界之前的account/market，onWeeklyBoundary排utc_week队列，自动worker明确generationTrigger={kind:'automatic_committed_utc_week',automatic:true,...actual caller/version/cutoff evidence}。新week tick/commission/position不能回填前周；week封存/生成/原生opened时viewer/account同步，不能前进丢掉main读周报机会。
5. weeklyGenerationInput请求<=28KB（Agent完整request<=40KB），只有源ref、精确财务和明确节选；全部Frozen输入另存DataRef/档案，并保留完整真实Agent输出。缺重要必备信息报错，不默默截断全engine或造数。
6. main正常回复用claimPKNativeReply稳定claim -> 保存自己的完整文本recordPKNativeReply -> 匹配公共SDK正常message ref/可见proof用acknowledgePKNativeReply。后台role summary不能ack；没有实际message verifier/公共回调时仍implementation pending。normal claim会阻止本模块另起background narrator。CORE已有narration队列须融合/选一条而非双收费。
7. 周界自动真周报、正常forming、非空原作候选区间与本run真实fill/stop、原生账户/主normal chat及可移植/幂等证明齐备后，才在已提交决定边界最终pause，保留真实open position。partial只是补充，不强平凑空仓，不跑完整三章。

早期原作月窗采用audience_context：只提示附件有候选入场场景/日期未核实/未证明此时动作发生；无未来结局、收益、精确成交价。已知剧情结果仍原chapter_complete策略。它不是第二角色账本，绝不进交易角色DTO。代表图必须实际出现该诚实区间与本run精确fill/stop，不只是图例。

源研究report ref固定artifact_58a3c5ef-03c5-4f4f-b18b-5f580f523749 / revision_76119709-4815-43de-8eb4-059eeb2819f5 / sha256:b6a7bc9757bb91e16a1da27cd7e5de3f12f8d249659562d957a5c12c48b62edc；只是proposed method evidence，不是采用/安装证明。327CHF缺口新增覆盖仍0；第一章不需补这部分，但不得说全章补齐。


## 本Run最新ABI/主chat补充（不扩展任务链）

已消费round2-public-main-chat-and-order-trace-review.json及用户指出的in-progress更新，只读核对CORE当前native-engine.py，不把源码进展当原生SDK验收。

producer ABI已对齐：nativeOrderTrace每条含实际nativeClientOrderId/chapter/createdAt/time/parentDecisionId/decisionId/instrument/nativeInstrumentId/side/quantity/filledQuantity/remainingQuantity/status/nativeStatus/event/orderType/stopPrice/reduceOnly/nativeEventNs/internalOrderingOnly/sourceSequence；缓存callback映射标准pending/working/partially_filled/cancel_pending/cancelled/rejected/expired。providers保留nativeStatus原值，不用说明文字替换ACCEPTED/CANCELED；fill总量严格等于已知cache filledQuantity，requested>=filled guard保留。

未成交working protective stop不依赖fills存在：空fills+实际accepted stop trace仍查询/订阅显示挂单。asof adapter先按matching coverage.eventCount切精确前缀，再time<=viewer.cutoff过滤；same-ms取消/成交不得提前泄漏。CORE actual nativeOrderTraceCount在lastPresentationTrace记录、committed-playback先slice fills与lifecycle并更新coverage.engineVersion/asOfMs/actualQuoteTimeMs/eventCount，观众边界一致。只有完整matching coverage与实际count匹配才complete；旧第一轮缺trace继续unknown。

CORE负责主normal-chat具体路线和可移植主Skill打包：main-only claim冻结event/asof/facts，通过host.tasks.read(host.scope.conversationId)/host.messages.read读取真实active_response_message_id与已可见正文边界；真正主Agent自己自由写PK；下一ack读取同message真实新增可见正文，归档text/messageId/eventId/asof/digest并delivered。恢复先按messageId查实际正文，unknown维持pending防重说。**不等writer、不另inference、后台summary或emit不算delivered**。presentation只提供对应asof/事实/刷新边界接口，不替CORE操作自有消息或另起队列。PORTABLE-EXPERIENCE.md由CORE完整打包，真实消息内容/append形状和native可见仍须正式公共SDK实测。

连续connection failure保留checkpoint并暂停，绝不清材料/停recorder/自动重放或换run。本任务仍不安装、不启角色/weekly或额外解说模型，不新建任务链。
