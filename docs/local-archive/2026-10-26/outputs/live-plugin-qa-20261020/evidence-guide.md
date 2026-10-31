# 新插件真实主会话测试：紧凑取证

只读取本次测试，不发送消息、不启动模型、不改配置。使用当前桌面的实际 origin；不要沿用旧 fixture 的 `8876` 端口。HTTP 通过已登录页面的同源请求访问，不提取或记录认证信息。以下接口均为 GET，返回普通 JSON 对象。

1. **测试前**保存 `GET /api/v1/bootstrap` 的 `event_cursor`、`server_time`，记录主会话当前状态、现有消息和 Run ID。记录主会话 JSONL 文件的完整行结束位置；后续只读新增行。
2. **测试期间**从开始游标连接 SSE，按本次消息/Run ID 过滤；子会话一创建就定位其 JSONL 并提取用量。先投影允许字段，再写文件。
3. **测试后**读取本次 Run、activity、主回复终态和完成通知回执，汇总用量及工具状态。关闭 SSE；不恢复任何历史暂停 Run。

| 证据 | 读取路径 | 只保留的字段与限制 |
| --- | --- | --- |
| 主会话是否空闲/续跑 | `/api/v1/conversations/conv_main`、`/queue` | `status`、`active_response_message_id`、`pending_message_count`，加采样时间 |
| 本次回复与工具 | `/api/v1/conversations/conv_main/history?limit=100` | 本次 `message.id/status/reply_to_message_id/final_segment_id`；工具 segment 的 `id/tool_name/status`。同一 segment 多次更新只计一次；不保存正文 |
| Run 与子 Run | `/api/v1/runs?limit=200`、`/runs/<id>`、`/runs/<id>/graph` | ID、kind、capabilityId、parentRunId、sessionId、executionSessionId、status、时间戳；Agent output 的 model/turns/toolCalls。默认列表只显示布局根；用 graph 或 `parentRunId` 找成员 |
| 持久化工具活动 | `/api/v1/runs/<id>/activity?limit=100` | `type=tool` 的 `data.id/name/status`；以调用 ID 去重。后续用返回的 `nextCursor` 作为 `cursor` |
| 实时变化 | `/api/v1/events?after=<开始游标>` | SSE `id/event/data`；仅保留游标、事件类型、时间及本次实体的状态/ID |
| 模型用量 | 指定会话的新增 Pi JSONL | 公开 HTTP/SSE、Run output **不提供 token usage**；见下文 |

`history` 是可见消息投影，自动完成通知的输入会被隐藏，不能据其缺失判断未送达。翻历史页需同时传 `before` 和该页面的 `view_version`。Run 列表分页使用 `page.next_cursor`。

SSE 监听 `conversation.updated`、`message.updated`、`run.updated`、`run_notification.updated`、`plugin.agent.updated`。`plugin.message.received/delivered` 属于通讯插件入站，不等于子任务完成通知。`message.delta` 正文不适合作紧凑证据。自动重连须携带最后游标；`Last-Event-ID` 与 `after` 同时存在时必须相等。超过 10000 条重放会返回 410，改取新快照。子任务清理后旧事件可能只剩 `task.process_purged` 占位，因此最终结论结合持久化 Run/history。

## 完成通知与闲置唤醒的证据链

只有 `kind=agent|workflow`、`status=completed`、没有 `parentRunId`、所有者为主会话的 Run 会发送完成通知。工作流内部成员由外层工作流汇总。

- 通知唯一 ID：`run-completed:<runId>:<attempt>`。记录 `run_notification` 的 `runId/ownerSessionId/createdAt/deliveredAt/responseId/deliveryAttempts`。
- `deliveredAt` 证明已接受并入队；匹配的 `run_delivery.startedAt` 证明主回复实际开始执行。通过共同的 `responseId` 关联，勿猜 `run_delivery.id`。
- `run_delivery.messageId` 对应隐藏输入，其元数据是 `role=delegation`、`origin=automation`、`system_generated=true`。对应 assistant 的 `reply_to_message_id` 指向此输入。
- “闲置后自动继续”的完整证据是：完成前主会话空闲 → 子 Run 完成 → 通知入队 → `startedAt` 非空 → 对应主回复进入执行并完成；中间没有新人工输入。单凭通知送达不算已完成续跑。
- 通知是系统结果，不增加用户授权。错误/取消/明确暂停与成功完成分别记录。

## 只读 SQLite 定位

主库：`%LOCAL_USER_PROFILE% SQLite 原生只读连接，例如 `new DatabaseSync(path, { readOnly: true })` 并设置 `PRAGMA query_only=ON`。**不要实例化应用 Store/Runtime**，其构造及恢复过程会写入。

主表为 `entities(kind,id,body)`、`events(seq,body)`、`execution_process_stores(run_id,path)`。`run`、`run_history`、`run_notification`、`run_delivery` 持久化在主库；子任务的 `message/pi_session/execution/plugin_call` 可能在对应 process DB。用本次 conversation ID 对应的 `task_run` 定位 process-store 索引，不扫描历史会话。

```sql
-- 参数 1：本次 run-completed:<runId>:<attempt>
SELECT n.id,
       json_extract(n.body,'$.runId') AS runId,
       json_extract(n.body,'$.ownerSessionId') AS ownerSessionId,
       json_extract(n.body,'$.createdAt') AS createdAt,
       json_extract(n.body,'$.deliveredAt') AS deliveredAt,
       json_extract(n.body,'$.responseId') AS responseId,
       json_extract(n.body,'$.deliveryAttempts') AS deliveryAttempts,
       json_extract(d.body,'$.messageId') AS inputMessageId,
       json_extract(d.body,'$.startedAt') AS startedAt,
       json_extract(d.body,'$.cancelledAt') AS cancelledAt
FROM entities n
LEFT JOIN entities d ON d.kind='run_delivery'
  AND json_extract(d.body,'$.responseId')=json_extract(n.body,'$.responseId')
WHERE n.kind='run_notification' AND n.id=?;

-- 在已定位的主库/本次 process DB 中，参数 1 为准确 conversation ID
SELECT json_extract(body,'$.path') AS path
FROM entities WHERE kind='pi_session' AND id=?;
```

只选白名单字段，不输出整条 `body`、消息内容、工具参数、配置或认证文件。

## JSONL 的用量与工具

对测试窗口内的完整新增行，以 `(sessionId, entry.id)` 去重，再投影：

- `type=message` 且 `message.role=assistant`：`provider/model/usage/stopReason`；`content` 中仅提取 `type=toolCall` 的 `id/name`。
- `message.role=toolResult`：`toolCallId/toolName/isError`，以及存在时的 `usage`；不保存结果正文。
- `type=usage`：`kind/provider/model/usage`；`type=compaction|branch_summary`：存在时的 `usage`。这些用量也纳入总数，但单列来源，避免把压缩调用当普通回复。
- 保留 usage 中 `input/output/cacheRead/cacheWrite/totalTokens/cost` 的原始数值；SDK 总 token 口径是 `input+output+cacheRead+cacheWrite`。按会话和 provider/model 汇总；缺失数值标为未知，不能补成零。无 model 元数据的压缩用量单列“未归属”。

主会话 trace 会保留；**子任务完成时会清理 JSONL 和 process DB**。需在运行期间提取新子会话元数据；清理后若未取到，明确写“子任务 token usage 不可追溯”，仍可用持久化 Run 的 model/turns/toolCalls 证明执行。不要因此禁用清理、复制全部 transcript、修改宿主或重新执行业务。

建议结果只存 `testId/startCursor/startAt/endAt/mainMessageId/runIds`，再附 `usageBySessionAndModel`、`toolsByCallId`、`completionDelivery` 和终态。避免保存用户文本、思考内容、工具参数及返回正文。

核对依据（本地源码）：`modules/agent/server.js:179,202`、`run-presentation.js:64`、`runtime.js:235,263,432`、`message-segments.js:1`、`store.js:12,87,269`、`workspace-service.js:64`、`task-cleanup-service.js:140,162`、`plugin-agent-tasks.js:210`；Pi SDK `dist/core/session-manager.d.ts:34`、`dist/core/agent-session.js:3304`。本说明仅查代码/schema，未读取 live 数据库或历史凭据。
