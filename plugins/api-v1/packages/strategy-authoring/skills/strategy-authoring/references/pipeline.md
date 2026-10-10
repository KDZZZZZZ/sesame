# 信号 → 目标组合 → 风险调整 → 执行

这是 `sesame/strategy-authoring` 插件的工程规范和纯函数参考实现，协议版本为 `1.0.0`。它约束阶段之间传递的事实，不要求所有策略写成同一种模型，也不注册行情连接或交易接口。`lib/pipeline.js` 在给定的冻结输入上产生可检查的决策和计划；它不调用模型、不联网、不发送订单、不撮合。

设计借鉴 LEAN 的阶段分工：Alpha 表达判断，Portfolio Construction 决定目标持仓，Risk Management 调整目标，Execution 负责达到目标。LEAN 也保留经典和混合策略，尤其适合紧密关联入场、退出及特殊订单的策略。本规范同样允许事件状态机直接提供明确的目标和规则证据。[LEAN 框架](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/overview)、[混合策略](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/hybrid-algorithms)

## 1. 各阶段负责什么

| 阶段 | 输入与输出 | 不得替下一阶段猜测的内容 |
| --- | --- | --- |
| Signal | 已可获知的数据 → 有身份、有期限、可替代或撤回的判断 | 不把“看多”解释成买入全部资金 |
| PortfolioTarget | 信号、组合规则或经典状态机 → 多品种的有符号目标数量 | 不把权重当股数，不暗自换算手数、合约乘数、汇率 |
| RiskDecision | 目标、固定硬约束、可选 Agent 风险建议 → 收紧后的数量、禁止新增风险、清仓及重入限制 | 不允许 Agent 建议扩大硬阈值或改变批准的交易权限 |
| ExecutionPlan | 风险结果、完整账户视图、后端能力 → 需要核对的请求或确定的数量差计划 | 不把计划、编译成功或请求超时当成交 |

当前参考实现是**多品种目标集合和单品种数量限额检查器**。它不是组合优化器，没有总杠杆、跨币种净值、相关性、保证金、费用、购买力或账户总风险模型。这些计算由明确的组合/风险方法插件完成，保留其固定证据，再进入这条链；目标后端仍必须执行自己的交易前校验。

## 2. 所有阶段共有的约定

- 组合归属为 `scope: { strategyId, runId, account: { connectionId, accountId } }`；信号、风险建议和单项请求再加 `instrument: { sourceId, instrumentId }`。不同账号、连接或 run 的记录不混用。
- 数量为 `{ value: "10.5", unit: "share" }`，以正负表示净多/净空。数值使用最多 34 位有效数字的 Decimal 字符串；不接受二进制小数、缺值冒充零或 `share` 与 `lot` 自动替换。
- 比较用的时间都是 `{ basis: "utc", unixMs: 1700000000000 }`。来源墙钟应先由适配器根据已知时区和歧义规则映射并保留映射证据；这个模块拒绝猜测。
- 每个 `ref` 都是完整的 `ArtifactRef`：`id / revision / digest / kind / schemaVersion`。调用工具时还要读取这些固定引用并确认存在；摘要不能代替资料真实、来源可信或权限批准。
- `asOf` 由输入提供；纯推演不调用 `Date.now()`。数组、数值精度和字符串有边界，重复事件 ID 内容不同、单位冲突和未知字段直接报错。
- 每一层的 `digest` 只固定输入/输出对应关系，不是数字签名，也不是实盘授权。

## 3. Signal：判断的身份、时间和生命周期

`validateSignalEvent(event)` 检查一个不可变事件。`replaySignals(events, { asOf, scope, guards })` 按已经记录的**可获知顺序**还原 active / inactive 信号，返回固定历史和摘要。

| 字段 | 语义 |
| --- | --- |
| `id`、`sequence` | 不可变事件 ID；输入流内递增安全整数。完全相同的重复 ID 被忽略，内容冲突则拒绝 |
| `channel`、`revision` | 同一来源、归属和判断频道的递增修订；例如 `regime`、`entry`、`macro-risk` |
| `kind` | `signal` 或 `withdrawal` |
| `source` | `{ kind: "agent" \| "algorithm" \| "human", id, version, configurationDigest }` |
| `source.model` | Agent 来源额外记录 `{ provider, id, version, promptDigest }`。只写“当前最新模型”不够固定一次判断 |
| `occurredAt` | 判断所述事件发生的时间 |
| `generatedAt` | 判断实际产生的时间，不能早于它使用的数据 |
| `availableAt` | 策略真正可以收到这条判断的时间；回测按这个时间投递 |
| `dataCutoffAt`、`inputs` | 本次判断的数据截止时间；每个输入为 `{ ref, availableAt }`，必须当时已经可获知 |
| `expiresAt` | `signal` 的失效时间。模型返回时已经过期也可以记账，但不能用于新增风险 |
| `direction` | `long / short / flat`，只描述判断，不含订单量 |
| `confidence` | 可选的 `"0"` 到 `"1"`。不知道就省略；有值也不自动成为校准概率 |
| `supersedes` | 新修订明确引用 `{ id, revision }`；撤回还必须写 `reason` |

发生 ≤ 生成 ≤ 可用；每个输入的可用时间 ≤ 数据截止 ≤ 生成。未来数据不能因为写在同一个 JSON 文件里就提前进入决策。

新修订会终结同频道旧修订；新修订随后过期，不会让旧修订复活。迟到的低修订只留下 `late_revision`，不会推翻更高修订。撤回指向已存在的上一修订；如果输入历史不完整，必须补齐历史，不能猜它曾经存在。

**失效与清仓是两件事。** 失效仅使信号不再用于新的配置。是否到期退出、继续持有或等待退出规则，必须写进策略。生成一个零目标才表达主动退出。LEAN 的 Insight 同样把方向、幅度、置信度等判断信息与最终配置分开，本规范只采纳当前已定义的字段。[LEAN Alpha](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/alpha/key-concepts)

## 4. PortfolioTarget：明确目标，保留计算证据

`validatePortfolioTarget(target, signalState)` 接受：

```js
{
  schemaVersion: "1.0.0",
  id: "target-immutable-id",
  scope,
  createdAt: asOf,
  validUntil,
  strategySource, // kind 必须是 strategy.source
  evidence: [fixedAllocationEvidence],
  items: [{
    instrument,
    quantity: { value: "100", unit: "share" },
    purpose: "allocate", // 或 exit；exit 必须 quantity=0
    signalRefs: [{ id: "signal-id", revision: 1 }],
    requirements: []
  }]
}
```

这是字段示意，变量应替换成真实固定引用和已验证的归属，不是可直接发往券商的 JSON。

同一目标不能重复同一 InstrumentRef。`createdAt` 必须与信号视图 `asOf` 一致；新增配置引用的是仍有效的同品种信号，目标有效期也不能晚于该信号。`evidence` 保存从判断到数量的组合规则、价格/汇率和单位转换依据。参考实现不自行进行这些转换。

经典状态机可以使用 `signalRefs: []`，并提供：

```js
stateMachineEvidence: {
  ref: fixedRuleEvaluation,
  evaluatedAt, // 实际规则求值时间
  availableAt // 不晚于目标 createdAt
}
```

这样不必把均线突破、追踪退出等所有状态机硬拆成 Alpha。但固定规则证据不能成为绕过风险冷却、重入和归属校验的通道。图应展示实际规则和这些阶段的连接，不凭空画出“组合优化”模块。LEAN 的 PortfolioTarget 本身也表达持仓目标，不能等同于已经发送的订单。[LEAN Portfolio Construction](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/portfolio-construction/key-concepts)

## 5. RiskDecision：固定硬约束，Agent 只收紧

`assessRisk({ target, signals, policy, advice })` 要求每个目标品种都有明确硬限额。

硬策略包含 `id / scope / evidence / validFrom / validUntil / maxSignalAgeMs / maxDataAgeMs / cooldownMs`，以及 `limits`：

```js
{
  instrument,
  unit: "share",
  maxAbsPosition: "100",
  maxOrderQuantity: "20",
  allowShort: false,
  maxSnapshotAgeMs: 1000
}
```

**在实际后端中，硬策略必须由用户批准的配置或受信任的运行配置装载，不能取自模型临时生成的“已批准”声明。** 这个工具允许推演任意教学配置，因为它不会交易；读取一个真实 artifact 也不意味着该 artifact 获得执行授权。后端集成必须把权威硬配置与 Agent 建议分开，并校验其固定内容。

需要非技术风险判断的策略额外声明 `requiredRiskSources: [{ kind: "agent", id: "macro-risk", version: "1" }]`。每个目标品种必须有来自指定身份/版本、同一归属且当前可用、未失效、输入未陈旧的建议；缺失时停止新增风险，仍可减仓，不能当作“没有风险”。默认空数组适合纯技术策略，不强迫所有策略依赖模型。

风险建议也记录来源、模型/提示版本、数据截止、输入证据、可用时间和失效时间；只能选择：

- `allow`：本来源给出当前判断，没有附加限制。仍受全部硬规则和其他有效建议约束，不恢复已退休信号、不增加额度。
- `cap`：降低绝对数量上限。取建议与硬上限的更小值；更大的建议不会扩大硬约束，单位必须一致，负数拒绝。
- `halt`：停止新增风险。允许减小同方向持仓，禁止增加数量或反转方向。若现有持仓已超过硬数量上限或不允许空头，仍须减少违规敞口。
- `flatten`：把该品种目标设为零，同时产生持久重入限制。它不声称已经成交。

Agent 建议不能新增 `allowShort`、替换硬策略、提高账户权限或改变目标符号。未来建议不提前使用；已失效建议不用于新决策；使用陈旧输入的建议至少停止新增风险。每个品种的 `newRiskValidUntil` 受该品种的信号/输入年龄及当前建议期限限制，执行时再次检查；无关品种的建议不缩短它的窗口。越过这个时间只允许减仓，不会让陈旧 Alpha 阻止已明确要求的风险退出。原目标与硬策略的 `validUntil` 则限定整份决策的寿命；目标过期后需要重新决策。

### 清仓后的重入必须由新判断驱动

风险清仓或零上限输出 `guards`：记录该 instrument 的所有当前活跃信号、决策时刻和冷却截止。下一次推演必须原样带回这些持久记录。

1. 当前信号永久退出 active 集合，冷却结束也不会复活。
2. 清仓前已经生成、随后迟到的模型结果同样不能重新开仓。
3. 新判断必须在这次风险决策之后产生，并等到冷却结束。
4. 经典状态机也必须有清仓之后的新求值证据，不能重用旧规则结果。
5. `guards` 与未决执行账本一起恢复；丢弃它们再开一个“空白”会话不是恢复。

这里直接针对 LEAN 文档指出的重入问题：风险模块仅提交清仓目标而保留旧 Insight，组合模块可能再次建立仓位。我们用独立、可重放的 guard 记录这一限制，不在 Alpha 的原始事实中偷偷改值。[LEAN Insight Manager](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/insight-manager)

## 6. ExecutionPlan：可确认的数量差，不猜测执行结果

`planExecution({ decision, snapshot, capabilities, asOf })` 检查固定风险结果、真实账户观察和目标能力。

账户快照必须明确 `positions / workingOrders / pendingIntents` 三部分是否完整，保留 `observedAt / availableAt / evidence`。数量不能只看已成交持仓：任何有关品种的 `prepared / sent / accepted / partially_filled / cancel_pending / unknown` 记录都先进入 `needs_reconciliation`。发送后超时不能当失败归零，更不能换一个请求 ID 再发一次。

每个账户行都有自己的 `id / scope`；位置行额外有带单位的有符号 `quantity`，工作订单和未决请求行额外有真实 `status`。快照属于同账号，同品种若有其他 run/策略的持仓或请求，参考实现先核对归属。对冲账户的同时多空持仓不能直接相减变成零；它们需要后端的精确 position 引用与专用计划器。

能力描述包含一个完整的 **`strategy.target`** `profile` 引用、`features` 和每个品种的 `unit / step / minimum`。feature 支持状态只有 `native / software / unsupported`。参考实现仅在 `marketOrder`、`netPosition` 明确原生支持，且不需要保护关联、反向开仓或拆单时，计算净数量差。

| `status` | 当前可以确定什么 |
| --- | --- |
| `ready` | 所有项目都有完整事实，产生净数量差意图；仍未发送 |
| `noop` | 当前没有可执行数量差 |
| `blocked` | 决策或账户观察尚不可知、过期或陈旧 |
| `needs_reconciliation` | 视图不完整、归属未核清或存在未决/unknown 请求 |
| `requires_backend_planner` | 超过单笔限额、步长/最小数量不满足、需要反向拆解、保护/关联订单或软件执行能力 |

一个目标集合只要还有未解决项目，参考结果不对其他项目输出部分交易意图。这只是计划生成的完整性规则，**不是跨市场原子成交保证**。

目标向零方向量化到允许步长；不会为达到最小量而擅自增加风险。最终数量以精确整数余数检查步长，而不依赖 Decimal34 的再次舍入；极小步长或现有持仓导致的残余差不符合要求时，交回后端处理。OCO、Bracket、追踪止损、reduce-only、精确平仓、部分成交保护和撤单/成交竞态都由后端 planner/adapter 实现并测试。即使 profile 声称支持，这个参考函数也不冒充已实现这些能力，不会降级成裸单。

执行意图保存 `intentId / scope / side / quantity / purpose / deadline / signalRefs`；计划保存 strategy.source、target、risk decision、账户快照、目标 profile 的固定引用/摘要。`intentId` 根据固定输入生成，但原生适配器仍须持久保存发送前后的账本并按真实回执核对；这里没有实现跨进程 exactly-once 或原生交易幂等。

计划只知道这份冻结输入。决策之后若收到撤回、替代、风险退出或新 guard，消费方必须使旧决策失效并重新求值；`validUntil` 是最长寿命，不是可以忽略期间新事件的许可。

## 7. 工具输入与复现实验

`evaluatePipeline(fixture)` 是公开纯入口，`validatePipeline(fixture)` 返回同一次推演的检查摘要。fixture 形状：

```js
{
  schemaVersion: "1.0.0", asOf, executionAt, scope,
  events, guards, target, policy, advice, snapshot, capabilities
}
```

`executionAt` 可省略，默认 `asOf`；`guards / advice` 可省略为空，其余必需。输出包括 `signals / target / riskDecision / executionPlan`，始终标明 `validationScope: "fixed-input-pipeline-evaluation"` 和 `nativeEngineExecuted: false`。

工具 `strategy_pipeline` 负责读取 fixture、检查实际固定引用并按需保存 resource 证据。先用 `strategy_publish` 发布真正的源，再发布明确标注 demo 的资源和 `strategy.target` 教学 profile，然后把返回的引用传入 `examples/pipeline-fixture.js`：

```js
createPipelineFixture({ strategySource, targetProfile, strategyId, evidence, asOf })
```

factory 生成两个虚构品种的教学输入，不制造 artifact ID，也不宣称模拟时间是历史真实可用性。它的手算结果是 10 share 与 2 share 的目标数量差；测试把未知请求、延迟判断、风险否决等逐一加入，独立检查结果。

回归范围包含重复/冲突事件、迟到修订、预知数据、失效与撤回、跨账号/run/品种、单位冲突、缺失账本、unknown、部分成交、冷却重入、旧规则证据、硬风险收紧、步长和后端能力缺失。通过这些检查表示固定输入的参考逻辑一致，不等于原生回测成功、收益可靠或实盘已经挂载。

## 8. Agent 在回测与实盘中的位置

Agent 输出是外部输入事件；回测重放冻结的时间线，不在每次重跑时临时调用模型。实盘生成、数据截止、迟到结果、失败行为、模型版本和后台服务的边界见 [Agent 外部输入](agent-inputs.md)。如果研究阶段调用历史模型重建信号，必须明确这是重建实验，并处理训练信息泄漏；不能冒充当时实际收到的信号。

这条链可以让技术指标、Agent、因子模型等共用目标和风控，但本轮没有上线自动模型调度器、原生后端消费服务或翻译等价性证明。新增实际后端时，应先让它消费同一冻结 fixture，对照计划、回执、状态和成交轨迹，再单独证明故障恢复与实时交易语义。
