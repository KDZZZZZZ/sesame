# vnpy 公开能力契约
此文依据当前实现。示例中的ID/路径/Ref必须用对应公开入口的实际返回值；它们展示参数形状，不是默认任务步骤。宿主能力不会直接暴露为普通Agent工具。

## vnpy_environment
调用者：agent、host。核验/选择实际VeighNa环境，或有界准备私有依赖。

输入：{action:"inspect",python_path?} 核验显式/已选/宿主Python；{action:"prepare",python_path:<已知兼容或安装所用base路径>} 选择现有环境或准备私有依赖。最小例 {action:"inspect"}。

输出与状态：成功:{ready:true,reused,configured,environment:{python,packages,origin,downloads,...},findings}；缺失:{ready:false,requirements,findings,next}；准备中:{ready:false,configured:false,phase,progress,error,retryable,privateDirectory,cacheDirectory,next}。

依赖入口：本机64位Python3.10–3.13；固定vnpy4.5.0/CTA1.4.1。ready:true且configured:false可对同一python prepare保存选择，不下载。

副作用：process、private-filesystem、plugin.state.write、network-on-prepare

边界与恢复：prepare可能下载大Qt包；retryable:true且进度变化才有继续依据，使用相同base路径保留缓存。retryable:false停止自动重试；不换镜像/删除缓存来绕过失败。依赖就绪不代表策略回测成功。

## vnpy_backtest
调用者：agent、host。运行固定输入的VeighNa CTA原生回测并冻结证据。

输入：{operation_id,title,data,strategy_path,class_name,config,parameters?,columns?,timeout?}。data 为 data_snapshot 等公开数据工具返回的固定 {id,revision,digest,kind:"data",schemaVersion:"1.0.0"}，内容为 json-rows；禁止猜引用/用可变datasetId代替。 strategy_path 是工作区真实单文件（≤512KiB），class_name 为已编写的CtaTemplate类名；输入2–100000行、≤16MiB，列默认datetime/open/high/low/close/volume，columns可改名，未知量不填0。config最小例 {vt_symbol:"TEST.LOCAL",interval:"d",rate:"0.001",slippage:"0",size:"1",pricetick:"0.01",capital:"100000"}；interval=1m|1h|d|w，start/end可限定；无时区时间必须给原始wall_time_authority。

输出与状态：{ref:<固定strategy.result>,status:"completed"|"failed",data:[{id:"daily"|"trades"|"orders",ref,rowCount}],statistics,diagnostics,executionRunId,nativeSource,environment,rawResult,execution:"host"}；failed没有成功表；中断保留unknown/运行操作记录，不自动重放。

依赖入口：vnpy_environment ready:true 且 configured:true；固定数据和工作区代码来自本任务。公开 skill 给出原生接口/单位，无须阅读安装源码。

副作用：process、private-filesystem、resources.publish、plugin.state.write

边界与恢复：执行当前用户权限的真实Python，宿主可取消但不是OS沙箱；引擎本身只使用固定数据，不连接实盘broker。 operation_id绑定代码、数据、参数和撮合配置；相同输入重试读原结果，改变输入须新研究意图。失败读diagnostics；未知不声称完成。 demo来源保持demo；completed只表示引擎完成，不证明盈利、SVL等价或实盘有效。原生浮点不具decimal34等价。

## vnpy_result
调用者：agent、host。读取固定原生回测成果与其可追溯证据。

输入：{ref:<backtest返回的完整strategy.result引用>}；不传operation_id或工作区文件路径。

输出与状态：{ref,manifest}；manifest.content 含 status,title,engine,environment,assumptions,inputs,nativeSource,rawResult,data,statistics,limitations,provenance；表中ref可交data_read。

依赖入口：已有固定strategy.result；此读取不需要Python/终端。

副作用：只读，无外部写入。

边界与恢复：读取不重跑回测；统计与输入范围、成本和demo标签一同解释。

## vnpy_dispose
调用者：host。关闭插件自有资源。

输入：宿主生命周期输入 {}。

输出与状态：{closed:true}。

依赖入口：仅宿主卸载/关闭时调用。

副作用：plugin.session.close

边界与恢复：释放插件存储和自有会话/订阅；不删除已发布证据，不结束用户交易终端。
