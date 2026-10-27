# 本地通讯两次 emit 回执核验

观察窗口：2026-10-20T16:19:12.323Z 至 2026-10-20T16:32:22.534Z。本切片只读主 WAL、本轮主会话 JSONL 和固定 QA 包源码；没有调用 API、模型或能力，没有读取子 SQLite。

结论：两次真实提交已证实；每次都有独立 host events.emit callId，返回同一 eventId=152739，宿主只生成一条可见用户输入。现有验证器漏读由时间字段选择错误造成。

| 提交 | JSONL 工具完成 | host callId | eventId | 状态 |
|---|---|---|---|---|
| 1 | 2026-10-20T16:26:15.496Z | e8cde106-682a-4822-b273-ee01b230f8e7 | 152739 | completed |
| 2 | 2026-10-20T16:26:26.744Z | 5059b60c-101c-438a-a0a3-7b839ca28d7c | 152739 | completed |

对应 2 条 capability_operation 均 completed，固定输入全文一致（只保留规范化摘要）；JSONL 每次在 details 与 content 中各出现一份同一回执，原始共 4 次出现，按 host callId 去重后是 2 次，未重复计数。两条记录的精确 ID、receipt 时间及工具调用 ID 见同名 JSON。

入站 plugin-message:4a37d72b200ed8965262ee5d36a7680bb6d7c1264c3303821e740fbabd0b2163 于 2026-10-20T16:26:15.398Z 建立，2026-10-20T16:26:15.633Z 投递至普通队列。唯一用户输入 msg_301c7416-8fb0-45bb-8b62-3e2002170509；关联回复 msg_18bacf43-3350-4a10-b156-0dda0763a950 于 2026-10-20T16:29:08.424Z completed，内容恰为 ACK-QA20261020，工具片段为 0。完整无业务副作用检查仍由端到端验证器独立收口，不能仅凭 emit completed 代替它。

临时包边界：

- qa/local-inbound-20261020 v0.1.0，当前安装摘要 sha256:3b6dd0da278d36c18b94bf5a4c9c1721785ea507a3234b2f1d4f2d819054734b。
- 只有一个 immediate 显式能力；固定 channelId、senderId、messageId、text、as:user、confirmLocalTest:true。schema 与运行时校验都拒绝缺失、额外或不同字段。
- 固定发送者是本次获授权的本地 QA 别名；没有外部平台账户或真人认证声明。host 用当前插件上下文绑定 pluginId/revision，并校验当前版本和运行状态。
- services/hooks/sources/views 均为空、配置字段为 0；index 仅注册能力。source 仅在显式调用中执行一次 events.emit，无启动发送、timer、订阅、自动回复或插件侧去重。
- 主 WAL 接收来源与当前插件摘要、固定渠道、发送者和消息 ID 一致。重复 emit 返回原 eventId；ingress.attempts=1 表示队列投递次数，不能拿它当提交次数。

验证器最小建议：

[verify-message-ingress.mjs](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/verify-message-ingress.mjs:143) 查询 capability_operation.created_at，但两条实体没有该字段，故得到 0。当前改以 updated_at 限窗得到 2。数据仍应取 capability_operation.result.value.hostReceipt，无需改到 plugin_call（本包是 native immediate，不是 MCP 调用）。

[capability-service.js](E:/brief2great/sesame/mt5agent/modules/plugins/capability-service.js:419) 初次 put 没写 created_at；[store.js](E:/brief2great/sesame/mt5agent/modules/agent/store.js:240) 的 update 仅补 updated_at。建议按 updated_at 或 capability_operation.updated 的事件时间限窗，仍校验精确 capability、插件、固定身份和 eventId，并明确要求 Set(hostReceipt.callId).size===2。不要将 JSON 包装器、operation 外层 receipt 或同一回执的两个序列化副本计为额外发送。

未改验证器或产品，未重放。已有两次真实回执完整，不需要追加发送。

补充：ACK 期间自动上下文与记忆操作

七个精确能力事件已写入 JSON（seq、actorPluginId、callId、operationId、时间、状态齐全）：153167/153168 是宿主 refreshIndex 的上下文准备；153200/153201/153202/153216/153217 是 sesame/memory 的 beforeCompact 整理链。host.model.complete 的调用者明确是 sesame/memory，不是 ACK 主回复的工具调用。

153218 的 workspace.memory.compaction 回执为 completed、counts={saved:1}、processedChunks=1、pendingSources=0；153219/153220 的 beforeCompact completed 与其 checkpointId 完全相同。源码先 validatePlan 再应用条目与递增 processedChunks，因此本次计划通过校验并真实保存 1 条记忆。没有读取该记忆正文，不能把“ACK 无业务工具”扩大为“整个宿主无任何状态写入”。

普通队列 16:27:50.899 启动，ACK 在 16:28:04.375 已写入 Pi 日志（13.476 秒）；自动记忆模型耗时 9.410 秒，beforeCompact 于 16:28:15.800 完成。随后上下文压缩在 16:29:08.414 写入日志，响应 16:29:08.424 completed，总耗时 77.525 秒。ACK 正文到完成状态的尾段为 64.049 秒，其中 hook 完成至压缩记录为 52.614 秒。这些是可观测阶段时长，不是对模型思考时间的推断。

验证器只应对本次精确事件及对应 actor/checkpoint/回执作自动维护分类，不应全局允许任意 host.model.complete。正文恰为 ACK、没有主动工具的结论成立；自动记忆保存与压缩成本需单独保留。
