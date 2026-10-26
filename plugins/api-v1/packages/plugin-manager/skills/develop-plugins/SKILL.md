---
name: develop-plugins
description: 实现、声明、安装和验证 Sesame API 2 原生、Agent 或 MCP 插件。
---

# 插件开发

先读 references/authoring.md 的责任与接口选择表，确定任务需要的最小能力，再按 references/host-api.md 对接宿主。统一指南包含同类源码参考、可调整流程、长期偏好、三态和验证硬要求。所有对 Agent 或宿主提供的能力都要显式声明；配置后的 source、view、service、hook 不得隐式注册。

plugin_create 可生成 knowledge、function、adapter、workflow、service 草稿，兼容原有 native 与 skill 参数。native 只有 echo 示例，function 只有固定数字求和示例；adapter、workflow、service 的业务入口在实现前抛出 NOT_IMPLEMENTED。纯知识包 capabilities 为空，knowledge 仅声明供 Agent 读取的知识正文，不是包文件清单。每份知识正文最多 128 KiB（UTF-8 字节）；完整测试数据、审计日志和实现文件可随包保存，无需加入 knowledge/resources。原生工厂 createCapabilities(host) 同步返回与 binding.name 一一对应的 {name,execute(input,signal,executionContext)}，返回普通 JSON。MCP 声明 type:mcp 的 server/name，安装比对真实工具清单。

官方源码在 inventory-policy.json 中按任务职责指定 functionalCategory：business 业务流程、analysis 专业能力、integration 资源接入、presentation 交互呈现、platform 平台管理。宏观研究指南和可执行工作流同属 business；具体知识与局部计算同属 analysis。implementationKinds 独立记录实现形态，不用接口或模板推导主分类。保留旧 category 和 core/optional 发行布局。配置与密钥使用统一入口；声明可管理字段后，以 configurationRequirements 绑定真正依赖该字段的能力，按需用 when 限定输入分支。不要给整个插件或无配置依赖的操作附加无关密钥要求。详见 references/authoring.md。

插件一次完成准备、检查、执行和结果回读；需要长期执行时使用 Run。先验证业务测试，再调用 plugin_install（宿主自动检查并安装）。更新先读取当前摘要，使用 plugin_update(expectedRevision)。失败读取合并诊断，不添加兼容旧接口的包装层。

用户沟通提示词由宿主管理。插件定义可用能力、可量化领域目标、输入输出、调用权限和因果明确的原则；只说明真实依赖顺序，不把固定操作清单当作完成目标的唯一方式。usage 会进入 Agent 工具描述，应写清实际参数入口、返回状态/成功证据、外部副作用与针对具体错误的恢复，不使用“按 schema”或“按声明结果”等占位。
