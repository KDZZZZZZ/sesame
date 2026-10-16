# API 2 插件管理

此插件检索、安装、更新、启停和卸载声明完整的插件。宿主安装接口包含静态检查、运行绑定检查及精确摘要校验，失败一次返回合并诊断。

开发流程：plugin_create → 实现业务和测试 → plugin_install → 实际能力验收。更新先 plugin_inspect，再 plugin_update(expectedRevision)。工具返回的是实际运行结果，不提供虚构的兼容导出、回滚或测试通过标志。

独立创建草稿可运行 scripts/create-plugin.mjs。原生或纯知识模板均生成 capabilities.json；原生模板只有 echo 示例。MCP 作者声明每个服务器工具的 binding:{type:"mcp",server,name}，安装时宿主比对真实工具目录。

`plugin_catalog` 读取 `https://dl.sesame.bot/plugins/api-v1/catalog.json` 的开发目录；路径名保留发布管线约定，包和目录的 `apiVersion` 必须为 `2`。schema2 使用 R2 内容寻址包目录，固定发布提交、锁与审阅记录，并在安装前逐文件验证大小及 SHA-256、整包 treeDigest。schema1 的固定 GitHub 提交来源仍可读取，不接受浮动分支、任意下载主机或 API1 包。安装失败不改称已完成；已禁用的包保持禁用。
