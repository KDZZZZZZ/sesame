# 本轮记忆、停用评审计划与 W3 文件效果核验

本切片确认 **QA 记忆完整生命周期及实际 markUsed 通过**；评审计划只建立并停用，**没有真实评审运行结果**。Judgment 只有空列表/空队列检查，QMT 缺少运行所需配置。W3 已正常清理，保留文件哈希和中文完整性可以验证，分页及修改等中间操作保留为 partial。

固定工具时窗：2026-10-20 14:42:52.742 至 **16:08:30 UTC（不含）**。逐项结果和调用 ID 见 [daily-state-effects-audit.json](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-state-effects-audit.json)，提取器见 [daily-state-effects-audit.mjs](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-state-effects-audit.mjs)。没有等待最后清理或延长跟踪。

| 验收项 | 状态 | 具体结果与边界 |
| --- | --- | --- |
| QA memory 候选 → 接受 | pass | 15:40:23 创建带明确 QA 标记的候选 `memcandidate_b80b3703-d47c-4f4d-b2ba-cc750207ccbf`；15:42:04 正式接受为 `mem_dfeb6d2b-1f86-4123-821f-b61081bd2c97`，v1/hot、use_count=0。 |
| QA memory 读回 | pass | 15:42:44、15:49:35 真实读回 v1；最终 15:58:05、16:08:12 真实读回 v4/archived。只核对本条 QA 记录，未解析既有私人记忆的 search/read/list 结果正文。 |
| 实际 markUsed | pass | 15:53:16 `memory_mark_used` 回执中 use_count 从 0 增至 1，last_used_at=15:53:14.806。此前两次读取并未增加计数，不能用“读过”冒充“已标记使用”。此项不扩展为长期记忆改善研究质量的证明。 |
| 归档 → 恢复 → 最终归档 | pass | 15:54:31 v2/archived → 15:54:46 v3/hot → 15:55:00 v4/archived。manually_archived 随步骤 true/false/true，最终两次读回仍 archived；QA 内容摘要全部保持一致，没有输出其正文。 |
| 只评审计划的保存/停用 | pass（配置生命周期） | 15:53:59 保存、15:54:31 pause，16:08:12 列表仍存在。enabled=false、workflow.execute=false，intervalMinutes=null、eventKeys=[]、accountEvents=false、nextDueAt=null、lastRunId=null。 |
| execute:false 的实际评审运行 | 未验证 | 本窗口无 `trading_decision_run`/execute 调用，只有 models、plan save/list/pause 和 runs list；保存 execute:false 不等于已经执行评审。没有模型评审意见、运行结果或报告可用于本项验收。 |
| Judgment 前瞻记录及 resolve | 未验证 | rules/list/review_queue 返回 0 项，统计没有已登记/已解决样本。没有 register/record/resolve/reflect 调用证据；空队列检查不证明形成了前瞻判断，更不能证明后验 resolve。 |
| QMT 可运行条件 | blocked | 环境检查 Run completed，但缺实际 MiniQMT localhost 行情端口、既有 broker userdata_mini 目录、获授权 STOCK account ID；sdk_verified=false、terminal_started=false。发现 2 个 Python 候选不等于 SDK、连接或账户可用，不是 QMT 业务查询成功。未输出账户值、路径或密钥。 |
| W3 复用文件哈希 | pass（保留副本） | 冻结附件记录源、本地副本、主工作区副本三方哈希相同。当前保留的主工作区副本实际为 28,841 字节，独立 SHA-256 与附件一致。只读取字节计算哈希，未复制或输出其业务内容。 |
| W3 中文 UTF-8 完整性 | pass（冻结内容） | 初始哈希附件中的中文测试文本重建为 135 字节，SHA-256 与 original/host 两个记录相同，replacement_char=false。未重新执行业务文件操作。 |
| W3 分页、编辑、移动、删除、重建 | partial | 冻结 qa-observations 记录 0/30 字节偏移、30/105 字节两页拼回 135 字节；hash-guarded replace、move 保持哈希、仅删除 QA 副本后由保留原文重导入。已有成功工具调用元数据，但 W3 已 succeeded/cleaned，原 JSONL 删除，无法重新核对每个原始 inline 回执。重导入不是独立 restore API；host_files_write 替换也不是独立 exact-edit 入口。 |
| W3 报告源文件生命周期 | partial | 冻结附件记录同 stable ID：create v101、read、CAS replace v110、move v113、delete v118。dirty=true、published=false；这些是源文件操作，不能当作发布成功。原 inline 同样已清理。 |
| W3 generic ResourceRef 读取 | blocked | 冻结观察明确记录 `Resource belongs to another plugin`；另一条针对实际文件路径的 host_files_read 成功。两者属于不同接口结果，不能用后者掩盖前者，也没有依据将所有权拒绝认定为缺陷。 |

`qa-observations.json` 与 `initial-file-hash-audit.json` 均来自测试索引**固定 v2**（`rep_f6cfb3cf-36aa-452a-a809-ed8e44863d32:2`），对应不可变 report artifact `artifact_841a3401-55df-4340-93a3-a8ff8e35980b / revision_1d501821-cf4a-49d1-9d7e-0cdc1591b55e`。本审计直接校验两附件字节数及内容寻址 digest，没有请求 API。文件副本摘要为 `sha256:69eb30ea81f3932f8fb3fd1a0f42376044d272c1299d36f5dd043cfce1909ae3`；中文测试摘要为 `sha256:a49d3c8cc9b99555d441b997e0d72b56bb2d7c2940b964ca1d4798fe5bfa3b25`。

附件说明正式 workspace 能力未声明 search，测试的是独立 host_files_search；不把名称相近的能力合并计为通过。notes 插件已由独立审计覆盖，本切片没有重做。

策略报告状态同步：此前 v1 渲染失败保留为历史，真实 Agent 已修正并发布 v2；root 的 16:03 真实 UI 和报告内 5 节点/函数展开证据已补到 [策略审计](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-strategy-effect-audit.md)。当前报告交付为 pass，不能继续标成待修。16:04 的 Run 释放超时是另一审计负责的独立收尾问题。

取证只读主 WAL（readOnly/query_only）、当前主会话 QA 日志及上述固定附件；活跃子 SQLite 读取 0，模型/API/业务请求 0，产品/配置/业务数据写入 0。没有继续重试缺依赖或已清理的分支。
