# MT5 Python IPC 前置条件审查

本轮只读结论：12:25 的失败确认了 **Python IPC 不存在**，不证明终端 MCP 或券商离线。本轮没有执行初始化恢复，因而不能判定现在初始化仍会失败，也不能保证初始化会成功。没有发现 `memory_trading_context` 把临时 QA 限制保存为长期规则的证据。未修改产品、配置或业务；没有访问子任务 SQLite，没有连接终端、账户查询、初始化或登录。

## 本轮证据

仅检查主 WAL 中主会话定位信息与本轮 QA JSONL；历史初始化对照限定在 2026-10-20T08:03:02.802Z 之后。没有保留账户、凭据、完整业务正文或模型思考。

| UTC 时间 | 可确认事实 |
| --- | --- |
| 12:25:16.723 | `demo-trade-retest` 用户消息要求原账户 DEMO、连接与权限核验；禁止切账户、改风控、打开关闭的交易开关，并要求仍受阻时结束、不循环尝试。没有禁止同终端 Python 初始化。 |
| 12:25:43.553 | `memory_trading_context`：`risk_state=missing`、`complete=true`、`pending_risk_candidates=0`；`risk_rules/style/strategy_knowledge` 各 0 条，没有初始化/连接禁令文本。 |
| 12:25:43.554 | `manual_trade_inspect` 返回静态能力/策略说明。其实现不查询账户或连接，不构成 IPC 就绪证据。 |
| 12:26:09.813 → 12:26:13.898 | 唯一该快照请求为 `mt5_trading_context({action:"snapshot",history_days:1})`，工具报错：`MT5 Python account_info failed [-10004]: No IPC connection`。 |
| 12:26:13.899 | Agent 已读取最新 MT5 `TRADING.md`；返回文本包含独立 Python IPC 前置、初始化走 `mt5_trade`、快照不自动恢复，以及 `retryable:false` 的恢复说明。 |
| 12:27:03.052 | Agent 公共回复：“不会初始化连接、切换账户或修改开关。”上述调用链没有 `initialize` 或 `login`。 |

`demo-trade-retest.txt` 的“仍受阻则结束、不循环尝试”足以解释保守停止，但不等于用户禁止初始化。当前 `cold-history-retest.txt` 也没有“禁止 initialize/不主动连接或断开”的文字。在本次读取的 QA 用户文本与记忆回执中，没有找到该禁令的来源；不能确认是旧任务限制串入，或将模型自行作出的选择称为宿主权限拦截。

## 实现与口径

- `sesame/plugins/optional-api-v1/packages/mt5/backend/process.js:29` 的 `MT5Python.start()` 只启动长期 Python worker；`:54` 每次 `call()` 转交所请求的方法，不自动 `initialize`。worker/桌面重启后，旧进程内 IPC 不会因配置仍在而继承。
- `mt5/backend/python-worker.py:90` 只有显式 `initialize` 分支调用 `mt5.initialize(..., timeout=15000, portable=..., **configured_credentials)`；普通 `account_info` 直接调用该 API。初始化可能启动/连接终端并使用已配置账户，不能当作无副作用读取或偷偷登录。
- `mt5/tools/trading-context.js:87` 的快照先读 `account_info`，再核对身份和 `terminal_info.connected`；第一步失败立即停止。`:60` 将原生 `-10004` 区分为 `MT5_PYTHON_UNAVAILABLE`；真正已连 IPC 但 `terminal.connected=false` 是另一条失败路径。
- `portfolio-execution/service.js:30` 的 `manual_trade_inspect` 是静态描述。`portfolio-execution/adapters.js:64` 的真实 MT5 快照同样直接读 Python `account_info`，不初始化。`mt5/backend/providers.js:137` 的标准账户 provider 则使用 Terminal MCP `get_trading_account_info`。行情、标准账户 UI 与执行 Python IPC 并非同一个连接。
- `mt5/backend/official.js:140` 将 `initialize/login/order_send` 归为交易权限，`:175` 仍受现有 `allow_trading` 等限制；不能为恢复 IPC 打开用户关闭的开关或换通道绕过权限。
- 当前 `mt5/prompt.md:17`、`TRADING.md:37`、`capabilities.json:5176` 已说明独立 IPC 与正确初始化路由，故并非“接口完全没有告知前置”。但没有清楚说明新 worker/桌面重启后的首次使用流程。
- 确有文字不一致：`mt5/prompt.md:17` 允许同账户恢复核验后继续原任务；`TRADING.md:39`、`capabilities.json:5180`、`trading-context.js:70` 以及 portfolio adapter 的恢复文本统一要求“new workflow run”。主会话快照也会收到该措辞，可能误导为所有任务都必须重建。此处宜区分原主任务与已终止的冻结工作流，而非新增自动重试。

## 旧初始化错误必须另列

- 08:05:58.330 → 08:06:18.704：`mt5_trade` / Python `initialize`，`arguments:{}`；原生 `status=failed`、`result=false`、`last_error=[-10005,"IPC timeout"]`。
- 08:28:20.584 的后续 QA 用户文本明确要求对已载入的 portable 匹配修复重试一次；08:30:23.541 → 08:30:42.337 的实际 `initialize` 仍返回同样的 `-10005 IPC timeout`。
- 因而不能把所有失败归为“模型漏了 initialize”；早前确实发送了初始化但 SDK 没有完成握手。当前 `-10004` 是读取前置缺失，不能将早前 timeout 当作本轮初始化结果。读取的回执未返回 native portable 参数，参数传递的正确性由当前源码和隔离测试证明，不能声称本轮再次实测过该参数。

## 最小建议

1. 本轮先由真实工作台 Agent 在明确的 QA 授权下，用现有路由做至多一次**原终端、原配置账户、现有权限内**的 IPC 恢复；我们不代它执行。若初始化失败/结果未知或权限关闭，保留真实回执并停止，不循环尝试、不改开关、不切账户。初始化返回成功后仍必须重新核对实际账户、broker 连接和 DEMO 模式，不能把初始化成功当交易许可。
2. 优先补充提示词/usage：明确 Python worker 的会话生命周期；`retryable:false` 表示相同未恢复环境下不要重复快照，不表示永远禁止经过授权的显式 IPC 恢复；`manual_trade_inspect` 的静态能力说明不证明连接就绪。将“原任务可继续”和“新 workflow run”的适用范围统一。此次没有足够证据支持改成后台自动初始化、自动登录或自动重试。
3. 没有证据支持修改长期记忆行为或把模型的停机选择判定为产品权限 bug。

隔离验证：使用 fake MetaTrader5 module / mock bridge 的 `mt5-python.test.js` 与 `trading-context-read.test.js` 共 **15/15 通过**。覆盖 portable 两种模式、只在初始化时转发配置账户、普通读取不自动初始化、NoIPC 单次失败停止、账户不符、券商离线、取消和配置变化。没有触达真实 MT5。
