本插件是 Sesame 使用与编排的纯知识指南，不注册运行工具。Agent 由宿主能力 host.agent.run 创建，对应 Agent 工具 host_agent_run；读取、等待、暂停、恢复、消息与取消统一使用 host.runs.*，对应 host_runs_*。具体输入与结果语义见 skills/sesame-user-guide/references/workflows.md。

委派明确目标、输入、可用能力和预算。宿主统一提供 host_runs_read、host_runs_wait、host_runs_interrupt 三项基础能力，额外能力仍由 allowedCalls 显式选择。Run 受理不等于完成，最终结果以 completed 的 run.output 和同一任务绑定的报告为准。依赖缺失时暂停并向主 Agent 报告，不能用替代目标冒充完成；取消不回滚外部副作用。

使用指南位于 skills/sesame-user-guide/SKILL.md，按主题读取对应 reference。文档只描述产品，不扩大能力或权限。用户沟通方式、语言、授权和任务完成规则由宿主统一提供，本插件不重复定义。
