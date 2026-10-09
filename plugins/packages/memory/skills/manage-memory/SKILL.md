---
name: manage-memory
description: 检索、核验和整理带来源的长期记忆，处理候选、冲突、归档与遗忘。
---

先检索同一事实，修订已有条目而非不断新增。每条记忆必须有简短摘要、正文、作用范围和真实来源。user_message 必须是真实用户消息；子 Agent 委派消息不是用户表达。artifact 必须为已发布报告、保存策略版本或已封存成果，引用 revision 固定证据。

分类树：

- user/communication、user/workflow、user/constraints：仅 global；用户偏好与明确约束。
- projects/<project-id>/overview、architecture、decisions、conventions：project 范围。
- projects/<project-id>/strategies/<strategy-id>/hypotheses、findings、limitations：strategy 范围；假设不能标为已验证。
- lessons/user-corrections、research-methods、data-quality、mt5-mql5、plugins-tools：按实际情况使用 global、project 或 strategy。
- references/repositories、documentation、datasets、skills-plugins、artifacts：保存位置、用途、版本和读取条件。

global 对各任务可见；project 和 strategy 由运行时分配的任务范围决定，工具参数不能自授权。主 Agent 可以管理全部范围。classification 与 scope 是两件事：例如 lessons/data-quality 可以仅限某项目。

evidence 使用 explicit（有明确用户消息）、verified（有成果证据）、inferred（推断）、conflicted（冲突）。同一范围与分类下，同标题的不同内容会形成显式冲突。核验后用带 expected_version 的 save 修订、合并；不要用覆盖掩盖分歧。固定用户约束优先于推测，不会自动提高权限。

生命周期默认：30 天未采用进入 warm，90 天进入 archived；归档可通过 memory_search 召回。pinned、explicit 的 user/constraints 不因闲置移出热区；其他用户偏好可以归档但不会自动硬删除。expires_at 到期的事实不进入启动索引或默认搜索。review_at 是复核提醒，不能代替 expires_at。低价值 inferred 条目仅在未钉住、未被成果/用户决策引用、非用户偏好且闲置满 365 天后清除；可在应用设置中调整或禁用。候选默认 14 天过期，子任务终结会更早删除未合并候选。

搜索、阅读、展示索引不算采用。只有真正影响一个最终成果或明确用户决策后，调用 memory_mark_used 并填写来源和具体原因。同一来源重复调用幂等，不刷新时间。

用户要求遗忘时，先读取版本，再 forget。服务清除记忆正文、历史版本、候选、检索索引和生成摘要，并用不含正文的指纹阻止旧来源自动重建。运行时还需清除受追踪的 Pi 工具副本并重建相关会话。原始用户消息、已发布报告中的独立内容、任意人工转述和外部备份不属于记忆服务可精确擦除的副本，不要宣称它们已被删除。
