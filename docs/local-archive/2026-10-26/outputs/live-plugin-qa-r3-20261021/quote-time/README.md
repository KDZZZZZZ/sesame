# MT5 报价时间口径审计（R3，离线）

**结论：旧回执中的 `STALE_QUOTE` 可以准确复现，但现有证据不能确定真实行情已过期。** Python 原始 tick、原生 MCP 显示的服务器时间一致；直接把该整数视为 UTC，便会比宿主 UTC 晚约 3 小时。算法交易权限不是这个拒绝的原因。没有依据把时间统一减 3 小时，也没有依据放宽 5 秒新鲜度条件。

本审计只读 R2 已冻结文件和当前插件源码，没有重新访问账户、交易终端、业务模型或任何 SQLite。**这不是 2.1.5 开启权限后的新行情取样，也不能代替本轮交易闭环结果。** 只新增本目录内的审计文件，未修改产品或运行时。

## 证据与归因

冻结样本为 2026-10-21 03:37 UTC，模块版本 `5.0.6231`，品种 EURUSD。四份原始文件均通过此前已保存的字节数和 SHA256 校验。

| 项目 | 冻结原始值 / 可复核结论 |
| --- | --- |
| Python tick | `time=1792564624`，`time_msc=1792564624959`，秒与毫秒字段一致，余数 959 ms |
| 直接按 UTC 展示整数 | `2026-10-21T06:37:04.959Z`，这只是数值解释，不代表源已证明 UTC |
| 原生 MCP | `update_time=2026-10-21T06:37:04`，无偏移量；bid/ask 与 Python 完全相同 |
| 宿主取样前后 | `03:36:53.148Z` — `03:37:27.594Z` |
| Python 命令完成 | `03:37:08.347Z` |
| raw tick 减宿主 UTC | 整个取样窗为 `10,777,365–10,811,811 ms`；相对命令完成为 `10,796,612 ms` |

[完整数值与冻结摘要](E:/brief2great/sesame/outputs/live-plugin-qa-r3-20261021/quote-time/audit.json)保存了输入摘要、源码摘要和实际检查结果。

代码链确认如下：

- [python-worker.py:53](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/python-worker.py:53) 的实际 `clean` 函数只展开 tuple/NumPy 标量等结构，对本次 `time`/`time_msc` 整数不做时间转换。离线调用该函数得到原数值，排除了此序列化函数加上 3 小时的假设。
- [adapters.js:96](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/portfolio-execution/adapters.js:96) 直接将 `tick.time_msc` 作为 `sourceTimeMs`，仅验证整数及数量级，没有服务器时间基准或 UTC 转换证据。这种验证能证明数值格式，不能证明时间基准。
- [service.js:24](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/portfolio-execution/service.js:24) 要求 `0 ≤ now - sourceTimeMs ≤ 5000`；本次数值必然失败。`observe` 在创建/持久化 observation 前拒绝，因此没有 observation ID 是该路径的预期结果。
- [execution_guard.py:128](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/execution_guard.py:128) 的最后一段原生执行检查也对 raw `tick.time_msc` 使用相同 UTC 比较。仅改 JS 层无法解决该链路；把 raw tick 继续当作 observation 的 UTC 时间还会先触发 `CLOCK_CHANGED`。
- [contract-mapping.js:46](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/contract-mapping.js:46) 在原生行情/历史映射中已有显式 `basis:'wall'`，同一个数值传入后保留 `FTMO-Demo` authority，没有推算 UTC。这表明项目已有区分服务器墙钟与 UTC 的表达方式，但组合执行的 Python quote 尚未带此证明。

可确定的产品问题是**对未验证源时间基准给出“verified UTC”的表述与数据契约过强，报错诊断也不足**。当前拒绝行为本身没有算术错误；把它判为“误拒绝了已证明新鲜的报价”还缺证据。

## 官方资料的边界

MetaQuotes 的 Python `copy_ticks_from` 文档明确要求查询 datetime 使用 UTC，并称返回数据时间为 UTC。[Python tick 查询说明](https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksfrom_py)。但 `symbol_info_tick` 页面只声明返回最新 tick 并引用原生 SymbolInfoTick，没有单独说明怎样核实券商时区；MqlTick 对 `time_msc` 的字段说明是最后报价更新的毫秒时间。[symbol_info_tick](https://www.mql5.com/en/docs/python_metatrader5/mt5symbolinfotick_py)、[MqlTick](https://www.mql5.com/en/docs/constants/structures/mqltick)。

另一方面，官方 AlgoBook 说明服务器时间来自券商，客户端随 tick 获知它；无 tick 时该时间停止推进。[服务器与本地时间](https://www.mql5.com/en/book/common/timing/timing_local_server)。`TimeCurrent` 来自服务器且不依赖电脑时间设置；`TimeTradeServer` 是客户端计算的当前服务器时间，依赖电脑时间设置；`TimeGMT` 同样根据本机本地时间与夏令时计算，因此后二者不能充当独立可信 UTC 源。[TimeCurrent](https://www.mql5.com/en/docs/dateandtime/timecurrent)、[TimeTradeServer](https://www.mql5.com/en/docs/dateandtime/timetradeserver)、[TimeGMT](https://www.mql5.com/en/docs/dateandtime/timegmt)。

这些说明与本次两个通道同为 06:37 的现象，使“服务器墙钟被直接解释为 UTC”成为合理候选，但未证明该 FTMO-Demo 服务器当前和全年遵循什么偏移/夏令时规则。四份文件也没有独立 UTC 同步源及偏差记录，不能排除宿主绝对时钟异常。没有查询论坛经验帖或把其他券商规则用于本账户。

## 最小处理与下一次检测

可以独立修复的最小部分是诊断：保持 `STALE_QUOTE` 及拒绝语义，在现有错误详情中保留 `rawSourceTimeMs`、`receivedAtUtc`、`ageMs`、`server`、`symbol`、`sourceTimeBasis`；负年龄明确提示“源时间基准或时钟未核实”，避免只让 Agent 继续等新报价。这一变化不需要降低门槛或改变宿主接口。本审计没有代为实施。

真正恢复组合执行，至少需要以下证据，由主 Agent 经正式只读工具完成有界取样：

1. 在同一终端/账户/服务器绑定下，用宿主 UTC 与单调时钟夹住每次读取，保存 raw tick 的秒、毫秒、价格、接收时间、SDK/终端版本；选少量不同实际 tick，而非无限轮询同一缓存。
2. 只读核实宿主 UTC 的同步来源和最近已知偏差；界面时区、Date.now 与 UtcNow 互相一致不构成独立准确性证明。
3. 若当前正式终端工具能够给出 `TimeCurrent`、`TimeTradeServer`、`TimeGMT`，同窗读取可诊断它们与 tick 的关系。未暴露这些能力时应记录缺项；不能假称 Python SDK 提供该方法，也不能用 Tester 结果替代 live——官方说明测试器中的这些时间会被模拟。
4. 若证实源是服务器墙钟，归一化必须采用**可追溯、绑定具体服务器且有有效期间的偏移/时区规则**，并保留 raw 与规则版本。账户/服务器切换、规则过期或夏令时歧义时使证明失效。两次 tick 相差 3 小时的观测只能辅助诊断，不能自行制造这个规则。
5. 同一规则与校验必须同时覆盖观察层、最终 Python 执行保护和依赖该时间的 position close 路径；真实 UTC 源保持不变。最后一段执行检查仍需重新获取 tick，并同时满足源报价新鲜度、决策有效期和读取到发送预算。以接收时间冒充源时间只能隐藏缓存/行情延迟。

若无法建立时间规则，保留“组合执行时间基准未核实”的独立阻碍，不把它误写成用户授权不足或 MT5 算法开关仍关闭。原生订单能力的测试应分别记结果，不能据此声称本组合执行检查已通过。

## 已执行验证和修复验收条件

本目录有 **21 项离线检查通过**（Python 13、JS 8），没有真实订单或账户调用。

- `audit.py`：4 项冻结文件完整性；秒/毫秒一致；双通道时间与价格相同；原始数值超出整个宿主窗；实际 worker 序列化保持 raw 值；实际 Python guard 在取样前/命令完成/取样后三个时刻均以 `STALE_QUOTE` 拒绝、`order_check`/send 为 0；绕过观察层仍以 `CLOCK_CHANGED` 拒绝；被审计源码摘要未变。
- `mapping-check.mjs`：从当前 `service.js` 精确提取其纯 freshness 表达式（没有导入 service 或打开数据库），在三个时刻复现拒绝；确认 0/5000 ms 边界可接受，未来 1 ms/5001 ms 过期均拒绝；实际 `sourceTime` 保持 broker wall 标注。

运行命令：`python -B audit.py`，然后 `node mapping-check.mjs`。结果分别见 [audit.json](E:/brief2great/sesame/outputs/live-plugin-qa-r3-20261021/quote-time/audit.json) 和 [mapping-check.json](E:/brief2great/sesame/outputs/live-plugin-qa-r3-20261021/quote-time/mapping-check.json)。Python 通过内存编译纯函数而不加载 MetaTrader5 SDK，不向产品目录写 pycache。

后续若实施时间规则，验收应新增：已证明 UTC/已证明服务器规则的正例，未知/过期/换服务器/DST 重叠或缺口的拒绝，超过 5 秒真实旧 tick 不得通过，未来 tick 不得通过，宿主回拨及单调时钟预算，JS 与 Python 归一化结果一致，账户切换发生于观察后或最终检查中时拒绝，接收时间新而源 tick 旧仍拒绝。只有这些定向回归和真实主 Agent 新一轮观察/最终检查通过，才能把本项从阻碍改为通过。
