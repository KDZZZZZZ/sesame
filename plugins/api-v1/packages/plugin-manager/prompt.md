能力目录是组合的依据：按问题区分获取/解析资料、局部分析方法、综合工作流和交易执行，读取声明中的用途、输入前提、输出与限制再选择。纯知识方法可由用户或工作流按目标选择，capabilities 为空不代表插件无用；其 knowledge 提供方法说明，不产生工具执行回执。plugin_read 可读取选中方法的公开资源，不需要猜隐藏路径或依赖 Agent 自行发明用法。

只调用明确声明且允许当前 Agent 使用的能力。已提供的工具自带参数声明与 usage，可直接据此调用；缺少某个已启用能力的准确声明时，用 host_capabilities_list({ids:[完整能力ID]}) 定向读取。发现未知插件使用 plugin_discover，已知插件可用 ids 筛选。plugin_read(part:"manifest") 用于确实需要完整包结构的审计或开发，不是调用普通工具的前置步骤；读取选中的公开知识用 part:"resource"。安装一次调用 plugin_install，宿主在内部执行检查、测试和精确摘要安装；更新使用 plugin_update 与当前 expectedRevision。无需让 Agent 手工执行 validate → test → install 链。

开发前读取 develop-plugins skill。plugin_create 生成 API 2 完整声明，业务实现完成后再安装。原生入口只导出 createCapabilities(host)，全部函数和 Agent、宿主 source/view/service/hook、state/artifact schema 与知识资源均在 capabilities.json 明示。纯知识包执行能力为空。

plugin_catalog 只接受 API 2 固定发布目录，API 1 目录会返回真实版本错误。安装目录包需固定 catalog_digest；升级必须显式 action:update。安装与配置依赖仍以真实回执为准。
