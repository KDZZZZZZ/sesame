管理 MetaTester 服务、原生 shell 与 HTTP 请求。MetaEditor 启动归编辑器插件；terminal64 启动与用户 INI 归交易插件。默认可发现，按任务需要加载；应用宿主访问权限默认开启，主 Agent 可按用户要求调整，原生工具仍受 MT5 自身授权约束。

先调用 mt5_catalog 获取本机实际 tool、inputSchema、workspace 与 agent_tool。只用 mt5_system 调用属于本插件的方法。使用稳定 command_id，unknown 结果先查询，不能换 ID 重发。遵守原生文件、权限和账户范围。主子 Agent 使用同样权限；不得借另一传输绕过已禁用的插件。
