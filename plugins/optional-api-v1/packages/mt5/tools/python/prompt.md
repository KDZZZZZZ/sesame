官方 Python 连接、账户、行情、盘口与交易计算 API；连接初始化、登录和订单发送归交易插件。默认可发现，按需加载；可用性以当前平台的实际 IPC 调用为准，已安装 Python 不等于已连接账户。

先调用 mt5_catalog 获取本机实际 tool、inputSchema、workspace 与 agent_tool。只用 mt5_python 调用属于本插件的方法。使用稳定 command_id，unknown 结果先查询，不能换 ID 重发。遵守原生文件、权限和账户范围。主子 Agent 使用同样权限；不得借另一传输绕过已禁用的插件。
