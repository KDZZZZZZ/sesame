---
name: connection
description: Configure and verify an MT5 terminal account without exposing credentials or replaying trading commands.
---

公开资源定位：本包路径以插件根目录为准；[完整接口契约](../../INTERFACES.md) 可由 plugin_read({pluginId:"sesame/mt5",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。

安装/加载插件本身不导入原生连接文件。连接能力的目标是复用用户选定的终端和账户，并取得各通道的真实就绪证据。已有配置、可导入引用和缺失依赖都有公开入口；无需查看插件或本体源码。

- mt5_settings 返回已有脱敏连接、账户绑定、版本与 pendingImports；mt5_dependencies inspect 返回已知路径、missing 和安装资源。现有连接可直接由 mt5_connect 核验；有限路径发现未命中，不证明远程 MCP 不可用。只有实际缺项需要补充已有路径，任务相关的 host_files 查询是可选诊断手段，不是每次连接的前置步骤。
- mt5_connect 使用已保存连接；已有本机配置可用 mt5_update_configuration 的 changes:{import_native:true} 导入。沿用用户已选 endpoint、账户和明确禁用状态；多个安装或账户不能静默择一切换。需要更换目标但意图不明确时，只确认该目标。
- 若有 pendingImports，直接用 mt5_import_configuration 传 source_message_id、expected_version 与稳定 command_id。仅当已保存配置、本机可读配置与待导入引用都不能提供有效凭据时，请用户从 MT5「工具 → 选项 → MCP」复制当前连接导出发给 Sesame。原生加密 API Key 不能解密为 Bearer；不要反复猜密钥。用户粘贴的官方 MCP JSON/TOML 由插件提取，Agent 使用引用导入保存，不把明文密钥重写进普通工具参数、脚本或报告，不要求用户在 Sesame 设置中再填一遍。
- mt5_connect 验证精确账户；mt5_catalog 独立给出 MetaEditor 可调用状态。MCP 连接不等于券商登录；先复用 MT5 保存的账户会话，检查其连接状态。普通行情与账户查询不因此索要密码。真实本地 Tester 使用独立进程，需 login/server/password；先看 settings.account.password_configured，不能把主终端已登录当作 Tester 凭据齐全。

## 回测账户凭据

确实需要 Tester 或用户要求配置账户且 password_configured 为 false 时，只向用户索取缺少的内容。已绑定正确 login/server 时，请用户直接发送一行 `MT5 password: 用户自己的密码`；改变账户或尚未绑定时，使用 `{"mt5Account":{"login":"账户数字字符串","server":"券商服务器","password":"用户自己的密码"}}`。这是用户输入格式，不是工具参数：只接收用户在主会话直接发送的内容，插件会在入库及送给模型前隐藏密码并返回 source_message_id。不要让用户发无标记的裸密码；不要由 Agent 将已见到的密码重抄成 JSON、脚本、命令或报告。

mt5_import_configuration 的 expected_version 来自当前 mt5_settings，source_message_id 来自 pendingImports；导入结果的账户和 password_configured 是配置完成证据。单行格式固定绑定接收时的账户；如果账户已改变，不能把引用套到新账户，应按用户目标重新取得明确配置。导入走正常持久化与内存更新，立即可供 Tester 使用，不需要禁用/挂载插件、rollback、改 connection.json 或重启应用。普通 mt5_update_configuration 不接受 password，重复保存 login/server 不会配置密码；看到版本冲突先重新读取，不把失败当成功。

同一引用和 command_id 的重试幂等；引用默认 24 小时有效，用后删除。导入只保存，不登录、不启动终端、不代表交易授权；连接与真实 Tester 分别需要其自身就绪证据。如果供应商还需 GUI 授权，只请用户完成无法由现有接口完成的原生步骤。不要从 MT5 的加密密码库猜测或解密凭据。

普通选项用 mt5_update_configuration 修改。保留现有账号，自动重连不代表获准重放交易。connected 只证明 Terminal 和绑定账户通过核验；MetaEditor、Python IPC、Tester 和交易权限均要分别核实。mt5_catalog 返回每个方法自身 inputSchema；各组工具维持自己的业务参数，不绕过目录和权限。
