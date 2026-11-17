# Host API 2

host.context 是不可变元数据，包含 plugin/session/Run 身份、工作区和插件路径、配置模型引用、filePolicy 路径边界；它不暴露 runtime、凭据或可变调用身份。宿主有八个端口：

| 端口 | 方法 |
| --- | --- |
| capabilities | list(filter?)；check(id,input,options?)；invoke(id,input,{operationId?,timeoutMs?,signal?,task?}?) |
| runs | list(filter?)；read(ref,{include?,cursor?,limit?}?)；wait(ref,{until?,afterVersion?,timeoutMs?,signal?}?)；cancel(ref,{reason?}?)；interrupt(ref,options?)；resume(ref,options?)；message(ref,options?)；watch(ref,{afterVersion?,signal?}?) |
| data | sources(filter?)；query({source,operation?,input,cursor?,limit?},{signal?}?)；watch({source,operation?,input},{signal?}?) |
| resources | create(input,options?)；list(filter?)；read(ref,options?)；write(ref,input,options?)；move(ref,input,options?)；remove(ref,input,options?)；publish(ref,manifest,options?) |
| state | read({collection,key},{version?}?)；query({collection,filter?,sort?,select?,cursor?,limit?})；commit(changes,{operationId?,signal?}?)；watch(query,{signal?}?) |
| views | inspect(input?,{signal?}?)；apply(input)；open(input,{signal?}?)；close({viewId}) |
| plugins | search(filter?)；read(id,{part,path?})；install(source,options?)；update(id,source,options?)；setEnabled(id,enabled,options?)；remove(id,options?) |
| events | on({topic}|{hookId},{signal?}?)；emit({topic,payload}) |

invoke 返回 {type:"result",value,receipt} 或 {type:"run",run,receipt}。完整插件能力 ID 为 pluginId#localId；内置保留 host.agent.run、host.model.complete、host.process.exec。consumer 身份由宿主固定，插件或Agent不能通过参数伪造。

data source 引用为 {providerId:"pluginId#sourceId",revision,binding?}。数据查询的绑定、页游标、释放由宿主管理，真实每页数据不会替换成10行预览。query 输入按来源操作 schema；watch 先 snapshot 后 delta。host#datasets、host#executions、host#records 等只读来源 revision 为 host:2，只认实际宿主记录。

资源 create 返回 ResourceRef（直接是引用）；read(metadata) 返回路径和版本。write/move/remove 必须 expectedVersion。publish 使用清单 blobs:{entry?,path,mediaType} 对应真实受管文件，宿主验证 artifact schema、固定引用和发布冲突。view inspect(surface:"artifact",ref) 执行真实报告渲染检查。

state commit 每项 {op:"put"|"append"|"delete",key:{collection,key},value?,expectedVersion}，创建时版本0。自己的集合可写，其他插件仅 workspace 集合可读；不把私有持久状态藏在未声明宿主注册表。

views canvas/indicator 修改需要 commandId 和 expectedVersion，保留用户锁。drawing surface 共享指标成果与源码；inspect 使用 chartId/drawingId，apply 还需要 expectedRevision（新建 null）、完整 binding，以及 drawing 或 source。绘图更新的 scriptId 会变化，drawingId 稳定；冲突不覆盖用户编辑。open 的 live view 必须静态声明，文档/快照/流操作由宿主分发。events 只暴露 workspace.* 或本插件已声明hook通知，不能订阅原始凭据/Store事件。

host.process.exec 输入 {argv,cwd,env?,stdin?,timeoutMs?}，返回真实 Run。host.agent.run 输入 {title,instructions,objective,input,allowedCalls,model?}，返回真实 Agent Run。不要重建旧的 tasks/process/providers/workspace/storage HostContext。

host.agent.run 还可用 plugins 选择知识包、output 请求报告输出；knowledge 不授予工具，额外工具由 allowedCalls 指定。每个子 Agent 基础可用 Run read/wait/interrupt 和精确 resource read；其它工具都应明确授予。模型使用 host#models 或 context.models 返回的完整冻结引用。

顶层 Agent 或工作流 Run 完成并收尾后，宿主自动把原 Run 结果通知所属主 Agent，并可唤醒空闲会话；内部成员先交回工作流控制器。插件不需另建轮询器或伪造用户消息来通知任务完成。通知不增加原任务授权，读取/等待仍用于核对真实状态。

通讯插件通过现有 events 端口向主 Agent 入站，不新增端口：

```js
host.events.emit({
  topic: "workspace.agent.message",
  payload: {
    messageId: "external-message-123",
    text: "用户从已连接渠道发来的请求",
    as: "user",
    channelId: "connected-channel",
    senderId: "verified-sender"
  }
});
```

as 必须显式为 user 或 automation；user 必须同时提供 channelId/senderId，渠道认证与发送者映射由通讯插件负责，自动状态通知使用 automation。宿主记录真实插件版本和来源，将消息持久入队，忙时顺序排队、空闲时唤醒主 Agent；不会因发消息而自动恢复暂停 Run。messageId 是同一插件、渠道下的稳定幂等键，同一键重试必须保持正文与身份不变。text 为 1–50000 字符，整体 payload 不超过 64 KiB。emit 回执只证明消息已受理，不证明主 Agent 已处理完成；禁止把密钥放进正文。该入站主题不通过普通 workspace 事件订阅广播消息正文。

原生绑定 `execute(input,signal,execution)` 的 execution 另外提供 run、attempt、checkpointState、resume、checkpoint、interrupt、emit、progress、task、context、provenance；不是第九个 HostContext 端口。`execution.setCollaboration(value|null)` 仅供运行中的 workflow 在首次 child 前声明本次 agents/relationships；一次冻结、同值恢复幂等，不能用它改变调用权限或重排已经执行的任务。任务计划由插件校验与执行，不向宿主注册另一套运行引擎。

暂停后用原 Run 的 interruptIds 和实际解决信息调用 runs.resume；发送 message 不隐式恢复。operationId 重用必须是同一操作和输入，未知结果不能换 ID 重发。详见 [恢复约定](recovery.md)。

plugins.setEnabled(id,true,{scope:"session"}) 为本会话加载；scope:"workspace" 的布尔接口管理 mounted/disabled，完整 mounted/discoverable/disabled 由客户端三态设置提供。发现、按需读取和管理状态不等于自动装配。更新携带 expectedRevision，配置变更携带相应版本；插件实际启用与依赖可用后再执行。
