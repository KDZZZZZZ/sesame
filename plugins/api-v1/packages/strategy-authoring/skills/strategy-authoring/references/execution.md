# 订单程序与可重放执行账本

`lib/execution.js` 提供 `createExecutionProgram` 和 `replayExecution`。`strategy_workflow` 已直接调用它们，结果包含 `executionProgram`、`executionReplay.commands / trace / checkpoint`。命令是适配器可以消费的明确建议，本工具不发送订单，也不将软件状态当券商事实。

设计参考 [NautilusTrader 订单状态](https://nautilustrader.io/docs/latest/concepts/orders/)、[恢复核对](https://nautilustrader.io/docs/latest/concepts/execution/reconciliation/)及 [Backtrader Bracket](https://www.backtrader.com/docu/order-creation-execution/bracket/bracket/)。其中部分成交、待改单/撤单和最终成交之间的竞态不能简化为“调用成功/失败”。

## 编译固定风险结果

```js
createExecutionProgram({ decision, plan, snapshot, capabilities, config, asOf })
```

decision 和 plan 是基础 pipeline 的完整固定结果，摘要、账号/run、快照、时间和 profile 必须一致。`blocked`、未决请求、不完整账户或数值精度问题不会转成可提交程序。只有精确净头寸、已有硬数量授权，才进入计划。对冲账户、多策略共享持仓、精确 ticket/magic 分配仍由目标适配器提供真实证据和专门计划器；这里不能把相反持仓净成零。

`capabilities` 使用固定 `strategy.target` 和品种 `unit / step / minimum`。feature：`netPosition / marketOrder / limitOrder / stopOrder / stopLimitOrder / reduceOnly / modifyOrder / cancelOrder / ocoQuantityReduction`，每项声明 `native / software / unsupported`。软件实现必须同时列入 `config.allowSoftwareFeatures`，并提供真实 `emulationEvidence`；声明不等于代码已存在或通过原生验证。未实现的目标 requirement（例如任意 trailingStop）仍拒绝，不能仅凭 profile 声称 native 就偷偷绕过。

配置：

```js
{
  entries: [{ instrument, orderType: "limit", limitPrice: { value: "99", currency: "USD" }, timeInForce: "gtc" }],
  protection: [{ instrument, stopPrice: { value: "90", currency: "USD" }, takeProfitPrice: { value: "120", currency: "USD" }, timeInForce: "gtc" }],
  allowSoftwareFeatures: ["ocoQuantityReduction"], emulationEvidence,
  onProtectionFailure: "halt" // 或 flatten
}
```

全部可选；默认市场单，默认保护失败 halt。orderType 支持 market/limit/stop/stop_limit，后两者要 stopPrice，limit 和 stop_limit 要 limitPrice；有效方式 day/gtc/ioc/fok。每品种至多一条 entry/protection。普通策略不自动获得保护单，明确配置后才生成。

- 每笔数量不超过 maxOrderQuantity；超出拆为有界顺序片段，最多 1000 个订单定义，残余小于最小量时拒绝。
- 先完成组合所需减仓，才允许新增风险。反向换仓分为 reduce-only 平旧仓 → 实际零持仓确认 → 新方向开仓，不能把一个过量市价单假装成已证明安全的反转。
- 每个入场片段有自己的保护组。保护单按**实际累计成交量**激活，后续成交后改量；止盈部分成交同步缩减止损，保护头寸归零后撤掉兄弟单。
- 这是事件驱动的关联控制，`safety.atomic:false`。父成交和子单确认之间存在保护空窗；未确认/未匹配保护数量时停止新增风险。OCO 同时成交仍可能发生，真实违规回执会被记录并停止新增风险，不能删掉“不该发生”的成交。

程序保存确定的 client orderId、归属、数量授权、依赖、deadline、parent/OCO 关系。它不提供券商保证金、跨市场原子交易或 exactly-once 网络语义。

## 回放事件

```js
replayExecution({ program, events, checkpoint })
```

事件通用结构：

```js
{
  schemaVersion: "1.0.0", id, sequence, type, orderId,
  scope: { strategyId, runId, account, instrument },
  occurredAt, availableAt, payload, evidence: [fixedVenueEvidence]
}
```

sequence 严格递增，availableAt 不倒退，发生时间不得晚于可用时间。相同 ID/内容重放幂等，冲突 ID 拒绝；成交额外按 executionId 去重。发生错误时保留已核验事实，停在出错事件之前，返回 `paused` 和错误，不继续输出待发送命令。

| type | payload 与作用 |
| --- | --- |
| submitted | `{requestId}`：适配器已经把这次发送写入账本；消费对应 submit outbox |
| accepted | `{venueOrderId}`：保存真实券商身份；恢复期间单个确认不替代完整核对 |
| fill | `{executionId,quantity:{value,unit},price:{value,currency},commission?}`：实际增量成交；commission 可负，表示返佣 |
| modify_requested | `{requestId,quantity,limitPrice?,stopPrice?}`：修改总订单数量，不能少于已成交或超过原授权，须符合最小量/步长；价格单位不变 |
| modified / modify_rejected | `{requestId}` / `{requestId,reason}`：与待处理请求匹配；拒绝后重新核对，不假装改量成功 |
| cancel_requested | `{requestId}`：等待撤单时仍接收成交 |
| cancelled | `{requestId?,filledQuantity?}`：可保留已经发生的部分成交；给出的累计数量必须与真实执行明细一致 |
| cancel_rejected | `{requestId,reason}`：重新核对，不能当作订单已不存在 |
| rejected / expired | `{reason}`：保留已成交量；迟到成交仍按事实记账 |
| unknown | `{operation:"submit"\|"modify"\|"cancel",requestId,reason}`：必须对应已发请求；暂停新增风险，核对而不盲发重试 |
| reconciled | 见下方完整快照；缺明细或仅查不到未结订单不能证明失败 |
| position_confirmed | 不写 orderId；`{quantity}`：实际净持仓须与本运行账本相符；反转开新边之前必须有平仓成交后的零仓位确认 |

完整核对 payload：

```js
{
  status: "partially_filled", venueOrderId,
  quantity: { value: "10", unit: "share" },
  fills: [{ executionId, quantity, price, commission }],
  filledQuantity: "3", includesClosed: true, fillsComplete: true
}
```

status 支持 not_found/accepted/partially_filled/filled/cancelled/expired/rejected。必须同时查询未结与已结历史，并具有完整成交明细。`not_found` 或任何 completeness 不为 true 都继续 unknown；禁止据此重发新订单。重复明细只计一次；缺失/矛盾累计数使本事件无效。事实超额成交、reduce-only 违规或 OCO 过量平仓会保留实际数量并产生 breach，不能用“预期不可能”当理由丢数据。

## 恢复与命令消费

每次结果有 sealed `checkpoint`。它固定程序、账号/run、所有订单和成交去重、实际仓位、待决请求、outbox、风险违规和轨迹。恢复时所有活跃订单进入核对；旧 planned submit/modify/cancel 标为 uncertain，不作为新命令再次发出。held 的后续订单仍保留依赖。

commands 可能为 `submit / modify / cancel / reconcile / confirm_position / emergency_reduce`。必须按这些规则接入真实目标：

1. 适配器在本地可靠存储中原子领取 commandId，**先写发送状态和 requestId，再发网络请求**；回执再写事件。并发领取和进程崩溃由适配器的事务/outbox 处理，本插件的摘要不是分布式锁。
2. 每次只消费最新重放结果的命令；旧命令可能因新的父成交、风险判断或保护数量改变而被替代。不得缓存一次 submit 列表后无视后续事实全部执行。
3. 新撤回、风险 guard、账户切换、策略修订或模型 epoch 改变必须让旧程序失效并重评估；validUntil/deadline 是最长可用时间，不许可忽略期间新信息。
4. 新增风险命令再次检查实时账户、待决请求、价格、保证金、市场状态和硬规则；未知/恢复核对或不完整保护期间不给新增风险命令。已有真实订单到期后是否撤销，必须由目标的有效方式/期限控制实际执行并记录，不能只依赖本地阻止新提交。
5. `emergency_reduce` 仅表示保护失败后的明确请求，带 `requiresFreshAccountCheck:true`；必须核对当前真实持仓与其他保护单，不能直接按原数量重复平仓。

回放状态 `completed` 仅指本程序中全部订单已有终态，不意味着收益目标达成；`working` 可能正在等待外部回执或满足依赖，`needs_reconciliation` 必须先核对，`blocked` 表示计划前置条件不成立。工具不报告虚构账户余额或实盘挂载结果。
