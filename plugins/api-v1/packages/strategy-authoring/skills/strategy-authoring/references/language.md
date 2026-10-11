# SVL/1 创作参考

适用于 `sesame/strategy-authoring` 1.2.0、语言 `svl/1`、源语义 schema `1.0.0` / `1.1.0` / `1.2.0`。1.2 的通用组合与冻结模块需要 Sesame 0.2.2 对应宿主 SDK；旧宿主明确拒绝而不降级。成果容器 schema 仍为 `1.0.0`。本文件及包内示例足以使用语言创作工具；无需读取 Sesame 本体源码或本地私有文档。这里记录当前 SDK 的可用子集，不把候选语法或目标平台能力当成已经实现的功能。

SVL 描述输入、判断、状态更新和交易**意图**。`strategy_validate` 做结构、引用、原语和预算检查；它不是完整静态类型推断器，不能证明每个动态值都合法。`strategy_replay` 执行固定输入，动态类型/单位、分支和错误须在这里验证。二者都不连接券商、不撮合、不编译原生代码、不下单。目标插件另行声明翻译、编译、回测和运行限制。

## 先读示例，再写源

通过 `plugin_read` 使用 `plugin_id:"sesame/strategy-authoring"` 和下列包内相对路径：

| 路径 | 用途与可核对预期 |
| --- | --- |
| `examples/close-threshold.svl.json` | 完整合法状态示例，参数阈值为 `"100"`；只记录收盘价和是否严格大于阈值，没有订单节点 |
| `examples/close-threshold.replay.json` | 教学窗口为空、99、101、100；状态依次为 `{lastClose:"0",lastAbove:false}`、`{"99",false}`、`{"101",true}`、`{"100",false}`；每次均无意图 |
| `examples/crossover.svl.json` | 完整合法 SMA 交叉入场语法；缺退出和保护逻辑，不能直接部署交易 |
| `examples/crossover.replay.json` | 教学 close 为 3、2、1、4，快慢周期 2/3；前一项均值 1.5/2，当前 2.5/7÷3；产生一份 100 share 买入意图 |
| `examples/function-threshold.svl.json` | 1.1 类型化纯函数，把阈值判断抽成可展开函数，仍只写状态 |
| `examples/function-threshold.replay.json` | 空窗口、99、101、100；与原阈值示例相同结果，同时可检查 functionId/callPath |

示例的 `demo/EXAMPLE`、价格、账户和参数都是教学值。真实品种须从行情/账户插件发现，保留其引用和实际量纲，不能把 `share` 静默换成 `lot`，或把 `last/regular` 静默换成 `bid/all`。

先把读到的完整示例复制到自己的实际工作区，如 `strategies/example.svl.json`，再按用户需求修改。最小调用顺序：

1. `strategy_validate({source_path:"strategies/example.svl.json"})`。
2. `strategy_publish({operation_id:"my-source-v1",source_path:"strategies/example.svl.json",title:"明确的策略标题",change_summary:"本次实际逻辑变更"})`，保存返回的完整 `ref`。
3. 把这个真实 `ref` 传给 `strategy_graph({source:ref})` 和 `strategy_replay({source:ref,fixture_path:"strategies/example.replay.json",output_path:"results/replay.json",operation_id:"my-replay-v1"})`。`ref` 是工具返回对象，不是自行填写的占位 ID。
4. 按手工预期检查每个事件的状态、意图、trace 与 `status`。失败后修源并发布新修订；不要修改已经冻结的引用。

## 源结构与固定语义

顶层必须是 JSON 对象，**不能是 Markdown、JSON 字符串或节点数组**。必需键为 `language`、`schemaVersion`、`strategyId`、`semantics`、`parameters`、`inputs`、`state`、`nodes`、`handlers`。可选 `functions` 在 `1.0.0` 只能为空，`1.1.0` 起支持下述纯函数；`extensions` 在 1.0/1.1 只能为空，1.2 可放冻结的声明式函数模块。省略时补为 `[]`。禁止其他顶层字段。

| 字段 | 实际形状 |
| --- | --- |
| `language` / `schemaVersion` | `"svl/1"` / `"1.0.0"`、`"1.1.0"` 或 `"1.2.0"`，显式选择语义版本 |
| `strategyId` | 非空稳定文本；修改逻辑通过新源修订表示 |
| `parameters` / `inputs` / `state` | 按 ID 命名的对象；没有条目也写 `{}`，不能写 `[]` |
| `nodes` / `handlers` | 有序数组；节点、事件与步骤格式见下文 |

`semantics` 必须完整逐字使用：

```json
{
  "numeric": { "precision": 34, "rounding": "half_even" },
  "missing": "not_ready",
  "onError": "pause",
  "eventOrdering": "input_sequence",
  "duplicateEvent": "ignore",
  "stateCommit": "per_event"
}
```

参数、输入、状态、节点 ID 区分大小写，格式为 `[A-Za-z][A-Za-z0-9_.-]{0,95}`，各有独立命名空间。handler 和 step ID 在整个源内共用唯一命名空间。纯节点依赖必须无环，所有引用必须存在。

源上限为 1 MiB，嵌套深度小于 64；不接受重复 JSON 键。JSON number 只用于安全整数，十进制使用匹配 `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$` 的字符串，如 `"0.01"`；不能写 `0.01`、`"1e-3"`、`"NaN"` 或带前导加号的值。语义摘要包含规范化后的整个源，键排序、数组顺序保留；省略和显式空 `functions/extensions` 等价。图布局和自由解释文本不放进源 AST。

## 参数和状态的类型

最常见的错误是混淆两处 `type`：

```json
{
  "parameters": {
    "threshold": { "type": "decimal", "default": "100", "min": "0" },
    "period": { "type": "integer", "default": 20, "min": 1, "max": 200 },
    "quantity": { "type": "quantity", "unit": "lot", "default": "0.01", "min": "0.01" }
  },
  "state": {
    "previousClose": { "type": { "kind": "decimal" }, "initial": "0" },
    "armed": { "type": { "kind": "boolean" }, "initial": false }
  }
}
```

这是字段片段，完整可执行源请读取包内 `.svl.json`。参数是 `{type:类型名,default?,min?,max?,unit?,currency?,choices?,shape?}`。没有 `default` 的参数必须在回放/运行时显式提供。复合类型和有长度限制的字符串用 `shape` 给出完整 `SvlType`，且 `shape.kind` 与 `type` 相同。状态是 `{type:SvlType,initial:值}`，`type` **始终是对象**。

| 类型 | `SvlType` 与合法值 |
| --- | --- |
| boolean | `{kind:"boolean"}`；值为 `true/false` |
| integer | `{kind:"integer"}`；安全整数；参数用 `min/max` 限定范围 |
| decimal | `{kind:"decimal"}`；Decimal 字符串 |
| duration | `{kind:"duration"}`；非负安全整数毫秒 |
| timestamp | `{kind:"timestamp"}`；下文 `SourceTime` |
| instrument | `{kind:"instrument"}`；`{sourceId:"固定数据源",instrumentId:"原生身份"}`，不是显示 symbol |
| account | `{kind:"account"}`；`{connectionId:"连接身份",accountId:"账户身份"}` |
| quantity | `{kind:"quantity",unit:"lot"}`；`{value:"0.01",unit:"lot"}` |
| money | `{kind:"money",currency:"USD"}`；`{value:"100",currency:"USD"}` |
| price | `{kind:"price",currency:"USD"}`；`{value:"1.1",currency:"USD",instrument:InstrumentRef}` |
| enum | `{kind:"enum",choices:["long","flat"]}`；值必须是其中一个字符串，choices 1..256 项 |
| string | `{kind:"string",maxLength:80}`；字符串长度不得超界，maxLength 为 0..20000 |
| record | `{kind:"record",fields:{armed:{kind:"boolean"}}}`；值必须有且只有声明字段，最多 256 字段 |
| array / series | `{kind:"array",element:{kind:"decimal"},maxItems:20}`；series 同样使用有界数组，maxItems 为 0..10000 |

例如字符串参数写 `{type:"string",shape:{kind:"string",maxLength:80},default:"demo"}`。数量和金额参数可用字符串默认/输入值，求值时展开为带 `unit/currency` 对象。价格必须提供完整的币种与品种对象。状态初始值不做这种字符串自动展开，quantity/money/price 状态须直接提供完整对象。类型嵌套深度小于 16。

`SourceTime` 只有两种形状：`{basis:"utc",unixMs:安全整数}` 或 `{basis:"wall",authority:"来源时钟",value:"2026-10-09T10:30:00"}`。后者保留无时区墙钟，可带秒的小数；未知券商时区不能直接添加 `Z`。可获知时间、交易所时间和记录时间不能互换。

静态可确定的状态赋值类型/单位冲突会在 validate 时拒绝；动态 record 字段仍需要回放检查。数学原语返回 Decimal 字符串或带单位数值，即使两个输入都是整数。若要递增计数，用 decimal 状态与 `"1"`；不要把 `math.add` 的字符串输出赋给 integer 状态。加/减/比较必须量纲一致；乘/除最多有一个带单位操作数，禁止自行推导 `price×lot→money`。显式换算需要目标支持的、可核对的输入与逻辑。

## 输入定义与表达式

输入定义只描述需求。参考求值器不会自动下载行情、维护历史窗口、拼账户分页或触发定时器；回放的每个事件提供当时可获知的窗口/快照。真实适配器必须保留数据身份、时间、完整性和缺值信息。

| `kind` | 声明字段 |
| --- | --- |
| `bars` | `instrument:Expr,timeframe:string,barPolicy:"forming"或"closed",priceBasis:"bid/ask/mid/last"之一,adjustment:"none/forward/backward"之一,session:string,lookback:1..10000` |
| `quotes` | `instrument:Expr,lookback:1..10000` |
| `accountSnapshot` | `binding:string`，目标账户绑定名 |
| `orderEvents` | `binding:string`，目标订单/成交回报绑定名 |
| `timer` | `intervalMs:正安全整数,clock:{basis:"trading"或"wall",alignment:SourceTime,missed:"skip"或"emit_once"}` |
| `external` | `schema:ArtifactRef,availabilityPolicy:ArtifactRef`；外部模型/数据边界，不能包含任意可执行代码 |

上表所有字段均必需；未声明字段被拒绝。instrument 为引用真实参数的 Expr，不能省略为默认品种；binding 是显式账户/订单绑定名。timer.clock 三个字段必须完整，external.schema 与 availabilityPolicy 都是固定 ArtifactRef。

`ArtifactRef` 为 `{id,revision,digest,kind,schemaVersion}`，前四个身份值不能用“最新”替代，digest 格式为 `sha256:` 加 64 位小写十六进制。品种、周期、价格口径、交易时段和 lookback 要满足目标 profile；SVL 结构通过不代表这些数据真的可获得。SMA 交叉通常至少需要最大周期 + 1 根连续已知柱。

节点为 `{id,op,inputs:{原语参数名:Expr}}`。只允许此参考表列出的 `op` 与参数名；缺参数/多参数都拒绝。表达式形式如下：

| 写法 | 含义 |
| --- | --- |
| `true`、安全整数、字符串、`null` | 字面量；null 表示缺值，不当成零 |
| `{literal:值}` | 固定数组/对象字面量，内容不会解析为引用 |
| `{parameter:"period"}` | 参数引用 |
| `{input:"bars",field:"close"}` | 输入或具名字段；对数组做逐项字段投影 |
| `{state:"previousClose"}` | 当前事件工作状态 |
| `{node:"fast"}` | 纯节点结果；不能把 state/intent 节点当纯表达式 |
| `{local:"position",field:"quantity"}` | 当前 forEach 局部项，只在其作用域内可用 |
| `{record:{price:{node:"latest"},ready:true}}` | 含动态引用的具名对象 |
| `[{node:"flat"},{node:"idle"}]` | 原语明确接受列表时的有序表达式数组，如 logic.all.values |

`field` 是以点分隔的字段路径，不能写 JavaScript、数组索引、`constructor/prototype/__proto__`。输入中缺少字段会产生求值错误；预期尚未就绪的字段应由适配器明确提供 `null` 或 `{status:"not_ready"}`，不能臆造默认值。`{status:"unknown"}`、`unsupported`、`not_applicable` 也按未就绪处理；`{status:"value",value:...}` 输入会展开。

## 当前全部原语

下表参数末尾 `?` 表示可选；实际 JSON 键不带问号。`1.0.0` 保持原有 32 个原语；最后六行从 `1.1.0` 起可用，共 42 个。后文再列 1.2 新增的 22 个。没有任意代码表达式、网络节点或动态扩展执行器。

| 原语 | 参数 | 结果与语义 |
| --- | --- | --- |
| `math.add`, `math.sub`, `math.mul`, `math.div` | left,right | 34 位十进制运算；half_even；除 0 报错 |
| `math.abs` | value | 同量纲绝对值 |
| `math.min`, `math.max` | values | 列表最值；空列表 not_ready |
| `math.quantize` | value,step,rounding | step>0；rounding 为 `floor/ceil/half_even` |
| `compare.gt`, `compare.gte`, `compare.lt`, `compare.lte`, `compare.eq` | left,right | 精确比较；eq 也支持同形状非数值值相等，不做隐式字符串/数值转换 |
| `logic.all`, `logic.any` | values | 按列表顺序短路；决定性 false/true 之前遇到 not_ready 就返回 not_ready |
| `logic.not` | value | boolean 取反；不是数值真假转换 |
| `series.value` | series,offset | offset 为非负整数，0 是当前可用末项；越界 not_ready |
| `series.sma`, `series.ema` | series,period | period 为 1..10000 整数；输出同长度数组；完整 period 的 SMA 作为 EMA 种子，alpha=2/(period+1)，缺值后重新预热 |
| `series.crossAbove`, `series.crossBelow` | left,right | 同长度、已对齐数组的最后两项；上穿是前项 ≤ 且当前 >，下穿是前项 ≥ 且当前 <；缺值 not_ready |
| `account.noPosition`, `account.hasPosition` | account,instrument,scope,side? | scope 明确为 `account/run`；完整快照中判断对应持仓 |
| `account.noWorkingOrder` | account,instrument,scope | 检查未结束原生订单和本地未决意图，不能只读持仓 |
| `account.positionQuantity` | account,instrument,scope,side | 返回匹配持仓数量之和；当前参考求值器无匹配时返回 not_ready，不臆造零及单位 |
| `record.get` | record,field | 读取已存在字段 |
| `array.length` | values | 有界数组长度，整数 |
| `array.at` | values,index | 以零起始的非负索引；越界 not_ready |
| `array.sum` | values | 同量纲求和；空数组返回标量 `"0"`，不能冒充带单位数量 |
| `state.set` | stateId,value | state 效果；stateId 是已声明状态的字符串字面量；value 必须匹配该状态类型 |
| `order.submit` | account,instrument,side,positionEffect,orderType,quantity,timeInForce,limitPrice?,stopPrice? | intent 效果；见下一节 |
| `order.cancel` | account,orderRef | intent 效果；orderRef 为 `{account:AccountRef,orderId:string}`，须属同账户 |
| `function.call` | functionId,arguments | 1.1：类型化纯函数；静态 functionId，形参通过 record 构造器传入 |
| `value.isReady` | value | 1.1：显式就绪判断，缺失为 false；不吞运行错误 |
| `value.select` | condition,whenTrue,whenFalse | 1.1：条件 boolean；仅求值选中分支，条件缺失则 not_ready |
| `series.window` | series,count,offset? | 1.1：从最新值往前取 count 项，offset 缺省 0；不足完整窗口 not_ready，保留原采样时间 |
| `series.add`, `series.sub`, `series.mul`, `series.div` | left,right | 1.1：逐项十进制运算，窗口长度和逐项时间必须对齐；无隐式广播或重排 |
| `time.compare`, `time.elapsed` | left,right / from,to | 1.1：compare 返回 -1/0/1；elapsed 返回非负 UTC 毫秒差；不推测墙钟时区 |

参考求值器检查 cross 的窗口身份、数组长度和逐样本时间。来自同一输入的纯教学窗口可以完全不含时间，但这不是市场时序证据；跨输入必须提供可比较且逐项对齐的完整时间。Bar 核对 openTime/endTime，Quote 核对 time；没有 bars.time。部分缺失、非法或冲突的时间不会退回按索引猜测。wall 的 authority/zone/fold 不得丢失或猜测，同长度不代表同时间。适配与测试仍须核对真实来源、闭合和可获知时间；这不认证完整防前视。

同一事件内通过 `state.set` 复制的值保留窗口证据，record 内的 series 也一样。进入下一事件或从持久检查点恢复时，历史值不自动具有当前窗口身份；不要把保存过的数组当成新的行情窗口。字段投影、SMA/EMA 与 1.1 的 series.window/逐项运算保留经检查的原采样位置，任意重排或自写数组不能获得这种证据。

`account` 原语要求完整输入形如 `{complete:true,account:AccountRef,positions:[],orders:[],pendingIntents:[]}`。不能把资金快照单独包成 `complete:true`：未读齐持仓/挂单/本地未决账本时保持不完整。匹配项带精确 `instrument`，按需带 `side/quantity`；scope=run 时要有可信 `runId`，缺归属返回 not_ready。

`orders` 只含尚未结束的订单，`pendingIntents` 含未发送、发送中和结果不明的意图；调用方不能把已完结历史记录当成此账本。固定回放不会替你把本次生成的意图写进下一个事件快照，必须明确提供下一事件当时的账本；真实目标还须实现持久 outbox 与重启核验。

## 1.1 纯函数与通用组合

先读 `examples/function-threshold.svl.json` 与 `examples/function-threshold.replay.json`。它把旧阈值示例的比较抽成一个函数，四个事件仍依次缺数、低于、高于、等于阈值；没有交易意图。不要仅改源版本便假定执行后端支持新原语。

```json
{
  "id": "aboveThreshold",
  "parameters": { "value": { "kind": "decimal" }, "threshold": { "kind": "decimal" } },
  "nodes": [{ "id": "test", "op": "compare.gt", "inputs": { "left": { "parameter": "value" }, "right": { "parameter": "threshold" } } }],
  "result": { "node": "test" },
  "output": { "kind": "boolean" }
}
```

调用节点为 `{"id":"above","op":"function.call","inputs":{"functionId":"aboveThreshold","arguments":{"record":{"value":{"node":"latest"},"threshold":{"parameter":"threshold"}}}}}`。函数内 parameter 只指形参，不捕获策略全局参数、输入、状态或账户；通过形参传入需要的数据。函数不含 state/intent 效果，不允许直接或间接递归。函数声明最多 64 个、每个最多 64 个形参、调用深度最多 16，总节点数与事件运算预算仍受限制。形参和输出运行时核对类型/单位，缺数传播；不能靠函数调用丢失时间证据。

1.1 的图包含函数体及调用位置，参考 trace 记录 functionId/callPath。图上的函数节点可展开说明其内部逻辑；这不等于原生目标已提供逐节点成交证据。

`series.window` 的 count 是 1..10000 整数、offset 是 0..10000 整数；offset=0 的窗口止于当前可用末项。禁止负 offset 读未来。两个 `series.window` 截出不同时间段时，即使长度相同也不能直接逐项相减；需要显式且有定义的对齐方法。序列算术可以组合已有指标（如同一窗口的两条 EMA 相减），不是自动添加完整指标库。

`time.compare` 只比较 UTC，或可证明属于同一 authority/zone/fold 的合法墙钟；跨钟拒绝。`time.elapsed` 只接受 UTC 且 to>=from，避免把夏令时墙钟差当实际时长。时间比较不会自行证明资料当时可获知，外部 Agent 输入仍须遵守 [可用时间规范](agent-inputs.md)。

## 1.2 的集合、数学与统计

1.2 增加 22 个原语，共 64 个。所有集合仍有界；`maxItems` 是节点中静态整数 0..10000，超界报错，不截断。集合函数的 `functionId` 是静态纯函数 ID；函数必须有 `item` 和 integer `index` 形参，reduce 还需 `accumulator`。额外参数通过可选 `arguments:{record:{...}}` 显式绑定，不能覆盖上述保留形参。调用图、类型检查、深度和事件预算与普通函数共用。索引从 0 起。

| 原语 | 参数 | 精确语义 |
| --- | --- | --- |
| `array.map` | values、functionId、maxItems、arguments? | 按输入顺序逐项调用；输出长度相同，单点 not_ready 保留。时间序列的采样位置不变 |
| `array.filter` | 同上 | callback 返回 boolean；保留 true 项的原有顺序与采样身份。任一谓词 not_ready，整个过滤结果 not_ready，不把未知当 false |
| `array.reduce` | 同上，另加 initial | 从显式种子按顺序折叠，返回类型必须匹配 accumulator。空集合也检查声明的 output 类型；未知累加结果停止并返回 not_ready |
| `array.sort` | 通用参数，另加 direction | 按 callback 的标量键稳定排序，direction 必填 asc/desc；同键按原索引排序。返回普通数组，故意丢弃市场采样身份 |
| `array.rank` | 通用参数，另加 direction、ties | 在输入原位置返回从 1 起的 Decimal 排名；ties 必填 ordinal/dense/competition/average。按全体输入计算排名，不能当作每个历史时点的滚动排名 |
| `math.sqrt`、`math.log` | value | 非负数平方根 / 正数自然对数；只接收明确无量纲标量 |
| `math.pow` | base、exponent | exponent 必须为 -1024..1024 的整数；0 的非正次幂拒绝。不隐式接受浮点指数 |
| `math.clamp` | value、min、max | 截到闭区间，min ≤ max；三者单位完全相同，保留单位 |
| `series.sum`、`series.min`、`series.max` | series、period | 长度不变的尾部完整滚动窗口；period 为 1..10000 整数；输出保留数值单位 |
| `series.variance`、`series.std` | series、period、ddof | 先对每项减去首样本，再计算这些差值的均值和中心平方差，除以 period−ddof；避免相同高精度样本求和舍入后出现伪波动。ddof 必填 0..period−1。std 保留输入单位；variance 只接受无量纲输入，不能偷偷把平方单位当原单位 |
| `series.quantile` | series、period、q | q 为 0..1 Decimal；升序后按 type-7 线性插值：h=(n−1)q，在 floor(h) 与下一项之间插值。保留单位 |
| `series.correlation` | left、right、period | 完全对齐窗口的 Pearson 相关系数，period ≥2；两边各以首样本中心化后计算，各自单位须一致，结果无量纲；常数窗分母为零时该点 not_ready |
| `series.returns` | series、periods、method | periods 为 1..10000 整数；simple = 当前/前值−1，log = ln(当前/前值)。零分母、log 非正价格或缺数时该点 not_ready，输出无量纲 |
| `series.shift` | series、periods | periods 为 0..10000 整数；向当前采样位置移入过去值，前端缺项填 not_ready，长度不变；负偏移拒绝 |

排序键允许 decimal、integer、quantity、price、money、string 或 enum。数值保留单位检查；字符串按确定的 JavaScript 字符序比较，不依赖本机语言排序。排名例如 `[3,1,2,2]` 升序时，dense=`[3,1,2,2]`，competition=`[4,1,2,2]`，average=`[4,1,2.5,2.5]`，ordinal=`[4,1,2,3]`，这里输出均为 Decimal 字符串。

滚动统计没有隐式 min_periods 或跳过缺数：预热不足或完整窗口内任何值未知，该点 not_ready，随后完整窗口可以恢复。SMA/EMA 后可接逐项计算和这些统计；参考 [Qlib 的时序表达式](https://qlib.readthedocs.io/en/latest/reference/api.html)，但口径以此表为准。新增非线性数学与统计锁定 [decimal.js](https://mikemcl.github.io/decimal.js/) 10.6.0 的独立 Decimal34、half_even 上下文，不使用二进制浮点计算收益或统计值，也不改变旧修订算术实现。单个输出最长 4096 字符，超限或非有限结果拒绝。

## 1.2 的显式时间对齐与会话查询

`series.align` 的参数为 `{series,to,mode,maxAgeMs}`， 将前者投影到后者的采样位置。mode 必填 `exact/asof`，maxAgeMs 是非负安全整数。输入及目标都须有每项真实 UTC 时间和 `availableAt`，事件也须有 UTC `availableAt`；缺证据报错。bars 使用 **endTime**，只接受声明 closed 的柱；形成中柱需后端提供明确快照适配，当前不能凭开盘时间假装已经闭合。

每边采样时间必须严格递增，availableAt 不能早于该点时间，但允许晚到与到达乱序。对每个目标点，只选择采样时间不晚于目标时间、且可获知时间不晚于目标 availableAt 的最新源点；exact 还要求采样时间相等，asof 允许回看，超过 maxAgeMs 返回 not_ready。目标 availableAt 晚于当前事件时也返回 not_ready。不会向前寻找样本或隐式无限填充。这里的 backward 匹配参考 [pandas.merge_asof](https://pandas.pydata.org/docs/reference/api/pandas.merge_asof.html)，并额外校验真实可获知时间。

1.2 对派生序列传播依赖的可获知时间：滚动值取整个依赖窗口的最大时间，EMA 同时保留前值递推依赖，逐项运算取两侧较晚时间，shift/returns 取当前采样与过去值的较晚时间。filter 的新索引还依赖前面的筛选结果，rank 依赖整个输入集合。callback 有额外绑定参数，或 value.select 使用非字面量条件时，不能证明历史逐点依赖的结果保守计为当前事件才可知。因此这些结果仍可用于当前判断，但不会在历史 as-of 中被提前释放。这些证据只在本事件内保留；源输入本身没有时间证据时不能凭计算自动补出来。一般求值的输入适配器仍负责提供当时可获知的数据；显式对齐不是对未记录的输入来源作真实性认证。

会话日历由插件作为显式输入或参数提供，宿主不下载市场日历、不猜节假日或夏令时。参考 [LEAN 市场时段的显式查询](https://www.quantconnect.com/docs/v2/writing-algorithms/securities/market-hours)，当前结构为：

```ts
type UtcSourceTime = { basis: "utc"; unixMs: number }; // 安全整数毫秒
type SessionCalendar = {
  coverage: { from: UtcSourceTime; to: UtcSourceTime }; // 半开覆盖区间
  sessions: { id: string; open: UtcSourceTime; close: UtcSourceTime }[];
};
```

最多 10000 个有唯一 ID 的会话，按 open 升序、不重叠，全部在 coverage 内；开市区间 `[open,close)`。午休可用两个会话表示。

| 原语 | 参数 | 结果 |
| --- | --- | --- |
| `calendar.isOpen` | calendar、time | 已覆盖日期为 boolean；覆盖范围外返回 not_ready，不能当作休市 |
| `calendar.session` | calendar、time | 返回当前完整 session；休市或未覆盖返回 not_ready |
| `calendar.nextOpen` | calendar、time | 返回严格晚于 time 的下次 open；覆盖外或覆盖内无后继会话时 not_ready |


1.2 在每次纯函数调用内缓存已经算出的内部纯节点，避免同一次调用反复运行同一统计或 reduce；参数固定且无副作用，原语不原地修改返回引用。缓存不跨调用、callback 项或事件复用，根节点也不缓存，所以 state.set 后再调用读取新参数。trace 只记录实际计算，重复引用已算值计一次读取预算。

集合 callback 也出现在 graph.calls；实际调用的 callPath 条目增加 index。模块函数用完整 functionId，内部 nodeId 只在函数体内唯一；source map 必须用 `(functionId ?? null, nodeId)` 标识。函数若直接返回形参或字面量，没有内部计算节点；集合调用节点仍记录实际结果。

排序比较、统计窗口、非线性数学、可获知时间传播、参数/返回类型遍历和 state/trace 复制共用每事件 100000 次预算，字符串另按每 64 UTF-8 字节计费。maxItems 是输入上限，不保证任意复杂组合都能耗用这么多项；超限回滚，不能部分执行。

## 1.2 的冻结函数模块

插件可分发普通 JSON 模块文件。Agent 将完整内容连同精确版本、摘要写进策略源；验证、图和回放只读取这份冻结副本，后续升级或卸载插件不会悄悄改变旧策略。没有任意代码执行器、远程入口或全局可变注册表。

```ts
type FunctionModuleBinding = {
  id: string;       // publisher/module，各段小写字母起首、字母/数字/连字符，1..64 字符
  version: string;  // 精确 x.y.z，无范围
  digest: Digest;   // 对 module 完整正文的 canonical SHA-256
  module: {
    schemaVersion: "1.0.0";
    language: "svl/1";
    languageVersion: "1.2.0";
    functions: PureFunction[];
  };
};
```

每源最多 16 个模块，每模块至少一个函数；模块函数与本地函数合计仍最多 64 个，节点/调用/类型预算共用。模块 ID 不可重复，即使版本不同；需要换版本时新建策略源修订。摘要不一致、未知字段、越域引用、递归或副作用均拒绝。模块可调用自己的其他函数，模块正文中写本地 functionId；加载冻结副本时统一限定为 `publisher/module/function`。模块不能隐式调用宿主全局函数、另一个模块或用户策略函数。策略本地函数可以显式调用完整限定名。

例如 `sesame/statistics` 模块中的 `zscore`，策略用 `function.call` 的 `functionId:"sesame/statistics/zscore"` 调用。`graph.functions` 展开相同的真实函数体，`graph.modules` 保留 `{id,version,digest,functions}`，trace 使用同一个限定 functionId。模块及其顺序、版本、摘要和正文全部计入 sourceDigest；可视化、回放和翻译固定同一源，不靠安装时的最新代码替换。

模块是声明式组合库，适合发布指标、因子、信号过滤或风险计算的可复用纯函数。带网络请求、模型推理、真实交易等效果仍由插件执行，再将有时间证据的结果作为输入；模块不能把这些效果藏在数学节点里。固定模块摘要也不代表原生后端已经证明等价，仍需该目标的 source map、限制声明和独立对照证据。


内置组合库使用 `strategy_functions({output_path:"strategies/quant-functions.json"})` 导出**完整 extension binding**，含 id/version/digest/module。将文件中的整个对象放入源的 `extensions` 数组，使用 `schemaVersion:"1.2.0"`，按函数完整限定名调用；不要只复制 `module` 字段或手填摘要。根据函数契约传入价格序列或高低收盘数据，可组合 RSI、ATR、MACD、Bollinger、Donchian、z-score、波动率；精确参数、初始化与缺数口径见 [量化函数库](quant-functions.md)。额外自定义模块由插件用公开 SDK `digest(module)` 固定后分发，或者在源内直接定义 PureFunction；不依赖私有宿主路径。

## 控制流与交易意图

handler 形状是 `{id,event:{type,input},steps:[]}`，input 是已声明输入 ID。事件类型仅 `tick/bar.updated/bar.closed/timer/order.updated/fill/external.input/recovery`。tick 对应 quotes；bar.updated/bar.closed 对应 bars；timer 对应 timer；order.updated/fill 对应 orderEvents；external.input 对应 external。recovery 目前只验证输入存在，目标须说明其恢复映射，不能冒称已具备通用恢复类型证明。匹配 type 和 input 的 handler 按源数组顺序执行；输入适配器负责正确区分形成中/已闭合柱，不能只改标签绕过。

step 有三种形状：

- `{id,actions:["state-or-intent-node"]}`：无条件按顺序执行动作。
- `{id,when:"boolean-node",actions:[...],elseActions?:[...]}`：when 是布尔纯节点的 ID 字符串，不是表达式对象；not_ready 时两边都不执行。
- `{id,forEach:{input:Expr,item:"localId",maxItems:1..1000},steps:[...]}`：按有限数组顺序迭代；超限报错而非截断。

同一步 actions 或 elseActions 内不得重复同一个 action 节点；不要用重复 ID 表达多份订单。actions/elseActions 只能引用 `state.set/order.submit/order.cancel`，不能直接放 math/compare 节点。一次状态写入后，后续根节点读取看见新工作状态；1.2 的函数内部缓存仅限该次无副作用调用，不能跨调用复用。无无限循环、递归或不受限函数调用。

`order.submit` 参数：account 是 **AccountRef**，不是整个账户快照；通常用 `{input:"account",field:"account"}`。instrument 是 InstrumentRef。side 为 `buy/sell`，positionEffect 为 `open/close/close_today/close_yesterday/auto`，orderType 为 `market/limit/stop/stop_limit`，timeInForce 为 `day/gtc/ioc/fok`。quantity 是大于零的 `{value:Decimal,unit:string}`。

- market 不带 limitPrice/stopPrice。
- limit 仅带 limitPrice；stop 仅带 stopPrice；stop_limit 两者都带。
- 价格使用 Decimal，数量/价格步长需显式量化，并按目标品种核验。
- 这里没有通用 broker submit、原生止损/止盈或追踪单字段；未支持的组合由目标拒绝，不偷偷补业务规则。

输出意图含 `kind:"submit"或"cancel"` 与确定性 `intentId`，由 run/event/执行位置/nodeId 派生。意图不代表已报单、已撤单或已成交；这些只能由目标的原生回报证据说明。重复事件不重发，结果不明请求也不能盲目补发。

## 固定输入回放格式和结果

fixture 文件顶层是 `{runId:string,parameters?:object,initialState?:object,events:Event[]}`。源通过工具的 `source` ArtifactRef 单独提供，**不要把 source 或 expected 包在 fixture 里指望工具读取**。initialState 如提供，必须包含全部且仅包含已声明状态，值符合类型；省略则使用源 initial。

每个事件是 `{eventId:string,sequence:"无符号整数",type:string,input:string,availableAt?:SourceTime,inputs:{输入ID:当时值}}`。顺序必须严格递增；完全相同 eventId/正文重复会忽略，同 ID 不同正文报 `EVENT_CONFLICT`。推荐 sequence 用字符串以保留大整数。样例 bars 按从旧到新排列，只含求值所需的 close；真实证据应保留固定原始数据/来源时间，不能把裁剪后的教学样例伪称观测。

当前限制：每份回放文件最多 4 MiB、10000 个事件；最多 1000 nodes、64 handlers、每段 steps 最多 1000 条；表达式数组/series 最多 10000 项；静态引用遍历与每事件动态解析各有 100000 次预算。预算不是性能或穷尽验证承诺。

每个事件先在状态副本上求值，产生拟发意图与 trace。全部动作成功才提交状态和意图。错误、动作 not_ready、除零、单位冲突或超预算使该事件 `paused`，原状态保留、该事件意图数组清空并终止后续回放。普通 when 未就绪仅跳过该分支。trace 可能包含回滚前已计算的拟发意图，**不能用 trace 中出现 order 节点证明事件已提交或真实成交**。

返回 `{sourceDigest,state,events,status}`；事件包含 `{eventId,status,state,intents,trace,error?}`，trace 行为实际求值的 `{nodeId,value,location}`。工具附 `validationScope:"fixed-input-svl-evaluation"` 和 `nativeEngineExecuted:false`。operation_id 如提供，把输入/输出保存为 resource artifact；它不是 `strategy.validation` 原生等价证明。

至少覆盖：预热不足、相等阈值、形成中更新、重复/冲突事件、pending/unknown 请求、缺账户归属、单位与舍入、状态读写顺序、动作失败回滚。编译成功不代表这些用例通过。原生 double 与 decimal34 容差需事前声明；分支或意图改变仍是失败，不能靠宽容差消除。

## 常见错误定位

| 错误 | 首先检查 |
| --- | --- |
| `value must be an object` | 顶层是否对象；parameters/inputs/state 是否误写数组；状态 type 是否误写字符串；节点 inputs 是否对象 |
| `Invalid SVL type` / `String type needs maxLength` | 状态 type 的 kind；复合参数 shape；string 的 maxLength |
| `SVL semantics cannot be changed` | 是否完整保留固定 semantics，不增加自定义策略字段 |
| `Unknown field` / `Missing ... input` | 节点/step 的准确键和原语参数表，不使用自然语言别名 |
| `Unresolved ... expression` | 引用命名空间、大小写、ID 是否存在；local 是否离开 forEach |
| `when must reference a boolean node` / `Actions must have state or intent effects` | when 用布尔纯节点 ID，actions 用状态/意图节点 ID |
| `Expected ...` / `Value units differ` | 回放参数/初始状态/动态值实际类型；Decimal 字符串不等于 integer |
| `Unsupported operator` / `UNSUPPORTED_CAPABILITY` | 是否用错源语义版本、使用目录外原语、在旧源中放非空 extensions，或目标不支持该语义；不要假装执行 |
| `Extension module digest differs` | 模块正文是否在冻结后被修改；重新计算规范摘要并发布新源，不能只改版本掩盖差异 |
| `Alignment requires...` / `Alignment times...` | 每项是否有真实 UTC 时间与 availableAt；bars 使用 endTime；形成中柱不能冒充已收盘数据 |
| `paused` / `Action is not ready` | 阅读该事件 error/trace，补足输入或修逻辑；不要忽略暂停继续发单 |

若这份参考未覆盖某种语言能力，先声明能力缺口或按现有原语明确组合。不要读私有宿主代码来发明接口，不要把图的解释文字当成可执行语义。完成源回放后再读取目标插件的 profile、翻译要求和 SDK 示例，分别保留真实编译、Tester、账户运行与报告证据。
