---
name: configure-application
description: Read and update application model and preference settings through the host configuration tools.
---

先用 configuration_read 读取当前版本及脱敏配置。根据用户请求提供最小 changes，使用稳定 command_id 与 expected_version 调用 configuration_update。版本冲突时重新读取，不覆盖并发修改。密钥在 configuration_open 打开的设置界面填写，不要求用户在普通工具参数里提供。平台连接由已加载平台插件的配置工具负责。
