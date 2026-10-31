# Ultra 持续协作

官方业务流程插件，组合现有 Agent、workflow、专业知识、数据和执行插件。它保存目标、稳定分支身份、真实 Run、等待与停止状态，不实现交易后端，也不代替领域工作流。

从 1.0.1 起随桌面默认插件包发行，确保内置 `/ultra` 命令在新工作区和已有工作区均可用；默认保持 discoverable，功能分类仍为业务流程，ID 与能力接口不变。

## 输入与控制

- `ultra_start({objective,context?,mode?,max_parallel?,plugins?,success_criteria?})`：当前会话仅一个未结束目标；启动一个真实规划周期，完成后宿主通知主 Agent。模式为 auto/research/monitor/trade，并发默认 8、支持 1–16，不限制总轮数。
- `ultra_dispatch({id?,branches,summary?})`：每个分支为 `{key,title,capability,input,task?,exclusive?,stop?}`。准确能力 ID 必须已经发现/加载。分支键和输入冻结，重复同键返回原记录，改键重复相同工作也拒绝。空 branches 用于推进待执行队列。
- `ultra_status({id?,branch_key?})`：读取实际 Run 状态和保留结果，失败信息不会伪装成功。默认保留所有未结算分支与最近 20 个历史分支，长结果只作预览；按稳定 branch_key 可以读较早分支及完整保留结果，避免每轮反复塞入整段历史。
- `ultra_wait({id?,kind:'runs'|'time'|'event'|'input',...})`：实际 Run 完成、具体 `until`、精确 `source/operation/input` 订阅或必要输入。定时器在持久检查点保存绝对时间；来源初始快照不计为新事件。
- `ultra_resume({id?,response?})`：恢复原中断 Run 的明确 interruption；未知结果要求核验，不重新下单。
- `ultra_close({id?,reason?})`：状态栏关闭或 `/ultra off`、`/ultra close` 使用此入口。立即持久关闭 Ultra 的强制最大并行探索，不取消已经接受的研究、Run 或订阅，不恢复暂停任务，只撤回尚未开始的 Ultra 队列。回到普通模式后，主 Agent 仍可按当前用户需要开启 subagent 和工作流。
- `ultra_stop({id?,reason?})`：保存停止状态，取消登记 Run 的真实子树，再调用已登记的领域停止操作。回执会区别 stopping/stopped，不把取消请求当作实际退出。
- `ultra_finish({id?,summary,evidence})`：有真实完成分支、没有活动/中断分支并提供目标完成证据后结算。

复杂研究的综合分支应设置 `task.output:{type:'report',space:'research'|'strategy',path:'…html'}`，并明确分配报告发布和检查工具。Ultra 目标及等待周期本身没有长期报告绑定。

## 持久性与职责

`owners`、`sessions`、`branches` 使用宿主公开 state 端口与 CAS 写入；业务输入、能力版本和稳定 operationId 在执行前落盘。`authorities` 与 `human_inputs` 仅保存宿主可信的人类输入边界和去重身份，不保存消息正文；停止后旧自动通知不能重启任务，必须出现新的用户指令。`ultra_cycle` 是 resumable native workflow，规划 Agent 是其真实子 Run，等待已登记业务 Run 使用 runs.watch 事件，不忙轮询。定时与来源订阅受本周期 AbortSignal 管理。子任务或周期完成通过宿主已有持久完成通知唤醒主 Agent；主 Agent 根据目标和新成果决定下一批分支，并由真实 main 身份派发，兼容现有仅主会话可调用的工作流。

从 1.0.2 起，`ultra_status` 是宿主状态栏的同一真源，公开 `enabled`、`continuation:'active'|'draining'|'closed'`、`active_work`（正在启动/运行的已登记分支）、`accepted_work`（累计已经开始的分支）和 `queued_work`。`guidance` 提供当前模式的模型上下文指引，只可用于模型组装，不能追加到可见用户消息；状态栏无需展示这段内容。读取不启动研究，也不增加人类输入授权；重复读取未变化的状态不重新写入记录。只有 enabled=true 时展示 Ultra 开启状态，关闭后的 draining 是内部收尾状态，界面不需要显示“收敛中”。

`sessions.continuation` 持久记录模式。关闭先存 draining，有限的已接受研究仍在运行时 status=closing，全部自然结束后变 closed；没有活动有限研究时立即 closed。已有长期调度/订阅不会阻挡模式关闭，不调用其 stop。closed 不等于 completed，原目标只有 `ultra_finish` 的实际证据才能标记完成。关闭与分支接受并发时，已经接受的 Run 会继续保存且不取消；晚到的规划或完成回执携带普通模式指导，不会恢复扩展。宿主可在模型请求组装时读取最新 guidance 覆盖旧 Ultra 命令，不改变可见用户消息，也不限制其他插件的正常调用。

`owners.closeGeneration` 是主会话级持久关闭栅栏；即使还没有写入第一个目标或已经关闭，再次关闭也推进代际。start/resume 只携带本次调用开始时观察到的 controlGeneration，晚于它发生的关闭会挡住旧启动/恢复，避免慢调用把模式重新打开。该机制不依赖取消已经接受的研究。

关闭后的 start/resume 要求一次新的真实且明确的 Ultra 开启输入，例如 `/ultra resume`；authority 记录该输入是否明确请求模式，不保存正文。普通新问题、自动通知与来源子会话不会重新开启。`ultra_stop` 保留硬停止语义，也可对温和关闭后仍保留的订阅或 Run 执行明确停止。

Ultra 开启时，主 Agent 必须每轮主动对照目标找缺口、探索新方法/数据/验证、更新优先级、登记新分支并补可执行工作的空闲槽位；分支运行期间继续寻找和排队下一批工作，受现有 max_parallel、用户目标与真实依赖约束。每次规划都带入已有成果、失败、真实 Run 和上轮计划，原目标未满足不能只给建议后结束。有价值的新工作不设总轮数上限。关闭只解除这一强制原则，不禁用普通模式下按需使用 Agent 或工作流。

公开 `lifecycle.afterAgentTurn` 的 `ultra_after_turn` 提供防漏续办：只有所属 main 的 completed 回调可启动；先观察真实 Run，已登记的可执行工作优先补槽，没有活动周期或明确等待时再启动真实探索周期。一次 hook 最多补一批即时工作，避免占用宿主回调太久。已停止、已完成、用户中断、明确缺输入和仍在等待的真实周期保持原状态。

防空转指纹只包括原目标、真实分支方法/结果/错误、可用能力修订、真实时间/事件观察和可信新用户输入，不把回复 ID、更新时间或改写规划文字算进展。再次遗漏同一方案会保留成果并显示 `CONTINUATION_STALLED` 调度异常，不结束目标、不要求重新批准；主 Agent 用新可执行方法直接派发即可恢复。新的实测结果、方法或依赖变化允许继续规划，正常研究不会因为到达某个轮数停下。

业务分支与监督周期是分别可见的真实根 Run；可能分别产生完成通知。主 Agent 以 `ultra_status` 和稳定分支键去重，不依靠“收到几条通知”推断完成。插件不伪造来源身份、不使用私有数据库、不新增消息入口权限。

同一 Ultra 的并发槽位由插件执行控制。声明含交易副作用，或 Agent 分配了这类工具时进入单个串行执行通道。通用进程/native-call 也进入该通道，因为它们不能证明不会交易。Agent 不允许借通用 invoke 或再开任意 Agent 绕开明确分支工具与通道。独立研究仍可与该执行分支同时推进。来源、账户与权限保持宿主及领域插件的原规则。

已有调度器/订阅必须携带可幂等执行的 stop 操作；已成交订单和外部事实不会因取消宿主 Run 自动回滚。外部副作用结果未知时保留原操作标识供核验；插件不承诺外部 exactly-once。

宿主关闭时由现有 Run 生命周期停止活动执行。重启后保留状态和检查点，显式 resume 继续，不自动恢复用户停下的任务。等待本身不保证模型服务一定可用；中断显示具体依赖并保留成果。

## 参考与验证

持久检查点、恢复沿用原任务与副作用幂等的设计参考 [LangGraph Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)，实现只使用 Sesame Plugin API 2 公共端口，无新增依赖。

`node --test tests/*.test.js` 覆盖真实状态写入次序、分支并行/去重、交易单通道、Run 事件唤醒、时间等待、停止、会话隔离与恢复，以及完成回调防漏续办、实质进展去重、真实宿主 lifecycle 投影。固定夹具不代表已在真实模型或券商执行研究/交易。
