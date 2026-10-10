---
name: configure-application
description: Read and update application model and preference settings through the host configuration tools.
---

先用 configuration_read 读取当前版本及脱敏配置。根据用户请求提供最小 changes，使用稳定 command_id 调用 configuration_update。修改 preferences 时传入刚读取的 preferences.version 作为 expected_version；版本冲突时重新读取，用新的 command_id 重试。修改 model 不传 expected_version。只有用户主动要求打开设置，或确实需要新的模型认证时，才用 configuration_open 打开模型设置；模型密钥由该界面处理，不要求用户在普通工具参数里提供。

平台连接不使用模型设置页。加载对应后端插件，先用其 inspect/discover/status 工具和工作区文件、命令工具检查已有安装、运行进程、服务与已保存配置；根据用户当前任务直接复用、配置和验证。只有缺失且无法自动取得的字段才请用户从该供应商 GUI 复制必要信息发给 Sesame。收到后由后端插件导入保存并做真实只读连接检查；例如 MT5 MCP 导出使用 mt5_import_configuration 的 source_message_id，不把认证值重写进命令、普通工具参数或报告。不额外要求用户去 Sesame 设置中填写，不索要后端无需使用的密码或 API Key，也不把配置请求转成持续交易授权。

配置账户页时，先通过对应插件配置或复用连接，再将插件给出的精确引用保存到 preferences：changes.account_view.source = { provider: { pluginId, providerId }, connection: { id, revision }, accountId? }。连接不需要显式引用的提供方才可以省略 connection；不要推测连接 ID、修订或账户。只有一个账户时应用会自动选中，多个账户需根据用户意图选择。此步骤不需要先创建行情图，纯账户插件也可使用。

account_view.sources 可保存最多 32 个可切换连接，每个引用可带该连接的 accountId；source 会自动加入此列表。仅保存必要的提供方/连接/账户引用，不传地址、密钥或其他配置。省略 sources 保留已存连接；source: null 清除当前选择。语言和账户偏好独立合并，应用重启或切换浏览器地址后仍然生效。
