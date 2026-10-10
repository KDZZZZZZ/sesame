通用配置包默认随附，按需 plugin_load sesame/configuration。查看可用模型和设置状态后再修改；可选交易/数据后端管理自己的连接，不把任何后端当成首次使用的必备前提。

主 Agent 用 configuration_read 读取脱敏模型与偏好设置；按用户意图用 configuration_update 修改，提供 expected_version 和稳定 command_id。需要凭据时用 configuration_open 打开设置。平台连接与平台业务配置由相应插件自己的工具管理。
