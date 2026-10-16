# backtrader 公开能力契约
此文依据当前实现。示例中的ID/路径/Ref必须用对应公开入口的实际返回值；它们展示参数形状，不是默认任务步骤。宿主能力不会直接暴露为普通Agent工具。

## backtrader_environment
调用者：agent、host。核验并选择现有依赖；仅显式 prepare 可能安装私有依赖。

输入：{action:"inspect",python_path?} 检查给定/已选/私有/宿主/PATH Python；{action:"prepare",python_path?} 在无兼容环境时创建私有 venv。最小例 {action:"inspect"}。

输出与状态：ready:true 返回 python、实际 Python/库版本、reused、origin、downloads/audit；inspect 成功会保存私有 selection，随即可用。ready:false 返回 required 和 failures[{python,code}]。

依赖入口：本机64位 Python>=3.11；库固定 backtrader 1.9.78.123。已有路径可直接传 python_path，不必先扫描磁盘。

副作用：process、plugin.state.write、private-filesystem、network-on-prepare

边界与恢复：inspect 不下载；prepare 从官方 PyPI 安装到插件私有目录，不安装解释器、不改共享环境。失败根据缺失解释器、导入版本或具体网络错误选择现有路径/准备；重复同一失败不产生新证据。

## backtrader_backtest
调用者：agent、host。运行固定输入的Backtrader Cerebro原生回测并冻结证据。

输入：{operation_id,title,data,strategy_path,class_name,config,parameters?,columns?,timeout?}。data 为 data_snapshot 等公开数据工具返回的固定 {id,revision,digest,kind:"data",schemaVersion:"1.0.0"}，内容为 json-rows；禁止猜引用/用可变datasetId代替。 strategy_path 是工作区真实单文件（≤512KiB），class_name 为已编写的backtrader.Strategy类名；输入2–100000行、≤16MiB，列默认datetime/open/high/low/close/volume，columns可改名，未知量不填0。config最小例 {capital:"100000",commission:"0.001",slippage:"0",feed:{timeframe:"days",compression:1}}；费率/滑点是比例，小时柱用minutes/60；时间必须明确UTC/offset或UTC SourceTime，严格递增。

输出与状态：{ref:<固定strategy.result>,status:"completed"|"failed",data:[{id:"equity"|"trades"|"orders",ref}],statistics,diagnostics,executionRunId,nativeSource,environment}；failed没有成功表；中断保留unknown/运行操作记录，不自动重放。

依赖入口：backtrader_environment inspect/prepare ready:true；固定数据和工作区代码来自本任务。公开 skill 给出原生接口/单位，无须阅读安装源码。

副作用：process、private-filesystem、resources.publish、plugin.state.write

边界与恢复：执行当前用户权限的真实Python，宿主可取消但不是OS沙箱；引擎本身只使用固定数据，不连接实盘broker。 operation_id绑定代码、数据、参数和撮合配置；相同输入重试读原结果，改变输入须新研究意图。失败读diagnostics；未知不声称完成。 demo来源保持demo；completed只表示引擎完成，不证明盈利、SVL等价或实盘有效。原生浮点不具decimal34等价。

## backtrader_result
调用者：agent、host。读取固定原生回测成果与其可追溯证据。

输入：{ref:<backtest返回的完整strategy.result引用>}；不传operation_id或工作区文件路径。

输出与状态：{ref,manifest}；manifest.content 含 status,title,engine,environment,assumptions,inputs,nativeSource,rawResult,data,statistics,limitations,provenance；表中ref可交data_read。

依赖入口：已有固定strategy.result；此读取不需要Python/终端。

副作用：只读，无外部写入。

边界与恢复：读取不重跑回测；统计与输入范围、成本和demo标签一同解释。

## backtrader_dispose
调用者：host。关闭插件自有资源。

输入：宿主生命周期输入 {}。

输出与状态：{closed:true}。

依赖入口：仅宿主卸载/关闭时调用。

副作用：plugin.session.close

边界与恢复：释放插件存储和自有会话/订阅；不删除已发布证据，不结束用户交易终端。
