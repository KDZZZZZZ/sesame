# 插件开发

统一开发指南随 plugin-manager 发布，开发者与 Agent 使用同一份内容：

- [能力定位、接口选择、代表实现与硬性要求](../plugins/api-v1/packages/plugin-manager/skills/develop-plugins/references/authoring.md)
- [宿主 API 2 端口与原生执行接口](../plugins/api-v1/packages/plugin-manager/skills/develop-plugins/references/host-api.md)
- [开发 Skill 入口](../plugins/api-v1/packages/plugin-manager/skills/develop-plugins/SKILL.md)
- [完整插件职责清单](plugin-responsibilities.md)
- [31 个专业能力插件的职责、模块与配置归属](analysis-plugin-responsibilities.md)
- [源码布局、分类与配置绑定](plugin-functional-architecture.md)

先按目标责任选择最小接口，再看同类插件。宏观任务指南可使用纯知识形式；局部知识不必注册工具；确定性计算不必创建 Agent；来源适配不承担研究决策；呈现复用已有成果。只有真实业务需要时才增加 workflow、service、state 或额外能力。

当前源码采用 Plugin API 2，`api-v1` 是保留的目录名。源码、已安装版本、线上发布版本分别核对；本页不代表开发分支已经发行。

分类从暴露的 capabilities、services/lifecycle 和实际打包入口推导；知识参考脚本并不自动暴露函数。`native`/`skill` 保留旧 echo/纯知识行为，生成包会说明其 function/knowledge 责任并接受与正式包相同的宿主声明及绑定验证。

权限请求位于 `plugin.json` 根级 `permissions`，不是 capabilities.json、effects 或 taxonomy。优先确切 `calls` 与依赖锁；敏感 `scopes` 必须由用户在宿主本地单独确认，缺失授权保持待授权。原生代码仍受信运行于宿主进程，不是 OS 沙箱。兼容基线、同步复制件与源码/历史发布的分开验证见[交付规则](plugin-functional-architecture.md#分批推广与验收)。
