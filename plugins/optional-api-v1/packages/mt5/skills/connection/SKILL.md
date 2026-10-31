---
name: connection
description: Configure and verify an MT5 terminal account without exposing credentials or replaying trading commands.
---

公开资源定位：本包路径以插件根目录为准；[完整接口契约](../../INTERFACES.md) 可由 plugin_read({pluginId:"sesame/mt5",part:"resource",path:"INTERFACES.md"}) 读取。此引用给出位置，无需每次调用前重复读取。

安装/加载插件本身不导入原生连接文件。连接能力的目标是复用用户选定的终端和账户，并取得各通道的真实就绪证据。已有配置、可导入引用和缺失依赖都有公开入口；无需查看插件或本体源码。

- mt5_settings 返回已有脱敏连接、账户绑定、版本与 pendingImports；mt5_dependencies inspect 返回已知路径、missing 和安装资源。现有连接可直接由 mt5_connect 核验；有限路径发现未命中，不证明远程 MCP 不可用。只有实际缺项需要补充已有路径，任务相关的 host_files 查询是可选诊断手段，不是每次连接的前置步骤。
- 打开本机终端使用主 Agent 能力 mt5_start_terminal({command_id:"open-selected-terminal-01"})，无需 MCP 密钥、Python、动态方法目录或自行构造 shell 命令。目标来自插件已选安装，自动保持原数据目录模式，不传新账号/profile/自定义 INI。原 profile 可能恢复已有 EA，所以沿用启动权限；权限拒绝不能通过其他传输绕过。returned/result.status=spawned 只是系统接收启动请求；MCP、券商及账户仍由 mt5_connect({command_id:"verify-started-terminal-01",start_if_needed:false}) 核验。原 ID 的 returned/unknown 回执不会重复启动；unknown 先读 mt5_command 并核对实际状态，缺安装按 mt5_dependencies inspect 的结果处理。
- mt5_connect 使用已保存连接；已有本机配置可用 mt5_update_configuration 的 changes:{import_native:true} 导入。沿用用户已选 endpoint、账户和明确禁用状态；多个安装或账户不能静默择一切换。需要更换目标但意图不明确时，只确认该目标。
- 用户已提供 MCP API Key、账户密码或 MetaTester 代理密码时，mt5_update_configuration 可直接保存 servers.<terminal|metaeditor|marketdata>.token、account.password、tester_agent.password。expected_version来自mt5_settings；凭据只传配置能力，不写进脚本、报告或长期记忆。省略字段保留现有值，空字符串清除；更换连接地址或账户身份会清除对应旧凭据，必要时同次提供新值。配置立即生效，不需要重启、重新挂载或让用户填写设置页。
- pendingImports 是可选快捷入口；若宿主已提取凭据，直接用 mt5_import_configuration 传 source_message_id、expected_version 与稳定 command_id，复用已有信息。没有引用时直接配置，不要求用户为产生引用而重新发送或转换格式。仅缺少有效凭据时询问对应值；用户也可选择从 MT5「工具 → 选项 → MCP」复制连接导出。原生加密 API Key 不能解密为 Bearer，不反复猜密钥。
- mt5_connect 验证精确账户；mt5_catalog 独立给出 MetaEditor 可调用状态。MCP 连接不等于券商登录；先复用 MT5 保存的账户会话，检查其连接状态。普通行情与账户查询不因此索要密码。真实本地 Tester 使用独立进程，需 login/server/password；先看 settings.account.password_configured，不能把主终端已登录当作 Tester 凭据齐全。

## 回测账户凭据

确实需要 Tester 或用户要求配置账户且 password_configured 为 false 时，只向用户索取缺少的内容。用户已提供密码时，直接用 mt5_update_configuration 的 changes.account.password 保存；login/server 已正确绑定时可省略。改变账户时同次传入明确的 login、server、password。不要让用户为配置再提供导出文件或重复填写密码。

用户可选发送 `MT5 password: 用户自己的密码` 或 `{"mt5Account":{"login":"账户数字字符串","server":"券商服务器","password":"用户自己的密码"}}`，宿主会提取并隐藏密码；此时 mt5_import_configuration 复用 pendingImports 中的 source_message_id。单行格式固定绑定接收时的账户，账户已改变时不能套用旧引用。直接配置和引用配置共用正常持久化与内存刷新；返回的账户和 password_configured 是保存证据。版本冲突先读取当前设置，不把失败当成功。

同一引用和 command_id 的重试幂等；引用默认 24 小时有效，用后删除。导入只保存，不登录、不启动终端、不代表交易授权；连接与真实 Tester 分别需要其自身就绪证据。如果供应商还需 GUI 授权，只请用户完成无法由现有接口完成的原生步骤。不要从 MT5 的加密密码库猜测或解密凭据。

普通选项和 allow_trading/allow_host_operations 也由 mt5_update_configuration 修改。用户已明确授权的配置由主 Agent 执行，不重复索取授权或以“只能手工设置”结束。保留现有账号，自动重连不代表获准重放交易。connected 只证明 Terminal 和绑定账户通过核验；MetaEditor、Python IPC、Tester 和交易权限均要分别核实。mt5_catalog 返回每个方法自身 inputSchema；各组工具维持自己的业务参数，外部服务拒绝时说明具体观测和可处理的缺项。

原生启动与 portable/profile/config 的定义见 [MetaTrader 5 官方平台启动文档](https://www.metatrader5.com/zh/terminal/help/start_advanced/start)。mt5_start_terminal 仅封装打开已选终端；需要特定原生启动参数时，使用 mt5_catalog 返回的 launcher 方法及所属 mt5_trade 入口。
