---
name: manage-memory
description: 每次压缩前自动整理带来源的长期记忆；检索、核验候选，处理冲突、归档与遗忘。
---

用户明确要求记住或确有持久价值时，先检索同一事实再保存。使用已有用户消息或发布成果，不为保存运维经验另造报告或数据集；普通任务完成后直接交付，自动整理沿用压缩前钩子。user_message 必须是真实用户消息；子 Agent 委派消息不是用户表达。artifact 引用已发布成果及固定 revision。

scope 使用 `{kind:"global"}`、`{kind:"project",project_id:"真实项目ID"}` 或 `{kind:"strategy",project_id:"所属项目ID",strategy_id:"真实策略ID"}`。策略范围必须包含所属项目；不要为绕过缺参把局部事实改成 global。

分类树：

- user/communication、user/workflow、user/constraints：仅 global；用户偏好与明确约束。
- trading/style、trading/risk-rules、trading/strategy-knowledge：分别是交易偏好、用户确认的风险红线、市场/算法/指标认知；scope 仍按实际 global/project/strategy 使用。实盘与规则设定详见 personal-trading-memory skill。
- projects/<project-id>/overview、architecture、decisions、conventions：project 范围。
- projects/<project-id>/strategies/<strategy-id>/hypotheses、findings、limitations：strategy 范围；假设不能标为已验证。
- lessons/user-corrections、research-methods、data-quality、strategies、plugins-tools：按实际情况使用 global、project 或 strategy，注明适用的后端。
- references/repositories、documentation、datasets、skills-plugins、artifacts：保存位置、用途、版本和读取条件。

scope 标记记忆适用的全局、项目或策略上下文，当前工作区的会话均可检索；参数不改变应用权限。主 Agent 管理正式记忆，子 Agent 提交候选。分类与 scope 是两件事：例如 lessons/data-quality 可以只适用于某项目。

用户消息来源形状为 `{type:"user_message",id:"实际消息ID"}`；可通过 data_query 的 `{source:{providerId:"host#messages",revision:"host:2"},input:{sessionId:"当前会话ID"}}` 读取真实消息。成果来源为 `{type:"artifact",id,revision,kind,digest,schemaVersion}`。新偏好的最小保存形状：`memory_manage({action:"save",entry:{category:"user/workflow",title,summary,content,scope:{kind:"global"},sources:[真实来源],evidence:"explicit"}})`。返回 `id/version/status` 后才有保存证据；修订使用这份 version 作为 expected_version。

evidence 使用 explicit（有明确用户消息）、verified（有成果证据）、inferred（推断）、conflicted（冲突）。同一范围与分类下，同标题的不同内容会形成显式冲突。核验后用带 expected_version 的 save 修订、合并；不要用覆盖掩盖分歧。固定用户约束优先于推测，不会自动提高权限。

`trading/risk-rules` 正式条目只允许 explicit，不接受 expires_at，保存时自动固定。每次 save/accept/archive/restore/forget 在 `memory_manage` 顶层增加 `confirmation_source:{type:"user_message",id:"本次真实确认消息ID"}`；正文修改、撤销和恢复不能重用旧 `confirmed_by`。代码验证来源身份，调用者须确认原话确实同意具体阈值和操作，不能把普通问询当确认。未获确认时用 propose 留草案；自动压缩永不自动接纳风险候选。不要改分类解除保护。`review_at` 到期表示需要复核，原红线仍然约束新增风险。

交易任务用 `memory_trading_context({})` 取得完整风险正文及风格、策略认知摘要；全范围返回的规则要核对具体账户，不能因同为 MT5/QMT 就跨账户套用。风险正文超过预算时返回 `complete:false` 与 `unread_risk_rule_ids`，按 ID 用 `memory_read({id,offset:0,length:4000})` 及 `next_offset` 分段读全；`next_risk_offset` 非空时用 `risk_offset` 续取规则。跨段检查 version，不把 `_tool_output_truncated` 预览当正文。缺失、冲突、复核到期均明确显示。`documented` 不是实盘放行，未接纳候选不是现行规则。

## 来源与候选的正确形状

`sources` 的每一项都需要 `type`，ArtifactRef 本身没有这个字段。真实用户表达使用 `{type:"user_message",id:"实际用户消息ID"}`。冻结成果使用 `{type:"artifact",id:ref.id,revision:ref.revision,kind:ref.kind,digest:ref.digest,schemaVersion:ref.schemaVersion}`，等价于 `{type:"artifact",...ref}`；`revision` 是原来的字符串，不能改成整数或省略摘要。API2 只接受完整冻结引用，不接受旧报告整数版本。不要把成果重新标为用户消息以通过校验。

`memory_propose` 返回候选正文以及候选的 `id/version`，它们不是正式记忆 ID/版本。主 Agent 用 `memory_manage {action:"candidates"}` 重新读取候选，核验后调用 `{action:"accept",id:candidate.id,expected_version:candidate.version}`。接纳结果的顶层 `id` 仍指候选；`memory.id` 和 `memory.version` 才是正式记忆，应将 `memory.id` 传给 `memory_read`。子 Agent 保留 propose 回执并通知主 Agent 处理，不能自己管理候选或猜测正式 ID。

遇到 `version_conflict`，按对象重读：候选用 `memory_manage action=candidates`，正式记忆用 `memory_read`。比较最新内容后重新决定操作，使用实际返回的 `version`，不递增猜测、删除 CAS 或自动重放旧写入。候选不在列表可能已接纳、拒绝、过期或随任务清理，不能仅凭相似标题换成另一个来源。过期候选需要重新读最终成果并核验后才提取；来源不可用则保留未确认状态。

## 每次压缩前的整理

capabilities.json 的 `lifecycle.beforeCompact` 钩子绑定 `memory_before_compact`，覆盖手动压缩、上下文达到阈值和溢出重试，由宿主调用。插件复用当前会话已经配置的模型做一次有界整理；来源较长时分块，每次最多处理六块，未完成的下次继续。

- 从将被压缩的真实用户消息、当前会话的近期已发布成果、待核验候选的原始来源提炼；不把旧压缩摘要、助手的自述、工具日志或委派消息当作已验证事实。
- 优先保存稳定偏好、用户纠正、项目决定、可复用经验和最终成果引用；跳过任务流水、即时行情和账户余额、密码与密钥。关键结论必须引用原文证据，完整保留成果版本。
- 检索同一主题（包括归档），合并普通条目；推断只产生候选。被固定的约束、冲突、过期条目和未完整读到的长条目交由主 Agent 核验，自动整理不会覆盖。
- 子 Agent 自动整理也只能提候选。确有重要候选时随最终摘要附引用；主 Agent 按需依据原始成果接纳，审核不阻塞已经完成的任务交付。
- 同一来源处理进度在重启后保留，已处理的消息不因重复压缩再次保存。日志只保存来源引用、摘要指纹和计数，不另存聊天正文或模型输出。整理不会标记“已采用”，旧记忆照常变冷。
- 模型暂不可用、计划无效或出现版本冲突时保留来源引用，继续正常压缩；下一次从持久来源恢复。写入结果不明的操作不盲目重放。`memory_manage action=stats` 的 `compaction` 返回最近状态、计数及剩余来源数量。不要把 partial/failed 说成全部完成。

用户明确“记住”时仍即时保存，不等压缩；用户要求遗忘时用正式 forget 流程。自动整理不会自行遗忘、提高权限、恢复已处理来源中的已遗忘内容，或因为经常检索某条记忆就把它保留在热区。

参考 Hermes 的[压缩前记忆钩子与来源规范](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/memory-provider-plugin.md)，采用压缩前提炼和失败继续的方式；持久存储、分类、来源验证与闲置处理沿用 Sesame 自己的记忆服务。

生命周期默认：30 天未采用进入 warm，90 天进入 archived；归档可通过 memory_search 召回。pinned、explicit 的 user/constraints 不因闲置移出热区；其他用户偏好可以归档但不会自动硬删除。expires_at 到期的事实不进入启动索引或默认搜索。review_at 是复核提醒，不能代替 expires_at。低价值 inferred 条目仅在未钉住、未被成果/用户决策引用、非用户偏好且闲置满 365 天后清除；可在应用设置中调整或禁用。候选默认 14 天过期，子任务终结会更早删除未合并候选。

正式交易红线不按闲置归档/清除，也不能自动过期；撤销须带用户确认进行归档或遗忘。交易风格属于个人偏好，可变冷和归档但不因低价值推断自动删除。归档红线的读取或 mark_used 不能重新启用规则；恢复也须本次确认。

搜索、阅读、展示索引不算采用。只有真正影响一个最终成果或明确用户决策后，调用 memory_mark_used 并填写来源和具体原因。同一来源重复调用幂等，不刷新时间。

用户要求遗忘时，先读取版本，再 forget。服务清除记忆正文、历史版本、候选、检索索引和生成摘要，并用不含正文的指纹阻止旧来源自动重建。运行时还需清除受追踪的 Pi 工具副本并重建相关会话。原始用户消息、已发布报告中的独立内容、任意人工转述和外部备份不属于记忆服务可精确擦除的副本，不要宣称它们已被删除。
