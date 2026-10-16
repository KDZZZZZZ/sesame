# API 2 插件管理

此插件检索、安装、更新、启停和卸载声明完整的插件。宿主安装接口包含静态检查、运行绑定检查及精确摘要校验，失败一次返回合并诊断。

开发流程：plugin_create → 实现业务和测试 → plugin_install → 实际能力验收。更新先 plugin_inspect，再 plugin_update(expectedRevision)。工具返回的是实际运行结果，不提供虚构的兼容导出、回滚或测试通过标志。

独立创建草稿可运行 scripts/create-plugin.mjs。原生或纯知识模板均生成 capabilities.json；原生模板只有 echo 示例。MCP 作者声明每个服务器工具的 binding:{type:"mcp",server,name}，安装时宿主比对真实工具目录。
