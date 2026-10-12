# Sesame 插件开发文档

开发指南随 `sesame/plugin-manager` 发布，内外部 Agent 使用同一份文档：

- [开发 Skill](../packages/plugin-manager/skills/develop-plugins/SKILL.md)
- [开放接口参考](../packages/plugin-manager/skills/develop-plugins/references/host-api.md)
- [创建、测试和安装](../packages/plugin-manager/skills/develop-plugins/references/authoring.md)
- [公开创建脚本](../packages/plugin-manager/scripts/create-plugin.mjs)
- [审查与发布流程](../PUBLISHING.md)

社区贡献从 fork 向 `dev` 提交，由维护者审核、合入，再通过 `dev → main`
发布稳定源码。见[仓库贡献规则](../../../CONTRIBUTING.md)。

本仓后续 GitHub Release 仅发布本体版本；已有插件归档为旧客户端保留。
插件源码合入与插件版本上架是两个步骤，当前分发边界见
[插件生态与收录政策](../../ECOSYSTEM.md)。
