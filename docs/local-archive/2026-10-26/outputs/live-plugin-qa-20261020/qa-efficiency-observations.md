# 行情工作台 QA：一次有边界的效率诊断

观察截止 **2026-10-20 08:40:04.508 UTC**；重点窗口为本轮 market-workbench 请求开始的 **08:33:18.814 UTC** 至该截点。只读取本轮主会话 JSONL、主 WAL 库中本次回复的事件元数据，以及白名单证据文件。没有打开子任务 SQLite，没有发送请求、恢复任务或修改产品/驱动。旧于 08:03:02.802 UTC 的消息不在分析范围内。

本窗口有 **6 个模型回合、32 次工具调用、32 条工具结果、146,194 字节可见工具正文**。32 次调用中未发现“工具名＋完整参数”完全相同的重试，`plugin_load` 为 0 次。当前证据不支持“重复加载失控”的结论。`coverage-observed.json` 仍是 08:25 的草表，因此本轮结论直接核对新增 trace，不把旧覆盖数冒充当前结果。

| 发现 | 证据强度 | 性质 |
| --- | --- | --- |
| 两个长等待串行占用同会话工具队列，阻塞后续即时读取 | 事件时间和源码一致 | 可修的执行效率问题 |
| 两次完整 manifest 占全部工具正文的 56.9% | 返回字节数和源码一致 | 可收窄的发现流程 |
| 对两种无统一配置声明的插件探测配置目录 | 调用与返回明确 | 可避免探测；不是未配置密钥故障 |
| 将宿主专用 source 操作改拼成下划线 ID 重查 | 参数与声明明确 | Agent 协议理解错误；目录权限过滤本身正常 |

## 1. 长等待使同批即时读取延后约两分钟

08:37:17.993 的同一个模型回合发出两个 `host_runs_wait({until:"settled",timeoutMs:60000})`，随后还有 `plugin_read`、`configuration_integration_check`、`host_capabilities_list`。这是等待两个不同的准备 Run，不是重复等待同一 Run。

主 WAL 的 `message.updated` 事件给出以下状态变化（主回复 ID：`msg_a2e5d47a-f1ac-4a0d-826b-62ddffb3c3b2`）：

| segment / 工具 | 界面记为 running | completed | 从界面开始到完成 |
| --- | --- | --- | --- |
| 34 / 第一个 `host_runs_wait` | 08:37:17.994 | 08:38:18.339 | 60.345 秒 |
| 35 / 第二个 `host_runs_wait` | 08:37:18.002 | 08:39:18.647 | 120.645 秒 |
| 36 / `plugin_read` | 08:37:18.005 | 08:39:18.930 | 120.925 秒 |
| 37 / `configuration_integration_check` | 08:37:18.011 | 08:39:19.897 | 121.886 秒 |
| 38 / `host_capabilities_list` | 08:37:18.017 | 08:39:20.181 | 122.164 秒 |

事件序号分别覆盖 `94567–94574` 的开始和 `94625/94680/94682/94688/94691` 的完成。两个等待返回时其目标仍是 running；这是超时观察结果，不是业务执行失败。界面同时显示 running 也不证明宿主同时执行了工具。

**直接根因：** [tools.js:89](/E:/brief2great/sesame/mt5agent/modules/agent/tools.js:89) 为本会话创建共享 Promise `queue`；[tools.js:111](/E:/brief2great/sesame/mt5agent/modules/agent/tools.js:111) 把所有工具实际执行挂在 `queue.then(...)` 上；第 125 行把队尾更新为当前任务。只读 Run 等待同样占队。`RunService.wait` 的定时器在进入实际执行后才启动，见 [run-service.js:444](/E:/brief2great/sesame/mt5agent/modules/agent/run-service.js:444)，因此两个 60 秒等待累加。

**最小修复候选：** 保持变更工具的既有顺序，仅让无副作用的 Run 等待不长期占用执行队列；同时保留授权、取消、owner、审计边界。不能直接移除全局队列或让所有工具并行，因为 `activeSignal` 目前也是共享变量。必要验证是两个独立等待与一个即时读取不会累积阻塞，而写操作顺序保持不变。若只调整提示词，可先做本轮即时独立读取，再发长等待；这是流程缓解，不能消除执行层原因。

## 2. 完整 manifest 是本轮主要输出开销

| 时间（UTC） | 调用 | 可见工具正文 |
| --- | --- | ---: |
| 08:34:31.016 | `plugin_read`，`sesame/akshare`，`part:"manifest"` | 46,801 字节 |
| 08:34:31.017 | `plugin_read`，`sesame/ccxt`，`part:"manifest"` | 36,341 字节 |
| 合计 | 两份 manifest | **83,142 字节，占 56.9%** |

全部 6 次 `plugin_read` 共 87,795 字节，占 60.1%；其余 4 次是不同的公开知识资源读取，未发现同参数重复。两份 manifest 主要体积来自 `capabilities`（紧凑 JSON 分别 27,270 和 19,547 字节），不是历史账户或业务数据。

[plugin-manager/prompt.md:3](/E:/brief2great/sesame/sesame/plugins/api-v1/packages/plugin-manager/prompt.md:3) 目前笼统要求“读取声明用 plugin_read(part:manifest)”；[host-v2/plugins.js:42](/E:/brief2great/sesame/mt5agent/modules/plugins/host-v2/plugins.js:42) 实际返回完整 capabilityManifest。已有 [agent-tools.js:45](/E:/brief2great/sesame/mt5agent/modules/plugins/host-v2/agent-tools.js:45) 支持按准确 `ids` 读取能力声明，并明确普通工具已经携带 usage。

**最小候选：** 提示词区分“选择/调用能力”和“审计/开发整包”。普通调用优先已附带的工具声明，缺少准确声明时使用精确 ID 的能力目录；整包 manifest 留给需要完整包结构的任务。当前统计只证明输出偏宽，不能断言所有 83 KB 都与任务无关，也不把工具字节直接换算为 token。

## 3. 配置发现有两次可以避免的失败探测

08:34:27.681 同批调用了三次 `configuration_integration_catalog({plugin_id})`：

- `sesame/mt5` 在 08:34:31.013 正常返回。
- `sesame/akshare`、`sesame/ccxt` 在 08:34:31.015 各返回一次“插件未声明统一配置字段”，无随后同参数重试。

输入字段 `plugin_id` 符合当前协议。错误来自 [configuration-integrations.js:30](/E:/brief2great/sesame/mt5agent/modules/agent/configuration-integrations.js:30) 对缺少统一配置声明的明确拒绝；省略 `plugin_id` 的目录只列支持该声明的插件，见同文件第 75 行。因此这不是接口旧版本，也不表示缺了需要用户补交的密钥。

**最小候选：** 在尚不知道哪些插件支持统一配置时先读取一次不带 `plugin_id` 的目录；已知支持后再定向读取。配置技能已有该约束，可在默认 prompt 中同样写明。无需为无统一字段的插件编造配置，亦无需把正常的 `configuration_not_found` 直接改成成功。

## 4. 宿主专用 source 操作被当作 Agent 工具查找

08:35:05.512 的能力查询使用真实 ID：
`sesame/mt5#market.queryBars`、`sesame/mt5#market.searchInstruments`，另带一个普通 `mt5_cache` 能力。

前两个声明在 MT5 manifest 中确实存在，但 `consumers` 是 `["host"]`。Agent 目录按 consumer 正常过滤，见 [capability-service.js:63](/E:/brief2great/sesame/mt5agent/modules/plugins/capability-service.js:63)。08:35:50.042 随后又查询 `market_queryBars`、`market_searchInstruments` 的下划线拼写；这两个 ID 没有声明。一次“改拼写重查”可以确认，但没有持续重试循环。

[data-access/prompt.md:3](/E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/prompt.md:3) 将来源 `operations` 描述为“可调用操作”，随后第 5 行才说明应通过 `data_query({source,operation,input})` 调用；canvas 的来源说明也展示 operations。**最小提示词候选：** 明确 source.operations 是交给数据/画布宿主入口的操作名，不等同于 Agent 可直接 invoke 的 capability；保留准确 ID，不因 consumer 过滤而改拼写。无需开放 host-only 权限或新增兼容别名。

## 不列为产品缺陷的事项

- 08:35:13.345 的 `market_instruments` 返回 `MT5 is not connected to the broker`。这是外部连接状态，不是 schema 错误。
- AKShare/CCXT 的准备 Run 在截点仍运行；当前记录不能判断准备是否成功、失败或永久阻塞。等待超时本身不能作为失败结论。
- 08:20:44 的 SQLite 锁事件属于此前窗口，已标 `potential_harness_interference`。观察器对子 SQLite 的读取已移除；此事件不算确认产品 bug。
- 此前报告子任务的 workspace lifecycle ID 被误标 Current Run 问题已有独立确证及修复交接；本轮没有重复读其已清理的子数据库。

本次仅产出诊断说明；不自动给任何插件或能力判定 pass。以上时间均为 UTC，字节数只计 toolResult 发给模型的文本，不包含隐藏 details 副本、用户正文或思考内容。

## 后续 methods-parallel 归因更正（2026-10-20）

本段对应 `10:26:49.125Z` 开始、`10:34:27.696Z` 首次派发之前的主会话窗口，与上文 `08:33–08:40` 的旧窗口分开。计量文件 `methods-efficiency.json` 截点为 `10:48:27.303Z`。

该文件按 toolResult.content 的 JSON 序列化字节计量，包含 JSON 包装与转义；不能与上文纯文本字节直接等同。对应纯文本分别为复用清单 32,033、模型配置 26,160、16 次发现合计 92,787 字节。

- 该计量中的 37,176 字节对应普通 `read` 读取 `QA20261020/cross-market/reuse-manifest.json`，是业务成果复用清单，不是 `plugin_read(part:"manifest")`；不能沿用旧窗口“两份插件完整 manifest”的归因。本窗口没有 plugin_read manifest 调用。
- 30,487 字节的 `configuration_read` 明确传入 `section:"model"`，没有读取 all。大小本身不足以证明错误；随后 `host#models` 的两次查询分别取 1 项和 200 项，参数不同，不能按同参数重试计数。
- 16 次 `plugin_discover` 的 102,542 字节是计量文件记录值。实际包含不同关键词及一个精确 ID 集合，没有同参数重试；`feed`、`fx` 空结果后换用 `RSS`、`汇率`，也不构成接口重试循环。次数和总量可用于观察开销，不能单独判产品 bug。
- 本窗口没有 `configuration_integration_catalog` 调用，也没有把 source 的 host-only 操作改拼写重查的复现；上文两项确证仍仅属于旧窗口。

本次核对时，源码默认 prompt 仍有三处待纠正口径：plugin-manager 将读声明笼统指向整包 manifest；data-access 没有区分 source.operations 与 Agent 可调用能力；configuration 默认说明没有解释无统一声明与缺少配置值的区别。现仅修改这三份 prompt：复用普通工具自带声明，缺少具体声明时按精确能力 ID 读取；source 操作通过声明的数据/行情/画布入口使用且保留 host-only 边界；仅在需要且未知支持情况时列统一配置目录，未声明不算缺密钥。保留既有职责分类和配置能力绑定说明，未修改 API、驱动、真实会话或安装包。

以上修正针对已确认的说明歧义，不将它们宣称为本轮全部输出量的原因。知识资源完整阅读和业务成果复用仍按任务需要进行，没有新增调用次数或字节预算限制。

既有验证通过：插件管理、数据与配置相关 6 个测试文件共 15 项；宿主工具 usage、数据源和统一配置相关 3 个测试文件共 30 项；共 45 项通过、0 跳过，三份 prompt 的 diff 空白检查通过。没有新增或修改测试、接口和生产代码。

另有一处已确认的元数据错误：plugin_discover 的 capabilities.json usage 原写“query 按名称/能力搜索”，但 [host-v2/plugins.js:29](E:/brief2great/sesame/mt5agent/modules/plugins/host-v2/plugins.js:29) 实际只对插件 id/title/description 做不区分大小写的子串匹配，不搜索 capability ID 或描述。经主任务授权，已仅纠正该能力的 description、usage.purpose、usage.inputs 三个文本字段；同包知识资源未发现相同错误建议。除这三个文本字段外的 JSON 规范化摘要前后一致，schema 和行为未变；现有声明与管理隔离验证 4 项通过、0 跳过，diff 空白检查通过。本次没有将 `feed`/`fx` 空结果直接归因于此，没有扩大搜索行为，也未更新运行中的插件。
