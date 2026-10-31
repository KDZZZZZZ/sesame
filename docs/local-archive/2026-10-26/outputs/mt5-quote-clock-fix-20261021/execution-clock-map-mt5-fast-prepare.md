# MT5 / portfolio 执行时间链只读映射

本记录只读当前源码和已有测试；未打开数据库、子 Run runtime.sqlite、实时应用或账户，未联网、运行交易、编辑产品或执行测试。下文“服务器规则”均为待主线程用官方资料确认的条件，不是从本次源码读取推断出的券商时区事实。

当前可直接确认：portfolio、Python 最后一步守卫、账户 UI 平仓这三处都直接把 `tick.time_msc` 与机器 UTC epoch 比较。仅改 portfolio 会让同一请求继续被 Python 守卫拒绝；仅改 Python 则仍会在 JS 准备阶段被拒绝。市场数据 contract 则已把未明确时区的原始数值标为 broker wall time，两条通道口径不同。

## 1. 当前调用链与时间含义

以下路径均位于 `E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/`。

| 路径 / 符号 / 行 | 当前行为 | 时钟边界 |
| --- | --- | --- |
| `portfolio-execution/index.js:14` | expose observe / prepare / execute / status / cancel | **没有 manual_trade_modify**；close 是 execute.action |
| `portfolio-execution/service.js:7` POLICY | decision 60s、quote 5s、quote-to-send 1s；普通读/发单等待 10s，技术准备 180s | 全是本地 elapsed/UTC deadline；不是服务器日历配置 |
| `service.js:91` prepare → capturePrepared:51 | 读取精确 identity 后按账户加锁；调用 adapters.prepare；保存一个 observation 与 preparation 回执 | 同 operation_id 返回既有回执，不重新刷新报价；旧 observation 仍须过有效期检查 |
| `service.js:120` execute | 已有 observation_id 或 backend+symbol 快捷路径二选一；快捷路径同一次工具调用里准备→发送 | 完整业务意图先持久化；不能因时区修正重放旧 operation_id |
| `portfolio-execution/adapters.js:93` prepare | 一次 mt5_trading_prepare；检查同账户、native summary、权限、symbol、readStartedAt/capturedAt | `receivedAt` 是 portfolio 收到结果；`sourceReceivedAt` 目前借用整个 prepare 的 capturedAt，不是精确 tick 收到时刻 |
| `mt5/backend/trading-prepare.js:114` | account_info → terminal_info → 并行排队 spec/positions/orders → tick → **最后 account_info** → assertCurrent → capturedAt | tick 原值保留，138–144 不做 age 检查；末次账户读取位于 tick 之后，capturedAt 包含其耗时 |
| `adapters.js:64` snapshot（observe / workflow） | identity→catalog→account→terminal→spec/positions/(后台 orders)→quote | 当前 snapshot 在 quote 后不再做 native account 复读；execute 另核配置，Python guard 最后核实际账户 |
| `adapters.js:115` normalizeQuote | `sourceTimeMs = Number(tick.time_msc)`，只验证整数/数量级；返回价格与接收耗时 | **把 raw time_msc 直接命名成 UTC source epoch**，无 basis、server rule 或换算证明 |
| `service.js:26` fresh / `:44` saveObservation | `age = now() - quote.sourceTimeMs` 必须 0..5000；expiresAt = sourceTimeMs +60000 | 如果 raw 编码实际是 wall，错误发生在这里；不能改成 receivedAt 来“修复” |
| `service.js:57` executeObservation | capturedAt ≤ now < expiresAt；账户/config canonical 相等；dispatch 前再次检查到期 | signalSourceAt、signal_age_at_start_ms 也使用 sourceTimeMs，应随同已验证 UTC 值统一 |
| `adapters.js:138` guardFor / `:166` orderRequest | observed_at=sourceTimeMs，expires_at=observation.expiresAt；expected_account/server 固定 | 应传 **真实已验证 UTC 语义**；不能把机器时钟/随猜偏移冒充报价时间 |
| `mt5/backend/official.js:217` MT5Official.call | stable command_id + arguments + owner + config.version 指纹；schema/权限检查；保存 command/result/dataset | 结果整体连同 raw/provenance 可保留；config 修改在 jobs 非空时拒绝。普通 raw mt5_trade 没有默认注入 quote guard |
| `mt5/backend/process.js:53` MT5Python.call | Promise tail 串行排队，每个 native 调用最多 30s；排队后仍观察外部 signal | account 目前只对 initialize/login 随 IPC 发送；不要假定 quote worker 已有受信绑定上下文 |
| `mt5/backend/python-worker.py:100` | 有 execution_guard → guarded_send；cancellation_guard → guarded_cancel；否则直接原生函数 | quote-clock 不能只修外层：guarded_send 自己直接调用 SDK 的两次 tick 不经过普通 JSON 输出清理 |

### Python 最后一步的实际顺序

`mt5/backend/execution_guard.py:56 guarded_send`：

1. 本地 `clock()` / `monotonic()` 记录 start；检查 observed_at/expires_at、最大 60s 决策寿命。
2. account_info + terminal_info 检查精确账户/服务器和实际权限。
3. symbol_info / volume step；如为 close，读取精确 position ticket、方向及剩余量。
4. `fresh_quote:124` 读取 tick，`received = deadline()`，直接 `received - tick.time_msc` 检查 0..5s；查价格边界。
5. 一次 order_check；检查整个 symbol 的 expected_positions/working orders（后台执行有该项）。
6. 再读一次最新 tick；再检查指定 position、整个组合、**最后 account+terminal**。
7. deadline；`send_at - received <= 1000`；只调用一次 order_send；保存 execution_timing。

明确保留：先 order_check 后再读 tick；final account/position 检查留在 1s 最后一步预算内；未知发送不重试；checked request price 不在 order_check 后悄悄替换。现有 timing `source_time_ms` 仍是 raw time_msc，`decision_age_at_send_ms` 使用 guard.observed_at，两者修复后必须标明原始/归一值。

顺带可见的时间边界：最终账户读取之后仅检查 **quote-to-send ≤1s**，没有再次检查 **send_at - normalized tick UTC ≤5s**。因此 tick 读取时已近 5s，再花少于 1s 做复核，发送时年龄可能超 5s。建议修时钟时加这一小断言；耗时预算优先用 monotonic，UTC 仅用于来源年龄和可审计时间。当前 monotonic 只参与总决策到期，不参与 quote-to-send；不要把这点描述成时区修复已经解决。

## 2. 平仓、改单、撤单、历史旁路

### 两种平仓

- **manual close**：`adapters.js:145/163` → opposite DEAL + exact position → 与普通下单相同的 execution_guard；修正常规 quote 路径即可覆盖其时间判断。
- **账户 UI close**：独立的 `mt5/positions.js:createPositionManager.close:68`，94–96 直接检查 raw time_msc ≤ now 且 age≤5000；97 最后读取 account/terminal；106 设置 guard observed_at=本地 observedAt、expires_at=observedAt+60000，再走相同 Python guard。**这一独立 JS 检查也必须接统一时钟解析。**
- UI 平仓当前 observed_at 是本地决策观察时刻；portfolio 则用 quote sourceTimeMs。两者不是同一个语义，最小修复可保留各自决策 deadline，但另存 `quoteSourceUtcMs` 和 raw clock evidence，不能混写字段或因为换算延长 TTL。
- UI `readReceipt:116` 主要按 position identifier/order/deal ticket 查询和关联成交，没有依赖开仓时间与本地时钟比较。`contract-mapping.js:183 mapPosition` 仅把 openedAt 映射成 wall/utc 展示，不参与 close 的时效授权。

### 改单不经过 portfolio guard

- `portfolio-execution/index.js` / service.js / plugin.json 只声明六个 manual tools；没有 modify 服务。
- `mt5/TRADING.md` 声明原生 `trade_modify_sl_tp`，或 Python `TRADE_ACTION_SLTP` / `TRADE_ACTION_MODIFY`。入口是 `mt5_trade` → `backend/plugin-tools.js:6 officialTool` → `official.js:217 call`。
- `execution_guard.py:108–110` 明确只允许 DEAL/PENDING（market、limit、reduction）。SLTP/MODIFY 若强行附该 guard 会被拒绝；若不附则 `python-worker.py:104–111` 直接执行，不获得上述 freshness / final native identity guard。
- 这不是本轮应顺带增加 `manual_trade_modify` 的依据；demo 闭环的改单可使用已有声明的原生能力，但结果中应写清走的是该原生路径，不宣称已有 portfolio 最后一步守卫覆盖。
- `python-tools.js:11` 将 native request.expiration 描述为“UTC 秒”，worker 对它不转换。portfolio 的订单固定 GTC（adapters.js:161），不涉及 expiration；若 demo 修改到期时间，须另确认该官方字段的时间语义，不把 tick 的服务器转换规则推广到它。

### 撤单与历史

- `adapters.js:194 cancel` 做身份与唯一活动订单归属检查，发送 REMOVE+cancellation_guard；`execution_guard.py:32 guarded_cancel` 重读账户、订单，再读账户后发一次。撤单不依赖 tick 时间；不存在本次 quote UTC 偏移问题。
- `adapters.js:181 status` 用本地 UTC `createdAt-60s ... now+1s` 构造 Python history_deals_get 输入；`tools/trading-context.js:83` 也构造 UTC history bounds；`python-worker.py:45` 把带时区 ISO 转为 UTC datetime。这是 **API 查询参数契约**，不等价于返回 tick 的编码契约。不能因为 tick wall 修复就全局对这些 date_from/date_to 加减小时。
- `positions.js:129/147` 按 position/ticket 查询，避免了恢复交易证据时依赖上述窄时间窗。status 的 bounded history 若遇不到精确订单仍保持 unknown，不能因为结果为空认定未成交。

## 3. 现有 market contract 可复用什么

- `mt5/backend/contract-mapping.js:48 sourceTime`：数字按编码 wall 时间保存；带 Z/offset 的明确文本才返回 utc。可复用 `{basis:'wall', authority:exactServer, value}` 表达原始时间，以及 `accountIdentity/sourceIdentity` 的精确作用域。
- `:77 timeKey`：wall 值临时加 Z 得到 **同一 wall authority 内的排序坐标**；它不是 UTC 转换器，不能把结果用于 quote freshness。
- `:109 mapInstrument.timeBasis` 仍是 wall，未带猜测 zone/calendar。不要为了交易时钟修复把所有历史、K 线、指标、图表强改 UTC。
- `mt5/backend/providers.js:41 tradeServerTime / :145 currentBrokerTime` 仅采用 MCP `trade_server_last_known_time`；明确不从 utc_time/local_time 推导服务器偏移。此字段是 last-known，也不能用它与接收时刻作差“校准”报价，否则停盘/旧 tick 会被洗成新鲜。
- `providers.js:245` 的离线 bar anchor 保持 freshness=stale；不可作为交易时钟映射依据。
- `official.js:264–267` 已有原始 command result、received_at、as_of、data_hash 的 dataset provenance。新增时钟解释应作为 sidecar 附在原始响应旁，保留这些证据，不改写 tick.time / tick.time_msc。

## 4. 最小修复建议（官方规则确认后）

1. **规则放在 MT5 backend 的来源解释层**，绑定精确 native server，明确 transport/字段、rule id+revision、有效日期范围和官方证据出处。不要放宿主、portfolio 业务逻辑、图表显示层或模型提示词里。未知规则返回明确 clock-unverified；不要从 `now - tick`、电脑 zone、服务器名称模糊匹配或任意整数小时拟合来推断偏移。
2. **统一纯时钟解析，原生 worker 是最终执行权威。** 在 MT5 包内部用同一份版本化 JSON 服务器规则供 JS/Python 消费，不跨插件 import 私有文件。普通 symbol_info_tick 输出保留原 `result`，另附 quote-time sidecar（rawTimeMsc、rawBasis/wall authority、normalizedUtcMs、ruleId/revision、appliedOffset、observedAt）；portfolio 只消费这个显式元数据。Python guarded_send 的两次直接 SDK tick 必须调用同样规则的纯解析函数。避免 portfolio 另维护一套券商规则。原生 fresh quote 再根据 verify_account 得到的实际 server 独立解析；不能相信模型传入 offset。实际规则落定仍以主线程等待的 live 采样和官方秋季 DST 证据为前提。
3. **消费者只认已验证归一时间。** `tradingPrepare.read`、`adapters.py` 和 `positions.read` 当前会丢掉 command.result envelope，需为 quote 提取 sidecar（不改变原始 tick）；adapters.normalizeQuote 使用 normalizedUtcMs 作为 sourceTimeMs，并保留 raw 与 clock evidence。service fresh/expiry、position UI 的本地 age 检查统一用该 UTC 值。若传 expected clock revision 到 native guard，native 只把它作一致性约束，规则仍由 native 绑定自主决定；相关 strict schema 同步修改。
4. **保留精确账户和规则的一致性。** 既有 account/revision 检查照旧；规则/服务器/terminal 绑定改变后旧 observation 不可继续发送。guard 对每次 tick 的解析及最后 account 回读均确认同一 server；规则修订不可让既有 command_id 重算成新意图。给 stale/future/clock-unverified 错误附 raw、UTC、age、rule provenance（有界字段），不把错误变成新鲜报价。
5. **DST 按报价自身发生时间换算**，不是按当前日期决定固定 UTC+N。只接受官方定义覆盖该日期的规则；春季不存在时间、秋季重复时间、规则过期或换服务器无法唯一映射时拒绝。可以在确定规则和独立证据足以消歧时消歧，不能“选最接近 now 的候选”来让旧 tick 过 freshness。每次最终 tick 都重新解析，不能使用上次准备保存的 offset；原始报价即使早于 DST 切换也按其原日期处理，然后仍严格拒绝过期。
6. **小幅补最后一步断言**：在 final account/position 验证后、order_send 之前，重新检查归一 tick age≤5s、decision deadline 和 monotonic quote-to-send≤1s；保持一次 order_check、最多一次 order_send，无模型往返。raw source time 与 normalized UTC 分开写入 execution_timing。

要改的最小消费者集合：MT5 backend quote-clock helper（新增）、python-worker.py、execution_guard.py、trading-prepare.js（仅 quote envelope）、positions.js、portfolio-execution/adapters.js（quote envelope/normalization）；service.js 主要补 provenance/clock mismatch 约束，不放服务器规则。若 native internal IPC 要携带可信规则绑定或 guard schema 新增 revision 字段，再小改 process.js/python-tools.js；不能为了省文件在 JS 和 Python 中分别硬编码一个 offset。文档中“最新UTC tick”的无条件措辞要跟实现一致。现有 DTO 严格定义、capabilities schema 与 fixtures 按最终选择同步，宿主无需改。

## 5. 现有定向测试与应补的回归

本次只检查了测试源码，**没有执行以下测试**。

| 已有文件 / 关键行 | 已覆盖的边界 | 当前缺口 |
| --- | --- | --- |
| `optional-api-v1/tests/portfolio-fast-prepare.test.mjs:88/104/132/186/209/234` | 一次 identity+prepare、长准备后才开始 quote clock、快捷发送、换账户、旧/未来报价、坏时间 | fixtures 基本 raw=UTC；应加确定 wall 规则、raw 不改、未知规则拒绝、DST/规则revision变化 |
| `packages/mt5/tests/trading-prepare.test.js:63/117/144/195` | 无多余初始化、独立读排队、末次账户切换、raw tick 不归一 | 195 特意将 raw time_msc+10800000 并确认原值保留；应保留此性质，另验证 sidecar 正确，而非删掉原值断言 |
| `optional-api-v1/tests/execution_guard_test.py:66/73/77/81/101/109/116/126` | 两次 tick、队列/慢check过期、stale/future缺值、account/position变化、最后一步耗时、未知结果不重试 | 补 wall转换、DST前后/歧义、unknown server、归一后stale/future、最后账户读取后5s越界、monotonic耗时 |
| 同文件 `:301/304/307/313/316` | 真实 worker fixture 中 guard dispatch、未发单标记、expected_positions、普通无guard路径、撤单 | 补 sidecar envelope 路由与最终 guard 使用同规则；不靠只测 helper 来宣称集成通过 |
| `optional-api-v1/tests/mt5-positions-v2.test.mjs:67/84/97/108/123` | UI close 幂等、权限/账户/position变化、精确成交及真实剩余量、未知不重试 | 补 UI close 也采用统一时钟，防止只修 manual close |
| `optional-api-v1/tests/mt5_positions_guard_test.py:64/76` | long/short close、原生账户/持仓/订单/quote在check后变化 | 补不同服务器规则以及换服务器后的零发送 |
| `optional-api-v1/tests/trading-decision-portfolio.test.mjs:146/156/162/202` | guard来源时刻与完整symbol预期、旧决策、换账户、后台/手动区别 | 补后台 observe 路径获得同样clock evidence，不止主会话prepare |
| `api-v1/tests/mt5-contract-mapping.test.js:17/105` | 未知broker wall保留、显式UTC、数字wall、点分日期 | 保持该语义，不能把 timeKey 变成偏移换算器 |
| `packages/mt5/tests/market-offline-cache.test.js:162/189/212/220` 与 `api-v1/tests/mt5-account-mcp.test.js:69/89` | exact broker+symbol、真实trade_server字段、取消、stale anchor、UTC-only不猜wall | 保持行情/缓存和交易时钟边界，不将离线anchor当新鲜quote |

执行修复后最小验收：先用 fixture 验证所有拒绝路径 order_send=0、好路径一次发送并原始时间保留；再由主 Sesame Agent 使用已连接 demo 账户走真实下单→原生改单→平仓及成交/剩余量回读。纯 fixture 不证明券商实际时间语义，改单原生成功也不证明 portfolio 已新增 modify guard。

## 6. status 的历史查询风险与最小精确查询方案（主线程追加重点）

`portfolio-execution/adapters.js:177` 已先取得 original command；但 181 行仍固定以 UTC 时间窗查询 history_deals_get，直到 183 行才读取 `command.result.result.order/deal`。因此即使已有精确订单号也没有利用。若该服务器历史筛选的真实语义与本地 UTC 区间不一致，窄窗口可能漏掉刚成交；仅看到 native deal.time 为 wall 并不能独立证明 SDK 输入窗口必然错误，须与官方契约/真实采样分开陈述。

最小修法可以不依赖任何时间转换：

1. 把正 `orderId` / `dealId` 的提取提前到历史查询之前。原生已确认 `orderId` 存在时，优先 `history_deals_get({ticket: orderId})`。这里 SDK 参数 **ticket 指 order ticket，不是 deal ticket**（主线程已明确的接口语义）；禁止把 `dealId` 代入。
2. 如无 orderId，只有在已保存并验证的原生 observation 中存在 `position.identifier` 时，才可使用 `history_deals_get({position: identifier})`。`service.js:66` 当前 intent 只保存用户传的 positionId（ticket），不是 identifier；应在冻结 close observation 时从精确匹配原生行保存 identifier。不能默认 ticket==identifier，更不能靠服务端当前持仓还存在来支撑已平仓后的恢复。
3. 账户 UI `mt5/positions.js:98/129` 已保存 identifier 并按 position 查询，可复用其思路。不要直接跨插件 import UI manager。
4. 选择器不是证明本身：ticket 路径必须核对每个保留 deal.order 与该 orderId 相等；position 路径可能返回此 position 一生多笔成交，仍必须按原订单/deal 或该意图独有 remark 关联，保留 exact symbol、实际 BUY/SELL、正 ticket/order ID 约束。不要把所有 position 历史当成本次平仓成交。
5. 两类精确键都没有时，保留现有有界 UTC 历史 fallback 及真实覆盖限制。若官方后续证明需要服务器时间筛选，再在明确契约下另做边界转换，不从 tick 偏移一次性推广。空结果始终保持 unknown，不解锁新订单；禁止扩大成无边界全账户历史。
6. 不改变 `verifyNativeAccount` 前后复核（179/182）和配置复核，不改 operation_id、幂等、unknown 阻断、parent-owned command 读取逻辑。

已有相关回归位于 `optional-api-v1/tests/trading-decision.test.mjs`：114「zero native IDs and non-trade history cannot resolve…」、148「MT5 timeout recovery can cancel one exact active pending order…」、197「MT5 old-revision recovery brackets native account and current configuration…」。这些 fixture 目前按 method 返回数据，没有断言 selector，因此不能说现已覆盖时间窗漏查。

应加最小定向例：

- 已确认 orderId（含大于 JS 安全整数的十进制字符串）→仅一次 `{ticket: orderId}`，无 date_from/date_to，不把 deal ID当order。
- 模拟时间窗口为空但 exact ticket 有刚成交；status 能从精确证据恢复。
- 只有 dealId 而无确认 order/position selector →不误用 ticket，fallback 空结果仍 unknown。
- 已确认 position.identifier 与 position.ticket 不同；平仓后当前 positions=[] 仍能按保存 identifier 查询，且不会吸收同 position 的其他订单成交。
- 精确查询仍遇账号/服务器/配置变化、零ID/非交易deal/异品种/不匹配order时拒绝，且从不重新 order_send。
- `packages/mt5/tests/python-worker-dispatch.test.py:71` 现有测试覆盖非空 kwargs 和 UTC 日期位置参数，应补 history_deals_get(ticket='大整数') / position='大整数' 保持 kwargs 并准确转成 Python int；每次仅调用 SDK 一次。
