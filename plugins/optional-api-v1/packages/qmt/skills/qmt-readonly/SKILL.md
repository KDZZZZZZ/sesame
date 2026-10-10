---
name: qmt-readonly
description: Discover and reuse authorized Windows MiniQMT configuration, prepare missing SDK dependencies explicitly, and read mainland stock market/account data; submit limit orders only after an explicit user trading request.
---

# QMT 只读工作流

1. 先 `qmt_environment {action:"inspect"}`，读取已保存配置、`QMT_PYTHON`、现有 Python 路径和私有环境。可用 host-files 查看当前 MiniQMT 配置、已有 MCP/CLI 接口。不要猜账号/覆盖配置，也不要为发现路径另开一个交易终端。
2. 前提是 Windows x64、券商提供且已授权/登录的 MiniQMT，以及兼容的 x64 Python。macOS/Linux 本机不能靠 pip 获得 Windows 原生 QMT。券商的终端程序与授权应按该券商官方渠道取得；本包不携带终端、凭据或下载链接替代券商授权。
3. 对已有 Python 显式 `qmt_environment {action:"verify",python_path:"C:\\...\\python.exe"}`。这一步只验证真实 SDK 导入，不证明终端连接或账户权限。若已有兼容环境，直接复用；不要为了版本一致升级或降级用户环境。
4. 仅确认 SDK 缺失后，显式 `prepare` 并给稳定 `operation_id` 与现有 Windows CPython 3.12 x64 路径。它再次尝试复用，然后只在插件数据目录创建 venv，以固定 PyPI HTTPS wheel、版本和 SHA-256 安装。不会改全局 Python、启动终端或自动登录。失败/取消可能留下未完成的专有目录；inspect 给出私有根，在确认无执行进程后只移除那次未完成目录即可。
5. `qmt_configure` 使用 inspect 返回的 `expected_version`。记录实际 `python_path`、`userdata_directory`（现有 `userdata_mini`）、`account_id`、券商名、实际 `market_port`。行情限定 localhost 固定端口，不自动跳到另一终端。`sector` 是已有 MiniQMT 本地板块名，默认沪深京A股；只有终端真实存在的股票目录可用。需要更新板块数据时明确使用现有终端的补充功能，不在普通读取中暗中下载。
6. `qmt_read search/describe/quotes` 验证行情；`asset/positions` 验证该 STOCK 账户只读访问。失败时报告连接/授权/SDK原始错误，不能输出空数组冒充成功。只支持大陆股票持仓；遇到债券、基金、港股或其他品种，provider 明确不支持，勿按股数/CNY强制转换。
7. `qmt_read orders/fills` 保留原生当日记录。整数单号和浮点数用文本保存，时间单位与回报 `price_type` 不猜测；不要当成多日历史、完整事件账本或可解释 SVL 运行。标准 orders/fills 因原生时间单位未核实而不声明/明确不支持；原生查询只覆盖当日，历史range不支持；不支持完整账本或账户事件流。

工具准备环境与查询是固定的可信 SDK 适配器，执行于当前用户本机，具有进程树取消。它不接受任意 Python 代码，也不充当策略沙箱。会话结束只停止这次 API/Python 进程，保留 MiniQMT 应用与用户交易。

官方依据：[快速开始](https://dict.thinktrader.net/nativeApi/start_now.html)、[行情](https://dict.thinktrader.net/nativeApi/xtdata.html)、[账户与查询](https://dict.thinktrader.net/nativeApi/xttrader.html)、[XtQuant PyPI](https://pypi.org/project/xtquant/250807.1.2/)。目录/SDK导入可验证与真实券商 Windows 集成成功是不同的验证范围。

## 日线与明确授权的股票操作

手动交易接口逐项见 TRADING.md。qmt_command 只读取已有下单/撤单回执；不重放请求。qmt_order 的 execution_guard 在原生进程启动后、报单前复核源报价、账户、可用持仓与决策时效；配合独立 manual-trading 插件记录模型决策延迟，默认 M5+。只有日线行情不代表提供分钟历史，本插件也不提供改单/市价单/自动挂载。

优先通过 market provider `bars.history`/`bars.subscribe` 使用已有未复权D1数据（session regular、priceBasis last、adjustment none）。若缺本地历史，向用户说明后显式 `qmt_download_history {symbol,start:YYYYMMDD,end:YYYYMMDD}`；普通查询不会下载。当前日使用原生时间/OHLC形成中柱，1秒是目标轮询间隔，不是1秒K线。分钟周期与未验证volume单位不猜测。

仅主Agent收到明确用户交易请求后使用 `qmt_order`：user_authorized=true、精确account_id/connection_revision、symbol、buy或sell、正整数shares与正Decimal限价。先读账户、持仓availableQuantity、报价与品种实际规则；可卖量不等于允许当天新买卖出，T+1/涨跌停/数量步长/时段/权限由券商真实检查。不要保证成交。调用结果submitted只表示订单编号已返回。unknown或取消/超时可能已送达，保持原operation_id读取既有记录，不自动重报，也不要换ID规避。对照原生当日orders/fills和remark人工确定后才能做新的用户意图。

撤单使用独立operation_id并引用原qmt_order的original_operation_id/order_id，精确账户/版本不变；native记录remark必须匹配。原请求超时也可按 TRADING.md 用保留的原始意图恢复，但只能撤唯一且精确匹配的活动订单，原生进程会再次核对账户、品种、方向、数量、标记和单号。旧unknown记录缺少原始意图时留给终端核对，不绕过检查。cancel_requested仅表示请求已受理，随后查询确认；不能当已撤或零成交。不得调用任意交易脚本或资金划拨，不对回测/安装请求隐含交易授权。
