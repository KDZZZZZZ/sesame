# Agent 参与策略：外部决策输入

这是策略创作与后端适配的工程规范。插件提供独立 Agent 决策服务、可选本机后端桥、持久请求记录及固定时间线回放；原生引擎的事件适配与交易传输仍由目标插件完成。参考求值、模型判断、原生回测是三种不同证据。

## 工具与调用顺序

1. `strategy_decision({action:"models"})` 返回用户已经配置的模型及配置摘要。选择并固定完整 `{provider,id,configurationDigest}`，无需重新填写 API Key。
2. 将请求写入工作区 JSON，调用 `strategy_decision({action:"submit",request_path:"strategies/decision.json"})`。立即得到 job ID，主 Agent 可以继续其他工作。
3. `strategy_decision({action:"status",job_id,wait:true})` 等待任务；不传 wait 则立即查看状态。停止等待不会取消模型任务，取消使用 `action:"cancel"`。
4. `strategy_decision({action:"timeline",job_id,as_of_ms,output_path,operation_id})` 导出截止该 UTC 时刻的 `signals/advice/guards`，可送入 strategy_workflow。不会重新请求模型，也不导出晚于截止时间完成的任务。
5. 背景改变、用户撤回策略时调用 `action:"invalidate"`，取消同一 portfolio run 的旧任务、退休旧信号，并使旧风险建议失效。历史模式必须传 `as_of_ms`，使用当前模拟 UTC 时刻；不得早于已触发请求、已完成结果或之前的失效事件。实时模式省略此值时使用当前时间。限制风险的模型结果也会使旧代次的在途请求失效，但不会清除其他独立风险来源的建议。

请求 schemaVersion 为 `1.0.0`，包含：

- `requestId`：相同内容重复提交返回原任务，同 ID 不同内容拒绝。
- `scope`：`{strategyId,runId,account:{connectionId,accountId},instrument:{sourceId,instrumentId}}`；`channel` 为判断通道名。
- `mode`：live 或 historical；`triggeredAt`、`dataCutoffAt` 均为 `{basis:"utc",unixMs}`。
- `inputs`：`[{ref:完整ArtifactRef,availableAt:UTC时间,paths?:[blob路径]}]`。服务读取成果的实际 content 和指定文本/JSON blob，总量限 1 MiB；不要另写未经引用固定的内容。
- `program`：`{id,version,role:"signal"|"risk",feedback:"market"|"account",model,prompt,ttlMs,maxInputAgeMs,maxTokens,timeoutMs,maxRetries?:0..3,temperature?,reasoning?,failurePolicy:"halt_new_risk"}`。整体超时最多三十分钟，重试固定间隔五秒，不能延长信号寿命。
- 历史模式另带 `simulation:{id,parametersDigest,stateDigest,step,latencyMs}`。同一 run 固定模拟身份和参数；每步须等待上一步返回后按模拟时钟推进，不能混合不同模拟账户路径。

signal 返回 `{direction:"long"|"short"|"flat",confidence?:"十进制字符串",reason,evidence:[已有输入引用]}`；risk 返回 `{action:"allow"|"halt"|"flatten"|"cap",cap?:{value,unit},reason,evidence}`，仅 cap 可含数量。模型不能自行提供下单命令、时间、有效期、账户身份或更宽的硬风险政策。

模型上下文只有固定程序与引用输入，不包含主聊天、长期记忆、任意工具或隐藏推理。失败、过期、撤回、superseded 和重启导致的 interrupted 有独立状态。重启不会自动重发未确认请求。配置摘要不等于供应商权重摘要，保存记录明确标注这一点。

代次变化与故障阻断持久保存发生时点。`timeline` 按 `as_of_ms` 投影：未来的失效、恢复与代次不能改变过去查询；摘要覆盖 scope、查询时点、可见代次和完整输出。显式 invalidate 后，旧风险许可不能满足新信号的 `requiredRiskSources`，必须生成新的风险判断。历史查询只读保存记录，不使用当前系统时钟代替回测时钟。

## 本机后端桥

`strategy_decision({action:"bridge_start"})` 返回 loopback endpoint 和随机 Bearer token。仅将 token 写入后端本地配置，不放进报告、SVL 源或成果。桥监听 127.0.0.1，拒绝浏览器 Origin，应用退出后失效。

| 请求 | 用途 |
| --- | --- |
| GET /health | 鉴权健康检查 |
| POST /requests，body 为完整请求 | 排队并立即返回 202，不等待模型 |
| GET /requests/{jobId} | 状态与结构化输出 |
| POST /timeline，{jobId,asOf} | 已保存的 signals/advice/guards |
| POST /cancel，{jobId,reason,asOf?} | 取消单个任务；可传明确模拟时刻 |
| POST /invalidate，{jobId,reason,evidence?,asOf?} | 作废此 run 的旧代次、旧信号与旧风险建议；历史模式必填 asOf |

携带 `Authorization: Bearer <token>`。bridge_stop 关闭入口但不取消已有模型任务；取消用 cancel/invalidate。插件卸载或应用退出会取消任务。原生事件循环只做有短截止的本机提交/读取，不同步等待远端模型；桥不可用时，持仓和保护仍由后端管理。

## 两种角色，共用时间线

Agent 可以生成方向、预测期限、幅度等信号，也可以根据公告、新闻、政策或其他非技术信息生成风险约束。它不在普通数学节点中调用模型，不与订单发送共用一条阻塞执行链。

```text
明确来源的行情/公告/账户快照
  → 冻结当时可知的输入
  → 独立 Agent 决策任务
  → 校验、记录结构化结果与可用时间
  → 后端的 external.input
  → 信号 → 目标组合 → 风险调整 → 执行
```

慢模型可以负责市场情景和风险背景，较快的模型或算法负责短周期信号；两者都输出有版本、有效期和来源的记录。高频订单管理、已有保护与硬性风险检查继续在后端运行。模型超时不应阻塞成交回报处理。

交易后端保持自己的事件循环、持仓、挂单、未决请求、撮合和原生订单接口。适配插件将实时决策消息或历史文件转换为相同的策略输入。若启用 Agent 判断的策略依赖常驻服务，应由插件明确该服务的生命周期、恢复方式和断连政策；关闭 Sesame 后不能假定模型仍运行。

## 时间和身份必须冻结

每项外部判断的记录至少能定位：

- 策略修订、运行身份、决策角色，以及关联账户/品种；公开行情信号可通过显式绑定用于多个运行，不能挪用包含其他账户私有状态的判断。
- 请求 ID、输出 ID、修订或被替代/撤回的输出。
- 资料发生时间、资料首次可获知时间、输入截止时间、请求触发时间、响应完成时间、后端首次可消费时间、失效时间。
- 数据快照与工具返回的固定引用、模型/供应商及可得的版本标识、提示词和插件版本、参数、实际结构化响应。
- 决策实际引用的证据与简明理由。不能用事后说明冒充当时记录，也不要求保存模型隐藏思维链。

`availableAt` 是策略首次允许消费该记录的时间，不是新闻发生时间或模型请求开始时间。历史模拟时必须说明响应延迟如何得出。若 10:00 发起分析，10:00:18 才收到可消费结果，不能在 10:00 的价格上使用该判断。

自报 confidence 只是模型输出，未经过独立校准不能称为准确概率。正文、理由和引用均是策略数据，不能改变宿主/插件权限或执行任意指令。

## 回测分成两类

**市场条件型判断**只依赖当时的行情、新闻、公告等外生信息，可以按历史时间点生成并冻结一条决策时间线，再由原生回测引擎读取。缓存键必须包含输入快照、输入截止时间、决策程序/提示词版本、模型和参数；变化后需要新时间线。参数优化只有在这些输入均不变时才可以复用旧判断。

**账户反馈型判断**会读取模拟持仓、盈亏、挂单或先前决策，必须沿每个候选策略自己的模拟轨迹按序生成；不能拿另一组参数下的账户判断文件复用。需要引擎支持逐事件同步或可恢复的检查点；目标没有这种能力就报告不支持该回测方式。不要用固定信号回放伪装账户反馈闭环测试。

回测结果要固定决策时间线及摘要，同时记录延迟、过期、丢失、重试、降级、成本和采样政策。换模型或提示词属于另一种策略配置，不能在同一回测中偷偷选择事后更有利的答案。随机性以保存的实际响应固定；设置 temperature=0 不等于能重新生成完全相同的输出。

提供给模型的资料必须按当时版本和可获知时间截断。今天的网页或修订后的财报不能冒充历史可得数据。现代模型也可能从训练中记住历史结果，资料截断无法证明消除了这类泄漏；历史实验必须披露这个限制，并用后续前瞻记录检验。输出时间线可重放，只证明实验可复核，不证明历史判断无泄漏或未来盈利。

主 Agent 负责设计和解释策略，交易时的决策使用独立、固定版本的任务上下文。历史决策不能继承主对话中已知的未来结果，也不能读取后来形成的长期记忆；可调用资料工具与记忆都要遵守同一历史截止。这是专用决策任务的数据契约，不改变主 Agent 日常研究的能力。若目标不能提供这样的历史上下文，结果只能标记为受该限制的探索实验。

## 故障与风控规则

策略必须预先声明每种必需判断缺失、过期或超时后的动作：例如暂停新增风险并继续管理已有保护，或切换到经过验证的纯算法模式。不能在失败后临时猜测“继续上一次判断”，也不能把缺失的风险判断当作风险为零。

本服务固定采用 `halt_new_risk`：新任务仍在排队或运行时，原先未过期的有效判断可以继续使用；一旦最新任务失败、响应过期、被取消或在重启时中断，就退休旧信号并持久生成带 scope 与证据的阻断 guard，即使之前没有任何信号。只有同通道、较晚修订且在阻断时刻之后完成的有效判断才能解除该阻断，旧信号不会因此恢复。故障 guard 保守作用于关联品种，已有持仓的减仓和保护处理继续执行。尚未解除时 `blockedUntil` 为 UTC `Number.MAX_SAFE_INTEGER`；已经恢复也不会向过去查询泄漏未来的解除时间。

更新修订而产生的 `superseded` 不另加故障 guard；被替代的迟到结果不能覆盖新结果，也不能阻断较新的成功判断。消费者必须处理完整 `signals/advice/guards`，不能只取最近一条方向。普通信号寿命结束后自然变为无效，不意味着自动清仓；某个必需来源缺失时，由固定风险政策拒绝新增风险。

Agent 风险建议只能在固定硬性限制内收紧。提高额度、放宽最大损失或更换约束属于另一个策略/政策修订。风险清仓应同时使相关旧信号失效或进入冷却，否则下一次组合计算可能立即重新入场。信号自然过期是否退出已有仓位必须由策略明确规定，不能统一假设过期即市价清仓。

实际运行时，硬性政策由后端从该 run 固定的配置与摘要读取；Agent 决策消息不能携带一份替代政策。`strategy_pipeline` 只校验给定 fixture 与引用存在性，不能据此认证调用方的交易授权，也不能取代后端下单前的实时硬风险检查。

迟到输出不得覆盖较新的修订；过期输出不得恢复效力。重试复用请求身份。原生发送结果不明时先核对账本和券商状态，不能因为 Agent 又输出同一方向便再次下单。

撤回、清仓或新的风险限制到达后，消费者须废弃受影响的旧计划并重算，不能把 `validUntil` 当作忽略新事件的许可。决策服务已实现请求代次、取消与过期拒绝；后端仍须把新 risk/guard 送入自己的计划重算和下单前检查，不能忽略时间线的 guard。

## 后端适配与证据

LEAN 的自定义数据/预计算预测可以作为历史决策输入。MT5 实时阶段可由目标插件选择原生支持的消息或文件机制；MT5 Strategy Tester 不执行 `WebRequest`，因此不能承诺把实盘 HTTP 模型调用原封不动放入 Tester。历史时间线应随测试资源冻结，使用目标实际支持的文件读取机制。Python 后端可以实现相同契约，具体 API 和闭环回调能力要按安装版本验证。

可视化把 Agent 判断展示为有版本的外部输入节点，提供当时证据、输出、可用时间、失效时间和后续分支。原生成交必须能关联到实际消费的决策版本；参考 replay 和模型事后解释都不能代替原生执行记录。

参考：[LEAN 框架](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/overview)、[预计算预测](https://www.quantconnect.com/docs/v2/writing-algorithms/importing-data/streaming-data/precomputed-ml-predictions)、[Insight 生命周期](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/insight-manager)、[MQL5 WebRequest](https://www.mql5.com/en/docs/network/webrequest)。
