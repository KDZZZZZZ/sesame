---
name: manage-memory
description: 每次压缩前自动整理带来源的长期记忆；检索、核验候选，处理冲突、归档与遗忘。
---

用户明确要求记住或确有持久价值时，先检索同一事实再保存。使用已有用户消息或发布成果，不为保存运维经验另造报告或数据集；普通任务完成后直接交付，自动整理沿用压缩前钩子。user_message 必须是真实用户消息；子 Agent 委派消息不是用户表达。artifact 引用已发布成果及固定 revision。

scope 使用 `{kind:"global"}`、`{kind:"project",project_id:"真实项目ID"}` 或 `{kind:"strategy",project_id:"所属项目ID",strategy_id:"真实策略ID"}`。策略范围必须包含所属项目；不要为绕过缺参把局部事实改成 global。

分类树：

- user/communication、user/workflow、user/constraints：仅 global；用户偏好与明确约束。
- projects/<project-id>/overview、architecture、decisions、conventions：project 范围。
- projects/<project-id>/strategies/<strategy-id>/hypotheses、findings、limitations：strategy 范围；假设不能标为已验证。
- lessons/user-corrections、research-methods、data-quality、strategies、plugins-tools：按实际情况使用 global、project 或 strategy，注明适用的后端。
- references/repositories、documentation、datasets、skills-plugins、artifacts：保存位置、用途、版本和读取条件。

global 对各任务可见；project 和 strategy 由运行时分配的任务范围决定，工具参数不能自授权。主 Agent 可以管理全部范围。classification 与 scope 是两件事：例如 lessons/data-quality 可以仅限某项目。

evidence 使用 explicit（有明确用户消息）、verified（有成果证据）、inferred（推断）、conflicted（冲突）。同一范围与分类下，同标题的不同内容会形成显式冲突。核验后用带 expected_version 的 save 修订、合并；不要用覆盖掩盖分歧。固定用户约束优先于推测，不会自动提高权限。

## 来源与候选的正确形状

`sources` 的每一项都需要 `type`，ArtifactRef 本身没有这个字段。真实用户表达使用 `{type:"user_message",id:"实际用户消息ID"}`。冻结成果使用 `{type:"artifact",id:ref.id,revision:ref.revision,kind:ref.kind,digest:ref.digest,schemaVersion:ref.schemaVersion}`，等价于 `{type:"artifact",...ref}`；`revision` 是原来的字符串，不能改成整数或省略摘要。旧宿主报告的数字 revision 只用于实际返回的旧报告引用，不能拿来代替 ArtifactRef。不要把成果重新标为用户消息以通过校验。

`memory_propose` 返回候选正文以及候选的 `id/version`，它们不是正式记忆 ID/版本。主 Agent 用 `memory_manage {action:"candidates"}` 重新读取候选，核验后调用 `{action:"accept",id:candidate.id,expected_version:candidate.version}`。接纳结果的顶层 `id` 仍指候选；`memory.id` 和 `memory.version` 才是正式记忆，应将 `memory.id` 传给 `memory_read`。子 Agent 保留 propose 回执并通知主 Agent 处理，不能自己管理候选或猜测正式 ID。

遇到 `version_conflict`，按对象重读：候选用 `memory_manage action=candidates`，正式记忆用 `memory_read`。比较最新内容后重新决定操作，使用实际返回的 `version`，不递增猜测、删除 CAS 或自动重放旧写入。候选不在列表可能已接纳、拒绝、过期或随任务清理，不能仅凭相似标题换成另一个来源。过期候选需要重新读最终成果并核验后才提取；来源不可用则保留未确认状态。

## 每次压缩前的整理

插件已经注册 `host.lifecycle.onBeforeCompact`，覆盖手动压缩、上下文达到阈值和溢出重试。不是靠你记得调用某个命令，也不是向用户聊天插入定时提示。插件复用当前会话已经配置的模型做一次有界整理；来源较长时分块，每次最多处理六块，未完成的下次继续。

- 从将被压缩的真实用户消息、当前会话的近期已发布成果、待核验候选的原始来源提炼；不把旧压缩摘要、助手的自述、工具日志或委派消息当作已验证事实。
- 优先保存稳定偏好、用户纠正、项目决定、可复用经验和最终成果引用；跳过任务流水、即时行情和账户余额、密码与密钥。关键结论必须引用原文证据，完整保留成果版本。
- 检索同一主题（包括归档），合并普通条目；推断只产生候选。被固定的约束、冲突、过期条目和未完整读到的长条目交由主 Agent 核验，自动整理不会覆盖。
- 子 Agent 自动整理也只能提候选。确有重要候选时随最终摘要附引用；主 Agent 按需依据原始成果接纳，审核不阻塞已经完成的任务交付。
- 同一来源处理进度在重启后保留，已处理的消息不因重复压缩再次保存。日志只保存来源引用、摘要指纹和计数，不另存聊天正文或模型输出。整理不会标记“已采用”，旧记忆照常变冷。
- 模型暂不可用、计划无效或出现版本冲突时保留来源引用，继续正常压缩；下一次从持久来源恢复。写入结果不明的操作不盲目重放。`memory_manage action=stats` 的 `compaction` 返回最近状态、计数及剩余来源数量。不要把 partial/failed 说成全部完成。

用户明确“记住”时仍即时保存，不等压缩；用户要求遗忘时用正式 forget 流程。自动整理不会自行遗忘、提高权限、恢复已处理来源中的已遗忘内容，或因为经常检索某条记忆就把它保留在热区。

参考 Hermes 的[压缩前记忆钩子与来源规范](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/memory-provider-plugin.md)，采用压缩前提炼和失败继续的方式；持久存储、分类、来源验证与闲置处理沿用 Sesame 自己的记忆服务。

生命周期默认：30 天未采用进入 warm，90 天进入 archived；归档可通过 memory_search 召回。pinned、explicit 的 user/constraints 不因闲置移出热区；其他用户偏好可以归档但不会自动硬删除。expires_at 到期的事实不进入启动索引或默认搜索。review_at 是复核提醒，不能代替 expires_at。低价值 inferred 条目仅在未钉住、未被成果/用户决策引用、非用户偏好且闲置满 365 天后清除；可在应用设置中调整或禁用。候选默认 14 天过期，子任务终结会更早删除未合并候选。

搜索、阅读、展示索引不算采用。只有真正影响一个最终成果或明确用户决策后，调用 memory_mark_used 并填写来源和具体原因。同一来源重复调用幂等，不刷新时间。

用户要求遗忘时，先读取版本，再 forget。服务清除记忆正文、历史版本、候选、检索索引和生成摘要，并用不含正文的指纹阻止旧来源自动重建。运行时还需清除受追踪的 Pi 工具副本并重建相关会话。原始用户消息、已发布报告中的独立内容、任意人工转述和外部备份不属于记忆服务可精确擦除的副本，不要宣称它们已被删除。
