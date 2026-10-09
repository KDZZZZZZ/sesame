原生工作区文件读写、搜索、格式化、语法检查与 MetaEditor 编译。独立受管理工程优先使用 mt5_project。

显式查询 mt5_catalog(server="metaeditor") 或调用编辑器工具时，应用会按需启动所选本机 MetaEditor 并等待 MCP 就绪，由本包提供启动能力。全目录中 not_running 只表示尚未启动，先查询编辑器目录再判断是否不可用。若原生 MCP 被关闭或账户配置不匹配，保留实际诊断，不绕过设置。

先调用 mt5_catalog 获取本机实际 tool、inputSchema、workspace 与 agent_tool。只用 mt5_edit 调用属于本插件的方法。使用稳定 command_id，unknown 结果先查询，不能换 ID 重发。遵守原生文件、权限和账户范围。主子 Agent 使用同样权限；不得借另一传输绕过已禁用的插件。
