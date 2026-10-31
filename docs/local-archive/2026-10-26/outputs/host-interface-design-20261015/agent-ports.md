# Agent、工具与提示词接口审计

核对日期：2026-10-15。范围：`E:/brief2great/sesame/mt5agent` 当前工作树，分支 `feat/workbench-library-accounts`，HEAD `c941478`。结论依据实际宿主实现，包含工作树现有修改；本报告不修改仓库、不验证业务运行效果。

## 1. 四种入口先分清

| 接口方向 | 现有入口 | 本体提供的能力 | 返回性质 |
| --- | --- | --- | --- |
| 插件 → 完整 Agent | `host.agents.submit/inspect/wait/cancel/current` | 把插件事件变成独立子会话，运行多轮模型与工具循环，控制工具集合、预算、排队和生命周期 | 任务回执；完成结果是 `result.text` |
| 插件 → 一次模型推理 | `host.inference.models/complete` | 使用宿主已配置模型，以显式 systemPrompt 和 JSON input 做一次无工具推理 | 最终 `text`、模型身份、摘要、时间与 usage |
| 会话中的插件工具 → 普通子 Agent | `host.tasks.delegate/list/read/run/inspect/finish/stop` | 建立或继续父子任务，检查摘要与成果，结束并清理任务 | conversation、run、summary、artifacts 等任务结构 |
| Agent → 插件可调用能力 | 清单 `tool_names/tool_definitions` + `createTools(host)` + `host.tools.define(...)` | 把插件操作注册成具有名称、说明和 JSON Schema 的模型工具 | `{content:[{type:'text',text}],details:data}` |
| 插件工具 → 另一插件工具 | `host.tools.call({pluginId,name,arguments}, signal)` | 在当前有效调用中组合已挂载工具，复用策略检查、schema 校验、审计和取消 | 目标工具原始工具结果封装 |
| 插件 → Agent 的行为说明 | 清单 `prompts/skills/resources` | 装载系统提示词、提供技能入口及声明可读取资料 | 供模型读取的文字和技能元数据；不产生额外执行权限 |

`host.agents` 是任务执行接口，`host.inference` 是无会话模型接口。两者不能用同一个“调用模型”规范混写。`output` 是报告目的地契约，并不是 JSON 输出 schema。宿主当前没有 `toolScope`、`role`、`response_format` 或 `structuredOutput` 这几个请求字段；`agents.submit` 会拒绝未知字段。

来源：[事件 Agent 字段与校验](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:58)、[推理字段与校验](E:/brief2great/sesame/mt5agent/modules/plugins/inference.js:34)、[HostContext](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:100)。

## 2. `host.agents`：插件调用完整 Agent

### 调用与回执

| 方法 | 输入 | 返回 / 行为 | 调用边界 |
| --- | --- | --- | --- |
| `submit(request)` | 下表请求对象 | 同步返回 queued 任务回执；不等待模型 | 仅 `scope.kind === 'main'` 或 `'service'`；宿主、触发插件必须可用 |
| `inspect(id)` | `submit` 回执的 `id` | 当前回执副本 | 任务属于调用插件，或者任务的 `conversationId` 就是当前会话 |
| `wait(id, signal?)` | 任务 id、可选 AbortSignal | 等到终态后返回相同回执结构 | 可读边界同 inspect；取消等待不等于取消任务 |
| `cancel(id, reason?)` | 任务 id、取消理由 | 已取消或原终态回执 | 只能取消由本插件提交的任务；主 Agent 统一管理任务另走 `host.tasks.stop` |
| `current()` | 无 | 当前会话是插件事件任务时，返回回执加 `input/instructions/inputDigest`；普通会话返回 null | 当前事件 Agent 内的能力插件也能辨认触发任务；结束清理会移除原始 input/instructions |

来源：[回执、可读性与 current](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:43)、[取消与等待](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:186)、[公共方法](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:231)。

回执字段：`id, pluginId, requestId, status, conversationId, runId, model, createdAt, completedAt, expiresAt, result, error, toolCalls, turns, supersededBy`。成功的 `result` 为 `{text}`，保留最终文本末尾最多 50000 个字符；没有 JSON schema 验证或自动解析保证。`toolCalls` 是各次工具调用状态数组，不是调用次数数值。回执 id 不是 conversationId；`requestId` 是调用方身份，不能与这两类宿主 ID 混用。

来源：[view](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:43)、[afterTurn](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:181)。

### 请求字段与固定规则

| 字段 | 必需性与约束 | 本体保证 |
| --- | --- | --- |
| `requestId` | 必需，非空，最多 200 字符 | 幂等范围是插件 ID + requestId；同内容返回已有回执，包括失败/过期/清理后的回执；不同内容返回冲突 |
| `title` | 必需，非空，最多 120 字符 | 子会话标题 |
| `instructions` | 必需，非空，最多 12000 字符 | 作为本任务要求；宿主追加事件来源和外部输入不能改变任务授权的说明 |
| `input` | 必需，JSON 对象，不能是数组 | 全请求最多 40000 字节；复制请求并生成 inputDigest；不会自动继承主聊天上下文 |
| `kind` | 可选，`research` 或 `strategy`，默认 research | 创建对应角色的 subagent 会话；这不是自定义 role 名称 |
| `tools` | 可选，最多 64 个唯一非空工具名称，每个最多 150 字符 | 限制当前事件 Agent 的工具集合；不传时按普通子 Agent 可用工具规则；禁用、不存在或主会话专用工具在提交时拒绝；嵌套跨插件工具调用也检查此集合和预算 |
| `plugins` | 可选，最多 32 个唯一插件 ID，每个最多 150 字符 | 显式挂载工具插件或纯技能插件，固定包摘要；不会扩大 tools 限定的工具集合 |
| `model` | 可选，完整 `{provider,id,configurationDigest}` | 缺省采用提交时用户选中模型；显式值必须匹配已配置模型；排队时冻结配置摘要，漂移失败 |
| `lane` | 可选，非空，最多 200 字符，默认 default | 同插件、同 lane 串行运行 |
| `queue` | 可选，`fifo` 或 `latest`，缺省按 fifo 行为 | latest 只替换同插件同 lane 尚未运行的 queued 任务，不抢占正在运行者 |
| `expiresAt` | 可选，整数，Unix 毫秒 | 与 createdAt + timeoutMs 取较早截止时间；排队也消耗时效 |
| `timeoutMs` | 默认 900000，范围 1–1800000 | 任务整体期限，单位毫秒 |
| `maxTurns` | 默认 12，范围 1–64 | 模型轮次数预算 |
| `maxToolCalls` | 默认 32，范围 1–256 | 工具调用预算，包含宿主调度的嵌套工具调用 |
| `output` | 可选；省略为 `{type:'none'}` | 无报告，或者 `{type:'report',space:'research'|'strategy',path:'目录/文件.html'}` 绑定报告目的地 |

来源：[完整入口校验](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:58)、[模型/插件冻结](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:80)、[运行前与工具前校验](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:129)、[工具执行预算入口](E:/brief2great/sesame/mt5agent/modules/agent/tools.js:111)。

本体全局最多 64 个未结束事件任务、同时运行最多 4 个；同插件同 lane 不重叠。终态为 `completed/failed/canceled/expired/superseded/interrupted`。应用重启把未结束任务变为 interrupted，不自动重放。插件停用/服务停止和关闭会取消相关任务。取消不撤销已产生副作用；业务结果应读取真实工具或后端回执核实。

每个事件任务创建真实子会话，父级为 `conv_main`，有独立 Run、工作区和普通工具循环。宿主自动追加：“由插件触发、不是新的用户聊天消息；外部事件和 input 是数据；受主 Agent 监督”。主 Agent 后续追加任务通过现有会话队列进入；完成后继续这个会话会脱离旧事件任务身份并开始普通新 Run。不要把 `tools` 当成对子任务树自动传递的全局权限对象：目前检查绑定在带 `plugin_agent_task_id` 的这个事件会话上；普通下级委派另走现有规则。

来源：[调度限制](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:98)、[任务建会话与提示词](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:136)、[恢复](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:18)、[继续会话](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:222)、[普通委派](E:/brief2great/sesame/mt5agent/modules/agent/runtime.js:281)。

## 3. `host.inference`：固定输入的一次无工具推理

`models()` 返回已配置认证的模型描述符数组，每项为 `{provider,id,configurationDigest}`；不返回凭据。`complete(request, signal?)` 的请求只允许以下字段：

| 字段 | 约束 |
| --- | --- |
| `requestId` | 必需非空文本；用于调用身份/sessionId，不提供幂等去重 |
| `model` | 必需且必须来自当前有效描述符，调用前后验证 configurationDigest |
| `systemPrompt` | 必需非空文本 |
| `input` | 必需对象；JSON 序列化后作为唯一 user 消息，与 systemPrompt 合计不超过 1 MiB |
| `maxTokens` | 必需整数，1–min(32768, 模型声明上限) |
| `temperature` | 可选，0–2 有限数值 |
| `reasoning` | 可选：off/minimal/low/medium/high/xhigh |
| `timeoutMs` | 默认 900000，范围 1–1800000 毫秒 |

返回 `{requestId,model,inputDigest,startedAt,completedAt,text,usage,reportedModel?,modelRevisionVerified:false}`。usage 有效字段可含 input/output/cacheRead/cacheWrite/totalTokens。返回最终 text，不返回隐藏思考、原始供应商包、凭据、工具或主聊天记录。要求模型以 stop 完整结束；工具调用、截断、不一致模型身份等会被拒绝。输出最多 1 MiB。

全宿主最多 8 个并发实际模型请求；已取消但底层传输未结束时仍占并发槽。无自动重试、无自动切模型、无 schema 输出约束；排队、幂等、JSON 解析/校验和重试策略需要调用插件明确实现。configurationDigest 核对的是连接与模型配置，不是供应商模型权重；`modelRevisionVerified:false` 明示后者未独立核验。

来源：[模型描述](E:/brief2great/sesame/mt5agent/modules/plugins/inference.js:8)、[接口与输入](E:/brief2great/sesame/mt5agent/modules/plugins/inference.js:23)、[传输与结果](E:/brief2great/sesame/mt5agent/modules/plugins/inference.js:59)、[接口说明](E:/brief2great/sesame/mt5agent/docs/plugin-api-v1/inference.md:17)。

## 4. `host.tasks`：会话任务协作

| 方法 | 现有入参 | 返回 / 限制 |
| --- | --- | --- |
| `list()` | 无 | `{tasks,pendingTriggers}`；主 Agent 看全部子会话和 queued 插件任务；子 Agent 看直属子任务；任务项可能有 trigger 回执 |
| `read(id)` | conversation id | conversation 副本；service/main 可读，subagent 仅自己或直属子会话 |
| `run(id)` | conversation id | 当前 task_run 副本；同上可读边界 |
| `delegate(args)` | `{kind,title,task,conversation_id?,memory_scopes?,output?}` | `{conversation,run,output}`；新建或续写直属子会话；新建必须给 output，续写可以省略 |
| `inspect(args,signal?)` | `{conversation_id,wait?}` | 可等待，返回 `{conversation,run,summary,artifacts}`；不是子任务私有过程对话导出 |
| `finish(args)` | `{conversation_id?,summary,status?,artifact_ids?}` | 结束自己或直属子任务；status 默认 succeeded，另有 failed/canceled；summary 1–12000 字符，最多 64 个成果 ID；成功结束前须等下级清理完成 |
| `stop(args)` | `{conversation_id,reason?}` 或 `{plugin_task_id,reason?}`，二选一 | 停止管理范围内子任务；只有主 Agent 能按 plugin_task_id 停止待运行事件任务 |

delegate 的 kind 仅 research/strategy；title/task 非空、各最多 20000 字符，新会话实际标题取前 120 字符；继续会话须属于当前父级且 kind 一致。父级深度须小于 3；新任务时宿主活跃回复数须小于 8。memory_scopes 最多 32 项，支持 `{kind:'project',project_id}` 或 `{kind:'strategy',project_id,strategy_id}`；非主 Agent 不得向下授予自己不可读的记忆范围。此方法没有 agents.submit 的 `tools/plugins/model/maxTurns` 等参数。

来源：[HostContext.tasks](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:138)、[delegate](E:/brief2great/sesame/mt5agent/modules/agent/runtime.js:281)、[finish 的结果要求](E:/brief2great/sesame/mt5agent/modules/agent/task-cleanup-service.js:51)。

报告输出的 `space` 独立于 Agent kind，目的地必须是所选树中的相对 HTML 路径，父目录须存在且目的文件未占用。绑定后使用稳定 fileId，不能靠后续 delegate 改换绑定；正常发布会写入绑定目标。`output.type='none'` 时返回结果并结束，不进入报告文件树。

来源：[报告 output schema](E:/brief2great/sesame/mt5agent/modules/agent/report-output.js:4)、[绑定规则](E:/brief2great/sesame/mt5agent/modules/agent/report-output.js:48)、[注入模型的输出规则](E:/brief2great/sesame/mt5agent/modules/agent/report-output.js:73)。

## 5. `host.tools`：注册能力、组合能力、证明调用来源

| 接口 | 精确形状 | 对规范的直接含义 |
| --- | --- | --- |
| `define(name, description, properties, execute)` | properties 为 TypeBox 对象字段；宿主包成 `Type.Object(properties,{additionalProperties:false})`；execute 为 `(args,signal)=>data` | 名称、用途说明、输入 schema 是 Agent 真正看到的可调用接口；处理器返回已经完成的数据 |
| `Type` | TypeBox schema 构造器 | 数组、枚举、嵌套对象、数值边界等可结构化声明 |
| `string(description)` | 1–20000 字符的必填字符串 schema | 简便字符串声明 |
| `optional(description)` | 上述字符串的 Type.Optional 版本 | 不是任意 schema 的通用 optional 包装；其他类型用 Type.Optional |
| `call({pluginId,name,arguments},signal?)` | 必须全部给定；arguments 必须对象；拒绝其他字段 | 面向已挂载插件工具的宿主调用；不能在后台 service 随意调用，也不能拿到函数后脱离调用继续执行 |
| `invocation()` | 返回 `{chain:[{pluginId,toolName},...]}` 副本 | 宿主记录的真实调用链，不含授权 token；只能在本插件、本会话、祖先均仍有效的调用内读取 |

工具 `data` 被封装为 `{content:[{type:'text',text:JSON.stringify(data)}],details:data}`。过大的模型可见文本会变成有界预览，审计保留完整 details；必要时生成工作区输出文件。返回树中发现未等待的 Promise 会报 `plugin_unawaited_result`，不能把异步对象误报成成功结果。

来源：[define 与 helper](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:72)、[tools.call/invocation](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:100)、[工具结果封装](E:/brief2great/sesame/mt5agent/modules/agent/tools.js:10)、[工具执行与输出文件](E:/brief2great/sesame/mt5agent/modules/agent/tools.js:96)、[未等待结果检查](E:/brief2great/sesame/mt5agent/modules/plugins/tool-contract.js:66)。

跨插件 call 的宿主保证：当前父调用有效、调用插件未被替换、目标 name 确属指定 pluginId、目标在当前会话已挂载且可用、工具不违反 main-only 或事件 tools 限制；调用链最多 8 层，禁止同一 pluginId + toolName 循环。原生目标用有界 schema 校验器校验 arguments；MCP 目标由自己的宿主调用管线校验。使用父信号与传入信号的组合，产生带父调用 ID 的审计事件，不广播参数/凭据/响应体，不自动重试。返回目标 execute 的工具结果，调用者要区分封装与 details 业务数据。

`invocation()` 证明“是谁调用了我”，不证明业务输入合法，也不代替账户/额度/期限/幂等检查。`host.agents.current()` 证明“我现在在哪个插件触发任务中”，它的 input 仍是调用方数据，不等于授权。当前跨插件 call 还要求目标名在插件 toolOwners 中，因此这些直接由本体注册、没有插件所有者的 host tools 不能假装属于某个 pluginId 来调用。

来源：[跨插件调用管线](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:480)、[调用链建立与失效](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:218)、[工具可见性](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:529)。

## 6. 清单如何把插件说明和能力暴露给 Agent

| 清单/模块字段 | 实际作用 | 不应误写成的含义 |
| --- | --- | --- |
| `default_state` | mounted：符合会话范围时默认可用；discoverable：需会话显式加载；disabled：不可用 | 并非只有 prompts 才控制是否能调用 |
| `agent_scope` | main 或 all，缺省按 all；main 使整个插件仅供主 Agent | 不是可自定义的角色名单 |
| `tool_names` | 最多 100 个唯一名称，字符规则 `[A-Za-z0-9_.-]{1,128}`；用于所有权与可调用工具注册 | 不是建议调用列表 |
| `tool_definitions` | 指向 JSON 工具定义数组，名称集合必须与 tool_names 一致；每项含 description 与 object parameters schema | 不是由 prompt 自然语言补出的 schema |
| `main_tool_names` | tool_names 子集；在子 Agent 中被硬过滤 | 不能靠子 Agent prompt 声称获准来绕过 |
| `createTools(host)` | 同步返回完整工具数组；所有适用 scope 必须返回与清单完全一致的工具名集合 | 不能按主/子 Agent 随意增删返回工具；可见性由宿主控制 |
| `prompts` | 声明 prompt 文件；已活跃插件的内容合并进 Agent system prompt；支持 `{{role}}/{{language}}/{{discoverable_plugins}}` 替换 | 不会新建 Agent、定时执行或赋予宿主权限 |
| `skills` | 声明技能根目录；发现 SKILL.md，校验 frontmatter 的 name/description；交给 Agent ResourceLoader | 技能不是独立进程或工具函数；其文字本身不会自动启动调度 |
| `resources` | 声明参考文件，按路径通过资源读取提供；各资源最多 128 KiB；skill 目录下指定扩展的小文件也进入参考资源 | 不会将所有资料全文自动拼入 system prompt |
| `templates` | 只能引用已声明资源；宿主内部提供模板文本替换 | 当前 HostContext 没有公开 `host.templates.*` 方法，不能设计规范时凭内部方法名称假定端口 |
| `dependencies` | 声明插件名、SemVer 范围，可带 digest；加载/启用时检查依赖 | 依赖声明不等于把依赖插件所有工具无条件开放给当前 Agent |
| `mcp_export` | tool_names 子集，给本体 MCP 导出选择工具 | 是对外出口选择，不是本地 Agent 权限总开关 |

来源：[原生清单解析](E:/brief2great/sesame/mt5agent/modules/agent/plugin-system/package.js:164)、[资源与技能](E:/brief2great/sesame/mt5agent/modules/agent/plugin-system/package.js:184)、[完整同步工具契约](E:/brief2great/sesame/mt5agent/modules/plugins/tool-contract.js:5)、[有效状态与子任务范围](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:422)、[提示词替换和 ResourceLoader](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:584)。

`createTools` 工厂应只定义工具；预检会拦住读状态、I/O 或执行工具，实际工作应在 activate 或工具 handler 内。主/子 Agent 可见性由 `agent_scope/main_tool_names/agents.submit.tools` 管理。实际调用时仍会检查当前清单版本、宿主调用生命周期与会话归属，因此提示词表述不能替代这些硬检查。

`host.plugins.discover(query)` 返回符合会话范围、未 disabled 的插件摘要；`inspect(id)` 面向 main/service，摘要包含 tools、delegatable_tools、agent_scope、skills/prompts/resources 路径和包摘要；`load(id)` 激活插件并刷新当前会话工具，立即返回新 prompt 内容作为工具上下文，因为 system prompt 在下一用户轮才刷新；`read(id,path)` 只读已声明且已挂载资源。`isActive` 用于确定当前/允许目标会话是否实际启用。编写调用规范前应解析这些实际摘要，而不是从插件名称推测可调用能力。

来源：[HostContext.plugins](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:175)、[summary/discover](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:432)、[activate 即时提示词](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:462)、[资源读取](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:534)。

## 7. Agent 还能直接调用的本体工具

以下 16 个工具由本体直接注册，和插件工具一同进入 Agent 工具集合；事件 Agent 显式传 tools 时同样受白名单过滤。它们不是新的 HostContext 命名空间。

| 本体 Agent 工具 | 能力 |
| --- | --- |
| `report_files_list/read/mkdir/write/move/delete/restore` | 两个报告文件树中的源文件管理，版本检查、草稿修改、回收站与恢复；写入不等于发布 |
| `data_extensions_list/read` | 发现真实 provider extension 的类型、单位和能力，读取当前值或有界历史 |
| `data_view_inspect/configure` | 读取和配置图表、账户区域的显示字段；修改需 expectedVersion |
| `strategy_sources_list/strategy_source_read` | 查找和读取已验证的不可变 strategy.source 成果 |
| `strategy_mounts_inspect/configure` | 读取和替换账户目标的策略源引用挂载；不启动/停止执行或下单 |
| `trade_trace_inspect` | 根据真实成交 correlation 解析对应 run/source/translation/trace；无关联不能按时间或盈亏猜测 |

来源：[报告文件工具](E:/brief2great/sesame/mt5agent/modules/agent/report-library-tools.js:1)、[数据扩展与显示工具](E:/brief2great/sesame/mt5agent/modules/agent/data-view-tools.js:5)、[策略源与成交关联工具](E:/brief2great/sesame/mt5agent/modules/agent/account-strategy-tools.js:3)、[统一选择与注册](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:574)。

## 8. 当前能力对后续规范的约束

1. Agent 任务规范使用真实字段：instructions 描述任务，input 传数据，plugins 指定挂载包，tools 限制工具，kind 选现有角色，output 选报告去向；不要把人设、工具权限和输出位置混成一个 prompt 字段。
2. 能力规范应同时记录清单中的工具 schema 与运行约束：所属插件、可用 scope、输入/输出、持久副作用、幂等键、取消语义、证据回执；自然语言只能解释这些约束，不能创造授权。
3. 结构化判断目前需要插件自行校验返回文本；`output` 不做此事。若需要未来由本体统一保证 JSON schema，这属于接口扩展设计，不能写成现有能力。
4. 独立服务回调可提交 `host.agents`，不能直接跨插件 `host.tools.call`；后者绑定在活的 Agent 工具调用上下文。完整 Agent 执行与一次 inference 推理要分别制定重试/幂等规范。
5. 当前结论是源码审计。文档中既有测试通过的陈述不等于本次重新执行了这些测试；本次无运行修改，不新增功能验收结论。

## 9. 对外 Agent 接入也已提供

外部客户端可通过已有 HTTP/OpenAPI 的 `/api/v1/conversations` 读取会话、向 `/api/v1/conversations/{id}/messages` 发消息（202 接受），经 `/api/v1/events` SSE 订阅消息增量和状态，配合 history/queue/stop/retry/runs 观察与管理。这是宿主会话入口，复用同一 Agent runtime；不是将 `host.agents.submit` 原样暴露成 HTTP endpoint。常规 API 使用应用会话 Cookie/Bearer，写入操作有 Idempotency-Key 机制。`POST /api/v1/mcp` 则是专用 Bearer 认证的工具出口，支持 initialize/server-discover、tools/list、tools/call；只导出受信随附插件清单 `mcp_export` 允许且未失效/禁用的工具，外部升级包不能扩大原始出口。MCP 工具在 `conv_mcp` 会话中执行并复用注册表校验，不开放任意 HostContext 方法，也不会自动运行完整 Agent 对话；16 个直接本体工具没有通过这个插件 mcp_export 选择器自动全部暴露。插件内部事件/普通协作分别仍使用 `host.agents` / `host.tasks`。

来源：[HTTP 认证与 MCP 路由](E:/brief2great/sesame/mt5agent/modules/agent/server.js:63)、[会话与 Run 读取](E:/brief2great/sesame/mt5agent/modules/agent/server.js:138)、[SSE](E:/brief2great/sesame/mt5agent/modules/agent/server.js:161)、[发送消息](E:/brief2great/sesame/mt5agent/modules/agent/server.js:285)、[MCP 实际出口](E:/brief2great/sesame/mt5agent/modules/agent/plugin-system/mcp-server.js:31)、[OpenAPI](E:/brief2great/sesame/mt5agent/docs/openapi.yaml:8)。
