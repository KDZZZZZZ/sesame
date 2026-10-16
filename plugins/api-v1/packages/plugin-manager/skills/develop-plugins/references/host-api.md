# Host API 2

host.context 是不可变元数据，包含 plugin/session/Run 身份、工作区和插件路径、配置模型引用、filePolicy 路径边界；它不暴露 runtime、凭据或可变调用身份。宿主有八个端口、33个方法：

| 端口 | 方法 |
| --- | --- |
| capabilities | list(filter?)；invoke(id,input,{operationId?,timeoutMs?,signal?}?) |
| runs | list(filter?)；read(ref,{include?,cursor?,limit?}?)；wait(ref,{until?,afterVersion?,timeoutMs?,signal?}?)；cancel(ref,{reason?}?)；watch(ref,{afterVersion?,signal?}?) |
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

views canvas/indicator 修改需要 commandId 和 expectedVersion，保留用户锁。open 的 live view 必须静态声明，文档/快照/流操作由宿主分发。events 只暴露 workspace.* 或本插件已声明hook通知，不能订阅原始凭据/Store事件。

host.process.exec 输入 {argv,cwd,env?,stdin?,timeoutMs?}，返回真实 Run。host.agent.run 输入 {title,instructions,objective,input,allowedCalls,budget,model?}，返回真实 Agent Run。不要重建旧的 tasks/process/providers/workspace/storage HostContext。
