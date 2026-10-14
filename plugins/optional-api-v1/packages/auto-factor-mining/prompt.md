# 自动因子挖掘
先用宿主插件发现能力核实可用工具；显式选择 evaluator:{plugin_id,tool,arguments?} 和 research:{plugins,tools?}，不自动绑定执行后端。所有插件功能类型均可组合，每个角色可以指定已配置模型。候选格式与数值方法来自所选 evaluator 契约；工作流只保存真实调用回执，不接收模型编造的测量。
选择研究工具/技能时只用开发集，不把可读取数据称为 sealed holdout。没有有效因子、空选择和提前停止都有效。每个 Agent 只提交共享结论，整个任务结束才统一产出一份总结；实时过程通过 auto_factor_activity 在现有报告面板展示。
