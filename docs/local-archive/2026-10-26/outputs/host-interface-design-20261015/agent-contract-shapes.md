# Agent、推理、工具和插件声明：接口形状与宿主处理

依据当前工作树源码，2026-10-15。`?` 是可选；`Promise<T>` 为异步返回。下列 `Conversation`、`TaskRun`、`Artifact` 是宿主记录对象，列出的返回字段只表示核心字段；不是擅自增补的正式 TypeScript SDK。

## 1. 完整 Agent：host.agents

```ts
type ModelRef = { provider: string; id: string; configurationDigest: string };
type Output = {type: 'none'} | {type: 'report'; space: 'research'|'strategy'; path: string};
type AgentRequest = {
  requestId: string; title: string; instructions: string; input: object;
  kind?: 'research'|'strategy'; tools?: string[]; plugins?: string[];
  model?: ModelRef; lane?: string; queue?: 'fifo'|'latest';
  expiresAt?: number; timeoutMs?: number; maxTurns?: number; maxToolCalls?: number;
  output?: Output;
};
type AgentReceipt = {
  id: string; pluginId: string; requestId: string;
  status: 'queued'|'running'|'completed'|'failed'|'canceled'|'expired'|'superseded'|'interrupted';
  conversationId: string|null; runId: string|null; model: ModelRef;
  createdAt: number; completedAt: number|null; expiresAt: number;
  result: {text: string}|null; error: string|null;
  toolCalls: {id: string; name: string; status: string; startedAt: number; completedAt?: number}[];
  turns: number; supersededBy: string|null;
};
```

| 方法形状 | 返回 | 宿主处理逻辑 |
|---|---|---|
| `submit(request: AgentRequest)` | `AgentReceipt`，首次通常 queued | 仅主会话/服务调用；校验字段、插件、工具可见性与模型配置；按插件 ID + requestId 去重并检查内容摘要；冻结模型和插件版本；持久入队；按 lane 串行、全局最多 4 并发运行。运行时建立 conv_main 下的独立子会话与 Run，加载插件、绑定报告目的地，再进入正常模型—工具循环。 |
| `inspect(id: string)` | `AgentReceipt` | 读取回执副本；仅提交插件或该事件任务当前会话可读。 |
| `wait(id: string, signal?: AbortSignal)` | `Promise<AgentReceipt>` | 先校验可读性；已终态立即返回，否则监听宿主状态事件，到终态解除监听；signal 只取消等待。 |
| `cancel(id: string, reason?: string)` | `AgentReceipt` | 校验提交插件所有权；终态原样返回；否则写 canceled、清空 result、取消该会话后续排队输入并中止正在运行的回复；清理另行收尾。 |
| `current()` | `AgentReceipt & {input?,instructions?,inputDigest}` 或 `null` | 由当前 conversation 的事件任务关联查回执与输入；普通会话返回 null；任务完成清理后原始 input/instructions 会被删掉。 |

预算：requestId ≤200 字符、title ≤120、instructions ≤12000；总请求 ≤40000 字节；tools ≤64、plugins ≤32；默认 timeoutMs=900000（最大 1800000）、maxTurns=12（最大 64）、maxToolCalls=32（最大 256）；队列最多 64 个未结束任务。`latest` 只替换同插件同 lane 的 queued 项。`output` 默认 none，**不是输出 JSON schema**。成功文本最多末尾 50000 字符。重启把未终态项变为 interrupted，不自动重放。输入不会自动继承主聊天上下文。

源码：[plugin-agent-tasks.js:43](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:43)、[submit:58](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:58)、[调度与运行:113](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:113)、[取消等待:186](E:/brief2great/sesame/mt5agent/modules/agent/plugin-agent-tasks.js:186)。

## 2. 父子 Agent：host.tasks

```ts
type MemoryScope = {kind:'project';project_id:string} |
  {kind:'strategy';project_id:string;strategy_id:string};
type Delegate = {
  kind:'research'|'strategy'; title:string; task:string;
  conversation_id?:string; memory_scopes?:MemoryScope[]; output?:Output;
}; // 新建时 output 必填；继续已有任务可省略以继承
```

| 方法形状 | 返回（核心） | 宿主处理逻辑 |
|---|---|---|
| `list()` | `{tasks:(Conversation & {trigger:AgentReceipt|null})[], pendingTriggers:AgentReceipt[]}` | 主会话列出全部子会话及 queued 事件任务；子 Agent 只列自己的直属子任务。 |
| `read(conversationId)` | `Conversation` | 校验读取边界后复制会话记录；服务/主会话可读全局，子 Agent 只读自己和直属子会话。 |
| `run(conversationId)` | 当前原始 `TaskRun`，无 Run 时 null/undefined | 按同样会话边界检查，返回 workspaces.current 的记录副本；不是下行 inspect.run 的 UI 摘要形状。 |
| `delegate(args:Delegate)` | `Promise<{conversation:Conversation,run:RunSummary,output:OutputBinding}>` | 检查父 Run 未变、调用仍活跃、深度及并发；新建子会话或验证是直属且 kind 一致的已有会话；预留/绑定报告文件、限制可下授的记忆范围、创建 Run、将 task 放入子会话消息队列。 |
| `inspect({conversation_id,wait?:boolean}, signal?)` | `Promise<{conversation,run:RunSummary,summary:string|null,artifacts:Artifact[]}>` | 校验边界；wait=true 时等当前执行；汇总会话、运行摘要、最终摘要和封存成果。 |
| `finish({conversation_id?:string,summary:string,status?:'succeeded'|'failed'|'canceled',artifact_ids?:string[]})` | `TaskRun` 或 `Promise<TaskRun>` | 只结束自己或直属子任务；先拒绝未处理的排队输入，校验摘要和成果 ID；成功结束要求下级已清理；正在回复时标 finish_requested，空闲时立即封存、清理并返回。 |
| `stop({conversation_id?:string,plugin_task_id?:string,reason?:string})` | 分支返回：`AgentReceipt`、`{conversation,response}`、`TaskRun` 或 `Promise<TaskRun>` | 两个目标 ID 必须二选一；事件任务转 agents.cancel；普通任务取消后续排队输入、停止活动回复；无活动回复则请求 canceled 收尾，已有清理失败则重试清理。只有主会话可按 plugin_task_id 管理 queued 事件任务。 |

`RunSummary` 核心为 `{id,task_id,attempt,cleanup_state,task_status,final_artifact_ids,conversation_id,kind,title,status,stage,report_id,report_revision,default_view,...}`。`OutputBinding` 是 Output，报告类型另有稳定 fileId，删除时可附 deleted。新报告 path 须为所选树中的相对 HTML 路径、父目录已存在、目标未占用。kind 不限制报告 space。delegate 没有 tools/plugins/model/maxTurns 参数；不能假定事件 Agent 白名单自动传给整棵委派树。

源码：[HostContext.tasks:138](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:138)、[delegate:281](E:/brief2great/sesame/mt5agent/modules/agent/runtime.js:281)、[运行摘要和结束:335](E:/brief2great/sesame/mt5agent/modules/agent/runtime.js:335)、[清理请求:51](E:/brief2great/sesame/mt5agent/modules/agent/task-cleanup-service.js:51)、[报告输出:4](E:/brief2great/sesame/mt5agent/modules/agent/report-output.js:4)。

## 3. 单次模型推理：host.inference

| 方法形状 | 返回 | 宿主处理逻辑 |
|---|---|---|
| `models()` | `ModelRef[]` | 从宿主模型注册表筛选已配置认证的模型，计算连接/模型配置摘要；不返回密钥。 |
| `complete({requestId,model:ModelRef,systemPrompt,input:object,maxTokens,temperature?,reasoning?,timeoutMs?}, signal?)` | `Promise<{requestId,model,inputDigest,startedAt,completedAt,text,usage,reportedModel?,modelRevisionVerified:false}>` | 克隆并校验请求；校验配置摘要与预算；建立超时信号、占用并发槽；仅发送一条 system 和 JSON input 用户消息；禁用重试，调用既定模型；返回前再次校验模型配置、身份、stop 完整终止和输出大小，只抽取 text 和允许的 usage。 |

`reasoning` 可取 off/minimal/low/medium/high/xhigh，temperature 0–2；maxTokens 必填且不大于 32768/模型上限；timeout 默认 900000、最大 1800000；输入及输出分别受 1 MiB 限制；并发最多 8。`usage` 为有效的 input/output/cacheRead/cacheWrite/totalTokens 数值子集。无工具、聊天历史、隐式记忆、输出 schema、自动换模型及重试；requestId 不作幂等去重。取消后底层未结束仍占并发槽。

源码：[inference.js:23](E:/brief2great/sesame/mt5agent/modules/plugins/inference.js:23)、[传输和返回:59](E:/brief2great/sesame/mt5agent/modules/plugins/inference.js:59)。

## 4. 定义和组合工具：host.tools

| 方法/成员形状 | 返回 | 宿主处理逻辑 |
|---|---|---|
| `define(name,description,properties,execute)` | `ToolDefinition={name,label,description,parameters,execute}` | 把 TypeBox 字段集 properties 包成拒绝额外字段的对象 Schema；把插件 `(args,signal)=>data` handler 包成宿主工具执行器；await 后封装工具结果。 |
| `Type` | TypeBox schema 构造器集合 | 原生 Schema 构造器引用，用来声明数值、数组、枚举、对象等；本身不执行能力。 |
| `string(description)` | 字符串 Schema | 生成长度 1–20000 的必填字符串定义。 |
| `optional(description)` | 可选字符串 Schema | 对上述 string 使用 Type.Optional；其他类型应直接用 `Type.Optional(schema)`。 |
| `call({pluginId:string,name:string,arguments:object},signal?)` | `Promise<ToolResult>` | 验证当前调用链、调用插件版本、目标所有者/可见性/白名单；拒绝循环或超过 8 层；合并取消信号；验证目标参数；通过同一工具执行管线调用并记父子审计，返回目标原始封装；不自动加载或重试。 |
| `invocation()` | `{chain:{pluginId,toolName}[]}` | 仅在本插件、本会话仍有效的工具调用中，复制宿主记录的调用链；不是授权 token。 |

`ToolResult={content:[{type:'text',text:JSON.stringify(data)}],details:data}`。宿主会拒绝嵌套未等待 Promise；大输出给模型有界预览，完整结果留在审计，必要时写工作区文件。工具调用统一校验当前插件/会话状态、Run、信号和事件任务预算。直接本体工具无 plugin owner，所以不可借 `tools.call` 调用。

源码：[HostContext.tools:72](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:72)、[跨插件调用:480](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:480)、[工具结果:10](E:/brief2great/sesame/mt5agent/modules/agent/tools.js:10)、[统一执行:87](E:/brief2great/sesame/mt5agent/modules/agent/tools.js:87)。

## 5. 提示词、技能、资源、入口声明

这些是插件包声明/导出协议，不能写成不存在的 host.prompts 或 host.skills 方法。

| 形状 | 宿主处理逻辑与交付 |
|---|---|
| 清单 `prompts: string[]` | 每项是包内文件路径；读取为 prompt 资源，活动插件全文并入 system prompt；替换 `{{role}}/{{language}}/{{discoverable_plugins}}`；运行中 load 的新提示词先通过 load 结果返回，system prompt 下个用户轮刷新。 |
| 清单 `skills: string[]` | 每项是技能根目录/匹配的 SKILL.md 路径；发现 SKILL.md，解析 YAML name/description 等；验证名称与目录匹配，注册给 ResourceLoader；同目录允许的小参考文件也纳入资源。 |
| 清单 `resources?: string[]` | 声明包内参考文件；宿主按受控路径保存 `{path,kind,content,name,description}`，供插件资源读取接口读取；不自动全文注入。每资源 ≤128 KiB。 |
| 清单 `tool_names:string[]`、`tool_definitions:string` | 名称最多 100；tool_definitions 是 JSON 文件路径，内容为 `{name,description,parameters:{type:'object',...}}[]`；宿主静态校验名称集合一致，向模型公布定义并建立工具所有者索引。 |
| 清单 `default_state:'mounted'|'discoverable'|'disabled'`、`agent_scope?:'main'|'all'`、`main_tool_names?:string[]` | 宿主据此计算默认加载、会话可见性和子 Agent 硬过滤；main_tool_names 必须是 tool_names 子集。 |
| 清单 `mcp_export?:string[]` | tool_names 子集；受信包对外 MCP 工具出口的声明。 |
| 清单 `dependencies?:{name,version,digest?}[]` | 校验插件 ID、SemVer 范围和可选 sha256 摘要；加载/启用时检查依赖。 |
| 导出 `createTools(host):ToolDefinition[]` | 必须同步返回完整工具集合；宿主预检各适用 scope、禁止工厂阶段状态读取/I/O/实际调用；正式调用时懒构建上下文和 handlers，再校验集合并分发。 |
| 导出 `activate(host, options):Service|Promise<Service>|void` | options 为宿主 `runtime.options.plugins[pluginId]` 或 `{}`；宿主给 service 范围 host，调用一次、等待默认 30 秒上限，登记返回服务和资源；超时中止，迟到服务做 dispose；随后再预检工具工厂。 |

源码：[清单与资源解析:164](E:/brief2great/sesame/mt5agent/modules/agent/plugin-system/package.js:164)、[同步工厂契约:5](E:/brief2great/sesame/mt5agent/modules/plugins/tool-contract.js:5)、[激活:149](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:149)、[提示词与技能加载:584](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:584)。

## 6. activate 返回的 Service 回调全部展开

| 回调形状 | 返回/宿主使用 | 触发与处理 |
|---|---|---|
| `beforeMessage({messageId,conversation,parts,source,metadata})` | 同步 `parts[]` 替换值，或无返回保留原值 | 消息接受前依次调用；上一插件变换后 parts 交给下一插件。明确 4xx/code 可拒绝输入；错误或误返 Promise 时隔离故障插件，消息不继续处理。 |
| `messageRejected({messageId})` | 同步返回，值不使用 | beforeMessage 后的消息事务失败时通知，供撤销预处理；错误同样受故障隔离规则。 |
| `afterTurn({conversationId,responseId,status},{signal})` | 可异步，返回值不使用 | 每个被接受输入的回复完成后调用；默认 10 秒截止并跟踪实际未结束工作；某插件失败仍尝试后续插件，失败记生命周期/turn_hook_error；超时未结束期间该实例不重入。 |
| `beforeConfiguration({owner,pluginId?})` | 同步返回，值不使用；可抛错阻止 | 全局或当前插件配置变更前检查；全局不带 pluginId。 |
| `configurationChanged({pluginId?})` | 可异步，返回值不使用 | 配置动作 finally 触发，成功或失败都可能调用；全局传 `{}`，单插件传 `{pluginId}`。 |
| `beforeDeactivate()` | 可异步，返回值不使用；可抛错阻止 | 插件更新、停用等变更前，宿主先检查调用/后台任务/持久运行空闲，再让插件确认可变更。 |
| `protectArtifacts(runId,{signal})` | 可异步返回 `{artifacts?:ArtifactRef[],resources?:unknown[]}` | 任务封存前收集不可变成果引用与插件原生资源描述；宿主固定成果引用，resources 记入 task_result.native_assets，随后再清理。 |
| `cleanupRun(runId,{signal})` | 可异步，返回值不使用 | 成果封存后清理该 Run 的插件临时资源；受清理阶段期限/重试协调，失败保留可恢复状态。 |
| `dispose()` | 可异步，返回值不使用 | 服务停止时调用，随后逆序释放宿主登记的 disposers；失败或未完成操作保留跟踪，不能据超时断言外部副作用已停止。 |

这是宿主调用插件的反向接口；返回值未被使用的 hook 不代表执行成功的业务回执。`afterTurn` 是上一版能力清单未列出的现有回调，此次源码核对补全。

源码：[同步回调:286](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:286)、[afterTurn:338](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:338)、[消息入参:264](E:/brief2great/sesame/mt5agent/modules/agent/runtime.js:264)、[回复完成入参:523](E:/brief2great/sesame/mt5agent/modules/agent/runtime.js:523)、[配置回调:171](E:/brief2great/sesame/mt5agent/modules/agent/runtime.js:171)、[清理回调:120](E:/brief2great/sesame/mt5agent/modules/agent/task-cleanup-service.js:120)、[保留资源结果:78](E:/brief2great/sesame/mt5agent/modules/agent/artifact-service.js:78)。
