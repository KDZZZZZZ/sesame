---
name: configure-application
description: Configure declared plugin fields and their consuming capabilities through the unified configuration entry, and save model credentials, environment credentials and preferences through the existing host tools.
---

目标是由 Sesame 完成已授权的配置，并提供脱敏的生效证据。用户提供的凭据可以直接交给声明的配置能力，不需要用户导入文件、编辑环境变量或重复填写设置页；只有缺少必要字段或必须进行 OAuth 交互时才请用户补充。不要在回复、报告或公开文件中回显凭据。

插件已声明统一字段时，先用 configuration_integration_catalog({plugin_id}) 读取实际字段、configured、writable、authority、clearable 和依赖它们的 capabilities；省略 plugin_id 才是列出全部。字段依赖按能力及本次输入的条件生效，可选字段或无关来源缺项不阻塞其它能力。没有统一声明的配置继续使用对应插件原有入口，不自行推测字段。

configuration_integration_apply({plugin_id,command_id,values,expected_version?}) 只提交本次修改字段，同一次保存按 authority 分组，版本取同组目录字段返回的 expected_version；没有版本则省略。未提供字段保留，null 仅清除标为 clearable 的字段。同次重试保持 command_id 与输入不变，冲突后重新读取并合并。需要复查时使用 configuration_integration_check({plugin_id,fields:[实际字段ID]})；它检查配置存在，不验证远端认证。configuration_integration_open({}) 打开“配置与密钥”。配置直接即时写入原存储，不另建 Run 或保存第二份密钥。

现有 configuration_update 使用稳定 command_id。target="environment" 的 changes 按环境变量名保存单行字符串，null 删除，省略字段保留，不传 expected_version；宿主私有保存、立即生效并在重启时恢复。configuration_read({section:"environment"}) 只返回名称、configured、source。financial_research_configure({credentials:{fmp_api_key:<用户提供的值>,fred_api_key:<用户提供的值>}}) 是领域入口，使用同一宿主保存机制；只配置当前需要的来源。

target="model" 的 changes={provider,model,thinking?,api_key?,base_url?,api?,context_window?,max_tokens?,reasoning?} 可保存新的认证与模型，无需预先完成设置。自定义接口使用新的 provider ID 和匹配的 base_url/api；已知供应商省略 api_key 时复用已有认证。model 不传 expected_version，queued 表示等待当前回复结束，当前轮不循环等待；后续读取 recent_changes 判断 applied 或具体失败。configuration_open 仅供用户要求查看设置或供应商要求交互式 OAuth 登录。

平台连接由对应后端插件的直接配置能力保存，例如 mt5_update_configuration 可接收明确的连接、账户和凭据；导入现有原生配置是可选方式。读取、发现或连接检查是为了复用现状、补足具体缺项并验证结果，不是每次配置必须重复的固定步骤。配置保存与远端认证成功不同；按实际错误说明 Key、套餐、网络或接口覆盖问题，不把它们笼统说成没有宿主权限。配置请求也不自动授权持续交易。

修改 preferences 时用 configuration_read 返回的 preferences.version 作为 expected_version，传最小 changes；版本冲突时重读并以新 command_id 提交合并后的补丁。

配置账户页时，先通过对应插件配置或复用连接，用 configuration_read {section:"preferences"} 读取当前勾选及版本。changes.account_view.selected = [{ provider: { pluginId, providerId }, connection: { id, revision }, accountId, accountConnectionId? }] 保存当前勾选账户。沿用插件或读取结果给出的精确引用；connection 仅在提供方不需要时省略，accountConnectionId 仅在读取结果提供时保留。不要推测连接 ID、修订或账户。此步骤不需要先创建行情图，纯账户插件也可使用。

account_view.sources 可保存最多 32 个可切换连接；selected 保存最多 32 个勾选账户，其连接自动加入 sources。省略字段保留原值；selected:[] 取消全部勾选。source 是旧版单选兼容字段，source:null 只清除旧字段，不代表清空 selected。仅保存必要的提供方/连接/账户引用，不传地址、密钥或其他配置。语言和账户偏好独立合并，应用重启或切换浏览器地址后仍然生效。
