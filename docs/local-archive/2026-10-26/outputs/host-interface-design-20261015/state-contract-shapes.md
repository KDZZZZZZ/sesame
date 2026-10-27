# 本体接口形状：状态、记忆、插件管理、配置、环境与生命周期

核对当前 `E:/brief2great/sesame/mt5agent` 源码，2026-10-15。只读审计。以下是实际 HostContext 接口，不是建议新增接口。`T` 是调用方自己的 JSON 可序列化数据，`Promise<T>` 为异步结果；标注“核心字段”的返回值不是完整字段清单。

## 身份与共同处理

| 属性 | 形状 | 宿主处理 |
| --- | --- | --- |
| `host.apiVersion` | `"1.0.0"` | 固定插件 API 版本，区别于应用版本和清单中的 `apiVersion:"1"`。 |
| `host.application` | `{name:"sesame",version:string}` | 从应用 package.json 取得版本，冻结对象。 |
| `host.plugin` | `{id:string,version:string,digest:string}` | 使用当前装载包的身份与摘要，冻结对象。 |
| `host.scope` | `{kind:"service"\|"main"\|"subagent",conversationId:string\|null,runId:string\|null}` | 创建 HostContext 时取得；服务上下文无会话，runId 为当时当前 Run；冻结对象。 |

多数 host 端口调用前会检查上下文存活，异步失败记录 `plugin.host_call.failed`。有会话的操作检查工作区仍开放；读其他会话时，service/main 可访问任意目标，subagent 仅自身和直接子会话。没有因此把所有原生代码变成 OS 沙箱。来源：[context.js:53](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:53)、[context.js:232](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:232)、[application.js:4](E:/brief2great/sesame/mt5agent/modules/application.js:4)。

## 插件持久状态 `host.storage`

`collection` 格式为 `^[a-z][a-z0-9_-]{0,80}$`，宿主实际加上 `plugin:<pluginId>:` 前缀。它按插件隔离，多个会话共享同一个插件的状态。

| 方法 / 属性形状 | 返回 | 宿主处理 |
| --- | --- | --- |
| `directory: string` | 插件数据目录绝对路径 | 创建 `<应用数据>/plugins/data/<pluginId>`。 |
| `get(collection,id,optional=false)` | `T`；缺省且 optional 为 true 时 `null` | 从插件命名空间查记录并复制；默认缺失抛错。 |
| `list(collection)` | `T[]` | 读取该集合全部可见记录并复制。 |
| `put(collection,value:{id:string,...})` | 写入后的对象 | 校验 id，复制后按 id 插入或整体替换。 |
| `update(collection,id,changes:object)` | 合并后的对象，含 `version,updated_at` | 读旧值，浅合并 changes，version 自增，发 `plugin.record.updated`；没有 expectedVersion 参数。 |
| `delete(collection,id)` | `undefined` | 删除对应记录；不存在也无业务返回值。 |
| `transaction(action:()=>T)` | `T` | 同步 SQLite 事务；嵌套复用；失败回滚，提交后广播缓冲事件。回调中的异步操作不会延长事务。 |
| `idempotent(id,fingerprint,action:()=>T)` | `T` | 用插件命名空间和 id 生成内部键；同指纹返回已存结果，不同指纹报冲突；首次同步执行并持久化结果。 |
| `idempotentAsync(id,fingerprint,action:()=>Promise<T>)` | `Promise<T>` | 同键同指纹合并正在执行的 Promise；成功后持久化结果；失败不保存成功缓存。外部副作用不是崩溃后 exactly-once。 |
| `legacy.get(collection,id,optional=false)` | `T\|null` | 仅访问宿主授予迁移权限的旧集合，不加插件前缀。 |
| `legacy.list(collection)` | `T[]` | 同上，读取旧集合。 |
| `legacy.path(name)` | 绝对路径 | name 必须列入获准迁移目录，解析后必须仍在应用数据目录内。 |

来源：[context.js:23](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:23)、[store.js:132](E:/brief2great/sesame/mt5agent/modules/agent/store.js:132)、[store.js:179](E:/brief2great/sesame/mt5agent/modules/agent/store.js:179)、[store.js:228](E:/brief2great/sesame/mt5agent/modules/agent/store.js:228)。

## 长期记忆 `host.memory`

全部方法要求开放的 Agent 会话；主 Agent 可管理长期记忆，子 Agent 可读获准范围、提候选、登记采用证据。共有 **16 个方法名**（含 `list/get` 两个别名）。

复用输入结构：

```ts
type MemoryScope =
  | {kind:"global"}
  | {kind:"project",project_id:string}
  | {kind:"strategy",project_id:string,strategy_id:string};

type MemorySource =
  | {type:"user_message",id:string}
  | {type:"artifact",id:string,revision:string,digest:string,kind:string,schemaVersion:string};
// 还兼容宿主旧报告/已封存成果引用：{type:"artifact",id,kind?,revision?:number}。

type MemoryWrite = {
  id?:string, expected_version?:number,
  category:string, title:string, summary:string, content:string,
  scope:MemoryScope, sources:MemorySource[],
  tags?:string[], evidence?:"explicit"|"verified"|"inferred"|"conflicted",
  pinned?:boolean, value?:"low"|"normal"|"high",
  conflicts_with?:string[], expires_at?:string|null, review_at?:string|null
};
```

新建需要 category/title/summary/content/scope/sources；更新可沿用旧字段。`category` 允许 user 的 communication/workflow/constraints，projects/<项目>/overview/architecture/decisions/conventions，projects/<项目>/strategies/<策略>/hypotheses/findings/limitations，lessons 的 user-corrections/research-methods/data-quality/strategies/plugins-tools，references 的 repositories/documentation/datasets/skills-plugins/artifacts。路径分类必须与 scope 对应。sources 为 1–20 个持久引用；显式用户表达必须有真实主会话用户消息，已验证事实必须有成果引用；不能用临时任务消息伪装来源。

`Memory` 返回记录含上述规范化业务字段及 `id,version,created_at,updated_at,last_used_at,use_count,manually_archived,restored_at,status,review_due,reference_count`。`status` 为 hot/warm/archived/expired/conflict；`Summary` 从 Memory 去掉 content/sources，加 source_count。

| 方法形状 | 返回 | 宿主处理 |
| --- | --- | --- |
| `tree()` | `{items:Node[],categories}`；Node=`{id,path,name,label,count,children}` | 根据当前可见记忆汇总分类树和数量。 |
| `search({query?,q?,limit?,category?,scope?,project_id?,strategy_id?,status?,include_archived?,include_expired?}={})` | `{items:Summary[],total:number}` | 先做范围和状态过滤，再中文分词/FTS 与文本匹配，按相关度、置顶和更新时间排序；limit 默认50，上限200。scope 可为种类字符串或 MemoryScope。 |
| `list(filters?)` | 同 search | search 的同义入口。 |
| `read(id)` | `Memory` | 查记录、校验范围、计算当前状态；不增加采用次数。 |
| `get(id)` | `Memory` | read 的同义入口。 |
| `index({limit=20}={})` | `{items:[{id,category,title,summary,scope,version,status}],total}` | 只给 hot/warm 简要索引，最多30条。 |
| `save(input:MemoryWrite,expectedVersion?)` | `Memory`，重复新建可加 `deduplicated:true` | 仅主 Agent；更新校验版本（第二参数优先，默认 input.expected_version）；校验来源与范围，防止恢复已遗忘内容；保存历史、更新检索索引；同事实不同结论登记冲突。 |
| `propose(input:MemoryWrite)` | 候选=`{...规范化字段,id,version:1,owner_conversation_id,owner_run_id,created_at,expires_at,memory_expires_at}` | 创建归当前会话/Run 的候选；候选 expiry 使用维护策略，原记忆 expiry 放 memory_expires_at；不立即写正式记忆。 |
| `candidates()` | `{items:Candidate[]}` | 主 Agent 见全部候选，子 Agent 只见自己候选。 |
| `resolveCandidate({id,action:"accept"\|"reject",expected_version,...patch})` | `{id,status:"accepted"\|"rejected",memory:Memory\|null}` | 仅主 Agent；验候选版本；accept 验未过期，以 MemoryWrite 字段 patch 后保存正式记忆并登记别名；reject 删除候选及受跟踪副本。 |
| `markUsed({id,source:MemorySource,reason:string})` | `Memory` | 验范围、来源及记忆可采用状态；同 memory+source 幂等；首次更新采用时间/计数并取消手动归档。 |
| `archive(id,expectedVersion)` | `Memory` | 仅主 Agent；版本匹配后手动归档、version+1。 |
| `restore(id,expectedVersion)` | `Memory` | 仅主 Agent；版本匹配后解除手动归档并记录恢复时间；不会伪造采用次数。 |
| `forget(id,expectedVersion)` 或 `forget({id,expected_version})` | `{id,status:"forgotten"}` | 仅主 Agent；验版本后移除记忆、历史、检索/采用链接和同源候选，写遗忘墓碑，安排清除受跟踪会话副本；已遗忘重复调用返回相同状态。 |
| `stats()` | `{total,states:{hot,warm,archived,expired,conflict},policy,last_maintenance,maintenance_error}` | 统计当前可见记忆，附全局维护策略与最近维护状态。 |
| `configure({expected_version,hot_days?,archive_days?,candidate_days?,inferred_low_value_days?,maintenance_interval_ms?})` | 新 `policy`，含 `version` | 仅主 Agent；CAS 校验、检查周期一致性、版本+1、立即维护并重启已有维护定时器。 |

默认 policy=`{version:1,hot_days:30,archive_days:90,candidate_days:14,inferred_low_value_days:365,maintenance_interval_ms:3600000}`。上述 search/read 不会让记忆保温；只有真实采用证据改变采用统计。来源：[memory-service.js:77](E:/brief2great/sesame/mt5agent/modules/agent/memory-service.js:77)、[memory-service.js:101](E:/brief2great/sesame/mt5agent/modules/agent/memory-service.js:101)、[memory-service.js:173](E:/brief2great/sesame/mt5agent/modules/agent/memory-service.js:173)、[memory-service.js:198](E:/brief2great/sesame/mt5agent/modules/agent/memory-service.js:198)、[memory-service.js:246](E:/brief2great/sesame/mt5agent/modules/agent/memory-service.js:246)、[memory-service.js:340](E:/brief2great/sesame/mt5agent/modules/agent/memory-service.js:340)、[memory-service.js:354](E:/brief2great/sesame/mt5agent/modules/agent/memory-service.js:354)。

## 插件发现/管理 `host.plugins`

`PluginSummary`（核心字段）=`{id,title,description,version,state,default_state,loaded?,tools,delegatable_tools,agent_scope,source,digest,runtime_status,diagnostics,external,dependency_lock,revisions,prompts,resources,skills}`。engines 若有则附带；prompts/resources 是路径表，skills 是 `{name,description,path}[]`。

| 方法形状 | 返回 | 宿主处理 |
| --- | --- | --- |
| `isActive(pluginId,targetConversationId?)` | `boolean` | 默认当前会话，service 默认 conv_main；验目标会话范围，然后检查包状态、Agent 资格、依赖、挂载/显式加载及事件任务限制。 |
| `discover(query="")` | `{items:PluginSummary[]}` | 要求 Agent 会话；按 id/title/description/tool name 子串匹配，过滤 disabled 与不适用当前 Agent 的包。 |
| `load(pluginId)` | `Promise<PluginSummary>`，prompts 改含 `{path,content}` | 要求 Agent 会话；验资格/启用/运行状态/依赖，加入该会话 loadout 并刷新工具；把新 prompt 文本立即返回，系统提示词下轮再刷新。 |
| `read(pluginId,path)` | `{plugin_id,path,content:string}` | 要求 Agent 会话；只读清单声明且当前已挂载的资源，返回 UTF-8。 |
| `inspect(pluginId)` | `PluginSummary` | 仅 service/main；读注册表、包身份、诊断、工具与修订信息。 |
| `manage(action,args,signal?)` | `Promise<ActionResult>`，见下表 | 仅 main；分派九种动作。validate/test 不需要 command_id；其他动作要求 command_id 幂等，管理提交串行化；替换版本只排空目标插件。 |

`manage` 的每种 args：

| action | args 形状 | 结果 / 宿主处理 |
| --- | --- | --- |
| `create` | `{command_id,name,version?="0.1.0",description?,template?:"skill"\|"mcp-python"}` | `{path,name,files:string[],next}`；在任务工作区创建不覆盖已有文件的草稿模板。 |
| `validate` | `{path}` | `{valid:true,...PackageSummary}` 或 `{valid:false,diagnostics}`；快照草稿，检查清单、路径、包结构。 |
| `test` | `{path}` | `{...PackageSummary,passed,results,tools,next}`；校验依赖并记录 digest 对应测试结果。native 检查清单/schema/JS语法；stdio 可跑声明测试；远程 MCP 只列 schema，不由包元数据隐式执行远程工具。 |
| `install` | `{command_id,path,digest}` | `{...PluginSummary,digest,pending_session_refresh:true}`；要求草稿摘要匹配成功测试，依赖/连接版本未变；缓存包，预检、激活成功再提交安装指针；初始 discoverable。 |
| `update` | `{command_id,path,digest,expected_digest}` | 同 install；还验旧版本摘要及版本递增，保留旧包以便回滚，切换失败恢复旧包。 |
| `set_state` | `{command_id,plugin_id,state:"mounted"\|"discoverable"\|"disabled",expected_version}` | `{version,items:PluginSummary[]}`；expected_version 是插件策略版本；验忙碌和版本，停用/启动服务，更新策略，清除该插件的显式会话加载。 |
| `rollback` | `{command_id,plugin_id,digest,expected_digest}` | `PluginSummary`；目标 digest 必须是已有受测/应用验证修订；验当前摘要、缓存完整性和依赖，再启用旧版本并提交指针。 |
| `uninstall` | `{command_id,plugin_id,expected_digest}` | `{plugin_id,status:"uninstalled",retained}`；验当前版本、无依赖方/活动资源后停服务、移出注册表；保留版本审计与插件数据。 |
| `export` | `{command_id,plugin_id,target:"agent-plugins"\|"claude"\|"codex"}` | `{path,target,files:string[],digest}`；从已安装包转换并写入工作区；有兼容性诊断或 Sesame native 包会拒绝无损导出。 |

`PackageSummary`=`{id,version,format,digest,engines?,diagnostics,skills:[{name,path}],servers:string[],dependencies,contributions,execution?,tools?}`。command_id 为 16–128 字符；同键不同会话/动作/参数冲突。这里的 test 不能证明插件真实业务已成功。来源：[context.js:175](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:175)、[plugin-registry.js:432](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:432)、[plugin-registry.js:449](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:449)、[manager.js:150](E:/brief2great/sesame/mt5agent/modules/agent/plugin-system/manager.js:150)、[manager.js:216](E:/brief2great/sesame/mt5agent/modules/agent/plugin-system/manager.js:216)、[manager.js:258](E:/brief2great/sesame/mt5agent/modules/agent/plugin-system/manager.js:258)、[manager.js:292](E:/brief2great/sesame/mt5agent/modules/agent/plugin-system/manager.js:292)。

## 配置 `host.configuration`

这里不是任意配置 JSON 或凭据写接口。除 update 要求 main 会话外，其余允许 service/main。

```ts
type ProviderRef = {pluginId:string,providerId:string};
type AccountSource = {
  provider:ProviderRef, connection?:{id:string,revision:string},
  accountId?:string, accountConnectionId?:string
};
type PreferencePatch = {
  locale?:"zh-CN"|"en",
  account_view?: {
    source?:AccountSource|null,
    sources?:AccountSource[],
    selected?:(AccountSource & {accountId:string})[]
  }
};
type ConfigurationUpdate = {
  command_id:string,
  target:"model", changes:{provider:string,model:string,thinking?:"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"}
} | {
  command_id:string,
  target:"preferences",expected_version?:number,changes:PreferencePatch
};
```

| 方法形状 | 返回 | 宿主处理 |
| --- | --- | --- |
| `read({section?:"all"\|"model"\|"preferences",provider?:string}={})` | `{recent_changes,model?,providers?,available_models?,preferences?,network?,plugins?}` | 默认 all；model 返回当前模型/供应商摘要及可用模型，指定 provider 才附该供应商详细 models；preferences 返回偏好和 version；all 另含网络与插件目录。 |
| `update(args:ConfigurationUpdate)` | `Promise<ChangeRecord>`，核心 `{id,conversation_id,target,changes,status,created_at,completed_at?,result?,error?}` | 严格 schema；command_id 同内容幂等。preferences 立即做版本化局部修改。model 先校验供应商/认证/忙碌，入队，当前回复和所有 pump 结束后换模型；可能返回 queued，不能据此称已切换。 |
| `open({dialog:"settings",...})` | `{opened:true}` | 仅验证 settings，将原 args 写 `configuration.open` 事件以打开设置。 |
| `exclusive(action:()=>T\|Promise<T>)` | `Promise<T>` | 将当前插件配置操作串行排队；验本插件无其他冲突工具/全局配置/更新；禁止同插件嵌套独占；执行后触发该插件 configurationChanged，即使 action 抛错也触发。 |
| `assertIdle()` | `undefined` | 执行当前插件可配置性检查和 beforeConfiguration 守卫；不修改配置。 |

ChangeRecord 的 status 可为 running/queued/applied/failed/canceled/unknown；模型排队记录还带 previous/response_id。preferences 中 sources/selected 各最多32项，总输入最多32KiB，仅持久化提供方/连接/账户引用；省略字段保留旧值。模型更新不接受 expected_version。来源：[context.js:183](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:183)、[configuration-service.js:11](E:/brief2great/sesame/mt5agent/modules/agent/configuration-service.js:11)、[configuration-service.js:25](E:/brief2great/sesame/mt5agent/modules/agent/configuration-service.js:25)、[configuration-service.js:84](E:/brief2great/sesame/mt5agent/modules/agent/configuration-service.js:84)、[preferences.js:6](E:/brief2great/sesame/mt5agent/modules/agent/preferences.js:6)、[runtime.js:178](E:/brief2great/sesame/mt5agent/modules/agent/runtime.js:178)。

## 执行环境 `host.environment`

| 属性 / 方法形状 | 返回 | 宿主处理 |
| --- | --- | --- |
| `capabilities` | `{available:true,backend:"host",isolated:false,reason:null,platform,arch,shell:string\|null,execution:"host"}` | 探测当前平台、架构、可用 shell；只读快照。 |
| `pythonPath` | `string\|null` | 宿主配置的 Python 路径。 |
| `execution` | `"host"` | 当前执行后端标识。 |
| `executeWorker(path,payload,{runId?,signal?,timeoutMs?}={})` | `Promise<T>`，T 为 worker 返回值 | 验 path 在 manifest.workers 中且 realpath 在包内；验上下文和 Run 活跃；组合取消/超时信号，动态 import 包内模块，调用 `execute(clone(payload),{signal,runId,directory,pythonPath})`；跟踪至插件和资源所属 Run。默认120秒，上限600秒。 |

executeWorker 是宿主调用包内 JS 函数，不自动创建隔离线程/进程；timeout 通过 signal 通知取消，不会强杀忽视 signal 的普通 JS Promise。subagent 即使指定业务 runId，其资源仍归原活跃任务 Run。来源：[context.js:201](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:201)、[host-environment.js:5](E:/brief2great/sesame/mt5agent/modules/agent/host-environment.js:5)、[plugin-registry.js:105](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:105)。

## 事件与压缩生命周期

| 方法形状 | 返回 | 宿主处理 |
| --- | --- | --- |
| `events.emit(name:string,payload:T)` | `undefined` | 校验非空 name，复制 payload，持久化并广播事件 `{type:"plugin.event",data:{pluginId,name,payload},schema_version:2,occurred_at,id}`；HostContext 未返回这个事件对象。没有 events.on/subscribe。 |
| `lifecycle.onBeforeCompact(handler,{timeoutMs=120000}={})` | `dispose:()=>void` | 仅 service 激活时注册；插件自动持有 disposer。压缩前，仅向当前启用的插件逐个调用 handler，默认120秒、上限180秒；失败只记诊断，继续压缩。 |

handler 形状：

```ts
handler(event: {
  checkpointId:string, reason:unknown,
  messages:{id:string,role:"user"|"assistant",text:string,source?:{type:"user_message",id:string}}[],
  model:InferenceModelDescriptor|null,
  modelLimits:{contextWindow:number,maxOutputTokens:number}|null,
  signal:AbortSignal
}, scopedHost:HostContext): void|Promise<void>
```

宿主从将被压缩的原始 user/assistant 消息中提取可见文本，排除工具输出、隐藏推理和旧摘要；仅无歧义真实用户消息附 source。checkpointId 由会话/边界/消息计算，可作插件幂等键；scopedHost 属于正在压缩的实际会话。回调返回值不替换宿主压缩结果。来源：[context.js:114](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:114)、[context.js:200](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:200)、[plugin-registry.js:66](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:66)、[compaction.js:9](E:/brief2great/sesame/mt5agent/modules/plugins/compaction.js:9)。

## 消息与执行记录

| 方法形状 | 返回核心形状 | 宿主处理 |
| --- | --- | --- |
| `messages.read(id,optional=false)` | `Message\|null` | 读取记录，验所属会话可见性，复制返回；缺失默认抛错，optional=true 返回 null。 |
| `executions.read(id)` | `Execution` | 读取命令执行记录，验所属会话可见性，复制返回；缺失抛错。 |

```ts
// 以下为核心字段投影，记录可另含 owner_run_id、取消原因等内部归属/状态字段。
type Message = {
  id,conversation_id,version,created_at,updated_at,
  role:"user"|"assistant"|"delegation", status,
  source_conversation_id:string|null,
  reply_to_message_id:string|null,retry_of_message_id:string|null,
  content:({type:"text",text:string}|{type:"report_reference",report_id,revision,title,status_at_send,available_for_analysis})[],
  segments?:({id,type:"text",text}|{id,type:"tool",tool_name,status}|{id,type:"status",text})[],
  final_segment_id?:string|null
};
type Execution = {
  id,conversation_id,workspace_path,started_at,completed_at,command,
  status:"completed"|"failed"|"canceled",exit_code:number|null,error:string|null,
  output:string,execution:"host",
  code:{[path:string]:string},         // 执行前文件摘要
  source_files:{[path:string]:string}, // 执行前文件 Base64
  files:{[path:string]:string},        // 执行后文件 Base64
  snapshot_errors?:{stage:string,message:string}[]
};
```

messages 没有 send/list/update；executions 没有执行或修改入口。对 subagent 的过程数据还受 Store 私有过程数据可见性和任务清理约束。来源：[context.js:123](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:123)、[context.js:174](E:/brief2great/sesame/mt5agent/modules/plugins/context.js:174)、[runtime.js:266](E:/brief2great/sesame/mt5agent/modules/agent/runtime.js:266)、[message-segments.js:1](E:/brief2great/sesame/mt5agent/modules/agent/message-segments.js:1)、[host-workspace.js:57](E:/brief2great/sesame/mt5agent/modules/agent/host-workspace.js:57)。
