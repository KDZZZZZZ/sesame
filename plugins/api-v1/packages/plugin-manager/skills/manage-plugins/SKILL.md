---
name: manage-plugins
description: 按任务发现和读取插件、加载现有能力、安装或更新固定版本，并核对状态及配置依赖；开发实现另用 develop-plugins。
---

# 使用与管理插件

## 1. 找到完成任务的能力

已提供的工具带有参数声明与 usage，可直接调用；缺少某个已启用能力的准确声明时，用 host_capabilities_list({ids:[完整能力ID]}) 定向读取。未知插件用 plugin_discover 按问题查询，已知插件用 ids 筛选。需要安装来源时才查 plugin_catalog，它读取 API 2 的固定发布目录；api-v1 的目录名不代表 API 1 兼容。

比较用途、输入前提、输出和限制，组合来源、知识、分析与工作流。公开知识用 plugin_read(part:"resource",path) 读取；确需审计包结构或开发时才读 part:"manifest"。先用目录中真实资源路径，不猜源码路径或隐藏工具名。

## 2. 按需加载并解决依赖

对允许使用但未进入本会话的插件调用 plugin_load。需要核查状态时用 plugin_inspect；该工具返回安装摘要、状态和错误，plugin_read 不接受 part:"status"。

mounted 为默认装配，discoverable 为按需发现和会话加载，disabled 不能靠 plugin_load 绕过。plugin_set_state 的 scope:"workspace" 以 enabled:true/false 设置 mounted/disabled；scope:"session" 只调整当前会话 loadout，不改变工作区三态。当前工具不提供直接设置 discoverable 的参数，不伪造枚举；完整三态由客户端设置提供。

加载不等于连接成功。按错误查看依赖和统一配置目录，对实际需要的字段完成配置后验证业务能力；不能把未配置、运行失败、未加载混为一种状态。配置入口与精确版本字段见 [管理接口](references/operations.md)。

## 3. 安装或更新

- 本地已实现的包：plugin_install({path,...})；更新先 inspect，再 plugin_update({pluginId,path,expectedRevision:当前digest,...})。
- 发布目录包：plugin_catalog 后使用返回的 catalog_digest；plugin_install_catalog 默认 install，更新明确 action:"update" 并提供当前 expected_digest。
- 新开发需求：转到 develop-plugins，不把空脚手架当可用功能。

一次安装调用包含宿主安装检查，不先调用不存在的 plugin_validate/plugin_test。目录摘要变更或安装修订冲突时重新读取实际状态；未知执行结果先查是否已装好，同一请求重试保持操作 ID 与输入不变。没有公开的 rollback 工具，不通过卸载重装冒充回滚。

## 4. 验收并继续原任务

分别核对包身份和版本、加载状态、配置依赖以及目标能力的实际结果。安装回执只证明安装步骤，不能替代真实业务测试；更新不会自动替换旧 Run 的固定修订。不要因为完成插件管理就提前结束用户的原任务。卸载仅在用户要求或当前任务明确需要时执行，并携带当前安装摘要。
