# CORE→UI 最新继续接线（未启动角色/正式安装）

已消费主Agent再次明确gate：normal forming、真实UTC周界、同asof观众账户/图/markers/main normal chat需代码+可重放driver完成，不是只留pending措辞。现CORE正常native trace/8前缀250ms、same-ms counts、canonical onPKBoundary+4H audience pause已实现；51 fixture通过不是SDK/client证据。

## 真源预热的实际数据契约
只读data.js/data-windows.json确认**现提供方preheat是Dukascopy原生monthly H1，execution quote_ticks仅从playFrom开始**。loadExecutionSlice明确禁止读取playFrom前ticks。因此不能伪造20份ticks，也不能声称已有真实warmup tick bytes。
CORE将写 warmup-h1.js：核对prepared data.frames[chapter]完整JSON digest、data.digests.sourceFiles/源文件bytes/hash，选仅 time+H<=initialDisclosure 的最后20个真实closed H1，保留真实bid/ask OHLC Decimal、源ref和h1Limitation；资金30万/无交易不变。不把H1 open/high/low/close串成fake ticks。不显示未来H1。
请UI在 initializeReplayAudience 接口之外支持initializeObservedH1Audience或直接允许CORE写带明确 sourceKind:'observed_native_h1_preheat_not_execution_ticks' 的初始view；相应consumedBars native.lastConsumedTick/consumedCount对H1必须unknown/null，不用hourEnd-1或0造tick时刻/个数。warmup提供closed source H1，不是撮合资料。financial首次native lastQuote仍null，API只显示已披露历史价格，真实SMA20能计算。

## UTC预周界接口
CORE在**this.advance/后续quote消费/chargeFinancing前**从金融权威before状态+当前持久market冻结每个 (prevDisclosure,nextFrame.from] UTC周界。quoteTime仍真实last quote，价无新quote时carry last-known并明确不是新周当前价。旧周ledger/fills/orders/equity/decisions均严格time<boundary。先完整archive+persist pre-step-boundaries，失败不advance。enqueueCommittedHooks同CAS带boundarySnapshots；onWeeklyBoundary收到before-future account/market而不是post Monday费用/仓位。
已在exact Mon00结束的旧H1由现closing mark完成；重复相同boundary不再排队。新week首次H1晚于边界时先freeze旧周，再新context，不能反向补造。initial openingContext改用实际pre-step captured opening/warmup，不再手写empty market。

## 公开main持久consumer
新增CORE kurumi_audience status/configure/pump/resume主handler，保存driver chart/options/revision/todo执行状态；actual mainHost传进UI consumeMainAudience/refresh，service host不借main。每个safe4H及真正UTC report boundary消费待办，不能只返回needsMainRefresh。开始下一H1前要求同frontier main-chat pending无遗留；最新真实报告需要在固定asof viewing hold开放/确认再进。
请给CORE任何已核实的**public native report opener/客户端receipt字段契约**路径；未有契约时不能猜host.ui/private DOM或假的layout report op。已有回调必须可由包内实际main handler提供，不只测试注入。现main chat路线使用公开tasks/messages read；另已发现outer actual-shape诊断：content为ordered type=text blocks，CORE修复durable block/text boundaries，忽略tool/thinking、绝不stringify之。

方法7真实catalog identity均proposed，不安装/采用宣称；当前不再找327 FX，只继续第一章能力。所有权不变，CORE不改UI文件。

## 更新：dev.3真实代码已落（请UI对接，不覆盖CORE）
- `warmup-h1.js observedH1Warmup/initializeObservedH1` 完成，真实20闭合H1来自hash一致prepared frames/sourceFiles，sourceKind+null tick/time；service.start硬拒无已冻结warmup。
- `utc-before-step.js beforeStepContexts/freezeBeforeNative`、service的player/continuation/recover都在advance前调用；正常Sunday23 H1闭合Mon00也捕获Mon00账户（oldweek time<Mon00），次周融资之前hold。native合成代表片段真的执行：Sun23旧周融资0，Mon00第一tick融资10JPY；CORE账户仍旧balance299997、equity300977、quote Sun23:00:01，native下步只是独立对比，未松hold。
- 持久`kurumi_audience`已经handler传actual main host，bootstrap/configure/pump/resume/release；真实SQLite关闭重开create/start/continue local mirror与显式oldpin回归落地。这不是SDK安装测试。
- 公共native opener/actual client receipt可通过 `native_report_bridge`/`client_receipt_contract` 传**已实际发现的精确publicContractRef+字段selectors**，不存在猜host.ui或硬编码nativeReceipt模板。未有契约仍阻塞，不把fixture当实际schema。receipt与原始layout/script/版本/instance/artifact/source key核对，成功/失败原文封存。
- `main-message-text.js` actual ordered visible `type=text` block schema；不stringify/hash/存储thinking/tool值。支持native字符串老shape。publication中断后reconcile保存的精确后缀，不混后来别的正文。
- main PK预算改64（42四小时决定+周界足够），旧8会在首UTC周界前阻止PK；角色42/168H、每cmd1、周报2不变，second narration inference仍禁止。

### UI剩余必须对接（只读你的文件确认现状）
1. `consumedBars`当前native.lastConsumedTick=utc(b.lastTickMs)仍给真实nativeH1 warmup的null构造非法UTC；请对sourceKind h1显示unknown/null元数据，不造0或hourEnd-1。volume未知不变。
2. 正常4H main PK现在只在真实decisionBoundary（或风险/UTC/terminal）调用，避免第一小时ready的旧PK孤儿；context新增`roleDecision`与`decisionBlockFills`：真实整4H决定/成交可用于观点，无未来数据。你的`onPKBoundary`仍只用最后单H1 fills与lastContinuation，第四小时Role决定应取此source；原作仍观众只读。
3. CORE public ack canonical `round2-pk.deliveryStatus='public_main_message_acknowledged'`, nativeMessageRef是actual messages.read的持久证据（不是client rendered）。你consumePKCommentary现只认displayed会不断pending；请区分public正文已证与native client visibility待证，不能去调用新模型。
4. 当前refreshChart.comparison.status固定pending且未由actual client visibleComparison回执升级；需要matching original+actual visible-key receipt核对，不能 source keys非空就rendered。CORE可传actual contract verifier结果包含visibleComparison，真正raw来自public layout.script read。

已留CORE源/skill工作流，未安装/启动角色/周报。普通玩家SDK/frontend验收仍须在用户后续允许时，用实际public契约验证；当前不伪造pass。

# 0.2.2实证纠偏追加（dev.3.2，覆盖上文过期接口门槛）

已核验两条新输入：message-shape-independent SHA=963a48c422daca095ebb53ad1f160a31490b0ee8e47f094238e6dd10061ca5a7；主协调handoff SHA=dfe3b38318bcc3af10b5acc37d2df96ebdb26bd556d96a3bd896afe17c67b0a2。真实公开message数组结构现为observed；实际snapshot只读hash7e9b2019…bb52未变。本次67/67、0fail0skip，非SDK/client像素验收。没有停止/重启本CORE任务、没有新Run/paid模型/正式安装/清素材或停recorders。

main-message-text/Main workflow只看有序顶层type=text，无递归或whole-content stringify。持久rawBlockCount/可见block index+UTF16 length/hash、visiblePrefixLengthUTF16/visiblePrefixDigest；末可见块suffix与后来新可见块按原顺序无人工分隔符合并，保存exactVisibleSegments。新增回归包括真实snapshot结构、两个初始中文+emoji块、毒化thinking getter（不得读取）、tool/thinking中间块、保存boundary JSON后换main host reconcile、重复ACK原ref且不读消息、前缀改写/早块追加/旧非可见位置改text/未知text schema负例。unknown仍hold/pending，不重复段落、付费或金融执行；NativeUiVerified=false。

与UI attempt2 receiver已按共享UI-PUBLIC022-RECEIVER-HANDOFF.md衔接，只改CORE own main-audience-driver/warmup：
- configure无public contract/opener必填；记录clientReceiptMode=public_layout_inspect_rendering_exact_mount、reportReceiptMode=public_artifacts_receipts_native_page。旧native_report_bridge/client_receipt_contract配置被明确忽略，不调用工具或猜fields，不迁移正式记录。
- pump直接调用UI consumeMainAudience内置receiver；图原始{inspect,script}保留，同version exact chart/binding/script_ids/实际artifact/generation+inspect.rendering client chart状态为runtime证据。script只是descriptor，visibleComparison=false、pixels另验；program_evidence_ready不被虚构point keys永久堵塞。
- weekly只读artifacts.receipts(exactRef)，native renderer.name=sesame-report rendered，inspector不能通过；normal原生卡片/page点击合法，无自动open要求。raw不加operationId/asof/evidence；derivedBinding用固定job/reportRef/inputRef/outputRef/period/inputDigest；双方归档后才opened。
- release要求sealed、真正native_page_rendered_pixel_unverified、raw与derived binding已归档、同hold截止period、exact reportRef/inputDigest、canonical main正文ack；不把UI像素pending当作已经通过。连续public port异常保存todo counter/checkpoint并暂停，没有retry loop。
- warmup canonical bar复制真实frame/provenance h1Limitation，未知tickCount/time仍null。driver自动周报trigger统一automatic_committed_utc_week，不冒充manual/final partial。

## 主Agent下一步（用户已授权，无需再等后续允许）
稳定源码交付后由主Agent公开validate/test/update/inspect/load、创建全新bounded第二轮50x/300000JPY/4H/openai gpt-6.1-sol并真实短测。CORE只交作者源码不安装。真实remaining gates：actual当前main public tasks/messages追加与恢复；exact mount/runtime实际target图（旧hidden图不算）；原作区间+真实fill/working stop同图像素、动态账户/H1/SMA20显示；真实自动UTC周报生成留档+native sesame-report页；角色/周报request完整原文、固定new账本与恢复幂等；五效果后提交决定边界暂停并保留position。327CHF strictFX仍缺数、禁止插值；第一章代表短段不需强行补三章。first-round v495旧账本/所有capture不动。

证据：verification/round2-core-public022-tests-20261012T091427562454Z.json，完整private/round2-core-public022-20261012T091427562454Z.stdout.log及.stderr.log；输入/源码前后hash、native实测vsfixture口径清楚分列。
