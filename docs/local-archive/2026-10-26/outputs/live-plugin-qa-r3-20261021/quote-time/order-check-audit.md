# R3 Python order_check 参数适配审计

**最小根因候选已定位：worker 为本应只有一个位置参数的 `order_check(request)`，额外传入了空的 `**kwargs`。** CPython 的 C 扩展能区分“未提供 kwargs”和“提供空字典”；本次 SDK 返回的 `Unnamed arguments not allowed` 与这个调用差别一致。字符串枚举转换不是本次已知错误。

严格区分证据：已证明当前 worker 的调用形状与官方直接调用不同，且能在 C-API fixture 中复现空字典/NULL 指针差别；**尚未调用真实 SDK 验证改后恢复**。本审计未改产品、安装、配置或端口，未访问实际账户、交易终端、模型、SQLite 或 Runtime。

## 现场与源码

冻结文件 [trade-receipts.json](E:/brief2great/sesame/outputs/live-plugin-qa-r3-20261021/trade-receipts.json) 中：

- `QA20261021-R3-check-market-01` 于 `06:42:31.916–06:42:31.918 UTC` 调用 Python `order_check`，返回 `result:null`、`last_error:[-2,"Unnamed arguments not allowed"]`、SDK `5.0.6231`、命令状态 `failed`。没有 `MqlTradeCheckResult`，不能解释为券商审核拒绝或通过。
- 输入的 request 包含 `TRADE_ACTION_DEAL`、`ORDER_TYPE_BUY`、`ORDER_FILLING_IOC`、EURUSD、0.01 手及价格、止盈止损等字段。它使用了插件公开声明支持的常量名。
- 同一批较早的 Python `terminal_info` 为 `trade_allowed:true`、`tradeapi_disabled:false`、`connected:true`。它与参数错误是不同层级；增加账户授权不能修正函数参数形状。

[python-worker.py:27](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/python-worker.py:27) 已正确配置 `order_check`/`order_send` 的 `request` 为位置参数。[convert_input](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/python-worker.py:34) 递归展开 request，常量名转为 SDK 整数；本次离线检查得到 action=1、type=0、type_filling=1，volume=0.01 保持不变。

问题位于 [通用分派末尾](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/python-worker.py:108)：取出 request 后 `args` 已变成 `{}`，但仍调用 `getattr(mt5, name)(*values, **args)`。因此进入 C 扩展的 kwargs 指针非 NULL，而官方写法只提供位置参数。MetaQuotes 明确将 request 描述为必需的未命名参数，示例为 `mt5.order_check(request)`；order_send 同样使用一个 request 参数。常量写法是 request 内的枚举值，不能改成把字段拆到顶层 kwargs。[order_check 官方说明](https://www.mql5.com/en/docs/python_metatrader5/mt5ordercheck_py)、[order_send 官方说明](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py)。

最小候选修复是一行按剩余参数是否为空分派：

```python
result = getattr(mt5, name)(*values, **args) if args else getattr(mt5, name)(*values)
```

它保持位置参数及非空过滤 kwargs；一次请求只调用一次，不增加异常后自动重试，不改业务 request、枚举、权限、新鲜度或 command_id。`execution_guard.py` 内原本就是直接 `mt5.order_check(request)` 和 `mt5.order_send(request)`，不应为了这个故障重复改动。仅换成 `order_check(request=request)` 与官方必需位置参数约定不一致；改为 `order_check(**request)` 也没有依据。

## 离线检查与回归形状

[order-check-call-audit.py](E:/brief2great/sesame/outputs/live-plugin-qa-r3-20261021/quote-time/order-check-call-audit.py) 执行 **19 项检查通过**，结果在 [order-check-call-audit.json](E:/brief2great/sesame/outputs/live-plugin-qa-r3-20261021/quote-time/order-check-call-audit.json)。它通过本机 CPython C API 创建独立 fixture，读取实际 worker 的转换函数、POSITIONAL 和分派表达式，在内存中与上述候选比较，没有导入 MetaTrader5。fixture 内“带 kwargs 的位置参数请求被拒绝”是对现场 SDK 行为的建模；它不是厂商 SDK 内部实现的反编译或真实 MT5 测试。

检查证明：

- 当前 order_check 与普通 order_send 均产生一个 request 位置参数加一个非 NULL 的空 kwargs；候选调用只保留位置参数。
- 三个字符串枚举正确转换，0 值的 ORDER_TYPE_BUY 没有丢失。
- `orders_get(symbol=...)` 的非空 kwargs、history 的日期位置参数加 group 过滤仍保留；零参函数不再收到空 kwargs。
- 未知常量在调用前拒绝；每个分派只有一次 C fixture 调用；产品源文件 SHA256 未变。

产品回归宜运行真实 JSON-lines worker、只替换外部 SDK，使用上述能观察 kwargs 指针的 C fixture。普通 Python `def f(*args, **kwargs)` 会把两种输入都变成空字典，掩盖这类问题，因此现有 Python stub 通过不证明此处兼容。至少覆盖 order_check、普通 order_send、零参读取、具名过滤和日期+过滤混合调用；保留单次发送和未知结果不得重放的既有断言。

最终验收需要在安装修复后，由真实主 Agent 用**新 command_id 和当时现价**执行一次只读 `order_check`。得到真实非空 check result 才能认定该 SDK 兼容问题已修复；若出现新的 retcode，应记录为后续有效检查结果，不把 `retcode=0` 宣称为下单成功。无需重放旧订单来验证参数解析。

## MCP 交易拒绝是另一个问题

同一冻结文件中，`QA20261021-R3-market-open-01` 的 `trade_send_market_order` 返回内层 `isError:true` 和 `Tool 'trade_send_market_order' trading is not permitted`。这是上游 MCP 工具结果；Sesame 本地授权若阻断，会在 [official.js:237](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/official.js:237) 调用前抛 `mt5_permission_denied`，不会形成该已返回的工具内容。

权限读取通过 `market.connected()` 新调 `get_trading_account_info`，执行通过同一个 `official.client('terminal')` 进入 `MT5MCP.call`；此源码没有另一套“读取为 true、执行强行改 false”的判断。两个标志为 true 的旧快照不等于调用时所有原生门槛均已通过，且快照与实际失败并非同一时刻。

MetaQuotes 官方配置文档另列 **AI Assistant → Trading**，可以允许、要求确认或禁止交易；该页明确 AI 设置也涵盖相关外部 Agent/MCP 使用。这是值得核实的独立设置，但此审计没有实际界面或配置回执，**不能断言它当前关闭，更不能臆造 INI 字段去修改它**。[官方 AI/MCP 配置](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/configuration)。

因此 MCP 当前应保留“原生工具拒绝，具体额外门槛待核实”；不要再次把算法开关已经开启等同于 MCP 下单闭环通过，也不要借 Python 适配修复扩大成 MCP 权限已修好。本次未重写端口、清空认证或改终端。
