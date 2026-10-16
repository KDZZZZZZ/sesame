---
name: personal-trading-memory
description: 记住个人交易风格、风险红线和策略认知；实盘前或调整规则时，用真实账户与合约数据计算风险并取得用户确认。
---

# 个人交易记忆

目标是让交易决策尊重用户确认的风险边界，持续积累可检验的策略认识，并适合用户的执行习惯。使用现有记忆和后端能力，不创建第二套交易账本。用户在一次亏损或盈利后的情绪不自动变成长期偏好。

## 三类信息

| 分类 | 保存内容 | 使用方式 |
| --- | --- | --- |
| `trading/style` | 喜好的市场、周期、交易时段、算法/手动、研究方式、激进/保守等；哪些是用户明确表达、哪些只是推断 | 选择研究方向与表达方式。激进不代表无限杠杆，偏好不授予交易权限或风险预算；推断先提候选。 |
| `trading/risk-rules` | 用户确认必须遵守的损失预算、暴露限制、止盈止损与其他退出条件、触发暂停/恢复的条件；明确适用账户和时区 | 约束新增风险。保存原值、新值、计算理由、用户确认和适用边界。未获确认只是草案；已有规则不能被策略或收益预期覆盖。 |
| `trading/strategy-knowledge` | 用户对市场机制、策略算法、指标与参数的理解，适用市场状态、证据、反证、失效条件、尚待验证的问题 | 提供有条件的研究假设与方法。用户观点按“用户认为”记录；回测结论限定数据、样本外区间、成本及版本，不能等同于未来获利。 |

所有条目复用 `title/summary/content/scope/sources/evidence` 与现有版本；`content` 可用 Markdown。scope 仍为 global/project/strategy，正文明确后端、账户、市场、币种与周期，不把一个账户规则默认为另一个账户的规则。适用边界不清时向主 Agent 说明实际缺项。

## 执行原则

- 增加实盘风险前，完整读取适用红线和当前账户事实。没有适用规则时，主 Agent 给出有计算依据的方案，引导用户确认损失预算、组合敞口及退出/暂停条件。按任务实际需要补齐缺项，不机械索取每一个可选偏好。
- 设定或调整阈值的成果应让用户看到：拟定规则、原规则差异、预计损失金额及权益占比、保证金/资金占用、对已有仓位和挂单的影响、压力情景与不能量化的部分。阈值来自用户目标与核算，不使用统一的默认风险百分比。
- 风险红线优先于风格和策略。看多、偏激进、近期盈利或回测表现不能构成自动放宽理由；更宽或更严的修订都须本次明确确认。复核日期到期不自动释放原风险额度。
- 若当前数据、规则或必要执行能力不足，暂停增加风险，说明影响和可恢复条件。不得把无法核算说成“风险可控”，也不应仅因缺少新规则阻止既有授权内的减仓/平仓；仍核对仓位、数量、可卖限制和结果，避免反向开仓。
- 策略候选、假设退出与模拟计算不等于订单。规则已保存、止损已挂、触发已发生、成交已核验是不同事实，只有相应工具回执才能支持后者。

## 可用记忆能力与完整调用形状

`memory_trading_context({limit:10})` 返回 `risk_rules` 完整正文及来源、`style`/`strategy_knowledge` 摘要、`totals`、`risk_state`、`complete`、`unread_risk_rule_ids`、`pending_risk_candidates`。风险跨 scope 返回且不受 limit 影响；另两类各返回 limit 条。`missing` 是没有正式规则；`needs_review` 包括冲突、待复核、未确认或正文预算不足；`documented` 只是已登记，不是授权或风险计算通过。

整份交易上下文按 32000 UTF8 字节与1800行控制预算。`complete:false` 的规则按 `unread_risk_rule_ids` 调 `memory_read({id,offset:0,length:4000})`，后续 offset 使用返回的 next_offset，直到其为 null；逐段核对 version 一致，变化时重读。若 `next_risk_offset` 非 null，则再调 `memory_trading_context({risk_offset:next_risk_offset})` 取得剩余规则元数据；规则按稳定 ID 排列，分页期间发生变更须重新核对。不要将任意单页当完整政策。其他摘要正文也用 `memory_read`；需要更多观点时按对应 category 用 `memory_search`。所有来源和条件随记忆返回，读取不刷新采用日期。宿主如返回 `_tool_output_truncated`，该结果只是预览，必须分段重读；分页 `content_complete` 表示单次响应是否含整个正文，完整性须结合 next_offset 和各段 version 核对。

正式风险规则的最小保存形状如下。示例 ID、正文和阈值必须替换为实际内容；`confirmation_source` 与 sources 中的同一真实用户消息可重复引用，无需创造第二份证据。

```js
memory_manage({
  action: "save",
  confirmation_source: { type: "user_message", id: "本次明确确认的真实消息ID" },
  entry: {
    category: "trading/risk-rules",
    title: "指定账户的风险边界",
    summary: "明确账户范围、关键损失阈值与触发后的动作",
    content: "Markdown：适用范围、已确认阈值、触发动作、计算依据、复核条件",
    scope: { kind: "global" },
    evidence: "explicit",
    sources: [{ type: "user_message", id: "本次明确确认的真实消息ID" }]
  }
})
```

已有规则修订使用同一个 ID：顶层增加 `id` 和 `expected_version`，`entry` 提供新正文等补丁，`confirmation_source` 换为这次确实同意调整的真实消息。代码不能判断一句真实消息是否同意具体风险阈值，Agent 必须核对原意，不把咨询、犹豫或助手建议当成确认。未确认时调用 `memory_propose` 保存相同基本条目的草案。

主 Agent 接纳候选：`memory_manage({action:"accept",id:candidate.id,expected_version:candidate.version,confirmation_source:真实确认,entry:{evidence:"explicit"}})`；仅有研究证据不能接纳为规则。返回 `memory.id` 才是正式 ID。归档/恢复/遗忘使用 `{action:"archive"或"restore"或"forget",id,expected_version,confirmation_source:本次真实确认}`。普通风格和策略记忆不需要这个额外参数。

正式风险规则保存时固定，不允许 `expires_at`；需要定期评估使用 `review_at`。自动压缩只提风险候选，不自动接受或改写。搜索、读取、采用归档条目不会重新激活已撤销红线。遗忘删除记忆并不关闭仓位，也不能声称原对话和外部报告已删除。

## 风险核算依据

使用当前实际账户、报价、合约规格与既有持仓/挂单，记录数据时间和固定证据。历史样本仅用于解释设定理由，不能当作当前余额。以下是核算原则，不是统一的买卖步骤或预设参数。

| 需要回答的问题 | 核算依据 |
| --- | --- |
| 这笔交易可承担多少计划损失 | 用户确认的固定金额，或指定权益基数 × 确认的比例；同时受剩余单日/组合预算约束。权益基数、时区、已实现/浮动损益、出入金与重置条件必须说清楚，避免靠换日或出入金掩盖回撤。 |
| 止损处的计划损失是多少 | 优先使用后端按账户币种计算的入场至止损 P&L，加另行估计的费用和滑点。对线性合约可用 `abs(入场价−止损价)/tick_size × tick_value × 数量`，但 tick_value 必须对应同数量单位和账户币种；期权、反向合约或转换不明时不可套用。止损方向不合理或数据陈旧时先纠正依据。 |
| 数量如何落到可交易单位 | 计划预算除以单位损失与成本，用后端实际最小量、步长、交易手数/股数换算后向下约束，再对最终数量重新核算。非线性手续费不能简单按单位缩放；最小量已超预算时不新增该风险。 |
| 是否还有足够保证金/资金 | 保证金、名义敞口与止损预计亏损分别列出。读取现有仓位/订单、可用资金、杠杆和交易校验，不能把低保证金当低风险，也不能把保证金计算当作全部订单已通过。 |
| 组合是否超限 | 含已有仓位与挂单，核对同一风险因子、集中度及可能同时触发的退出；净头寸为零不自动等于无风险。简单相加只是指定情景的估计，不冒称 VaR 或真实最坏亏损。 |
| 何时退出与止盈 | 区分策略失效、止损、止盈、追踪退出、最长持有期与账户暂停；按用户确认的规则量化触发条件。收益风险比只比较条件性盈亏，未包含胜率，不能单凭它证明正期望。 |

例如用户已经确认计划损失预算为 600 单位账户币种，真实合约计算每单位止损损失加成本为 140、数量步长为 1，则最多 4 单位的计划止损损失约为 560；还需满足保证金、组合额度及数量限制。这只是计算示例，不替用户设定预算。

跳空、流动性与滑点会使实际止损亏损超过估计；止损限价单则可能无法成交。报告分别给出计划止损情景与有依据的压力情景，不把任何一项写成保证最大亏损。[Investor.gov 的订单风险说明](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-15)说明了这些执行差异；[CME 的仓位核算课程](https://www.cmegroup.com/education/courses/trade-and-risk-management/proper-position-size)说明止损距离与资金预算共同决定数量，课程示例比例不作为 Sesame 的默认参数。

## 复用现有后端能力

使用当前已声明且获得授权的能力，缺少能力就明确报告给主 Agent，不尝试未知别名或改用记忆中的过期余额。下表列出确定入口；实际连接、账户与参数以对应能力回执为准。

| 能力 | 用途与限制 |
| --- | --- |
| `sesame/portfolio-execution#portfolio_execution_context({binding_id,action:"snapshot"})` | 已绑定账户的仓位、挂单、成交与覆盖范围；绑定来自已有计划或配置回执，不猜测 binding_id。 |
| `sesame/portfolio-execution#manual_trade_observe({backend,symbol})` | 返回具体账户、当前报价、仓位、规格、观测时点和有效期，方便核算标的；读取不能代替下单授权。 |
| `sesame/mt5#mt5_catalog({server:"python",query:"order_calc_profit"})` 与已声明 `mt5_python` | 目录给出精确调用形状，按它调用 `order_calc_profit({action,symbol,volume,price_open,price_close})`、`order_calc_margin({action,symbol,volume,price})`、`order_check({request})`。这是选择已知只读方法，不探索未知下单入口。保留失败和 last_error，不把 None 当 0。 |
| `sesame/qmt#qmt_read` | 已声明的 asset、positions、orders、fills、quotes 等读取；历史覆盖依实际回执，不能把当日成交当完整历史。不存在通用 MT5 保证金/P&L 等价方法时，使用可验证的线性合约数据计算并标明局限，不能虚构接口。 |
| `sesame/abu-position-sizing#abu_position_sizing_analyze` | 使用已验证 input 与数量单位/点值进行仓位方案比较。Kelly 的输入概率是假设；资金/价格点输出不是券商手数，不能省略换算。 |
| `sesame/abu-exit-rules#abu_exit_rules_analyze`、`sesame/abu-trade-metrics#abu_trade_metrics_analyze` | 比较 ATR 退出、持有期或核对有成本的权益/回撤证据。它们生成观察与固定成果引用，不平仓、不自动证明策略有效；OHLC 无法确定盘中先后。 |

[MT5 order_calc_profit 官方文档](https://www.mql5.com/en/docs/python_metatrader5/mt5ordercalcprofit_py)明确输出账户币种下的估算；费用、滑点与数据时点另外核对。[order_calc_margin 文档](https://www.mql5.com/en/docs/python_metatrader5/mt5ordercalcmargin_py)说明该调用不计现有持仓和挂单，故需账户事实与订单校验一起使用。

当前 QMT 手工执行不支持附加止盈止损；manual-trading 的目标仓位执行也不会自动把记忆正文转换为保护单。若用户红线要求保护单，而所选通道无法落实，明确暂停依赖该保护的新增风险；不能以“后续监控”默默替换确认的条件。用户另行确认监控/人工退出方案时，需解释它的断连、延迟和无法保证成交等风险。MT5 的测试风险配置只作用于测试，不是实盘规则开关。

## 简短正文模板

风险规则可把同一账户的一组边界写在一条记忆中，避免把相互依赖条件拆散；只填写实际适用内容。

```markdown
### 适用范围
后端/账户、市场、币种、计算基数、时区、适用周期。
### 用户确认的红线
阈值、单位、触发条件、执行动作、暂停与恢复条件。
### 计算依据
数据时点与来源；权益/合约/成本假设；计划止损、保证金、组合影响和压力情景；无法量化的部分。
### 本次调整
原值 → 新值，原因、风险差异、本次确认来源；复核时间或条件。
```

风格条目记录“偏好—适用情境—来源—不确定性”；策略认知记录“理解/假设—机制—适用条件—参数含义—支持与反对证据—失效条件—下一步可检验问题”。优先保存哪些条件有效或失败及其原因，逐笔流水留在原账本并引用。重要成果可以沉淀为策略认知，但不会自动修改风险红线。
