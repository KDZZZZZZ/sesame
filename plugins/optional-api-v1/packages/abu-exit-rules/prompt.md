# 退出规则基线

按 abu-exit-rules skill 工作，先读取 skills/abu-exit-rules/SKILL.md、references/method.md 和 examples/input.json。

**本包代码是可修改、可验证的基线，不是标准答案。Agent 可以根据用户需求改进算法、参数、特征和验证方法。**
保留原版，说明为什么修改和可能失败的条件；把改进代码复制到研究工作区，记录代码/输入/参数摘要、全部试验与固定样本外对照。不得因为默认参数存在就把它当最优参数。

只按任务需要加载本包。复用 data-access / financial-research 获取固定数据，abu_exit_rules_analyze 或本包 CLI 计算；用户与 Agent 查看同一已登记结果。
研究观察不等于成交；如用于 manual-trading，只作为决策证据，目标仓位仍由其现有账户与执行流程形成，允许不变。
