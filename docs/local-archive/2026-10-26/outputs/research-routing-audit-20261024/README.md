# 研究调度、报告运行状态与归类修复 — 2026-10-24

已完成代码、插件更新、验证、构建和本地切换。当前程序：

`E:/brief2great/sesame/mt5agent/output/desktop-research-routing-20261024-7QsPaT/package/win-unpacked/Sesame.exe`

沿用 `E:/brief2great/sesame/mt5agent/output/desktop-run-20261023-Ghxz3z` 的工作区、模型和桌面配置。切换前两次确认空闲并备份 SQLite，正常关闭旧程序。切换后核对历史消息、全部 Run 状态、模型配置、报告修订与位置以及插件启用状态，均保留。未恢复暂停任务或发送新研究请求。

## 原因与改动

1. **没有开工作流**：原运行环境 56 个插件摘要全部与当时源码及打包版本一致，并非漏更新。宿主提示词允许主 Agent 直接研究，覆盖了插件中的阶段委派口径。真实任务只有主 Agent 的脚本、写文件与报告调用，没有发现工作流或创建研究子 Agent。现在明确“最大努力、最大功率、全力、高强度”等研究要求先发现、加载并使用匹配的可执行工作流；没有合适的入口时再按独立问题委派。明确“轻量研究、快速研究”时允许直接处理，不强制工作流或子任务。研究报告与普通问答的区分保留。
2. **旧报告一直运行**：报告列表把作者主对话的状态投射给了它写过的每份报告。实际主对话并未绑定该报告。现在只有实际拥有报告输出绑定的任务影响运行状态，作者关系仅用于导航；多个报告、用户草稿、重启、父任务贡献和阶段状态均有回归覆盖。
3. **回测进 Research**：新建且未绑定任务的报告原本依赖 `related.role=strategy` 选择 Strategy，文档又把该关系与 SVL 源码绑定。现在 `report_publish` 和报告内容声明支持可选 `space: research | strategy`，新回测可以直接选择 Strategy；已有位置和任务绑定仍优先。原生 Python/MT5 回测不需要为分类制造 SVL。宿主 schema、运行时、报告工具声明、发布内容和策略研究指南已统一。

已有 `XAUUSD 震荡策略因子挖掘与回测` v4 的内容和 Research 位置保留；本次没有移动历史报告或重做研究。该文件在新版接口中显示 idle，不再跟随主对话的无关工作。新回测交付应明确使用 Strategy。

## 当前插件

| 插件 | 修复后版本 | 状态 |
| --- | --- | --- |
| orchestration | 3.1.4 | mounted |
| reports | 3.3.0 | mounted |
| investment-research | 3.1.8 | discoverable |
| strategy-research | 2.0.4 | disabled，保留用户设置 |

已通过现有插件管理接口更新工作区覆盖的 reports，其余更新来自新包。切换后 56/56 插件摘要匹配源码与新构建，239/239 宿主模块字节匹配。记录见 `deployment-verification.json`；没有开启原本禁用的策略研究或 backtrader。

## 验证

- 报告状态新增回归：修复前 2 失败 / 1 通过，修复后 3/3 通过。
- 原生回测归类和发布 schema：修复前失败，修复后 2/2 通过；覆盖真实 capability 边界、后续修订位置不变、绑定任务目录优先与非法分类拒绝。
- 宿主相关集成回归 55/55；最终强度措辞更新后 host-prompt 与 plugin-context-policy 再跑 12/12。
- 插件模板、导出契约、分类清单、研究方法回归 35/35；投资研究回归 28/28。
- 前端 TypeScript 与 Vite 构建通过；JS 语法、修改文件的 diff 检查与 oxlint 无错误，保留 3 条既有 lint 警告。
- 更宽的报告任务组合测试为 70/73：3 个旧夹具缺少宿主构造的 principal/origin，未进入报告执行；用未修改的 report-library 快照也重现了同样 3 处失败。详见 `report-lifecycle-notes.md`，没有把它们报告为通过。
- Electron 包验证通过。打开现有数据后检查报告目录和进程，界面截图见 `running-latest.png`。

真实模型使用当前配置 `deepseek/deepseek-flash`、thinking=max，最新的 56 个插件声明与实际模型运行时。最大功率样本先成功发现 factor 插件和 workflow 能力；轻量样本直接提出 data_providers、canvas_inspect。都在业务动作前停止，0 Run、0 子任务，没有实际研究、行情下载或交易。最大功率样本早于最后的轻量规则措辞细化，只证明发现工作流；两次都不证明后续完整工作流、报告质量或所有模型输出。详见 `real-routing-notes.md`。

## 精确变更记录

两仓库存在此前大量未提交工作。本次保留修改前的 `before/`、最终 `after/`、逐文件摘要 `task-change-index.json` 和仅本次增量的 `task-changes.patch`，未把他人改动混入一次整文件提交。

主要代码：宿主 `modules/agent/host-prompt.js`、`report-library.js`、`runtime.js`、`modules/plugins/artifact-schema.js` 及对应回归；插件 orchestration、reports、investment-research、strategy-research 的提示词、发布声明、版本与清单。没有新增依赖。构建、证据、临时文件和备份均位于 E 盘。
