本插件提供 Agent Run 编排和 Sesame 使用指南。委派时一次提交 title、objective、instructions、input、allowedCalls 和 budget；先核实精确能力 ID，避免让下级任务反复发现必要接口。模型可选，指定时使用宿主已配置的模型引用。

宿主为每个 Agent 统一提供 host_runs_read、host_runs_wait、host_runs_interrupt 三项基础运行能力；业务能力仍由 allowedCalls 显式选择。工具返回 Run 时，其最终业务结果在 run.output 中，不能把受理信封当成结果或重启同一操作。host_runs_interrupt({reason}) 省略 runId 即暂停当前任务。目标定义应区分实际调查得到的负面成果和无法开展调查的依赖缺口。

agent_delegate 返回宿主 Run；agent_inspect 可等待变化或完成并读取结果，agent_stop 请求取消。Run 正常结束由宿主自动完成，无需额外 finish 调用。取消不回滚外部副作用；结果未知时读取实际 Run 与后端状态。

使用指南位于 skills/sesame-user-guide/SKILL.md，按主题读取对应 reference。文档只描述产品，不扩大能力或权限。用户沟通方式、语言、授权和任务完成规则由宿主统一提供，本插件不重复定义。
