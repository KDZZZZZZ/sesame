# 可执行的组合方法工作流

`strategy_workflow` 将动态选品种、信号分配、组合风控和订单状态机实际串起来。它生成数量、预算余量、限制理由、订单定义和待执行命令；不会连接券商、发送订单或调用模型。该工具与 `strategy_pipeline` 共用 `evaluatePipeline`，新增工作流版本 `1.1.0`，旧的 `1.0.0` 手工目标 fixture 保持可用。版本指的是工作流 JSON，并不是 SVL 源或 artifact 的版本。

选择规则、权重和风险参数属于插件方法。宿主无需知道“等权”“逆波动率”这些名称。经典事件状态机仍可直接使用 [pipeline](pipeline.md) 的手工目标入口，不需要虚构 Alpha 来满足框架。

## 调用与复现

```js
strategy_workflow({
  fixture_path: "strategies/allocation.workflow.json",
  output_path: "strategies/allocation.result.json",
  operation_id: "allocation-run-001"
})
```

JSON 顶层字段：

```js
{
  schemaVersion: "1.1.0", id, asOf, executionAt, scope, strategySource,
  events, guards, universe, portfolio, policy, portfolioRisk,
  advice, snapshot, capabilities,
  execution: { config, events, checkpoint }
}
```

这是字段示意。`scope / strategySource / events / guards / policy / advice / snapshot / capabilities` 使用 [pipeline 契约](pipeline.md)；`executionAt` 默认 `asOf`，`advice / guards` 默认空数组。`execution.config / events / checkpoint` 可省略。时间为 UTC 对象，Decimal 为字符串；所有 artifact 引用都必须真实存在，不能填写猜测的 ID。工具核对发布源的 strategyId、所有固定引用，并把输入和结果一起保存为 resource。

`examples/method-workflow.js` 导出 `createMethodWorkflow({ strategySource, targetProfile, strategyId, evidence, asOf? })`。调用方先发布源、demo 资源和教学 target，再传入它们的真实引用。工厂的两个品种、价格、汇率、账户和判断均为虚构教学数据，不可用于收益结论。手算：预算 USD 1000，A 每股 USD 100，B 每股 EUR 10、EUR/USD=2；等权产生 A 5 股、B 25 股，余额 0；置信度 0.25/0.75 产生 2/37 股、剩余 60；逆波动率 0.1/0.2 产生 6/16 股、剩余 80。

工作流输出 `signals / universe / construction / portfolioRisk / portfolioEnforcement / target / riskDecision / executionPlan / executionProgram / executionReplay`。每阶段保留输入依据与摘要；`nativeEngineExecuted:false` 不能被报告改写成原生回测成功。教学来源的输出继续带 demo provenance。

## 1. 动态品种池

`selectUniverse({asOf,candidates,filter?,rank,topN,previous,maxDataAgeMs})`：

```js
{
  candidates: [{
    instrument, fields: { liquidity: "1200000", region: "CN" },
    observedAt, availableAt, evidence: [fixedMarketSnapshot]
  }],
  filter: { all: [
    { field: "liquidity", type: "decimal", op: "gte", value: "1000000" },
    { field: "region", type: "string", op: "in", value: ["CN", "HK"] }
  ] },
  rank: [{ field: "liquidity", type: "decimal", order: "desc", missing: "exclude" }],
  topN: 10, previous: [previousInstrument], maxDataAgeMs: 60000
}
```

filter 是有界 `all / any / not` 树；叶子类型 `decimal / string / boolean`，运算 `eq / ne / gt / gte / lt / lte / in`。缺值不通过过滤，不转换为零。排名支持 decimal/string 多字段，缺失 `last` 或 `exclude`，相同名次按 InstrumentRef 稳定排序。结果包括 `selected / added / removed / unchanged / rejected`。未来和陈旧记录明确排除。候选上限 10000、选中上限 1000、排序字段上限 16、过滤深度小于 12。

品种池移除只表示不再选中，不自动卖出。持仓怎么处理由下面的显式政策决定。历史回测必须使用当时可获知的候选与成分，不能把今天的股票池用于所有历史日期。

## 2. 从信号计算实际组合

`constructPortfolio({id,scope,asOf,strategySource,signals,universe,snapshot,config})`，其中 `config` 对应工作流 `portfolio`：

```js
{
  method: "equal", // confidence 或 inverse_volatility
  budget: { value: "100000", currency: "USD" },
  budgetBasis: "cash", // 或 gross_notional
  reserveFraction: "0.02", feeRate: "0.001",
  signalAggregation: "consensus", // 或 latest
  inactiveSignalPolicy: "hold", removedInstrumentPolicy: "hold", // 或 flatten
  maxDataAgeMs: 1000, validUntil,
  evidence: [fixedAllocationPolicy],
  instruments: [{
    instrument, unit: "share", price: { value: "100", currency: "USD" },
    multiplier: "1", step: "1", minimum: "1", volatility: "0.2",
    groups: ["technology", "US"], valuation: "linear",
    observedAt, availableAt, evidence: [fixedValuation]
  }],
  fx: [{ from: "EUR", to: "USD", rate: "1.1", observedAt, availableAt, evidence: [fixedFx] }]
}
```

- `equal` 每个选中的方向判断得分 1；`confidence` 使用声明的置信度，没有值就拒绝，不能捏造概率；`inverse_volatility` 使用 1/波动率。波动率必须为正，并在证据中固定统计窗口和口径，同一组合的数值必须可比较。
- `latest` 选择该品种最新生成的频道判断；`consensus` 要求活跃频道方向一致，冲突时按无可用信号处理。零分不自动解释为清仓。
- `cash` 是本策略获准使用的**总资产预算**，包括要保留的持仓，适用于现金多头分配；它不是无条件读取账户可用现金或保证金购买力。`gross_notional` 是明确的绝对名义预算，可包含空头，不把卖空收入虚构成现金。最终硬约束仍决定是否允许空头。
- 数量按 `价格 × 合约乘数 × 显式汇率 × (1+费率)` 计算，扣除保留资金和保留持仓，使用精确整数分数向下量化。数量小于最小量不向上补足。费用是对目标名义价值的保守比例预留，不是券商实际佣金模型；报告称估算。
- 外币只能使用给定的直接兑换，单位不得猜测。当前支持明确的线性合约估值；反向合约、期权非线性估值、动态保证金、税费最低额需专门方法，不能套这个计算器。
- `inactiveSignalPolicy` 和 `removedInstrumentPolicy` 必填。`hold` 会预留既有敞口预算，产生 schema 1.1 的 `purpose:"hold"` 目标，执行时再读取当前数量；`flatten` 才产生退出目标。保留持仓已超预算时拒绝，要求明确新政策，不能默默为新信号卖掉旧持仓。

结果保留每项得分、权重、单位数量、价/汇率/乘数、费用估算与证据，以及 `heldNotional / estimatedFees / reserved / unallocatedBudget`；现金模式才提供 `estimatedRemainingCash`。快照需要完整且新鲜的持仓、工作订单和未决账本；目前只接受同账号/策略/run 的明确归属，不把对冲票据或其他策略持仓擅自合并。

目标有效期同时受所用价格、汇率和账户观察的 maxDataAgeMs 限制；组合风险还用净值的 maxEquityAgeMs 收紧有效期。执行推迟到这些输入过期之后时需要重新构建，不会只因信号尚未到期就继续使用过时估值。

## 3. 组合风险

`constrainPortfolio({construction,market,config})` 的 `config` 对应 `portfolioRisk`：

```js
{
  policyRef: fixedAuthorizedPolicy,
  equity: {
    currency: "USD", historyStart, complete: true,
    observations: [{ id, value: "100000", observedAt, availableAt, evidence: [fixedEquity] }]
  },
  maxEquityAgeMs: 1000,
  maxDrawdown: "0.2", maxGrossExposure: "1", maxAbsNetExposure: "0.5",
  groupLimits: [{ group: "technology", maxGrossExposure: "0.3" }]
}
```

总敞口是所有目标基准币种名义价值绝对值之和；净敞口是其带符号之和；阈值均为当前净值的倍数。分组可重叠，每个组独立受限，同一品种的重复组不会重复计算。方法用共同系数收紧组合、按步长取整，再重新计算全部硬限额。若对冲腿取整反而破坏净敞口上限，保守输出零目标并记录原因，不能用数值容差冒充符合硬阈值。

回撤使用声明区间内、当时可用的完整净值序列和历史高水位。净值为零或正回撤达到阈值时输出风险退出；当前净值陈旧/缺失则拒绝。外部生产者必须保证 `complete` 的真实含义和起点，布尔声明本身不是证据。未来高点不进入历史风险判断。

输出包括限制前后总/净/分组敞口、净值/高水位/回撤、比例、原因和 algorithm 风险建议。随后进入基础 `assessRisk`，与用户硬数量限额及 Agent 建议一起取更严格的约束。风险退出生成持久 guard，防止同一旧信号立刻重新入场。`policyRef` 必须来自实际后端认可的硬配置；模型自己写的 artifact 不因此获得交易权限。

单品种 cap/halt 可能缩掉对冲的一条腿，因此不能只在分配之前检查组合风险。`portfolioEnforcement` 会再次核对最终计划数量；若净/总/分组限额被后续规则破坏，保守输出组合退出并记录原违规和最终核验，生成相应 guard，而不是偷偷放宽净敞口。执行视图不完整时该复核标为 not_evaluated，整个程序仍先核对账户。hold 目标遇到风险 flatten 同样退出，不会因“保留旧仓”忽略风控。

## 4. 执行与 Agent 时间线

详见 [执行状态机](execution.md)。先完成所需减仓，再允许新增风险；净反向换仓必须先成交平仓并取得实际零持仓确认。组合方法保证冻结价格下的目标上限，不能保证跨市场成交原子性、成交价格不变或保证金足够；适配器要逐请求重新核对实时账户和风险，必要时废弃旧程序重新评估。

Agent 可先通过 `strategy_decision` 生成并保存判断，取得固定时间线后，把 `timeline.signals` 放入 `events`、`timeline.advice` 放入 `advice`、`timeline.guards` 放入 `guards`。下一轮还要合并前轮 `riskDecision.guards`，不能清空重入记录。未来时间或另一账号/run 的判断不会获得使用资格。实时服务、取消/过期、回测重建的限制见 [Agent 输入](agent-inputs.md)。

## 设计参考

方法分工取自 [LEAN 框架](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/overview)，等权及其他构建方式参考 [LEAN Portfolio Construction](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/portfolio-construction/supported-models)，持久信号与退出重入参考 [LEAN Insight Manager](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/insight-manager)。本插件实现的是这里明确定义并测试的方法，不宣称与 LEAN 的所有模型、费用模型或原生执行相等。
