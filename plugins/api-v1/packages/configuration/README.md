# 配置助手

“用户设置 → 配置与密钥”统一列出插件声明的配置、是否已配置及依赖它的能力。`configuration_integration_catalog` 返回同一目录，`configuration_integration_check` 检查指定字段，`configuration_integration_apply` 保存最小修改，`configuration_integration_open` 打开设置页。现有模型、环境、偏好配置入口继续可用。

统一保存使用 `{plugin_id,command_id,expected_version?,values}`，字段 ID 来自目录；未修改的字段省略，`null` 明确清除。仅在目录提供版本时传入读取时的 `expected_version`，冲突后重新读取并合并。密钥不回显、不进入 Run；连接配置仍由原插件保存。能力的 `configurationRequirements` 将缺项绑定到实际使用它的调用，条件不匹配或读取本地历史证据时不阻塞无关能力。

主 Agent 通过现有 `configuration_read`、`configuration_update` 完成应用配置。用户直接提供的 API Key 可以由 Agent 保存，无需导入、手工编辑环境变量或打开设置窗口。秘密由宿主私有持久保存，读取和修改回执不返回原文。

| 配置目标 | `configuration_update` 输入 | 生效方式 |
| --- | --- | --- |
| 插件环境凭据 | `target:"environment"`，`changes:{FMP_API_KEY:<用户提供的值>}`；值为最多 8192 字符的单行字符串，`null` 删除，省略字段保留 | 立即更新本次应用进程环境并持久保存，重启后恢复；不修改系统全局环境变量 |
| 模型与提供方 | `target:"model"`，`changes:{provider,model,thinking?,api_key?,base_url?,api?,context_window?,max_tokens?,reasoning?}` | 当前回复结束后处理，`queued` 尚未生效；后续 `recent_changes.status="applied"` 为保存与切换完成的证据 |
| 应用偏好 | `target:"preferences"`，`changes:{locale?,account_view?}`，`expected_version` 来自读取结果 | 版本化的最小补丁，立即保存 |

每次修改带稳定的 `command_id`（16–128 个字母、数字、下划线或连字符）。模型和环境配置不传 `expected_version`。示例里的秘密占位符需要替换为用户提供的值，不能把占位符作为实际配置保存。

`configuration_read` 支持 `section:"all"|"model"|"preferences"|"environment"`。环境配置只包含 `name`、`configured`、`source`，不会取回已保存的秘密。`provider` 可筛选模型提供方并查看模型列表。

模型配置可以直接接收新的认证。自定义兼容接口使用新的 `provider` ID，并同时给出 `base_url` 和 `api`；支持 `openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai`。`context_window` 为 1024–10000000，`max_tokens` 为正整数且不超过上下文窗口。已有供应商省略 `api_key` 时复用其认证。只有供应商要求 OAuth 交互时才需要登录界面。

插件可以提供更明确的配置入口，例如 `financial_research_configure({credentials:{fmp_api_key:<用户提供的值>}})`；它仍调用同一宿主配置能力。平台连接由对应后端插件管理，已有配置的导入是可选便利方式。只询问当前任务缺少的必要字段，不要求用户配置无关来源。

保存成功不证明远端认证、套餐权限或网络连接成功，应按对应能力实际返回的状态判断。凭据不能扩展数据源覆盖；例如 FMP 股票新闻和 FRED 宏观观测不提供 BLS 未来事件日历。`configuration_open({dialog:"settings"})` 用于用户主动查看设置或完成必须交互的登录。
