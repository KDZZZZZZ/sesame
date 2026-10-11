---
name: connection
description: Configure and verify an MT5 terminal account without exposing credentials or replaying trading commands.
---

安装/加载插件本身不导入原生连接文件；用户要求连接或使用 MT5 后，主动完成发现、配置和验证，不再让用户重复确认同一项配置任务，也不调用 configuration_open 打开 Sesame 设置。

1. 用 mt5_dependencies inspect 和 mt5_settings 读取已有路径、脱敏连接、账户绑定、版本与待导入引用。发现范围有限；路径未找到或不唯一时，用 host_files 检查已有应用、运行进程的可执行文件路径及相关 Wine prefix，再按 dependencies skill 保存准确路径。不要为发现配置另开一个终端，也不把探测失败直接当成缺失依赖。
2. 已保存连接先 mt5_connect；已有本机配置可用 mt5_update_configuration 的 changes:{import_native:true} 导入。沿用用户已选 endpoint、账户和明确禁用状态；多个安装或账户不能静默择一切换。需要更换目标但意图不明确时，只确认该目标。
3. 若有 pendingImports，直接用 mt5_import_configuration 传 source_message_id、expected_version 与稳定 command_id。仅当已保存配置、本机可读配置与待导入引用都不能提供有效凭据时，请用户从 MT5「工具 → 选项 → MCP」复制当前连接导出发给 Sesame。原生加密 API Key 不能解密为 Bearer；不要反复猜密钥。用户粘贴的官方 MCP JSON/TOML 由插件提取，Agent 使用引用导入保存，不把明文密钥重写进普通工具参数、脚本或报告，不要求用户在 Sesame 设置中再填一遍。
4. 随后 mt5_connect 验证精确账户，MetaEditor 用 mt5_catalog 独立验证。MCP 连接不等于券商登录；先复用 MT5 保存的账户会话，检查其连接状态。普通行情与账户查询不因此索要密码。真实本地 Tester 使用独立进程，需 login/server/password；先看 settings.account.password_configured，不能把主终端已登录当作 Tester 凭据齐全。

## 回测账户凭据

确实需要 Tester 或用户要求配置账户且 password_configured 为 false 时，只向用户索取缺少的内容。已绑定正确 login/server 时，请用户直接发送一行 `MT5 password: 用户自己的密码`；改变账户或尚未绑定时，使用 `{"mt5Account":{"login":"账户数字字符串","server":"券商服务器","password":"用户自己的密码"}}`。这是用户输入格式，不是工具参数：只接收用户在主会话直接发送的内容，插件会在入库及送给模型前隐藏密码并返回 source_message_id。不要让用户发无标记的裸密码；不要由 Agent 将已见到的密码重抄成 JSON、脚本、命令或报告。

收到引用后先读取当前版本，再 mt5_import_configuration 导入，核验返回的账户和 password_configured。单行格式固定绑定接收时的账户；如果账户已改变，不能把引用套到新账户，应按用户目标重新取得明确配置。导入走正常持久化与内存更新，立即可供 Tester 使用，不需要禁用/挂载插件、rollback、改 connection.json 或重启应用。普通 mt5_update_configuration 不接受 password，重复保存 login/server 不会配置密码；看到版本冲突先重新读取，不把失败当成功。

同一引用和 command_id 的重试幂等；引用默认 24 小时有效，用后删除。导入只保存，不登录、不启动终端、不代表交易授权；随后按任务分别验证连接与真实 Tester。如果供应商还需 GUI 授权，只请用户完成无法由现有接口完成的原生步骤。不要从 MT5 的加密密码库猜测或解密凭据。

普通选项用 mt5_update_configuration 修改。保留现有账号，自动重连不代表获准重放交易。connected 只证明 Terminal 和绑定账户通过核验；MetaEditor、Python IPC、Tester 和交易权限均要分别核实。mt5_catalog 返回每个方法自身 inputSchema；各组工具维持自己的业务参数，不绕过目录和权限。
