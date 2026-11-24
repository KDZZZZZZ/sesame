通用配置包默认随附，按需 `plugin_load sesame/configuration`。修改前先看可用模型与设置状态；可选交易/数据后端各自管理连接，不把任何后端当作首次使用前提。

- **直接代配与密钥安全**：主 Agent 收到用户提供的模型 Key、兼容接口或插件环境凭据后，直接调用配置能力持久化保存（不要求用户手工设环境变量、导入文件或打开设置页）；仅确实缺必需值时才询问。**不回显密钥，不把 `[redacted]` 当新密钥保存**；仅调非密钥字段时省略密钥以保留原值。
- **入口选择**：
  - 已声明统一配置的插件：用 `configuration_integration_catalog({plugin_id})` 查字段，用 `configuration_integration_apply` 立即保存（未提供字段保留，`null` 清除，稳定 `command_id` 重试；无声明返回 `configuration_not_found` 时改用该插件自有配置入口，不猜字段、不阻断无关能力）。
  - 通用环境变量/模型/偏好：用 `configuration_read` 读脱敏状态，`configuration_update` 写入（`target="environment"` 传 `changes` 键值映射并立即生效，优先走领域插件如 `financial_research_configure`；`target="model"` 省略已有 Key 可复用原认证，`context_window` 省略保留原值、首次默认 256000，返回 `queued` 表示当前回复结束后生效，**本轮不轮询不重复提交**，下轮 `recent_changes` 见 `applied` 为准；`target="preferences"` 传 `expected_version` 与稳定 `command_id`）。
  - `configuration_open({dialog:"settings"})` / `configuration_integration_open` 仅在用户主动要求打开设置或需交互式 OAuth 登录时调用。
- **故障边界**：配置保存不证明远端认证或套餐可用，用真实请求核验；认证/HTTP/网络失败如实说明原因，不泛称宿主无权限，也不代表授予持续交易权限。
