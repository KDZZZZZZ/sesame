---
name: kurumi-replay
description: 准备久留美三章连续模拟数据源，启动受限真实角色Agent，主Agent解说、原生Dashboard观战与阶段报告；不会连接真实券商。
---

当前源码为未发布的 `0.1.3-dev.3.8` 验收快照，最新状态见 `VALIDATION.md`。
已完成原生账户、闭合 H1/指标、简洁双方标注及普通主聊天 PK 的代表片段实测；
形成中帧、真实 UTC 投资周报、完整新玩家准备/seed/reload 仍未通过。
原生 Node 启动与 wheel 准备恢复的隔离候选尚未纳入本快照，准备失败时保留诊断并暂停。
以下按版本记载的交接状态不能覆盖此当前状态；不能为补齐演示自动重置旧 run 或增加付费角色。


# 久留美数据源与角色子Agent

角色任务不读本文件，只观察和提交本步。主Agent执行：

1. `kurumi_status` 查当前状态。首次 `kurumi_prepare {action:"prepare"}` 明确下载私有固定依赖和限定真实历史；不会向系统Python安装，不打包整批市场数据。不完整行情暂停，不填造价格。
2. `kurumi_start` 指定唯一 `command_id` 与 `expected_version:0`、`max_steps:1` 完成小闭环；后续 `kurumi_continue` 或 `kurumi_step` 使用最新控制revision。角色只选真实 `openai/gpt-6.1-sol` 描述符，无此模型停止，不能切换。
3. `kurumi_display` 使用已注册market/account和公开layout显示当前章H1、模拟账户与观众两层标记。通过 `canvas_inspect` 核对客户端回执；不能把layout写入成功当成图已显示。Account页选择“久留美模拟”，所有资金/持仓/订单/成交是模拟数据。
4. 主Agent解说实际账本，不替久留美做决定。可以用标准任务管理工具观察角色子Agent。每H1只能一个受限角色任务；`kurumi_observe`只返回已知快照，`kurumi_decide`提交本步目标基础货币数量。买正卖负、0空仓、1000倍数。明确hold也提交原数量；聊天文本不算决定。
5. 本次允许完成的H1步数由max_steps固定；不能未经要求自动跑完。失败后的同一步恢复必须由主Agent明确核对旧任务终态，保留付费请求证据，不重发未知任务。章间强制空仓结算并暂停展示下一章，后续资金仍同账户。破产停止，不归零负余额、不补款、不为跳过月份记收益。
6. `kurumi_pause`取消角色与后续请求，不撤销已经原子提交的成交。重启从已提交账本恢复但不启动模型。未知/取消/中断任务先 `kurumi_reconcile` 核对宿主终态，再显式继续；不要用新ID重发未知成交。
7. 优先 `kurumi_export {operation_id:...}` 返回已揭示行的固定 data 引用与实际角色/账本/检查点 resource 引用，现有 reports 插件可直接复用。导出不含授权 token 或完整未来行情数组。
8. `kurumi_report {operation_id:...}` 冻结当前已揭示行情和真实角色提交/模拟成交/成本/权益及模型来源，使用Sesame reportKit风格，只读，不加下单按钮。检查返回实际render receipt；失败应修复新revision再检查。报告结果只解释已发生，不当成严格历史盲测或真实交易收益。

控制工具main-only；其他子任务即使拿到工具名也不符合宿主当前任务身份与run/step授权。角色子Agent的工具allowlist明确只有两个玩家工具，没有文件、网络、配置或交易后端权限。

原剧情对照是非官方二创、存在大量拟合价与不明成交时间。观众标记有独立颜色/前缀，与模拟成交明显区分。无法证明精确时间的只作区间注释，不安放成精确交易点；只有当前已揭示时期可显示，且不传角色。没有图片、原文长对白或目标盈利写死。

规则和数据口径见包内 RULES.md / DATA.md；所有三章杠杆/强平为开局固定挑战假设，并非漫画券商已核实条件。H1只是角色决策节奏，不将OHLC声称tick。成熟引擎依赖或同步换汇不满足时，不回退自写H1极值引擎。

## 环境与原决定恢复
正式 ready 必须经共享真实 probe，不能仅看 receipt 文件。任何付费任务前会检查后端；失败先由主 Agent 显式 prepare。已有挑战 prepare 不重新下载行情或改来源/账户。已存在固定 receipt 但 probe 失败不会触发自动重装。
原角色已提交但原生执行失败或因缺数返回暂停时，优先 main-only `kurumi_recover`，传原 failed_not_committed 或 paused_without_fill 的 decision.id 和最新控制 revision。该接口核对原真实 task/request 终态、对应 failed/returned decide 证据、原暂停回执及账本尚未提交后，只执行保存的同一决定，不启动模型。原失败/暂停回执与恢复证据分开保留；恢复第一根H1会完整归档，4小时块保留余下3根延续，再显式 start/continue。不得修改数据库、冒充角色重调 decide；同一 command 幂等，未知恢复先核对，暂停不提交，重启预约须 reconcile。

空仓且原决定继续空仓时，换汇不参与账户计算；真实主行情可继续，FX 缺口留痕但不伪造汇率。已有仓位或非零目标仍需要60秒内真实CHFJPY，缺失时必须暂停。不能以“空仓例外”跳过真正的平仓换汇或主行情缺失。


## 4小时决策节奏（0.1.2-dev.1）

默认一个角色决定覆盖最多4根可交易H1的块。`kurumi_configure {command_id, expected_version, decision_interval_hours:1|4}` 仅在没有任务/恢复/待完成自动延续且未运行时可改；重复同ID同内容幂等。角色一次付费决定只执行第一根H1；同块其余最多3根为自动延续：保持当时实际剩余仓位与止损，不重新开仓、不再请求模型、不发新付费任务。章边界（末章不足4根）提前结算并结束该块；破产、缺数、取消都在下一根前停住，已原子提交的小时绝不撤销或重放。
中断（暂停/重启）未完成块保留持久占位；显式 `kurumi_start/continue` 恢复只继续真实撮合同一未提交H1，不自动发新付费模型。4H回执以块完成后的最终引擎版本与当前账户为准（first-H1 与 final-block 明确区分），重复同一决定返回同一个完成回执；角色不会拿到过时的第一根余额。待完成自动延续期间不能修改决策间隔。

## 完整留档（交易与账户证据优先于展示）

- 提交付费任务前，完整角色输入（instructions/快照/模型/工具预算）先落盘；写不进归档就不提交。
- 每根已提交H1归档 `h1_committed`（决定、是否自动延续、完整引擎状态、已揭示bar与ticks引用）；第一根或延续遇真实报价缺失记 `h1_missing_data`，不计已提交、不消耗延续预算，数据补齐后经显式 start 重试同一根。
- 归档写盘失败（含 ENOSPC/EACCES/镜像失败）立即暂停付费回合；失败条目进入 pendings 队列，后续错误（含清理/封存失败）不覆盖；显式恢复逐个补齐后才解除暂停。已提交事实以真实引擎决定账本为准，任何归档异常都不把 committed 改写成 failed_not_committed。
- 角色任务结束（完成/失败/仅observe未decide）由宿主 protectArtifacts 钩子把完整会话 JSONL 与 runtime.sqlite 一致快照双副本封存（哈希链 journal 同步）；cleanupRun 确认封存在场才允许删除临时区；封存失败抛错由宿主 cleanup_failed 重试，不静默丢日志。角色归属以 active.taskId/登记 taskId 经 `agents.inspect(taskId).runId` 精确匹配，不只在 decide 后登记。
- 每版报告 HTML/CSS/data 与渲染回执、导出 rows/checkpoint、当时布局与指标代码/输入/计算结果全部文件化归档；镜像目录与主归档同字节。

## 中断恢复显式核对（dev.3）
恢复预约记录原版本与决定ID；重启标为待核对，绝不自动重放。主 Agent 用 `kurumi_reconcile` 核对持久挑战账本：`reconciliation.status=not_committed` 后以新恢复 command_id 和最新 revision 显式 recover；`committed` 表示已有原决定，不再重放；`unknown` 保留阻塞，按诊断先读取 status/export 核对身份、固定来源与账本。不能改数据库消除占位。
运行/待核对 recovery 期间 prepare 拒绝。稳定操作ID重复查询不重复撮合。nativeEnvironment 是短摘要，完整依赖与许可证证据在私有 receipt/固定导出 artifact 可按需读取。

### 已封存检查点的UTF-8文本恢复
若出现 `CHECKPOINT_MISMATCH: decisions`，先暂停并核对真实角色终态、原始会话和账户；不能关闭一致性校验或改写历史交易。只有重复的 nativeJournal 决定文本包含分块解码产生的替换字符，且完整封存会话与已提交决定能精确证明原文时，主Agent才可显式调用 `kurumi_repair_checkpoint_text`（最新revision、新command_id）。该操作保留前后检查点和修复证据，原始journal不变；资金、订单、决定及游标不变。然后显式continue优先补尚未提交的延续小时。其他不一致拒绝自动修复。


真实换汇缺口：仅主 Agent 在缺数暂停且无活跃角色时，可用 kurumi_import_fx_supplement 显式导入已核验的 HistData CHFJPY Generic ASCII tick 补充包。包须绑定当前 runId、原 snapshot/config 摘要与未提交时段；原 ZIP、CSV、投影和清单双副本留档。原直接报价在60秒内始终优先，只在缺失或过期时选择补充源的过去真实报价；60秒上限不变，不插值、不更改已提交小时。导入不推进账户，之后使用最新revision、唯一command_id显式continue恢复原continuation。该补充来源必须在最终报告中披露，不得称为原 Dukascopy 原始行情。


## 0.1.3-dev.1 独立新实验核心（未正式安装）

终态完整双副本封存后才能显式创建独立新Run/300000JPY/20000000JPY目标；不覆盖旧continuous、不充值、不复活。新profile全部50x，旧500/25/25保持。费用/强平比率/FX60s不变。创建和重启不请求模型。完整接线、27项新测试分类与pending验收见ROUND2-CORE.md、ROUND2-PRESENTATION.md；普通tick级形成柱播放/自动主会话marker刷新与PK解说尚未接线，不能宣称原生沉浸体验已验收。SDK、正式宿主、client rendered、真实周报模型、新玩家安装与327早期FX缺口仍pending。未来安装/启动由主Agent验收决策。


## 0.1.3-dev.2：最新目标覆盖早期全轮说明
采用有界首章原生体验，不消费完整第二轮。新玩家空白私有state可直接创建50x，旧run必须先全量终态seal。默认42个预约角色/168已提交H1、每command1且每4H audience pause；manual pause须显式arm，5000在模型前拒绝。正常forming由实际Nautilus trace采样+原始journal prefix播放，金融不重放。NativeOrderTrace只在新50x真实生产，legacy未知状态不补造。
主Agent解说用公开claim/read当前响应→自己普通native-chat自由正文→ack/read同一真实message，完整正文与固定证据封存；不需要private write或第二旁白模型。先diagnose并在真实SDK核实可见文本形状，不把fixture/public port读回当native UI displayed。方法依赖main-only公开catalog/inspect/显式install流程，无隐藏安装。完整可重放驱动、预算、周界/partial区别和pending见PORTABLE-EXPERIENCE.md。
当前全部正式安装/加载/控制/paid角色及周报/SDK/client验收均未执行；isolated fixture与真实独立Nautilus结果不是正式原生观看通过证明。

### bounded first-chapter persistent main driver (dev.3)
Normal fresh install must explicitly create paused50, then `kurumi_audience action=bootstrap` verifies actual prepared closed native-H1 preheat; no fake tick warmup. Bind real run chart, then configure audience. Arm bounded experience and later-authorized automatic weekly generation (real model descriptor, <=2), only when user permits. Each4H/UTC hold: wait_boundary -> audience pump -> read fixed facts/report refs -> main_chat claim -> write YOUR own ordinary native Chinese paragraph with returned marker -> main_chat ack/reconcile -> release a UTC hold only with actual opened receipt -> explicit continue/recover SAME saved intent. No second narrator model, no main private message writer.
Public stored main message uses ordered content text blocks, not a flattened string. Claim records actual block lengths/digests; ACK ignores tool/thinking and freezes exact visible append, interrupted publication reuses saved output.
Native report opener is configured only from an actual discovered public tool contract/ref and matching receipt paths. Missing public opener/client schema is explicit blocked, not guessed as host UI method. Method seven proposed catalogue identities require future public discovery/install/reuse/load/environment/formula/output evidence; ready/catalog/installed alone never adopted.

## 同一有界体验的公开正文恢复补强（0.1.3-dev.3.1）
服务只queue canonical round2-pk事实。主Agent用实际main tool host调用kurumi_narration diagnose/claim；公开tasks.read本会话当前active_response_message_id，messages.read返回的有序visible text blocks冻结为持久UTF16边界。主Agent直接在普通原生聊天自由发挥PK，不固定句式，不调用别的inference、不等injected writer；唯一event marker只是证据引用，不是文案模板。下一main-only ack读同一真实message ID新增visible正文，原文/messageId/eventId/asof/digest完整归档；thinking/tool值不stringify/hash/保存。
重复claim存在预约会先reconcile原保存ID并返回doNotRewrite:true。unknown/未看到正文保持pending，不再请主Agent重说；两次连续公开读连接失败留checkpoint并暂停，没有自动retry loop。publication中断用已保存完整正文恢复，不能将后来无关结尾混进PK。直到刷新、正文确认保持相同账户/图/marker/view frontier。
旧narration-queue额外inference+writer worker已禁用，不自动迁移或重复旧queue；旧facts/status仍可核验。emit不等于正文已送达，public消息已读不等于客户端可见，nativeUiVerified在真SDK/client实测前false。正式安装后由主Agent实测结构/追加/显示，不读私有chat/store、不伪造用户输入。
原生订单完整ABI及UI对接见CORE-ORDER-CHAT-HANDOFF.md与native-order-abi.js；当前实际native保护stop/filled/cancelled/反转/same-ms回归与partial/rejected ABI fixture要分开报告，legacy缺失coverage仍unknown，不从fills造working orders。

## dev.3.2实证公开回执流程纠偏
原native_report_bridge/opener与script raw rendered/visible point keys门槛过期。主玩家用kurumi_audience configure chart_id，pump/resume直接消费layout.inspect().rendering的same-version target状态+exact binding/instance/artifact/generation程序证据；script(read)仅描述源码。program/runtime != 原生像素，原作区间与实际fill/stop同图仍真实前端验。周报正常打开原生卡片/page后pump只读artifacts.receipts(exactRef)，sesame-report rendered才native page，sesame-report-inspector只是检查。raw不造operationId/asof/evidence，wrapper从sealed job冻结ref/input/period派生；双方归档完成+main canonical正文ack再release。无需不存在opener，不自动注入DOM/chat/私有HTTP。旧selector配置明确忽略不重调用。
真实主message.content数组已observed；只看有序顶层text blocks，持久UTF16 block边界与visible前缀digest，末块追加/后来新块原序拼合不插分隔符。未知/改写pending，saved id reconcile不重说，重复ACK原ref。fixture和observed shape非SDK/native显示通过。
用户现已授权主Agent稳定后公开安装与bounded短测；作者CORE不安装/启paid角色周报，不再写“需后续允许”。剩余真实门槛见CORE-CLOCK-HANDOFF最新dev.3.2部分。

## dev.3.3 fixed-data SDK correction
Fixed annotation data is closed_only; dynamic chart bars remain forming include. Exact code/definition digest pins presentation publication and memo. No account or execution logic changes. See FORMING-FIX-HANDOFF.md. Native pixel and dynamic-account gates remain unverified until actual evidence.
