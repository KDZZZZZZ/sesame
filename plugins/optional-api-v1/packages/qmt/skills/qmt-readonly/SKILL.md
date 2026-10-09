---
name: qmt-readonly
description: Discover and reuse authorized Windows MiniQMT configuration, prepare missing SDK dependencies explicitly, and read mainland stock market/account data without trading.
---

# QMT 只读工作流

1. 先 `qmt_environment {action:"inspect"}`，读取已保存配置、`QMT_PYTHON`、现有 Python 路径和私有环境。可用 host-files 查看当前 MiniQMT 配置、已有 MCP/CLI 接口。不要猜账号/覆盖配置，也不要为发现路径另开一个交易终端。
2. 前提是 Windows x64、券商提供且已授权/登录的 MiniQMT，以及兼容的 x64 Python。macOS/Linux 本机不能靠 pip 获得 Windows 原生 QMT。券商的终端程序与授权应按该券商官方渠道取得；本包不携带终端、凭据或下载链接替代券商授权。
3. 对已有 Python 显式 `qmt_environment {action:"verify",python_path:"C:\\...\\python.exe"}`。这一步只验证真实 SDK 导入，不证明终端连接或账户权限。若已有兼容环境，直接复用；不要为了版本一致升级或降级用户环境。
4. 仅确认 SDK 缺失后，显式 `prepare` 并给稳定 `operation_id` 与现有 Windows CPython 3.12 x64 路径。它再次尝试复用，然后只在插件数据目录创建 venv，以固定 PyPI HTTPS wheel、版本和 SHA-256 安装。不会改全局 Python、启动终端或自动登录。失败/取消可能留下未完成的专有目录；inspect 给出私有根，在确认无执行进程后只移除那次未完成目录即可。
5. `qmt_configure` 使用 inspect 返回的 `expected_version`。记录实际 `python_path`、`userdata_directory`（现有 `userdata_mini`）、`account_id`、券商名、实际 `market_port`。行情限定 localhost 固定端口，不自动跳到另一终端。`sector` 是已有 MiniQMT 本地板块名，默认沪深京A股；只有终端真实存在的股票目录可用。需要更新板块数据时明确使用现有终端的补充功能，不在普通读取中暗中下载。
6. `qmt_read search/describe/quotes` 验证行情；`asset/positions` 验证该 STOCK 账户只读访问。失败时报告连接/授权/SDK原始错误，不能输出空数组冒充成功。只支持大陆股票持仓；遇到债券、基金、港股或其他品种，provider 明确不支持，勿按股数/CNY强制转换。
7. `qmt_read orders/fills` 保留原生当日记录。整数单号和浮点数用文本保存，时间单位与回报 `price_type` 不猜测；不要当成多日历史、完整事件账本或可解释 SVL 运行。此插件无下单、撤单、资金划拨和策略执行入口。

工具准备环境与查询是固定的可信 SDK 适配器，执行于当前用户本机，具有进程树取消。它不接受任意 Python 代码，也不充当策略沙箱。会话结束只停止这次 API/Python 进程，保留 MiniQMT 应用与用户交易。

官方依据：[快速开始](https://dict.thinktrader.net/nativeApi/start_now.html)、[行情](https://dict.thinktrader.net/nativeApi/xtdata.html)、[账户与查询](https://dict.thinktrader.net/nativeApi/xttrader.html)、[XtQuant PyPI](https://pypi.org/project/xtquant/250807.1.2/)。目录/SDK导入可验证与真实券商 Windows 集成成功是不同的验证范围。
