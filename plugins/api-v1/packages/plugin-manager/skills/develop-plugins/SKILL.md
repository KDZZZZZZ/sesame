---
name: develop-plugins
description: 实现、声明、安装和验证 Sesame API 2 原生、Agent 或 MCP 插件。
---

# 插件开发

先读 references/host-api.md，再按 references/authoring.md 定义业务边界。所有对 Agent 或宿主提供的能力都要显式声明；配置后的 source、view、service、hook 不得隐式注册。

plugin_create 可生成 native 或 skill 草稿；纯知识包 capabilities 为空，knowledge 列出全部资源。原生工厂 createCapabilities(host) 同步返回与 binding.name 一一对应的 {name,execute(input,signal,executionContext)}，返回普通 JSON。MCP 声明 type:mcp 的 server/name，安装比对真实工具清单。

插件一次完成准备、检查、执行和结果回读；需要长期执行时使用 Run。先验证业务测试，再调用 plugin_install（宿主自动检查并安装）。更新先读取当前摘要，使用 plugin_update(expectedRevision)。失败读取合并诊断，不添加兼容旧接口的包装层。

用户沟通提示词由宿主管理。插件定义可用能力、可量化领域目标、输入输出、调用权限和因果明确的原则；只说明真实依赖顺序，不把固定操作清单当作完成目标的唯一方式。usage 会进入 Agent 工具描述，应写清实际参数入口、返回状态/成功证据、外部副作用与针对具体错误的恢复，不使用“按 schema”或“按声明结果”等占位。
