# QA 压缩与长期记忆整理审计

范围：`2026-10-20T08:03:02.802Z` 以后主工作区 QA 事件、关联主会话 trace 和源码。只读主 WAL 数据库；仅投影错误码、计数、模型调用状态、输出结构和作用域枚举，未输出记忆正文、模型输出正文、凭据或账号。未读取子任务数据库，未触发模型、压缩或业务操作。

## 结论

确认存在记忆整理提示词与输入命名的契约缺陷，导致模型把运行会话类型 `main` 当成记忆作用域。三次真实响应都是合法 JSON，但都含 `entry.scope.kind:"main"`，被严格验证器以 `MEMORY_PLAN_INVALID` 拒绝。这不是模型接口版本、配置缺失、上下文容量或请求超时错误，也未发现测试观察器干扰的证据。

长期记忆整理失败，主上下文压缩仍成功，主任务继续执行。cache-retest 主回复 `msg_23e6df49-9f61-4b0a-881c-e8449fc9d8d9` 已于 `10:24:17.396Z` 完成，读取状态无错误码。

## 三次失败及主压缩结果

下表时间均为 UTC。六条 lifecycle failed 是三次调用的双层审计，不是六次模型重试。

| 记忆整理回执时间 | 记忆事件 / lifecycle 事件 | 结果 | pendingSources | 主 checkpoint 保存时间 / trace 行 |
| --- | --- | --- | --- | --- |
| 08:29:11.289 | 93794 / 93795、93796 | `MEMORY_PLAN_INVALID`；0 块；counts 为空 | 23 | 08:30:02.771 / 992 |
| 09:35:28.898 | 96128 / 96129、96130 | 同上 | 25 | 09:36:28.757 / 1104 |
| 10:15:08.383 | 97749 / 97750、97751 | 同上 | 26 | 10:16:07.109 / 1201 |

三个对应的 `host.model.complete` 事件 93793、96127、97748 均为 completed，actor 为 `sesame/memory`。所用模型均为 `openai/gpt-6.1-sol`；输入均为 1707 tokens，输出分别为 441、457、494 tokens，持续约 13 秒。返回文本均为合法 JSON、一个 entries 元素；结构检查定位到 `scope.kind=main`，而不是长度超限、空输出或不完整响应。前置 host 校验已要求模型返回 `stop` 且身份匹配，见 [inference.js:70](E:/brief2great/sesame/mt5agent/modules/plugins/inference.js:70)。

## 根因与触发条件

修复前 [memory/compaction.js:188](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/compaction.js:188) 把 `services.context` 作为模型输入的顶层 `scope`。该 context 来自当前运行会话，主会话的 `kind` 和 `scope` 都是 `main`，见 [memory/service.js:70](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/service.js:70)。

修复前 `curation.md` 只描述 `scope {kind, project_id?, strategy_id?}`，没有明确列出合法的 kind。模型三次均照用了输入中的 `main`。但 [验证器:68](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/compaction.js:68) 只接受 `global/project/strategy`；项目与策略 scope 还需要对应 ID。因此运行上下文与记忆作用域混同是本次稳定出现的缺陷。

拒绝本身正确，不能将 `main` 自动改为 global 或放宽验证。主 Agent 可以整理有证据支持的全局、项目和策略记忆；运行在主会话不意味着所有事实适用于全局。

模型 system 消息传输未发现问题：当前安装的 pi-ai Context 支持显式 system 消息，并在 OpenAI Responses 转换器中处理。无需更改宿主模型接口。

## 对任务与数据的影响

- 三次均在 validatePlan 阶段失败，尚未进入本块记忆写入，processedChunks 为 0、counts 为空。待处理来源引用继续保留，数量从 23 增至 26；不能把长期记忆整理能力记为通过。
- 主压缩独立成功：三个 trace checkpoint 均为 `sesame-checkpoint-v1`，含非空 summary 和可定位的 firstKeptEntryId；tokensBefore 分别为 343969、300888、300054，与当前 300000 自动阈值相符。事件未单独保留 reason，因此不额外断言每次 threshold/overflow 的具体分支。
- 每个 checkpoint 后都出现真实 Agent 后续工具调用。最近一次在 10:16:24 继续 chart_script / chart_drawing 等读取，随后 cache-retest 完成。没有看到主任务因该 hook 错误中断。
- 原始主会话 JSONL 仍包含压缩前记录。未发现原始上下文被删除的证据；本次未审阅私有摘要正文，不将它扩张为“摘要语义完全无损”的保证。
- [plugin-registry.js:98](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:98) 明确将记忆整理作为 best effort，失败仅记安全错误码后继续。内层 lifecycleCall 和外层 beforeCompact 各写一次事件，解释 coverage 中成对的失败计数。

观察器源码使用主数据库只读句柄和 `query_only`；QA 脚本中的 compaction 命中只用于 trace 元数据投影，未发现它调用压缩或修改 token 配置。三次均为正常主任务推进期间的压缩维护；模型输出违反记忆作用域契约是直接失败原因。

## 最小修复与验证

经主任务授权，仅修改核心 memory 插件的模型整理输入与说明：

1. 将运行会话输入字段由 `scope` 更名为 `executionContext`；公共能力接口和记忆存储 schema 不变。
2. 明确记忆 scope 的三种合法值、必需 ID 及类别匹配规则；运行 kind 不能复制为记忆 scope，不能把缺少项目/策略 ID 的事实扩大为 global。
3. 保留严格验证器。隔离回归检查输入不再混用 scope、非法运行 kind 和缺失/冲突 ID 仍拒绝、主会话下合法的三种记忆 scope 按原样保存。

实现文件：[compaction.js:188](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/compaction.js:188)、[curation.md:13](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/curation.md:13)；回归位于 [core-v2-memory.test.mjs:74](E:/brief2great/sesame/sesame/plugins/api-v1/tests/core-v2-memory.test.mjs:74)。运行时代码仅改模型输入字段名，没有修改 validator、公共能力 schema、记忆持久化、宿主接口或安装包版本。

验证完成：

- 修改生产代码前，隔离测试为 14 通过、1 失败；失败明确断言模型输入缺少 executionContext，而原始非法 scope 拒绝和三种有效 scope 保存均已通过。
- 修改后，`core-v2-memory.test.mjs`、`trading-memory.test.mjs`、`memory-workflow-preferences.test.mjs` 共 38 项通过、0 跳过。
- 宿主 `plugin-compaction.test.js` 与 `plugin-inference.test.js` 共 15 项通过、0 跳过，覆盖 hook 失败不阻断压缩、取消、来源隔离和模型完整响应验证。
- 修改的 JavaScript 通过 `node --check`，`git diff --check` 通过。oxlint 仅提示 compaction.js:11 的既有未使用 `contentOf`；已确认 HEAD 原有同一声明，本次不扩大清理范围。

以上均是隔离 fixture，未调用真实模型，也未使用用户记忆库。本次证明输入歧义已移除、严格作用域约束未放宽；真实模型修复后的整理结果仍待主任务在统一更新后复验。安装包版本与部署由主任务处理，本次未部署或重启。

证据来源：主 WAL `%LOCAL_USER_PROFILE% 的上述事件及对应模型操作结构元数据；主 trace `%LOCAL_USER_PROFILE% memory SQLite。
