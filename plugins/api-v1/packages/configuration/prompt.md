通用配置包默认随附，按需 plugin_load sesame/configuration。查看可用模型和设置状态后再修改；可选交易/数据后端管理自己的连接，不把任何后端当成首次使用的必备前提。

密钥必须使用用户提供的原始值。[redacted] 等隐藏标记只是历史记录或读取结果的显示方式，不能作为新密钥保存，也不能由它还原密钥。只调整环境等非密钥配置时省略密钥字段，保留已有值。认证失败先核对实际保存和使用的配置，不能仅凭一次拒绝就断定接口地址、签名或插件有缺陷。

插件已声明统一配置时，用 configuration_integration_catalog({plugin_id}) 查看字段状态及依赖能力。只有本次需要查询配置且尚不清楚哪些插件支持统一字段时，才先用 configuration_integration_catalog({}) 列出声明者；没有声明的插件继续使用其公开领域配置入口。configuration_not_found 表示没有统一配置声明，不等于缺少密钥；不为未声明插件猜字段，也不因此阻断无该配置依赖的能力。configuration_integration_apply 保存本次需要的 values；未提供字段保留，null 明确清除；只在目录返回版本时传 expected_version，稳定 command_id 用于同一次保存重试。configuration_integration_check 可复查缺项，configuration_integration_open 打开“配置与密钥”。这些设置写入必须即时调用，不转为 Run；不要复述密钥。现有模型、偏好和环境配置入口保留。

主 Agent 可以直接用 configuration_update 保存用户提供的模型 API Key、兼容接口和插件所需环境凭据；不依赖导入、不要求用户手工设置环境变量或打开设置窗口。只有确实缺少必需的值时才询问用户，已提供的值直接使用，不回显密钥。用 configuration_read 读取脱敏状态，section="environment" 只返回环境变量名称、configured 和 source。

configuration_update 的 target="environment" 接收 changes={FMP_API_KEY:<用户提供的值>,FRED_API_KEY:<用户提供的值>} 等明确环境变量映射，值是单行字符串，null 删除；宿主私有持久保存并立即生效，不传 expected_version。优先使用对应插件的配置能力提供领域字段，例如 financial_research_configure({credentials:{fmp_api_key:<用户提供的值>}}) 调用同一宿主配置入口。只配置任务需要的来源。

target="model" 接收 changes={provider,model,thinking?,api_key?,base_url?,api?,context_window?,max_tokens?,reasoning?}，不要求提前认证；有新 Key 时直接保存，省略时复用已有认证。自定义兼容接口使用新的 provider ID，base_url 与 api 配套。返回 queued 表示当前回复结束后应用，不在本轮反复轮询或重复提交，下一轮 recent_changes 中 applied 才是生效证据。target="preferences" 使用 preferences.version 作为 expected_version 和稳定 command_id；版本冲突需要重读后合并最小补丁。

configuration_open({dialog:"settings"}) 适用于用户主动要求打开设置或供应商要求交互式 OAuth 登录。平台连接用对应插件的直接配置及状态能力；现成配置文件的导入是可选便利方式。配置保存不证明后端连接或 API 套餐覆盖，使用真实结果确认；认证失败、HTTP 拒绝、网络失败应说明实际原因，不能泛称宿主没有权限。连接成功也不授予持续交易权限。
