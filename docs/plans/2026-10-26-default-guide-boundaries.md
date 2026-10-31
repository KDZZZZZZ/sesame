# 默认指南职责整理

## 目标与边界

将产品使用说明与 Agent 协作编排分开，同时保留 prompt / skill / reference 的职责差异。只调整官方插件知识、包声明、清单、相关文档和回归测试；不修改宿主运行接口、系统提示词、上下文装配方式或正在运行的用户工作区。

- `prompt.md`：插件定位、适用时机与通用原则。
- `SKILL.md`：具体任务的步骤、选择方法与验收方式。
- `references`：按需读取的界面说明、完整参数、示例与细节。

## 方案

1. `sesame/orchestration` 保留默认挂载，只承担研究阶段、工作流与子 Agent 协作。简化总提示，增加 `coordinate-research` skill，将宿主 Agent / Run 参数说明移入其参考文件。
2. 恢复独立的 `sesame/user-guide`，以新版本 3.0.0 加入默认核心插件。迁移原 `sesame-user-guide` skill 及七篇产品参考页；保留原 skill 名称。产品操作知识不增加运行工具，也不授予权限。
3. 产品帮助中的研究示例保留用户目标与可观察结果，去掉混入的 Agent 调用契约。检查已过时的聊天命令、附件与界面说明，以当前实现修正。
4. 审阅其他默认插件，针对已确认的职责冲突做最小修正；不扩大成所有插件或运行机制的重写。报告规范中的 SVL 图仅约束有同源 SVL 的成果，原生回测不强制补造 SVL。
5. 更新 core profile、inventory、来源锁、当前职责文档及默认提示词摘要。已发布的历史快照和测试基线不伪装为新版本。

## 原则保留表

| 现有内容 | 整理后归属 |
| --- | --- |
| 主 Agent 协调、子 Agent 完成所分配阶段、无需递归委派 | orchestration prompt 与 coordinate-research skill |
| 先发现现成插件、知识与工作流协作、证据独立性 | coordinate-research skill |
| 最大努力启动合适工作流；轻量研究可直接做；日常问答不强制拆分 | orchestration prompt 与 coordinate-research skill |
| 复用缓存、自主补齐可解决的数据与依赖 | coordinate-research skill |
| 阶段报告、真实发布、当前修订渲染、绑定具体 Run | coordinate-research skill 与 Agent / Run 参考 |
| plugins 选择知识、allowedCalls 授予工具；四项宿主基础能力 | Agent / Run 参考 |
| 同一 Run 暂停恢复、受理不等于完成、取消不回滚副作用 | coordinate-research skill 与 Agent / Run 参考 |
| 完成自动通知、无独立工作可等待、有价值下一阶段先实际启动 | coordinate-research skill |
| 本次要求优先、长期偏好来源与版本、已受理计划冻结 | coordinate-research skill；产品帮助保留用户可操作说明 |
| 用户如何上手、设置、安装插件、三态、命令、图表和报告 | user-guide prompt、sesame-user-guide skill 与七篇参考 |
| 说明文档不扩大权限；语言、授权和任务完成规则由宿主管理 | 两个插件各自定位段落 |

## 验证顺序

先加入独立插件所有权的失败用例，再迁移知识。验证两个包均无运行入口、声明的参考均可读取、技能名唯一；默认装配后两套知识各自可见，禁用产品帮助不影响编排与宿主 Run，反之亦然；保留 `/skill:sesame-user-guide` 的实际会话展开测试。随后检查 profile、清单和来源锁，运行现有报告约束测试与宿主指南回归。仅使用隔离测试工作区与测试模型传输，不调用用户账户或真实交易。
