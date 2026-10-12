# 新玩家有界原生体验驱动（0.1.3-dev.2，验收待实测）

## 范围与不可混称

本轮是 `bounded_native_immersive_acceptance`，仅首章JPY代表片段；30万JPY独立本金、全章50x、4H角色决定、openai/gpt-6.1-sol、目标2000万不变。同历史知情重放不是样本外，无前瞻验证通过规则依旧有效。327条早期CHF FX未解决，60秒严格门槛不变；不靠复用旧24H/同名数据替换来源。

**本副本没有安装、加载、升级、prepare正式包、调用正式角色/周报模型或 broker。** 下面是打包给后续main Agent的可重放工作流，不是当前验收成功声明。真实SDK/客户端/public message可见形状/初装/自动指标刷新/原生报告打开都要另测。

## 1. 真正空白安装可直接创建50x

main用公开安装生命周期安装测试过的固定包；根据公开prepare诊断复用已有依赖并仅补缺，数据和Python都落插件私有storage。无需作者Movies目录/用户名/手工SQLite/预装隐藏分析包。Recorder新安装默认 `storage/recording` + `storage/recording-mirror`，`recording-selection.json`固定每安装选择。显式其它mirror由`kurumi_recording pin`记录稳定command。已有未pin旧主档：必须明确旧mirror并acknowledge_existing，流式验证两个完整journal字节相同；不猜、不移动、不替旧文件写新默认值。`status`返回具体选择诊断。

- 空业务state：`kurumi_new_experiment`传稳定command、`expected_version:0`，省略previous_run_id，直接创建paused的50x有界run；不伪造一个完成的legacy轮次或历史seal。孤立fixture已覆盖此分支，真实初装待验收。
- 已有旧run：仍必须终态/无active/recovery/continuation/unknown、双副本完整seal，`kurumi_archive_terminal`后以精确revision/previous_run_id调用`kurumi_new_experiment`。旧continuous与history不可变；不能把fresh分支作为绕过旧档的入口。
- 创建不会选择模型/自动运行；初始账户30万、空仓、空consumed bars，来源和规则digest固定。

## 2. 预算与安全观看边界

默认硬上限42次已预约角色请求、168个实际已提交H1、每命令最多1次角色、2次周报生成、8个PK事件/解说保留额度。168H只是最多首章7个交易日，足以跨真实UTC周界的预算上限，不是必须花完。**每个完整4H自动停在main_audience_boundary**，不自动排下一个付费角色。5000请求在模型选择前拒绝；unknown/取消/失败预约也占角色额度。任意pause置manual latch，普通continue不能清除，main必须显式 `kurumi_experience arm`；预算不会被arm扩张。

main驱动：start(max_steps=1) → `kurumi_experience wait_boundary`（最多120s订阅等待，不轮询行情/不创建模型）→若仍pending保留原task，不重start→资金/展示outbox完成后检查账户、forming、真实指标、原作区间注释和精确Sesame动作 → 刷新marker → claim普通主聊天 → 自由正文 → ack → 已授权周报queue消费/原生打开 → 记录真实native gates → 必要时下一4H。

`configure`只能在engine v1前冻结更小的明确预算，不能中途扩大。真实UTC周自动报不是最终partial的替代品；用于短回归的32H plan可能只产生明确partial，不可据此宣称真实周界验收通过。全部native gate与真实固定evidence refs由main明确review后，或硬预算/章边界时，在已提交决定边界暂停。**不强平/补充值/抹掉仓位来制造空仓终态。**

## 3. 正常forming是真实native消费轨迹的展示，不是再次撮合

新50x Python在实际Nautilus QuoteTick循环里采最多8个真实checkpoint：真实source sequence/quote、exact account metric、FIFO position、fill/order/ledger/native lifecycle counts。CORE独立JS exact snapshot逐点核对，在整H1金融CAS后逐个原始journal delta调用onConsumedPrefix，250ms节奏广播；非final是forming，final normal是closed，bankruptcy只揭示真实消费前缀。全程不从lastQuote或未来H1 OHLC重建、不插值价格、不再次撮合/请求角色。

展示投影是已金融提交事实的有界历史回放；金融权威getState/observe不变。每点按真实count截取同-ms fills/native orders/equity，防止同-ms后续stop fill泄漏到前一source sequence。财务/行情as-of与quoteTime独立。每帧cursor持久化；展示失败保留金融提交、阻止后续paid/H1，只允许显式retry剩余展示。章终settled观众状态保持旧章的实际quote/cutoff，不误用下一章reset时钟。

## 4. 原生订单轨迹与覆盖

只有新50x生产actual-order-factory-created及真实Nautilus lifecycle callback trace，含nativeClientOrderId、chapter、真实requested/filled/remaining qty、created/time、native status、stopPrice、reduceOnly、parent decision。protective stop可真实working，cancelled/filled分别保留。Native fills按真实order identity分组，不把一次反转的close/open两单合成过量成交。NativeOrderTraceCoverage绑定版本和as-of；prefix按count过滤。旧legacy不补造轨迹，fills只能证明已执行量，requested/working/status保持unknown。

当前孤立native测试已真实触发created/submitted/accepted/filled/cancelled及working protective stop；partial/reject/expire等回调覆盖不等于都已经触发验收。原生账户全subscription与实际客户端仍pending。

## 5. 主Agent普通native-chat：公开claim/output/ack，无写API

参考外层公开API审查，使用 `host.tasks.read(host.scope.conversationId)`的actual active_response_message_id、`host.messages.read(id)`和插件storage。**不导入private context/store，不写message表、不伪造user request，不需要注入native writer或另发inference.complete旁白请求。**

`kurumi_narration diagnose`只读自己的当前响应字段类型；真实visible text字段形状与stream append语义必须在matching SDK核实。不把JSON serialized message或不明array当可见正文。

在4H金融/行情固定且无active/recovery/continuation时：
1. claim当前frontier的ready PK facts，固定inputRef/digest、真实message ID、原可见text长度+hash（UTF16边界，不复制整段旧会话）；保存mainChatClaim以阻止下一H1。
2. 主Agent在自己正常native chat自由写中文PK：关键行情、双方攻守、风险/错判、盈亏压力与2000万目标距离；原作未知数据不造；观点/假设与成交证据分开。引用claim返回`[PK:eventId]`，不是固定措辞模板。
3. ack只读同一真实message，验证prefix hash及新追加正文的事件引用，完整归档精确正文/messageId/eventId/as-of/digest，发布固定resource，再释放暂停。
4. resume先reconcile原message，有正文即只封存，不重复一段话；boundary变化/无真实正文/不可读保持pending/unknown，不付费重旁白也不重复交易。

public message read只证明实际port返回正文，**不能自动宣称屏幕displayed**。当前fixtures使用假scoped ports，全部标nativeUiVerified=false；真实SDK/client和main gate必须另验。服务只队列有界事实，tick animation不生成PK，不会每tick模型。

## 6. 方法发现/依赖诊断（main-only）

`kurumi_method_workflow`提供status/catalog/discover/inspect，以及未来显式authorize_install的install和load。安装必须引用同一成功catalog command及精确catalog_digest；不会静默update/绕过disabled；unknown副作用要公开inspect后明确新操作，不能盲重放。激活/查看页面不自动安装。当前开发未调用install/load。

只有有真实成功执行receipt且固定inputRefs/outputRef可读的adopt才算采用；目录/版本检查/编译不算方法运行。角色只收到一般风险假设，不接收原作未来交易、首轮逐笔结局或拟合曲线。预测有效性仍unverified；skill无需隐含分析包。

## 7. 材料与最终验收

旧轮终态先全量双副本seal。新轮独立id/30万本金/recording selection/engine/native order trace/raw consumed quotes/角色全输出/展示cursor/weekly冻结inputs及自由全输出/主聊天精确正文+artifact refs/method诊断均保留。normal 4H audience pause不造chapter complete；硬预算partial周报明确bounded_partial，不回填未来周初、不强行flat。

fixtures验证只能证明代码和真实独立Nautilus计算。最终必须在公开fresh lifecycle + matching SDK + 真实native client核对account、forming、真实指标、original/actual注释、实际UTC周报打开、普通main chat、暂停/更新幂等后再说通过。完成即停止，不消费全三章。

## CORE dev.3：UTC/source/main text-block继续能力
默认仍<=42 paid角色/168 committedH1/单命令1/周报2；main normal PK最多64，不启动第二旁白模型。原因：8段PK只覆盖32H，会在第一真正UTC周界前预算止步；64足够42次4H观众停顿及周界，同样有界。角色/周报付费上限未扩大。
新增`kurumi_audience bootstrap/configure/status/pump/resume/release`：初始bootstrap核验prepared native monthly H1全部帧hash+原文件bytes/hash，仅20个已披露H1。它不制造playFrom前ticks、不影响30万资金/账本，tickcount/lasttick未知为null。正常forming仍只来自真实已消费quote prefix。
`utc-before-step.js`在advance/financing前保存金融权威与源view快照，包含在UTC Mon00时刻已闭合最后H1（与上周同费用/成交前缀）。任何次周time>=Mon00不得入旧周；正常周报hook自动封存。公众main consumer持久化todo与unknown，对原生opened仍只读实际public契约回执，绝无猜host.ui/private DOM。未打开/未ack原生main正文时hold不推进下个tick。
主聊天已支持actual public content array中ordered `type=text` blocks；UTF16边界+每块digest，不stringify/归档thinking/tool payload。claim后本main写普通正文，ack只存真正visible后缀。已保存输出但发表中断则reconcile原receipt，不因后来其他文字重新写/重新付费。
隔离真实SQLite create/start-state/dispose/reopen/continue与oldroot显式pin是本机文件/代码回归，**不是SDK安装/host/frontend实际验收**；native合成周界实例旧周融资0、下一周首tick融资10 JPY，不是市场收益。
actual SDK UI仍需共同验收：未知H1 lasttick在providers/consumedBars里必须输出unknown而非utc(null)；main chart/raw comparison receipt需匹配真正公开client schema。可用公开native opener契约引用+字段映射接入driver，不能把回调fixture当成官方已开放工具。当前禁止安装/角色/周报模型，能力测试全部future-only。
