# 本地通讯回环验收脚本

本轮真实回环已验收通过。两次独立 host emit 回执指向同一 eventId `152739`，只生成一个带插件来源的用户输入及一个 completed 的精确 `ACK-QA20261020`。对应 [持久化核验](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/message-ingress-verification.json)、[独立回执与后台活动审计](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/message-ingress-receipt-audit.md) 和 [16:37 实际界面核验](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/message-ingress-ui-2026-10-20T16-37-33.183Z.json)。

ACK 无主动工具调用；同一时间段确实发生了自动记忆整理，并保存 1 条记录。因此不将本轮描述为“完全没有状态变化”。7 个后台能力事件只按独立审计确定的事件号、调用身份、时点及 3 个关联 checkpoint 回执分类；不全局放行任意模型调用。

真实测试提交并保留 `message-ingress-submission.json` 后运行：

```powershell
node E:/brief2great/sesame/outputs/live-plugin-qa-20261020/verify-message-ingress.mjs
```

默认使用该提交文件的 `submittedAt`。也可明确传入本次**实际提交**的时间：

```powershell
node E:/brief2great/sesame/outputs/live-plugin-qa-20261020/verify-message-ingress.mjs --since 2026-10-20T13:00:00.000Z
```

示例时间只是调用格式，执行时必须替换；不要使用验收时的当前时间。缺少时间边界会返回 pending。输出为同目录 `message-ingress-verification.json`；退出码 0=verified、2=pending、1=fail。重复运行只更新这份诊断结果。

验收依据实际源码：

- `plugin-message-ingress.js`：`plugin_message_ingress` 的 `pending → delivered`，来源字段和正文 fingerprint；幂等键由 pluginId、channelId、messageId 生成。
- `host-v2/events.js`：真实 `events.emit` 回执包含 completed、eventId、actor、target.topic、timestamp。completed 表示入站落盘，不代表模型处理完成。
- `runtime.js`：入站用户消息的 `channel_source`、`run_delivery.startedAt`、对应回复的 queued/streaming/completed 事件。
- `message-segments.js`：实际结束回复的 `final_segment_id`，最终内容必须恰好为 `ACK-QA20261020`，整个测试窗口只允许一个已完成的完整 ACK。
- `capability-service.js`：从这个 QA 插件的 `capability_operation.result.value` 中提取两份可区分的真实 emit 回执，同 eventId、两个不同 callId。该实体没有 created_at，使用实际 updated_at 限定时窗。重复包装的同一回执不算第二次提交。入口 `attempts` 是后台投递重试数，不是 emit 提交数。

脚本要求两份原始 host 回执已保留在正式工具结果中；如果插件仅返回自行编造的“重复已处理”说明、只保留一份回执、结果被清理或仅保留 summary，则明确 pending，不会据一个入站记录推定已经重试。来源插件、渠道、发送者和外部消息 ID 会按实际字段交叉核对；非 QA/local/test 标识及 UUID 以外的标识只输出摘要，不暴露潜在真实账户标识。

脚本只打开主 `app.sqlite`，以 readOnly + query_only + WAL 断言执行一次一致性快照，不导入 Store/Runtime，不读任何子 SQLite、Pi 正文、配置或凭据，不调用 UI、模型、行情或交易接口。主动业务动作检查限定于 ACK 回复的工具段，以及该回复执行期间归属主会话的 capability/Run/execution 审计；自动后台活动须与上述固定独立审计逐项吻合，不把它扩张成对外部账户的独立对账结论。独立回执审计另外读取了本次 QA 的主会话 JSONL 元数据。

最初验证器误用 created_at 漏掉了两份回执，并把自动后台能力也算成 ACK 主动业务，产生了一次误报，见 [初始诊断](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/message-ingress-verifier-initial-failure.json)。这属于 QA 脚本修正，产品没有因此修改，也没有重放消息。UI 检查使用最终回复节点，正常的折叠过程提示不算额外 ACK。

纯内存自检：

```powershell
node E:/brief2great/sesame/outputs/live-plugin-qa-20261020/verify-message-ingress.mjs --self-test
```

覆盖正常完整证据、仅 accepted/delivered 尚未完成、缺第二份回执、相同 callId 的不同包装/时点、重复 ACK、来源不一致、ACK 中误调用工具，以及未审定的后台模型调用不能被当作正常维护放行。
