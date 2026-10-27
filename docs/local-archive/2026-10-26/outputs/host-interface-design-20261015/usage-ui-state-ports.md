# UI / 文件 / 记忆接口的插件消费与本体职责

核对 2026-10-15 当前文件：`E:/brief2great/sesame/sesame/plugins/api-v1/packages`（9包）和 `optional-api-v1/packages`（46包），共55包；另外检查 `E:/brief2great/sesame/plugins/optional-api-v1/packages`，该路径当前是7个插件的空目录树，递归文件数为0，不能算额外生产实现。只读静态消费审计，不代表运行次数统计；用户/Agent临时生成的HTML、已存报告和外部插件不在本次扫描内。

分类：R=插件运行代码调用；G=插件生成HTML/打包资产运行时调用；P=提示词/技能/开发文档引导；T=测试/示例；D=仅存在性检测。不能以 P/T/D 当作已有生产调用，也不能用“插件零调用”推断本体UI/Agent不用。

## 实际消费表

| 接口 | R/G 生产消费 | 未发现生产消费的方法及其他证据 |
| --- | --- | --- |
| `memory` | 仅 memory 插件；运行时调用 `tree/search/read/index/propose/candidates/save/resolveCandidate/markUsed/archive/restore/forget/stats`。 | `list/get/configure` 未发现插件 R；`list/get` 是 search/read 别名，本体 HTTP 仍使用二者。`archive/restore/forget` 经 `memory[args.action]` 调用，不能误列为未用。 |
| `layout` | canvas-control、kurumi-replay 调用全部 `inspect/apply/script`。 | 无未用方法；kurumi 的 tests 中也有假layout，已排除T。 |
| `dataViews` | 没有插件调用。 | `inspect/configure/reset` 都无插件R；但本体原生UI HTTP和 `data_view_inspect/configure` 工具均消费，其中 configure 工具的 action=reset 调用 reset。 |
| `reports.list/read` | 没有插件调用。 | 现有 reports/kurumi 报告发布走 artifacts；这两个兼容报告目录入口应审视/收敛，但本体报告消息和旧报告对象仍存在，不能仅按插件零消费删除内部报告服务。 |
| `reports.files` | manual-trading、auto-factor-mining：`forSpace/list/read/mkdir/write`。 | `move/delete/restore` 无插件R；原生报告文件树和7个 report_files_* 内置工具都消费。manual-trading 对 forSpace 有 D 兼容检测，但随后确实调用，是R+D。 |
| `reports.live` | manual-trading、auto-factor-mining：`open/close`。 | 两者均有R；还检查方法存在（D），不能只计检测。 |
| `workspace` | `path/file/snapshot/run/root/taskRoot/owner` 均有R；`operations.readFile/mkdir/writeFile` 有R。主要生产者/消费者为 workspace、MT5、reports、strategy-authoring、data-access、plugin-manager、web-sources、backtrader、vnpy、ccxt、judgment-evolution、manual-trading、kurumi。 | `operations.access` 未发现插件R。`file` 子动作 read/write/write_tree 有R；access/mkdir/write_base64 未发现直接插件R（mkdir 通过 operations 真正使用）。多个包只有 `const box=host.workspace` 未再使用，不能以该别名声明算方法调用。 |
| `externalFiles` | workspace 插件将9个方法全包装为 Agent 工具：`list/search/read/import/write/mkdir/move/remove/run`。 | 无未用方法；当前主要是单个插件的工具包装层消费，不能称无业务入口。 |
| `window.report` | reports、kurumi-replay 生成HTML/打包资产真正调用 `readData/track`。 | 未发现随包运行HTML/JS调用 `ready/getContext/readArtifact/readStrategy/readRun/subscribeContext`；其中多个仅P列在 repair.md 或开发接口文档。`readStrategy` 实现就是 readArtifact 别名。 |
| `window.reportLive` | manual-trading、auto-factor-mining 生成的协作页面调用 `subscribeSnapshot/subscribeConnection`。 | `ready` 未发现外部显式 await；SDK握手与ready Promise仍是内部连接实现的一部分，不等于不需要握手。 |
| 16个本体内置Agent工具 | 在55个包文件中未发现这些工具名的引用。 | 不能标成“没用”：本体统一注册并注入3组系统提示词，Agent可独立使用；这些工具没有插件owner，插件也不能靠host.tools.call直接调用。是否实际被模型调用要查执行日志。 |

### 关键消费证据

- memory 动态路由：[tools.js:26](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/tools.js:26)、[tools.js:34](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/tools.js:34)；压缩时实调：[compaction.js:74](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/compaction.js:74)、[compaction.js:169](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/compaction.js:169)。本体 list/get 兼容消费者：[server.js:128](E:/brief2great/sesame/mt5agent/modules/agent/server.js:128)、[server.js:140](E:/brief2great/sesame/mt5agent/modules/agent/server.js:140)。
- layout：[canvas-control/tools.js:25](E:/brief2great/sesame/sesame/plugins/api-v1/packages/canvas-control/tools.js:25)、[kurumi/index.js:44](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/kurumi-replay/index.js:44)、[replay-presentation.js:98](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/kurumi-replay/replay-presentation.js:98)。
- files 别名消费：[manual-trading/reports.js:8](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/manual-trading/reports.js:8)、[reports.js:75](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/manual-trading/reports.js:75)、[auto-factor-mining/archive.js:12](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/auto-factor-mining/archive.js:12)、[archive.js:58](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/auto-factor-mining/archive.js:58)。
- live：[manual-trading/live-viewer.js:26](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/manual-trading/live-viewer.js:26)、[live-viewer.js:55](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/manual-trading/live-viewer.js:55)、[collaboration.js:223](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/manual-trading/assets/collaboration.js:223)。auto-factor-mining相应同名文件有相同生产流程。
- workspace 别名/operations：[workspace/tools.js:41](E:/brief2great/sesame/sesame/plugins/api-v1/packages/workspace/tools.js:41)、[tools.js:47](E:/brief2great/sesame/sesame/plugins/api-v1/packages/workspace/tools.js:47)、[tools.js:61](E:/brief2great/sesame/sesame/plugins/api-v1/packages/workspace/tools.js:61)、[tools.js:72](E:/brief2great/sesame/sesame/plugins/api-v1/packages/workspace/tools.js:72)。snapshot/write_tree：[mt5/service.js:91](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/service.js:91)。taskRoot真调用：[kurumi/service.js:884](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/kurumi-replay/service.js:884)，区别于 [index.js:12](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/kurumi-replay/index.js:12) 的存在性检测。
- externalFiles 全部包装：[host-files.js:12](E:/brief2great/sesame/sesame/plugins/api-v1/packages/workspace/host-files.js:12)。
- 浏览器生产资产并非示例：[reports/index.js:89](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/index.js:89) 将模板和report-kit内联；[report-kit.js:80](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/assets/report-kit.js:80) 读取数据；[research-brief.html:51](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/templates/research-brief.html:51) track；[kurumi/report.js:22](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/kurumi-replay/report.js:22) 内联kit并生成HTML，[report.js:65](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/kurumi-replay/report.js:65) 正式发布。
- 只在文档描述的桥能力：[reports/repair.md:5](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/repair.md:5)、[develop-plugins/host-api.md:242](E:/brief2great/sesame/sesame/plugins/api-v1/packages/plugin-manager/skills/develop-plugins/references/host-api.md:242)。因此不应声称未来/动态生成报告绝不使用。

## 本体16工具的实际生产和消费

| 工具组 | 产生入口 | 宿主最终执行 | 更合适的边界 |
| --- | --- | --- | --- |
| `report_files_list/read/mkdir/write/move/delete/restore`（7） | createReportLibraryTools；工具schema和提示词在本体 | runtime.reportLibrary对应方法 | Agent工具定义/说明/提示词可移默认 reports 或文件插件；宿主保留共享文件库、版本冲突、回收站、用户移动/删除和页面刷新。已有 host.reports.files 足以包装。 |
| `data_extensions_list/read`（2） | createDataViewTools | providers.list/bind/call/unbind，历史分页聚合 | 优先移 data-access 插件，现有 host.providers 足够；宿主保留提供方身份、连接权限、协议数据校验和取消。 |
| `data_view_inspect/configure`（2） | createDataViewTools | runtime.dataViews.inspect/configure/reset | Agent工具包装/提示词可移 canvas-control；宿主保留原生视图状态、CAS和订阅生命周期；固定账户字段目录宜由领域插件贡献。 |
| `strategy_sources_list/strategy_source_read/strategy_mounts_inspect/strategy_mounts_configure/trade_trace_inspect`（5） | createAccountStrategyTools | runtime.accountStrategies | 最强领域业务耦合候选；策略源挑选、挂载工作流与成交追溯解释适合策略/账户插件。当前没有host.accountStrategies，迁移不能直接复制工具私访Runtime；需先拆出通用受控引用/CAS视图槽或领域贡献接口。 |

来源：[tools.js:108](E:/brief2great/sesame/mt5agent/modules/agent/tools.js:108)、[report-library-tools.js:1](E:/brief2great/sesame/mt5agent/modules/agent/report-library-tools.js:1)、[data-view-tools.js:49](E:/brief2great/sesame/mt5agent/modules/agent/data-view-tools.js:49)、[account-strategy-tools.js:3](E:/brief2great/sesame/mt5agent/modules/agent/account-strategy-tools.js:3)、[plugin-registry.js:578](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:578)、[plugin-registry.js:616](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:616)。

本体HTTP也实际执行文件和视图管理：[server.js:124](E:/brief2great/sesame/mt5agent/modules/agent/server.js:124)、[server.js:197](E:/brief2great/sesame/mt5agent/modules/agent/server.js:197)、[server.js:212](E:/brief2great/sesame/mt5agent/modules/agent/server.js:212)。

## 哪些责任适合下放，哪些必须保留

以下是架构建议，不是当前API已完成迁移。目标若是可扩展插件宿主，应让本体管理能力边界，让插件管理领域规则与Agent用法。

| 当前本体责任 | 建议下放插件的部分 | 应留在宿主的部分 |
| --- | --- | --- |
| 固定16个Agent工具和3段系统提示词 | 工具名称/参数schema/描述/提示词、默认调用流程、数据分页聚合；用随应用发布的默认插件承载。 | 工具注册/名字冲突、加载资格、权限/预算、审计、取消和统一结果封装。 |
| MemoryService硬编码分类和生命周期 | `user/projects/strategies/lessons/references` 分类法、热/温/归档评分和维护默认值、什么事实值得记、冲突合并决策。 | 跨会话访问、正式写权限、不可伪造来源引用、版本、可追踪遗忘及会话副本清理。抽取/归纳目前已在memory插件。 |
| DataViewService固定 chart/account/position 和标准金融字段 | 余额/净值/持仓等领域字段目录、显示默认值、字段分组/格式语义，由金融UI插件贡献。 | 原生组件挂载、精确目标引用、CAS、用户锁、订阅与视图销毁。若产品永久限定交易终端，这属于核心产品特性而非普适平台能力。 |
| AccountStrategies | SVL策略源选择、账户挂载工作流、成交追溯的领域呈现/解释。 | 成果/Run引用真实性、精确关联校验、通用可版本化视图状态。不能把允许推断关联当成迁移理由。 |
| 报告目录固定research/strategy | 空间名称、业务目录规则、报告模板、日报/周报/回测叙事。 | 通用共享文档库、稳定ID、乐观版本、回收站、用户变更尊重、不可变发布与安全预览。 |
| reports/live 与浏览器桥 | 协作UI、业务快照结构、图表/报告组件、正文格式；这些已有插件实现，应保持。 | iframe/MessagePort/nonce、精确依赖授权、资源校验、网络/CSP隔离、渲染回执、断线重连和销毁。不能为减少接口让页面直接访问host或Node。 |
| workspace/externalFiles | Agent的 read/edit/write/bash 工具包装、输出分页和显示策略；目前已在workspace插件，边界基本正确。 | 路径/受保护目录检查、资源归属、进程生命周期、取消/超时、执行证据和真实文件操作。 |

业务硬编码证据：[memory-service.js:12](E:/brief2great/sesame/mt5agent/modules/agent/memory-service.js:12)、[memory-service.js:155](E:/brief2great/sesame/mt5agent/modules/agent/memory-service.js:155)、[data-view-service.js:12](E:/brief2great/sesame/mt5agent/modules/agent/data-view-service.js:12)、[data-view-service.js:25](E:/brief2great/sesame/mt5agent/modules/agent/data-view-service.js:25)、[report-library.js:28](E:/brief2great/sesame/mt5agent/modules/agent/report-library.js:28)。安全桥证据：[artifact-host.js:9](E:/brief2great/sesame/mt5agent/modules/frontend/report-runtime/artifact-host.js:9)、[live-report-host.js:36](E:/brief2great/sesame/mt5agent/modules/frontend/report-runtime/live-report-host.js:36)。

## 明显可收敛和不宜硬合并的地方

1. **可直接统一规范名，保留兼容别名**：memory.list→search、memory.get→read；window.report.readStrategy→readArtifact。这些是实质重复；前两项有宿主HTTP消费，不能骤删。
2. **文件端口可以共享更一致的底层与命名，但保留来源/空间语义**：workspace、externalFiles、reports.files 的读写可复用；工作区命令归属、外部文件保护、报告文件CAS/回收站不同，不宜合成丢失这些信息的 `fs(action,args)`。
3. **operations可考虑内收/统一，但不能当作纯别名直接删**：`operations.readFile/access` 先处理已挂载插件资源授权，再读工作区，并使用当前工具signal。`workspace.file('read')` 没这条资源入口。[tools.js:91](E:/brief2great/sesame/mt5agent/modules/agent/tools.js:91)
4. **reports.list/read 可作为兼容外观逐步归并成果查询**：静态包内零消费，新reports插件用ArtifactRef；但旧报告ID/整数revision与ArtifactRef不是同一身份，应先设计映射/迁移。
5. **保留可变文件、不可变成果、临时实时页面三种不同语义**：可以同属一个用户文档/视图入口，但不能把文件修改自动当发布、把live当可重现报告。
6. **ready/getContext等低消费接口不等于错的职责**：握手、主题、上下文是正常宿主能力；可收窄公开面，不能因此下放MessagePort或身份授权实现。

## 静态扫描防误判记录

- 对55包全部文本搜索16个本体工具名字，0命中；本体注册/提示词有明确命中，所以分类为“本体Agent公共能力，无包内点名消费者”，不是死代码。
- 完整搜索了 host 属性直调、`box=host.workspace`、`operations=box.operations`、`api=()=>host.memory`、`memory[args.action]`、`files=host.reports.files.forSpace(...)`、`window/global.report`。测试和examples单列，生成模板/assets纳入G。
- `report.ready` 还会命中 manual-trading/auto-factor-mining 的普通业务事件字符串，不是浏览器 `window.report.ready` 读操作。
- 当前候选“无插件运行消费”是静态结论；不对运行频率、动态Agent代码、历史报告作绝对断言。
