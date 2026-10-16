---
name: mt5-official
description: Use the explicit native MT5 catalog and exact routed methods; distinguish command receipts, broker observations, native charts and Sesame presentation.
---

公开资源定位：本包路径以插件根目录为准；[完整接口契约](../../INTERFACES.md) 可由 plugin_read({pluginId:"sesame/mt5",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。

mt5_catalog({server,query?})是当前版本官方方法的声明入口，返回{checked_at,items:[{server,status,reason,workspace,tools}]}。每个tool含name/description/inputSchema/agent_tool/callable/blocked_reason；原生工具随版本变化，按目录定义使用，不猜旧方法名。MCP握手已取得workspace读写根；原生拒绝权限/路径时不换传输绕过。

路由调用形状为{server,tool,arguments,command_id,save_as?}。command_id稳定16–128字符，同一动作沿用；save_as将完整JSON写任务工作区并返回saved_to。结果status=returned/failed/unknown：returned只是收到响应，仍须读isError、retcode或实际Tester状态；unknown不重新提交，用mt5_command({command_id})与原生只读状态核对。

Sesame工作台行情经data-access/canvas公开能力，终端原生chart_*经mt5_chart；两者不是同一显示面。marketdata是独立MetaTrader.com服务，不是terminal券商行情的前置。history、连接配置和渲染各有独立证据。

mt5_project提供版本化本地工程，mt5_compile冻结源码/SDK/编译产物，mt5_backtest管理真实Tester并关联任务与pass，mt5_deployment管理精确成功构建。直接调用原生编辑器/Tester方法时保留其返回的真实run_id，不能把最后一个报告归到别的工程。付费Cloud/Signals/Market/VPS不由普通研究任务隐式启用。

Python工具只提供已列明官方API，不执行任意代码。initialize/login可能启动或切换终端，归交易路由；普通读取可复用既有IPC。shutdown关闭产品IPC，不结束终端。时间ISO需明确时区，ticket/magic/position用十进制文本；order_check通过不是order_send成交。launcher只提供已声明白名单启动/管理功能；启动回执不是账户/交易成功。

INTERFACES.md列出全部包装能力的确切形状与恢复边界；TRADING.md列出订单路径和最终执行保护。官方参考：[MCP能力](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/capabilities)、[Python API](https://www.mql5.com/en/docs/python_metatrader5)、[MetaEditor集成](https://www.metatrader5.com/en/metaeditor/help/beginning/integration_ide)。
