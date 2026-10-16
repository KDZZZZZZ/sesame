---
name: configure-application
description: Read and update application model and preference settings through the host configuration tools.
---

先用 configuration_read 读取当前版本及脱敏配置。根据用户请求提供最小 changes，使用稳定 command_id 调用 configuration_update。修改 preferences 时传入刚读取的 preferences.version 作为 expected_version；版本冲突时重新读取，用新的 command_id 重试。修改 model 不传 expected_version。密钥在 configuration_open 打开的设置界面填写，不要求用户在普通工具参数里提供。平台连接由已加载平台插件的配置工具负责。

配置账户页时，先通过对应插件配置或复用连接，再将插件给出的精确引用保存到 preferences：changes.account_view.source = { provider: { pluginId, providerId }, connection: { id, revision }, accountId? }。连接不需要显式引用的提供方才可以省略 connection；不要推测连接 ID、修订或账户。只有一个账户时应用会自动选中，多个账户需根据用户意图选择。此步骤不需要先创建行情图，纯账户插件也可使用。

account_view.sources 可保存最多 32 个可切换连接，每个引用可带该连接的 accountId；source 会自动加入此列表。仅保存必要的提供方/连接/账户引用，不传地址、密钥或其他配置。省略 sources 保留已存连接；source: null 清除当前选择。语言和账户偏好独立合并，应用重启或切换浏览器地址后仍然生效。
