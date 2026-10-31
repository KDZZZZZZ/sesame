# Sesame 功能差异对照

核对时间：2026-10-20。已刷新两个仓库的远端引用。下文排除 Kurumi；“正式版”指 v0.2.4 发布时的安装包与固定插件清单，插件目录后续发布另行区分。

## 版本基线

| 层级 | 应用仓库 `mt5agent` | 插件仓库 `sesame` |
| --- | --- | --- |
| 正式 v0.2.4 | 构建源码 `f9901ab4d8e3407cc1dda3c7f397b393ea787680` | 发布标签 `1ac2708ac9cda6f52859f0a63e3f034806ac1a43`；应用固定插件源码 `4e153a4474285e162d88a484d517fa37283a465c` |
| 远端 `origin/dev` | `f36e6d7b158424c7448af0d669412ae26457092b` | `d18d17764a9936103f2b3b2c6ba6f65ae20fd2b2` |
| 本地已提交 HEAD | `release/sesame-0.2.4` / `f9901ab` | `release/application-0.2.4` / `59bf69d`；文件树与 v0.2.4 相同 |
| 本地工作区 | 在上述 HEAD 上还有大量未提交源码和测试修改 | 旧发布分支上有更完整的未提交实现，包括 dev 的研究插件及后续重构 |

应用正式版、应用远端 dev、本地应用 HEAD 的 Git tree 都是 `6adc30d9f944e9d2b096843c627ab4b11178beea`。dev 多出的 3 条提交是合并节点，**应用功能增量为零**。

公开插件仓库的正式标签到 dev 实际新增 Investment Research 那一批，24 个文件、增加 3,004 行、删除 4 行。不能根据本地分支名或单一版本号判断实际功能：当前未提交工作区和测试程序均已超过正式 0.2.4。

发布依据：[v0.2.4 Release](https://github.com/KDZZZZZZ/sesame/releases/tag/v0.2.4)、[应用构建 Run 39059008826](https://github.com/KDZZZZZZ/mt5agent/actions/runs/39059008826)、[安装包资产清单](E:/brief2great/sesame/sesame/.github/application-release.json)。

构建日志中的 Windows 安装包 SHA-256 为 `1f45c8b6a584e5857a6cbf4e36b8a0c296491d46aa14de71df252b8a34fe38a3`，与公开发布资产清单一致。

实时读取[官方插件目录](https://dl.sesame.bot/plugins/api-v1/catalog.json)，当前仍为 **dev.6、54 个插件**，sourceCommit=`4e153a4`、releaseCommit=`e0e3a64`。目录有 `manual-trading@3.3.0`，没有 `investment-research` 或 `trading-decision`；其锁和归档摘要与 v0.2.4 固定发布计划一致。最近一次[实际 R2 发布](https://github.com/KDZZZZZZ/sesame/actions/runs/39048993406)核验 962/962 对象成功。远端 dev 的后续研究插件已通过 CI，但尚未发布到该目录。

## 正式版已经具备的基础功能

这些不应重复计为本地新 feature：

- Plugin API 2、插件管理、会话与任务工作区、记忆。
- MT5 行情、账户、指标源码与策略/SVL 的基础能力。
- 报告库文件操作、固定修订、任务与报告绑定、工作/报告视图切换。
- Markdown、GFM 表格、KaTeX。
- 子任务暂停及恢复、主 Agent 处理依赖阻塞。
- Windows/Linux 应用内检查、下载及安全重启更新。
- 单文件报告扁平化已有基础实现；本地继续修复相对资源、旧包装目录和资源保护。

## 正式版 → 远端 dev

应用：没有功能增量。

插件：增加独立 `sesame/investment-research`：

- 8 角色投资研究流程。
- 对原分析员进行定向 QA，保留问题与证据。
- 固定研究成果及报告重做。
- 使用 `start_from` 从指定阶段重新执行。
- 通过既有报告绑定把成果交给父 Run。

dev 中 `manual-trading` 仍存在，此时研究插件与旧交易插件并存。上述增量来自 [99e8b17](https://github.com/KDZZZZZZ/sesame/commit/99e8b17)。

该批提交只有[源码检查](https://github.com/KDZZZZZZ/sesame/actions/runs/39245739885)和[目录检查](https://github.com/KDZZZZZZ/sesame/actions/runs/39245739908)，不能视为发布。发布工作流仅接受 main 分支，并有独立发布计划触发条件。

## 远端 dev → 本地工作区：应用功能

| 功能组 | 本地新增或增强 | 状态说明 |
| --- | --- | --- |
| 统一配置与密钥 | 集中入口、脱敏状态、配置字段绑定原读取/更新接口及消费能力；调用前检查依赖 | 应用与插件共同实现 |
| 插件目录管理 | 安装/升级目录、版本与宿主兼容性显示 | 本地新增 UI 与服务 |
| 报告导出 | PDF、PNG；超长图片分片；支持源文件与固定报告修订 | 本地新增 |
| 报告文件组织 | 完善单文件扁平化、含资源报告包及相对资源处理 | 兼容修复，不是从零新增报告库 |
| 图表绘图 | 趋势线、水平线、矩形、斐波那契；实时保存，绘图与源码双向转换，Agent 可读取 | 本地新增 |
| 行情缓存 | 超出显示范围的缓存、提前预取、稳定显示窗口、软过期与延迟回收 | 本地增强 |
| 主题 | 浅色蓝/陶土橙、深色蓝紫，保留独立的行情涨跌色 | 本地视觉调整 |
| SVL 构图 | 节点测量、分层布局、交叉整理、连线路由、缩放平移和适应画布 | 本地增强 |
| 子任务完成通知 | 顶层子 Agent/工作流完成后持久化通知、唤醒空闲主 Agent、去重、重试及重启恢复 | 与正式版已有的“暂停恢复”不同 |
| 通讯插件入站 | `workspace.agent.message` 支持用户/自动化身份、来源标记、去重与排队 | 既有事件端口上的新增约定 |
| 协作与证据 | 明确传递知识插件、固定证据记入 Run、冻结协作结构、子任务共用父报告 | 本地增强 |
| 最近兼容修复 | 恢复 `details/summary`；报告提示词要求实际生成、发布、核验路径与状态 | 已补入当前打开的测试程序 |

其他修复包括 Windows 数据根路径、schema 校验与资源生命周期；不另算新 feature。

## 远端 dev → 本地工作区：插件功能

| 功能组 | 本地变化 |
| --- | --- |
| 功能分类 | 职责轴 `business / analysis / integration / presentation / platform`，与实现轴 `knowledge / function / adapter / workflow / service` 分开；保留 legacy category |
| Inventory | 由真实 manifest/capability 生成并检查缺失、重复、过期项目 |
| 脚手架 | knowledge、function、adapter、workflow、service 五类模板，含配置依赖示例 |
| 研究/决策/执行分工 | 研究交给 Investment Research；交易决策交给 Trading Decision；账户执行交给 Portfolio Execution |
| 自定义投资研究 | `workflow.stages/synthesis`、成员 ID/角色/模型、实际协作图、接受后冻结并可恢复的计划 |
| 交易决策 | 消费固定研究，复核、经理决策、执行员分工；支持 `execute:false` 和复核 veto |
| 配置助手 | 新增 `configuration_integration_catalog/check/apply/open`；MT5 22 字段、Financial Research 5 字段、QMT 6 字段，共 33 个字段 |
| MT5 / QMT / CCXT / Backtrader | 按连接、工程、编译、行情、账户、订单、历史、订阅、输入、运行、结果等职责拆模块；MT5 原生异常转为可恢复来源错误 |
| 专业能力 | 31 个分析包对齐职责；ICT 等知识包保留参考内容且不凭空获得执行能力；共享解析/ABU 代码保持同源、独立交付 |
| 因子研究 | 可选计划/复核/反思阶段、成员职责与模型、计划冻结；知识随成员委派，长期流程偏好纳入记忆 |
| 财经数据 | CFTC COT；FMP annual/quarter；FRED 单位、频率、季调等元数据与来源覆盖诊断 |
| 抓取/解析 | 三类解析器改用原生 `host.process`；支持固定 `source_ref` 输入、大结果 artifact；保留原始字节、编码和明确不可用状态 |
| 图表插件 | 新增 `chart_drawing`，通过既有 `host.views` 操作绘图和源码 |
| ABU 指标/波动 | 增加日历日期、未知 `available_at` 输入，以及 `true_range/atr_percent`；首根 TR 与 ATR 预热规则有实际修正 |

## 插件数量

| 版本 | 核心 | 可选（排除 Kurumi） | 合计 |
| --- | ---: | ---: | ---: |
| 正式 v0.2.4 固定清单 | 9 | 45 | 54 |
| 远端 dev | 9 | 46 | 55 |
| 本地工作区 | 9 | 46 | 55 |

源码 inventory 若包含 Kurumi，对应数值是 55 / 56 / 56。安装包直接捆绑 9 个核心插件，可选插件通过独立目录分发，不能把目录总数当作包内文件数量。

本地没有再增加净插件数：相对 dev 删除 `manual-trading`、新增 `trading-decision`。职责分布排除 Kurumi 后为业务 7、分析 31、集成 10、展示 2、平台 5，共 55。

## 尚需处理的兼容边界

1. **旧交易插件改名尚无兼容别名**：`sesame/manual-trading` → `sesame/trading-decision`，`manual_trading_*` → `trading_decision_*`。旧能力调用和历史暂停流程不能视为自动兼容。旧历史数据保留，不等于旧接口仍可运行。
2. **新插件需要匹配的新宿主能力**：自定义研究流程使用 `execution.setCollaboration`，配置目录使用新配置能力。不能承诺仅更新插件就能在所有旧宿主使用全部新功能。
3. **统一端口稳定不等于能力声明毫无变化**：Canvas 新增 1 个能力、Configuration 4 个、MT5 3 个、QMT 2 个。
4. **数值语义变化**：无前收盘价时首根 TR 改为 null；ATR 要求完整窗口，旧版早期结果会不同。需要作为指标修正记录。
5. **解析 transport 与大输出形态变化**：三个解析器从 MCP 转原生适配；输入扩展和 artifact 输出需要兼容验收。

所以目前可以说“统一宿主端口尽量保持稳定”，**不能说“所有既有接口和行为完全不变”**。

## 当前测试程序与验证范围

当前打开的是本地解包测试程序：

`E:/brief2great/sesame/mt5agent/release/win32-x64-agent-messages-20261020/win-unpacked/Sesame.exe`

它使用现有 Sesame 配置和工作区，包含本地主要功能，并已补入本次报告交付提示词与 Markdown 折叠修复。刚补入的 3 个宿主提示词文件和前端构建已生效，**尚未重新生成安装器、推送 dev 或创建正式 Release**。

本次新鲜验证：

- 报告提示词和父报告集成测试 8/8 通过。
- 前端构建、Markdown UI 回归、局部 lint 与差异检查通过。
- 真实测试程序：原消息的折叠块可展开/收起，单文件研究结果可预览。
- 122 条历史消息、6 个暂停 Run、模型配置及 361 条受保护记录保持一致，55 个启用插件 ready。

补充的研究文件仅把已有冻结数据整理为可阅读源文件，标注为源文件预览，没有伪造一次新的研究执行或已发布的不可变修订。

这份功能对照依据 Git 历史、源码及声明；没有为每项存量功能重新执行全面验收。不能把“工作区有实现”“当前测试程序有实现”“已经正式发布”混为同一种状态。

运行验证：[runtime-verification.json](E:/brief2great/sesame/outputs/report-delivery-20261020/runtime-verification.json)。
