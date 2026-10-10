---
name: connection
description: Configure and verify an MT5 terminal account without exposing credentials or replaying trading commands.
---

新可选安装不自动读取原生连接文件。需要复用本机配置时，先 inspect，再在明确配置任务中使用 mt5_update_configuration 的 import_native 或用户直接提供的配置引用；随后核验具体账户。

先用 mt5_dependencies inspect 检查并复用已有配置；缺项读取 dependencies skill，按需下载到插件私有目录，不启动第二个终端代替发现。再用 mt5_settings 查看脱敏连接、账号、版本及待导入引用。用户直接粘贴的官方 MCP 导出会由插件提取，密钥保存在插件私有文件；使用 mt5_import_configuration 传 source_message_id、expected_version 与稳定 command_id，随后 mt5_connect 核验。不要把明文密钥写入工具参数、脚本或报告。

普通选项用 mt5_update_configuration 修改。保留现有账号，自动重连不代表获准重放交易。connected 只证明 Terminal 和绑定账户通过核验；MetaEditor、Python IPC、Tester 和交易权限均要分别核实。mt5_catalog 返回每个方法自身 inputSchema；各组工具维持自己的业务参数，不绕过目录和权限。
