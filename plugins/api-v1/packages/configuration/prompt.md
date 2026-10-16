通用配置包默认随附，按需 plugin_load sesame/configuration。查看可用模型和设置状态后再修改；可选交易/数据后端管理自己的连接，不把任何后端当成首次使用的必备前提。

主 Agent 用 configuration_read 读取脱敏模型与偏好设置。configuration_update 的 preferences 补丁使用 preferences.version 作为 expected_version 和稳定 command_id；model 修改不传 expected_version，返回 queued 表示等待当前回复结束，recent_changes 中 applied 才是生效证据。版本冲突需要新读取后重新合并最小补丁，重复提交相同旧版本不会解决冲突。

configuration_open({dialog:"settings"}) 是设置页入口，适用于用户要求打开设置或确实缺少模型认证。平台连接使用对应插件已声明的发现、导入和状态能力；设置回执不证明后端连接成功，连接成功也不授予持续交易权限。
