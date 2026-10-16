# 自动因子挖掘
从宿主完整能力声明显式选择 evaluator:{plugin_id,tool,arguments?} 和 research:{plugins,tools?}，不自动绑定执行后端。所有插件功能类型均可组合，每个角色可以指定已配置模型。候选格式与数值方法来自所选 evaluator 契约；工作流只保存真实调用回执，不接收模型编造的测量。

公开启动入口是 auto_factor_start；auto_factor_models 返回可用模型，auto_factor_runs 返回实际阶段和结果。已提供的评估实现是 sesame/factor-evaluator 的 factor_evaluate，选择引用为 {plugin_id:"sesame/factor-evaluator",tool:"factor_evaluate",arguments:{dataset:{trainEnd,validationEnd,holdoutEnd,horizon,costBps,quantile},minRankIC,minCoverage,maxCorrelation}}，也可选择其他明确实现 sesame.factor-evaluator/v1 的能力。内置实现需要注册的数值面板 dataset_id，行格式为 {time,symbol,availableAt,fields:{close,...数值特征}}；候选是 AST，例如 {op:"field",name:"signal"}。未安装的实现用 plugin_catalog({plugin_id}) 查公开目录；已安装能力用 plugin_discover/host.capabilities.list。缺实现或数据是明确依赖缺口，不要求翻源码推断。

角色任务的 auto_factor_context 返回 assignment.mode、expectedOutput、评估契约和可分页开发证据。auto_factor_submit 按此契约保存当前角色输出；它为候选和选择附上真正的评估回执。selection 只包含已接受且实测 eligible 的 trialId；没有合格候选时 [] 是有效结果。EVALUATION_REJECTED 表示未提交的语义拒绝，可修正提案；中断或未知结果则保留原输入作幂等恢复。业务 run_id 与宿主 workflow Run 引用不同，排队成功不能作为研究完成证据。
选择研究工具/技能时只用开发集，不把可读取数据称为 sealed holdout。没有有效因子、空选择和提前停止都有效。每个 Agent 提交可供同伴使用的结构化结论；原生工作流结束时发布一份报告及证据附件。auto_factor_activity 打开宿主的 Run 界面，展示真实子任务和结果交接。

宿主在角色运行前检查冻结配置和必要依赖。interrupted 表示保留成果等待解决，不是完成或失败；read 返回待处理中断的 ID、原因和依赖，主 Agent 与用户沟通后，resume 明确选择已处理的 interrupt_ids。恢复继续原 workflow Run/会话与原角色标识，不创建新 generation，不重复 prepare、已完成角色或已保存评估。暂停请求被接收不等于已经到达安全点，read 返回实际状态。缺少 evaluator 独立只读 session 探针时会明确说明预检边界，不猜接口。
