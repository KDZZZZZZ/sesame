# API 2 插件管理

此插件检索、安装、更新、启停和卸载声明完整的插件。宿主安装接口包含静态检查、运行绑定检查及精确摘要校验，失败一次返回合并诊断。

开发流程：plugin_create → 实现业务和测试 → plugin_install → 实际能力验收。更新先 plugin_inspect，再 plugin_update(expectedRevision)。工具返回的是实际运行结果，不提供虚构的兼容导出、回滚或测试通过标志。

独立创建草稿可运行 scripts/create-plugin.mjs。既有 native 与 skill 参数继续可用；新增 knowledge、function、adapter、workflow、service 模板，均生成完整 API 2 声明及与其对应的薄入口。

| 模板 | 生成内容与真实行为 |
| --- | --- |
| native | 保留原有 echo 示例、能力 ID 和返回契约 |
| skill / knowledge | 无可执行能力；knowledge 另生成方法与反例参考文件 |
| function | src/analyze.js 中可执行的有限数值求和示例及固定输入/输出 |
| adapter | src/source.js 适配入口；实现前返回 NOT_IMPLEMENTED 错误 |
| workflow | src/runtime.js 与 native workflow + run 声明；实现前返回 NOT_IMPLEMENTED 错误 |
| service | src/service.js；按真实业务补充宿主贡献，实现前返回 NOT_IMPLEMENTED 错误 |

例如：`node scripts/create-plugin.mjs --name my-source --publisher my-team --description "Read the selected source" --template adapter --output /path/to/new-directory`。先实现实际业务、输入输出及测试，再安装并验收。适配器、工作流与服务模板附有配置说明：在统一入口管理配置和密钥，并用 configurationRequirements 绑定实际依赖它们的能力；空草稿不会凭空要求密钥。

官方源码的 inventory-policy.json 维护旧 category、五类任务职责 functionalCategory（业务流程、专业能力、资源接入、交互呈现、平台管理）和独立的 implementationKinds，包目录继续平铺。研究指南与可执行工作流同属业务流程；ICT 知识与指标计算同属专业能力。不要根据模板、接口或是否有代码推导主分类。分类不改变插件 ID、发布成员或调用授权。MCP 作者声明每个服务器工具的 binding:{type:"mcp",server,name}，安装时宿主比对真实工具目录。

`plugin_catalog` 读取 `https://dl.sesame.bot/plugins/api-v1/catalog.json` 的开发目录；路径名保留发布管线约定，包和目录的 `apiVersion` 必须为 `2`。schema2 使用 R2 内容寻址包目录，固定发布提交、锁与审阅记录，并在安装前逐文件验证大小及 SHA-256、整包 treeDigest。schema1 的固定 GitHub 提交来源仍可读取，不接受浮动分支、任意下载主机或 API1 包。安装失败不改称已完成；已禁用的包保持禁用。
