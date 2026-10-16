# 判断复盘与 Agent 编排能力去重

## 范围与目标

用户明确要求修复两处重复：manual-trading 内嵌 judgment-evolution，以及 orchestration 对宿主 Agent/Run 的重复包装。不保留旧工具别名；不改动其他重叠能力或既有用户数据。

- 判断、证据、校准和准则由 `sesame/judgment-evolution` 独立拥有。manual-trading 保留交易计划、执行协调和交易案例复盘，删除内嵌判断工具、数据库服务和轮后审计钩子。需要判断能力时，明确使用独立插件已注册的能力。
- Agent 创建、列举、读取、等待、取消等使用 `host.agent.run` / `host.runs.*`。orchestration 包保留现有 Sesame 使用指南，作为没有运行入口的纯知识插件；不再注册四个别名工具。
- 现有宿主预算、能力白名单、运行控制、报告输出、取消与资源清理语义保持。更新测试、提示词和当前描述清单；历史发布目录仍指向其真实发布字节，不伪造更新。

## 修改顺序与所有权

1. 两个独立实现分支分别审阅本计划，先补能失败的去重/行为回归；现有判断证据与宿主委派/报告测试继续承担行为保护。
2. 判断分支负责 manual-trading 包及其判断/交易记忆测试；编排分支负责 orchestration 包、核心包测试与使用指南测试。主执行者负责宿主调用方及其集成测试、锁和 inventory 生成、交叉审查。
3. 只删除重复实现与入口，优先复用现有服务和宿主能力。无新增依赖，不新增兼容层，不迁移或删除历史账本。
4. 运行定向回归、包校验、相关集成测试、静态检查和宿主构建；最后由未编写相应实现的执行者复核边界。

## 验收证据

- manual-trading 不再声明或绑定 `manual_judgment_*` / 判断轮后钩子，启动不会创建第二套判断服务；独立 judgment-evolution 仍可登记、读取、核验证据和审计主会话。
- 交易案例复盘、工作流与清理仍通过原有测试。
- 用户指南继续可读可挂载；工具列表无 `agent_list/delegate/inspect/stop`，宿主统一能力可完成委派、等待、读取、取消和报告交付。
- 当前包锁与 inventory 与源码一致，两个仓库 diff 无意外改动。

## 验证结果

定向回归确认旧的判断副本会创建第二账本，旧编排包注册四个多余工具；修改后这些回归通过。

调用方改为宿主直接委派后，既有报告交付回归发现一个清理缺口：报告路径预留先创建工作区，路径校验/占用失败发生在 Agent 任务提交之前，没有 Agent 任务执行自己的清理。沿用同一宿主 Run 的结束逻辑回收未交给 Agent 任务的工作区，保留失败回执及用户文件；中断与取消仍由现有专用路径处理。回归继续核验没有模型启动、没有覆盖原文件、工作区实际清理完成。

独立审查补充一个归属竞态：Agent 内部任务已结束、外层输出校验尚未返回时，同一会话可以接收后续输入并创建新工作区。新增门闩回归先复现旧 Run 错误尝试清理新工作区，再将补救清理限定到仍绑定原 Run 的会话；不能仅凭会话当前没有 Agent 任务关联判断归属。

两个插件均升级为 `3.1.0`。manual-trading 的声明能力从 30 降为 16（删除 13 个判断工具及 1 个重复审计钩子）；orchestration 从 4 降为 0，保留 9 项知识材料。55 个插件包的能力总数从 340 降为 322，面向 Agent 的能力从 234 降为 217。

| 验证范围 | 最终结果 |
| --- | --- |
| 手动交易、判断证据与能力边界 | 140 个不同测试均取得通过结果；首次发现的两处旧夹具问题修正后，对应 24 项重跑通过，无跳过 |
| 编排指南声明、绑定与宿主加载 | 17/17 通过 |
| 宿主能力归属与完整报告交付 | 最终代码上 11/11 通过，包括单一账本、关闭指南仍能委派、预留失败回收及后续工作区归属 |
| 宿主使用指南与独立判断运行 | 3/3 通过 |
| Run、中断、工作流和宿主执行 | 34/34 通过 |
| 其他委派、上下文、资源清理回归 | 15 项通过；真实 Agent SDK 的 CSV 委派与报告流程另有 1 项通过 |
| 包锁、能力绑定、目录来源及宿主版本要求 | 38/38 通过；9 个核心包及 46 个可选包锁校验通过 |
| 前端类型检查与构建 | `npm run build:frontend` 通过，保留已有大包提示 |
| 语法、lint 和差异检查 | 修改的 JS 语法检查及两仓库 `git diff --check` 通过；最终宿主修复和新回归 lint 无警告，其他宿主测试文件保留两处既有未使用变量警告 |

最终宿主归属与报告测试命令（工作目录为宿主仓库）：

```powershell
$env:SESAME_OFFICIAL_PLUGINS_DIR='E:/brief2great/sesame/mt5agent/.omx/verification/capability-dedup-2026-10-16/core'
$env:SESAME_OPTIONAL_PLUGINS_DIR='E:/brief2great/sesame/mt5agent/.omx/verification/capability-dedup-2026-10-16/optional'
node --test --test-concurrency=1 tests/capability-ownership.test.js tests/delegated-report-output.test.js
```

宿主验证日志位于 `.omx/verification/capability-dedup-2026-10-16/`，包括 `host-final-ownership-tests.log`、`host-run-lifecycle-tests.log`、`host-agent-report-tests.log` 和 `build-frontend.log`。测试使用本地模型夹具及实际 Agent SDK，没有真实模型服务调用或交易操作。最终源码也已通过 `node scripts/assemble-test-plugins.mjs --source ../sesame` 组装到标准本地开发包目录。

独立审查已确认手动交易与判断能力边界，以及以 `host_run_id` 限定预留清理的归属检查。未修改已发布版本目录、未推送、未替换本机已安装应用。
