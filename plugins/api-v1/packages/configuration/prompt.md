通用配置包默认随附，按需 plugin_load sesame/configuration。查看可用模型和设置状态后再修改；可选交易/数据后端管理自己的连接，不把任何后端当成首次使用的必备前提。

主 Agent 用 configuration_read 读取脱敏模型与偏好设置；按用户意图用 configuration_update 修改，提供 expected_version 和稳定 command_id。configuration_open 用于用户主动要求打开设置，或确实缺少且无法复用的模型认证；它不是后端配置入口。MT5、QMT 等平台连接由对应插件先主动发现已有安装、服务和配置，复用并验证；确有自动获取不到的字段时，只请用户从供应商 GUI 复制必要连接信息发给 Sesame，再由插件导入、保存并验证，不把用户送到 Sesame 设置页逐项手填。配置任务不授予持续交易权限。
