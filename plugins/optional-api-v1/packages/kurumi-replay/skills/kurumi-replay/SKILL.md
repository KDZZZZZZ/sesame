---
name: kurumi-replay
description: 准备久留美三章连续模拟数据源，启动受限真实角色Agent，主Agent解说、原生Dashboard观战与阶段报告；不会连接真实券商。
---

# 久留美数据源与角色子Agent

角色任务不读本文件，只观察和提交本步。主Agent执行：

1. `kurumi_status` 查当前状态。首次 `kurumi_prepare {action:"prepare"}` 明确下载私有固定依赖和限定真实历史；不会向系统Python安装，不打包整批市场数据。不完整行情暂停，不填造价格。
2. `kurumi_start` 指定唯一 `command_id` 与 `expected_version:0`、`max_steps:1` 完成小闭环；后续 `kurumi_continue` 或 `kurumi_step` 使用最新控制revision。角色只选真实 `openai/gpt-6.1-sol` 描述符，无此模型停止，不能切换。
3. `kurumi_display` 使用已注册market/account和公开layout显示当前章H1、模拟账户与观众两层标记。通过 `canvas_inspect` 核对客户端回执；不能把layout写入成功当成图已显示。Account页选择“久留美模拟”，所有资金/持仓/订单/成交是模拟数据。
4. 主Agent解说实际账本，不替久留美做决定。可以用标准任务管理工具观察角色子Agent。每H1只能一个受限角色任务；`kurumi_observe`只返回已知快照，`kurumi_decide`提交本步目标基础货币数量。买正卖负、0空仓、1000倍数。明确hold也提交原数量；聊天文本不算决定。
5. 本次允许完成的H1步数由max_steps固定；不能未经要求自动跑完。失败后的同一步恢复必须由主Agent明确核对旧任务终态，保留付费请求证据，不重发未知任务。章间强制空仓结算并暂停展示下一章，后续资金仍同账户。破产停止，不归零负余额、不补款、不为跳过月份记收益。
6. `kurumi_pause`取消角色与后续请求，不撤销已经原子提交的成交。重启从已提交账本恢复但不启动模型。未知/取消/中断任务先 `kurumi_reconcile` 核对宿主终态，再显式继续；不要用新ID重发未知成交。
7. 优先 `kurumi_export {operation_id:...}` 返回已揭示行的固定 data 引用与实际角色/账本/检查点 resource 引用，现有 reports 插件可直接复用。导出不含授权 token 或完整未来行情数组。
8. `kurumi_report {operation_id:...}` 冻结当前已揭示行情和真实角色提交/模拟成交/成本/权益及模型来源，使用Sesame reportKit风格，只读，不加下单按钮。检查返回实际render receipt；失败应修复新revision再检查。报告结果只解释已发生，不当成严格历史盲测或真实交易收益。

控制工具main-only；其他子任务即使拿到工具名也不符合宿主当前任务身份与run/step授权。角色子Agent的工具allowlist明确只有两个玩家工具，没有文件、网络、配置或交易后端权限。

原剧情对照是非官方二创、存在大量拟合价与不明成交时间。观众标记有独立颜色/前缀，与模拟成交明显区分。无法证明精确时间的只作区间注释，不安放成精确交易点；只有当前已揭示时期可显示，且不传角色。没有图片、原文长对白或目标盈利写死。

规则和数据口径见包内 RULES.md / DATA.md；所有三章杠杆/强平为开局固定挑战假设，并非漫画券商已核实条件。H1只是角色决策节奏，不将OHLC声称tick。成熟引擎依赖或同步换汇不满足时，不回退自写H1极值引擎。

## 环境与原决定恢复
正式 ready 必须经共享真实 probe，不能仅看 receipt 文件。任何付费任务前会检查后端；失败先由主 Agent 显式 prepare。已有挑战 prepare 不重新下载行情或改来源/账户。已存在固定 receipt 但 probe 失败不会触发自动重装。
原角色已提交但原生执行失败时，优先 main-only `kurumi_recover`，传原 failed_not_committed 的 decision.id 和最新控制 revision。该接口核对原真实 task/request 终态、failed decide 证据及账本尚未提交后，只执行保存的同一决定，不启动模型。原失败与恢复证据分开保留。不得修改数据库、冒充角色重调 decide；同一 command 幂等，未知恢复先核对，暂停不提交，重启预约须 reconcile。


## 中断恢复显式核对（dev.3）
恢复预约记录原版本与决定ID；重启标为待核对，绝不自动重放。主 Agent 用 `kurumi_reconcile` 核对持久挑战账本：`reconciliation.status=not_committed` 后以新恢复 command_id 和最新 revision 显式 recover；`committed` 表示已有原决定，不再重放；`unknown` 保留阻塞，按诊断先读取 status/export 核对身份、固定来源与账本。不能改数据库消除占位。
运行/待核对 recovery 期间 prepare 拒绝。稳定操作ID重复查询不重复撮合。nativeEnvironment 是短摘要，完整依赖与许可证证据在私有 receipt/固定导出 artifact 可按需读取。
