# 工作流计划与可调整阶段

当前可调整的实际入口：

| 工作流 | 可调整内容与边界 |
| --- | --- |
| Investment Research | workflow.stages 选择成员、角色、阶段顺序及并行组，可增 custom 角色；synthesis 指向最后阶段唯一综合成员。省略时沿用默认八成员；研究交付需绑定报告，由 synthesis 发布，内部成员不各自制作报告。 |
| Auto Factor Mining | config.workflow 指定假设、实现、评审、反思和选择的成员，同一人可兼任；plan/review/reflection 可省略。真实 evaluator、候选资格、固定选择和独立留出验证仍需满足。 |
| Trading Decision | plan.workflow.reviews 添加顺序复核；execute:false 只形成决策与报告。复核阻止时不能执行，复核成员无下单权限；原账户、授权和风险约束保持有效。 |

计划随受理的 Run 冻结，暂停/恢复沿用同一计划与已完成成果。改变计划需创建新一轮并明确复用哪些固定证据；不要改运行中身份、重放已完成外部动作，或用未声明的输入伪装成流程调整。因子与策略研究指南可用于设计其他流程，ICT 等专业知识只回答其中的具体问题。
