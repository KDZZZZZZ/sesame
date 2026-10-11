# Kurumi Replay — 正式 Nautilus QuoteTick 适配、规则与验证

## 当前正式路径与宿主 API

正式模拟器是 **NautilusTrader 1.231.0**，不是手写 H1 极值撮合。`engine.js` 和 `native-engine.js` 的默认同名生产导出一致：

```js
createRun(runId, chapters, dataDigests)       // 同步：建立 native 规则状态
validateDecision(state, decision)            // 同步：严格校验与幂等
snapshot(state, currentFrame)                // 同步：只汇总已揭示信息
await decideAndAdvance(state, decision, frames, options) // 直接 QuoteTick 原生入口
await prepareNative(storageDirectory, {signal})
await nativeStatus(storageDirectory, {signal})
await advanceNative(storageDirectory, state, decision, data, {signal})
```

service 可继续从 `engine.js` 导入 createRun/snapshot；它们已是 native 导出，不会建立 reference 状态再送到 native 而产生 ENGINE_MISMATCH。默认 decideAndAdvance 现在是 async；生产 service 推荐 await advanceNative，随后以原有 run/version/requestId 原子 CAS。适配器**不提交任何 run store，也不改变 service 的 CAS**。候选结果未通过 CAS 不得揭示或计入挑战资金。

同步纯函数参考实现仍在 engine.js，显式名称为 `createReferenceRun / validateReferenceDecision / decideReferenceAndAdvance / snapshotReference`；规则 engine=`reference-h1-only`, formalExecution=false。参考推进拒绝 native 状态，不能把参考成交冒充正式成交。

## 固定假设，不向目标调参

| 章 | leverage | stopout | 性质 |
|---|---:|---:|---|
| 1 | 500 | 0.2 | 用户指定附件挑战假设；开发没有读取原附件 |
| 2 | 25 | 0.5 | 用户明确挑战设置 |
| 3 | 25 | 0.3 | 用户明确挑战设置 |

初始余额 300000 JPY。每侧费用 3 JPY/1000 基础单位；模拟融资每 UTC 跨日 10 JPY/1000，long/short 均收。融资只发生于**已消费的真实报价时间之间**，不推进到虚构的 H1 末端收取未来费用，也不是历史券商 swap。每章最后一条实际消费报价执行强制 flat；余额连续进入下一章，空仓跳过月份不计收益或费用。最终第三章 flat 余额 >= 20000000 JPY 才判胜，展示目标倍数 66.6666667；中途未实现盈亏不判胜。

state.rules.engine=`nautilus-trader`，engineVersion=`1.231.0`，model=`native-quote-tick-v1`；chapterRules 保存上述固定 profiles；全局 leverage/stopout 为 null，避免将第一章错读为旧的 25x。snapshot 输出当前章实际 leverage/stopout。

## 原生能力与适配层边界

真实调用公开 API：`BacktestEngine / BacktestEngineConfig / CurrencyPair / QuoteTick / Strategy / OrderFactory.market / OrderFactory.stop_market / TriggerType.BID_ASK / FillModel / FeeModel / MarginAccount.set_leverage`。市场单、BID_ASK 止损触发与原生 OrderFilled 由 Nautilus 撮合器产生。FillModel(prob_slippage=0.0)：买 ask、卖 bid，不额外固定扣一个 tick，不重复扣点差。bar_execution=false、trade_execution=false，H1 仅观看/决策节奏。未提供 M1 支持，M1 OHLC/H1 均被明确拒绝，绝不展开成假 tick。

Nautilus venue 为 NETTING/MARGIN/JPY，并设置分章杠杆。**native account frozen，native risk bypass**：原生账户不是权威资金账本。适配层以 Decimal/FIFO 批次账本负责精确 JPY 结算、方向性 CHFJPY 换汇、挑战保证金准入、stopout 与模拟融资。Nautilus 自身标准账户净值、维护保证金或换汇结果没有被冒称为这些挑战规则。receipt.nativeFrozenBalanceJpy 来自实际原生账户查询：已验证它保持300000，而挑战资金可为294000、仓位margin800080仍按挑战equity获准原生成交；静态 native cash 不会偷偷否决权威账本的合法准入。逐行检查：

`balanceAfter = previousBalance + realizedJpy - commission - financing`

开盘使用下一消费区间的**第一条实际 quote**；若该小时首 quote 晚于整点，保留实际时间，不伪称整点可成交。旧原生 stop/risk 先于新的目标调整；同一步旧仓强平/止损后 risk_blocked，不自动重开。每个后续实际 quote 重新检查挑战 stopout；负余额保留，不充值、不归零。余额 <=0 立即清仓并终止原生区间，未消费后缀不进入终止 journal；后续模型收费推进应由 service 看到 outcome=bankrupt 后停止。

数量为规范带符号整数字符串、1000 倍数、绝对值 <=10000000。适配器不支持非整数 partial fill。报价与金融值为 Decimal 字符串；输入上限 30 位有效数字 / 18 位小数，还必须满足 Nautilus 品种真实 tick 精度，unsupported precision 明确拒绝。stop 必须是实际 tick 的精确倍数，UNSUPPORTED_STOP_PRECISION 在撮合前拒绝，不允许 make_price 静默舍入；报价也校验 tick 倍数。金融账本不用 binary float；原生撮合的参数概率和事件排序不是资金计算。

历史深度未知：明确使用 **unbounded_top_of_book（L1 无限顶层）假设**，模拟 size=100000000 基础单位，不是观察到的量。没有声称真实大仓位具备历史可成交容量；点差体现在真实 bid/ask，不额外扣一次点差。

## 数据契约：同毫秒顺序、FX as-of 与严格周末

生产 advanceNative 直接调用数据模块 `loadExecutionSlice(storageDirectory, {chapterId,symbol,from,to,maxRows})`。读取范围为下一 H1 `[from, from+3600000-1]` inclusive UTC ms。要求返回 kind=`ticks`、相同 chapterId/symbol/from/to、rangeConvention=`inclusive UTC milliseconds`、真实 rows 与 sources。内部 coverage 转为 `[from,from+HOUR)`。

coverage.complete=true 仅指**已校验本次本地 slice 的全部实际返回行**；保持 historicalGaplessnessCertified=false，不能据此声称历史逐笔无缺口。无报价、超预算、缺少源文件、时间错位或换汇超龄返回 missing_data；不推进 version、不记录 decision、不产生可提交的部分费用。来源 hash/身份错误、原生错误或取消抛错，service 应暂停，而非自动重试。

Dukascopy 主流允许同毫秒多行，保持返回原顺序，接受非递减 UTC ms。Nautilus 内部用 `sourceMs*1000000 + 同毫秒序号` 排序；账本 time 始终保留原始毫秒，另存 nativeEventNs 与 internalOrderingOnly=true。此 ns 仅为内部确定性序号，不是来源有纳秒精度的证据；每毫秒 >=1000000 事件会拒绝，不跨毫秒编造时间。

CHFJPY 为独立观测流。按主事件时最后已知 `fx.time <= event.time` 做双侧 as-of join；同毫秒独立 FX 流保持原顺序并取最后记录，两个独立流的同毫秒相对物理顺序未知，不虚构更细的来源次序。固定 fxMaxAgeMs=60000；正 CHF P&L 用 CHFJPY bid，负用 ask；margin 使用 ask。未有历史 FX 或 age>60000ms 则整个候选步暂停，绝不取下一条未来报价补齐。closedLots 保存 conversionSymbol/rate、conversionTimeMs、conversionAgeMs 与可得 source；snapshot 给出已消费 quote 的 FX as-of 时间/age。原生 FX cache 的 ts_event 保留实际 FX 毫秒，ts_init 为其已知报价交给撮合器的内部排序时间，不能冒称新鲜同步 FX。

周末必须由 chapter.weekendGaps 提供 `{from:上一bar UTCms,to:下一bar UTCms}`；只允许 UTC 周五→周日，48..50 小时，且精确匹配相邻两根 H1 端点。支持夏季 Fri20→Sun21、冬季 Fri21→Sun22（49h），也支持合法 48/50h 边界；不自动放行任意工作日 gap。仅 closedHours 或旧 allowWeekendGap=true 不构成豁免。数据模块必须核对真实 returned 端点后提供此列表。

## 私有依赖：只在显式 prepare 装，不在 import/status/advance 装

prepareNative 使用 `<storageDirectory>/kurumi-native/venv`，只查找已有 Python 3.12..3.14，再创建插件私有 venv，不向 system pip 安装。固定 Nautilus 1.231.0 与依赖版本；从官方 PyPI release 元数据选择真实 OS/Python wheel，校验官方 SHA256，最后以私有 venv 的 `pip --isolated --no-index --no-deps` 安装逐个 hash 校验过的确切 wheel 路径，不从缓存额外解析未验证包。安装前核对 sys.prefix != sys.base_prefix 且 prefix 为 owned venv；拒绝 venv 目录 symlink，不能受 system/user pip target 配置重定向。已确认本机 macOS 26.3 arm64 + Homebrew Python 3.13.12 兼容；系统 Python 3.9.6 不适用且未修改。不是跨平台全兼容承诺；无兼容 wheel 明确 NO_COMPATIBLE_WHEEL，不降级或转另一引擎。

成功后写 environment.json，nativeStatus 只读核验 receipt、导入与固定版本。正常重复 prepareNative 复用 ready 环境；中断仅留下私有下载/venv，未写成功 receipt，不宣称 ready。锁存在则 NATIVE_BUSY，不擅自重放。curl 保持 TLS 校验；可复用已有私有 wheel cache 中 hash 相同的 wheel。取消终止受管理子进程；未准备的 advanceNative 给 NATIVE_NOT_PREPARED，不自动安装。先前私有环境可用于直接 fixture 的 decideAndAdvance；正式 service 固定使用 storageDirectory 中已 prepare 的环境。

## 不可变报价文件、驻留 worker 与 CAS

nativeJournal 保存 decision、覆盖与来源，以及 ticksRef={path,digest,rowCount,bytes,...}，不在每步 JSON 中重复嵌入全历史 ticks。报价 step 写入 owned `steps/<sha256>.json`，创建后设为只读；重放校验真实字节 SHA256 与行数，拒绝 symlink/目录越界。回放只引用已消费 prefix；破产终止步另外冻结消费前缀，不把未来后缀放入 durable journal。候选过程未获 CAS 的 immutable 文件可以成为孤立过程文件，但不改变 run/资金，也不允许通过它推进演员视野。

每个 private storage 使用串行、可取消的驻留 Python worker，正常相邻步骤复用真实 BacktestEngine，仅读/匹配当前 step。worker 缓存只在提供的 checkpoint 与先前结果完整匹配时复用；service 拒绝 CAS、切换 run、状态改变或 worker 重启时，从 hash 固定的已消费 journal 重建并核对每行资金，不信任未提交的缓存余额。取消杀死 worker；未返回、未 CAS 的结果不提交，之后只有明确的新请求才可重建。没有自动订单重放、后台模型调用或真实券商副作用。

正常推进不再全量 tick 平方复制；restart/recovery 仍需线性读/重放已消费前缀，极长历史的冷启动仍可能耗时。64 MiB 输出、128 MiB 单 step 文件、500000 rows slice 与默认 300000ms worker processing budget 均为显式界限，超限暂停，不截断冒充完整。journal 含私有路径，仅控制器持久化；snapshot 不返回 journal、quote arrays 或未来 H1。

## 本轮已验证实作与持久 summary

2026-10-11，独立执行：

```sh
node --test plugins/optional-api-v1/packages/kurumi-replay/tests/engine.test.mjs plugins/optional-api-v1/packages/kurumi-replay/tests/native-engine.test.mjs
```

**54/54 通过，退出码 0**。包括真实 Nautilus 市场/STOP_MARKET/OrderFilled 调用，同毫秒主报价、异步 FX as-of 和未来 FX 拒绝、60s age 边界、JPY/CHF 双侧手续费/换汇、三章资金连续、chapter2/3 stopout、现有止损跳空优先、缺数原子暂停、幂等与拒绝 CAS 后重建、取消 worker、原生 FIFO 加仓/部分减仓/反向逐行对账、负余额破产后无未来费用与无未来 journal、模拟 UTC 融资、参考回归与严格 weekendGaps。

测试为明确合成 fixtures，不是实际历史行情验收。示例真实原生 BUY 1000 USDJPY：bid=100/ask=100.02，fill=100.021，费用=3 JPY；long stop=95 后 bid 跳至90：fill=89.999，不按95或 H1 low；破产 fixture balance=-28000 保留，仅消费2条报价而非后续第3条。

实际压力测量（合成每 H1 3000 行报价，连续3步，总9000行）：

| step | wall ms | native ms | cache reused | journal bytes | quote file bytes 累计 |
|---|---:|---:|---|---:|---:|
| 1 | 862 | 116 | false | 997 | 214891 |
| 2 | 863 | 118 | true | 1993 | 429782 |
| 3 | 853 | 116 | true | 2989 | 644673 |

后两步 replayedStepsThisCall=0；文件/元数据体积随新消费报价线性增长。wall 含私有环境只读版本探测；native ms 为真正 Nautilus 运行/适配时间，非整个 service/CAS/模型耗时，也不是真实市场深度测试。

持久代码：engine.js（native 默认导出 + 显式纯参考实现）、native-engine.js（生产 API/准备/驻留 worker/数据 join）、native-engine.py（公开 Nautilus 撮合与精确挑战适配）、tests/engine.test.mjs、tests/native-engine.test.mjs、RULES.md。没有修改 service/data 模块、安装 Sesame 插件、commit/push 或使用外部 Codex。主 Agent 仍负责实际数据覆盖核验、最终安装/宿主 service 集成和报告；当前数据 reader 的 shape 已协同，weekendGaps 必须由数据模块补齐真实端点。service 终止 observe DTO 仍应按 native snapshot.time 截止，破产只消费 H1 的前缀时不可返回整根未完成 H1 OHLC；这属于主 Agent 的 service/UI 文件。

---

# H1 参考引擎（非正式成交路径）

以下描述显式命名的 H1 参考实现，不是正式 Nautilus 成交路径。参考函数没有网络、模型、磁盘、宿主依赖、真实订单或充值接口。主 Agent 负责数据、宿主集成、安装与运行状态持久化。引擎没有读取原用户剧本附件。

## 开发依据与运行

编写前读取了公开 plugin-manager `skills/develop-plugins/SKILL.md` 与 `references/host-api.md`，来自 `/tmp/sesame-api1-publish-workflow/plugins/api-v1/packages/plugin-manager/`。该公开参考说明基础 Plugin API 1 与 HostContext 边界；本引擎不调用任何 HostContext 方法，不能把独立测试当成插件安装/激活通过。

初版参考实作位于 `engine.js`、`tests/engine.test.mjs`、`RULES.md`；本轮根据用户新授权增加独立 native 适配与测试。十进制实现内嵌，不另建 decimals.js 或依赖 package.json，不依赖外部 Codex。ESM 具名导出；Node 22+ 可直接识别该 ES module（实际验证 Node v25.2.1）：

```sh
node --test plugins/optional-api-v1/packages/kurumi-replay/tests/engine.test.mjs
```

较旧 Node/未声明 module 的宿主可以使用 `node --experimental-default-type=module --test ...`，或由主 Agent 在插件包中明确 ESM。测试的行情与摘要仅为合成 fixture，不是历史行情证据。

## 四个具名导出

```js
createReferenceRun(runId, chapters, dataDigests) -> state
validateReferenceDecision(state, decision) -> { valid: true, duplicate: boolean }
decideReferenceAndAdvance(state, decision, frames) -> newState
snapshotReference(state, frame) -> snapshotObject
```

全部同步且纯函数。不会修改原 state、chapters、dataDigests、decision、frames、frame，返回值可以 JSON 序列化。错误带 `error.code`。未消费的非法决定抛错；当前步数据缺失/不一致返回 `missing_data` 状态，而非部分成交。

### createReferenceRun

- `runId`：非空字符串。
- `chapters`：恰好三个元数据对象，按顺序执行；`symbol` 是六位大写外汇代码且报价币仅允许 JPY 或 CHF，`startIndex`、`endIndex` 是当前品种**全 H1 数组**的非负安全整数，`endIndex > startIndex`。
- `startIndex` 初始已经揭示；下一次决定消费 `startIndex + 1`。`endIndex` 包含在章内，消费此 H1 后强制收盘结算。本引擎不重新编号成章节局部 index。
- 可选 `tickSize` 是正 Decimal 字符串；缺省报价币 JPY 为 `0.001`，CHF 为 `0.00001`。生产数据模块应根据实际品种 tick 提供此值。
- 可选 `weekendGaps: [{from,to}]`：只放行数据模块提供的精确相邻端点。端点必须为 UTC H1 整点、周五→周日、48..50 小时；重复、额外字段和工作日项拒绝。旧 `allowWeekendGap` 布尔值不再产生豁免。
- `dataDigests`：数据模块提供的 JSON 对象或数组；深复制、原样保留。引擎不下载数据、不计算/伪造摘要，也不证明它们与 frames 相符，此绑定应由数据模块核实。

```js
const chapters = [
  {symbol:'USDJPY', startIndex:100, endIndex:200, tickSize:'0.001'},
  {symbol:'EURCHF', startIndex:300, endIndex:400, tickSize:'0.00001'},
  {symbol:'EURJPY', startIndex:500, endIndex:600, tickSize:'0.001'}
];
const state = createReferenceRun('run-1', chapters, { /* 真实数据模块返回的摘要 */ });
```

### 状态字段

基础字段：

```text
id, version, chapter, index, status, balance, position,
chapters, dataDigests, fills, orders, history, decisions, equity
```

- `version` 从整数 1 开始；每成功消费一个 H1 后 +1。缺失与幂等重放不增版本。
- `chapter` 为 0、1、2；`index` 为已揭示 H1 的全数组 index。
- `status` 初始/每步完成为 `paused`；执行函数内部为 `ready`；数据不完整为 `missing_data`；最终章结算后为 `complete`。
- `balance` 初始且仅初始为 `'300000'`，始终是 JPY Decimal 字符串。负值保留，不归零。
- `position` 为 null，或 `{quantity, entry, stop, instrument, lots}`。`quantity` 为带符号基础货币整数，`entry` 为显示均价，`stop` 为 Decimal/null，`lots` 为精确 FIFO 成交批次 `[{quantity,entry}]`。必须保留 lots，不能只保留均价。
- 自有附加字段：`ledger`、`rules`、`outcome`、`missingData`、`revealedFrameTime`。
- `revealedFrameTime` 是已消费当前 H1 的 UTC 开始时间。新建/刚换章时为 null，等待该章初始 frame；同章后续推进校验前一 frame 时间未变化，snapshot 不得传过去/未来的 frame。
- `outcome` 在前三章尚未全部结算时是 null；最终为 `'victory'` 或 `'not_reached'`。
- 不提供充值。validateReferenceDecision/snapshot 每次核验 balance 对账到固定初始资本与 ledger，拒绝修改 balance 或负手续费/融资费用。宿主仍必须保护完整状态及数据真实性；此核验不是防篡改签名，调用方不能伪造 ledger、lots 或删改决定历史。

### decision

必须且只能包含以下八个字段：

```js
{
  id: 'decision-1',
  runId: state.id,
  stepId: `${state.id}:${state.chapter}:${state.index}`,
  expectedVersion: state.version,
  target: '1000', // long；'-1000' short；'0' flat
  stop: null,    // 或正 Decimal 字符串
  reason: '为什么决定这样做',
  utterance: '本步明确表达'
}
```

`target` 是规范整数字符串：拒绝数值型、指数、小数、前导 0、`-0`；必须为 1000 的整数倍，绝对值不超过 10000000。`hold` 仍提交 target = 当前 quantity 的完整决定；依然记录决定并消费下一 H1。持仓 stop 可以通过 hold 改动/移除，但旧 stop 先处理下一开盘缺口，不能事后撤销已触发风险。

对已经消费并记录的决定：同 id 不同**完整内容**报 `ID_CONFLICT`；同 id 同完整内容返回当前状态的深复制，不再成交、收费、推进或回退，即使已换章/完成也可幂等重试。重复检查先于新的 step/version 校验，所以旧决定重试有效。内容比较忽略对象字段排列，但不忽略字符串内容。

新的 id 必须匹配 runId/stepId/expectedVersion。数据缺失时决定未被消费，也未占用幂等 id；修复数据后可用相同决定与版本重试。

### frames / frame

`decideReferenceAndAdvance` 收到**当前章完整内部 H1 数组**，不是已揭示前缀或以零重新编号的切片；每次只读取 `frames[state.index]` 与 `frames[state.index + 1]`，不会读取后续未消费 H1 做交易或换汇。

```js
{
  time: 1704711600000, // UTC H1 开始 Unix ms，整点
  bid: {open:'...', high:'...', low:'...', close:'...'},
  ask: {open:'...', high:'...', low:'...', close:'...'},
  fx: { // 报价币 CHF 时必需：同期 CHFJPY
    // time 可选；提供时必须严格等于父 frame.time
    bid: {open:'...', high:'...', low:'...', close:'...'},
    ask: {open:'...', high:'...', low:'...', close:'...'}
  }
}
```

OHLC 全部为正的非指数 Decimal 字符串；open/close 必须在 low/high 内，按字段 bid 不大于 ask。时间必须为非负安全整数、UTC 整点；下一根通常为 +3600000ms。CHF 的 fx 不提供独立 time 时，其数据必须由数据模块已按父 frame.time 同步，不能将无时间的错期 CHFJPY 填入此结构。

当前步所需数据全部通过校验后才开始费用、撮合与推进。缺失、数值型价格、OHLC 不一致、交叉报价、工作日缺口、CHFJPY 缺失/错时间等均返回：

```text
status='missing_data'
missingData={code,message,chapter,index,nextIndex}
```

balance、position、fills、ledger、decisions、version、index 不变。此保证按当前原子步执行，不声称更远的未消费 H1 无缺口或整个来源 complete。初始 frame 没有 timestamp 元数据时，数据模块也必须负责 index 到 UTC 的真实对应。

### snapshot 返回

```text
id, version, chapter, index, stepId, status, symbol,
time, frameTime, position,
balance, unrealizedJpy, equity, margin, freeMargin,
outcome, victoryBalance, targetFactor, ledgerCount, missingData
```

`frameTime` 为 H1 开始，`time=frameTime+3600000` 为已揭示 H1 的区间结束标记。按当前 frame close 计算未实现盈亏与保证金，金额全部是 Decimal 字符串。快照不推进、不执行风控、不改变 state。首次/换章后使用数据模块给出的章起始 frame；同章已有 `revealedFrameTime` 时必须时间一致。

## 执行顺序与成交规则

一条决定推进且只推进下一根 H1：

1. 全部校验当前/下一 H1 与 CHFJPY，同步要求不过则原子暂停。
2. 对原持仓收取前一已消费区间结束至下一真实开盘之间的 UTC 跨日融资（用于显式周末缺口），不重复收取已消费区间费用。
3. **先**按下一真实开盘处理原持仓的保证金风险/旧 stop 缺口；long 用 bid.open，short 用 ask.open。
4. 再调整 target：减少/平仓允许；反向先平原仓再尝试新仓；增加/新开必须有足额初始保证金。开仓试算包含本侧 commission、点差导致的即时未实现盈亏及 tick，失败不留下试算成交/费用。
5. 若开盘风险已强制平仓，本步状态记 `risk_blocked`，不重新开仓。这避免 hold 因止损缺口被自动反手/重新入场。
6. 按下一 H1 开始到结束实际模拟持仓的 UTC 跨日次数收融资；随后在**消费该 H1 区间后**用 adverse OHLC 检测风险/stop。
7. 若到该章 endIndex，按真实 close 强制结算空仓，再进入下一章 startIndex。最后一章完成后给出最终胜负。

买入成交价 = 该 mode 的 ask + 1 tick；卖出 = bid − 1 tick。点差只通过真实 bid/ask 体现，**不再额外扣点差**。target 调整成交使用下一根 open，绝不以本根/下一根 high/low 决定开盘成交价。

- open 风险缺口：按真实 open + adverse tick 执行，不按 stop 保证成交。
- H1 区间：long 以 bid.low 检查，short 以 ask.high 检查；触发后 long 卖出在 bid.low − tick，short 买回在 ask.high + tick。stop 是触发水平，不是保证价。
- H1 close：long 卖出 bid.close − tick；short 买回 ask.close + tick。
- stopout 与 stop 同时命中，优先记 stopout；均全平仓。
- H1 的区间风险/章末成交 `time` 记录为 frame.time + 1h，`atIntervalEnd=true`，它是**区间已消费**的记录点，不伪称知道触发的逐笔真实时刻。真实 open 成交 `atIntervalEnd=false`。

H1 模型是保守估计：不宣称逐笔路径、真实可成交流动性、挂单排队、券商 stopout 或止损保证；同 H1 的主品种与 CHFJPY 极值也不保证在同一时刻，保守估计中使用它们的 adverse 极值组合，不用未来 bar。

## 资金、风险与精确十进制

- 所有价格/金额/汇率计算使用 BigInt + 可变十进制 scale；金融计算没有 Number/binary float。
- Number 仅用于数组索引、整数时间、章号、版本及跨日个数，不用于金融金额。
- 手续费每侧 `abs(成交基础单位)/1000 * 3 JPY`。买入/卖出各计一侧；平仓和平仓后反向开仓是两次独立成交。
- 固定**模拟**隔夜融资 `abs(持仓基础单位)/1000 * 10 JPY * UTC跨日次数`，long/short 均收取；不是历史券商融资费用，也不含真实利差/三倍 swap。UTC 跨日定义为 `(from,to]` 中跨越的日界数；显式周末持仓按实际跨越日数计，不跳过。章节之间已空仓，跳过月份不计融资/收益。
- 多批次加仓与部分平仓采用 FIFO。`position.entry` 仅显示加权均价，HALF_UP 到 18 位小数；原始 `lots[].entry` 精确保留，realized/unrealized 不使用舍入均价，不舍入 JPY 盈亏。
- JPY 报价盈亏直接结算 JPY。
- CHF 每个 FIFO 批次盈利按同期 CHFJPY bid、亏损按 ask 转换：open 使用 fx.open，close 使用 fx.close；H1 adverse 区间盈利用 bid.low，亏损用 ask.high。没有固定 150，也不使用下一条未来 bar 换汇。
- 保证金 = `abs(quantity) * 主品种ask报价 * (CHF时CHFJPY.ask) / 25`。open/close 用对应字段；long adverse 风险用 ask.low，short adverse 用 ask.high；CHF adverse 保证金转换用同期 fx.ask.high。采用保守 ask 估值，不把此定义混称券商实际保证金规则。
- equity = balance + 精确未实现 JPY；freeMargin = equity − margin。
- 初始开仓/增加后 equity 必须 >0 且 >= margin；否则订单 `rejected/insufficient_margin`，不造出试算成交。
- 维持风险在 equity <= margin ×0.5 时全平。负余额原样保留，也带入后续章，不充值/归零。负余额不能新开仓。
- target 的先减仓/反向先平仓若合法，则不会因随后新增仓位保证金不足撤销已经发生的减仓。`orders.resultingQuantityAtOpen` 记录实际开盘结果，不保证等于 target。

## 自有账本与数组

`ledger` 供主 Agent 对账，固定关系：

```text
balance = 300000 + sum(ledger.realizedJpy)
                 - sum(ledger.commission)
                 - sum(ledger.financing)
```

每条 ledger 有 `type: 'fill' | 'financing'`、`id`、`chapter/index/time`、`realizedJpy`、`commission`、`financing`、`balanceAfter`。全部费用为非负 Decimal；盈亏可正负。

- `fills`：`id, orderId, chapter, index, instrument, time, signedQuantity, closedQuantity, openedQuantity, rawPrice, price, slippage, quoteCurrency, closedLots, realizedJpy, commission, financing, reason, mode, atIntervalEnd, balanceAfter`。
- `closedLots`：每批精确平仓对账 `{quantity,entry,exit,realizedQuote,conversionRate,realizedJpy}`。quantity 是原持仓方向，closedQuantity 总量为绝对值。JPY conversionRate 为 `'1'`。
- fill reason：`target_open/target_close/target_reduce/stop/stopout/chapter_end`。mode：`open/extreme/close`。
- financing ledger：另有 `from,to,days,quantity,phase:'gap'|'interval',simulated:true`；非成交，不进入 fills。
- `orders`：每个成功消费决定一个目标记录，含 `id,chapter,index,time,target,stop,status,rejection,resultingQuantityAtOpen,riskAtOpen`。status 是 `held/filled/rejected/risk_blocked`，不是券商委托回报。
- `decisions`：`{decision,executedChapter,executedIndex,executionTime,resultingVersion}`。
- `equity`：每个消费区间结束的 `{chapter,index,time,balance,unrealizedJpy,equity,margin,freeMargin,quantity}`，用当前真实 close 估值。
- `history`：risk、step、chapter_end、chapter_start 事件；risk 事件保留触发前 metrics 与 stop。

## 最终胜利与限制

只有第三章 `endIndex` 强制结算、flat 后，`balance >= '20000000'` 才是 victory。未实现 equity 超目标、前面章已经盈利、甚至前面章已达到目标，都不提前判胜。20,000,000 / 300,000 的展示倍数是 **66.6666667**，不是 100；胜负直接做精确 balance 阈值比较，不用展示倍数做运算。

测试涵盖 JPY/CHF 多空 bid/ask、精确金额、同步/极值换汇、long/short stop、风险开盘缺口、25 倍 margin、负余额、模拟融资/显式周末、全数组 index、强制收盘时间、跨章资金连续、missing_data 原子性、幂等性、严格决定校验、FIFO/反向、纯函数不变性及最终目标精确边界。独立 Node 测试成功不等于宿主安装成功、真实市场覆盖完整或券商回测等价。
