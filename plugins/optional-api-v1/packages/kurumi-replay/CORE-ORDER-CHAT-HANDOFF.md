# CORE→UI：追加审阅衔接，dev.3.1（同任务，不新建Run）

只读已核验 `verification/round2-public-main-chat-and-order-trace-review.json` SHA256=f7a99bdfda177c5b2ba37f76054ac8be9fe44827086ed3db4c5aac111843236b。该文是04:27进行中观察，不作为现在已native/SDK验收的证明。本轮不改UI所有文件，不安装/加载草稿、不调用paid角色/周报/正式控制，不碰正式storage/SQLite/dev4/recorders/旧素材。

## 真实订单生产者ABI：kurumi.native-order-trace@1
`native-order-abi.js`已供native-engine返回时与committed-playback每个prefix进行守卫，**不负责UI DTO投影/不猜legacy订单**。

每个`nativeOrderTrace`事件：
- `id`真实本Run事件唯一ID；`nativeClientOrderId`实际Nautilus order.client_order_id；`chapter`创建时章节。
- `createdAt`创建时实际当前来源quote毫秒，`time`当前实际来源quote毫秒；`nativeEventNs`保留真实engine内部ns，`internalOrderingOnly:true`，不能冒充原始市场更精细时钟。上游`sourceSequence`未给则null。
- `instrument/nativeInstrumentId`、`side`；`parentDecisionId`原角色决定（continuationOf）；`decisionId`此时执行决定。callback若缓存创建/父归属未知，报NATIVE_TRACE_MISSING，不再用later callback时间猜createdAt/parent。
- `quantity`当时实际order.quantity、`filledQuantity`缓存真实累计order.filled_qty、`remainingQuantity=quantity-filledQuantity`，整数base-currency units字符串。拒绝负数、累计倒退、q≠f+r、future quote、chapter/父ID变化。
- `nativeStatus`与`event`原样；标准状态：INITIALIZED/SUBMITTED→pending，ACCEPTED/TRIGGERED/PENDING_UPDATE→working，PARTIALLY_FILLED→partially_filled，FILLED→filled，PENDING_CANCEL→cancel_pending，CANCELED→cancelled，REJECTED/DENIED→rejected，EXPIRED→expired。**创建/提交/接受区别由nativeStatus/event保存，不编造未触发状态**。
- `orderType/stopPrice/reduceOnly/reason`来自实际factory/cache；保护stop在无成交时也在trace中，不能从fills==0推出无挂单。

coverage含abi、complete、engineVersion、asOfMs、actualQuoteTimeMs、eventCount。各prefix严格用真实`nativeOrderTraceCount`/fill/order/ledger counts裁切，同ms依赖计数而非只用time<=cutoff；负count或倒退现在拒绝。最终same-view/account/markers应取该prefix，不读金融authority未来后缀。
legacy first run无覆盖仍complete:false/unknown；不迁移或补造requested/working/remaining，不从fills反推挂单。UI需继续按actual nativeClientOrderId+chapter分组，并与真实fill累计核对。

### 验证层次
本次同一完整suite62/62，0fail0skip。
actual Nautilus合成输入实测已包括created/submitted、工作保护stop、filled、cancelled、反转不同nativeID、parent与同ms前缀；真实冻结USDJPY2361行copy保持hash。partial/rejected/expired **仅ABI表达/负向fixture与callback实现，不宣称已真实引擎触发或客户端验收**。legacy仍unknown。

## 普通main聊天，不存在第二writer依赖
production `service.narrationControl(actualMainHost,...)`始终走mainChatWorkflow，service只queue canonical round2-pk facts。
`narration-queue.js`旧extra inference+injected writer drain现硬禁用NATIVE_MAIN_REPLY_REQUIRED，保留旧facts/status只读兼容；不会让普通玩家等待不存在的writer，不自动迁移或排重复queue。

1. 当前main claim，公开tasks.read(scope.conversationId)与messages.read(active_response_message_id)，保存真实id+有序visible text block UTF16边界/digest。
2. main在**普通原生chat**自由写中文PK段，引用返回event marker；不固定文案、不调用另一inference。
3. 下一main-only ACK读同一真实message ID的追加可见text blocks（非tool/thinking），归档原文、messageId/eventId/asof/inputRef/digest后标public_main_message_acknowledged。emit≠delivered，nativeUiVerified仍false至真client证明。
4. 再次claim已有预约现在**先自动reconcile保存id**，返回doNotRewrite:true，不再裸返facts诱导重说；没有suffix保持pending。publication中断用已保存完整后缀，不混后来的无关结尾。
5. 已有预约连续两次公开read连接failure保存counter/checkpoint、phase=main_chat_connection_failure_paused；每次只读一次、无loop/自动重试。明确人工继续后按原id reconcile，不重排事件/不重付费；保持同账户/view asof。

## 后续主Agent真实SDK/客户端验收门槛（本CORE未执行）
稳定后由主Agent在用户允许时公共安装/加载实测，禁止private runtime/store imports：
- actual main factory handler scope main；service host调用消息端口应被拒；role保留2-tool allowlist。
- diagnose留结构字段/type元数据，不保存hidden/tool值；确认公开message本身的content shape与追加语义。
- claim普通自由输出ACK：host读回精确对应可见后缀、client显示同一message和段，账户/图/markers/asof没有继续；不得用fixture/emit取代native可见证明。
- saved-id恢复已有段不重说，连接连续failure仍pause；重复ACK无private写、无native撮合、无新增model请求。
- 接UI真实order DTO、无成交working stop，与所有actual生命周期/请求量/累计量/剩余量相同；缺legacy覆盖保持unknown。

只增加此handoff给UI owner衔接，不覆盖providers/markers/replay-presentation等。既有portable queue与第一轮fullseal/FS6case/author路径扫描不重做，本轮仅跑现有suite并增加4条定向回归。

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
