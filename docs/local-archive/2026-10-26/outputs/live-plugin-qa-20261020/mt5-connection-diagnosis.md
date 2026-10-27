# MT5 连接诊断与最小修复

检查日期：2026-10-20。最新只读终端日志检查时间：08:15 UTC。日志中的时刻按文件原样列出，不与券商服务器时间混用。

结论：本次包含两个不同问题。FTMO-Demo 连接确实在原生终端内断开，插件的 `broker_offline` 有日志依据，但断线原因仍未确定；Python 初始化另有一个已确认的产品缺陷：终端使用便携模式，Python 初始化却遗漏同一模式参数。已在源码修复并通过隔离测试，尚未由本诊断任务部署或实机重试。不能据此宣称它是本次 IPC timeout 的唯一原因。

## 当前证据与判断

| 项目 | 已观察到的证据 | 判断 |
| --- | --- | --- |
| 当前安装包 | `sesame/mt5` 2.1.0；更新计划为 `skip-already-identical`；已安装摘要 `sha256:0d2b4dd8cf4437cdc863c2c874b6096ca749e1cea21b492dfd62375bbcd06e73` | 调查开始时已安装的 connect、auto-connect、process、python-worker、official 五个文件与源码逐一 SHA-256 相同；不是这些文件仍在使用旧版本。此次修复后源码有新差异，待主任务部署。 |
| Terminal MCP | 真实工作台 Agent 的账户读取成功；`mt5_connect` 保存凭据认证通过，`mcp_connected=true` | MCP 通道正常；不能代表券商或 Python IPC 已连接。 |
| 券商连接 | Agent 读到 `server_connected=false`；连接核验等待约 30 秒后为 `broker_offline`；本机日志有同一会话的 FTMO-Demo 断线 | 原生终端当前离线，插件未把 MCP 成功误报为全部连接成功。未见足以证明封禁、错误密码或服务端限制的日志。 |
| Python IPC | `account_info` 返回 `result=null`、`last_error=[-10004,"No IPC connection"]`；随后真实 Agent 经受管 `mt5_trade` 尝试一次初始化仍得到 IPC timeout（后者为主任务转述） | 已不只是“尚未调用 initialize”。本地 Python 与指定终端未建立可用 IPC；具体 timeout 原因尚需修复后的单次受管复验。 |
| Python 版本 | 返回模块版本 `5.0.6231`，终端 build 6230；本插件安装脚本亦固定 5.0.6231 | 当前失败证据不是版本拒绝；不能仅凭这两个数字不同要求降级或重装。官方版本错误码与 IPC 错误分别列出。[官方 last_error](https://www.mql5.com/en/docs/python_metatrader5/mt5lasterror_py) |
| 算法交易权限 | `experts_trade_allowed=false`、`mcp_trade_allowed=true`；本机 `common.ini` 的 Experts Enabled=0；当前进程由 `connect_*.ini` 启动 | 只连接启动代码明确关闭 EA 算法交易，这是已存在的启动行为。不能与券商连接混为一谈，也不能据此推断全部 MCP 读能力失效。最近 `start_if_needed:false` 的核验没有执行启动分支。 |
| 启动模式 | 只读进程检查确认 `D:/MT5/terminal64.exe` 当前有 `/portable` 参数；该会话日志数据根为 `D:/MT5`；Python 初始化原代码没有传 portable | 模式传递不一致是确定的代码缺陷；可能影响初始化找到的终端数据目录/启动模式，是否导致这次 timeout 尚未实机验证。 |

账户、密码、MCP token、IP、社区用户名均未写入此报告。仅检查了现有文件和进程，未输出完整进程命令行。

## 最近终端日志

原始文件：[20261020.log](D:/MT5/logs/20261020.log)。该文件早先读取时为 0 字节，在诊断期间落盘；以随后取得的新内容为准，最后观察到文件修改时间为 `2026-10-20T08:14:46.1698159Z`。

- 第 11262 行，02:01:52.188：FTMO-Demo 连接丢失。
- 第 11270 行，02:01:54.758：重新授权成功。
- 第 11274 行，02:01:55.583：重新同步品种及账户；第 11275 行确认模拟账户允许交易。
- 第 11527 行，02:04:58.828：FTMO-Demo 再次连接丢失；本次读取到的后续 Network 记录未见再次成功授权。
- 文件内另有周期性 `MQL5.community authorization failed`，属于社区服务。不能把它当作 FTMO 账户授权失败。

前一文件 [20261019.log](D:/MT5/logs/20261019.log:31494) 第 31494—31498 行显示当前会话从插件 `connect_*.ini` 启动；第 31506 行成功连接 FTMO-Demo，第 31510—31511 行同步并确认模拟账户交易可用。这说明它曾正常连接，不证明最新状态仍在线。日志缺少再次断线的底层原因，因此“网络/券商接入层断线”是现象归类，不是已证明的根因。

## 连接链路核对

- [connect.js](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/connect.js:125) 在 MCP 认证成功后，只轮询原生 `get_trading_account_info` 的 `server_connected`；到期返回 `broker_offline`。它不初始化 Python，也不会通过此路径重放交易。第 107 行启动终端时已经依据 `native.dataDirectory` 与 `native.directory` 的规范化路径是否相同传递便携模式。
- [auto-connect.js](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/auto-connect.js:30) 遇到终端准备中、Agent/原生任务忙碌时让出；恢复复用同一连接逻辑，失败有退避。它不是 Python 自动初始化器。
- [process.js](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/process.js:53) 只启动 Python worker 并转发所选调用。普通 `account_info` 不会隐式初始化；账户配置只传给 `initialize/login`。[python-worker.py](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/python-worker.py:90) 只在明确的 initialize 请求中调用 SDK 初始化。
- [official.js](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/official.js:140) 将 initialize/login 归入 trading 权限，由现有 `mt5_trade` 路由处理；不是再发一次 `mt5_connect` 就能修复 Python。第 130 行配置更新会销毁旧 Python worker，之后也需要独立建立 IPC。
- [trading-context.js](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/tools/trading-context.js:69) 已把已确认的 -10004 映射为 `MT5_PYTHON_UNAVAILABLE`，失败后不继续排队读取其他账户数据。恢复需要先核对同一账户，再开始新的工作流；本诊断没有替真实 Agent 执行业务。

## 已完成的最小修复

仅修改两个运行文件及一个现有测试文件：

1. `backend/process.js`：仅对 initialize 请求，把实际选定的 `resolve(native.dataDirectory) === resolve(native.directory)` 作为内部 `portable` 布尔传给 worker。
2. `backend/python-worker.py`：把该布尔传给官方 `mt5.initialize`。官方文档说明 portable 参数决定终端便携启动模式，省略时为 false；初始化也可能启动终端。[官方 initialize](https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py)
3. [mt5-python.test.js](E:/brief2great/sesame/sesame/plugins/api-v1/tests/mt5-python.test.js:45)：便携/独立 profile 双模式覆盖 Node 转发及真实 Python worker 的 SDK 参数；验证规范化后的相同目录、指定终端路径、指定账户、保存密码/显式密码路径、原 15000 ms 超时和正常结果传回。普通账户读取仍不初始化、不转发保存凭据。

没有增加外部工具参数、依赖或兼容分支，没有改变账户绑定或默认登录逻辑，没有新增自动重试，没有改算法交易开关。

验证：

- 先运行新增回归：5 项失败、1 项通过，失败直接显示 portable 未转发/未传入 SDK。
- 修复后 `mt5-python.test.js` 与 `mt5-connection-lifecycle.test.js` 共 **12 项通过**。
- `execution_guard_test.py` 共 **25 项通过**，包括受管订单的 worker 隔离测试；没有接触真实 MT5 或账户。
- `node --check backend/process.js` 与此次三个文件的 `git diff --check` 通过。

验证命令：

```text
node --import file:///E:/brief2great/sesame/mt5agent/modules/plugins/sdk-loader.js --test plugins/api-v1/tests/mt5-python.test.js plugins/api-v1/tests/mt5-connection-lifecycle.test.js
python -B -I plugins/optional-api-v1/tests/execution_guard_test.py
```

## 后续边界

由主任务待工作台空闲后更新最新插件，再让真实 Agent 按现有受管接口复验一次 Python 初始化及同一模拟账户身份。经纪商连接仍需独立检查；若再次 timeout，保留本次原生错误与新日志，不以重复启动、切换账户、自动开算法交易或反复发订单试探。不能将隔离测试通过等同于 FTMO 已恢复，亦不能宣称此修复已经解决全部 IPC timeout。

本任务未部署插件，未改工作区数据库/配置，未连接终端、获取行情或下单，未向工作台模型发送消息。
