---
name: configure-application
description: 用户粘贴 MT5 导出的 Claude JSON / Codex TOML 时主动导入连接配置并分别核验服务；也用于恢复 MT5 连接、检查模型设置和补齐认证。
---

# 配置应用

## 工作顺序

1. 用 `configuration_read` 读取脱敏配置。查看模型认证、MT5 保存状态、插件权限和近期配置结果；不要重复索要已保存的信息。
2. 用户要求连接、或当前任务需要连接恢复时，用 `mt5_connect`。由后端检查已存凭据和本机候选、重建会话、必要时安全启动，再核验券商与账户。账号和服务器不能根据品牌猜测；已绑定账户不自动更换。
3. 用户已提供 MT5 导出时先按下文安全导入；应用侧交易和宿主权限可按用户要求用 configuration_update 调整。缺少其他认证、密码、OAuth 时打开现有设置窗口，缺少 MT5 原生授权时引导完成对应终端设置。不要把秘密转发到模型、报告或代码工作区。
4. 补齐设置后用新的 command_id 调用 `mt5_connect`；只有 result.status 为 connected 才算成功。功能目录用 `mt5_catalog` 另行检查，MetaEditor 不可用不等于交易终端离线。不要为连接开启交易权限。

`authenticated` 只表示已保存认证；Python 已安装、工具目录存在不等于账户在线。保存成功不表示登录成功。缺少凭据、MT5 未启动、MCP 未启用或版本不支持时，说明确切缺项。
`mt5_connect` 的结果范围严格为 `server: "terminal"`。即使 MetaEditor 也保存了密钥，也不能据此说 MetaEditor 已通过认证；MetaEditor 与市场数据用各自的 `mt5_catalog` 检测，Python 需要实际 IPC 调用。只报告此次工具确实核验的服务。

## 用户粘贴 MT5 导出时，主动配置

用户直接把 Claude `.mcp.json` 的 `mcpServers` 或 Codex `config.toml` 的 `[mcp_servers.terminal]` / `[mcp_servers.metaeditor]` 发来，默认是在提供连接配置；无需要求再去设置手动填写。用户明确只想解释或暂不修改时，遵守其要求。

1. `configuration_read({section:"mt5"})` 读取当前 `version`、服务状态和 `pending_mt5_imports`。用本条用户消息中 Sesame 生成的 `source_message_id`，不要猜引用或自动挑选其他历史配置。
2. 调用 `configuration_import_mt5({command_id:"import-mt5-唯一ID", source_message_id:实际引用, expected_version:实际版本})`。后端把 `url` 对应到同名服务地址，把 `Authorization` / `http_headers.Authorization` 的 **Bearer 后面的值** 对应到 API Key，保留 `+`、`/`、`=` 等字符，按 `enabled` 保存；JSON 未指定时启用。JSON 与 TOML 一起提供时仅合并一致项，冲突不保存。只接收本机 Terminal / MetaEditor，不执行配置中的命令。
3. 确认返回 `status:"applied"`，再用 `mt5_connect` 检查 Terminal。应用热更新配置并重建连接，不需要重启 Sesame。Terminal 的 MCP 认证和券商在线是两项检查；`mcp_connected:true` 但 `broker_offline` 时，说明密钥已可用，后续检查 MT5 自己的券商登录/网络，不反复替换密钥。
4. 用 `mt5_catalog({server:"metaeditor"})` 单独检查 MetaEditor。端口拒绝连接表示编辑器服务尚未启动，不能归因于密钥错误；提示打开 MetaEditor 并确认自身的 MCP 开关。返回 401 才需要核对对应服务当前导出的密钥。没有启用的服务不声称已连接。
5. 最终简洁说明分别保存、验证了什么，还有哪一层未连通。服务工具目录成功不等于账户在线；保存密钥也不等于认证成功。不更换券商账户，不打开交易或宿主权限，不把密钥写入报告、代码、记忆或工作区文件。

导入引用有效期为 24 小时，应用重启仍可用，成功后立即清除暂存密钥；过期或已导入先检查当前设置。遇到 `version_conflict` 重新读版本后用新命令，`agent_busy` 等其他任务结束。同一请求重试保留 command_id，不能盲目重复保存。解析失败时只说明格式或冲突，不引用带密钥的原文。用户未提供导出且确实缺认证时打开 MT5 设置窗口，不索要其他秘密。

## 工具用法

- `configuration_read({section:"mt5"})`：读取 MT5 当前版本与连接设置；不传 section 则读全部。`section:"model", provider:"实际供应商ID"` 可查看该供应商模型与认证方式。
- `mt5_connect({command_id:"connect-唯一且至少16字符的ID", start_if_needed:true})`：最多约 30 秒的自动连接；默认允许启动已配置且启用 MCP 的唯一终端。只用读取操作验证账户；固定启动配置关闭算法交易，复用终端已保存登录和代理，不执行用户 INI 中的脚本、EA 或 Tester。`start_if_needed:false` 仅重建连接。失败 code 区分密钥被拒绝、终端未运行、券商离线、账户不符、插件禁用；不要无界重试或把失败说成成功。
- `configuration_update({command_id:"唯一且至少16字符的ID", target:"mt5", expected_version:实际版本, changes:{import_native:true}})`：由后端读取本机已保存配置，秘密不经过模型。导入与其他字段修改分开调用。
- MT5 连接字段支持 `servers.{terminal,metaeditor,marketdata}.{url,enabled}`、`account.{login,server}`、`tester_agent.{address,port}`。保存新的地址或账户会清除不再匹配的旧凭据；不要宣称旧认证仍有效。
- MT5 权限可由主 Agent 按用户要求配置：`target:"mt5", expected_version:实际版本, changes:{allow_trading:true, allow_host_operations:true}`。也可分别设为 false。新安装两项默认开启；已保存的用户选择会保留。交易、宿主访问和 Python 插件默认可发现，需要时用 plugin_load 加载。用户已明确关闭的权限，仅在用户要求恢复或明确要求执行相关操作时调整。修改应用权限不会绕过 MT5 自己的 MCP 授权，也不会自动发出订单。
- 修改语言：`target:"preferences", changes:{locale:"zh-CN"或"en"}`。不传 expected_version。
- 切换已认证模型：`target:"model", changes:{provider:"实际ID",model:"实际模型ID",thinking:"medium"}`，不传 expected_version。返回 queued 后结束当前回复，等所有会话空闲再生效；不得在当前回复中轮询等待自己结束。用 `configuration_read` 的 recent_changes 核实最终结果。
- `configuration_open({dialog:"settings"})` 打开模型认证窗口；`dialog:"mt5"` 打开 MT5 设置。只是请求前端展示，不能宣称用户已经完成填写。

每次新修改使用新的 command_id；相同命令重试必须保留 ID 和参数。`409 version_conflict` 后重新读取，不用旧版本覆盖用户刚改的配置。`agent_busy` 表示其他会话、回测或配置操作仍在使用共享环境；等待其结束。失败、取消和重启未知状态不会自动重放；先核对当前值，再按用户要求发出新命令。不能修改插件策略、密码或启动 INI；MT5 密钥仅能通过用户主动提供的导出引用，由后端保存。

## 券商交易账户

- 账户号码、交易服务器和密码来自券商开户通知或客户后台；具体服务器向券商确认。
- MT5 中在 **文件 → 登录到交易账户** 核对 Login、Password、Server。MQL5.community 社区账号不是券商交易账号，不能互相替代。
- 已在所选终端保存登录时优先复用，不解密密码。官方 Python 可省略密码和服务器以使用终端数据库；`initialize` 可能启动终端、`login` 可能切换账户，它们不是纯读取，不绕过现有权限。
- 首次登录、验证码或证书仍由用户完成。

官方：[交易账户登录](https://www.metatrader5.com/en/terminal/help/startworking/authorization)、[保存凭据复用](https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py)。

## MT5 原生 MCP

1. 在 MT5 打开 **工具 → 选项 → MCP**，启用 **Enable internal server / 启用内部服务器**，查看 Address 与 API Key，保存 OK。
2. 本应用默认在启动、设置保存和断线后自动连接，无需手动按钮；主 Agent 仍可用 mt5_connect 主动诊断。缺少认证时可以导入用户主动提供的完整 MCP 导出，或在 **高级设置** 对应服务中填写当前 API Key。本机文件中受保护的存储值无法代替正式导出的密钥。
3. 终端常见地址为 `http://127.0.0.1:22346/mcp`，MetaEditor 为 `http://127.0.0.1:22345/mcp`；以实际配置为准，分别检测。

原生 Copy 导出包含密钥；应用会在发送给模型及写入聊天历史之前提取和脱敏，按下文的导入流程处理，不回显密钥。MCP Key 与 AI Assistant 页的模型 Key 不同。终端内部服务器开关不控制 MetaEditor 或 MetaTrader.com；市场数据服务需要自己的认证。本机文件导入会保留同地址已存密钥；自动连接仅在候选通过真实认证与账户核验后更新密钥。受保护格式（已在 build 6230 观察到）需要首次从正式导出导入或在设置填写 API Key，密钥失效后也需更新。连接工具不安装 MT5、开启原生 MCP 开关、切换终端/账户或处理验证码。

官方：[MCP 设置与密钥](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/configuration)。

## 模型认证

- 打开 **模型与运行状态**，按实时供应商目录选择供应商和模型。只有自定义服务需要另填 Base URL、协议和模型 ID。
- 目录支持 `api_key` 时，让用户在官方控制台创建 Key，填本应用 **API Key** 密码框并 **保存并使用**；已有认证留空保留。
- 目录支持 `oauth` 且显示 **浏览器登录（OAuth）** 时，跟随本次登录流程给出的授权链接和提示。不要编造授权 URL，不索取网站密码、Cookie 或刷新令牌；验证码填设置窗口。
- 常用官方入口：[OpenAI](https://platform.openai.com/api-keys)、[Claude](https://platform.claude.com/settings/keys)、[DeepSeek](https://platform.deepseek.com/api_keys)。其余供应商使用该供应商官方文档；不猜模型名称、套餐权益、额度或地区可用性。
- Pi 0.99.1 负责凭据保存和 OAuth 刷新。切换模型使用目录中已经认证的模型；缺少认证先完成设置窗口的登录。

## 运行环境

Windows 的运行时与研究沙箱由现有安装入口配置。WSL 系统授权和必要重启需要用户完成。多份 MT5 安装需明确选择目录；不静默切到另一个账户。此插件不编辑任意文件、安装软件、申请操作系统管理员权限、执行交易或修改全局插件策略。
