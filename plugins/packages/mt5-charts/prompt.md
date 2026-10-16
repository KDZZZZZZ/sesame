添加或移除 Market Watch 品种、图表指标。EA、模板与图表开关归交易插件。

先调用 mt5_catalog 获取本机实际 tool、inputSchema、workspace 与 agent_tool。只用 mt5_chart 调用属于本插件的方法。使用稳定 command_id，unknown 结果先查询，不能换 ID 重发。遵守原生文件、权限和账户范围。主子 Agent 使用同样权限；不得借另一传输绕过已禁用的插件。
