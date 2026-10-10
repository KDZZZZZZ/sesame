# 原生策略模块模板 · v2

这是可编译的空骨架，不含默认可执行策略。六个模块起始为 `unimplemented`；信号强度、候选手数为零，策略风险拒绝新增风险，`Configure()` 返回 false。没有默认突破规则、风险比例、止盈止损或参数搜索域。仅修改声明不能让原始骨架通过 EA 初始化。

## 修改范围

| 归属 | 文件 | 约束 |
| --- | --- | --- |
| 平台 | `Experts/Strategy.mq5` | 固定生命周期、对象组装、事件转发、取消、权益、成交、结果采集；save/compile 拒绝修改或额外 EA 入口 |
| Agent | `Include/Strategy/*.mqh` | 六个模块及辅助指标/上下文；可以替换原生基类的具体实现，保留以下接入接口 |
| Agent | `strategy.json` | 必须保留模板版本和六个模块，声明实现方式、说明与观测归属 |
| Agent | `observability/rules.json` | 自定义节点和状态机；保留 `platform.*` 节点，平台命名空间不可新增或改写 |
| Agent | `inputs/default.set`、`README.md` | 参数值、单位、假设、边界和验收依据；在模块头文件中声明 MQL `input` |
| 平台 | 注入的 `Include/Product/*`、冻结标准库、构建及账本 | 不接受工程文件覆盖；用户通过前端设置平台限额 |

## 模块与状态职责

| 模块 | 原生基类 / 接入接口 | Agent 决定的内容与边界 |
| --- | --- | --- |
| `Signal.mqh` | `CExpertSignal`；`Configure/Advance/ConsumeSignal`，原生方向、开平仓方法 | 机会状态、指标、方向强度、阈值、失效、去重；查询不推进状态，意图消费不代表成交 |
| `Money.mqh` | `CExpertMoney`；`Configure/CheckOpenLong/CheckOpenShort/CheckReverse` | 候选数量、预算基数、SL 单位、手数精度、额度不足处理；输出候选值，不改变账户事实或平台限额 |
| `Position.mqh` | 辅助对象；`Configure/Refresh/OnTransaction/Manage(position,trade)` | 持仓阶段、部分退出、加减仓记忆、待确认请求；从真实持仓和成交对账，使用传入的受管交易对象 |
| `Trailing.mqh` | `CExpertTrailing` 原生派生类；`Configure` 与原生保护方法 | 保本、跟踪保护；以实际修改结果更新保护状态；不需要时显式停用 |
| `Risk.mqh` | 策略辅助对象；`Configure/Refresh/OnTransaction/AllowNewRisk` | 时段、冷却、策略风险状态；新增风险准入与退出分开，不取代平台硬限额 |
| `Expert.mqh` | 保留 `CProductExpert` 继承；`Configure/Observe/OnTransaction` 及原生虚方法 | 调度扩展和模块编排；保留平台交易对象、策略新增风险准入，以及退出/保护持续处理 |

`Position.Manage()` 在原生持仓平仓检查处分派；返回 true 表示本轮已处理，false 继续原生平仓与 trailing。原生调度先尝试反转，所以更改持仓分支优先级时须同时覆盖 Expert 中相应方法并说明。加仓、挂单等扩展同样在 Expert 的实际原生分支中编排，不能假设所有模块每次都执行。

`OnTick`：取消检查 → 权益采样 → Risk/Position 观察 → Signal 推进 → 原生 Expert 分支 → 信号意图清理。`OnTimer/OnTrade` 持续刷新风险和持仓事实；原生 Timer/Trade 策略处理默认关闭，按需在 Expert 中显式启用。`OnTradeTransaction` 先采集平台事实，再调用策略 Risk/Position 的事务回调。初始化、取消、结果导出不由策略模块替换。

## 声明与实现

先读取 `strategy.json` 和各模块。每个模块选一个明确方案：

- `unimplemented`：草稿，允许保存和语法编译，不能进入受管回测。
- `custom`：自定义 MQL 实现；填写说明，至少登记一个真实可观测节点。
- `native`：明确选用某个原生行为并说明参数；适用于 Signal/Money/Position/Trailing/Expert。选用原生类仍需实现适配类及 `Configure()`，不会通过声明自动生成代码。
- `disabled`：仅 Trailing、策略 Risk 可用，必须写原因。停用 Risk 意味着显式实现 `AllowNewRisk() = true`，平台风控仍照常运行。

每个自定义规则节点、每个状态机必须通过 `node_ids` / `state_machine_ids` 归属一个模块。无状态算法使用空的 `state_machine_ids`；不要为了模板编造阶段。跨模块共享上下文放在额外的 `Include/Strategy/*.mqh`，保留清晰的写入方。

有状态模块在 README 中说明：状态及初始值、持久记忆、触发事件、守卫、动作、失效/重置、等待确认与重复事件处理。`rules.json` 声明真实状态、转移、条件和动作；MQL 通过 `ProductEmit` 记录对应实际求值和 `state_transition`。状态机 ID 用作状态转移的 node_id。使用可关联的机会/决策标识，记录订单/成交确认；不把发送成功或图中存在的边当作执行证据。当前交易详情仅能回放已关联到成交决策的 trace；完整跨 K 线机会链和实盘恢复尚未实现。

新增 input 必须说明单位并同步 SET。`CExpertSignal.StopLevel/TakeLevel` 使用原生调整点，五位外汇报价通常为 10 个报价 point。选择 `CMoneyFixedRisk` 时须核对当前标准库的 balance 基数与最小手数取整；平台按 equity 检查请求风险，不能假定两者相同。

保存后读取 `implementation`：`draft` 表示待实现，`declared` 仅表示声明完整。补齐模块代码、让 `Configure()` 验证参数，再冻结新 revision 编译。Tester 根据构建自身的冻结 revision 校验，不能用较新的工程声明授权旧构建。通过编译和声明检查不等于通过回测或策略有效。

## 平台边界

契约是文件归属与接入约束，不是 MQL 执行沙箱或代码/图等价证明。禁止自行构造交易对象或直接 `OrderSend` 绕过平台对象；平台 SDK 只读并不能证明任意 MQL 绝无绕过。现阶段仅支持受管 Tester，未实现实盘挂载、跨 EA 风险预留、未知成交恢复。不要用手写回测结果替代原生输出。已有研究工程、冻结构建和报告不会自动迁移或改写。
