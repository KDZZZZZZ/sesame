# 插件管理接口

这里列的是 Agent 调用参数；插件内部的 host.plugins 端口见 [宿主 API](../../develop-plugins/references/host-api.md)。省略的可选项不需要为了凑流程填写。所有 ID、摘要、资源路径和版本都取实际回执。

| 工具 | 输入与用途 |
| --- | --- |
| plugin_discover | `{query?,ids?,cursor?,limit?}`，查当前可发现的已安装插件；limit 为 1–200，结果不是包含禁用包的完整安装清单。 |
| plugin_catalog | `{plugin_id?,query?}`，查官方 API 2 发布目录，返回 catalog_digest 与固定包摘要。 |
| plugin_read | `{pluginId,part:"manifest"}` 查结构；`{pluginId,part:"resource",path}` 读公开资源。 |
| plugin_inspect | `{pluginId}`，查当前状态；更新用返回的 digest，不用 SemVer 版本号代替。 |
| plugin_load | `{pluginId}`，加入本会话 loadout；不会启用已禁用的包。 |
| plugin_set_state | `{pluginId,enabled,scope,expectedVersion?}`；scope 为 session 或 workspace，expectedVersion 是工作区策略版本，不是安装 digest。 |
| plugin_create | `{command_id,name,description,version?,template?,publisher?,min_host?}`；生成草稿，不代表业务已实现。 |
| plugin_install | `{path,digest?,operationId?}`；本地实际包目录，digest 固定待安装内容。 |
| plugin_update | `{pluginId,path,expectedRevision,digest?,operationId?}`；expectedRevision 是当前安装 digest，digest 是候选包摘要。 |
| plugin_install_catalog | `{command_id,plugin_id,catalog_digest,action?,expected_digest?}`；install 不传 expected_digest，update 必须传当前安装 digest。 |
| plugin_uninstall | `{pluginId,expectedRevision,operationId?}`；expectedRevision 为当前安装 digest，受宿主内置插件与依赖规则约束。 |

command_id 用 16–128 位字母、数字、下划线或连字符；operationId 为另一字段，不能混用命名。不同请求使用新 ID；同一请求重试保留 ID 与全部输入。本地安装后按需 plugin_load；目录安装会尝试加载当前会话，禁用或加载失败按返回状态处理。

## 配置入口

配置和密钥由 `sesame/configuration` 提供 Agent 工具，使用前按需发现并加载：

- `configuration_integration_catalog({plugin_id?})`：查看字段、消费者、配置状态与 authority 分组。
- `configuration_integration_check({plugin_id,fields})`：检查目标字段是否满足要求。
- `configuration_integration_apply({plugin_id,command_id,values,expected_version?})`：只写同一 authority 分组；该组提供版本时传其 expected_version。authority 不作为额外输入字段。

对应的 `host.configuration.catalog/check/apply` 是宿主能力 ID，插件代码经 host.capabilities.invoke 调用；它们不是额外的 HostContext 端口。保存不回显秘密，配置存在仍需用业务能力验证连接。开发包的字段绑定见 [声明与实现](../../develop-plugins/references/authoring.md)。

## 检查的范围

原生包安装会检查清单、schema、声明与实际绑定、JavaScript 语法并执行隔离工厂预检，不运行包内全部业务测试。MCP 会核对实际 tools/list；本地 stdio 包可运行其声明的安装测试，远程 MCP 不执行此类测试。业务结果需另行验收。

目录只接受固定 API 2 发布与完整内容摘要；相同已安装字节可返回 already-installed，禁用状态保持不变。Agent 没有 rollback 工具，不能通过此安装接口降级；失败诊断和幂等恢复见 [恢复约定](../../develop-plugins/references/recovery.md)。
