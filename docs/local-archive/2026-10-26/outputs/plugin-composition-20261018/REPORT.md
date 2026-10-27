# 插件分层与组合：提示词审计和修正

2026-10-18。审查对象为 Sesame 本体与本地插件源码，按实际能力划分职责。共修改 48 个插件包的相关声明、提示词或调用接线；不把一个插件名称强行等同于一个层次，例如 MT5 的信息读取与交易执行仍是不同能力。

## 核心边界

| 层次 | 负责的问题 | 可供下游复用的成果 |
| --- | --- | --- |
| 信息获取、行情和解析 | 取得了什么资料，来源是什么，何时可知，覆盖哪里 | 固定数据/原文引用、字段和单位、时间、覆盖与缺口 |
| 分析方法与计算 | 在给定假设下，这份证据说明了什么局部问题 | 实际观察、参数及版本、条件解释、支持与反证、失效条件 |
| 工作流 | 哪些问题值得研究，需要哪些互补方法，分歧如何解释 | 综合判断、证据之间的关系、尚缺信息的影响、下一步方向 |

信息不足时可以返回信息层补齐具体缺口；已有证据充分时直接复用。简单问题可以只用一个方法，复杂问题选择能解决不同疑问的方法，不要求遍历插件。以上是交接语义，不新增强制 JSON 包壳或固定调用顺序。

## 找到并修正的问题

| 原问题 | 为什么影响组合 | 修正 |
| --- | --- | --- |
| 八个知识方法写成“仅用户明确选择”，并各自包含取数、分析、报告教程 | 工作流不能按问题选择方法；每个方法都像完整研究任务 | 允许用户或工作流选择；明确局部问题、证据前提、输出和解释边界，删除固定全流程 |
| 知识资源描述只有文件名或路径 | Agent 无法从声明判断用途、所需资料与预期产物 | 补充方法用途、输入要求、输出意义与局限；按需读取具体参考 |
| 手工交易和因子挖掘选中的知识包没有真正传给成员；宿主只从工具反推插件 | 没有工具的知识包被遗漏，描述写好也不能生效 | `host.agent.run` 增加可选 `plugins`，两个工作流实际传递；知识不额外授予工具，按需明确授权 `plugin_read` |
| 缺少知识插件时无法给出正常的依赖暂停/恢复语义 | Agent 可能在任务内部才发现方法不可用 | 宿主预检显式选中的知识包，返回具体缺包/禁用等原因；补齐后恢复同一 Run |
| 取数与方法说明混杂；抓取预览被当成全文，解析输出被误述为保留原 URL | 数据不完整或来源链丢失，Agent 反复抓取仍不能解决问题 | 明确 20k 预览与完整 ref 的区别，如实声明解析器输入/输出；调用者保留原来源与时间 |
| 工作流缺少复用、互补与相关性原则；部分计算器混入角色和报告安排 | 重复计算，多个同源指标被当成独立票数，产物重复 | 方法只返回局部成果；工作流复用、比较假设/口径/时间尺度并综合；评估器保持数值职责 |
| 仅加载知识方法也被因子工作流判定为已开放开发数据 | 知识选择意外破坏留出集隔离 | 依据真实研究工具判断数据访问；纯知识及精确的知识读取不触发开发数据分支 |
| 成员的完整证据交接要求同时约束经理总结 | 最终面向用户的总结复制大段 ArtifactRef JSON | 完整引用保留在内部研究记录/结构化决策；经理提炼关键数值、分歧与方向，用人可读来源 |

## 改动范围

- 核心 4 包：data-access、orchestration、plugin-manager、strategy-authoring。
- 信息、行情及研究引擎相关 12 包：financial-research、web-sources、web-extract、rss-collect、market-data-parser、akshare、ccxt、mt5、qmt、backtrader、vnpy、portfolio-execution。按其中的具体能力澄清职责，未更改交易和数值算法。
- 知识方法 8 包：price-action、ict、dow-theory、elliott-wave、wyckoff、behavioral-finance、institutional-analysis、narrative-analysis。
- 数值方法 19 包：18 个 ABU 包和 factor-evaluator。
- 工作流/研究组织 5 包：manual-trading、auto-factor-mining、strategy-research、factor-research、judgment-evolution。

完整包名见 [changed-packages.json](E:/brief2great/sesame/outputs/plugin-composition-20261018/changed-packages.json)。插件作者说明同步更新于 `plugin-manager/skills/develop-plugins/references/authoring.md`。宿主的通用分层组合原则写入 `modules/agent/host-prompt.js`；插件保留领域目标、因果原则和接口契约。

## 实际模型验收

使用实际 Sesame Runtime、当前插件源码、已配置的 `openai/gpt-6.1-sol`（thinking low）。模型真实调用，行情和账户是隔离测试用的虚构输入；没有接入真实券商。固定输入为 20 根 H1 数据。测试核对真实调用输入、来源/时间、生产者返回引用，并用独立公式复核斜率与 ATR。

| 场景 | 实际结果 | 证据 |
| --- | --- | --- |
| 单一数值问题 | 只执行一次趋势计算；最新 8 柱斜率 0.8714285714 价格单位/柱 | [simple-validation.json](E:/brief2great/sesame/outputs/plugin-composition-20261018/simple-validation.json) |
| 复合分析问题 | 读取一次冻结行情，读取价格行为方法，组合趋势与波动；斜率为正、ATR(5)=10，解释两者测量对象不同 | [composite-validation.json](E:/brief2great/sesame/outputs/plugin-composition-20261018/composite-validation.json) |
| 必需新闻缺失 | 直接通过 `host_runs_interrupt` 暂停，没有用价格统计冒充新闻证据 | [missing-1/evidence.json](E:/brief2great/sesame/outputs/plugin-composition-20261018/missing-1/evidence.json) |
| 8 成员工作流 | 8 个成员完成且都收到所选知识；只读取一次冻结行情、执行两次计算，4 个下游角色复用成果；10 次工具调用全部成功 | [workflow-validation.json](E:/brief2great/sesame/outputs/plugin-composition-20261018/workflow-validation.json) |

最后工作流的经理总结为 987 字符，前一次相同案例为 2672 字符，减少约 63%；关键数值、分歧与失效条件仍在，内部 ArtifactRef JSON 已移至成员记录。这个比例只描述本次两个样本，不是稳定性或市场表现承诺。[实际经理总结](E:/brief2great/sesame/outputs/plugin-composition-20261018/manager-summary.md) 保留供核对。实际交易调用和报告发布均为 0。

原始运行保留在各 JSON 的 source 指向文件中。早期验收脚本错误地要求固定工具名/完整 20 行输入；另将宿主的 9 个未发布任务占位记录误算为报告。已按合法数据窗口、已授权读取能力和实际发布版本修正验证器，对留存真实调用重新执行断言并保存上述 validation 文件，没有改写原始记录或把测试脚本限制写进产品提示词。原 evidence.json 中保留这些旧断言错误，最终验收以对应 validation.json 为准。

## 自动化与集成验证

- 宿主知识传递、依赖预检、暂停/同 Run 恢复及相关 Agent 契约测试通过；新增回归在修复前失败、修复后通过。
- 方法层：56 项 Node、16 项 Python；信息层：81 项契约测试及 3 个真实 MCP 解析器的 8 次调用；工作流相关定向测试通过。不同测试组有覆盖重叠，不将数量相加作为唯一测试总数。
- 全量测试没有全部通过：核心 SDK 测试 629 项中 590 通过、26 失败、13 跳过；可选插件 887 项中 732 通过、133 失败、22 跳过。核心中本轮引入的 MT5 参数示例遗漏已修正，相关文件重新运行 56/56 通过。其余失败分类与原始日志见 [integration-verification.md](E:/brief2great/sesame/outputs/plugin-composition-20261018/integration-verification.md)，主要为旧 API 夹具、旧版本/历史断言以及 Kurumi 现有开发状态。
- 宿主改动和验收脚本 lint、语法及差异检查通过；12 个已修改插件 JavaScript 文件语法检查通过。48 个包的原有能力 inputSchema、outputSchema、effects、binding、execution、consumers 与修改前相同，见 [接口对比](E:/brief2great/sesame/outputs/plugin-composition-20261018/plugin-contract-comparison.json)。核心 9 包与可选 45 包的锁完全匹配源码；可选锁仅保留 Kurumi 原条目，不将它的原有五文件未提交改动混入本轮，见 [锁验证](E:/brief2great/sesame/outputs/plugin-composition-20261018/final-lock-validation.json)。

## 保留的边界

- 三个 MCP 解析器仍只接收内联文本或包内样本路径，不能直接消费 DataRef/工作区文件。提示词已如实说明；长正文从固定引用直达解析器仍是后续接口改进点。
- 手工交易沿用现有 8 个研究角色。本轮改善按问题选择方法、复用和不适用维度的表达，没有实现动态裁剪角色。
- 实际模型验收覆盖代表性组合链路，没有声称每个插件在所有真实数据源上都完成了模型验收。
- 本轮未修改原有 Store 数据恢复工作或 Kurumi 开发改动，未发布、安装或替换用户版本。新增知识传递字段与调用它的工作流插件应随支持该字段的新宿主一同交付。

## 临时文件清理未完成

本次测试早期运行留下 9 个 `private-pi` 目录中的 18 个认证/模型配置副本，位于本报告同级的 `agent-cases-1` 至 `agent-cases-5`、`missing-1`、`workflow-1` 至 `workflow-3` 下。自动审批先后拒绝目录清理和限定文件清理；收到用户明确删除授权后，同一条逐文件清理命令仍被执行器以 `blocked by policy` 拒绝。未改用其他接口绕过拦截，副本目前仍在本地测试目录。真实 Sesame 配置未受影响，测试数据目录不属于本次源码发布内容。具体文件见 [cleanup-status.json](E:/brief2great/sesame/outputs/plugin-composition-20261018/cleanup-status.json)。新验收脚本已增加仅使用新输出目录、正常结束或初始化异常后清理自身临时认证目录的保护。
