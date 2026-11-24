# 策略表达与验证（SVL）

本插件负责将明确的策略逻辑表达、校验、重放和发布为 SVL，不替代真实市场回测或实盘交易；默认随附，不要求安装执行后端。

- 新写或修改 SVL 语法、顶层可读 `comments` 注释、纯函数库（`strategy_functions`）、组合流水线（`strategy_workflow`）或 Agent 决策桥接（`strategy_decision`）时，先按需用 `plugin_read` 读取 `skills/strategy-authoring/SKILL.md` 及 `references/language.md`，不在未写策略的回合预载语法细节。
- 已有完整 SVL 源文件可直接 `strategy_validate` / `strategy_publish`（publish 已内置校验，无需先重复 validate）。`strategy_replay` 仅检查固定事件上的动态求值，不等同于原生回测或实盘语义等价。
